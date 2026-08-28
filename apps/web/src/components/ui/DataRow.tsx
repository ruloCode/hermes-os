"use client";

import type { ReactNode } from "react";
import { toneVar, type Tone } from "./tones";

/**
 * DataRow — fila clave-valor compacta para listas de metadatos
 * (Orquestador, Versión, Uptime…). Label a la izquierda en uppercase
 * pequeño; valor a la derecha en tabular-nums, teñido por `tone`.
 */
export function DataRow({
  label,
  value,
  tone = "neutral",
  icon,
}: {
  label: string;
  value: ReactNode;
  tone?: Tone;
  icon?: ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-0.5">
      <span className="flex items-baseline gap-1.5 text-2xs tracking-label text-text-dim uppercase">
        {icon && <span aria-hidden>{icon}</span>}
        {label}
      </span>
      <span
        className={`min-w-0 truncate text-right text-xs tabular-nums ${tone === "neutral" ? "text-text" : ""}`}
        style={tone !== "neutral" ? { color: toneVar(tone) } : undefined}
      >
        {value}
      </span>
    </div>
  );
}
