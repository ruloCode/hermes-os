/**
 * Cómo se LEE una toma en la rejilla (Análisis): nombres de figura, posición
 * compás.tiempo, grado sobre el acorde, la ficha de una nota y los mapas de
 * color por rol y por dinámica. Lógica pura de presentación — el análisis en
 * sí (qué rol tiene cada nota, su dinámica) viene medido del agente
 * (`GridAnalysis`); aquí solo se dice en palabras de músico.
 *
 * Los mapas de clases son ESTÁTICOS a propósito: Tailwind purga las clases
 * interpoladas (`fill-${x}`) y el color quedaría vacío en producción.
 */
import type {
  ChordBar,
  ChordRole,
  Dynamic,
  GridAnalysis,
  GridNote,
  Key,
  Meter,
  PassageAnalysis,
  SungSyllable,
  Vowel,
} from "@hermes/shared";
import { beatsPerBar, secPerStep, stepsPerBar, stepsPerBeat } from "@hermes/shared";
import { keyLabel } from "@/lib/music-theory";
import { midiName } from "../playground/format";

// ─────────────────────────── Roles y dinámica ───────────────────────────

/**
 * Color por rol respecto del acorde. La familia azul son notas del acorde
 * (llena = el que suena; hueca = la del acorde que VIENE: anticipación); cian
 * = de paso; gris = bordadura; verde = apoyatura (disonancia en tiempo fuerte
 * que resuelve); violeta = tensión; ámbar = fuera de la tonalidad (el ámbar
 * es estado, igual que en el piano roll del memo).
 */
export const ROLE_STYLE: Record<ChordRole, { fill: string; stroke: string; swatch: string; label: string; short: string }> = {
  acorde: { fill: "fill-blue/55", stroke: "stroke-blue", swatch: "border-blue bg-blue/55", label: "nota del acorde", short: "acorde" },
  tension: { fill: "fill-chart-4/50", stroke: "stroke-chart-4", swatch: "border-chart-4 bg-chart-4/50", label: "tensión", short: "tensión" },
  paso: { fill: "fill-cyan/45", stroke: "stroke-cyan", swatch: "border-cyan bg-cyan/45", label: "nota de paso", short: "paso" },
  bordadura: { fill: "fill-text-dim/30", stroke: "stroke-text-dim", swatch: "border-text-dim bg-text-dim/30", label: "bordadura", short: "bordadura" },
  apoyatura: { fill: "fill-green/50", stroke: "stroke-green", swatch: "border-green bg-green/50", label: "apoyatura", short: "apoyatura" },
  anticipacion: { fill: "fill-blue/12", stroke: "stroke-blue", swatch: "border-blue bg-blue/12", label: "anticipación (del acorde que viene)", short: "anticipación" },
  fuera: { fill: "fill-amber/55", stroke: "stroke-amber", swatch: "border-amber bg-amber/55", label: "fuera de la tonalidad", short: "fuera" },
};

export const ROLE_ORDER: ChordRole[] = ["acorde", "anticipacion", "paso", "bordadura", "apoyatura", "tension", "fuera"];

export const DYNAMICS: Dynamic[] = ["pp", "p", "mp", "mf", "f", "ff"];

/**
 * Franja de dinámica tipo heatmap: una rampa del color del TEXTO (gris que se
 * oscurece en claro y se aclara en oscuro). No usa el acento: la dinámica es
 * medida, no una acción ni una selección.
 */
export const DYN_FILL: Record<Dynamic, string> = {
  pp: "fill-text/10",
  p: "fill-text/20",
  mp: "fill-text/35",
  mf: "fill-text/50",
  f: "fill-text/70",
  ff: "fill-text/90",
};
export const DYN_BG: Record<Dynamic, string> = {
  pp: "bg-text/10",
  p: "bg-text/20",
  mp: "bg-text/35",
  mf: "bg-text/50",
  f: "bg-text/70",
  ff: "bg-text/90",
};
/** Texto legible SOBRE la celda: claro en las celdas oscuras. */
export const DYN_INK: Record<Dynamic, string> = {
  pp: "fill-text-dim",
  p: "fill-text-dim",
  mp: "fill-text",
  mf: "fill-panel",
  f: "fill-panel",
  ff: "fill-panel",
};

// ─────────────────────────── Figuras y tiempos ───────────────────────────

/** Figuras por su largo en semicorcheas (la semicorchea es el paso de la rejilla en cualquier compás). */
const FIGURES: { len: number; name: string; glyph?: string }[] = [
  { len: 16, name: "redonda" },
  { len: 12, name: "blanca con puntillo" },
  { len: 8, name: "blanca" },
  { len: 6, name: "negra con puntillo", glyph: "♩." },
  { len: 4, name: "negra", glyph: "♩" },
  { len: 3, name: "corchea con puntillo", glyph: "♪." },
  { len: 2, name: "corchea", glyph: "♪" },
  { len: 1, name: "semicorchea" },
];

