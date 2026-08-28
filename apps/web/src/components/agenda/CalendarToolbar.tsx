"use client";

// Barra de la página AGENDA: navegación ‹ Hoy › + título del rango a la
// izquierda, selector de vistas (Mes/Semana/Día/Agenda) + slot de estado a la
// derecha. Estilo Google Calendar sobre el design system de la HUD.

import { TabBar } from "@/components/ui/TabBar";

export type AgendaMode = "mes" | "semana" | "dia" | "agenda";

const TABS: { id: AgendaMode; label: string }[] = [
  { id: "mes", label: "Mes" },
  { id: "semana", label: "Semana" },
  { id: "dia", label: "Día" },
  { id: "agenda", label: "Agenda" },
];

const navBtn =
  "grid h-7 w-7 place-items-center rounded-sm border border-line text-text-dim transition-colors hover:border-line-2 hover:text-text";

export function CalendarToolbar({
  mode,
  onMode,
  title,
  onPrev,
  onNext,
  onToday,
  right,
}: {
  mode: AgendaMode;
  onMode: (m: AgendaMode) => void;
  title: string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  right?: React.ReactNode;
}) {
  // En Agenda la navegación ‹ › no aplica (es una lista de próximos).
  const showNav = mode !== "agenda";

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-0.5">
      <div className="flex min-w-0 items-center gap-3">
        {showNav && (
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={onPrev} className={navBtn} aria-label="Anterior">
              ‹
            </button>
            <button
              type="button"
              onClick={onToday}
              className="rounded-sm border border-line px-2.5 py-1 text-2xs tracking-label text-text-dim uppercase transition-colors hover:border-line-2 hover:text-text"
            >
              Hoy
            </button>
            <button type="button" onClick={onNext} className={navBtn} aria-label="Siguiente">
              ›
            </button>
          </div>
        )}
        <h2 className="min-w-0 truncate font-display text-sm tracking-title text-text">{title}</h2>
      </div>

      <div className="flex items-center gap-3">
        <div className="w-[248px] max-w-[60vw]">
          <TabBar tabs={TABS} active={mode} onChange={(id) => onMode(id as AgendaMode)} />
        </div>
        {right}
      </div>
    </div>
  );
}
