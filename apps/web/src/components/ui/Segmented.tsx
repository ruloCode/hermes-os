"use client";

// CONTROL SEGMENTADO: elegir UNA de pocas vistas hermanas (secciones de una
// página, moneda, rango). Una sola pieza para lo que antes eran cuatro
// selectores hechos a mano en Estudio, Composición, Memoria y Finanzas, cada
// uno con su borde, su padding y su color de activo.
//
// El activo es una "pastilla" neutra (fondo de tarjeta + borde), no un tinte de
// acento: el acento se reserva para lo que es acción o foco. Navegable con
// flechas (patrón tablist del WAI-ARIA).

import { useRef, type ReactNode } from "react";

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  /** Conteo REAL opcional (dato o nada). */
  count?: number;
  title?: string;
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = "md",
  ariaLabel,
  className = "",
}: {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (v: T) => void;
  size?: "sm" | "md";
  ariaLabel?: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const i = options.findIndex((o) => o.value === value);
    const n = options.length;
    const next = options[(i + (e.key === "ArrowRight" ? 1 : n - 1)) % n];
    onChange(next.value);
    // El foco sigue a la selección (roving tabindex).
    requestAnimationFrame(() =>
      ref.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus(),
    );
  };
  const pad = size === "sm" ? "h-6 px-2 text-xs" : "h-7 px-2.5 text-xs";
  return (
    <div
      ref={ref}
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={onKey}
      // En una columna flex un inline-flex se estira al ancho: quien lo use
      // ahí le pasa `className="self-start"` (en una fila centraría mal).
      className={`inline-flex shrink-0 items-center gap-0.5 rounded-sm bg-hover p-0.5 ${className}`}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-xs font-medium whitespace-nowrap transition-colors ${pad} ${
              on
                ? "bg-panel text-text shadow-[var(--shadow-card)] ring-1 ring-line"
                : "text-text-faint hover:text-text"
            }`}
          >
            {o.label}
            {o.count != null && (
              <span className="text-text-faint tabular-nums">
                {o.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