/** "negra con puntillo" · "blanca + corchea" (ligadas) — voraz de la más larga a la más corta. */
export function figureName(len16: number): string {
  let rest = Math.max(1, Math.round(len16));
  const parts: string[] = [];
  while (rest > 0 && parts.length < 6) {
    const f = FIGURES.find((x) => x.len <= rest) ?? FIGURES[FIGURES.length - 1];
    parts.push(f.name);
    rest -= f.len;
  }
  return parts.join(" + ");
}

/** El glifo de la figura si es una sola y lo tiene (♩ ♩. ♪ ♪.); null si no. */
export function figureGlyph(len16: number): string | null {
  return FIGURES.find((x) => x.len === Math.round(len16))?.glyph ?? null;
}

const FRACTIONS: Record<string, string> = {
  "1/4": "¼",
  "1/2": "½",
  "3/4": "¾",
  "1/3": "⅓",
  "2/3": "⅔",
  "1/6": "⅙",
  "5/6": "⅚",
};

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/** n/d → "½" (o "3/8" si no hay glifo). */
function frac(n: number, d: number): string {
  const g = gcd(n, d);
  const k = `${n / g}/${d / g}`;
  return FRACTIONS[k] ?? k;
}

/** Tiempos (pulsos) de un largo en semicorcheas: 6 pasos en 4/4 → "1½". */
export function beatsText(len16: number, meter: Meter): string {
  const spb = stepsPerBeat(meter);
  const whole = Math.floor(len16 / spb);
  const rest = len16 - whole * spb;
  if (!rest) return String(whole);
  return `${whole || ""}${frac(rest, spb)}`;
}

/** Tiempo 1-based de un paso dentro del compás, con su fracción: "3", "3½", "4¾". */
export function beatOf(stepInBar: number, meter: Meter): string {
  const spb = stepsPerBeat(meter);
  const beat = Math.floor(stepInBar / spb) + 1;
  const sub = stepInBar - (beat - 1) * spb;
  return sub ? `${beat}${frac(sub, spb)}` : String(beat);
}

/** "c.2 t.3½" (compás ≤ 0 = anacrusa). */
export function posText(n: Pick<GridNote, "bar" | "stepInBar">, meter: Meter): string {
  return `c.${n.bar} t.${beatOf(n.stepInBar, meter)}`;
}

/** Función en el acorde en palabras: "R" → "fundamental", "3" → "3ª". */
export function toneText(tone: string): string {
  if (tone === "R" || tone === "1") return "fundamental";
  return `${tone.replace(/^b/, "♭").replace(/^#/, "♯")}ª`;
}

/** "3ª de G" · "paso sobre G" · "sin acorde". */
export function overChord(n: GridNote): string {
  if (!n.chord) return n.bar <= 0 ? "anacrusa (sin acorde)" : "sin acorde";
  if (n.chordTone) return `${toneText(n.chordTone)} de ${n.chord}`;
  return `${ROLE_STYLE[n.role].short} sobre ${n.chord}`;
}

// ─────────────────────────── La toma leída ───────────────────────────

/** Una nota de la rejilla con su altura (la altura vive en `PassageAnalysis.notes`). */
export interface GridRow {
  /** Índice en `grid.notes` (orden de la rejilla). */
  k: number;
  g: GridNote;
  midi: number;
  cents: number;
  /** Segundo del ataque en el audio de la toma. */
  start: number;
  end: number;
  /** Altura dudosa: quedó entre dos semitonos. Se dibuja punteada con "?"; nunca se esconde. */
  doubtful: boolean;
}

/** Desvío de afinación a partir del cual la nota se marca dudosa (entre dos semitonos). */
export const DOUBT_CENTS = 30;

export function gridRows(grid: GridAnalysis, analysis: PassageAnalysis): GridRow[] {
  return grid.notes
    .map((g, k) => {
      const n = analysis.notes[g.i];
      if (!n) return null;
      return { k, g, midi: n.midi, cents: n.cents, start: n.start, end: n.end, doubtful: Math.abs(n.cents) >= DOUBT_CENTS };
    })
    .filter((r): r is GridRow => r !== null);
}

/** Sílabas de la toma con su paso en la rejilla (el del análisis o, si falta, desde su segundo). */
export interface GridSyllable {
  s: SungSyllable;
  phrase: number;
  step: number;
  endStep: number;
  vowel: Vowel | null;
}

