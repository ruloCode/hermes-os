"use client";

import { toneVar } from "./tones";

// Geometría por tamaño: track (borde 1px incluido), thumb y padding interno.
const SIZES = {
  md: { track: 30, height: 16, thumb: 12, pad: 1 },
  sm: { track: 24, height: 13, thumb: 9, pad: 1 },
} as const;

/**
 * Switch HUD dibujado en CSS puro: track redondeado + thumb cuadrado-
 * redondeado que se desliza. ON enciende el thumb en violeta con glow.
 * El wrapper garantiza área clickable de al menos 28px de alto.
 */
export function Toggle({
  checked,
  onChange,
  label,
  disabled = false,
  size = "md",
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  disabled?: boolean;
  size?: "sm" | "md";
}) {
  const s = SIZES[size];
  // Recorrido del thumb: ancho interno (sin bordes) menos thumb y paddings.
  const travel = s.track - 2 - s.thumb - s.pad * 2;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`flex min-h-7 items-center gap-2 bg-transparent ${
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
      }`}
    >
      <span
        aria-hidden
        className={`relative block shrink-0 rounded-full border transition-colors duration-150 ${
          checked ? "border-line-2" : "border-line"
        }`}
        style={{
          width: s.track,
          height: s.height,
          background: checked
            ? "color-mix(in srgb, var(--color-violet) 15%, transparent)"
            : "transparent",
        }}
      >
        <span
          className={`absolute rounded-[3px] ${checked ? "glow-box-violet" : ""}`}
          style={{
            top: s.pad,
            left: s.pad,
            width: s.thumb,
            height: s.thumb,
            background: checked ? toneVar("violet") : "var(--color-text-faint)",
            transform: checked ? `translateX(${travel}px)` : "translateX(0)",
            transition: "transform 150ms ease, background 150ms ease",
          }}
        />
      </span>
      {label && (
        <span className="text-2xs tracking-label text-text-dim uppercase">{label}</span>
      )}
    </button>
  );
}
