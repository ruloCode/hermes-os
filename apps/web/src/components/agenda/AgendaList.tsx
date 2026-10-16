"use client";

// Lista maestra de la página AGENDA: eventos agrupados por día con encabezado
// pegajoso. Cada fila es seleccionable y pinta el detalle a la derecha.
//
// v5: la fila elegida era una barra de acento de 2px + tinte índigo, y cada
// fila llevaba un punto del color del estado (índigo para todo lo próximo).
// Ahora la selección es la capa neutra `bg-selected` (como en la barra
// lateral) y solo lo que está EN CURSO lleva color: punto y "ahora" en verde.

import type { CalendarEvent } from "@hermes/shared";
import { eventState, relativeLabel, timeRangeLabel, type DayGroup } from "@/lib/agenda";

function EventRow({
  event,
  selected,
  nowMs,
  onSelect,
}: {
  event: CalendarEvent;
  selected: boolean;
  nowMs: number;
  onSelect: (id: string) => void;
}) {
  const state = eventState(event, nowMs);
  const past = state === "pasado";
  const live = state === "en-curso";

  return (
    <button
      type="button"
      onClick={() => onSelect(event.id)}
      aria-current={selected ? "true" : undefined}
      className={`flex w-full min-w-0 cursor-pointer items-center gap-3 rounded-sm px-2 py-1.5 text-left transition-colors ${
        selected ? "bg-selected" : "hover:bg-hover"
      }`}
    >
      <span
        className={`w-28 shrink-0 text-xs tabular-nums ${past ? "text-text-faint" : "text-text-dim"}`}
      >
        {timeRangeLabel(event)}
      </span>
      <span
        className={`min-w-0 flex-1 truncate text-sm ${past ? "text-text-faint" : "text-text"}`}
        title={event.title}
      >
        {event.title}
      </span>
      <span
        className={`flex shrink-0 items-center gap-1.5 text-xs tabular-nums ${
          live ? "text-green" : "text-text-faint"
        }`}
      >
        {live && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-green" />}
        {relativeLabel(event, nowMs)}
      </span>
    </button>
  );
}

export function AgendaList({
  groups,
  selectedId,
  nowMs,
  onSelect,
}: {
  groups: DayGroup[];
  selectedId: string | null;
  nowMs: number;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <section key={group.key}>
          {/* Pegajoso sobre el fondo de la CAJA (bg-panel), no del lienzo. */}
          <header className="sticky top-0 z-10 mb-0.5 flex items-baseline justify-between gap-2 bg-panel px-2 py-1.5">
            <h3 className="text-xs font-medium text-text-dim">{group.label}</h3>
            <span className="text-xs text-text-faint tabular-nums">
              {group.events.length} {group.events.length === 1 ? "evento" : "eventos"}
            </span>
          </header>
          <div className="flex flex-col">
            {group.events.map((ev) => (
              <EventRow
                key={ev.id}
                event={ev}
                selected={ev.id === selectedId}
                nowMs={nowMs}
                onSelect={onSelect}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
