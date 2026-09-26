/**
 * LATENCIA de grabar sobre la pista: lo que tarda el sonido en salir por los
 * parlantes/audífonos más lo que tarda la voz en entrar. Tres fuentes, en
 * orden de confianza: MEDIDA (loopback: suenan clics, se graban y se mide el
 * retardo — guardada por dispositivo en localStorage) > NAVEGADOR
 * (outputLatency + baseLatency + la latencia que declara el track del micro;
 * Safari no declara la de entrada) > MANUAL (empujón ±150 ms).
 *
 * La medida vale para UN par entrada/salida: la clave lleva el micrófono real
 * (deviceId + groupId del track abierto: el "default" de Chrome comparte el
 * groupId del aparato físico) y la salida (`sinkId`). Como la salida por
 * defecto del sistema cambia sin que cambie el `sinkId` (conectar audífonos
 * Bluetooth), la medida guarda también la latencia de salida que declaraba el
 * navegador en ese momento; si la de ahora difiere en más de 20 ms, la medida
 * ya no es de este equipo y se descarta (se vuelve a la del navegador, con aviso).
 */
import { detectClicks } from "@hermes/shared";
import { startLoopRecorder } from "./loop-recorder";

export interface LatencyEstimate {
  ms: number;
  source: "medida" | "navegador" | "manual";
  /** Aviso honesto ("Bluetooth: más de 80 ms, usa cable"). */
  warn?: string;
}

const PREFIX = "hermes-latency:";
/** La última clave de dispositivo con que se grabó (antes de abrir el micro no se conoce la real). */
const LAST_KEY = "hermes-latency-ultimo-equipo";
/** Por encima de esto casi siempre es Bluetooth: se nota al cantar encima. */
const WARN_MS = 80;
/** Si la latencia de salida declarada cambió más que esto, la medida guardada es de otro equipo. */
const OUT_DRIFT_MS = 20;

/** Clave por dispositivo: entrada + salida (una calibración no sirve para otro par). */
export function deviceKey(inputId: string | undefined, outputLabel?: string): string {
  return `${inputId ?? "default"}|${outputLabel ?? "default"}`;
}

/**
 * La clave REAL del par que suena ahora: el micrófono del track abierto
 * (deviceId + groupId) y la salida del contexto (`sinkId`; "" = la del sistema).
 * Sin track (todavía no se abrió el micro) devuelve la última usada.
 */
export function deviceKeyFor(ctx: AudioContext | null, track?: MediaStreamTrack | null): string {
  if (!track) return lastDeviceKey() ?? deviceKey(undefined, outputId(ctx));
  const s = track.getSettings?.() ?? {};
  const input = s.deviceId ? `${s.deviceId}${s.groupId ? `~${s.groupId}` : ""}` : track.label || undefined;
  const key = deviceKey(input, outputId(ctx));
  try {
    localStorage.setItem(LAST_KEY, key);
  } catch {
    /* sin almacenamiento: la próxima vez se vuelve a leer del track */
  }
  return key;
}

function lastDeviceKey(): string | null {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
}

/** La salida del contexto (Chrome: `AudioContext.sinkId`, "" = la del sistema). */
function outputId(ctx: AudioContext | null): string | undefined {
  const sink = (ctx as (AudioContext & { sinkId?: unknown }) | null)?.sinkId;
  return typeof sink === "string" && sink ? sink : undefined;
}

/** Latencia de salida que declara el navegador AHORA (ms), o null si no declara. */
export function outputLatencyMs(ctx: AudioContext): number | null {
  const out = (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
  return out > 0 ? out * 1000 : null;
}

interface SavedCalibration {
  ms: number;
  /** Latencia de salida declarada al medir (ms); null = el navegador no declaraba. */
  outMs: number | null;
}

export function savedCalibration(key: string): SavedCalibration | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw == null) return null;
    const parsed: unknown = raw.trim().startsWith("{") ? JSON.parse(raw) : { ms: Number(raw), outMs: null };
    const { ms, outMs } = parsed as { ms?: unknown; outMs?: unknown };
    if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0 || ms >= 1000) return null;
    return { ms, outMs: typeof outMs === "number" && Number.isFinite(outMs) ? outMs : null };
  } catch {
    // Almacenamiento bloqueado (ventana privada, previsualización) o corrupto: sin calibración guardada.
    return null;
  }
}

export function saveCalibration(key: string, ms: number, outMs: number | null = null): void {
  if (!Number.isFinite(ms)) return;
  try {
    localStorage.setItem(
      PREFIX + key,
      JSON.stringify({ ms: Math.round(ms * 10) / 10, outMs: outMs == null ? null : Math.round(outMs * 10) / 10 }),
    );
  } catch {
    /* sin almacenamiento: vale para esta sesión y ya */
  }
}

const warnFor = (ms: number, extra?: string): string | undefined => {
  const parts = [
    ms > WARN_MS ? `Más de ${WARN_MS} ms: si usas Bluetooth, cambia a audífonos con cable.` : null,
    extra ?? null,
  ].filter(Boolean);
  return parts.length ? parts.join(" ") : undefined;
};

