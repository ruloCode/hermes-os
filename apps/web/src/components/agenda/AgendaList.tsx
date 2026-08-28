"use client";

// Lista maestra de la página AGENDA: eventos agrupados por día con encabezado
// pegajoso. Cada fila es seleccionable y pinta el detalle a la derecha. El
// dot y la hora relativa se tiñen por el estado temporal del evento.

import type { CalendarEvent } from "@hermes/shared";
import { toneVar } from "@/components/ui/tones";
import {
  eventState,
  relativeLabel,
  stateTone,
  timeRangeLabel,
  type DayGroup,
} from "@/lib/agenda";

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
  const tone = stateTone(state);
  const past = state === "pasado";

  return (
    <button
      type="button"
      onClick={() => onSelect(event.id)}
      aria-current={selected ? "true" : undefined}
      className={`flex w-full items-center gap-2.5 border-l-2 py-1.5 pr-2 pl-2.5 text-left transition-colors ${
        selected
          ? "border-violet bg-violet/8"
          : "border-transparent hover:border-line-2 hover:bg-panel-2/40"
      }`}
    >
      <span
        aria-hidden
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{
          background: toneVar(tone),
          boxShadow: state === "en-curso" ? `0 0 6px ${toneVar(tone)}` : undefined,
          opacity: past ? 0.5 : 1,
        }}
      />
      <span
        className={`w-24 shrink-0 text-2xs tabular-nums ${past ? "text-text-faint" : "text-text-dim"}`}
      >
        {timeRangeLabel(event)}
      </span>
      <span
        className={`min-w-0 flex-1 truncate text-xs ${past ? "text-text-dim" : "text-text"}`}
        title={event.title}
      >
        {event.title}
      </span>
      <span
        className={`shrink-0 text-2xs tabular-nums ${
          state === "en-curso" ? "text-green" : "text-text-faint"
        }`}
      >
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
    <div className="flex flex-col gap-3">
      {groups.map((group) => (
        <section key={group.key}>
          <header className="sticky top-0 z-10 mb-1 flex items-baseline justify-between gap-2 bg-bg/85 py-1 backdrop-blur-sm">
            <h3 className="font-display text-2xs tracking-title text-violet uppercase">
              {group.label}
            </h3>
            <span className="text-2xs tabular-nums text-text-faint">
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
