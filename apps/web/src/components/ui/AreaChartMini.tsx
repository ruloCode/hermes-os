"use client";

import { useId } from "react";
import { toneVar, type Tone } from "./tones";

// Ancho lógico fijo del viewBox; el SVG estira al 100% del contenedor.
const LOGICAL_WIDTH = 240;

/** Redondea a 2 decimales para no inflar el path con floats largos. */
const fmt = (n: number): number => Math.round(n * 100) / 100;

/**
 * AreaChartMini — área suavizada para actividad (p. ej. últimas 24h).
 * Línea con bezier cúbica entre puntos + relleno con gradiente vertical,
 * grid punteado opcional y pulso en el último punto. Si no hay datos (o
 * todos son 0) degrada a grid + línea base plana sin crashear.
 */
export function AreaChartMini({
  data,
  height = 64,
  tone = "violet",
  grid = true,
  highlightLast = true,
  labels,
  ariaLabel,
}: {
  data: number[];
  height?: number;
  tone?: Tone;
  grid?: boolean;
  highlightLast?: boolean;
  labels?: [string, string];
  ariaLabel?: string;
}) {
  const gradientId = useId();
  const stroke = toneVar(tone);
  const max = data.length > 0 ? Math.max(...data) : 0;
  const flat = data.length < 2 || max <= 0;

  // Margen superior para que el dot de highlight (r=2.5) no se corte.
  const padTop = 4;
  const baseline = height - 1;

  const points = flat
    ? []
    : data.map((v, i) => {
        const x = fmt(i * (LOGICAL_WIDTH / (data.length - 1)));
        const y = fmt(baseline - (v / max) * (baseline - padTop));
        return [x, y] as const;
      });

  // Path de la línea con bezier cúbica: control points a 1/3 de la
  // distancia x entre puntos consecutivos (suavizado sin overshoot en x).
  let lineD = "";
  if (!flat) {
    lineD = `M ${points[0][0]},${points[0][1]}`;
    for (let i = 1; i < points.length; i++) {
      const [x1, y1] = points[i - 1];
      const [x2, y2] = points[i];
      const dx = x2 - x1;
      lineD += ` C ${fmt(x1 + dx / 3)},${y1} ${fmt(x2 - dx / 3)},${y2} ${x2},${y2}`;
    }
  }

  // El área reutiliza la línea y cierra hacia la base del viewBox.
  const areaD = flat
    ? ""
    : `${lineD} L ${LOGICAL_WIDTH},${baseline} L 0,${baseline} Z`;

  const last = points[points.length - 1];

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${LOGICAL_WIDTH} ${height}`}
        preserveAspectRatio="none"
        className="block"
        style={{ width: "100%", height }}
        role="img"
        aria-label={ariaLabel}
      >
        {grid && (
          <g aria-hidden>
            {[0.25, 0.5, 0.75].map((f) => (
              <line
                key={f}
                x1={0}
                y1={fmt(height * f)}
                x2={LOGICAL_WIDTH}
                y2={fmt(height * f)}
                stroke="var(--color-line)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
                strokeDasharray="2 4"
              />
            ))}
          </g>
        )}
        {flat ? (
          // Sin actividad: solo la línea base plana atenuada.
          <line
            x1={0}
            y1={baseline}
            x2={LOGICAL_WIDTH}
            y2={baseline}
            stroke={stroke}
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
            opacity={0.3}
          />
        ) : (
          <>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={stroke} stopOpacity={0.22} />
                <stop offset="100%" stopColor={stroke} stopOpacity={0} />
              </linearGradient>
            </defs>
            <path d={areaD} fill={`url(#${gradientId})`} />
            <path
              d={lineD}
              fill="none"
              stroke={stroke}
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {highlightLast && last && (
              <circle
                className="pulse-dot"
                cx={last[0]}
                cy={last[1]}
                r={2.5}
                fill={stroke}
              />
            )}
          </>
        )}
      </svg>
      {labels && (
        <div className="mt-1 flex justify-between text-2xs text-text-faint tracking-label uppercase">
          <span>{labels[0]}</span>
          <span>{labels[1]}</span>
        </div>
      )}
    </div>
  );
}
