"use client";

// Vistas SEMANA y DÍA: timeline por horas estilo Google Calendar. Recibe N
// días (7 = semana, 1 = día) y ubica cada evento con hora en su columna usando
// layoutDay (resuelve solapes lado a lado). Banda superior para los eventos de
// día completo y línea de "ahora" en la columna de hoy.
//
// v5: los bloques eran del color del estado mezclado con el panel (índigo para
// todo lo próximo) y la línea de "ahora" roja — rojo es "mal" en el sistema.
// Ahora el bloque es una superficie neutra con borde izquierdo gris (verde si
// está EN CURSO: eso sí es un estado) y la línea de ahora va en el acento,
// igual que el círculo de hoy: los dos dicen "estás aquí".

import { useEffect, useRef } from "react";
import type { CalendarEvent } from "@hermes/shared";
import { eventState, eventsForDay, isToday, layoutDay, startTimeLabel } from "@/lib/agenda";

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
        const gapPct = 100 / p.cols;
        const past = state === "pasado";
        const heightPx = (p.endMin - p.startMin) * (HOUR_PX / 60) - 2;
        const short = heightPx < 34;
        return (
          <button
            key={p.event.id}
            type="button"
            onClick={() => onSelectEvent(p.event)}
            title={`${p.event.title}`}
            className={`absolute flex cursor-pointer flex-col justify-start overflow-hidden rounded-xs border-l-2 bg-panel-2 px-1.5 py-0.5 text-left ring-1 ring-line transition-colors ring-inset hover:bg-selected ${
              state === "en-curso" ? "border-green" : "border-text-faint/60"
            }`}
            style={{
              top: p.startMin * (HOUR_PX / 60),
              height: heightPx,
              left: `calc(${p.col * gapPct}% + 2px)`,
              width: `calc(${gapPct}% - 4px)`,
            }}
          >
            {/* flex-col + justify-start: un <button> centra su contenido en
                vertical, y en un bloque de 3 horas el título quedaba a la mitad.
                Un evento corto (< ~45 min) no cabe en dos líneas: hora y título
                van en una sola, para que la hora no quede cortada. */}
            {short ? (
              <div className="truncate text-xs leading-tight">
                <span className="text-text-faint tabular-nums">{startTimeLabel(p.event)}</span>{" "}
                <span className={past ? "text-text-faint" : "text-text"}>{p.event.title}</span>
              </div>
            ) : (
              <>
                <div
                  className={`truncate text-xs leading-tight ${past ? "text-text-faint" : "text-text"}`}
                >
                  {p.event.title}
                </div>
                <div className="truncate text-xs leading-tight text-text-faint tabular-nums">
                  {startTimeLabel(p.event)}
                </div>
              </>
            )}
          </button>
        );
      })}

      {/* Línea de "ahora" */}
      {today && (
        <div
          className="pointer-events-none absolute right-0 left-0 z-10 flex items-center"
          style={{ top: nowTop }}
        >
          <span className="-ml-1 h-2 w-2 rounded-full bg-accent" />
          <span className="h-px flex-1 bg-accent" />
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

  // Arranca mostrando la mañana (desde ~5:45, para que lo de las 6:00 se vea
  // entero) en vez de medianoche.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 5.75 * HOUR_PX;
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
              <div key={day.getTime()} className="min-w-0 flex-1 border-l border-line px-1.5 py-1.5">
                <div className="flex items-center gap-1.5">
                  {!single && (
                    <span className="text-xs text-text-faint">
                      {COL_HEAD_FMT.format(day).replace(".", "")}
                    </span>
                  )}
                  <span
                    className={`grid h-6 min-w-6 place-items-center rounded-full px-1 text-xs tabular-nums ${
                      today ? "bg-accent-solid font-semibold text-on-accent" : "font-medium text-text"
                    }`}
                  >
                    {day.getDate()}
                  </span>
                </div>
                {/* Chips de día completo */}
                {allDay.length > 0 && (
                  <div className="mt-1 flex flex-col gap-0.5">
                    {allDay.map((ev) => (
                      <button
                        key={ev.id}
                        type="button"
                        onClick={() => onSelectEvent(ev)}
                        title={ev.title}
                        className={`h-5 cursor-pointer truncate rounded-xs bg-hover px-1.5 text-left text-xs transition-colors hover:bg-selected ${
                          eventState(ev, nowMs) === "pasado" ? "text-text-faint" : "text-text"
                        }`}
                      >
                        {ev.title}
                      </button>
                    ))}
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
                className="absolute right-2 -translate-y-1/2 text-xs tabular-nums text-text-faint"
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
                className="pointer-events-none absolute right-0 left-0 border-t border-line"
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
