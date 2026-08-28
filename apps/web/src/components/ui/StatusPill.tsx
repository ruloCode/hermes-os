"use client";

import { toneVar, type Tone } from "./tones";

// Mapa estado → tono semántico + label por defecto. El label siempre se
// muestra (el default se puede sobreescribir con la prop `label`).
const STATUS: Record<
  "active" | "paused" | "ok" | "warn" | "error" | "idle" | "offline",
  { tone: Tone; labelDefault: string }
> = {
  active: { tone: "green", labelDefault: "ACTIVO" },
  paused: { tone: "amber", labelDefault: "PAUSA" },
  ok: { tone: "green", labelDefault: "OK" },
  warn: { tone: "amber", labelDefault: "ATENCIÓN" },
  error: { tone: "red", labelDefault: "ERROR" },
  idle: { tone: "neutral", labelDefault: "IDLE" },
  offline: { tone: "red", labelDefault: "OFFLINE" },
};

/**
 * StatusPill — dot con glow + label de estado. `pulse` anima el dot
 * (clase .pulse-dot); `size` ajusta dot y separación.
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
          boxShadow: `0 0 6px ${color}`,
        }}
      />
      <span
        className="text-2xs tracking-label uppercase"
        style={{ color }}
      >
        {text}
      </span>
    </span>
  );
}
