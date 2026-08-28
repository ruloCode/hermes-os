/**
 * STT streaming para las juntas EN VIVO. Dos proveedores detrás de una misma
 * interfaz: AssemblyAI Universal-Streaming v3 (español + diarización en
 * streaming) y un Fake que emite un guion por timers (e2e sin gastar un peso).
 *
 * Contrato AssemblyAI v3 (verificado contra la doc oficial):
 * - WS a wss://streaming.assemblyai.com/v3/ws, PCM16LE 16 kHz mono, header
 *   `Authorization: <key>` SIN "Bearer".
 * - Mensajes: Begin{expires_at} · Turn (parciales que crecen; con
 *   format_turns=true llegan DOS end_of_turn=true por turno — crudo y
 *   formateado — y el final REAL es solo `end_of_turn && turn_is_formatted`) ·
 *   SpeakerRevision (0-1 vez, tras Terminate) · Termination.
 * - Timestamps y turn_order se REINICIAN por conexión → cada conexión lleva un
 *   `epoch` (keys estables entre reconexiones) y un offset en ms derivado de
 *   los bytes de audio ya enviados (32 bytes = 1 ms a 16 kHz PCM16 mono).
 * - NO usamos voice_focus: aísla la voz principal y suprime el resto — lo
 *   contrario de lo que necesita una junta presencial con un solo mic.
 */
import WebSocket from "ws";
import type { LiveSttState } from "@hermes/shared";
import { env } from "../env.js";

// ── Interfaz de provider ───────────────────────────────────────────────

export interface NormalizedTurn {
  /** `${epoch}-${turn_order}` — estable incluso tras reconexión del provider. */
  key: string;
  /** "A".."J" | "UNKNOWN". */
  speaker: string;
  text: string;
  /** ms desde el inicio de la junta (offset de reconexiones ya aplicado). */
  startMs: number;
  endMs: number;
  /** end_of_turn && turn_is_formatted (el end_of_turn crudo es un parcial más). */
  final: boolean;
  /** end_of_turn CRUDO: llega ~300-800 ms antes que el final formateado — es el
   *  gatillo temprano de la capa rápida del copiloto (aún sin puntuación). */
  endOfTurn: boolean;
}

export interface LiveSttOptions {
  sampleRate: 16000;
  /** Bias de idioma (el modelo es multilingüe; esto solo inclina la balanza). */
  languageBias?: string[];
  /** Tope duro de hablantes del provider (default 6: headroom sobre lo típico). */
  maxSpeakers?: number;
  onTurn(turn: NormalizedTurn): void;
  onSpeakerRevision(changes: { turnKey: string; speaker: string }[]): void;
  onStatus(state: LiveSttState, detail?: string): void;
  /** fatal=true: el provider se rindió (reintentos agotados). La sesión sigue
   *  viva con lo ya transcrito — el stop→ingesta funciona igual. */
  onError(message: string, fatal: boolean): void;
}

export interface LiveSttConnection {
  sendAudio(chunk: Uint8Array): void;
  /** Cierre limpio: Terminate + drenar Turns in-flight y SpeakerRevision (~5s máx). */
  finish(): Promise<void>;
  /** Cierre duro sin drenar (cleanup de emergencia). */
  destroy(): void;
}

export interface LiveSttProvider {
  /** Va al frontmatter `stt` del .md ("assemblyai" | "fake"). */
  readonly name: string;
  start(opts: LiveSttOptions): Promise<LiveSttConnection>;
}

/** null si el provider elegido no tiene credenciales (el start responde 503). */
export function getLiveSttProvider(): LiveSttProvider | null {
  if (env.LIVE_STT_PROVIDER === "fake") return new FakeLiveSttProvider();
  if (!env.ASSEMBLYAI_API_KEY) return null;
  return new AssemblyAIProvider();
}

// ── AssemblyAI Universal-Streaming v3 ──────────────────────────────────

