"use client";

/**
 * CARRIL DE ACORDES del loop de una sección (patrón Mobbin: el timeline de
 * Krea — bloques tan anchos como su duración y un "+" al final). Cada compás
 * es una celda; partido en el tiempo 3 lleva dos bloques proporcionales. El
 * bloque elegido lleva el acento (la paleta lo reemplaza); el compás que suena
 * se marca con el playhead, leído del motor por rAF y guardado solo cuando
 * cambia de compás.
 */
import { useEffect, useState } from "react";
import type { ChordBar, Meter } from "@hermes/shared";
import type { Key } from "@/lib/music-theory";
import type { TrackEngine } from "@/lib/track-engine";
import { blockWidths, chordInfo, showChord, MAX_LOOP_BARS, type LaneSel } from "./track-edit";

const STATUS_TEXT = {
  diatónico: "text-text-faint",
  prestado: "text-amber",
  fuera: "text-red",
} as const;

export function ChordLane({
  loop,
  meter,
  musicKey,
  notation,
  sel,
  onSelect,
  onAdd,
  engine,
  sectionBars,
  active,
}: {
  loop: ChordBar[];
  meter: Meter;
  musicKey: Key;
  notation: "en" | "latin";
  sel: LaneSel | null;
  onSelect: (s: LaneSel | null) => void;
  onAdd: () => void;
  engine: TrackEngine;
  sectionBars: number;
  active: boolean;
}) {
  const playingBar = usePlayingBar(engine, loop.length, active);
  const full = loop.length >= MAX_LOOP_BARS;
  const rows: number[][] = [];
  loop.forEach((_, i) => (i % 4 === 0 ? rows.push([i]) : rows[rows.length - 1].push(i)));
  if (!rows.length) rows.push([]);

  return (
    <div className="flex flex-col gap-2">
      {/* Filas de 4 compases (como se escribe una progresión); la 5ª columna, angosta, es el "+" */}
      <div className="flex flex-col gap-2" role="listbox" aria-label="Compases del loop">
        {rows.map((row, r) => {
          const last = r === rows.length - 1;
          return (
            <div key={r} className="grid grid-cols-[repeat(4,minmax(0,1fr))_40px] gap-1.5">
              {row.map((i) => {
                const bar = loop[i];
                const widths = blockWidths(bar, meter);
                const now = playingBar === i;
                return (
                  <div key={i} className="flex min-w-0 flex-col gap-1">
                    <span
                      className={`flex items-center gap-1 font-mono text-2xs tabular-nums ${now ? "text-accent" : "text-text-faint"}`}
                    >
                      c.{i + 1}
                      {now && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />}
                    </span>
                    <div className={`relative flex h-[68px] gap-1 rounded-sm ${now ? "bg-accent/6" : ""}`}>
                      {now && <span aria-hidden className="absolute -top-px right-0 left-0 h-0.5 rounded-full bg-accent" />}
                      {bar.chords.map((c, j) => {
                        const on = sel?.bar === i && sel.idx === j;
                        const info = chordInfo(c.symbol, musicKey);
                        return (
                          <button
                            key={j}
                            type="button"
                            role="option"
                            aria-selected={on}
                            onClick={() => onSelect(on ? null : { bar: i, idx: j })}
                            style={{ flexGrow: widths[j] || 1, flexBasis: 0 }}
                            title={`${showChord(c.symbol, musicKey, notation)}${info ? ` · ${info.roman} · ${info.status}` : ""}${
                              info?.hint ? ` — ${info.hint}` : ""
                            }${bar.chords.length > 1 ? ` · entra en el tiempo ${c.beat + 1}` : ""}`}
                            className={`flex min-w-0 cursor-pointer flex-col items-start justify-between rounded-sm border px-2 py-1.5 text-left transition-colors ${
                              on ? "border-accent bg-accent/10" : "border-line bg-panel hover:border-line-2"
                            }`}
                          >
                            <span className={`w-full truncate font-mono text-sm ${on ? "text-accent" : "text-text"}`}>
                              {showChord(c.symbol, musicKey, notation)}
                            </span>
                            <span className={`w-full truncate font-mono text-2xs ${info ? STATUS_TEXT[info.status] : "text-red"}`}>
                              {info
                                ? `${info.roman}${info.status !== "diatónico" && bar.chords.length === 1 ? ` · ${info.status}` : ""}`
                                : "no se entiende"}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              {last && !full && (
                <div className="flex min-w-0 flex-col gap-1">
                  <span aria-hidden className="font-mono text-2xs text-transparent select-none">
                    +
                  </span>
                  <button
                    type="button"
                    onClick={onAdd}
                    title="Agregar un compás al loop"
                    aria-label="Agregar un compás al loop"
                    className="grid h-[68px] w-10 cursor-pointer place-items-center rounded-sm border border-dashed border-line-2 text-lg text-text-faint transition-colors hover:border-accent hover:text-accent"
                  >
                    +
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-xs text-text-faint">
        Loop de {loop.length} {loop.length === 1 ? "compás" : "compases"}
        {sectionBars > loop.length
          ? ` · la sección dura ${sectionBars}: el loop se repite ${
              sectionBars % loop.length === 0 ? `${sectionBars / loop.length} veces` : `y la última vuelta queda a medias`
            }`
          : sectionBars < loop.length
            ? ` · la sección dura ${sectionBars}: suenan solo los primeros ${sectionBars}`
            : ""}
        {full ? " · tope de 16 compases" : ""}
      </p>
    </div>
  );
}

/** Compás del LOOP que suena ahora (0-based) o null; estado solo al cambiar de compás. */
function usePlayingBar(engine: TrackEngine, loopLen: number, active: boolean): number | null {
  const [bar, setBar] = useState<number | null>(null);
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let last: number | null = -1;
    const tick = () => {
      const pos = engine.position();
      const b = pos && pos.bar >= 1 ? (pos.bar - 1) % Math.max(1, loopLen) : null;
      if (b !== last) {
        last = b;
        setBar(b);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [engine, loopLen, active]);
  return bar;
}
