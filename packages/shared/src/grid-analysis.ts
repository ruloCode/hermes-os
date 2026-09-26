/**
 * ANÁLISIS EN LA REJILLA — la toma de fonemas leída como la leería un músico:
 * cada nota en su compás.tiempo, su largo en semicorcheas, qué es respecto del
 * acorde que suena (nota del acorde, tensión, paso, bordadura…), su dinámica
 * (0..100 → pp..ff), sus melismas y su vocal; por frase, anacrusa, sílabas por
 * compás, ámbito, contorno y final. "La música es un lenguaje matemático":
 * esto es la partitura en números, no una interpretación.
 *
 * Lógica pura. La rejilla NO se adivina: viaja con la toma (`TakeGrid`, se
 * grabó sobre la pista), así que compás y tiempo son medida, no estimación.
 */
import { chordIntervals, mod12, parseChord, scaleNotes, type Key } from "./music-theory.js";
import type { MelodyNote, Phrase, SungSyllable } from "./composicion.js";
import { fillerFlags, isAtonic, isFiller, markFillerStress, splitSyllables, stressedSyllable, type PitchTrack } from "./melody.js";
import { metricWeight, secPerStep, stepsPerBar, stepsPerBeat, toGrid, type GridSpec } from "./grid.js";
import type {
  ChordBar,
  ChordRole,
  Dynamic,
  GridAnalysis,
  GridNote,
  GridPhraseStats,
  Meter,
  TakeGrid,
} from "./tema.js";
import { vowelOfText } from "./vowels.js";

// ─────────────────────────── Utilidades ───────────────────────────

const round = (x: number, d = 3): number => {
  const k = 10 ** d;
  return Math.round(x * k) / k;
};
const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
const posMod = (n: number, m: number): number => ((n % m) + m) % m;