const AAI_URL = "wss://streaming.assemblyai.com/v3/ws";
const BYTES_PER_MS = 32; // 16 000 muestras/s × 2 bytes ÷ 1000
const GAP_BUFFER_CAP_BYTES = 30_000 * BYTES_PER_MS; // 30 s de audio durante un gap
const RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 4_000];
const ROTATE_MARGIN_MS = 60_000; // rotar 60 s antes del expires_at del Begin
const FINISH_TIMEOUT_MS = 5_000;
const REVISION_GRACE_MS = 400; // tras Termination: ventana para la SpeakerRevision

interface AaiWord {
  text: string;
  start: number;
  end: number;
  word_is_final: boolean;
  speaker?: string;
}

type AaiServerMessage =
  | { type: "Begin"; id: string; expires_at: number }
  | {
      type: "Turn";
      turn_order: number;
      turn_is_formatted: boolean;
      end_of_turn: boolean;
      transcript: string;
      speaker_label?: string | null;
      words?: AaiWord[];
    }
  | { type: "Termination"; audio_duration_seconds?: number }
  | {
      type: "SpeakerRevision";
      revisions?: { turn_order: number; speaker_label: string | null }[];
    };

class AssemblyAIConnection implements LiveSttConnection {
  private ws: WebSocket | null = null;
  /** nº de conexión: da keys estables aunque turn_order se reinicie al reconectar. */
  private epoch = 0;
  /** Audio enviado a conexiones ANTERIORES, en ms (base de los timestamps). */
  private connOffsetMs = 0;
  /** Bytes de audio realmente escritos a algún socket (fuente del offset). */
  private sentBytesTotal = 0;
  /** Audio acumulado durante un gap de reconexión/rotación (flush al reabrir). */
  private pending: Buffer[] = [];
  private pendingBytes = 0;
  private droppedInGap = false;
  private retries = 0;
  private rotateTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private chaosTimer: NodeJS.Timeout | null = null;
  private rotating = false;
  private finishing = false;
  private destroyed = false;
  private finishResolve: (() => void) | null = null;

  constructor(
    private readonly opts: LiveSttOptions,
    private readonly apiKey: string,
  ) {}

  /** Primera conexión: falla rápido (key inválida, red caída) antes de aceptar audio. */
  open(): Promise<void> {
    return this.connect();
  }

  private connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const params = new URLSearchParams({
        sample_rate: "16000",
        encoding: "pcm_s16le",
        format_turns: "true",
        speaker_labels: "true",
        max_speakers: String(this.opts.maxSpeakers ?? 6),
      });
      // Array JSON-encoded (así lo urlencodea la doc); válido para el modelo
      // default universal-3-5-pro — por eso NO mandamos speech_model.
      if (this.opts.languageBias?.length) {
        params.set("language_codes", JSON.stringify(this.opts.languageBias));
      }
      const ws = new WebSocket(`${AAI_URL}?${params.toString()}`, {
        headers: { Authorization: this.apiKey }, // sin "Bearer": así lo pide AAI
        // Sin esto un handshake colgado (red rara, proxy) deja la promesa de
        // connect() sin resolver para siempre — aplica también a reconexiones.
        handshakeTimeout: 10_000,
      });
      this.ws = ws;
      let opened = false;

