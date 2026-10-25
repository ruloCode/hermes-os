/**
 * Visión en vivo: Hermes describe lo que tienes delante. La cámara es la de
 * las gafas Ray-Ban Meta (vía Hermes Phone) o, para probar, la webcam del
 * browser (/dev/vision): las dos hablan EXACTAMENTE este protocolo por
 * `/vision/ws`. Lógica pura que comparten el agente (vision/live.ts), la web
 * y, por especificación, la app Android (docs/gafas-meta.md).
 *
 * Cliente → agente:
 *   binario = un cuadro JPEG (NARRATE_FRAME_PX; solo si la escena cambió, frameDiff)
 *   {"t":"mode","mode":"narrar"|"manual"}
 *   {"t":"ask","text":"¿qué dice ese letrero?"}   (sin text = "¿qué ves?")
 *     … y justo después un cuadro nítido de ASK_FRAME_PX: es el que se mira.
 * Agente → cliente:
 *   {"t":"ready","mode","model"}
 *   {"t":"start","id","kind","question"?}
 *   {"t":"delta","id","text"}
 *   {"t":"say","id","kind","text","ms"}            (lo que se dice en voz alta)
 *   {"t":"quiet","id","ms"}                        (miró y no había nada nuevo)
 *   {"t":"error","message"}
 */

/** narrar = habla sola cuando la escena cambia · manual = solo cuando le preguntas. */
export type VisionMode = "narrar" | "manual";
export const VISION_MODES: readonly VisionMode[] = ["narrar", "manual"];

/** narrar = comentario espontáneo · respuesta = contesta una pregunta. */
export type VisionReplyKind = "narrar" | "respuesta";

export type VisionClientMessage = { t: "mode"; mode: VisionMode } | { t: "ask"; text: string };

export type VisionServerEvent =
  | { t: "ready"; mode: VisionMode; model: string }
  | { t: "start"; id: string; kind: VisionReplyKind; question?: string }
  | { t: "delta"; id: string; text: string }
  | { t: "say"; id: string; kind: VisionReplyKind; text: string; ms: number }
  | { t: "quiet"; id: string; ms: number }
  | { t: "error"; message: string };

/** Pregunta por defecto cuando el cliente pide "¿qué ves?" sin texto. */
export const DEFAULT_VISION_QUESTION = "¿Qué estoy viendo?";

/**
 * Al preguntar, el cliente manda justo después un cuadro NÍTIDO (~1280 px:
 * a 640 la letra chica se lee a medias y el modelo rellena). El agente lo
 * espera hasta aquí; si no llega, responde con el último cuadro fresco.
 */
export const ASK_FRAME_WAIT_MS = 1_200;
/** Pregunta sin ningún cuadro fresco pasado este tiempo: se dice que no hay imagen. */
export const ASK_GIVE_UP_MS = 3_000;
/** Lado mayor de los cuadros: narrar (barato) y responder (se lee texto). */
export const NARRATE_FRAME_PX = 640;
export const ASK_FRAME_PX = 1280;

/** Mínimo entre dos narraciones espontáneas: hablarte cada segundo no es ayudar. */
export const NARRATE_MIN_INTERVAL_MS = 4_000;
/** Un cuadro más viejo que esto ya no es "lo que estás viendo". */
export const FRAME_MAX_AGE_MS = 5_000;
/** Diferencia media (0-1) entre miniaturas a partir de la cual la escena cambió. */
export const SCENE_CHANGE_MIN = 0.06;

export function parseVisionMessage(raw: string): VisionClientMessage | null {
  let m: unknown;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!m || typeof m !== "object") return null;
  const o = m as Record<string, unknown>;
  if (o.t === "mode") return VISION_MODES.includes(o.mode as VisionMode) ? { t: "mode", mode: o.mode as VisionMode } : null;
  if (o.t === "ask") {
    const text = typeof o.text === "string" ? o.text.trim().slice(0, 500) : "";
    return { t: "ask", text: text || DEFAULT_VISION_QUESTION };
  }
  return null;
}

export interface VisionSchedulerState {
  mode: VisionMode;
  /** Hay un turno del modelo en vuelo (se espera a que cierre: nada se pisa). */
  busy: boolean;
  /** Llegada del último cuadro (null = aún no hay cámara). */
  frameAt: number | null;
  /** El último cuadro todavía no lo ha visto el modelo. */
  frameUnseen: boolean;
  /** Pregunta esperando respuesta. */
  pendingAsk: string | null;
  /** Cuándo llegó esa pregunta. */
  askAt: number | null;
  lastNarrateAt: number;
}

export type VisionAction = "ask" | "narrate" | "no_frame";

/**
 * Qué hacer ahora. Una pregunta gana siempre: espera el cuadro nítido que la
 * sigue (o ASK_FRAME_WAIT_MS) y, si pasado ASK_GIVE_UP_MS no hay ningún
 * cuadro fresco, es "no_frame" (se dice, no se inventa). Narrar exige un
 * cuadro NUEVO, fresco y que haya pasado el intervalo. Con el modelo ocupado
 * no se hace nada: la respuesta en curso termina y el siguiente turno usa el
 * cuadro más reciente.
 */
export function nextVisionAction(s: VisionSchedulerState, now: number): VisionAction | null {
  if (s.busy) return null;
  const fresh = s.frameAt !== null && now - s.frameAt <= FRAME_MAX_AGE_MS;
  if (s.pendingAsk) {
    const askAt = s.askAt ?? now;
    if (!fresh) return now - askAt >= ASK_GIVE_UP_MS ? "no_frame" : null;
    if (s.frameAt! >= askAt || now - askAt >= ASK_FRAME_WAIT_MS) return "ask";
    return null;
  }
  if (!fresh) return null;
  if (s.mode === "narrar" && s.frameUnseen && now - s.lastNarrateAt >= NARRATE_MIN_INTERVAL_MS) return "narrate";
  return null;
}

/**
 * Lo que devolvió el modelo → lo que se dice, o null si eligió callar.
 * Quita comillas que envuelven y prefijos de relleno ("Veo que…" se queda:
 * es una frase; "Descripción:" no).
 */
export function visionReply(raw: string): string | null {
  let t = raw.trim();
  t = t.replace(/^(descripci[oó]n|respuesta|narraci[oó]n)\s*:\s*/i, "");
  t = t.replace(/^["«“'](.*)["»”']$/s, "$1").trim();
  if (!t || /^[—–-]+\.?$/.test(t)) return null;
  return t;
}

/**
 * Diferencia media entre dos miniaturas en escala de grises (mismo tamaño,
 * un byte por pixel): 0 = idénticas, 1 = opuestas. La calcula el CLIENTE
 * sobre una miniatura de ~32×24 antes de subir el cuadro, así una escena
 * quieta no gasta ni red ni modelo.
 */
export function frameDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length === 0 || a.length !== b.length) return 1;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / (a.length * 255);
}

/** RGBA (ImageData) → escala de grises, un byte por pixel. */
export function toGray(rgba: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(Math.floor(rgba.length / 4));
  for (let i = 0; i < out.length; i++) {
    const j = i * 4;
    out[i] = Math.round(0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2]);
  }
  return out;
}
