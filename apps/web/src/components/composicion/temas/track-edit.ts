/**
 * Ediciones de la PISTA de un tema (loop de acordes por compás, secciones,
 * tonalidad). Funciones puras sobre el contrato de @hermes/shared: la UI las
 * aplica y manda el resultado con un PATCH. Los acordes se GUARDAN en
 * anglosajón ("Am", "Bb") y se muestran según la notación elegida.
 */
import type { ChordBar, Meter, SectionKind, TemaSection, TemaTrack } from "@hermes/shared";
import {
  analyzeChord,
  chordSymbol,
  parseChord,
  transposeChord,
  type ChordAnalysis,
  type Key,
  type Spell,
} from "@/lib/music-theory";
import { beatsPerBar } from "@hermes/shared";

export const MAX_LOOP_BARS = 16;
export const MAX_SECTION_BARS = 64;

/** Dónde se parte un compás en dos: el tiempo 3 (en 6/8, el segundo pulso). */
export const splitBeat = (meter: Meter): number => (meter === "6/8" ? 1 : 2);

/** Bloque elegido en el carril: compás del loop y acorde dentro del compás. */
export interface LaneSel {
  bar: number;
  idx: number;
}

/** 92 → "92"; 96.4 → "96,4" (el bpm estimado de un tarareo trae décimas). */
export const fmtBpm = (bpm: number): string =>
  Number.isInteger(bpm) ? String(bpm) : bpm.toFixed(1).replace(".", ",");