      ws.on("open", () => {
        opened = true;
        this.epoch += 1;
        this.rotating = false;
        this.retries = 0;
        // Base de timestamps de ESTA conexión = todo el audio ya entregado antes.
        this.connOffsetMs = Math.round(this.sentBytesTotal / BYTES_PER_MS);
        this.flushPending();
        this.opts.onStatus("connected");
        // Chaos para pruebas de reconexión: mata el socket a los 30s (una vez).
        if (process.env.HERMES_LIVE_STT_CHAOS === "1" && this.epoch === 1) {
          this.chaosTimer = setTimeout(() => ws.terminate(), 30_000);
        }
        resolve();
      });
      ws.on("message", (data) => this.handleMessage(data));
      ws.on("error", (err) => {
        if (!opened) reject(err instanceof Error ? err : new Error(String(err)));
        // Tras abrir, el 'close' que sigue decide la reconexión.
      });
      ws.on("close", () => {
        if (this.ws !== ws) return; // socket viejo ya reemplazado
        if (!opened) {
          reject(new Error("AssemblyAI cerró la conexión antes de abrir"));
          return;
        }
        this.onSocketGone();
      });
    });
  }

  private onSocketGone(): void {
    this.clearTimer("rotate");
    this.ws = null;
    if (this.destroyed) return;
    if (this.finishing) {
      this.finishResolve?.();
      return;
    }
    // Rotación programada reconecta al instante; caída real usa backoff.
    this.scheduleReconnect(this.rotating ? 0 : undefined);
  }

  private scheduleReconnect(immediateDelay?: number): void {
    if (this.destroyed || this.finishing || this.reconnectTimer) return;
    if (immediateDelay === undefined && this.retries >= RECONNECT_DELAYS_MS.length) {
      // Rendidos: la sesión NO muere — queda lo transcrito y el stop ingesta igual.
      this.opts.onStatus("degraded", "STT caído; se conserva lo transcrito");
      this.opts.onError(
        `AssemblyAI no respondió tras ${RECONNECT_DELAYS_MS.length} reintentos`,
        true,
      );
      return;
    }
    const delay = immediateDelay ?? RECONNECT_DELAYS_MS[this.retries];
    if (immediateDelay === undefined) {
      this.retries += 1;
      this.opts.onStatus("reconnecting", `reintento ${this.retries}`);
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(() => this.scheduleReconnect());
    }, delay);
  }

  private flushPending(): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    for (const chunk of this.pending) {
      ws.send(chunk);
      this.sentBytesTotal += chunk.length;
    }
    this.pending = [];
    this.pendingBytes = 0;
    this.droppedInGap = false;
  }

  sendAudio(chunk: Uint8Array): void {
    if (this.destroyed || this.finishing) return;
    const ws = this.ws;
    if (ws && ws.readyState === WebSocket.OPEN && !this.rotating) {
      ws.send(chunk);
      this.sentBytesTotal += chunk.byteLength;
      return;
    }
    // Gap (reconexión/rotación): acumular hasta 30 s; después descartar lo
    // más viejo — hueco honesto en vez de audio desalineado.
    this.pending.push(Buffer.from(chunk)); // copia: el caller puede reusar el buffer
    this.pendingBytes += chunk.byteLength;
    while (this.pendingBytes > GAP_BUFFER_CAP_BYTES && this.pending.length) {
      const dropped = this.pending.shift()!;
      this.pendingBytes -= dropped.length;
      if (!this.droppedInGap) {
        this.droppedInGap = true;
        this.opts.onStatus("degraded", "gap de reconexión: se está perdiendo audio");
      }
    }
  }

  private handleMessage(raw: WebSocket.RawData): void {
    let msg: AaiServerMessage;
    try {
      msg = JSON.parse(raw.toString()) as AaiServerMessage;
    } catch {
      return;
    }
    if (msg.type === "Begin") {
      // Rotación proactiva 60 s antes de que la sesión de AAI expire: cierre
      // limpio + reconexión inmediata (el gap lo cubre el buffer de audio).
      this.clearTimer("rotate");
      const delay = msg.expires_at * 1000 - Date.now() - ROTATE_MARGIN_MS;
      if (delay > 0) this.rotateTimer = setTimeout(() => this.rotate(), delay);
    } else if (msg.type === "Turn") {
      this.handleTurn(msg);
    } else if (msg.type === "SpeakerRevision") {
      this.opts.onSpeakerRevision(
        (msg.revisions ?? []).map((r) => ({
          turnKey: `${this.epoch}-${r.turn_order}`,
          speaker: r.speaker_label ?? "UNKNOWN",
        })),
      );
    } else if (msg.type === "Termination") {
      if (this.finishing) {
        // Gracia corta: la SpeakerRevision puede llegar pegada a la Termination.
        setTimeout(() => this.finishResolve?.(), REVISION_GRACE_MS);
      } else {
        this.ws?.close(); // rotación: fin limpio → onSocketGone reconecta ya
      }
    }
  }

  private handleTurn(msg: Extract<AaiServerMessage, { type: "Turn" }>): void {
    const text = (msg.transcript ?? "").trim();
    if (!text) return; // parcial vacío o turno sin contenido: nada que pintar
    const words = msg.words ?? [];
    // Fallback si el Turn no trae words: la posición actual del audio enviado.
    const nowRel = Math.max(Math.round(this.sentBytesTotal / BYTES_PER_MS) - this.connOffsetMs, 0);
    const relStart = words.length ? words[0].start : nowRel;
    const relEnd = words.length ? words[words.length - 1].end : nowRel;
    this.opts.onTurn({
      key: `${this.epoch}-${msg.turn_order}`,
      speaker: msg.speaker_label ?? "UNKNOWN",
      text,
      startMs: this.connOffsetMs + relStart,
      endMs: this.connOffsetMs + relEnd,
      final: Boolean(msg.end_of_turn && msg.turn_is_formatted),
      endOfTurn: Boolean(msg.end_of_turn),
    });
  }

  private rotate(): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN || this.finishing || this.destroyed) return;
    this.rotating = true; // el audio pasa al buffer hasta que abra el socket nuevo
    try {
      ws.send(JSON.stringify({ type: "Terminate" }));
    } catch {
      ws.terminate(); // si ni el Terminate salió, el close dispara la reconexión
    }
  }

  async finish(): Promise<void> {
    if (this.destroyed) return;
    this.finishing = true;
    this.clearTimer("rotate");
    this.clearTimer("reconnect");
    this.clearTimer("chaos");
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      this.destroy();
      return;
    }
    await new Promise<void>((resolve) => {
      let settled = false;
      const hard = setTimeout(() => {
        try {
          ws.terminate();
        } catch {
          /* ya muerto */
        }
        this.finishResolve?.();
      }, FINISH_TIMEOUT_MS);
      this.finishResolve = () => {
        if (settled) return;
        settled = true;
        clearTimeout(hard);
        resolve();
      };
      try {
        ws.send(JSON.stringify({ type: "Terminate" }));
      } catch {
        this.finishResolve();
      }
    });
    this.destroy();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.clearTimer("rotate");
    this.clearTimer("reconnect");
    this.clearTimer("chaos");
    try {
      this.ws?.terminate();
    } catch {
      /* ya muerto */
    }
    this.ws = null;
  }

  private clearTimer(which: "rotate" | "reconnect" | "chaos"): void {
    const key = `${which}Timer` as const;
    const timer = this[key];
    if (timer) clearTimeout(timer);
    this[key] = null;
  }
}

