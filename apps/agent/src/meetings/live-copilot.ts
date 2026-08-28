/**
 * Capa RÁPIDA del copiloto de juntas (estilo LockedIn AI): detecta preguntas
 * en el transcript streaming y sugiere qué responder en ~2-5 s, streameando
 * la respuesta al front token a token (suggestion_delta).
 *
 * Motor: UNA sesión persistente del Agent SDK por junta (streaming input) —
 * corre con la suscripción de Claude Code, sin API key ni costo por token.
 * El proceso CLI queda vivo toda la junta: se paga el arranque una sola vez
 * (warm-up) en lugar del spawn-por-tanda del loop estratégico de live.ts.
 *
 * Decisiones:
 * - Sin tools ni parsing: la respuesta es texto plano (kind fijo "decir").
 *   El loop estratégico conserva el RAG fresco y los kinds dato/rumbo/preguntar.
 * - Trigger 100% local (detectQuestion): un clasificador LLM sumaría ~1 s y el
 *   costo de un falso positivo es solo un turno corto de Haiku.
 * - Un trigger nuevo con respuesta en vuelo la interrumpe: la pregunta más
 *   reciente siempre gana. El interrupt se serializa ANTES del push siguiente
 *   para que ningún delta huérfano se atribuya a la respuesta nueva.
 * - "—" es la señal de silencio del modelo: live.ts la descarta sin tarjeta.
 * - HERMES_COPILOT=fake responde enlatado en ~400 ms (e2e sin gastar);
 *   "off" desactiva la capa y todo queda como antes.
 */
