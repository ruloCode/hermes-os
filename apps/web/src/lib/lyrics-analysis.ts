/**
 * La métrica y la rima viven en `@hermes/shared` (lyrics-analysis.ts) desde el Playground
 * de composición: el agente mide si una letra generada calza con la melodía con la misma
 * lógica que la UI. Este módulo queda como re-export para no tocar a sus importadores.
 */
export {
  analyzeStanza,
  chordsInText,
  findRhymes,
  lineSyllables,
  rhymeBetween,
  rhymeEnding,
  splitChords,
  stressAdjust,
  stripChords,
  wordSyllables,
} from "@hermes/shared";
export type {
  ChordToken,
  LineAnalysis,
  RhymeKind,
} from "@hermes/shared";