class AssemblyAIProvider implements LiveSttProvider {
  readonly name = "assemblyai";
  async start(opts: LiveSttOptions): Promise<LiveSttConnection> {
    const conn = new AssemblyAIConnection(opts, env.ASSEMBLYAI_API_KEY);
    await conn.open();
    return conn;
  }
}

// ── FakeProvider: guion en español por timers (HERMES_LIVE_STT=fake) ────
// Ignora el audio y recorre un diálogo A/B: parciales cada ~300 ms, final
// cada ~4 s. Ejercita TODO el pipeline (WS, upserts, sugerencias, ingest,
// .md, migración) sin tocar AssemblyAI.

const FAKE_SCRIPT: { speaker: string; text: string }[] = [
  { speaker: "A", text: "Bueno, arranquemos con el estado del proyecto y lo que quedó pendiente de la semana pasada." },
  { speaker: "B", text: "Sí, el módulo de pagos quedó desplegado en staging, pero todavía no lo validamos con datos reales." },
  { speaker: "A", text: "¿Y qué nos falta para pasarlo a producción? Porque el cliente lo está esperando para el viernes." },
  { speaker: "B", text: "Faltan las pruebas de carga y definir quién se encarga del monitoreo después del despliegue." },
  { speaker: "A", text: "Entonces propongo dividir el trabajo: yo tomo las pruebas de carga y tú documentas el runbook de operación." },
  { speaker: "B", text: "De acuerdo, pero necesito acceso al dashboard de métricas, todavía no me han dado los permisos." },
  { speaker: "A", text: "Lo pido hoy mismo. Otro tema: el presupuesto del trimestre se está quedando corto para infraestructura." },
  { speaker: "B", text: "Podemos revisar los costos del clúster, hay instancias que están sobredimensionadas desde marzo." },
  { speaker: "A", text: "Perfecto, arma la propuesta de ahorro y la revisamos el jueves antes de hablar con finanzas." },
  { speaker: "B", text: "Listo, también quiero que definamos la fecha del corte de la versión móvil, sigue en el aire." },
];

