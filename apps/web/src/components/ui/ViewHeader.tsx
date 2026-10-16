"use client";

// CABECERA DE VISTA: dónde estoy, cómo va, qué puedo hacer aquí. Una línea.
//
// Es la primera pieza de la gramática única (contexto → lista → pieza). El
// título de una página no es una tarjeta: es el encabezado, y la hairline de
// abajo ya lo separa de su contenido.
//
// v5 (2026-10): la cabecera es la ÚNICA barra superior. La topbar global de v4
// (wordmark, estado, CPU/RAM/SSD, máquinas, buscar, tema, reloj) se fue a la
// barra lateral, así que cada vista abre con su propio título a sangre —
// `-mx-6` contra el `px-6` del lienzo— y la línea de abajo cruza la hoja de
// borde a borde. Antes había dos barras apiladas y ninguna decía dónde estabas.
//
// `meta` es para datos REALES (el mes, cuántos hay, cuándo se actualizó); si no
// hay dato, no se pasa y la línea no aparece. `tabs` es para las secciones de
// la vista (un <Segmented/>), pegadas al título porque cambian QUÉ ves.
// `actions` es para los controles que mandan sobre toda la vista.

import type { ReactNode } from "react";

export function ViewHeader({
  title,
  meta,
  tabs,
  actions,
  onBack,
  backLabel = "Volver",
}: {
  title: string;
  meta?: ReactNode;
  tabs?: ReactNode;
  actions?: ReactNode;
  /** Presente = estás en una PIEZA, no en la lista. El Esc lo cablea cada
   *  vista (algunas ya lo usan para salir de un takeover): aquí solo el botón. */
  onBack?: () => void;
  backLabel?: string;
}) {
  return (
    <header className="-mx-6 mb-5 flex min-h-14 shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line px-6 py-2.5">
      <div className="flex min-w-0 items-center gap-3">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-xs pr-2 pl-1 text-xs text-text-dim transition-colors hover:bg-hover hover:text-text"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="m15 18-6-6 6-6" />
            </svg>
            {backLabel}
          </button>
        )}
        <h1 className="truncate text-md font-semibold text-text">{title}</h1>
        {meta != null && <span className="shrink-0 text-xs text-text-faint">{meta}</span>}
        {tabs != null && <div className="ml-2 flex min-w-0 items-center">{tabs}</div>}
      </div>
      {actions != null && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}
