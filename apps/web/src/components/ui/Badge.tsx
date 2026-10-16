"use client";

import type { ReactNode } from "react";
import { toneVar, type Tone } from "./tones";

/**
 * Badge — etiqueta compacta (píldora) teñida por tono.
 * - line:  borde 1px del tono al 35% + texto del tono (default)
 * - solid: fondo del tono al 12% + texto del tono
 * `neutral` = gris: la mayoría de las etiquetas no son estado y no llevan color.
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
  const padding = size === "sm" ? "h-5 px-1.5" : "h-6 px-2";
  const style =
    variant === "solid"
      ? {
          color,
          background: `color-mix(in srgb, ${color} 12%, transparent)`,
        }
      : {
          color,
          border: `1px solid color-mix(in srgb, ${color} 35%, transparent)`,
        };

  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full ${padding} text-2xs font-medium whitespace-nowrap`}
      style={style}
    >
      {children}
    </span>
  );
}