export function gridSyllables(grid: GridAnalysis, analysis: PassageAnalysis): GridSyllable[] {
  const sps = secPerStep(grid.bpm, grid.meter);
  const toStep = (t: number) => (t - grid.downbeatSec) / sps;
  return analysis.phrases.flatMap((ph) =>
    ph.syllables.map((s) => ({
      s,
      phrase: ph.idx,
      step: s.metric?.absStep ?? Math.round(toStep(s.start)),
      endStep: toStep(s.end),
      vowel: s.vowel ?? null,
    })),
  );
}

/** Frase a la que pertenece cada nota (por los índices de sus sílabas). */
export function phraseOfNotes(analysis: PassageAnalysis): Map<number, number> {
  const out = new Map<number, number>();
  for (const ph of analysis.phrases)
    for (const s of ph.syllables) for (const i of s.noteIdx) if (!out.has(i)) out.set(i, ph.idx);
  return out;
}

/** Sílaba (y vocal) que canta cada nota. */
export function syllableOfNotes(analysis: PassageAnalysis): Map<number, SungSyllable> {
  const out = new Map<number, SungSyllable>();
  for (const ph of analysis.phrases) for (const s of ph.syllables) for (const i of s.noteIdx) if (!out.has(i)) out.set(i, s);
  return out;
}

/** "B4 · c.1 t.3 · 1½ t (negra con puntillo) · 3ª de G · vocal a · dinámica 72 → f". */
export function noteCard(row: GridRow, grid: GridAnalysis, key: Key, vowel: Vowel | null): string[] {
  const g = row.g;
  const parts = [
    midiName(row.midi, key, "en"),
    posText(g, grid.meter),
    `${beatsText(g.len16, grid.meter)} t (${figureName(g.len16)})`,
    overChord(g),
    vowel ? `vocal ${vowel}` : null,
    `dinámica ${Math.round(g.velocity)} → ${g.dynamic}`,
  ];
  return parts.filter((p): p is string => !!p);
}

/** Lo que la ficha agrega en gris: grado, rol, desvío, síncopa, duda. */
export function noteExtras(row: GridRow, key: Key): string[] {
  const g = row.g;
  const out = [`grado ${g.degree} en ${keyLabel(key)}`];
  if (g.chordTone == null || g.role !== "acorde") out.push(ROLE_STYLE[g.role].label);
  if (g.bar <= 0) out.push("anacrusa");
  if (g.syncopated) out.push("síncopa");
  if (Math.abs(g.offMs) >= 12) out.push(`entra ${Math.abs(Math.round(g.offMs))} ms ${g.offMs > 0 ? "tarde" : "antes"}`);
  if (row.doubtful) out.push(`altura dudosa (${row.cents > 0 ? "+" : "−"}${Math.abs(Math.round(row.cents))} c: entre dos semitonos)`);
  return out;
}

// ─────────────────────────── Acordes en la rejilla ───────────────────────────

export interface ChordSpan {
  symbol: string;
  from: number;
  to: number;
  /** En la anacrusa (compás ≤ 0): el análisis la lee contra el loop por módulo, pero en la
   *  primera vuelta ahí solo sonaba la cuenta — se dibuja tenue. */
  pickup: boolean;
}

/**
 * Los acordes del loop desplegados sobre los compases `fromBar`..`bars` (el
 * loop se repite por módulo, como en el motor y en `chordAt`).
 */
export function chordSpans(loop: ChordBar[], bars: number, meter: Meter, fromBar = 1): ChordSpan[] {
  const spb = stepsPerBar(meter);
  const spbeat = stepsPerBeat(meter);
  const out: ChordSpan[] = [];
  if (!loop.length) return out;
  const L = loop.length;
  for (let b = Math.min(0, fromBar - 1); b < bars; b++) {
    const bar = loop[((b % L) + L) % L];
    const pickup = b < 0;
    const chords = [...(bar?.chords ?? [])].sort((x, y) => x.beat - y.beat);
    chords.forEach((c, j) => {
      const from = b * spb + Math.max(0, Math.min(beatsPerBar(meter) - 1, c.beat)) * spbeat;
      const to = j + 1 < chords.length ? b * spb + chords[j + 1].beat * spbeat : (b + 1) * spb;
      const prev = out[out.length - 1];
      // El mismo acorde que sigue sonando se une (un bloque por acorde, no por compás).
      if (prev && prev.symbol === c.symbol && prev.to === from && prev.pickup === pickup) prev.to = to;
      else out.push({ symbol: c.symbol, from, to, pickup });
    });
  }
  return out;
}

/** Rango legible "A3–E5 · 19 st". */
export function rangeText(rows: GridRow[], key: Key): string | null {
  if (!rows.length) return null;
  const lo = Math.min(...rows.map((r) => r.midi));
  const hi = Math.max(...rows.map((r) => r.midi));
  return `${midiName(lo, key, "en")}–${midiName(hi, key, "en")} · ${hi - lo} st`;
}
