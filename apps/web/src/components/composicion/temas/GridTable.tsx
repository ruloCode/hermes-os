"use client";

/**
 * La toma como TABLA: una fila por nota, en números. Es la misma lectura que
 * la rejilla, para quien prefiere leer "c.2 t.3½ · B4 · 3ª de G · 1½ t" antes
 * que mirar bloques. Clic en una fila = la elige (y suena); la selección es la
 * misma que en la rejilla.
 */
import { useEffect, useRef } from "react";
import type { Key, Meter, SungSyllable } from "@hermes/shared";
import { midiName } from "../playground/format";
import { DYN_BG, ROLE_STYLE, beatsText, figureGlyph, figureName, overChord, posText, type GridRow } from "./grid-view";

export function GridTable({
  rows,
  meter,
  keySig,
  syllableOf,
  selected,
  onSelect,
}: {
  rows: GridRow[];
  meter: Meter;
  keySig: Key;
  syllableOf: Map<number, SungSyllable>;
  selected: number | null;
  onSelect: (k: number) => void;
}) {
  const bodyRef = useRef<HTMLTableSectionElement>(null);

  // La fila elegida (←/→) siempre a la vista.
  useEffect(() => {
    if (selected == null) return;
    const tr = bodyRef.current?.querySelector<HTMLTableRowElement>(`tr[data-k="${selected}"]`);
    tr?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  return (
    <div className="max-h-[460px] min-w-0 overflow-auto rounded-md border border-line bg-panel">
      <table className="w-full border-collapse text-xs tabular-nums">
        <caption className="sr-only">Notas de la toma, una fila por nota</caption>
        <thead className="sticky top-0 z-[1] bg-panel text-left text-text-faint">
          <tr className="border-b border-line">
            <th scope="col" className="px-2.5 py-2 text-right font-normal">
              #
            </th>
            <th scope="col" className="px-2 py-2 font-normal">
              Compás.tiempo
            </th>
            <th scope="col" className="px-2 py-2 font-normal">
              Nota
            </th>
            <th scope="col" className="px-2 py-2 font-normal">
              Sobre el acorde
            </th>
            <th scope="col" className="px-2 py-2 text-right font-normal">
              Tiempos
            </th>
            <th scope="col" className="px-2 py-2 font-normal">
              Figura
            </th>
            <th scope="col" className="px-2 py-2 font-normal">
              Vocal
            </th>
            <th scope="col" className="px-2 py-2 font-normal">
              Dinámica
            </th>
            <th scope="col" className="px-2.5 py-2 font-normal">
              pp–ff
            </th>
          </tr>
        </thead>
        <tbody ref={bodyRef}>
          {rows.map((r, n) => {
            const g = r.g;
            const on = r.k === selected;
            const syl = syllableOf.get(g.i);
            const vowel = g.vowel ?? syl?.vowel ?? null;
            const glyph = figureGlyph(g.len16);
            return (
              <tr
                key={r.k}
                data-k={r.k}
                onClick={() => onSelect(r.k)}
                aria-selected={on}
                className={`cursor-pointer border-b border-line/60 last:border-b-0 ${on ? "bg-accent/10" : "hover:bg-panel-2"}`}
              >
                <td className="px-2.5 py-1.5 text-right text-text-faint">{n + 1}</td>
                <td className="px-2 py-1.5 font-mono whitespace-nowrap text-text-dim">
                  {posText(g, meter)}
                  {g.bar <= 0 && <span className="ml-1 font-sans text-text-faint">anacrusa</span>}
                </td>
                <td className={`px-2 py-1.5 font-mono whitespace-nowrap ${on ? "text-accent" : "text-text"}`}>
                  {midiName(r.midi, keySig, "en")}
                  {r.doubtful && (
                    <span className="ml-1 font-sans text-amber" title="Altura dudosa: quedó entre dos semitonos">
                      ?
                    </span>
                  )}
                </td>
                <td className="px-2 py-1.5 whitespace-nowrap text-text-dim">
                  <span className="inline-flex items-center gap-1.5">
                    <span aria-hidden className={`inline-block h-2.5 w-2.5 rounded-[3px] border ${ROLE_STYLE[g.role].swatch}`} />
                    {overChord(g)}
                  </span>
                </td>
                <td className="px-2 py-1.5 text-right text-text">{beatsText(g.len16, meter)}</td>
                <td className="px-2 py-1.5 whitespace-nowrap text-text-dim">
                  {glyph && <span className="mr-1 text-text">{glyph}</span>}
                  {figureName(g.len16)}
                </td>
                <td className="px-2 py-1.5 font-medium text-text">{vowel ?? ""}</td>
                <td className="px-2 py-1.5">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-6 text-right text-text">{Math.round(g.velocity)}</span>
                    <span className="h-1.5 w-12 overflow-hidden rounded-full bg-line" aria-hidden>
                      <span className={`block h-full ${DYN_BG[g.dynamic]}`} style={{ width: `${Math.max(2, Math.min(100, g.velocity))}%` }} />
                    </span>
                  </span>
                </td>
                <td className="px-2.5 py-1.5 font-medium text-text italic">{g.dynamic}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
