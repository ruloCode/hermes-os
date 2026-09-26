"use client";

// CABECERA DE VISTA: dónde estoy, cómo va, qué puedo hacer aquí. Una línea.
//
// Es la primera pieza de la gramática única (contexto → lista → pieza). Antes
// cada vista abría con un <Panel variant="hero"> — una caja con título dentro
// de la caja de la vista, que sumaba borde y fondo sin sumar información. El
// título de una página no es una tarjeta: es el encabezado, y la hairline de
// abajo ya lo separa de su contenido.
//
// `meta` es para datos REALES (el mes, cuántos hay, cuándo se actualizó); si no
// hay dato, no se pasa y la línea no aparece. `actions` es para los controles
// que mandan sobre toda la vista (cambiar de moneda, de rango, refrescar).

import type { ReactNode } from "react";

export function ViewHeader({
  title,
  meta,
  actions,
  onBack,
  backLabel = "Volver",
}: {
  title: string;
  meta?: ReactNode;
  actions?: ReactNode;
  /** Presente = estás en una PIEZA, no en la lista. Rige el mismo Esc. */
  onBack?: () => void;
  backLabel?: string;
}) {
  return (
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line px-1 pb-3">
      <div className="flex min-w-0 items-center gap-3">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-sm border border-line px-2 py-1 text-xs text-text-dim transition-colors hover:border-line-2 hover:text-text"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="m15 18-6-6 6-6" />
            </svg>
            {backLabel}
          </button>
        )}
        <h2 className="truncate text-lg font-medium text-text">{title}</h2>
        {meta != null && <span className="shrink-0 text-xs text-text-faint">{meta}</span>}
      </div>
      {actions != null && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}
