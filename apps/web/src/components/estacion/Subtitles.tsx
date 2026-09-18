"use client";

// SUBTÍTULOS EN VIVO, siempre visibles: sirven a quien no oye bien en un andén
// ruidoso y a quien no entiende el acento. Cada línea lleva el color de quien
// habló; lo que dice el viajero va en blanco.

import { hostColor } from "@/lib/estacion/theme";

export interface SubtitleLine {
  key: string | null;
  name: string;
  text: string;
}

export function Subtitles({ lines, hostIndex }: { lines: SubtitleLine[]; hostIndex: (key: string) => number }) {
  return (
    <div className="flex min-h-[130px] w-full min-w-0 flex-col justify-end gap-2" aria-live="polite">
      {lines.slice(-2).map((l, i, arr) => (
        <p
          key={`${l.name}-${i}`}
          className="w-full text-[23px] leading-snug wrap-break-word"
          style={{ opacity: i === arr.length - 1 ? 1 : 0.5 }}
        >
          <span
            className="font-[family-name:var(--font-baloo)] font-semibold"
            style={{ color: l.key ? hostColor(hostIndex(l.key)) : "var(--est-butter)" }}
          >
            {l.name}:{" "}
          </span>
          <span className="text-[var(--est-butter)]">{l.text}</span>
        </p>
      ))}
    </div>
  );
}
