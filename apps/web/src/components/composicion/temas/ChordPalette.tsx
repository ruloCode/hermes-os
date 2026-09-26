"use client";

/**
 * PALETA de la tonalidad: los 7 diatónicos con su grado y función, los
 * prestados que suelen funcionar (con su porqué) y las plantillas clásicas
 * resueltas en la tonalidad. Todo sale de `music-theory` (lógica pura); nada es
 * decorativo. Un clic usa el acorde — en el bloque elegido o como compás
 * nuevo —; ninguno entra solo.
 */
import {
  borrowedChords,
  chordFromRoman,
  chordSymbol,
  diatonicChords,
  keyLabel,
  PROGRESSION_PRESETS,
  type Chord,
  type Key,
  type Spell,
} from "@/lib/music-theory";
import { DOT_BG } from "../labels";

const ROLE_TONE = { tónica: "accent", subdominante: "cyan", dominante: "amber" } as const;

export function ChordPalette({
  musicKey,
  notation,
  hasSelection,
  onPick,
  onPreset,
}: {
  musicKey: Key;
  notation: "en" | "latin";
  hasSelection: boolean;
  /** Símbolo en anglosajón (así se guarda). */
  onPick: (symbol: string, chord: Chord) => void;
  onPreset: (symbols: string[], name: string) => void;
}) {
  const key = musicKey;
  const dia = diatonicChords(key);
  const borrowed = borrowedChords(key);
  const presets = PROGRESSION_PRESETS.filter((p) => p.mode === key.mode || p.mode === "any")
    .map((p) => {
      const chords = p.romans.map((r) => chordFromRoman(r, key));
      return chords.every((c): c is Chord => c !== null)
        ? { ...p, symbols: chords.map((c) => chordSymbol(c, key, "en")), shown: chords.map((c) => chordSymbol(c, key, notation)) }
        : null;
    })
    .filter((p) => p !== null);

  const sym = (c: Chord, spell: Spell = "auto") => chordSymbol(c, key, "en", spell);

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm text-text">Los 7 de {keyLabel(key, notation)}</span>
          <span className="text-xs text-text-faint">{hasSelection ? "reemplaza el bloque elegido" : "agrega un compás"}</span>
        </div>
        <div className="grid grid-cols-7 gap-1">
          {dia.map((d) => (
            <button
              key={d.degree}
              type="button"
              onClick={() => onPick(sym(d.chord), d.chord)}
              title={`${d.roman} · ${d.role}`}
              className="flex min-w-0 cursor-pointer flex-col items-center gap-0.5 rounded-sm border border-line bg-panel px-0.5 py-1.5 transition-colors hover:border-accent"
            >
              <span className="font-mono text-2xs text-text-faint">{d.roman}</span>
              <span className="max-w-full truncate font-mono text-sm text-text">{chordSymbol(d.chord, key, notation)}</span>
              <span aria-hidden className={`h-1 w-1 rounded-full ${DOT_BG[ROLE_TONE[d.role]]}`} />
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-text-faint">
          <span className="flex items-center gap-1">
            <i aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-accent" /> tónica · casa
          </span>
          <span className="flex items-center gap-1">
            <i aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-cyan" /> subdominante · salida
          </span>
          <span className="flex items-center gap-1">
            <i aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-amber" /> dominante · tensión
          </span>
        </div>
      </section>

      <section className="flex flex-col gap-1.5">
        <span className="text-sm text-text">Prestados que suelen funcionar</span>
        <div className="flex flex-col gap-1">
          {borrowed.map((b) => (
            <button
              key={b.roman}
              type="button"
              onClick={() => onPick(sym(b.chord, b.spell), b.chord)}
              className="flex cursor-pointer items-center gap-2 rounded-sm border border-line px-2 py-1 text-left transition-colors hover:border-amber/60"
            >
              <span className="w-9 shrink-0 font-mono text-xs text-amber">{b.roman}</span>
              <span className="w-12 shrink-0 font-mono text-xs text-text">{chordSymbol(b.chord, key, notation, b.spell)}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-text-dim" title={b.hint}>
                {b.hint}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-1.5">
        <span className="text-sm text-text">Plantillas</span>
        <p className="text-xs text-text-faint">Reemplazan el loop de la sección (se puede deshacer).</p>
        <div className="flex flex-col gap-1">
          {presets.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onPreset(p.symbols, p.name)}
              className="flex cursor-pointer flex-col gap-0.5 rounded-sm border border-line px-2 py-1.5 text-left transition-colors hover:border-line-2"
            >
              <span className="flex items-baseline justify-between gap-2">
                <span className="text-xs text-text">{p.name}</span>
                <span className="font-mono text-xs text-text-dim">{p.shown.join(" · ")}</span>
              </span>
              <span className="text-xs text-text-faint">
                <span className="font-mono">{p.romans.join(" ")}</span> · {p.feel}
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
