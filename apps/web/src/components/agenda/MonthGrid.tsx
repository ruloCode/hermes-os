"use client";

// Vista MES: cuadrícula 7×6 estilo Google Calendar. Cada celda muestra el
// número de día (círculo violeta si es hoy, atenuado si es de otro mes) y hasta
// 3 chips de evento; el resto colapsa en "+N". Clic en un chip abre el detalle;
// clic en el número de día salta a la vista Día.

import type { CalendarEvent } from "@hermes/shared";
import { toneVar } from "@/components/ui/tones";
import {
  WEEKDAY_HEADERS,
  eventState,
  eventsForDay,
  isSameMonth,
  isToday,
  monthMatrix,
  stateTone,
  startTimeLabel,
} from "@/lib/agenda";

const MAX_CHIPS = 3;

function EventChip({
  event,
  nowMs,
  onSelect,
}: {
  event: CalendarEvent;
  nowMs: number;
  onSelect: (ev: CalendarEvent) => void;
}) {
  const state = eventState(event, nowMs);
  const tone = stateTone(state);
  const color = toneVar(tone);
  const past = state === "pasado";

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onSelect(event);
      }}
      title={event.title}
      className="flex w-full items-center gap-1 rounded-[3px] border-l-2 py-0.5 pr-1 pl-1 text-left transition-colors hover:brightness-125"
      style={{
        borderColor: color,
        background: event.allDay
          ? `color-mix(in srgb, ${color} 22%, transparent)`
          : `color-mix(in srgb, ${color} 12%, transparent)`,
        opacity: past ? 0.55 : 1,
      }}
    >
      {!event.allDay && (
        <span className="shrink-0 text-2xs tabular-nums text-text-dim">{startTimeLabel(event)}</span>
      )}
      <span className="min-w-0 flex-1 truncate text-2xs text-text">{event.title}</span>
    </button>
  );
}

export function MonthGrid({
  cursor,
  events,
  nowMs,
  onSelectEvent,
  onSelectDay,
}: {
  cursor: Date;
  events: CalendarEvent[];
  nowMs: number;
  onSelectEvent: (ev: CalendarEvent) => void;
  onSelectDay: (day: Date) => void;
}) {
  const weeks = monthMatrix(cursor);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Encabezados de día */}
      <div className="grid shrink-0 grid-cols-7 border-b border-line">
        {WEEKDAY_HEADERS.map((d) => (
          <div
            key={d}
            className="px-2 py-1 text-2xs tracking-label text-text-dim uppercase"
          >
            {d}
          </div>
        ))}
      </div>

      {/* Semanas */}
      <div
        className="grid min-h-0 flex-1 grid-cols-7"
        style={{ gridTemplateRows: `repeat(${weeks.length}, minmax(0, 1fr))` }}
      >
        {weeks.flat().map((day) => {
          const dayEvents = eventsForDay(events, day);
          const shown = dayEvents.slice(0, MAX_CHIPS);
          const extra = dayEvents.length - shown.length;
          const inMonth = isSameMonth(day, cursor);
          const today = isToday(day, nowMs);

          return (
            <div
              key={day.getTime()}
              onClick={() => onSelectDay(day)}
              role="button"
              tabIndex={-1}
              className={`flex min-h-0 min-w-0 cursor-pointer flex-col gap-0.5 border-r border-b border-line p-1 transition-colors last:border-r-0 hover:bg-panel-2/40 ${
                inMonth ? "" : "bg-bg/40"
              }`}
            >
              <div className="flex shrink-0 items-center justify-between">
                <span
                  className={`grid h-5 min-w-5 place-items-center rounded-full px-1 text-2xs tabular-nums ${
                    today
                      ? "bg-violet font-semibold text-bg"
                      : inMonth
                        ? "text-text"
                        : "text-text-faint"
                  }`}
                >
                  {day.getDate()}
                </span>
                {dayEvents.length > 0 && (
                  <span className="pr-0.5 text-2xs tabular-nums text-text-faint">
                    {dayEvents.length}
                  </span>
                )}
              </div>
              <div className="flex min-h-0 flex-col gap-0.5 overflow-hidden">
                {shown.map((ev) => (
                  <EventChip key={ev.id} event={ev} nowMs={nowMs} onSelect={onSelectEvent} />
                ))}
                {extra > 0 && (
                  <span className="pl-1 text-2xs text-text-dim">+{extra} más</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
