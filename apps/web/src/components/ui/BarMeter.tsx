"use client";

import { toneVar, type Tone } from "./tones";

/**
 * BarMeter — medidor de barra segmentado estilo HUD (CPU/RAM/DISCO).
 * Segmentado por defecto (20 bloques); con `segments=0` se vuelve una
 * barra continua con transición suave. Los `thresholds` (en %) escalan
 * el tono a amber/red cuando el valor cruza warn/danger.
 */
export function BarMeter({
  value,
  max = 100,
  segments = 20,
  tone = "cyan",
  thresholds,
  label,
  showValue = true,
  height = 8,
}: {
  value: number;
  max?: number;
  /** 0 = barra continua sin segmentos. */
  segments?: number;
  tone?: Tone;
  /** Umbrales en % que cambian el tono a amber (warn) o red (danger). */
  thresholds?: { warn: number; danger: number };
  label?: string;
  showValue?: boolean;
  height?: number;
}) {
  // Fracción [0..1] blindada contra valores fuera de rango o max=0.
  const pct = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const pctDisplay = Math.round(pct * 100);

  // Tono efectivo: escala a amber/red según umbrales (en %).
  const effectiveTone: Tone = thresholds
    ? pctDisplay >= thresholds.danger
      ? "red"
      : pctDisplay >= thresholds.warn
        ? "amber"
        : tone
    : tone;
  const fill = toneVar(effectiveTone);

  let meter: React.ReactNode;
  if (segments > 0) {
    // Segmentado: rects en unidades viewBox (0..100) estiradas al ancho real.
    const gap = 1.2;
    const segWidth = (100 - (segments - 1) * gap) / segments;
    const filled = Math.round(pct * segments);
    meter = (
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        aria-hidden
        className="block"
      >
        {Array.from({ length: segments }, (_, i) => {
          const on = i < filled;
          return (
            <rect
              key={i}
              x={i * (segWidth + gap)}
              y={0}
              width={segWidth}
              height={height}
              fill={on ? fill : "var(--color-line)"}
              // El último segmento encendido se atenúa para un fade sutil.
              opacity={on && i === filled - 1 ? 0.55 : 1}
            />
          );
        })}
      </svg>
    );
  } else {
    // Continua: track + progreso con transición de ancho.
    meter = (
      <svg width="100%" height={height} aria-hidden className="block">
        <rect x={0} y={0} width="100%" height={height} fill="var(--color-line)" />
        <rect
          x={0}
          y={0}
          width={`${pctDisplay}%`}
          height={height}
          fill={fill}
          style={{ transition: "width .6s cubic-bezier(.2,.7,.2,1)" }}
        />
      </svg>
    );
  }

  const meterEl = (
    <div
      role="meter"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={label}
      className="min-w-0 flex-1"
    >
      {meter}
    </div>
  );

  if (!label && !showValue) return meterEl;

  return (
    <div className="flex items-center gap-2">
      {label && (
        <span className="min-w-[4ch] text-2xs tracking-label text-text-dim uppercase">
          {label}
        </span>
      )}
      {meterEl}
      {showValue && (
        <span
          className="text-2xs font-display tabular-nums"
          style={{ color: fill }}
        >
          {pctDisplay}%
        </span>
      )}
    </div>
  );
}
