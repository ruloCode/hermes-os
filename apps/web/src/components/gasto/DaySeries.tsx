"use client";

// POR DÍA: una columna por día del periodo. Columnas y no una línea porque los
// días son cubetas sueltas: una línea entre el lunes y el jueves pintaría un
// martes que nadie midió.
//
// Tres clases de día, y se ven distintas porque SON distintas:
//   · con llamadas  → columna con su valor;
//   · sin llamadas, pero ya se medía → una marca en la base (cero real);
//   · anterior al primer registro → nada (no hay dato; no es un cero).
//
// Una sola serie, así que no lleva color ni leyenda: el título dice qué es. El
// detalle del día está en la línea de lectura de arriba (al pasar el cursor o
// con el teclado), no en un número sobre cada columna.

import { useState } from "react";
import { lastDays, localDay, type DayUsage } from "@hermes/shared";
import { dayLabel, dayLabelLong, dayOfMonth, percent, usd } from "./format";

const PLOT_H = 112;

export function DaySeries({
  byDay,
  days,
  since,
  costKnown,
}: {
  byDay: DayUsage[];
  days: number;
  /** Primer día con registro en disco: antes de él no hay dato. */
  since: string | null;
  /** El SDK informó costos en el periodo: si no, la altura son las llamadas. */
  costKnown: boolean;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const span = lastDays(localDay(new Date()), days);
  const byKey = new Map(byDay.map((d) => [d.day, d]));
  const value = (d: DayUsage | undefined) => (d ? (costKnown ? (d.costUsd ?? 0) : d.calls) : 0);
  const max = Math.max(0, ...span.map((day) => value(byKey.get(day))));
  const lastWithData = [...span].reverse().find((day) => byKey.has(day)) ?? null;
  const shown = hover ?? lastWithData;
  const shownData = shown ? byKey.get(shown) : undefined;
  const dense = days > 14;

  const readout = !shown
    ? null
    : shownData
      ? [
          costKnown ? usd(shownData.costUsd) : null,
          shownData.calls === 1 ? "1 llamada" : `${shownData.calls} llamadas`,
          percent(shownData.cacheRatio) ? `${percent(shownData.cacheRatio)} de la entrada desde caché` : null,
          shownData.errors > 0 ? `${shownData.errors} con error` : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : since && shown >= since
        ? "sin llamadas"
        : `sin registro${since ? ` (se mide desde el ${dayLabel(since)})` : ""}`;

  return (
    <div className="flex flex-col gap-3">
      <p className="flex min-h-5 flex-wrap items-baseline gap-x-2 text-xs" aria-live="polite">
        {shown && <span className="font-medium text-text">{dayLabelLong(shown)}</span>}
        {readout && <span className="text-text-dim tabular-nums">{readout}</span>}
      </p>

      <div className="relative" style={{ height: PLOT_H }}>
        {/* Referencia de escala: la línea de arriba vale el máximo del periodo. */}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-line" />
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 border-t border-line" />
        <div
          role="list"
          aria-label={costKnown ? "Costo estimado por día" : "Llamadas por día"}
          className={`absolute inset-0 flex items-end ${dense ? "gap-0.5" : "gap-2"}`}
          onMouseLeave={() => setHover(null)}
        >
          {span.map((day) => {
            const d = byKey.get(day);
            const v = value(d);
            const measured = since != null && day >= since;
            const on = day === shown;
            return (
              <div
                key={day}
                role="listitem"
                tabIndex={0}
                data-day={day}
                aria-label={`${dayLabelLong(day)}: ${d ? `${costKnown ? usd(d.costUsd) : ""} ${d.calls} llamadas` : measured ? "sin llamadas" : "sin registro"}`}
                onMouseEnter={() => setHover(day)}
                onFocus={() => setHover(day)}
                onBlur={() => setHover(null)}
                // La columna entera es el blanco: más grande que la marca.
                className="flex h-full min-w-0 flex-1 cursor-default items-end justify-center rounded-xs outline-offset-2"
              >
                {d ? (
                  <span
                    className={`w-full max-w-10 rounded-t-xs transition-colors ${on ? "bg-text" : "bg-text-dim"}`}
                    style={{ height: max > 0 ? Math.max(2, (v / max) * PLOT_H) : 2 }}
                  />
                ) : measured ? (
                  <span className={`h-0.5 w-full max-w-10 rounded-full ${on ? "bg-text-dim" : "bg-line-2"}`} />
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {/* Eje: en periodos largos solo se rotula una vez por semana, contando desde hoy. */}
      <div aria-hidden className={`flex ${dense ? "gap-0.5" : "gap-2"} text-2xs text-text-faint tabular-nums`}>
        {span.map((day, i) => {
          const fromEnd = span.length - 1 - i;
          const show = !dense || fromEnd % 7 === 0;
          return (
            <span key={day} className="relative h-4 min-w-0 flex-1">
              {show && (
                <span className={`absolute top-0 whitespace-nowrap ${dense ? (fromEnd === 0 ? "right-0" : "left-1/2 -translate-x-1/2") : "left-1/2 -translate-x-1/2"} ${day === shown ? "text-text" : ""}`}>
                  {dense ? dayLabel(day) : dayOfMonth(day)}
                </span>
              )}
            </span>
          );
        })}
      </div>

      {max > 0 && (
        <p className="text-xs text-text-faint tabular-nums">
          La línea punteada vale {costKnown ? usd(max) : `${max} llamadas`}, el día más alto del periodo.
        </p>
      )}
    </div>
  );
}
