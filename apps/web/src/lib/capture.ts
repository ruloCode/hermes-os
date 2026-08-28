/**
 * Convención de captura del Estudio: cómo se llama cada crudo y qué formato
 * se espera, para grabar con CUALQUIER app y que el paso de edición encuentre
 * el material solo.
 *
 * Contrato (decidido 2026-08-04): el nombre base es `NN-etiqueta` ("01-hook",
 * "02-0-4s") — la extensión da igual (.mov del iPhone, .mp4 de OBS): el match
 * del checklist es por nombre base contra crudos/ de la carpeta de la pieza
 * en el disco extraíble (`media_dir`).
 */
import type { ContentPiece } from "@hermes/shared";
import { captureSlug } from "@hermes/shared";
import type { ScriptBeat } from "./script-beats";
import { spokenSeconds } from "./script-beats";

/**
 * La otra mitad de la convención (voz en off en `assets/<toma>-vo.wav`) vive en
 * `@hermes/shared` porque el agente también la escribe; se re-exporta aquí para
 * que la UI importe la captura desde un solo módulo.
 */
export {
  captureSlug,
  isVoStem,
  latestVoTakes,
  voBase,
  voBaseOf,
  voTakeNumber,
  voTakes,
  voTakesFor,
} from "@hermes/shared";

/** Nombre base esperado del crudo del beat i ("01-hook"); la extensión da igual. */
export function takeStem(index: number, label: string): string {
  return `${String(index + 1).padStart(2, "0")}-${captureSlug(label)}`;
}

/** Formato de captura esperado según el formato de la pieza. */
export function captureFormat(piece: ContentPiece): string | null {
  switch (piece.format) {
    case "vertical":
      return "9:16 vertical";
    case "pilar":
      return "16:9 horizontal";
    default:
      // post/carrusel/otro: si hay algo que grabar, el encuadre lo decide la pieza.
      return null;
  }
}

/** Duración estimada del beat: el rango declarado o la estimación por palabras. */
export function beatSeconds(beat: ScriptBeat): number | null {
  if (beat.seconds != null) return beat.seconds;
  return beat.words > 0 ? spokenSeconds(beat.words) : null;
}

/** "0:09" — para estimados y sumas del checklist. */
export function fmtSeconds(sec: number | null): string {
  if (sec == null) return "—";
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
