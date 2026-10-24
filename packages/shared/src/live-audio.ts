/**
 * Salud del audio de la junta/clase EN VIVO: lógica pura que comparten el
 * browser (qué micrófono abrir, cuándo avisar que tu mic no se oye) y el
 * agente (la línea de diagnóstico que queda en el transcript de la clase).
 *
 * Nació de una clase real (2026-10-16): el transcript solo traía a la profe y
 * el medidor de la UI se movía igual, porque medía la MEZCLA mic+pestaña — la
 * voz de la profe lo prendía aunque tu mic estuviera mudo. Ahora cada fuente
 * se mide por separado ANTES de mezclar.
 */
import type { SourceEnergy } from "./english-class.js";
import type { LiveAudioReport } from "./types.js";

// ── Elegir micrófono ───────────────────────────────────────────────────

/** Lo que el browser expone de un input (enumerateDevices). */
export interface MicDeviceInfo {
  deviceId: string;
  label: string;
}

// Drivers virtuales que instalan las apps de llamadas y de streaming: como
// "predeterminado" del sistema entregan silencio mientras su app no los
// alimente. El de Teams y el de Zoom están instalados en la Mac del dueño.
const VIRTUAL_MIC =
  /\b(microsoft teams audio|teams audio|zoomaudiodevice|zoom audio|blackhole|loopback|soundflower|virtual|aggregate|agregado|multi-output|obs)\b/i;

/** ¿Es un driver virtual (no un micrófono físico)? */
export function isVirtualMic(label: string): boolean {
  return VIRTUAL_MIC.test(label);
}

/** Ids que Chrome usa como alias del predeterminado del sistema. */
const ALIAS_IDS = new Set(["default", "communications"]);

/**
 * Qué micrófono abrir. `undefined` = el predeterminado (el sistema sabe más).
 * - El que eligió el dueño, si sigue conectado.
 * - Si el predeterminado es un driver virtual, el primer micrófono físico.
 */
export function pickMicDevice(devices: MicDeviceInfo[], saved?: string | null): string | undefined {
  if (saved && devices.some((d) => d.deviceId === saved)) return saved;
  const def = devices.find((d) => d.deviceId === "default");
  const defaultLooksVirtual = def ? isVirtualMic(def.label) : false;
  if (!defaultLooksVirtual) return undefined;
  const real = devices.find((d) => !ALIAS_IDS.has(d.deviceId) && d.label && !isVirtualMic(d.label));
  return real?.deviceId;
}

/** Nombre legible (Chrome antepone "Predeterminado - " / "Default - " al alias). */
export function micDisplayName(label: string): string {
  return label.replace(/^(predeterminado|default|comunicaciones|communications)\s*-\s*/i, "").trim() || "Micrófono";
}

// ── ¿Se oye tu mic? ────────────────────────────────────────────────────

/** RMS de un frame de 100 ms por encima del cual hay voz (ruido con NS: ~0.001-0.004). */
export const VOICE_LEVEL = 0.008;
/** Por debajo de esto el input está muerto (driver virtual, mic desconectado). */
export const DEAD_LEVEL = 0.0015;
/** Ventana para decidir que tu mic no se oye: en una clase hablas al menos cada 45 s. */
export const MIC_SILENT_WINDOW_MS = 45_000;
/** La llamada estuvo viva en la ventana: la pestaña tuvo voz en al menos esta fracción. */
const CALL_ALIVE_SHARE = 0.05;

export interface AudioHealth {
  /** Fracción de frames de la ventana con voz en el mic (0..1). */
  micVoice: number;
  /** Ídem para la pestaña/app de la llamada. */
  tabVoice: number;
  /** RMS máximo del mic en la ventana. */
  micPeak: number;
  /**
   * Hay que avisar: la ventana completa sin voz en el mic, con la llamada
   * sonando (o con el input muerto del todo, aunque no haya pestaña).
   */
  micSilent: boolean;
}

/** Salud de las dos fuentes sobre los últimos `windowMs` del audio enviado. */
export function audioHealth(frames: SourceEnergy[], windowMs = MIC_SILENT_WINDOW_MS): AudioHealth {
  if (frames.length === 0) return { micVoice: 0, tabVoice: 0, micPeak: 0, micSilent: false };
  const last = frames[frames.length - 1].ms;
  const from = last - windowMs;
  let n = 0;
  let mic = 0;
  let tab = 0;
  let micPeak = 0;
  for (let i = frames.length - 1; i >= 0 && frames[i].ms >= from; i--) {
    const f = frames[i];
    n += 1;
    if (f.mic >= VOICE_LEVEL) mic += 1;
    if (f.tab >= VOICE_LEVEL) tab += 1;
    if (f.mic > micPeak) micPeak = f.mic;
  }
  const micVoice = mic / n;
  const tabVoice = tab / n;
  // Solo se juzga con la ventana completa (los primeros 45 s no alarman).
  const covered = frames[0].ms <= from;
  const micSilent =
    covered && micPeak < VOICE_LEVEL && (tabVoice >= CALL_ALIVE_SHARE || micPeak < DEAD_LEVEL);
  return { micVoice, tabVoice, micPeak, micSilent };
}

// ── Diagnóstico que viaja al agente ─────────────────────────────────────

/** Línea para la cabecera del transcript guardado: el reporte sabe si tu voz entró. */
export function audioReportLine(r: LiveAudioReport | undefined): string {
  if (!r) return "";
  const pct = (x: number) => `${Math.round(x * 100)} %`;
  const warn = r.silentWarned ? " · hubo aviso de micrófono mudo" : "";
  return `> Audio: micrófono «${r.mic}» con voz en ${pct(r.micVoice)} del tiempo · la llamada en ${pct(r.tabVoice)}${warn}.`;
}
