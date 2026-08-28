/**
 * El parser de beats vive en `@hermes/shared` (script-beats.ts) desde que los
 * criterios de salida de `guion` cuentan palabras HABLADAS y evalúan el CTA
 * sobre el cierre real — el agente y el dashboard tienen que parsear igual.
 * Este módulo queda como re-export para no tocar a todos los importadores.
 */
export {
  CTA_RE,
  beatState,
  parseScript,
  pieceBeats,
  rangeSeconds,
  recordedCount,
  replaceBeatText,
  spokenSeconds,
  takeForBeat,
  withBeatVerdict,
} from "@hermes/shared";
export type { BeatState, ParsedScript, ScriptBeat } from "@hermes/shared";
