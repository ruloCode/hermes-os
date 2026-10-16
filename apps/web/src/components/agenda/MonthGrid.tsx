"use client";

// Vista MES: cuadrícula 7×N estilo Google Calendar. Cada celda muestra el
// número de día (círculo del acento si es hoy, atenuado si es de otro mes) y
// los eventos que QUEPAN en su alto (medido, no fijo: con 3 fijos, en una
// ventana de 800px el "+N más" quedaba cortado a la mitad); el resto colapsa
// en "+N más". Clic en un evento abre el detalle; clic en la celda salta a la
// vista Día.
//
// v5: los eventos eran bloques teñidos (fondo del color al 12–22 % + borde
// izquierdo de 2px) en TODAS las celdas — un mes típico eran ~120 rectángulos
// índigo y la cuadrícula se leía como una pared. Ahora un evento con hora es
// una línea de texto (hora en gris + título) que solo se marca al pasar el
// mouse; el de día completo conserva un fondo tenue porque ocupa el día. Lo
// pasado baja a gris tenue, el fin de semana lleva un fondo apenas distinto y
// el único color fuerte de la cuadrícula es HOY. "En curso" lleva un punto
// verde (estado).

import { useEffect, useRef, useState } from "react";
import type { CalendarEvent } from "@hermes/shared";
import {
  WEEKDAY_HEADERS,
  eventState,
  eventsForDay,
  isSameMonth,
  isToday,
  monthMatrix,
  startOfDay,
  startTimeLabel,
} from "@/lib/agenda";

// Geometría de la celda (px): número de día (24 + 4 de aire + 1 de borde), padding (6+6) y
// cada línea de evento (20 + 1 de separación). Si cambian las clases de abajo,
// cambian aquí.
const DAY_HEAD = 29;
const CELL_PAD = 12;
const LINE = 21;
const MAX_LINES = 6;

function EventLine({
  event,
  nowMs,
  onSelect,
}: {
  event: CalendarEvent;
  nowMs: number;
  onSelect: (ev: CalendarEvent) => void;
}) {
  const state = eventState(event, nowMs);
  const past = state === "pasado";
  const live = state === "en-curso";

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onSelect(event);
      }}
      title={event.title}
      className={`flex h-5 w-full min-w-0 shrink-0 cursor-pointer items-center gap-1.5 rounded-xs px-1.5 text-left text-xs transition-colors hover:bg-selected ${
        event.allDay ? "bg-hover" : ""
      }`}
    >
      {live && <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-green" />}
      {!event.allDay && (
        <span className="shrink-0 text-text-faint tabular-nums">{startTimeLabel(event)}</span>
      )}
      <span className={`min-w-0 flex-1 truncate ${past ? "text-text-faint" : "text-text"}`}>
        {event.title}
      </span>
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
  const todayStart = startOfDay(new Date(nowMs)).getTime();

  // Cuántas líneas caben por celda, según el alto real de la cuadrícula.
  const gridRef = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState(3);
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const measure = () => {
      const cellH = el.clientHeight / weeks.length;
      const fit = Math.floor((cellH - DAY_HEAD - CELL_PAD) / LINE);
      setLines(Math.max(1, Math.min(MAX_LINES, fit)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [weeks.length]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Encabezados de día */}
      <div className="grid shrink-0 grid-cols-7 border-b border-line">
        {WEEKDAY_HEADERS.map((d) => (
          <div key={d} className="px-2.5 py-2 text-xs text-text-faint">
            {d}
          </div>
        ))}
      </div>

      {/* Semanas */}
      <div
        ref={gridRef}
        className="grid min-h-0 flex-1 grid-cols-7"
        style={{ gridTemplateRows: `repeat(${weeks.length}, minmax(0, 1fr))` }}
      >
        {weeks.flat().map((day, i) => {
          const dayEvents = eventsForDay(events, day);
          // Si no caben todos, la última línea es el "+N más".
          const shown =
            dayEvents.length > lines ? dayEvents.slice(0, Math.max(lines - 1, 0)) : dayEvents;
          const extra = dayEvents.length - shown.length;
          const inMonth = isSameMonth(day, cursor);
          const today = isToday(day, nowMs);
          const past = day.getTime() < todayStart;
          const col = i % 7;
          const weekend = col >= 5; // lunes→domingo: sábado y domingo
          const lastRow = i >= (weeks.length - 1) * 7;

          return (
            <div
              key={day.getTime()}
              onClick={() => onSelectDay(day)}
              role="button"
              tabIndex={-1}
              aria-label={`Ver el día ${day.getDate()}`}
              className={`group flex min-h-0 min-w-0 cursor-pointer flex-col gap-0.5 border-line p-1.5 transition-colors hover:bg-hover ${
                col < 6 ? "border-r" : ""
              } ${lastRow ? "" : "border-b"} ${weekend ? "bg-panel-2/50" : ""}`}
            >
              <div className="flex shrink-0 items-center px-0.5 pb-0.5">
                <span
                  className={`grid h-6 min-w-6 place-items-center rounded-full px-1 text-xs tabular-nums ${
                    today
                      ? "bg-accent-solid font-semibold text-on-accent"
                      : !inMonth
                        ? "text-text-faint/60"
                        : past
                          ? "text-text-faint"
                          : "font-medium text-text"
                  }`}
                >
                  {day.getDate()}
                </span>
              </div>
              <div
                className={`flex min-h-0 flex-col gap-px overflow-hidden ${
                  inMonth ? "" : "opacity-60"
                }`}
              >
                {shown.map((ev) => (
                  <EventLine key={ev.id} event={ev} nowMs={nowMs} onSelect={onSelectEvent} />
                ))}
                {extra > 0 && (
                  <span className="flex h-5 shrink-0 items-center px-1.5 text-xs text-text-faint group-hover:text-text-dim">
                    +{extra} más
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
