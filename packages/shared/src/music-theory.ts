/**
 * Teoría musical mínima para COMPOSICIÓN — lógica pura, sin React.
 *
 * Cubre lo que un compositor necesita para "elegir la tonalidad y ver qué
 * acordes tengo": escalas mayor/menor, acordes diatónicos con su grado
 * romano, deletreo correcto por tonalidad (F mayor dice Bb, no A#), nombres
 * latinos (Do Re Mi) porque así se piensa la música en español, notas de
 * cada acorde (para el piano y el audio), acordes prestados y transposición.
 * Todo lo que la UI muestra sale de aquí: nada es un texto decorativo.
 */

export type Mode = "major" | "minor";

/** Índice cromático 0..11 con C = 0. */
export type Pc = number;

const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const LATIN: Record<string, string> = { C: "Do", D: "Re", E: "Mi", F: "Fa", G: "Sol", A: "La", B: "Si" };

/** Tonalidades que se deletrean con bemoles (mayores; las menores heredan de su relativa). */
const FLAT_MAJORS = new Set([5, 10, 3, 8, 1, 6]); // F Bb Eb Ab Db Gb

export const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
export const MINOR_STEPS = [0, 2, 3, 5, 7, 8, 10];

export type Quality = "maj" | "min" | "dim" | "aug" | "7" | "maj7" | "m7" | "m7b5" | "sus2" | "sus4" | "add9";

const QUALITY_INTERVALS: Record<Quality, number[]> = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  "7": [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  m7b5: [0, 3, 6, 10],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  add9: [0, 4, 7, 14],
};

const QUALITY_SUFFIX: Record<Quality, string> = {
  maj: "",
  min: "m",
  dim: "°",
  aug: "+",
  "7": "7",
  maj7: "maj7",
  m7: "m7",
  m7b5: "ø7",
  sus2: "sus2",
  sus4: "sus4",
  add9: "add9",
};

export interface Key {
  tonic: Pc;
  mode: Mode;
}

export interface Chord {
  root: Pc;
  quality: Quality;
}

export const mod12 = (n: number): Pc => ((n % 12) + 12) % 12;

/** ¿Esta tonalidad se escribe con bemoles? */
export function usesFlats(key: Key): boolean {
  const relMajor = key.mode === "major" ? key.tonic : mod12(key.tonic + 3);
  return FLAT_MAJORS.has(relMajor);
}

/** Cómo deletrear una nota cuando la tonalidad no manda (grados alterados). */
export type Spell = "auto" | "sharp" | "flat";

/** Nombre anglosajón de la nota, deletreado según la tonalidad (o forzado). */
export function noteName(pc: Pc, key: Key, spell: Spell = "auto"): string {
  const flats = spell === "auto" ? usesFlats(key) : spell === "flat";
  return (flats ? FLAT_NAMES : SHARP_NAMES)[mod12(pc)];
}

/** Nombre latino (Do, Re♭, Fa♯…) — así se piensa la música en español. */
export function latinName(pc: Pc, key: Key, spell: Spell = "auto"): string {
  const en = noteName(pc, key, spell);
  const base = LATIN[en[0]] ?? en[0];
  const acc = en.slice(1).replace("#", "♯").replace("b", "♭");
  return base + acc;
}

