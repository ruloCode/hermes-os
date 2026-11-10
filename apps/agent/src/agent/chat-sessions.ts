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
 *  - Si el cliente pide OTRA conversación (o una nueva), la sesión viva se
 *    reemplaza aunque esté respondiendo: su cola termina y se cierra, y el
 *    mensaje nuevo nunca entra en ella. Si la nueva retoma la MISMA
 *    conversación SDK que una que se está cerrando, espera a que esa termine:
 *    dos procesos sobre el mismo hilo lo bifurcan.
 *  - 10 min sin uso → se cierra; máximo 3 vivas (sale la menos usada).
 *  - Un turno a la vez por sesión: el que llega mientras otro corre espera.
 *  - Detener = interrupt() del turno: lo dicho vale y la sesión sigue viva.
 *    Si el `result` no llega en 12 s, la sesión se da por colgada y se cierra;
 *    ningún turno dura más de 10 min.
 *  - Un turno que falla cierra la sesión ANTES de que quien llama reintente
 *    de una vuelta con `resume` (si no, dos procesos sobre el mismo hilo).
 *
 * Solo el chat usa esto: tareas, programadas y el resto siguen de una vuelta.
 */
import type { Options, Query, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { trackedQuery, type TrackMeta } from "./tracked-query.js";
import { ABORT_GRACE_MS, CHAT_SESSION_IDLE_MS, TURN_MAX_MS, TurnQueue, chatSessionKey, pickEvictions, reuseDecision } from "./chat-session-policy.js";

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

type QueryFactory = (input: AsyncIterable<SDKUserMessage>, options: Options, meta: TrackMeta) => Query;

/** Una línea del registro de gasto por turno (trackedQuery mide la entrada en streaming). */
const realFactory: QueryFactory = (input, options, meta) => trackedQuery("chat", { prompt: input, options }, meta);
let makeQuery: QueryFactory = realFactory;

/** Solo para tests: un Query falso en lugar del CLI. null = el real. */
export function setLiveChatQueryFactory(factory: QueryFactory | null): void {
  makeQuery = factory ?? realFactory;
}

/** Tiempos de corte (los tests los acortan). */
export const liveChatTiming = { abortGraceMs: ABORT_GRACE_MS, turnMaxMs: TURN_MAX_MS };

interface PendingTurn {
  sink: TurnSink;
  aborted: boolean;
  settle(outcome: LiveTurnOutcome): void;
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
    // Las opciones son las del turno de una vuelta tal cual (maxTurns incluido:
    // en streaming el CLI lo cuenta por mensaje, ver CHAT_MAX_TURNS).
    this.q = makeQuery(input(), spec.options(this.resumedFrom), spec.meta);
    void this.consume();
  }

  get busy(): boolean {
    return this.turns.pending > 0;
  }

  /** Lleva (o retomó) esa conversación SDK. */
  carries(conversation: string | undefined): boolean {
    return Boolean(conversation) && (conversation === this.sdkSessionId || conversation === this.resumedFrom);
  }

  /** Corre un turno (espera su lugar en la cola de la sesión). */
  turn(text: string, sink: TurnSink, signal?: AbortSignal): Promise<LiveTurnOutcome> {
    return this.turns.run(
      () =>
        new Promise<LiveTurnOutcome>((resolve) => {
          if (this.closed) return resolve("failed");
          if (signal?.aborted) return resolve("aborted");
          this.lastUsed = Date.now();
          let graceTimer: NodeJS.Timeout | null = null;
          // Tope duro: un CLI colgado no puede tomar la cola del cliente para siempre.
          const maxTimer = setTimeout(() => {
            console.warn("[chat] un turno pasó el tope de duración: se cierra la sesión viva");
            this.close();
          }, liveChatTiming.turnMaxMs);
          const onAbort = () => {
            pending.aborted = true;
            // El turno se corta; su `result` (error_during_execution) lo cierra y la sesión sigue.
            void this.q.interrupt().catch(() => undefined);
            // Si el CLI no contesta al interrupt, la sesión está colgada: se cierra.
            graceTimer = setTimeout(() => {
              console.warn("[chat] el turno detenido no cerró a tiempo: se cierra la sesión viva");
              this.close();
            }, liveChatTiming.abortGraceMs);
          };
          let settled = false;
          const pending: PendingTurn = {
            sink,
            aborted: false,
            settle: (outcome) => {
              if (settled) return;
              settled = true;
              clearTimeout(maxTimer);
              if (graceTimer) clearTimeout(graceTimer);
              signal?.removeEventListener("abort", onAbort);
              if (this.current === pending) this.current = null;
              this.lastUsed = Date.now();
              resolve(outcome);
            },
          };
          this.current = pending;
          signal?.addEventListener("abort", onAbort, { once: true });
          if (this.sdkSessionId) sink.announce(this.sdkSessionId);
          this.inbox.push({ type: "user", message: { role: "user", content: text }, parent_tool_use_id: null } as SDKUserMessage);
          this.wake?.();
        }),
    );
  }

  /** Cuando termine lo que ya está en su cola. */
  drained(): Promise<void> {
    return this.turns.run(async () => undefined);
  }

  private async consume(): Promise<void> {
    try {
      for await (const m of this.q) {
        const msg = m as Record<string, any>;
        if (msg.type === "system" && msg.subtype === "init" && typeof msg.session_id === "string") this.sdkSessionId = msg.session_id;
        const cur = this.current;
        if (!cur) continue;
        if (cur.sink.handle(m)) cur.settle(cur.aborted ? "aborted" : msg.subtype === "success" ? "ok" : "failed");
      }
    } catch (err) {
      if (!this.closed) console.error("[chat] sesión viva:", String(err).slice(0, 200));
    } finally {
      this.close();
    }
  }

  close(): void {
    const cur = this.current;
    if (!this.closed) {
      this.closed = true;
      try {
        this.q.close();
      } catch {
        /* ya cerrada */
      }
      this.wake?.();
      this.onClose(this);
    }
    // El turno en curso no se queda esperando un `result` que ya no va a llegar.
    cur?.settle(cur.aborted ? "aborted" : "failed");
  }
}

