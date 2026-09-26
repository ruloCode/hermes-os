"use client";

/**
 * La LECTURA EN NÚMEROS de la toma: una línea por frase (la escribe el
 * análisis, `grid.readout`) y el resumen de toda la toma — rango, notas,
 * melismas, cómo termina. "La música es un lenguaje matemático": esto es la
 * partitura contada, no una opinión.
 *
 * Si la rejilla parece corrida (los ataques en tiempo fuerte llegan todos
 * tarde o todos antes), el análisis lo dice con un número y el humano decide
 * correrla: eso cambia la latencia de la toma y el agente la re-analiza.
 */
import { useState } from "react";
import type { GridAnalysis, Key } from "@hermes/shared";
import { btn, btnGhost } from "../playground/ui";
import { rangeText, toneText, type GridRow } from "./grid-view";

export function GridReadout({
  grid,
  rows,
  keySig,
  melismas,
  focusPhrase,
  onPhrase,
  onShift,
  shifting,
}: {
  grid: GridAnalysis;
  rows: GridRow[];
  keySig: Key;
  melismas: number;
  focusPhrase: number | null;
  onPhrase: (idx: number) => void;
  /** Corre la rejilla `ms` (con signo): la toma se re-analiza. Omitir si no se puede. */
  onShift?: (ms: number) => void;
  shifting: boolean;
}) {
  const [dismissed, setDismissed] = useState<number | null>(null);
  const last = grid.phrases[grid.phrases.length - 1];
  const range = rangeText(rows, keySig);
  const shift = grid.suggestShiftMs;
  const showShift = shift != null && Math.abs(shift) >= 1 && dismissed !== shift;
  const fmtMs = (ms: number) => `${ms > 0 ? "+" : "−"}${Math.abs(Math.round(ms))} ms`;

  return (
    <section className="flex min-w-0 flex-col gap-3" aria-label="Lectura en números">
      <h3 className="text-sm font-medium text-text">Lectura en números</h3>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <div>
          <dt className="text-text-faint">Notas</dt>
          <dd className="text-sm text-text tabular-nums">{rows.length}</dd>
        </div>
        <div>
          <dt className="text-text-faint">Melismas</dt>
          <dd className="text-sm text-text tabular-nums">{melismas}</dd>
        </div>
        {range && (
          <div className="col-span-2">
            <dt className="text-text-faint">Rango</dt>
            <dd className="font-mono text-sm text-text">{range}</dd>
          </div>
        )}
        {last && (
          <div className="col-span-2">
            <dt className="text-text-faint">Final</dt>
            <dd className="text-sm text-text">
              {last.endsOn.chordTone ? `${toneText(last.endsOn.chordTone)} del acorde` : "fuera del acorde"} · grado{" "}
              {last.endsOn.degree} · tiempo {last.endsOn.weight >= 3 ? "fuerte" : last.endsOn.weight >= 2 ? "medio" : "débil"}
            </dd>
          </div>
        )}
        <div className="col-span-2">
          <dt className="text-text-faint">Ataques en tiempo fuerte</dt>
          <dd className="text-sm text-text tabular-nums">
            {grid.medianOffMs === 0 ? "en la rejilla" : `${fmtMs(grid.medianOffMs)} de mediana`}
          </dd>
        </div>
      </dl>

      {showShift && onShift && (
        <div className="flex flex-col gap-2 rounded-sm border border-line px-3 py-2.5" role="status">
          <p className="text-xs text-text-dim">
            La rejilla parece corrida: los ataques caen {shift! < 0 ? "antes" : "tarde"} de forma pareja. ¿Correr la
            rejilla {fmtMs(shift!)}?
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={btn} disabled={shifting} onClick={() => onShift(shift!)}>
              {shifting ? "Corriendo…" : `Correr ${fmtMs(shift!)}`}
            </button>
            <button type="button" className={btnGhost} disabled={shifting} onClick={() => setDismissed(shift)}>
              Así está bien
            </button>
          </div>
          <p className="text-xs text-text-faint">Cambia la latencia de esta toma; el agente la vuelve a leer.</p>
        </div>
      )}

      {grid.readout.length > 0 && (
        <ol className="flex flex-col gap-1.5">
          {grid.readout.map((line, i) => {
            const idx = grid.phrases[i]?.idx ?? i;
            const on = focusPhrase === idx;
            return (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => onPhrase(idx)}
                  className={`w-full cursor-pointer rounded-sm px-2 py-1.5 text-left text-xs leading-relaxed transition-colors ${
                    on ? "bg-accent/10 text-text" : "text-text-dim hover:bg-panel-2 hover:text-text"
                  }`}
                >
                  <span className={`mr-1.5 font-mono ${on ? "text-accent" : "text-text-faint"}`}>F{idx + 1}</span>
                  {line}
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
