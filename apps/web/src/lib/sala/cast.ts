// ELENCO: UNA sesión de ElevenLabs con un agente multi-voz que interpreta a
// todos los personajes de la sala. Un solo cerebro = contexto total, cero
// solapamiento (un solo flujo de audio) y "Iván, ¿…?" rutea solo. Lo único
// que hay que reconstruir en el cliente es QUIÉN está sonando en cada
// instante, para que pulse su figura: el texto de la respuesta trae las
// etiquetas <Etiqueta>…</Etiqueta> y el audio trae la alineación por carácter
// (chars + tiempos), así que se mapea la posición de reproducción al
// segmento del personaje. Sin alineación, se reparte el tiempo en proporción
// a los caracteres de cada segmento.

import { VoiceConversation, type Mode, type Status } from "@elevenlabs/client";
import type { SalaCallStatus } from "./calls";

export interface CastSegment {
  /** Clave del personaje (null = texto fuera de etiqueta → el default). */
  key: string;
  label: string;
  text: string;
  /** Rango en el texto SIN etiquetas (lo que se locuta). */
  start: number;
  end: number;
}

export interface CastEvent {
  kind: "status" | "mode" | "line" | "error";
  status?: SalaCallStatus;
  mode?: Mode;
  /** `line`: quién habla (clave del personaje, o null = el humano) y qué dijo. */
  key?: string | null;
  text?: string;
}

export interface CastCallOptions {
  fetchToken: () => Promise<{ conversationToken?: string; signedUrl?: string; error?: string }>;
  clientTools: Record<string, (p: Record<string, unknown>) => Promise<string> | string>;
  /** clave → etiqueta de voz (de GET /sala/agents.cast.labels). */
  labels: Record<string, string>;
  defaultKey: string;
  owner: string;
  onEvent: (ev: CastEvent) => void;
}

const TAG_RE = /<([A-Za-z0-9]+)>([\s\S]*?)<\/\1>/g;

/** Parte una respuesta etiquetada en segmentos por personaje (texto sin etiquetas en `start/end`). */
export function parseCastSegments(text: string, labelToKey: Record<string, string>, defaultKey: string): CastSegment[] {
  const out: CastSegment[] = [];
  let cursor = 0;
  let pos = 0;
  const push = (label: string, raw: string) => {
    const t = raw.replace(/\s+/g, " ").trim();
    if (!t) return;
    const key = labelToKey[label] ?? defaultKey;
    out.push({ key, label, text: t, start: pos, end: pos + t.length });
    pos += t.length + 1; // el espacio entre segmentos también se "habla"
  };
  for (const m of text.matchAll(TAG_RE)) {
    const before = text.slice(cursor, m.index);
    if (before.trim()) push("", before);
    push(m[1], m[2]);
    cursor = (m.index ?? 0) + m[0].length;
  }
  const rest = text.slice(cursor);
  // Texto en STREAMING: la última etiqueta puede venir abierta ("<Ivan>Pues mirá…"
  // sin cierre todavía). Se toma como segmento de ese personaje.
  const open = /<([A-Za-z0-9]+)>([\s\S]*)$/.exec(rest);
  if (open) {
    const before = rest.slice(0, open.index);
    if (before.trim()) push("", before);
    // Cortar una etiqueta de cierre a medio escribir ("</Iv").
    push(open[1], open[2].replace(/<\/?[A-Za-z0-9]*$/, ""));
  } else if (rest.trim()) {
    push("", rest.replace(/<[A-Za-z0-9]*$/, ""));
  }
  return out;
}

/** Texto sin etiquetas (lo que se oye). */
export function stripCastTags(text: string): string {
  return text.replace(TAG_RE, (_m, _l, inner: string) => inner).replace(/\s+/g, " ").trim();
}

export class CastCall {
  private conv: VoiceConversation | null = null;
  private status: SalaCallStatus = "idle";
  private mode: Mode = "listening";
  private readonly labelToKey: Record<string, string>;
  private segments: CastSegment[] = [];
  private spokenChars = 0;
  /** Reloj de reproducción: arranca con el primer chunk alineado de la respuesta. */
  private playStart = 0;
  /** Tiempos globales (ms desde playStart) de inicio de cada carácter locutado. */
  private charStarts: number[] = [];
  private alignedMs = 0;
  private hasAlignment = false;
  private speakingSince = 0;

