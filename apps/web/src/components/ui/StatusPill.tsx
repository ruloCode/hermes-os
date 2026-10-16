"use client";

import { toneVar, type Tone } from "./tones";

// Mapa estado → tono semántico + label por defecto. El label siempre se
// muestra (el default se puede sobreescribir con la prop `label`).
const STATUS: Record<
  "active" | "running" | "paused" | "ok" | "warn" | "error" | "idle" | "offline",
  { tone: Tone; labelDefault: string }
> = {
  active: { tone: "green", labelDefault: "Activo" },
  running: { tone: "cyan", labelDefault: "En curso" },
  paused: { tone: "amber", labelDefault: "En pausa" },
  ok: { tone: "green", labelDefault: "OK" },
  warn: { tone: "amber", labelDefault: "Atención" },
  error: { tone: "red", labelDefault: "Error" },
  idle: { tone: "neutral", labelDefault: "Inactivo" },
  offline: { tone: "red", labelDefault: "Sin conexión" },
};

/**
 * StatusPill — punto de color + etiqueta. El COLOR va en el punto; el texto
 * queda en gris legible (v5): una columna de estados en verde/ámbar/rojo
 * puro se leía como semáforo, no como lista.
 */
export function StatusPill({
  status,
  label,
  pulse = false,
  size = "md",
}: {
  status: keyof typeof STATUS;
  label?: string;
  pulse?: boolean;
  size?: "sm" | "md";
}) {
  const { tone, labelDefault } = STATUS[status];
  const color = toneVar(tone);
  const dot = size === "sm" ? 5 : 6;
  const text = label ?? labelDefault;

  return (
    <span
      className={`inline-flex items-center ${size === "sm" ? "gap-1" : "gap-1.5"}`}
      aria-label={`Estado: ${text}`}
    >
      <span
        aria-hidden
        className={`inline-block shrink-0 rounded-full ${pulse ? "pulse-dot" : ""}`}
        style={{
          width: dot,
          height: dot,
          background: color,
        }}
      />
      <span className="text-xs text-text-dim">{text}</span>
    </span>
  );
}