// Guion de ENTREVISTA bilingüe (HERMES_LIVE_STT_SCRIPT=interview): A entrevista
// a B (el dueño) alternando es/en — ejercita el gatillo de preguntas de la capa
// rápida del copiloto (finales con "?" de un hablante ≠ selfSpeaker).
const FAKE_SCRIPT_INTERVIEW: { speaker: string; text: string }[] = [
  { speaker: "A", text: "Gracias por conectarte. Para arrancar, ¿qué experiencia tienes construyendo sistemas en tiempo real?" },
  { speaker: "B", text: "He trabajado con WebSockets y streaming de audio, incluyendo un copiloto de reuniones con transcripción en vivo y diarización." },
  { speaker: "A", text: "Interesting. What's your experience with WebSockets, and how do you handle reconnection in production?" },
  { speaker: "B", text: "I use exponential backoff with a bounded buffer for the gap, and I rotate the upstream session before it expires so the user never notices." },
  { speaker: "A", text: "¿Y cómo aseguras la calidad cuando despliegas varias veces al día?" },
  { speaker: "B", text: "Con typecheck y simuladores e2e con providers fake, más un checklist manual para lo que toca hardware como el micrófono." },
  { speaker: "A", text: "Could you walk me through a challenging bug you fixed recently?" },
  { speaker: "B", text: "Sure, um, a race between, like, a snapshot writer and its cleanup: the fix was, este, serializing writes on a promise chain so the unlink always runs last." },
  { speaker: "A", text: "Ok. Where do you see the biggest risk in adding an LLM layer to a live meeting pipeline?" },
  { speaker: "B", text: "Latency budgets and silent failures, so I keep the LLM layer additive with a clean degradation path to the base pipeline." },
];

const FAKE_TICK_MS = 300;
const FAKE_TICKS_PER_TURN = 13; // ≈4 s por turno a 300 ms el tick

class FakeLiveSttConnection implements LiveSttConnection {
  private timer: NodeJS.Timeout | null = null;
  private readonly startedAt = Date.now();
  private turnIndex = 0;
  private wordIndex = 0;
  private turnStartMs = 0;
  private readonly script =
    (process.env.HERMES_LIVE_STT_SCRIPT || "").toLowerCase() === "interview"
      ? FAKE_SCRIPT_INTERVIEW
      : FAKE_SCRIPT;

  constructor(private readonly opts: LiveSttOptions) {
    opts.onStatus("connected");
    this.timer = setInterval(() => this.tick(), FAKE_TICK_MS);
  }

  private tick(): void {
    const line = this.script[this.turnIndex % this.script.length];
    const words = line.text.split(" ");
    this.wordIndex = Math.min(
      this.wordIndex + Math.max(1, Math.ceil(words.length / FAKE_TICKS_PER_TURN)),
      words.length,
    );
    const elapsed = Date.now() - this.startedAt;
    const final = this.wordIndex >= words.length;
    this.opts.onTurn({
      key: `1-${this.turnIndex}`, // el fake nunca reconecta: epoch fijo
      speaker: line.speaker,
      text: words.slice(0, this.wordIndex).join(" "),
      startMs: this.turnStartMs,
      endMs: elapsed,
      final,
      endOfTurn: final, // el fake no tiene etapa "crudo sin formatear"
    });
    if (final) {
      this.turnIndex += 1;
      this.wordIndex = 0;
      this.turnStartMs = elapsed;
    }
  }

  sendAudio(): void {
    /* el guion ignora el audio */
  }

  async finish(): Promise<void> {
    this.destroy();
  }

  destroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

class FakeLiveSttProvider implements LiveSttProvider {
  readonly name = "fake";
  async start(opts: LiveSttOptions): Promise<LiveSttConnection> {
    return new FakeLiveSttConnection(opts);
  }
}
