"use client";

import type { ReactNode } from "react";
import { toneVar, type Tone } from "./tones";

/**
 * Badge — etiqueta compacta teñida por tono.
 * - line:  borde 1px del tono al 40% + texto del tono (default)
 * - solid: fondo del tono al 15% + texto del tono
 */
export function Badge({
  tone = "neutral",
  variant = "line",
  size = "md",
  children,
}: {
  tone?: Tone;
  variant?: "line" | "solid";
  size?: "sm" | "md";
  children: ReactNode;
}) {
  const color = toneVar(tone);
  const padding = size === "sm" ? "px-1.5 py-0" : "px-2 py-0.5";
  const style =
    variant === "solid"
      ? {
          color,
          background: `color-mix(in srgb, ${color} 15%, transparent)`,
        }
      : {
          color,
          border: `1px solid color-mix(in srgb, ${color} 40%, transparent)`,
        };

  return (
    <span
      className={`inline-flex items-center ${padding} text-2xs tracking-label uppercase`}
      style={{ ...style, borderRadius: 2 }}
    >
      {children}
    </span>
  );
}