/** Parsea "Bb", "F#", "Do", "Sol#", "Re♭" → índice cromático (o null). */
export function parseNote(s: string): Pc | null {
  const t = s.trim();
  const latin = t.match(/^(do|re|mi|fa|sol|la|si)\s*([#♯b♭])?$/i);
  if (latin) {
    const map: Record<string, number> = { do: 0, re: 2, mi: 4, fa: 5, sol: 7, la: 9, si: 11 };
    const base = map[latin[1].toLowerCase()];
    const acc = latin[2] ? (/[#♯]/.test(latin[2]) ? 1 : -1) : 0;
    return mod12(base + acc);
  }
  const en = t.match(/^([A-G])([#♯b♭])?$/);
  if (!en) return null;
  const map: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const acc = en[2] ? (/[#♯]/.test(en[2]) ? 1 : -1) : 0;
  return mod12(map[en[1]] + acc);
}

export function keyLabel(key: Key, notation: "en" | "latin" = "en"): string {
  const n = notation === "latin" ? latinName(key.tonic, key) : noteName(key.tonic, key);
  return `${n} ${key.mode === "major" ? "mayor" : "menor"}`;
}

/** Notas de la escala (7 grados). */
export function scaleNotes(key: Key): Pc[] {
  const steps = key.mode === "major" ? MAJOR_STEPS : MINOR_STEPS;
  return steps.map((s) => mod12(key.tonic + s));
}

const MAJOR_QUALITIES: Quality[] = ["maj", "min", "min", "maj", "maj", "min", "dim"];
const MINOR_QUALITIES: Quality[] = ["min", "dim", "maj", "min", "min", "maj", "maj"];
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"];

export interface DiatonicChord {
  degree: number; // 1..7
  roman: string;
  chord: Chord;
  /** Función armónica para explicar "para qué sirve" cada acorde. */
  role: "tónica" | "subdominante" | "dominante";
}

/** Los 7 acordes de la tonalidad con su grado romano y función. */
export function diatonicChords(key: Key): DiatonicChord[] {
  const notes = scaleNotes(key);
  const qualities = key.mode === "major" ? MAJOR_QUALITIES : MINOR_QUALITIES;
  const roles: DiatonicChord["role"][] =
    key.mode === "major"
      ? ["tónica", "subdominante", "tónica", "subdominante", "dominante", "tónica", "dominante"]
      : ["tónica", "subdominante", "tónica", "subdominante", "dominante", "subdominante", "dominante"];
  return notes.map((root, i) => ({
    degree: i + 1,
    roman: romanFor(i + 1, qualities[i]),
    chord: { root, quality: qualities[i] },
    role: roles[i],
  }));
}

function romanFor(degree: number, quality: Quality, prefix = ""): string {
  const base = ROMAN[degree - 1];
  const isMinorish = quality === "min" || quality === "dim" || quality === "m7" || quality === "m7b5";
  const r = isMinorish ? base.toLowerCase() : base;
  const suffix = quality === "dim" ? "°" : quality === "m7b5" ? "ø" : quality === "7" || quality === "m7" || quality === "maj7" ? "7" : "";
  return prefix + r + suffix;
}

/** Símbolo del acorde ("Am", "Bb", "F#m7", "G°") deletreado por tonalidad.
 *  `spell` fuerza ♯/♭ para grados alterados: el ♭II de La menor es Bb, no A#. */
export function chordSymbol(chord: Chord, key: Key, notation: "en" | "latin" = "en", spell: Spell = "auto"): string {
  const root = notation === "latin" ? latinName(chord.root, key, spell) : noteName(chord.root, key, spell);
  return root + QUALITY_SUFFIX[chord.quality];
}

/** Parsea "Am", "F#m7", "Bbmaj7", "Gsus4", "Ddim", "Sol", "Lam" → Chord (o null). */
export function parseChord(s: string): Chord | null {
  const m = s.trim().match(/^([A-G][#b♯♭]?|(?:do|re|mi|fa|sol|la|si)[#b♯♭]?)(.*)$/i);
  if (!m) return null;
  const root = parseNote(m[1]);
  if (root == null) return null;
  const suf = m[2].trim();
  const table: [RegExp, Quality][] = [
    [/^$/, "maj"],
    [/^(m|min|-)$/, "min"],
    [/^(dim|°|o)$/, "dim"],
    [/^(aug|\+)$/, "aug"],
    [/^7$/, "7"],
    [/^(maj7|M7|Δ7?)$/, "maj7"],
    [/^(m7|min7|-7)$/, "m7"],
    [/^(m7b5|ø7?)$/, "m7b5"],
    [/^sus2$/, "sus2"],
    [/^sus4?$/, "sus4"],
    [/^add9$/, "add9"],
  ];
  for (const [re, q] of table) if (re.test(suf)) return { root, quality: q };
  return null;
}

/** Notas del acorde (índices cromáticos, en orden de la voz). */
export function chordNotes(chord: Chord): Pc[] {
  return QUALITY_INTERVALS[chord.quality].map((i) => mod12(chord.root + i));
}

/** Intervalos del acorde (sin plegar): sirven para el audio con octavas. */
export function chordIntervals(chord: Chord): number[] {
  return QUALITY_INTERVALS[chord.quality];
}

export interface ChordAnalysis {
  roman: string;
  /** Diatónico a la tonalidad: sí / prestado (de la paralela u otro modo) / fuera. */
  status: "diatónico" | "prestado" | "fuera";
  hint?: string;
}

/** Análisis funcional de un acorde dentro de la tonalidad. */
export function analyzeChord(chord: Chord, key: Key): ChordAnalysis {
  const dia = diatonicChords(key);
  const hit = dia.find((d) => d.chord.root === chord.root);
  if (hit) {
    const sameFamily = qualityFamily(hit.chord.quality) === qualityFamily(chord.quality);
    if (sameFamily) return { roman: romanFor(hit.degree, chord.quality), status: "diatónico" };
    // Mismo grado, cualidad cambiada (p. ej. V7, o iv en mayor): sigue siendo útil.
    const borrowed = key.mode === "major" && hit.degree === 4 && chord.quality === "min";
    const dominant = hit.degree === 5 && (chord.quality === "maj" || chord.quality === "7") && key.mode === "minor";
    if (borrowed) return { roman: romanFor(4, "min"), status: "prestado", hint: "iv menor: color melancólico prestado del modo menor" };
    if (dominant) return { roman: romanFor(5, chord.quality), status: "prestado", hint: "V mayor (menor armónica): tensión que resuelve a la tónica" };
    return { roman: romanFor(hit.degree, chord.quality), status: "diatónico", hint: "misma raíz, cualidad cambiada" };
  }
  // Raíz no diatónica: busca grado alterado (♭VII, ♭VI, ♭III, ♭II, #iv…).
  const notes = scaleNotes(key);
  for (let i = 0; i < 7; i++) {
    const flat = mod12(notes[i] - 1) === chord.root;
    const sharp = mod12(notes[i] + 1) === chord.root;
    if (flat || sharp) {
      const roman = romanFor(i + 1, chord.quality, flat ? "♭" : "♯");
      const known = BORROWED_HINTS[roman];
      return { roman, status: known ? "prestado" : "fuera", hint: known };
    }
  }
  return { roman: "?", status: "fuera" };
}

const BORROWED_HINTS: Record<string, string> = {
  "♭VII": "♭VII: sabor rock/folk, suaviza la vuelta a la tónica",
  "♭VI": "♭VI: dramatismo prestado del menor; suele ir a ♭VII o V",
  "♭III": "♭III: color épico prestado del menor",
  "♭II": "♭II: cadencia andaluza / napolitana, muy flamenco",
  "♯iv°": "♯iv°: paso cromático hacia el V",
};

function qualityFamily(q: Quality): "maj" | "min" | "dim" | "other" {
  if (q === "maj" || q === "maj7" || q === "7" || q === "add9" || q === "sus2" || q === "sus4") return "maj";
  if (q === "min" || q === "m7") return "min";
  if (q === "dim" || q === "m7b5") return "dim";
  return "other";
}

/** Acordes prestados que suelen funcionar en esta tonalidad, con su porqué. */
export function borrowedChords(key: Key): { chord: Chord; roman: string; hint: string; spell: Spell }[] {
  const t = key.tonic;
  if (key.mode === "major") {
    return [
      { chord: { root: mod12(t + 10), quality: "maj" }, roman: "♭VII", hint: BORROWED_HINTS["♭VII"], spell: "flat" },
      { chord: { root: mod12(t + 5), quality: "min" }, roman: "iv", hint: "iv menor: color melancólico prestado del modo menor", spell: "auto" },
      { chord: { root: mod12(t + 8), quality: "maj" }, roman: "♭VI", hint: BORROWED_HINTS["♭VI"], spell: "flat" },
      { chord: { root: mod12(t + 3), quality: "maj" }, roman: "♭III", hint: BORROWED_HINTS["♭III"], spell: "flat" },
    ];
  }
  return [
    { chord: { root: mod12(t + 7), quality: "maj" }, roman: "V", hint: "V mayor (menor armónica): tensión que resuelve a la tónica", spell: "auto" },
    { chord: { root: mod12(t + 7), quality: "7" }, roman: "V7", hint: "V7: la dominante con más empuje hacia la tónica", spell: "auto" },
    { chord: { root: mod12(t + 5), quality: "maj" }, roman: "IV", hint: "IV mayor (dórico): luz dentro del menor", spell: "auto" },
    { chord: { root: mod12(t + 1), quality: "maj" }, roman: "♭II", hint: BORROWED_HINTS["♭II"], spell: "flat" },
  ];
}

/** Tonalidades vecinas: relativa, paralela y las del círculo de quintas. */
export function relatedKeys(key: Key): { label: string; key: Key }[] {
  const t = key.tonic;
  const rel: Key = key.mode === "major" ? { tonic: mod12(t + 9), mode: "minor" } : { tonic: mod12(t + 3), mode: "major" };
  const par: Key = { tonic: t, mode: key.mode === "major" ? "minor" : "major" };
  return [
    { label: "relativa", key: rel },
    { label: "paralela", key: par },
    { label: "quinta ↑", key: { tonic: mod12(t + 7), mode: key.mode } },
    { label: "quinta ↓", key: { tonic: mod12(t + 5), mode: key.mode } },
  ];
}

/** Transpone un acorde n semitonos. */
export function transposeChord(chord: Chord, semitones: number): Chord {
  return { root: mod12(chord.root + semitones), quality: chord.quality };
}

/** Progresiones clásicas expresadas en grados; se resuelven en cualquier tonalidad. */
export interface ProgressionPreset {
  id: string;
  name: string;
  romans: string[];
  mode: Mode | "any";
  feel: string;
}

export const PROGRESSION_PRESETS: ProgressionPreset[] = [
  { id: "pop", name: "La del pop", romans: ["I", "V", "vi", "IV"], mode: "major", feel: "Luminosa, funciona con casi cualquier letra" },
  { id: "sensible", name: "Sensible", romans: ["vi", "IV", "I", "V"], mode: "major", feel: "Empieza en penumbra y abre al coro" },
  { id: "50s", name: "Años 50", romans: ["I", "vi", "IV", "V"], mode: "major", feel: "Balada clásica, vals lento o doo-wop" },
  { id: "folk", name: "Folk", romans: ["I", "IV", "V", "IV"], mode: "major", feel: "Tres acordes y la verdad" },
  { id: "jazz", name: "ii–V–I", romans: ["ii", "V", "I"], mode: "major", feel: "La cadencia del jazz y el bolero" },
  { id: "menor", name: "Menor con luz", romans: ["i", "VI", "III", "VII"], mode: "minor", feel: "Melancólica pero con impulso" },
  { id: "andaluza", name: "Andaluza", romans: ["i", "VII", "VI", "V"], mode: "minor", feel: "Flamenco, tango, descenso dramático" },
  { id: "menor-simple", name: "Menor íntima", romans: ["i", "iv", "v", "i"], mode: "minor", feel: "Cerrada, para letras de pérdida" },
];

/** Resuelve un grado romano ("vi", "♭VII", "V7", "iv") en la tonalidad. */
export function chordFromRoman(roman: string, key: Key): Chord | null {
  const m = roman.match(/^([♭b♯#]?)([ivIV]+)(°|ø7?|7|maj7|sus4|sus2)?$/);
  if (!m) return null;
  const [, acc, numeral, ext] = m;
  const idx = ROMAN.indexOf(numeral.toUpperCase());
  if (idx < 0) return null;
  const notes = scaleNotes(key);
  const shift = acc === "♭" || acc === "b" ? -1 : acc === "♯" || acc === "#" ? 1 : 0;
  // Con alteración el acorde ya no es diatónico: se toma la raíz alterada y la
  // cualidad que dicta la mayúscula/minúscula del numeral.
  const root = mod12(notes[idx] + shift);
  const lower = numeral === numeral.toLowerCase();
  let quality: Quality;
  if (ext === "°") quality = "dim";
  else if (ext === "ø" || ext === "ø7") quality = "m7b5";
  else if (ext === "7") quality = lower ? "m7" : "7";
  else if (ext === "maj7") quality = "maj7";
  else if (ext === "sus4") quality = "sus4";
  else if (ext === "sus2") quality = "sus2";
  else if (!acc && !ext) {
    // Sin alteración: respeta la cualidad diatónica salvo que el numeral la contradiga.
    const dia = diatonicChords(key)[idx].chord.quality;
    quality = lower ? (dia === "dim" ? "dim" : "min") : "maj";
  } else quality = lower ? "min" : "maj";
  return { root, quality };
}

/** Todas las tonalidades para el selector (12 tónicas × 2 modos). */
export const TONICS: { pc: Pc; sharp: string; flat: string }[] = SHARP_NAMES.map((s, i) => ({
  pc: i,
  sharp: s,
  flat: FLAT_NAMES[i],
}));

/** MIDI de una nota (índice cromático + octava). C4 = 60. */
export const midi = (pc: Pc, octave: number): number => 12 * (octave + 1) + mod12(pc);

/** Hz de un número MIDI. */
export const midiToHz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