function median(a: number[]): number {
  const s = a.slice().sort((x, y) => x - y);
  if (!s.length) return NaN;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Percentil p (0..1) con interpolación lineal. */
function percentile(a: number[], p: number): number {
  const s = a.slice().sort((x, y) => x - y);
  if (!s.length) return NaN;
  const pos = (s.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

/** Número con coma decimal y sin ceros de cola: 1.5 → "1,5"; 2 → "2". */
const fmt = (x: number, d = 2): string => String(round(x, d)).replace(".", ",");

const specOf = (g: TakeGrid): GridSpec => ({
  bpm: g.bpm,
  meter: g.meter,
  downbeatSec: g.downbeatSec,
  swing: g.swing,
});

// ─────────────────────────── Sílabas sin texto ───────────────────────────

/** Hueco mínimo entre notas que ya es sílaba nueva (s). */
const SYL_GAP_SEC = 0.04;
/** Valle de energía alrededor del ataque que ya es sílaba nueva (dB). */
const SYL_VALLEY_DB = 6;

/**
 * ¿Hay un valle de energía entre dos notas? Mínimo de la energía en ±20 ms de
 * la juntura contra el máximo de CADA lado (hasta 100 ms dentro de cada nota):
 * la consonante que re-articula ("na·na", "dun·dun") baja la energía de los dos
 * lados; un crescendo no es un valle (solo baja de un lado).
 */
function valleyBetween(track: PitchTrack, prev: MelodyNote, cur: MelodyNote, dipDb: number): boolean {
  const rms = track.rmsDb;
  const n = rms.length;
  if (!n) return false;
  const fr = (t: number): number => Math.max(0, Math.min(n - 1, Math.round(t / track.hopSec)));
  const kEnd = fr(prev.end);
  const kStart = fr(cur.start);
  const reach = Math.max(1, Math.round(0.1 / track.hopSec));
  const near = Math.max(1, Math.round(0.02 / track.hopSec));
  let valley = Infinity;
  for (let k = Math.max(0, Math.min(kEnd, kStart) - near); k <= Math.min(n - 1, Math.max(kEnd, kStart) + near); k++)
    valley = Math.min(valley, rms[k]);
  let left = -Infinity;
  for (let k = Math.max(fr(prev.start), kEnd - reach); k < kEnd - near; k++) left = Math.max(left, rms[k]);
  let right = -Infinity;
  for (let k = kStart + near + 1; k <= Math.min(fr(cur.end), kStart + reach); k++) right = Math.max(right, rms[k]);
  if (!Number.isFinite(left) || !Number.isFinite(right) || !Number.isFinite(valley)) return false;
  return Math.min(left, right) - valley >= dipDb;
}

/**
 * Segundos SIN VOZ entre dos notas. El hueco que parte sílabas es donde la voz
 * se detiene (silencio o consonante sorda), no el tramo que `segmentNotes`
 * descarta en un portamento: medido con un deslizamiento sintético de 40 ms,
 * la transición queda como un "hueco" de 50 ms entre las notas, pero con voz
 * en todos sus cuadros — es legato, y ahí vive el melisma.
 */
function unvoicedBetween(track: PitchTrack, prev: MelodyNote, cur: MelodyNote): number {
  const n = track.f0.length;
  const a = Math.max(0, Math.round(prev.end / track.hopSec));
  const b = Math.min(n, Math.round(cur.start / track.hopSec));
  if (!n || b <= a) return Math.max(0, cur.start - prev.end);
  let silent = 0;
  for (let k = a; k < b; k++) if (!(track.f0[k] > 0)) silent++;
  return silent * track.hopSec;
}

/**
 * Sílabas de una toma SIN transcripción: entre dos notas seguidas empieza
 * sílaba nueva si hay un hueco ≥ 40 ms o un valle de energía ≥ 6 dB alrededor
 * del ataque; si no, es legato — la MISMA sílaba, y con otra altura es un
 * MELISMA (llena `parts`). Los acentos de relleno salen de notas largas/altas.
 *
 * El hueco cuenta los cuadros SIN VOZ entre las notas (ver `unvoicedBetween`):
 * un portamento deja un tramo con voz que no es nota y sigue siendo legato.
 * Las sílabas salen sin texto (`text: ""`, `filler: true`: es tarareo) y cada
 * una es su propia "palabra"; `applyHint` les pone texto si el humano lo
 * escribió. Los acentos son los MISMOS que los rellenos de una sesión
 * (`markFillerStress`): primero de cada grupo, notas largas y picos de altura.
 */
export function syllablesFromTrack(track: PitchTrack, notes: MelodyNote[]): SungSyllable[] {
  if (!notes.length) return [];
  const order = notes.map((_, i) => i).sort((a, b) => notes[a].start - notes[b].start);
  const groups: number[][] = [[order[0]]];
  for (let k = 1; k < order.length; k++) {
    const prev = notes[order[k - 1]];
    const cur = notes[order[k]];
    const cut =
      (cur.start - prev.end >= SYL_GAP_SEC && unvoicedBetween(track, prev, cur) >= SYL_GAP_SEC - 1e-9) ||
      valleyBetween(track, prev, cur, SYL_VALLEY_DB);
    if (cut) groups.push([order[k]]);
    else groups[groups.length - 1].push(order[k]);
  }
  const out: SungSyllable[] = groups.map((idx, w) => {
    let main = notes[idx[0]].midi;
    let mainDur = -Infinity;
    for (const j of idx) {
      const d = notes[j].end - notes[j].start;
      if (d > mainDur) {
        mainDur = d;
        main = notes[j].midi;
      }
    }
    const melisma = new Set(idx.map((j) => notes[j].midi)).size >= 2;
    const syl: SungSyllable = {
      text: "",
      start: round(notes[idx[0]].start),
      end: round(Math.max(...idx.map((j) => notes[j].end))),
      noteIdx: idx,
      midi: main,
      stressed: false,
      filler: true,
      melisma,
      word: w,
    };
    if (melisma) syl.parts = idx.map((j) => ({ midi: notes[j].midi, start: notes[j].start, end: notes[j].end }));
    return syl;
  });
  markFillerStress(out, notes);
  return out;
}

/** Unidades de la pista de texto: "nanana te quiero" → na·na·na·te·quie·ro, con su palabra. */
function hintUnits(hint: string): { text: string; word: number; filler: boolean; tonic: boolean }[] {
  const words = hint
    .normalize("NFC")
    .toLowerCase()
    .split(/[^a-záéíóúüñ]+/)
    .filter(Boolean);
  const flags = fillerFlags(words.map((text) => ({ text })));
  const out: { text: string; word: number; filler: boolean; tonic: boolean }[] = [];
  words.forEach((w, i) => {
    let units: string[];
    // Rellenos pegados se parten por su unidad ("nanana" = 3 sílabas); los
    // rellenos de una sola emisión ("yeah", "uh") no se silabean.
    if (/^(?:na|la|ti|ta|pa|ra|du+n|du+m|du+|pu+m|pa+m)+$/.test(w))
      units = w.match(/na|la|ti|ta|pa|ra|du+n|du+m|du+|pu+m|pa+m/g) ?? [w];
    else if (isFiller(w) || flags[i]) units = [w];
    else {
      const sy = splitSyllables(w);
      units = sy.length ? sy : [w];
    }
    // Las átonas ("te", "la", "de") no acentúan, como en anchorSyllables.
    const tonic = flags[i] || isAtonic(w) ? -1 : stressedSyllable(w);
    units.forEach((u, k) => out.push({ text: u, word: i, filler: flags[i], tonic: k === tonic }));
  });
  return out;
}

/**
 * Aplica la pista de texto del humano ("na na uh dun") a las sílabas: si el
 * conteo coincide, 1:1; si no, por proporción. Llena `text`, `filler` y `vowel`
 * (vowelSource "texto").
 *
 * La pista se silabea (rellenos pegados por unidad, palabras reales por el
 * silabeo del español) y `word` pasa a ser la palabra de la pista: así
 * `buildPhrases` junta "na·na·na" en "nanana". Con conteo exacto, las sílabas
 * de palabras reales toman el acento léxico; por proporción se conservan los
 * acentos musicales (el reparto ya es aproximado).
 */
export function applyHint(syllables: SungSyllable[], hint: string): SungSyllable[] {
  const units = hintUnits(hint);
  if (!units.length || !syllables.length) return syllables.map((s) => ({ ...s }));
  const S = syllables.length;
  const T = units.length;
  return syllables.map((s, i) => {
    const u = units[S === T ? i : Math.min(T - 1, Math.floor(((i + 0.5) * T) / S))];
    const out: SungSyllable = { ...s, text: u.text, filler: u.filler, word: u.word };
    if (S === T && !u.filler) out.stressed = u.tonic;
    const v = vowelOfText(u.text);
    if (v) {
      out.vowel = v;
      out.vowelSource = "texto";
    }
    return out;
  });
}

/**
 * La posición en la rejilla de cada sílaba (su ataque): `metric` para el
 * molde con rejilla (peso métrico y largo por posición). Helper para el
 * agente; no toca nada más.
 */
export function syllablesOnGrid(syllables: SungSyllable[], grid: TakeGrid): SungSyllable[] {
  const spec = specOf(grid);
  return syllables.map((s) => {
    const g = toGrid(s.start, spec);
    return { ...s, metric: { absStep: g.absStep, weight: metricWeight(g.stepInBar, grid.meter) } };
  });
}

// ─────────────────────────── Armonía ───────────────────────────

/** Acorde que suena en un paso absoluto (el loop se repite por módulo). */
export function chordAt(loop: ChordBar[], absStep: number, meter: Meter): string | null {
  if (!loop.length) return null;
  const spb = stepsPerBar(meter);
  const spbeat = stepsPerBeat(meter);
  const s = Math.floor(absStep);
  const bar = Math.floor(s / spb);
  const inBar = s - bar * spb;
  // Si el compás no tiene acorde que ya haya entrado, sigue sonando el último
  // del compás anterior (la anacrusa cae sobre el final del loop anterior).
  for (let back = 0; back < loop.length; back++) {
    const chords = loop[posMod(bar - back, loop.length)].chords.slice().sort((a, b) => a.beat - b.beat);
    for (let c = chords.length - 1; c >= 0; c--)
      if (back > 0 || chords[c].beat * spbeat <= inBar) return chords[c].symbol;
  }
  return null;
}

/** Función de cada intervalo (plegado a la octava) dentro de un acorde. */
const TONE_LABEL: Record<number, string> = {
  0: "R",
  1: "9",
  2: "9",
  3: "3",
  4: "3",
  5: "11",
  6: "5",
  7: "5",
  8: "5",
  9: "13",
  10: "7",
  11: "7",
};

/** Función de la nota en el acorde ("R", "3", "5", "7", "9", "11", "13") o null si no pertenece. */
export function chordToneOf(midi: number, chordSymbol: string): string | null {
  const chord = parseChord(chordSymbol);
  if (!chord) return null;
  const iv = mod12(midi - chord.root);
  // El 9 del add9 y el 2/4 de los sus son del acorde: se nombran como tensión (9/11).
  return chordIntervals(chord).some((i) => mod12(i) === iv) ? TONE_LABEL[iv] : null;
}

const MAJOR_DEGREES = ["1", "♭2", "2", "♭3", "3", "4", "♯4", "5", "♭6", "6", "♭7", "7"];
/** En menor el 3, el 6 y el 7 de la escala son los naturales; las alteraciones son hacia arriba (♯7 = sensible). */
const MINOR_DEGREES = ["1", "♭2", "2", "3", "♯3", "4", "♯4", "5", "6", "♯6", "7", "♯7"];

/**
 * Grado de la nota en la tonalidad ("1", "♭3", "♯4", "5"…). Relativo a la
 * escala de la tonalidad: en La menor el Do es el "3" (como su acorde es el
 * III) y el Sol♯ es "♯7" (la sensible de la menor armónica).
 */
export function scaleDegreeOf(midi: number, key: Key): string {
  const iv = mod12(midi - key.tonic);
  return (key.mode === "major" ? MAJOR_DEGREES : MINOR_DEGREES)[iv];
}

/**
 * Rol de una nota respecto del acorde: nota del acorde → acorde; paso por
 * grado con la misma dirección entre notas del acorde → paso; ida y vuelta por
 * grado → bordadura; en posición fuerte que resuelve por grado → apoyatura; en
 * posición débil que ya es nota del acorde siguiente → anticipacion; fuera de
 * la escala → fuera; el resto diatónico → tension.
 *
 * "Por grado" = 1 o 2 semitonos. El paso pide que al menos UNO de sus vecinos
 * sea nota del acorde (en una escala corrida C-D-E-F-G sobre Do, el Re y el Fa
 * son paso aunque la corrida siga), y la bordadura no lo exige (vuelve a la
 * misma nota, sea cual sea). Las reglas se aplican en ese orden: la primera
 * que calza manda, así un cromatismo de paso es "paso" y no "fuera".
 */
export function classifyRole(input: {
  prevMidi: number | null;
  midi: number;
  nextMidi: number | null;
  chord: string | null;
  nextChord: string | null;
  weight: number;
  key: Key;
}): ChordRole {
  const { prevMidi, midi, nextMidi, chord, nextChord, weight, key } = input;
  const isTone = (m: number, c: string | null): boolean => c != null && chordToneOf(m, c) != null;
  if (isTone(midi, chord)) return "acorde";
  const byStep = (a: number, b: number): boolean => {
    const d = Math.abs(a - b);
    return d >= 1 && d <= 2;
  };
  const target = nextChord ?? chord;
  if (
    prevMidi != null &&
    nextMidi != null &&
    byStep(prevMidi, midi) &&
    byStep(midi, nextMidi) &&
    Math.sign(midi - prevMidi) === Math.sign(nextMidi - midi) &&
    (isTone(prevMidi, chord) || isTone(nextMidi, target))
  )
    return "paso";
  if (prevMidi != null && nextMidi != null && prevMidi === nextMidi && byStep(prevMidi, midi)) return "bordadura";
  if (weight >= 3 && nextMidi != null && byStep(midi, nextMidi) && isTone(nextMidi, target)) return "apoyatura";
  if (weight <= 1 && nextChord != null && nextChord !== chord && isTone(midi, nextChord)) return "anticipacion";
  if (!scaleNotes(key).includes(mod12(midi))) return "fuera";
  return "tension";
}

// ─────────────────────────── Dinámica ───────────────────────────

/** Velocidad de una toma pareja (o de una nota sin cuadros): mf. */
const EVEN_VELOCITY = 55;
/** Por debajo de este rango (p95 − p10, dB) la toma se considera pareja. */
const EVEN_SPREAD_DB = 3;
/** Ancho mínimo de la escala de dinámica (dB). */
const MIN_WIDTH_DB = 12;

/**
 * Dinámica por nota 0..100: p10..p95 de la energía de los cuadros con voz de ESTA toma → 5..95.
 *
 * Los cuadros "con voz" son los del cuerpo de cada nota (sin el 20 % del
 * ataque ni el 10 % final) y el nivel de la nota es su mediana (un golpe de
 * consonante no la sube). Relativa a la toma a propósito: la ganancia del micrófono y la
 * distancia cambian de una toma a otra, así que "ff" es "lo más fuerte que
 * cantaste aquí", no un nivel absoluto.
 *
 * La escala solo se estira cuando hay variación REAL: con p10..p95 de menos
 * de 3 dB la toma es pareja y todas las notas van a 55 (mf); con menos de
 * 12 dB se mide en una ventana de 12 dB anclada en la mediana (mediana → 55),
 * así 2 dB de diferencia no se leen como pp→ff (con p10..p95 a secas, una toma
 * pareja salía toda ff: el ruido de 1 dB se estiraba a 90 puntos). Desde 12 dB
 * de rango rige p10 → 5 y p95 → 95.
 */
export function noteVelocities(notes: MelodyNote[], rmsDb: Float32Array, hopSec: number): number[] {
  const n = rmsDb.length;
  if (!notes.length) return [];
  if (!n || !(hopSec > 0)) return notes.map(() => EVEN_VELOCITY);
  // El CUERPO de la nota (20 %..90 %, como segmentNotes): el ataque y la caída
  // son rampas de energía que no son dinámica — con ellas dentro, el p10 lo
  // ponían los bordes y una toma pareja quedaba entera arriba de la escala.
  const span = (nt: MelodyNote): [number, number] => {
    const a0 = Math.max(0, Math.min(n - 1, Math.round(nt.start / hopSec)));
    const b0 = Math.max(a0 + 1, Math.min(n, Math.round(nt.end / hopSec)));
    const len = b0 - a0;
    if (len < 5) return [a0, b0];
    return [a0 + Math.floor(len * 0.2), a0 + Math.max(Math.ceil(len * 0.9), 1)];
  };
  const voiced = new Uint8Array(n);
  const levels = notes.map((nt) => {
    const [a, b] = span(nt);
    const v: number[] = [];
    for (let k = a; k < b; k++) {
      if (!Number.isFinite(rmsDb[k])) continue;
      voiced[k] = 1;
      v.push(rmsDb[k]);
    }
    return v.length ? median(v) : NaN;
  });
  const all: number[] = [];
  for (let k = 0; k < n; k++) if (voiced[k]) all.push(rmsDb[k]);
  if (!all.length) return notes.map(() => EVEN_VELOCITY);
  const p10 = percentile(all, 0.1);
  const p95 = percentile(all, 0.95);
  const spread = p95 - p10;
  if (!(spread >= EVEN_SPREAD_DB)) return notes.map(() => EVEN_VELOCITY);
  let lo = p10;
  let width = spread;
  if (spread < MIN_WIDTH_DB) {
    // Ventana de 12 dB con la mediana en 55: lo = mediana − (55 − 5)/90 · 12.
    width = MIN_WIDTH_DB;
    lo = percentile(all, 0.5) - ((EVEN_VELOCITY - 5) / 90) * width;
  }
  return levels.map((l) =>
    Number.isFinite(l) ? Math.round(5 + 90 * clamp01((l - lo) / width)) : EVEN_VELOCITY,
  );
}

/** 0..100 → pp < 17 ≤ p < 34 ≤ mp < 51 ≤ mf < 68 ≤ f < 85 ≤ ff. */
export function dynamicOf(velocity: number): Dynamic {
  return velocity < 17 ? "pp" : velocity < 34 ? "p" : velocity < 51 ? "mp" : velocity < 68 ? "mf" : velocity < 85 ? "f" : "ff";
}

// ─────────────────────────── La toma en la rejilla ───────────────────────────

/** Silencio entre notas que ya no las hace vecinas (mismo corte que las frases). */
const NEIGHBOR_GAP_SEC = 0.6;

/** Detalle que la lectura de `analyzeOnGrid` agrega sobre lo que trae `GridPhraseStats`. */
interface PhraseExtras {
  melismas: { notes: number; vowel?: string }[];
  dynamics: { from: Dynamic; to: Dynamic } | null;
}

function contourOf(m: number[]): GridPhraseStats["contour"] {
  if (m.length < 2) return "plano";
  const a = m[0];
  const z = m[m.length - 1];
  const hi = Math.max(...m);
  const lo = Math.min(...m);
  if (hi - lo <= 1) return "plano";
  const inner = (i: number): boolean => i > 0 && i < m.length - 1;
  if (inner(m.indexOf(hi)) && hi - Math.max(a, z) >= 2) return "arco";
  if (inner(m.indexOf(lo)) && Math.min(a, z) - lo >= 2) return "valle";
  if (z - a >= 2) return "asc";
  if (a - z >= 2) return "desc";
  return "plano";
}

/**
 * Cuánto habría que mover la rejilla (ms, con signo; + = más tarde) para que
 * los ataques caigan donde un músico los pondría. Se prueban corrimientos de
 * ±(0,6 semicorchea, tope 150 ms) cada 5 ms puntuando cada ataque por el peso
 * de la posición donde cae (±35 ms): una latencia mal medida corre TODOS los
 * ataques, y los que eran tiempos vuelven a caer en tiempos. El tope de 0,6
 * semicorchea evita "corregir" una melodía cantada a contratiempo a propósito
 * (moverla una semicorchea entera también la haría caer en tiempos). Después
 * se refina con la mediana de los ataques fuertes. null = no parece corrida.
 */
function suggestShift(starts: number[], grid: TakeGrid): { shiftMs: number | null } {
  const sps = secPerStep(grid.bpm, grid.meter);
  const range = Math.min(0.15, 0.6 * sps);
  const TOL = 0.035;
  const W = [0.25, 0.5, 1, 1.5, 2];
  const base = specOf(grid);
  const score = (d: number): number => {
    const g = { ...base, downbeatSec: base.downbeatSec + d };
    let s = 0;
    for (const t of starts) {
      const q = toGrid(t, g);
      const off = Math.abs(q.offSec);
      if (off <= TOL) s += W[metricWeight(q.stepInBar, grid.meter)] * (1 - off / TOL / 2);
    }
    return s;
  };
  let bestD = 0;
  let bestS = score(0);
  const s0 = bestS;
  for (let d = -range; d <= range + 1e-9; d += 0.005) {
    const s = score(d);
    if (s > bestS + 1e-9 || (Math.abs(s - bestS) <= 1e-9 && Math.abs(d) < Math.abs(bestD))) {
      bestS = s;
      bestD = d;
    }
  }
  // Solo se cambia de alineación si es CLARAMENTE mejor (15 %): con la rejilla
  // bien puesta, el ruido del canto no debe inventar un corrimiento.
  const d0 = bestS >= s0 * 1.15 ? bestD : 0;
  const g = { ...base, downbeatSec: base.downbeatSec + d0 };
  const offs: number[] = [];
  for (const t of starts) {
    const q = toGrid(t, g);
    if (metricWeight(q.stepInBar, grid.meter) >= 2) offs.push(q.offSec);
  }
  if (offs.length < 4) return { shiftMs: null };
  const shiftMs = Math.round((d0 + median(offs)) * 1000);
  return { shiftMs: Math.abs(shiftMs) > 25 ? shiftMs : null };
}

/**
 * La toma entera en la rejilla: notas, estadísticas por frase, desvío y lectura.
 *
 * - Cada nota: ataque → compás/paso (`toGrid`, con swing y anacrusa), largo
 *   en semicorcheas (≥ 1), desvío en ms, peso métrico, síncopa (ataque débil
 *   que se sostiene sobre un tiempo), acorde que suena, grado, función en el
 *   acorde, rol, intervalo desde la vecina (null tras un silencio de > 0,6 s),
 *   dinámica relativa a la toma y la vocal de su sílaba.
 * - Por frase (las que tienen notas): anacrusa (si entra en la 2ª mitad del
 *   compás, cuenta hasta el siguiente 1), largo en compases (a ¼), sílabas por
 *   compás, % de melisma, ámbito, contorno, final, síncopa y % de notas del
 *   acorde en tiempos fuertes (peso ≥ 3; sin ninguna, peso ≥ 2).
 * - `medianOffMs`: mediana del desvío de los ataques con peso ≥ 2.
 * - `suggestShiftMs`: ver `suggestShift`; solo con |corrimiento| > 25 ms y ≥ 4
 *   ataques fuertes.
 */
export function analyzeOnGrid(input: {
  notes: MelodyNote[];
  phrases: Phrase[];
  track: PitchTrack;
  grid: TakeGrid;
}): GridAnalysis {
  const { notes, phrases, track, grid } = input;
  const meter = grid.meter;
  const spec = specOf(grid);
  const sps = secPerStep(grid.bpm, meter);
  const spb = stepsPerBar(meter);
  const velocities = noteVelocities(notes, track.rmsDb, track.hopSec);

  // Sílaba de cada nota (para la vocal).
  const sylOf = new Map<number, SungSyllable>();
  for (const ph of phrases) for (const s of ph.syllables) for (const j of s.noteIdx) if (!sylOf.has(j)) sylOf.set(j, s);

  const order = notes.map((_, i) => i).sort((a, b) => notes[a].start - notes[b].start);
  const pos = order.map((i) => toGrid(notes[i].start, spec));
  const gridNotes: GridNote[] = order.map((i, k) => {
    const nt = notes[i];
    const q = pos[k];
    const len16 = Math.max(1, Math.round((nt.end - nt.start) / sps));
    const weight = metricWeight(q.stepInBar, meter);
    let syncopated = false;
    if (weight < 3)
      for (let s = q.absStep + 1; s < q.absStep + len16 && !syncopated; s++) {
        const w = metricWeight(posMod(s, spb), meter);
        if (w >= 2 && w > weight) syncopated = true;
      }
    const prev = k > 0 && nt.start - notes[order[k - 1]].end <= NEIGHBOR_GAP_SEC ? notes[order[k - 1]] : null;
    const nextI = k + 1 < order.length && notes[order[k + 1]].start - nt.end <= NEIGHBOR_GAP_SEC ? k + 1 : -1;
    const next = nextI >= 0 ? notes[order[nextI]] : null;
    const chord = chordAt(grid.loop, q.absStep, meter);
    const nextChord = chordAt(grid.loop, nextI >= 0 ? pos[nextI].absStep : q.absStep + len16, meter);
    const velocity = velocities[i] ?? 50;
    const gn: GridNote = {
      i,
      bar: q.bar,
      stepInBar: q.stepInBar,
      absStep: q.absStep,
      len16,
      offMs: Math.round(q.offSec * 1000),
      weight,
      syncopated,
      chord,
      degree: scaleDegreeOf(nt.midi, grid.key),
      chordTone: chord ? chordToneOf(nt.midi, chord) : null,
      role: classifyRole({
        prevMidi: prev ? prev.midi : null,
        midi: nt.midi,
        nextMidi: next ? next.midi : null,
        chord,
        nextChord,
        weight,
        key: grid.key,
      }),
      interval: prev ? nt.midi - prev.midi : null,
      velocity,
      dynamic: dynamicOf(velocity),
    };
    const v = sylOf.get(i)?.vowel;
    if (v) gn.vowel = v;
    return gn;
  });
  const byIndex = new Map(gridNotes.map((g) => [g.i, g]));

  const stats: GridPhraseStats[] = [];
  const extras: PhraseExtras[] = [];
  for (const ph of phrases) {
    const idx = Array.from(new Set(ph.syllables.flatMap((s) => s.noteIdx)))
      .filter((j) => byIndex.has(j))
      .sort((a, b) => notes[a].start - notes[b].start);
    if (!idx.length) continue;
    const gn = idx.map((j) => byIndex.get(j) as GridNote);
    const first = gn[0];
    const last = gn[gn.length - 1];
    let startBar = first.bar;
    let pickup16 = 0;
    // Entrar en la segunda mitad del compás = anacrusa del siguiente.
    if (first.stepInBar !== 0 && first.stepInBar >= spb / 2) {
      startBar = first.bar + 1;
      pickup16 = spb - first.stepInBar;
    }
    const lenBars = Math.max(0.25, Math.round(((last.absStep + last.len16 - first.absStep) / spb) * 4) / 4);
    const nSyl = ph.syllables.length;
    const midis = idx.map((j) => notes[j].midi);
    let strong = gn.filter((g) => g.weight >= 3);
    if (!strong.length) strong = gn.filter((g) => g.weight >= 2);
    stats.push({
      idx: ph.idx,
      startBar,
      pickup16,
      lenBars,
      syllablesPerBar: round(nSyl / lenBars, 2),
      melismaPct: nSyl ? Math.round((100 * ph.syllables.filter((s) => s.melisma).length) / nSyl) : 0,
      range: { lo: Math.min(...midis), hi: Math.max(...midis) },
      contour: contourOf(midis),
      endsOn: { degree: last.degree, chordTone: last.chordTone, weight: last.weight },
      syncopationPct: Math.round((100 * gn.filter((g) => g.syncopated).length) / gn.length),
      strongChordTonePct: strong.length
        ? Math.round((100 * strong.filter((g) => g.chordTone != null).length) / strong.length)
        : 0,
    });
    const half = Math.max(1, Math.floor(gn.length / 2));
    const avg = (xs: GridNote[]): number => xs.reduce((a, g) => a + g.velocity, 0) / xs.length;
    extras.push({
      melismas: ph.syllables
        .filter((s) => s.melisma)
        .map((s) => ({ notes: s.noteIdx.length, ...(s.vowel ? { vowel: s.vowel } : {}) })),
      dynamics:
        gn.length >= 2
          ? { from: dynamicOf(avg(gn.slice(0, half))), to: dynamicOf(avg(gn.slice(gn.length - half))) }
          : { from: first.dynamic, to: first.dynamic },
    });
  }

  const strongOffs = gridNotes.filter((g) => g.weight >= 2).map((g) => g.offMs);
  const offs = strongOffs.length ? strongOffs : gridNotes.map((g) => g.offMs);
  const medianOffMs = offs.length ? Math.round(median(offs)) : 0;
  const { shiftMs } = suggestShift(
    order.map((i) => notes[i].start),
    grid,
  );

  return {
    bpm: grid.bpm,
    meter,
    downbeatSec: grid.downbeatSec,
    key: grid.key,
    notes: gridNotes,
    phrases: stats,
    medianOffMs,
    suggestShiftMs: shiftMs,
    readout: stats.map((s, k) => describe(s, meter, extras[k])),
  };
}

// ─────────────────────────── Lectura ───────────────────────────

const INTERVAL_NAME = [
  "unísono",
  "2ª menor",
  "2ª mayor",
  "3ª menor",
  "3ª mayor",
  "4ª justa",
  "tritono",
  "5ª justa",
  "6ª menor",
  "6ª mayor",
  "7ª menor",
  "7ª mayor",
  "octava",
  "9ª menor",
  "9ª mayor",
  "10ª menor",
  "10ª mayor",
  "11ª justa",
  "11ª aumentada",
  "12ª justa",
  "13ª menor",
  "13ª mayor",
  "14ª menor",
  "14ª mayor",
  "dos octavas",
];

/** Nombre del intervalo en español ("7ª menor"); más de dos octavas, en semitonos. */
export function intervalName(semitones: number): string {
  const s = Math.abs(Math.round(semitones));
  return INTERVAL_NAME[s] ?? `${s} semitonos`;
}

const TONE_WORD: Record<string, string> = {
  R: "la fundamental del acorde",
  "3": "la 3ª del acorde",
  "5": "la 5ª del acorde",
  "7": "la 7ª del acorde",
  "9": "la 9ª del acorde",
  "11": "la 11ª del acorde",
  "13": "la 13ª del acorde",
};

function positionWord(weight: number, meter: Meter): string {
  if (weight >= 4) return "en el primer tiempo";
  if (weight === 3) return meter === "6/8" ? "en el segundo pulso" : "en tiempo fuerte";
  if (weight === 2) return "en tiempo débil";
  if (weight === 1) return "a contratiempo";
  return "en semicorchea";
}

const CONTOUR_WORD: Record<GridPhraseStats["contour"], string> = {
  asc: "ascendente",
  desc: "descendente",
  arco: "en arco",
  valle: "en valle",
  plano: "plano",
};

/** "3 y 2" · "3, 2 y 4". */
const listY = (xs: string[]): string =>
  xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`;

function describe(stats: GridPhraseStats, meter: Meter, extras?: PhraseExtras): string {
  const parts: string[] = [];
  parts.push(stats.pickup16 > 0 ? `anacrusa de ${stats.pickup16}/16` : "entra en el tiempo");
  const syl = Math.round(stats.syllablesPerBar * stats.lenBars);
  const bars = stats.lenBars === 1 ? "1 compás" : `${fmt(stats.lenBars)} compases`;
  parts.push(`${syl} ${syl === 1 ? "sílaba" : "sílabas"} en ${bars}`);
  const mel = extras ? extras.melismas.length : Math.round((stats.melismaPct * syl) / 100);
  if (!mel) parts.push("sin melismas");
  else {
    let s = `${mel} ${mel === 1 ? "melisma" : "melismas"}`;
    if (extras?.melismas.length) {
      const vowels = Array.from(new Set(extras.melismas.map((m) => m.vowel).filter((v): v is string => !!v)));
      const counts = listY(extras.melismas.map((m) => String(m.notes)));
      s += ` (${counts} notas${vowels.length ? `, sobre ${vowels.join("/")}` : ""})`;
    }
    parts.push(s);
  }
  const tone = stats.endsOn.chordTone
    ? TONE_WORD[stats.endsOn.chordTone] ?? `la ${stats.endsOn.chordTone}ª del acorde`
    : `el grado ${stats.endsOn.degree} (fuera del acorde)`;
  parts.push(`termina en ${tone} ${positionWord(stats.endsOn.weight, meter)}`);
  parts.push(`${stats.strongChordTonePct} % notas del acorde en tiempos fuertes`);
  parts.push(`síncopa ${stats.syncopationPct} %`);
  parts.push(`ámbito ${intervalName(stats.range.hi - stats.range.lo)}`);
  parts.push(`contorno ${CONTOUR_WORD[stats.contour]}`);
  if (extras?.dynamics)
    parts.push(
      extras.dynamics.from === extras.dynamics.to
        ? extras.dynamics.from
        : `${extras.dynamics.from}→${extras.dynamics.to}`,
    );
  return parts.join(" · ");
}

/**
 * Una frase en números, legible: "anacrusa de 2/16 · 7 sílabas en 1,5
 * compases · 2 melismas (3 y 2 notas, sobre a/o) · termina en la 3ª del acorde
 * en tiempo fuerte · 71 % notas del acorde en tiempos fuertes · síncopa 38 % ·
 * ámbito 7ª menor · mf→f".
 *
 * Desde `GridPhraseStats` sola salen el conteo de melismas y todo lo demás;
 * el detalle de cada melisma (notas y vocal) y la dinámica no viajan en las
 * estadísticas: `analyzeOnGrid` los agrega en su `readout`.
 */
export function describeGridPhrase(stats: GridPhraseStats, meter: Meter): string {
  return describe(stats, meter);
}
