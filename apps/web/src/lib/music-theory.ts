/**
 * La teoría musical vive en `@hermes/shared` (music-theory.ts) desde el Playground de
 * composición: el agente analiza memos (tonalidad, transposición) con la misma lógica que
 * la UI muestra. Este módulo queda como re-export para no tocar a sus importadores.
 */
export {
  MAJOR_STEPS,
  MINOR_STEPS,
  PROGRESSION_PRESETS,
  TONICS,
  analyzeChord,
  borrowedChords,
  chordFromRoman,
  chordIntervals,
  chordNotes,
  chordSymbol,
  diatonicChords,
  keyLabel,
  latinName,
  midi,
  midiToHz,
  mod12,
  noteName,
  parseChord,
  parseNote,
  relatedKeys,
  scaleNotes,
  transposeChord,
  usesFlats,
} from "@hermes/shared";
export type {
  Chord,
  DiatonicChord,
  Key,
  Mode,
  Pc,
  ProgressionPreset,
  Quality,
  Spell,
  ChordAnalysis,
  ChordAnalysis as Analysis,
} from "@hermes/shared";
