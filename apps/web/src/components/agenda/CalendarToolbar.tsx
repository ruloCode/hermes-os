"use client";

// Barra de la página AGENDA: título del rango (+ cuándo se actualizó) a la
// izquierda; navegación Hoy ‹ ›, selector de vistas (Mes/Semana/Día/Agenda) y
// refrescar a la derecha.
//
// Hace de ViewHeader de esta vista: no se le pone un ViewHeader encima porque
// serían dos cabeceras diciendo lo mismo. Es la excepción sancionada a la
// gramática: aquí el título ES un control —cambia con ‹ ›— y no una etiqueta
// fija.
//
// v5: por eso copia la piel de ViewHeader al píxel — a sangre (`-mx-6` contra
// el `px-6` del lienzo), 56px de alto mínimo, hairline de borde a borde, título
// de 16 semibold— y usa los mismos primitivos (Segmented, Button). Antes era
// una barra con su propio padding, "HOY" en mayúsculas con tracking y botones
// ‹ › con borde: la única vista que no se parecía a las demás.

import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Segmented";

export type AgendaMode = "mes" | "semana" | "dia" | "agenda";

const MODES: { value: AgendaMode; label: string }[] = [
  { value: "mes", label: "Mes" },
  { value: "semana", label: "Semana" },
  { value: "dia", label: "Día" },
  { value: "agenda", label: "Agenda" },
];

function Chevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={dir === "left" ? "m15 18-6-6 6-6" : "m9 18 6-6-6-6"} />
    </svg>
  );
}

// Botón de icono fantasma: mismo alto que <Button size="sm">, cuadrado.
const iconBtn =
  "grid h-7 w-7 shrink-0 cursor-pointer place-items-center rounded-xs text-text-dim transition-colors hover:bg-hover hover:text-text";

export function CalendarToolbar({
  mode,
  onMode,
  title,
  onPrev,
  onNext,
  onToday,
  meta,
  right,
}: {
  mode: AgendaMode;
  onMode: (m: AgendaMode) => void;
  title: string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  /** Dato real junto al título (cuándo se actualizó, si es caché). */
  meta?: ReactNode;
  /** Acciones a la derecha del selector (refrescar). */
  right?: ReactNode;
}) {
  // En Agenda la navegación ‹ › no aplica (es una lista de próximos).
  const showNav = mode !== "agenda";

  return (
    <header className="-mx-6 mb-5 flex min-h-14 shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line px-6 py-2.5">
      <div className="flex min-w-0 items-center gap-3">
        <h1 className="truncate text-md font-semibold text-text">{title}</h1>
        {meta != null && <span className="shrink-0 text-xs text-text-faint">{meta}</span>}
      </div>

      {/* La navegación va a la derecha y NO junto al título: el título cambia
          de largo con cada mes y arrastraría los botones bajo el cursor
          mientras haces clic en ‹ › varias veces seguidas. */}
      <div className="flex items-center gap-2">
        {/* En Agenda se oculta pero CONSERVA su lugar: si colapsara, el
            selector de vistas saltaría bajo el cursor justo al elegir. */}
        <div
          className={`flex items-center gap-0.5 ${showNav ? "" : "invisible"}`}
          aria-hidden={!showNav}
        >
          <Button variant="ghost" onClick={onToday} tabIndex={showNav ? 0 : -1}>
            Hoy
          </Button>
          <button
            type="button"
            onClick={onPrev}
            className={iconBtn}
            aria-label="Anterior"
            tabIndex={showNav ? 0 : -1}
          >
            <Chevron dir="left" />
          </button>
          <button
            type="button"
            onClick={onNext}
            className={iconBtn}
            aria-label="Siguiente"
            tabIndex={showNav ? 0 : -1}
          >
            <Chevron dir="right" />
          </button>
        </div>
        <Segmented ariaLabel="Vista del calendario" value={mode} onChange={onMode} options={MODES} />
        {right}
      </div>
    </header>
  );
}