import { query, type Query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { LiveSuggestionLang } from "@hermes/shared";
import { env } from "../env.js";
import type { NormalizedTurn } from "./live-stt.js";
import { OWNER } from "../owner.js";

// ── Cadencia y umbrales del gatillo ────────────────────────────────────

const FAST_MIN_INTERVAL_MS = 4_000; // debounce global entre triggers automáticos
const SOFT_MIN_INTERVAL_MS = 30_000; // el soplo "suave" (sin pregunta) es raro a propósito
const SOFT_MIN_NEW_CHARS = 200;
const EARLY_MIN_CHARS = 15; // end_of_turn crudo demasiado corto = ruido
const TURN_TIMEOUT_MS = 20_000; // una respuesta que llega tarde ya no es una respuesta
const DELTA_COALESCE_MS = 60; // no inundar el WS/React con deltas token a token
const WINDOW_CHARS = 1_600; // ventana por push (la historia de la sesión ya vio el resto)

// ── Detección local de preguntas (pura, unit-testeable) ────────────────

// Arranques interrogativos. El end_of_turn crudo de AAI llega sin puntuación,
// así que el gatillo temprano depende de estas keywords al inicio del turno.
const ES_LEAD =
  /^(?:y |pero |entonces |bueno |oye |a ver |ok |okey |listo )?¿?(?:qué|que|cómo|como|por qué|porqué|cuál(?:es)?|cual(?:es)?|quién(?:es)?|quien(?:es)?|cuándo|cuando|dónde|donde|cuánt[oa]s?|cuant[oa]s?|podrías?|podrias?|puedes|podemos|cuéntame|cuentame|explíca(?:me|nos)?|explica(?:me|nos)?|háblame|hablame|dime|me puedes|nos puedes|te parece|crees que|consideras)\b/i;
const EN_LEAD =
  /^(?:so |and |ok |okay |well |now |but )?(?:what|what's|how|why|when|which|who|where|could you|can you|would you|will you|do you|did you|does|have you|are you|is there|tell me|walk me through|talk me through|describe|explain)\b/i;

/** Heurística barata de idioma para elegir el idioma de la respuesta. */
export function guessLang(text: string): "es" | "en" {
  const t = ` ${text.toLowerCase()} `;
  let es = 0;
  let en = 0;
  for (const w of [" el ", " la ", " de ", " que ", " y ", " en ", " los ", " para ", " con ", " qué ", " cómo ", " tienes "])
    if (t.includes(w)) es += 1;
  for (const w of [" the ", " and ", " you ", " your ", " what ", " how ", " is ", " are ", " to ", " of ", " with ", " do "])
    if (t.includes(w)) en += 1;
  return en > es ? "en" : "es";
}

/** Última oración interrogativa de un texto final formateado (con "?"). */
export function lastQuestion(text: string): string | null {
  const matches = text.match(/[^.!?]*\?/g);
  if (!matches) return null;
  const q = matches[matches.length - 1].trim().replace(/^[,;:]+\s*/, "");
  return q.length >= 8 ? q : null;
}

/** ¿Este turno tiene pinta de pregunta? (para el gatillo temprano sin puntuación). */
export function detectQuestion(text: string): { hit: boolean; lang: "es" | "en" | null } {
  const t = text.trim();
  if (!t) return { hit: false, lang: null };
  if (t.includes("?")) return { hit: true, lang: guessLang(lastQuestion(t) ?? t) };
  if (ES_LEAD.test(t)) return { hit: true, lang: "es" };
  if (EN_LEAD.test(t)) return { hit: true, lang: "en" };
  return { hit: false, lang: null };
}

// ── Modos de coaching ──────────────────────────────────────────────────
// Hook para modos futuros (p.ej. "entrevista" con formato STAR): cada modo
// puede extender el prompt de la capa rápida y/o el del loop estratégico.
// Solo "junta" existe hoy (sin overrides = comportamiento base).

export const COACH_MODES: Record<string, { fastExtra?: string; deepExtra?: string }> = {
  junta: {},
};

export function resolveCoachMode(mode: string | undefined): string {
  return mode && COACH_MODES[mode] ? mode : "junta";
}

// ── Interfaz pública ───────────────────────────────────────────────────

export type FastCopilotEvent =
  | { type: "start"; id: string; trigger: string }
  | { type: "delta"; id: string; text: string }
  | { type: "done"; id: string; text: string; trigger: string; manual: boolean; elapsedMs: number }
  | { type: "aborted"; id: string }
  | { type: "error"; message: string };

export interface FastCopilotDeps {
  /** System prompt ESTÁTICO (briefing/knowledge congelados al start de la junta). */
  systemStatic: string;
  /** Ventana reciente del transcript (finales + parcial actual, con nombres). */
  getWindow(): string;
  onEvent(ev: FastCopilotEvent): void;
}

export interface FastCopilot {
  /** Alimentar cada turno del STT (parciales incluidos: el gatillo temprano vive ahí). */
  onTurn(turn: NormalizedTurn, selfSpeaker: string | undefined): void;
  /** Botón "Soplar ahora": sin debounce, el manual siempre gana. */
  triggerNow(reason?: string): void;
  destroy(): void;
}

/** null = capa rápida desactivada (HERMES_COPILOT=off); live.ts sigue como hoy. */
export function createFastCopilot(deps: FastCopilotDeps): FastCopilot | null {
  if (env.COPILOT_PROVIDER === "off") return null;
  const engine: FastEngine =
    env.COPILOT_PROVIDER === "fake"
      ? new FakeFastEngine(deps.onEvent)
      : new SdkFastEngine(deps.systemStatic, deps.onEvent);
  return new FastCopilotController(engine, deps);
}

/** System prompt estático de la capa rápida (se construye UNA vez por junta). */
export function buildFastSystemPrompt(p: {
  slug: string;
  name?: string;
  briefing?: string;
  estadoActual?: string;
  knowledge?: string;
  suggestionLang: LiveSuggestionLang;
  /** Key de COACH_MODES (default "junta"). */
  coachMode?: string;
}): string {
  const langRule =
    p.suggestionLang === "es"
      ? "Responde SIEMPRE en español."
      : p.suggestionLang === "en"
        ? `Responde SIEMPRE en inglés (${OWNER} está practicando su inglés hablado).`
        : `Responde en el idioma de la pregunta: pregunta en inglés → respuesta en inglés (${OWNER} practica inglés hablado), pregunta en español → respuesta en español.`;
  const parts = [
    `# Hermes — respuesta rápida en junta EN VIVO

Eres el apuntador de **${OWNER}** (dev senior) en una junta del proyecto **${p.name ?? p.slug}** (\`${p.slug}\`). En cada mensaje te llega la ventana reciente del transcript y el momento que requiere respuesta (casi siempre una pregunta que le acaban de hacer a ${OWNER}). Tu ÚNICO trabajo: darle la respuesta que él debería decir AHORA, en voz alta, tal cual.

## Reglas
- Máximo 3 frases habladas. Sin markdown, sin listas, sin preámbulos ("podrías decir…"), sin comillas: SOLO las palabras que ${OWNER} diría, en primera persona.
- ${langRule}
- No inventes datos: cifras, fechas y decisiones solo si salen del contexto de abajo o del transcript.
- Si el momento NO amerita soplo (charla trivial, la pregunta no era para ${OWNER}, ya la respondió), responde EXACTAMENTE: —
- Velocidad sobre perfección: una buena respuesta ya es mejor que una perfecta tarde.`,
  ];
  const modeExtra = COACH_MODES[resolveCoachMode(p.coachMode)]?.fastExtra;
  if (modeExtra) parts.push(modeExtra);
  if (p.briefing?.trim()) parts.push(`## Briefing del proyecto\n${p.briefing.trim()}`);
  if (p.estadoActual?.trim()) parts.push(`## Estado actual\n${p.estadoActual.slice(0, 800)}`);
  if (p.knowledge?.trim())
    parts.push(`## Conocimiento del historial de Hermes\n${p.knowledge.trim()}`);
  return parts.join("\n\n");
}

// ── Controller: reglas de disparo ──────────────────────────────────────

interface FastGenRequest {
  id: string;
  trigger: string;
  manual: boolean;
  prompt: string;
}

interface FastEngine {
  generate(req: FastGenRequest): void;
  destroy(): void;
}

class FastCopilotController implements FastCopilot {
  private lastTriggerAt = 0;
  private charsSinceTrigger = 0;
  /** keys que ya dispararon (el final formateado no re-dispara al gatillo temprano). */
  private readonly firedKeys = new Set<string>();
  /** keys ya contadas en charsSinceTrigger (los finales no se re-suman). */
  private readonly countedKeys = new Set<string>();
  private seq = 0;

  constructor(
    private readonly engine: FastEngine,
    private readonly deps: FastCopilotDeps,
  ) {}

  onTurn(turn: NormalizedTurn, selfSpeaker: string | undefined): void {
    const text = turn.text.trim();
    if (!text) return;
    // Nunca sobre habla propia (antes de marcar "soy yo", cualquier pregunta
    // dispara — en entrevistas el dueño es el entrevistado y funciona bien).
    if (selfSpeaker && turn.speaker === selfSpeaker) return;
    if (turn.final && !this.countedKeys.has(turn.key)) {
      this.countedKeys.add(turn.key);
      this.charsSinceTrigger += text.length;
    }
    if (this.firedKeys.has(turn.key)) return;

    const since = Date.now() - this.lastTriggerAt;

    // 1) Final formateado con "?": pregunta directa.
    if (turn.final && text.includes("?")) {
      if (since < FAST_MIN_INTERVAL_MS) return;
      const q = lastQuestion(text) ?? text.slice(-160);
      this.fire(turn.key, q, q, false);
      return;
    }
    // 2) end_of_turn crudo (aún sin puntuación) con pinta de pregunta: gatillo
    //    temprano — gana ~300-800 ms sobre el final formateado.
    if (!turn.final && turn.endOfTurn && text.length >= EARLY_MIN_CHARS) {
      if (since < FAST_MIN_INTERVAL_MS) return;
      if (detectQuestion(text).hit) {
        const q = text.slice(-160);
        this.fire(turn.key, q, q, false);
        return;
      }
    }
    // 3) Bloque largo sin pregunta: soplo suave, raro a propósito.
    if (turn.final && this.charsSinceTrigger >= SOFT_MIN_NEW_CHARS && since >= SOFT_MIN_INTERVAL_MS) {
      this.fire(turn.key, "punto planteado por el interlocutor", null, false);
    }
  }

  triggerNow(reason = "pedida a mano"): void {
    this.fire(`manual-${this.seq}`, reason, null, true);
  }

  destroy(): void {
    this.engine.destroy();
  }

  private fire(key: string, trigger: string, question: string | null, manual: boolean): void {
    this.firedKeys.add(key);
    this.lastTriggerAt = Date.now();
    this.charsSinceTrigger = 0;
    this.seq += 1;
    const id = `fast-${this.seq}`;
    const windowText = this.deps.getWindow().slice(-WINDOW_CHARS);
    const ask = manual
      ? `${OWNER} pidió apoyo AHORA para este momento exacto de la conversación.`
      : question
        ? `Pregunta que le acaban de hacer a ${OWNER}: "${question}"`
        : `Acaban de plantear un punto que puede requerir la respuesta de ${OWNER}.`;
    const prompt = `Transcript reciente (el final es lo que se está diciendo ahora):
"""
${windowText}
"""

${ask}

La respuesta que ${OWNER} debería decir AHORA (o "—" si no amerita):`;
    this.engine.generate({ id, trigger, manual, prompt });
  }
}

// ── Motor real: sesión persistente del Agent SDK ───────────────────────

/**
 * Un turno de la sesión persistente. La correlación mensaje→respuesta es un
 * FIFO estricto (verificado empíricamente contra el SDK 0.3.198): cada user
 * message yieldeado produce EXACTAMENTE un `result` (success, o
 * error_during_execution si se interrumpió — aun sin mensaje assistant), y
 * los deltas/assistant entre dos results pertenecen al turno más viejo sin
 * cerrar. `yielded[0]` es siempre el dueño de lo que está llegando.
 */
interface TurnOwner {
  req: FastGenRequest;
  /** true = warm-up: ocupa turno (correlación FIFO) pero no emite eventos. */
  silent: boolean;
  /** Ya entregado al CLI (los no-yieldeados se cancelan quitándolos de la cola). */
  yielded: boolean;
  /** Cancelado (abort/timeout): su output restante se descarta. */
  cancelled: boolean;
  /** Ya emitió done (o aborted): no volver a emitir en el result. */
  settled: boolean;
  buf: string;
  pending: string;
  startedAt: number;
  timer: NodeJS.Timeout | null;
  flush: NodeJS.Timeout | null;
}

class SdkFastEngine implements FastEngine {
  private q: Query | null = null;
  /** Cola de turnos aún NO entregados al CLI. */
  private queue: TurnOwner[] = [];
  /** FIFO de turnos ya entregados; se desplaza con cada `result`. */
  private yielded: TurnOwner[] = [];
  /** El request cuya respuesta espera la UI (los demás se descartan). */
  private active: TurnOwner | null = null;
  private wake: (() => void) | null = null;
  private closed = false;

  constructor(
    private readonly systemStatic: string,
    private readonly onEvent: (ev: FastCopilotEvent) => void,
  ) {
    this.ensureSession();
    // Warm-up: paga el arranque del proceso CLI antes del primer trigger real.
    this.enqueue(
      { id: "warmup", trigger: "warmup", manual: false, prompt: 'Junta iniciada. Responde únicamente "OK".' },
      true,
    );
  }

  generate(req: FastGenRequest): void {
    this.enqueue(req, false);
  }

  private enqueue(req: FastGenRequest, silent: boolean): void {
    if (this.closed) return;
    this.cancelActive(); // la pregunta nueva pisa a la anterior
    const owner: TurnOwner = {
      req,
      silent,
      yielded: false,
      cancelled: false,
      settled: false,
      buf: "",
      pending: "",
      startedAt: Date.now(),
      timer: null,
      flush: null,
    };
    owner.timer = setTimeout(() => this.cancelOwner(owner), TURN_TIMEOUT_MS);
    this.active = owner;
    this.queue.push(owner);
    if (!silent) this.onEvent({ type: "start", id: req.id, trigger: req.trigger });
    this.ensureSession(); // recrea la sesión si murió (best-effort)
    this.wake?.();
  }

  /** Cancela el turno que la UI esperaba (pisado por un trigger nuevo). */
  private cancelActive(): void {
    if (this.active) this.cancelOwner(this.active);
  }

  private cancelOwner(owner: TurnOwner): void {
    if (owner.cancelled || owner.settled) return;
    owner.cancelled = true;
    this.clearTimers(owner);
    if (!owner.yielded) {
      // Nunca llegó al CLI: basta sacarlo de la cola (no gasta turno).
      this.queue = this.queue.filter((o) => o !== owner);
      owner.settled = true;
    } else {
      // En vuelo: el interrupt lo corta; su `result` (error_during_execution)
      // desplaza el FIFO solo — no hay que esperar nada antes del siguiente push.
      void this.q?.interrupt().catch(() => undefined);
    }
    if (!owner.silent) this.onEvent({ type: "aborted", id: owner.req.id });
    if (this.active === owner) this.active = null;
  }

  destroy(): void {
    if (this.closed) return;
    this.closed = true;
    for (const o of [...this.queue, ...this.yielded]) this.clearTimers(o);
    this.queue = [];
    this.active = null;
    // Cerrar el generator termina la sesión; el interrupt corta el turno en vuelo.
    void this.q?.interrupt().catch(() => undefined);
    this.wake?.();
    this.wake = null;
    this.q = null;
  }

  // ── Sesión ──

  private ensureSession(): void {
    if (this.q || this.closed) return;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    async function* input(): AsyncGenerator<SDKUserMessage> {
      while (!self.closed) {
        const owner = self.queue.shift();
        if (owner) {
          if (owner.cancelled) continue; // lo pisaron antes de salir de la cola
          owner.yielded = true;
          self.yielded.push(owner);
          yield {
            type: "user",
            message: { role: "user", content: owner.req.prompt },
            parent_tool_use_id: null,
          } as SDKUserMessage;
          continue;
        }
        await new Promise<void>((resolve) => {
          self.wake = resolve;
        });
        self.wake = null;
      }
    }
    const q = query({
      prompt: input(),
      options: {
        cwd: env.VAULT_PATH || process.cwd(),
        systemPrompt: this.systemStatic,
        model: env.COPILOT_MODEL,
        includePartialMessages: true,
        thinking: { type: "disabled" }, // mínima latencia: aquí manda el TTFT
        maxTurns: 1000, // toda la junta vive en UNA sesión
        settingSources: [],
        tools: [], // sin tools: texto plano directo, sin round-trips
        permissionMode: "default",
      },
    });
    this.q = q;
    void this.consume(q);
  }

  private async consume(q: Query): Promise<void> {
    try {
      for await (const msg of q) {
        if (this.closed) break;
        if (msg.type === "stream_event") {
          const ev = msg.event as {
            type?: string;
            delta?: { type?: string; text?: string };
          };
          if (ev?.type === "content_block_delta" && ev.delta?.type === "text_delta" && ev.delta.text)
            this.onDelta(ev.delta.text);
        } else if (msg.type === "assistant") {
          const content = (msg as { message?: { content?: unknown } }).message?.content;
          const text = Array.isArray(content)
            ? content
                .filter(
                  (b): b is { type: "text"; text: string } =>
                    (b as { type?: string }).type === "text",
                )
                .map((b) => b.text)
                .join("")
            : "";
          this.finalize(text);
        } else if (msg.type === "result") {
          const r = msg as { subtype?: string; ttft_ms?: number; duration_ms?: number };
          if (r.ttft_ms != null)
            console.log(`[copilot] ttft=${r.ttft_ms}ms total=${r.duration_ms ?? "?"}ms`);
          // El result CIERRA el turno más viejo — incluso interrumpido sin
          // mensaje assistant (subtype error_during_execution).
          const owner = this.yielded.shift();
          if (owner && !owner.settled && !owner.cancelled) {
            // Turno cerrado sin assistant (raro): lo que haya en buf o abort.
            owner.settled = true;
            this.clearTimers(owner);
            if (this.active === owner) this.active = null;
            if (!owner.silent) {
              const text = owner.buf.trim();
              if (text)
                this.onEvent({
                  type: "done",
                  id: owner.req.id,
                  text,
                  trigger: owner.req.trigger,
                  manual: owner.req.manual,
                  elapsedMs: Date.now() - owner.startedAt,
                });
              else this.onEvent({ type: "aborted", id: owner.req.id });
            }
          }
        }
      }
    } catch (err) {
      if (!this.closed)
        this.onEvent({ type: "error", message: `copiloto rápido: ${String(err).slice(0, 160)}` });
    } finally {
      if (this.q === q) this.q = null; // el próximo trigger recrea la sesión
      // Turnos que murieron con la sesión: notificar para limpiar la UI.
      if (!this.closed) {
        for (const owner of this.yielded.splice(0)) {
          if (!owner.settled && !owner.silent) this.onEvent({ type: "aborted", id: owner.req.id });
          owner.settled = true;
          this.clearTimers(owner);
          if (this.active === owner) this.active = null;
        }
      }
    }
  }

  // ── Atribución por FIFO: yielded[0] es el dueño de lo que llega ──

  private onDelta(text: string): void {
    const owner = this.yielded[0];
    if (!owner || owner.cancelled || owner.settled) return;
    owner.buf += text;
    if (owner.silent || owner !== this.active) return; // warm-up o turno pisado
    owner.pending += text;
    if (!owner.flush) {
      owner.flush = setTimeout(() => {
        owner.flush = null;
        if (owner.cancelled || owner.settled || !owner.pending) return;
        const chunk = owner.pending;
        owner.pending = "";
        this.onEvent({ type: "delta", id: owner.req.id, text: chunk });
      }, DELTA_COALESCE_MS);
    }
  }

  private finalize(text: string): void {
    const owner = this.yielded[0];
    if (!owner || owner.cancelled || owner.settled) return;
    owner.settled = true;
    this.clearTimers(owner);
    if (this.active === owner) this.active = null;
    if (owner.silent) return; // warm-up completado: listo, sin eventos
    // Haiku a veces genera la respuesta entera dentro de la ventana de
    // coalescing: flushear lo pendiente como delta garantiza ≥1 delta por
    // sugerencia (la UI ve el streaming aunque haya sido de un solo golpe).
    if (owner.pending) {
      this.onEvent({ type: "delta", id: owner.req.id, text: owner.pending });
      owner.pending = "";
    }
    this.onEvent({
      type: "done",
      id: owner.req.id,
      text: (text || owner.buf).trim(),
      trigger: owner.req.trigger,
      manual: owner.req.manual,
      elapsedMs: Date.now() - owner.startedAt,
    });
  }

  private clearTimers(owner: TurnOwner): void {
    if (owner.timer) clearTimeout(owner.timer);
    owner.timer = null;
    if (owner.flush) clearTimeout(owner.flush);
    owner.flush = null;
  }
}

// ── Motor fake: e2e sin gastar (HERMES_COPILOT=fake) ───────────────────

const FAKE_ANSWER =
  "Claro, tengo experiencia directa con eso: en Hermes construí el pipeline de streaming con reconexión y buffer acotado. Puedo detallar la arquitectura y los trade-offs si les sirve.";

class FakeFastEngine implements FastEngine {
  private timers: NodeJS.Timeout[] = [];
  private currentId: string | null = null;

  constructor(private readonly onEvent: (ev: FastCopilotEvent) => void) {}

  generate(req: FastGenRequest): void {
    if (this.currentId) {
      this.onEvent({ type: "aborted", id: this.currentId });
      this.clear();
    }
    this.currentId = req.id;
    const startedAt = Date.now();
    const half = Math.ceil(FAKE_ANSWER.length / 2);
    this.onEvent({ type: "start", id: req.id, trigger: req.trigger });
    this.timers = [
      setTimeout(() => this.onEvent({ type: "delta", id: req.id, text: FAKE_ANSWER.slice(0, half) }), 150),
      setTimeout(() => this.onEvent({ type: "delta", id: req.id, text: FAKE_ANSWER.slice(half) }), 300),
      setTimeout(() => {
        this.currentId = null;
        this.onEvent({
          type: "done",
          id: req.id,
          text: FAKE_ANSWER,
          trigger: req.trigger,
          manual: req.manual,
          elapsedMs: Date.now() - startedAt,
        });
      }, 400),
    ];
  }

  destroy(): void {
    this.clear();
    this.currentId = null;
  }

  private clear(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }
}
