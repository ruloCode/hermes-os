"use client";

import { useId } from "react";
import { toneVar, toneHotVar, type Tone } from "./tones";

// Longitud del arco visible: 270° de los 360° del círculo (gap abajo).
const ARC = 0.75;

/**
 * RadialGauge — gauge circular HUD (p. ej. "Uso de Claude" al 78%,
 * avance de proyecto al 68%). Arco de 270° con gap inferior, progreso
 * con gradiente del tono y glow moderado. Si se pasan `thresholds`,
 * el tono efectivo escala a amber/red según el porcentaje alcanzado.
 */
export function RadialGauge({
  value,
  max = 100,
  size = 96,
  stroke = 7,
  tone = "violet",
  thresholds,
  label,
  sublabel,
  showValue = true,
  format,
}: {
  value: number;
  max?: number;
  size?: number;
  stroke?: number;
  tone?: Tone;
  /** Umbrales en % sobre value/max: ≥ warn → amber, ≥ danger → red. */
  thresholds?: { warn: number; danger: number };
  label?: string;
  sublabel?: string;
  showValue?: boolean;
  format?: (v: number) => string;
}) {
  const gradientId = useId();

  // Porcentaje saturado a [0, 100]; base de dibujo y de umbrales.
  const pct = Math.min(Math.max(max > 0 ? value / max : 0, 0), 1) * 100;

  // Tono efectivo: los umbrales pisan el tono base al degradarse.
  const effectiveTone: Tone = thresholds
    ? pct >= thresholds.danger
      ? "red"
      : pct >= thresholds.warn
        ? "amber"
        : tone
    : tone;

  const valueText = (format ?? ((v: number) => `${Math.round((v / max) * 100)}%`))(value);
  const valueSize =
    size >= 120
      ? "text-4xl"
      : size >= 96
        ? "text-2xl"
        : size >= 72
          ? "text-xl"
          : "text-lg";

  return (
    <div
      className="relative"
      style={{ width: size, height: size }}
      role="meter"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={label}
    >
      <svg viewBox="0 0 100 100" className="h-full w-full" aria-hidden>
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={toneVar(effectiveTone)} />
            <stop offset="100%" stopColor={toneHotVar(effectiveTone)} />
          </linearGradient>
        </defs>
        {/* Track: arco completo de 270° en el color de línea */}
        <circle
          cx={50}
          cy={50}
          r={42}
          fill="none"
          pathLength={100}
          stroke="var(--color-line)"
          strokeWidth={stroke}
          strokeDasharray="75 25"
          transform="rotate(135 50 50)"
        />
        {/* Progreso: proporción del arco con gradiente del tono + glow */}
        <circle
          className={effectiveTone === "red" ? "pulse-dot" : undefined}
          cx={50}
          cy={50}
          r={42}
          fill="none"
          pathLength={100}
          stroke={`url(#${gradientId})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${pct * ARC} ${100 - pct * ARC}`}
          transform="rotate(135 50 50)"
          style={{
            filter: `drop-shadow(0 0 6px color-mix(in srgb, ${toneVar(effectiveTone)} 60%, transparent))`,
            transition: "stroke-dasharray 0.6s cubic-bezier(.2,.7,.2,1)",
          }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <div className="flex flex-col items-center leading-tight">
          {showValue && (
            <span
              className={`font-display tabular-nums ${valueSize}`}
              style={{ color: toneVar(effectiveTone) }}
            >
              {valueText}
            </span>
          )}
          {label && (
            <span className="text-2xs tracking-label text-text-dim uppercase">{label}</span>
          )}
          {sublabel && <span className="text-2xs text-text-faint">{sublabel}</span>}
        </div>
      </div>
    </div>
  );
}
