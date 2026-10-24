import type { CalendarEvent } from "@hermes/shared";

/**
 * "Mi día": lógica pura (sin red ni disco). El cuarto ES la oficina, así que el
 * tiempo se parte en escritorio (teclado/mouse de la Mac) y TV (pantalla
 * prendida). Cada número sale de una muestra real cada minuto; un hueco (el
 * agente estuvo caído) NO se rellena: se cuenta solo el minuto de la muestra.
 */

/** Sin tocar teclado ni mouse más que esto, ya no cuenta como "en el escritorio". */
export const DESK_ACTIVE_MAX_IDLE_S = 120;
/** Proyecto de las tareas del día (aparte de las de proyectos y las de juntas). */
export const DAY_PROJECT = "dia";

/** `ioreg -c IOHIDSystem` → segundos desde la última tecla/movimiento (null si no está). */
export function parseHidIdleSeconds(ioregOut: string): number | null {
  const m = /"HIDIdleTime" = (\d+)/.exec(ioregOut);
  return m ? Number(m[1]) / 1e9 : null;
}

export interface DayLog {
  date: string;
  desk_min: number;
  tv_min: number;
  /** ISO de la última muestra contada (para no contar dos veces el mismo minuto). */
  last_sample_at: string | null;
}

export const emptyDay = (date: string): DayLog => ({ date, desk_min: 0, tv_min: 0, last_sample_at: null });

/**
 * Suma una muestra. Cuenta como mucho UN minuto por muestra aunque hayan
 * pasado más (no se adivina qué pasó mientras el agente no miraba) y nada si
 * llega menos de 30 s después de la anterior (dos muestras del mismo minuto).
 */
export function addSample(log: DayLog, s: { at: Date; deskActive: boolean; tvOn: boolean }): DayLog {
  if (log.last_sample_at && s.at.getTime() - Date.parse(log.last_sample_at) < 30_000) return log;
  return {
    ...log,
    desk_min: log.desk_min + (s.deskActive ? 1 : 0),
    tv_min: log.tv_min + (s.tvOn ? 1 : 0),
    last_sample_at: s.at.toISOString(),
  };
}

/** Fecha local AAAA-MM-DD en la zona del dueño. */
export function localDate(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** 250 → "4 h 10 min" · 45 → "45 min" · 0 → "0 min". */
export function minutesLabel(m: number): string {
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r} min`;
  return r === 0 ? `${h} h` : `${h} h ${r} min`;
}

export interface DayTask {
  id: number;
  title: string;
  done: boolean;
}

export interface DayEvent {
  title: string;
  start: string;
  end: string | null;
  all_day: boolean;
}

/** Eventos que caen HOY (los de todo el día primero), ya empezados incluidos. */
export function eventsToday(events: readonly CalendarEvent[], today: string, tz: string): DayEvent[] {
  // Un evento de todo el día puede venir como fecha sola ("2026-10-20"): leída
  // como instante es la medianoche UTC, que en Bogotá cae el día ANTERIOR.
  const dayOf = (e: CalendarEvent) => (e.allDay ? e.start.slice(0, 10) : localDate(new Date(e.start), tz));
  return events
    .filter((e) => dayOf(e) === today)
    .sort((a, b) => Number(b.allDay) - Number(a.allDay) || Date.parse(a.start) - Date.parse(b.start))
    .map((e) => ({ title: e.title, start: e.start, end: e.end, all_day: e.allDay }));
}
