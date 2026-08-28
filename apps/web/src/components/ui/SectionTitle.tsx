"use client";

import type { ReactNode } from "react";
import { toneVar, type Tone } from "./tones";

/**
 * SectionTitle — título de sección fuera de Panel. Fila flex con un
 * heading (dot cuadrado del tono + texto uppercase con tracking de
 * título) y un slot `right` opcional alineado a la derecha.
 */
export function SectionTitle({
  children,
  tone = "violet",
  right,
  as: Heading = "h3",
}: {
  children: ReactNode;
  tone?: Tone;
  right?: ReactNode;
  as?: "h2" | "h3";
}) {
  const color = toneVar(tone);
  return (
    <div className="flex items-center justify-between gap-2">
      <Heading className="flex items-center gap-2 font-display text-xs tracking-title text-text-dim uppercase">
        <span
          aria-hidden
          className="inline-block shrink-0"
          style={{
            width: 6,
            height: 6,
            background: color,
            boxShadow: `0 0 6px ${color}`,
          }}
        />
        {children}
      </Heading>
      {right}
    </div>
  );
}