  constructor(private readonly opts: CastCallOptions) {
    this.labelToKey = Object.fromEntries(Object.entries(opts.labels).map(([k, l]) => [l, k]));
  }

  getStatus(): SalaCallStatus {
    return this.status;
  }

  isConnected(): boolean {
    return this.status === "connected";
  }

  isSpeaking(): boolean {
    return this.mode === "speaking";
  }

  volume(): number {
    if (!this.conv || this.status !== "connected") return 0;
    const v = this.conv.getOutputVolume();
    return Number.isFinite(v) ? v : 0;
  }

  /** Personaje que está sonando AHORA (null si nadie habla). */
  speakingKey(): string | null {
    if (this.mode !== "speaking") return null;
    // Sin segmentos todavía: si el streaming de texto funciona, mejor nadie
    // que el personaje equivocado (llega en < 1 s); si no hay streaming, el default.
    if (!this.segments.length) return this.parts > 0 ? null : this.opts.defaultKey;
    const now = performance.now();
    let charIdx: number;
    if (this.hasAlignment && this.charStarts.length) {
      const t = now - this.playStart;
      // Último carácter cuyo inicio ya pasó (búsqueda lineal desde el final: pocos cientos).
      let i = this.charStarts.length - 1;
      while (i > 0 && this.charStarts[i] > t) i--;
      charIdx = i;
    } else {
      // Sin alineación: ~14 caracteres por segundo de habla.
      const total = this.segments[this.segments.length - 1].end;
      charIdx = Math.min(total - 1, Math.floor(((now - this.speakingSince) / 1000) * 14));
    }
    const seg = this.segments.find((s) => charIdx >= s.start && charIdx < s.end) ?? this.segments[this.segments.length - 1];
    return seg.key;
  }

  async connect(framing: string): Promise<void> {
    if (this.conv || this.status === "connecting") return;
    this.setStatus("connecting");
    try {
      const creds = await this.opts.fetchToken();
      if (creds.error || (!creds.conversationToken && !creds.signedUrl)) throw new Error(creds.error ?? "Sin credenciales");
      const today = new Intl.DateTimeFormat("es-CO", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date());
      const common = {
        clientTools: this.opts.clientTools,
        dynamicVariables: { today, session_scope: framing },
        onStatusChange: ({ status }: { status: Status }) => this.setStatus(status),
        onModeChange: ({ mode }: { mode: Mode }) => this.setMode(mode),
        onMessage: ({ message, role, source }: { message: string; role?: string; source?: string }) => {
          if ((role ?? source) === "user") this.onUser(message);
          else this.onAgent(message);
        },
        onAudioAlignment: (a: { chars: string[]; char_start_times_ms: number[]; char_durations_ms: number[] }) => this.onAlignment(a),
        // El texto COMPLETO (onMessage) llega al final de la respuesta; el
        // streaming llega mientras suena: de aquí salen los segmentos en vivo.
        onAgentChatResponsePart: (p: { text?: string; type?: string }) => this.onPart(p),
        onInterruption: () => {
          // El humano cortó: lo que quedaba por decir ya no suena.
          this.segments = [];
          this.resetClock();
        },
        onError: (message: string) => this.opts.onEvent({ kind: "error", text: message }),
        onDisconnect: () => this.setStatus("disconnected"),
      };
      this.conv = creds.conversationToken
        ? await VoiceConversation.startSession({ ...common, conversationToken: creds.conversationToken, connectionType: "webrtc" })
        : await VoiceConversation.startSession({ ...common, signedUrl: creds.signedUrl!, connectionType: "websocket" });
      this.setStatus("connected");
    } catch (err) {
      this.opts.onEvent({ kind: "error", text: err instanceof Error ? err.message : String(err) });
      this.setStatus("error");
      this.conv = null;
    }
  }

  /** Texto del humano (QA sin micrófono). */
  say(text: string): boolean {
    if (!this.conv || this.status !== "connected") return false;
    this.conv.sendUserMessage(text);
    this.onUser(text);
    return true;
  }

  /**
   * Micrófono abierto o cerrado. En el celular el mic NO puede estar siempre
   * abierto: el viajero va por la calle y todo lo que suene sería un turno.
   * De ahí el "mantén para hablar" de la app.
   */
  setMicMuted(muted: boolean): void {
    try {
      this.conv?.setMicMuted(muted);
    } catch {
      /* la sala WebRTC aún no está lista: quien llama lo re-aplica */
    }
  }