export function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** El deletreo que trae el símbolo guardado (Bb se queda en bemol aunque la tonalidad sea de sostenidos). */
function spellOf(symbol: string): Spell {
  const m = symbol.trim().match(/^[A-G]([#b♯♭])?/);
  if (!m?.[1]) return "auto";
  return /[#♯]/.test(m[1]) ? "sharp" : "flat";
}

/** Cómo se ve un acorde guardado en la notación elegida. */
export function showChord(symbol: string, key: Key, notation: "en" | "latin"): string {
  if (notation === "en") return symbol;
  const c = parseChord(symbol);
  return c ? chordSymbol(c, key, "latin", spellOf(symbol)) : symbol;
}

/** Grado y estado (diatónico/prestado/fuera) de un acorde guardado; null si no se entiende. */
export function chordInfo(symbol: string, key: Key): ChordAnalysis | null {
  const c = parseChord(symbol);
  return c ? analyzeChord(c, key) : null;
}

const mapLoop = (loop: ChordBar[], fn: (bar: ChordBar, i: number) => ChordBar | null): ChordBar[] =>
  loop.map(fn).filter((b): b is ChordBar => b !== null);

/** Pone `symbol` en el bloque elegido. */
export function setChord(loop: ChordBar[], sel: LaneSel, symbol: string): ChordBar[] {
  return loop.map((bar, i) =>
    i !== sel.bar ? bar : { chords: bar.chords.map((c, j) => (j === sel.idx ? { ...c, symbol } : c)) },
  );
}

/** Agrega un compás al final del loop (tope 16). */
export function appendBar(loop: ChordBar[], symbol: string): ChordBar[] {
  if (loop.length >= MAX_LOOP_BARS) return loop;
  return [...loop, { chords: [{ symbol, beat: 0 }] }];
}

/** Parte un compás en el tiempo 3 (el segundo acorde arranca igual al primero). */
export function splitBar(loop: ChordBar[], bar: number, meter: Meter): ChordBar[] {
  return loop.map((b, i) =>
    i !== bar || b.chords.length !== 1
      ? b
      : { chords: [b.chords[0], { symbol: b.chords[0].symbol, beat: splitBeat(meter) }] },
  );
}

/** Une un compás partido: se queda el primer acorde. */
export function joinBar(loop: ChordBar[], bar: number): ChordBar[] {
  return loop.map((b, i) => (i !== bar || b.chords.length < 2 ? b : { chords: [{ ...b.chords[0], beat: 0 }] }));
}

/**
 * Borra un bloque: la mitad de un compás partido, o el compás entero. El loop
 * nunca queda vacío (una pista sin acordes no se puede tocar).
 */
export function removeBlock(loop: ChordBar[], sel: LaneSel): ChordBar[] {
  const bar = loop[sel.bar];
  if (!bar) return loop;
  if (bar.chords.length > 1) {
    return loop.map((b, i) =>
      i !== sel.bar ? b : { chords: b.chords.filter((_, j) => j !== sel.idx).map((c) => ({ ...c, beat: 0 })) },
    );
  }
  if (loop.length <= 1) return loop;
  return mapLoop(loop, (b, i) => (i === sel.bar ? null : b));
}

/** Mueve un compás un lugar a la izquierda o a la derecha. */
export function moveBar(loop: ChordBar[], bar: number, dir: -1 | 1): ChordBar[] {
  const j = bar + dir;
  if (j < 0 || j >= loop.length) return loop;
  const next = [...loop];
  [next[bar], next[j]] = [next[j], next[bar]];
  return next;
}

/** Un compás por acorde (las plantillas). */
export const loopFromSymbols = (symbols: string[]): ChordBar[] =>
  symbols.slice(0, MAX_LOOP_BARS).map((symbol) => ({ chords: [{ symbol, beat: 0 }] }));

/** Duración relativa de cada acorde dentro de su compás (0..1). */
export function blockWidths(bar: ChordBar, meter: Meter): number[] {
  const beats = beatsPerBar(meter);
  return bar.chords.map((c, j) => {
    const end = bar.chords[j + 1]?.beat ?? beats;
    return Math.max(0, Math.min(beats, end) - c.beat) / beats;
  });
}

/**
 * Transpone TODA la pista a otra tonalidad (los acordes se re-deletrean con la
 * nueva: pasar a Fa mayor escribe Bb, no A#).
 */
export function transposeTrack(track: TemaTrack, to: Key): TemaTrack {
  const delta = to.tonic - track.key.tonic;
  if (delta === 0) return { ...track, key: to };
  const sections = track.sections.map((s) => ({
    ...s,
    loop: s.loop.map((bar) => ({
      chords: bar.chords.map((c) => {
        const ch = parseChord(c.symbol);
        return ch ? { ...c, symbol: chordSymbol(transposeChord(ch, delta), to, "en") } : c;
      }),
    })),
  }));
  return { ...track, key: to, sections };
}

/** Si cambia el compás, los acordes partidos se re-ubican (el tiempo 3 de 4/4 no existe en 6/8). */
export function remeter(track: TemaTrack, meter: Meter): TemaTrack {
  const beats = beatsPerBar(meter);
  return {
    ...track,
    meter,
    sections: track.sections.map((s) => ({
      ...s,
      loop: s.loop.map((bar) =>
        bar.chords.length < 2
          ? bar
          : { chords: [bar.chords[0], { ...bar.chords[1], beat: Math.min(beats - 1, splitBeat(meter)) }] },
      ),
    })),
  };
}

export const SECTION_LABEL: Record<SectionKind, string> = {
  intro: "Intro",
  verso: "Verso",
  pre: "Pre-coro",
  coro: "Coro",
  puente: "Puente",
  final: "Final",
  instrumental: "Instrumental",
};

/** Sección nueva: copia el loop de la que estás mirando (lo normal es variar, no empezar de cero). */
export function newSection(track: TemaTrack, kind: SectionKind, from?: TemaSection): TemaSection {
  const n = track.sections.filter((s) => s.kind === kind).length + 1;
  const base = SECTION_LABEL[kind];
  return {
    id: uid("sec"),
    kind,
    label: n > 1 ? `${base} ${n}` : base,
    loop: from?.loop.map((b) => ({ chords: b.chords.map((c) => ({ ...c })) })) ?? [{ chords: [{ symbol: "C", beat: 0 }] }],
    bars: from?.bars ?? 8,
  };
}

export const patchSection = (track: TemaTrack, id: string, p: Partial<TemaSection>): TemaTrack => ({
  ...track,
  sections: track.sections.map((s) => (s.id === id ? { ...s, ...p } : s)),
});
