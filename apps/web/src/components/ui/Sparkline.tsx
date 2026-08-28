"use client";

import { useId } from "react";
import { toneVar, type Tone } from "./tones";

/** Redondea a 2 decimales para no inflar el path con floats largos. */
const fmt = (n: number): number => Math.round(n * 100) / 100;

/**
 * Sparkline — mini línea de tendencia decorativa (SVG puro).
 * Estira al 100% del contenedor vía preserveAspectRatio="none"; el valor
 * textual lo comunica el componente padre (esto va aria-hidden).
 */
export function Sparkline({
  data,
  width = 120,
  height = 28,
  tone = "violet",
  fill = false,
  max,
  strokeWidth = 1.5,
  className = "",
}: {
  data: number[];
  width?: number;
  height?: number;
  tone?: Tone;
  fill?: boolean;
  max?: number;
  strokeWidth?: number;
  className?: string;
}) {
  const gradientId = useId();
  const stroke = toneVar(tone);
  const resolvedMax = max ?? (data.length > 0 ? Math.max(...data) : 0);
  const flat = data.length < 2 || resolvedMax <= 0;

  // Puntos normalizados: y crece hacia abajo, con 1px de margen arriba/abajo.
  const points = flat
    ? []
    : data.map((v, i) => {
        const x = fmt(i * (width / (data.length - 1)));
        const y = fmt(height - 1 - (v / resolvedMax) * (height - 2));
        return [x, y] as const;
      });

  const baseline = height - 1;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={`block ${className}`}
      style={{ width: "100%", height: "100%" }}
      aria-hidden
    >
      {flat ? (
        // Sin datos suficientes (o max inválido): línea base plana atenuada.
        <line
          x1={0}
          y1={baseline}
          x2={width}
          y2={baseline}
          stroke={stroke}
          strokeWidth={strokeWidth}
          vectorEffect="non-scaling-stroke"
          opacity={0.3}
        />
      ) : (
        <>
          {fill && (
            <>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={stroke} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={stroke} stopOpacity={0} />
                </linearGradient>
              </defs>
              <path
                d={`M0,${height} L${points.map(([x, y]) => `${x},${y}`).join(" L")} L${width},${height} Z`}
                fill={`url(#${gradientId})`}
              />
            </>
          )}
          <polyline
            points={points.map(([x, y]) => `${x},${y}`).join(" ")}
            fill="none"
            stroke={stroke}
            strokeWidth={strokeWidth}
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </>
      )}
    </svg>
  );
}
