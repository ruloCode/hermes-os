/**
 * Sesión persistente del chat de texto (spec «sesion», design.md 3.2).
 *
 * Antes cada turno de `/v1/chat/completions` arrancaba un proceso del CLI
 * nuevo con `resume`: se pagaba el arranque (~2 s) y el CLI releía la
 * conversación del disco en cada mensaje. Aquí, como la capa rápida de juntas
 * (createFastEngine en meetings/live-copilot.ts), UN proceso queda vivo por
 * sesión de cliente con entrada en streaming: cada mensaje se empuja a la
 * misma sesión y su `result` cierra el turno.
 *
 * Reglas:
 *  - Clave = sesión del cliente + perfil de tools + modelo + proyecto en foco +
 *    tools apagadas (candado de finanzas). Si algo cambia, se recicla
 *    (chatSessionKey en chat-session-policy.ts).
 *  - 10 min sin uso → se cierra; máximo 3 vivas (sale la menos usada).
 *  - Un turno a la vez por sesión: el que llega mientras otro corre espera.
 *  - Detener = interrupt() del turno: lo dicho vale y la sesión sigue viva.
 *  - Al crearla para un cliente que ya tenía conversación, `resume` con su id.
 *  - Cualquier fallo lo decide quien llama (session.ts): si no salió nada
 *    hacia el cliente, el turno corre por el camino de una vuelta.
 *
 * Solo el chat usa esto: tareas, programadas y el resto siguen de una vuelta.
 */
import type { Options, Query, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { trackedQuery, type TrackMeta } from "./tracked-query.js";
import { CHAT_SESSION_IDLE_MS, TurnQueue, chatSessionKey, liveMatchesResume, pickEvictions } from "./chat-session-policy.js";

/** Quien procesa los mensajes de un turno (en session.ts, el TurnCollector). */
export interface TurnSink {
  /** true = el `result` que cierra el turno. */
  handle(message: unknown): boolean;
  /** El id de la sesión SDK, apenas se conoce (para que el tab la adopte). */
  announce(sdkSessionId: string): void;
}

export interface LiveChatSpec {
  clientId: string;
  profile: string;
  model: string;
  project?: string;
  disallowedTools?: string[];
  /** La conversación SDK que el cliente quiere seguir (si ya tenía). */
  resume?: string;
  /** El cliente pidió una conversación nueva. */
  fresh: boolean;
  meta: TrackMeta;
  /** Las opciones del SDK con las que se abre el proceso (el `resume` lo decide la sesión). */
  options(resume: string | undefined): Options;
}

/** ok = respondió · aborted = el cliente lo detuvo · failed = la sesión falló. */
export type LiveTurnOutcome = "ok" | "aborted" | "failed";

interface PendingTurn {
  sink: TurnSink;
  resolve(outcome: LiveTurnOutcome): void;
  aborted: boolean;
}

class LiveChatSession {
  readonly clientId: string;
  sdkSessionId?: string;
  readonly resumedFrom?: string;
  lastUsed = Date.now();
  closed = false;
  private readonly q: Query;
  private readonly inbox: SDKUserMessage[] = [];
  private wake: (() => void) | null = null;
  private current: PendingTurn | null = null;
  readonly turns = new TurnQueue();

  constructor(
    readonly key: string,
    spec: LiveChatSpec,
    private readonly onClose: (s: LiveChatSession) => void,
  ) {
    this.clientId = spec.clientId;
    this.resumedFrom = spec.fresh ? undefined : spec.resume;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    async function* input(): AsyncGenerator<SDKUserMessage> {
      while (!self.closed) {
        const next = self.inbox.shift();
        if (next) {
          yield next;
          continue;
        }
        await new Promise<void>((resolve) => (self.wake = resolve));
        self.wake = null;
      }
    }
    // Una línea del registro de gasto por turno (trackedQuery mide la entrada en streaming).
    this.q = trackedQuery("chat", { prompt: input(), options: { ...spec.options(this.resumedFrom), maxTurns: 1000 } }, spec.meta);
    void this.consume();
  }

  get busy(): boolean {
    return this.turns.pending > 0;
  }

  /** Corre un turno (espera su lugar en la cola de la sesión). */
  turn(text: string, sink: TurnSink, signal?: AbortSignal): Promise<LiveTurnOutcome> {
    return this.turns.run(
      () =>
        new Promise<LiveTurnOutcome>((resolve) => {
          if (this.closed) return resolve("failed");
          if (signal?.aborted) return resolve("aborted");
          this.lastUsed = Date.now();
          const pending: PendingTurn = { sink, resolve, aborted: false };
          this.current = pending;
          if (this.sdkSessionId) sink.announce(this.sdkSessionId);
          const onAbort = () => {
            pending.aborted = true;
            // El turno se corta; su `result` (error_during_execution) lo cierra y la sesión sigue.
            void this.q.interrupt().catch(() => undefined);
          };
          signal?.addEventListener("abort", onAbort, { once: true });
          const done = (outcome: LiveTurnOutcome) => {
            signal?.removeEventListener("abort", onAbort);
            this.lastUsed = Date.now();
            resolve(outcome);
          };
          pending.resolve = done;
          this.inbox.push({ type: "user", message: { role: "user", content: text }, parent_tool_use_id: null } as SDKUserMessage);
          this.wake?.();
        }),
    );
  }

  private async consume(): Promise<void> {
    try {
      for await (const m of this.q) {
        const msg = m as Record<string, any>;
        if (msg.type === "system" && msg.subtype === "init" && typeof msg.session_id === "string") this.sdkSessionId = msg.session_id;
        const cur = this.current;
        if (!cur) continue;
        if (cur.sink.handle(m)) {
          this.current = null;
          cur.resolve(cur.aborted ? "aborted" : msg.subtype === "success" ? "ok" : "failed");
        }
      }
    } catch (err) {
      if (!this.closed) console.error("[chat] sesión viva:", String(err).slice(0, 200));
    } finally {
      this.shutdown();
    }
  }

  private shutdown(): void {
    const cur = this.current;
    this.current = null;
    if (!this.closed) {
      this.closed = true;
      this.onClose(this);
    }
    cur?.resolve(cur.aborted ? "aborted" : "failed");
    this.wake?.();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.q.close();
    } catch {
      /* ya cerrada */
    }
    this.wake?.();
    this.onClose(this);
  }
}

