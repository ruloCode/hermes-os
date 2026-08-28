"use client";

// Vistas SEMANA y DÍA: timeline por horas estilo Google Calendar. Recibe N
// días (7 = semana, 1 = día) y ubica cada evento con hora en su columna usando
// layoutDay (resuelve solapes lado a lado). Banda superior para los eventos de
// día completo y línea roja de "ahora" en la columna de hoy.

import { useEffect, useRef } from "react";
import type { CalendarEvent } from "@hermes/shared";
import { toneVar } from "@/components/ui/tones";
import {
  eventState,
  eventsForDay,
  isToday,
  layoutDay,
  stateTone,
  startTimeLabel,
} from "@/lib/agenda";

const HOUR_PX = 46;
const TOTAL_H = HOUR_PX * 24;
const GUTTER = "w-12";

const COL_HEAD_FMT = new Intl.DateTimeFormat("es-CO", { weekday: "short" });
const HOURS = Array.from({ length: 24 }, (_, h) => h);

function DayColumn({
  day,
  events,
  nowMs,
  onSelectEvent,
}: {
  day: Date;
  events: CalendarEvent[];
  nowMs: number;
  onSelectEvent: (ev: CalendarEvent) => void;
}) {
  const placed = layoutDay(eventsForDay(events, day), day);
  const today = isToday(day, nowMs);
  const now = new Date(nowMs);
  const nowTop = (now.getHours() * 60 + now.getMinutes()) * (HOUR_PX / 60);

  return (
    <div className="relative flex-1 border-l border-line" style={{ height: TOTAL_H }}>
      {placed.map((p) => {
        const state = eventState(p.event, nowMs);
        const color = toneVar(stateTone(state));
        const gapPct = 100 / p.cols;
        return (
          <button
            key={p.event.id}
            type="button"
            onClick={() => onSelectEvent(p.event)}
            title={`${p.event.title}`}
            className="absolute overflow-hidden rounded-[3px] border-l-2 px-1 py-0.5 text-left transition-[filter] hover:brightness-125"
            style={{
              top: p.startMin * (HOUR_PX / 60),
              height: (p.endMin - p.startMin) * (HOUR_PX / 60) - 2,
              left: `calc(${p.col * gapPct}% + 1px)`,
              width: `calc(${gapPct}% - 3px)`,
              borderColor: color,
              background: `color-mix(in srgb, ${color} 16%, var(--color-panel))`,
              opacity: state === "pasado" ? 0.6 : 1,
            }}
          >
            <div className="truncate text-2xs leading-tight text-text">{p.event.title}</div>
            <div className="truncate text-2xs leading-tight text-text-dim tabular-nums">
              {startTimeLabel(p.event)}
            </div>
          </button>
        );
      })}

      {/* Línea de "ahora" */}
      {today && (
        <div
          className="pointer-events-none absolute right-0 left-0 z-10 flex items-center"
          style={{ top: nowTop }}
        >
          <span className="-ml-1 h-2 w-2 rounded-full bg-red" />
          <span className="h-px flex-1 bg-red" />
        </div>
      )}
    </div>
  );
}

export function WeekTimeline({
  days,
  events,
  nowMs,
  onSelectEvent,
}: {
  days: Date[];
  events: CalendarEvent[];
  nowMs: number;
  onSelectEvent: (ev: CalendarEvent) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Arranca mostrando la mañana (~6:30) en vez de medianoche.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 6.5 * HOUR_PX;
  }, []);

  const single = days.length === 1;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Encabezado de columnas + banda de día completo (fija) */}
      <div className="shrink-0">
        <div className="flex border-b border-line">
          <div className={`${GUTTER} shrink-0`} />
          {days.map((day) => {
            const today = isToday(day, nowMs);
            const allDay = eventsForDay(events, day).filter((e) => e.allDay);
            return (
              <div key={day.getTime()} className="min-w-0 flex-1 border-l border-line px-1 py-1">
                <div className="flex items-baseline gap-1.5">
                  {!single && (
                    <span className="text-2xs tracking-label text-text-dim uppercase">
                      {COL_HEAD_FMT.format(day).replace(".", "")}
                    </span>
                  )}
                  <span
                    className={`grid h-5 min-w-5 place-items-center rounded-full px-1 text-2xs tabular-nums ${
                      today ? "bg-violet font-semibold text-bg" : "text-text"
                    }`}
                  >
                    {day.getDate()}
                  </span>
                </div>
                {/* Chips de día completo */}
                {allDay.length > 0 && (
                  <div className="mt-1 flex flex-col gap-0.5">
                    {allDay.map((ev) => {
                      const color = toneVar(stateTone(eventState(ev, nowMs)));
                      return (
                        <button
                          key={ev.id}
                          type="button"
                          onClick={() => onSelectEvent(ev)}
                          title={ev.title}
                          className="truncate rounded-[3px] border-l-2 px-1 py-0.5 text-left text-2xs text-text hover:brightness-125"
                          style={{
                            borderColor: color,
                            background: `color-mix(in srgb, ${color} 22%, transparent)`,
                          }}
                        >
                          {ev.title}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Cuerpo con scroll: gutter de horas + columnas de día */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="relative flex" style={{ height: TOTAL_H }}>
          {/* Gutter de horas */}
          <div className={`${GUTTER} relative shrink-0`}>
            {HOURS.map((h) => (
              <span
                key={h}
                className="absolute right-1 -translate-y-1/2 text-2xs tabular-nums text-text-faint"
                style={{ top: h * HOUR_PX }}
              >
                {h === 0 ? "" : `${String(h).padStart(2, "0")}:00`}
              </span>
            ))}
          </div>

          {/* Columnas de día (con líneas de hora de fondo) */}
          <div className="relative flex flex-1">
            {/* Líneas horizontales de hora */}
            {HOURS.map((h) => (
              <div
                key={h}
                className="pointer-events-none absolute right-0 left-0 border-t border-line/50"
                style={{ top: h * HOUR_PX }}
              />
            ))}
            {days.map((day) => (
              <DayColumn
                key={day.getTime()}
                day={day}
                events={events}
                nowMs={nowMs}
                onSelectEvent={onSelectEvent}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
