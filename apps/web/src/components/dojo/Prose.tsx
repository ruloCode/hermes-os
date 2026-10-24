"use client";

// Texto del Dojo con lo mínimo de formato que usan los enunciados y las
// lecciones: `código` en línea y **negrita**. Sin markdown completo a
// propósito: el contenido es nuestro y corto, y así nada se interpreta de más.

import type { ReactNode } from "react";

export function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /`([^`]+)`|\*\*([^*]+)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      m[1] != null ? (
        <code key={m.index} className="rounded-xs bg-panel-2 px-1 py-px font-mono text-[0.92em] text-text">
          {m[1]}
        </code>
      ) : (
        <strong key={m.index} className="font-semibold text-text">
          {m[2]}
        </strong>
      ),
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Prose({ text, className = "" }: { text: string; className?: string }) {
  return <p className={`text-md leading-relaxed text-text-dim ${className}`}>{inline(text)}</p>;
}