const live = new Map<string, LiveChatSession>();

function forget(s: LiveChatSession): void {
  if (live.get(s.key) === s) live.delete(s.key);
}

function evict(incoming: number): void {
  const now = Date.now();
  const keys = pickEvictions(
    [...live.values()].map((s) => ({ key: s.key, lastUsed: s.lastUsed, busy: s.busy })),
    now,
    { incoming },
  );
  for (const key of keys) live.get(key)?.close();
}

/** Barrido de las que llevan 10 min sin uso (no mantiene vivo al proceso). */
setInterval(() => evict(0), Math.min(60_000, CHAT_SESSION_IDLE_MS)).unref();
// Al cerrar el agente, sus procesos del CLI se cierran con él.
process.once("exit", () => closeAllChatSessions());

export function closeAllChatSessions(): void {
  for (const s of [...live.values()]) s.close();
}

/** Lo que hay vivo (para diagnóstico). */
export function liveChatSessions(): { clientId: string; sdkSessionId?: string; idleMs: number; busy: boolean }[] {
  const now = Date.now();
  return [...live.values()].map((s) => ({ clientId: s.clientId, sdkSessionId: s.sdkSessionId, idleMs: now - s.lastUsed, busy: s.busy }));
}

/**
 * Corre un turno del chat en la sesión viva del cliente (la crea o la recicla
 * si cambiaron las condiciones o la conversación pedida).
 */
export async function runLiveChatTurn(spec: LiveChatSpec, text: string, sink: TurnSink, signal?: AbortSignal): Promise<LiveTurnOutcome> {
  const key = chatSessionKey(spec);
  let session = live.get(key);
  if (session && (session.closed || (!session.busy && !liveMatchesResume(session, spec.resume, spec.fresh)))) {
    session.close();
    session = undefined;
  }
  if (!session) {
    // Otra sesión del MISMO cliente con condiciones viejas (otro proyecto,
    // modelo o candado): se recicla, no conviven dos hilos del mismo tab.
    for (const s of [...live.values()]) if (s.clientId === spec.clientId && !s.busy) s.close();
    evict(1);
    try {
      session = new LiveChatSession(key, spec, forget);
    } catch (err) {
      console.error("[chat] no se pudo abrir la sesión viva:", String(err).slice(0, 200));
      return "failed";
    }
    live.set(key, session);
  }
  return session.turn(text, sink, signal);
}