  /** Contexto sin turno (p. ej. "levanta la mano hacia Iván"). */
  context(text: string): void {
    if (!this.conv || this.status !== "connected") return;
    try {
      this.conv.sendContextualUpdate(text);
    } catch {
      /* cerrando */
    }
  }

  async hangup(): Promise<void> {
    const c = this.conv;
    this.conv = null;
    this.segments = [];
    if (c) await c.endSession().catch(() => undefined);
    this.setStatus("disconnected");
  }

  // ── Internos ─────────────────────────────────────────────────────────

  private setStatus(status: SalaCallStatus): void {
    this.status = status;
    this.opts.onEvent({ kind: "status", status });
  }

  private setMode(mode: Mode): void {
    // OJO: el modo parpadea speaking→listening→speaking ENTRE voces (cada
    // personaje es un chunk de TTS aparte) y la alineación de TODA la
    // respuesta llega al principio. Aquí NO se reinicia el reloj: eso lo hace
    // un turno nuevo (texto del humano, "start" del streaming, interrupción).
    if (mode === "speaking" && this.mode !== "speaking") this.speakingSince = performance.now();
    this.mode = mode;
    this.opts.onEvent({ kind: "mode", mode });
  }

  private lastAlignAt = 0;
  private alignText = "";

  private resetClock(): void {
    this.charStarts = [];
    this.alignedMs = 0;
    this.spokenChars = 0;
    this.hasAlignment = false;
    this.playStart = 0;
    this.alignText = "";
  }

  /** QA: cómo se está mapeando la voz a personajes. */
  debug(): { segments: { key: string; start: number; end: number }[]; alignText: string; alignedChars: number; hasAlignment: boolean; playMs: number; parts: number } {
    return {
      parts: this.parts,
      segments: this.segments.map((s) => ({ key: s.key, start: s.start, end: s.end })),
      alignText: this.alignText.slice(0, 160),
      alignedChars: this.spokenChars,
      hasAlignment: this.hasAlignment,
      playMs: this.hasAlignment ? Math.round(performance.now() - this.playStart) : -1,
    };
  }

  private onUser(text: string): void {
    // Turno nuevo: lo que suene a partir de aquí es otra respuesta.
    this.resetClock();
    this.segments = [];
    // "..." = turn-timeout del servidor, no el humano.
    if (!text.replace(/[.…\s]/g, "").length) return;
    this.opts.onEvent({ kind: "line", key: null, text });
  }

  private streamText = "";

  private parts = 0;

  private onPart(p: { text?: string; type?: string }): void {
    this.parts++;
    if (p.type === "start") {
      this.streamText = "";
      this.segments = [];
      this.resetClock();
    }
    if (p.text) this.streamText += p.text;
    const segs = parseCastSegments(this.streamText, this.labelToKey, this.opts.defaultKey);
    if (segs.length) this.segments = segs;
  }

  private onAgent(text: string): void {
    this.segments = parseCastSegments(text, this.labelToKey, this.opts.defaultKey);
    // El reloj NO se reinicia aquí: lo hace el paso a "speaking" (ver setMode).
    // Si el texto llega con el turno ya sonando y sin alineación previa, el
    // reloj arranca con el primer chunk que llegue.
    for (const s of this.segments) this.opts.onEvent({ kind: "line", key: s.key, text: s.text });
  }

  private onAlignment(a: { chars: string[]; char_start_times_ms: number[]; char_durations_ms: number[] }): void {
    if (!a?.chars?.length) return;
    // Chunk que llega tras haber terminado de sonar la respuesta anterior
    // (el reloj ya pasó del último carácter) = respuesta nueva sin aviso previo.
    if (this.hasAlignment && this.mode !== "speaking" && performance.now() - this.playStart > this.alignedMs + 800) this.resetClock();
    this.lastAlignAt = performance.now();
    this.alignText += a.chars.join("");
    if (!this.hasAlignment) {
      this.hasAlignment = true;
      this.playStart = performance.now();
    }
    for (let i = 0; i < a.chars.length; i++) this.charStarts.push(this.alignedMs + (a.char_start_times_ms[i] ?? 0));
    const last = a.chars.length - 1;
    this.alignedMs += (a.char_start_times_ms[last] ?? 0) + (a.char_durations_ms[last] ?? 0);
    this.spokenChars += a.chars.length;
  }
}
