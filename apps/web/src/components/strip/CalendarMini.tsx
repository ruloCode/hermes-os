"use client";

// Mini AGENDA: próximos eventos del feed ICS de Google Calendar con hora
// relativa real. Sin GOOGLE_CALENDAR_ICS_URL muestra el CTA de configuración;
// con cache viejo (stale) el dot del título pasa a amber.

import type { CalendarEvent, UpcomingCalendar } from "@hermes/shared";

// Formatters a nivel de módulo: Intl.DateTimeFormat es caro de instanciar.
const TIME_FMT = new Intl.DateTimeFormat("es-CO", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const DAY_FMT = new Intl.DateTimeFormat("es-CO", { weekday: "short" });
const DAY_TIME_FMT = new Intl.DateTimeFormat("es-CO", {
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const isSameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Hora relativa real del evento: "en curso" · "en 12m" · "14:30" · "vie 10:00". */
function whenLabel(ev: CalendarEvent): string {
  if (ev.startsInMin < 0) return "en curso";
  if (!ev.allDay && ev.startsInMin < 60) return `en ${ev.startsInMin}m`;
  const start = new Date(ev.start);
  const today = isSameDay(start, new Date());
  if (ev.allDay) return today ? "hoy" : DAY_FMT.format(start);
  if (today) return TIME_FMT.format(start);
  return DAY_TIME_FMT.format(start).replace(",", "");
}

export function CalendarMini({
  calendar,
  delay = 0,
}: {
  calendar: UpcomingCalendar;
  delay?: number;
}) {
  const events = calendar.events.slice(0, 3);

  return (
    <div
      className="hud-panel hud-in flex min-h-[92px] flex-col gap-1.5 p-3"
      style={{ animationDelay: `${delay}ms` }}
    >
      <header className="flex items-center gap-1.5">
        <span
          aria-hidden
          title={calendar.stale ? "cache viejo" : undefined}
          className={`h-1 w-1 shrink-0 rounded-full ${calendar.stale ? "bg-amber" : "bg-blue"}`}
        />
        <h3 className="text-2xs tracking-label uppercase text-text-dim">Agenda</h3>
      </header>
      <div className="flex min-h-0 flex-1 flex-col justify-center">
        {!calendar.configured ? (
          <p className="text-2xs text-text-dim">
            configura <span className="text-text">GOOGLE_CALENDAR_ICS_URL</span> en .env
          </p>
        ) : events.length === 0 ? (
          <p className="text-2xs text-text-faint">Sin eventos próximos</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {events.map((ev) => (
              <li key={ev.id} className="flex min-w-0 items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-xs text-text" title={ev.title}>
                  {ev.title}
                </span>
                <span
                  className={`shrink-0 text-2xs tabular-nums ${
                    ev.startsInMin < 0 ? "text-green" : "text-text-dim"
                  }`}
                >
                  {whenLabel(ev)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