/** La mejor estimación disponible ahora mismo. */
export function currentLatency(ctx: AudioContext, track?: MediaStreamTrack, key?: string): LatencyEstimate {
  let stale: string | undefined;
  if (key) {
    const saved = savedCalibration(key);
    const nowOut = outputLatencyMs(ctx);
    // La medida gana solo si la salida sigue siendo la misma: con otra latencia de salida
    // (audífonos Bluetooth en vez de parlantes, con el mismo sinkId) ya no es de este equipo.
    const sameOutput = !saved || saved.outMs == null || nowOut == null || Math.abs(nowOut - saved.outMs) <= OUT_DRIFT_MS;
    if (saved && sameOutput) return { ms: saved.ms, source: "medida", warn: warnFor(saved.ms) };
    if (saved)
      stale = `La salida de audio cambió desde que mediste (${Math.round(saved.outMs ?? 0)} → ${Math.round(nowOut ?? 0)} ms de salida): vuelve a medir.`;
  }
  const out = (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
  // Chrome declara la latencia de entrada del track (s); Safari no.
  const settings = track?.getSettings?.() as (MediaTrackSettings & { latency?: number }) | undefined;
  const input = typeof settings?.latency === "number" && Number.isFinite(settings.latency) ? settings.latency : null;
  if (out > 0 || input != null) {
    const ms = Math.round((out + (input ?? 0)) * 1000);
    return {
      ms,
      source: "navegador",
      warn: warnFor(
        ms,
        [stale, input == null ? "El navegador no declara la latencia de entrada: calibra para que la toma caiga en su sitio." : null]
          .filter(Boolean)
          .join(" ") || undefined,
      ),
    };
  }
  return {
    ms: 0,
    source: "manual",
    warn: [stale, "El navegador no declara su latencia: calibra, o corrige a mano si la toma se oye corrida."]
      .filter(Boolean)
      .join(" "),
  };
}

/** Separación entre clics de la calibración (s). */
export const CALIBRATION_GAP_SEC = 1;

/**
 * Calibra por loopback: toca `clicks` clics por la salida, los graba con el
 * micrófono y usa `detectClicks` (@hermes/shared). Acepta si la dispersión (MAD)
 * es < 5 ms. Pide que el micrófono oiga los parlantes (no sirve con audífonos).
 *
 * Los clics van a 1 s: el detector busca cada uno en una ventana proporcional a
 * la separación (0,45 × gap) y, con el eco de un cuarto o una salida Bluetooth
 * de 200+ ms, a 0,5 s la ventana de un clic se comía el siguiente. Devuelve
 * también la clave del par entrada/salida con que se midió y la latencia de
 * salida declarada en ese momento (con eso se guarda y se invalida).
 */
export async function calibrate(
  ctx: AudioContext,
  opts?: { deviceId?: string; clicks?: number },
): Promise<{ ms: number; madMs: number; deviceKey: string; outMs: number | null } | { error: string }> {
  const n = Math.max(4, Math.min(16, opts?.clicks ?? 8));
  const gap = CALIBRATION_GAP_SEC;
  let rec;
  try {
    rec = await startLoopRecorder(ctx, { deviceId: opts?.deviceId });
  } catch (e) {
    return { error: (e as Error).message };
  }
  // Medio segundo de margen: el micrófono recién abierto tarda en estabilizarse.
  const t0 = ctx.currentTime + 0.6;
  const times: number[] = [];
  for (let i = 0; i < n; i++) {
    const at = t0 + i * gap;
    times.push(at);
    // Clic corto y brillante: un ataque nítido que se encuentra fácil en la grabación.
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "square";
    o.frequency.value = 2000;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(0.7, at + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.012);
    o.connect(g).connect(ctx.destination);
    o.start(at);
    o.stop(at + 0.02);
  }
  // Cola: la ventana del último clic (0,45 × gap) más aire, para que entre entera.
  const endAt = t0 + (n - 1) * gap + 0.5 * gap + 0.1;
  const key = deviceKeyFor(ctx, rec.track);
  const outMs = outputLatencyMs(ctx);
  await new Promise((r) => setTimeout(r, Math.max(0, (endAt - ctx.currentTime) * 1000)));
  let recording;
  try {
    recording = await rec.stop();
  } catch (e) {
    return { error: (e as Error).message };
  }
  const expected = times.map((t) => t - recording.firstFrameSec);
  // Ruido de fondo: si antes del primer clic ya suena algo fuerte (un tono, música),
  // el detector confunde ese sonido con los clics y "mide" cualquier cosa.
  const pre = recording.pcm.subarray(0, Math.max(0, Math.floor((expected[0] - 0.08) * recording.sr)));
  let prePeak = 0;
  for (let i = 0; i < pre.length; i++) prePeak = Math.max(prePeak, Math.abs(pre[i]));
  if (pre.length && prePeak > 0.25 && prePeak > recording.peak * 0.5)
    return { error: "Hay sonido de fondo antes de los clics: repite en silencio (sin música ni audífonos puestos)." };
  let found: ReturnType<typeof detectClicks>;
  try {
    found = detectClicks(recording.pcm, recording.sr, expected);
  } catch {
    return { error: "La detección de clics todavía no está disponible en esta versión." };
  }
  if (!found || found.found < Math.ceil(n / 2))
    return {
      error:
        "No se oyeron los clics. Sube el volumen de los parlantes y acerca el micrófono (con audífonos no se puede medir).",
    };
  // Salida + entrada nunca suman menos de unos ms: 0 es que no se oyeron los clics sino otra cosa.
  if (found.delayMs < 3)
    return { error: "La medida no es creíble (casi 0 ms): el micrófono no oyó los clics por los parlantes. Repite sin audífonos." };
  if (found.madMs >= 5)
    return {
      error: `La medida salió inestable (±${found.madMs.toFixed(1)} ms). Repite en silencio, sin moverte.`,
    };
  return { ms: Math.max(0, found.delayMs), madMs: found.madMs, deviceKey: key, outMs };
}