const live = new Map<string, LiveChatSession>();
/** Sesiones reemplazadas que todavía terminan su cola antes de cerrarse. */
const retiring = new Set<LiveChatSession>();

function forget(s: LiveChatSession): void {
  if (live.get(s.key) === s) live.delete(s.key);
  retiring.delete(s);
}

/** La saca del mapa ya (nada nuevo entra en ella) y la cierra cuando su cola termina. */
function retire(s: LiveChatSession): void {
  if (live.get(s.key) === s) live.delete(s.key);
  if (s.closed) return;
  retiring.add(s);
  void s.drained().then(() => s.close());
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
  for (const s of [...live.values(), ...retiring]) s.close();
}

/** Lo que hay vivo (para diagnóstico y tests). */
export function liveChatSessions(): { clientId: string; sdkSessionId?: string; idleMs: number; busy: boolean }[] {
  const now = Date.now();
  return [...live.values()].map((s) => ({ clientId: s.clientId, sdkSessionId: s.sdkSessionId, idleMs: now - s.lastUsed, busy: s.busy }));
}

/**
 * Corre un turno del chat en la sesión viva del cliente (la crea o la
 * reemplaza si cambiaron las condiciones o la conversación pedida).
 */
export async function runLiveChatTurn(spec: LiveChatSpec, text: string, sink: TurnSink, signal?: AbortSignal): Promise<LiveTurnOutcome> {
  const key = chatSessionKey(spec);
  let session = live.get(key);
  const decision = reuseDecision(session, spec.resume, spec.fresh);
  if (decision !== "reuse") {
    if (session) retire(session);
    session = undefined;
    // Otras sesiones del MISMO cliente con condiciones viejas (otro proyecto,
    // modelo o candado): se reemplazan, no conviven dos hilos del mismo tab.
    for (const s of [...live.values()]) if (s.clientId === spec.clientId) retire(s);
    // La conversación que se va a retomar no puede seguir abierta en otro
    // proceso: se espera a que la sesión que la lleva termine y se cierre.
    // Sin id pedido, la del cliente puede ser cualquiera de las suyas; una
    // conversación nueva no choca con ninguna.
    const holders = spec.fresh ? [] : [...retiring].filter((s) => s.clientId === spec.clientId && (!spec.resume || s.carries(spec.resume)));
    if (holders.length) await Promise.all(holders.map((s) => s.drained()));
    session = live.get(key);
    if (!session || reuseDecision(session, spec.resume, spec.fresh) !== "reuse") {
      evict(1);
      try {
        session = new LiveChatSession(key, spec, forget);
      } catch (err) {
        console.error("[chat] no se pudo abrir la sesión viva:", String(err).slice(0, 200));
        return "failed";
      }
      live.set(key, session);
    }
  }
  if (!session) return "failed";
  const s = session;
  const outcome = await s.turn(text, sink, signal);
  // Un turno fallido deja la sesión en estado incierto. Se cierra ANTES de
  // devolver: quien llama puede reintentar de una vuelta con `resume`, y con
  // esta sesión abierta serían dos procesos sobre el mismo hilo.
  if (outcome === "failed") s.close();
  return outcome;
}
