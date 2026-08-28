// Helpers de la página AGENDA: estado temporal de un evento, agrupación por
// día y etiquetas de hora/duración/relativas. Los formatters de Intl viven a
// nivel de módulo (instanciarlos es caro) y todo se muestra en hora LOCAL —
// el feed llega en UTC y el navegador resuelve la zona del usuario.

import type { CalendarEvent } from "@hermes/shared";
import type { Tone } from "@/components/ui/tones";

const TIME_FMT = new Intl.DateTimeFormat("es-CO", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const DAY_HEADER_FMT = new Intl.DateTimeFormat("es-CO", {
  weekday: "short",
  day: "numeric",
  month: "short",
});
const FULL_DATE_FMT = new Intl.DateTimeFormat("es-CO", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

/** Estado temporal del evento respecto a "ahora". */
export type EventState = "en-curso" | "proximo" | "pasado";

const isSameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Clave local YYYY-MM-DD para agrupar por día (evita el desfase de UTC). */
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** en-curso mientras now ∈ [start, end); si no hay end, la primera hora cuenta. */
export function eventState(ev: CalendarEvent, nowMs: number): EventState {
  const startMs = new Date(ev.start).getTime();
  if (ev.allDay) {
    const start = new Date(ev.start);
    const now = new Date(nowMs);
    if (isSameDay(start, now)) return "en-curso";
    return startMs > nowMs ? "proximo" : "pasado";
  }
  const endMs = ev.end ? new Date(ev.end).getTime() : startMs + 60 * 60_000;
  if (nowMs >= startMs && nowMs < endMs) return "en-curso";
  return startMs > nowMs ? "proximo" : "pasado";
}

/** Tono semántico del estado (dots, acentos). */
export function stateTone(state: EventState): Tone {
  if (state === "en-curso") return "green";
  if (state === "pasado") return "neutral";
  return "violet";
}

export interface DayGroup {
  key: string;
  date: Date;
  /** "Hoy" · "Mañana" · "jue 9 jul". */
  label: string;
  events: CalendarEvent[];
}

/** Agrupa eventos (ya ordenados cronológicamente) por día local. */
export function groupByDay(events: CalendarEvent[], nowMs: number): DayGroup[] {
  const now = new Date(nowMs);
  const tomorrow = new Date(nowMs + 24 * 60 * 60_000);
  const groups: DayGroup[] = [];
  let current: DayGroup | null = null;

  for (const ev of events) {
    const date = new Date(ev.start);
    const key = dayKey(date);
    if (!current || current.key !== key) {
      const label = isSameDay(date, now)
        ? "Hoy"
        : isSameDay(date, tomorrow)
          ? "Mañana"
          : DAY_HEADER_FMT.format(date).replace(".", "");
      current = { key, date, label, events: [] };
      groups.push(current);
    }
    current.events.push(ev);
  }
  return groups;
}

/** "06:00 – 07:00" · "06:00" (sin fin) · "Todo el día". */
export function timeRangeLabel(ev: CalendarEvent): string {
  if (ev.allDay) return "Todo el día";
  const start = TIME_FMT.format(new Date(ev.start));
  if (!ev.end) return start;
  return `${start} – ${TIME_FMT.format(new Date(ev.end))}`;
}

/** Duración humana: "45m" · "1h" · "1h 30m". null si es de día completo o sin fin. */
export function durationLabel(ev: CalendarEvent): string | null {
  if (ev.allDay || !ev.end) return null;
  const mins = Math.round((new Date(ev.end).getTime() - new Date(ev.start).getTime()) / 60_000);
  if (mins <= 0) return null;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Fecha larga del detalle: "jueves, 9 de julio". */
export function fullDateLabel(ev: CalendarEvent): string {
  const s = FULL_DATE_FMT.format(new Date(ev.start));
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Hora de inicio corta para los chips del grid mensual: "6:00" · "14:30". */
export function startTimeLabel(ev: CalendarEvent): string {
  if (ev.allDay) return "";
  return TIME_FMT.format(new Date(ev.start));
}

// ── Matemática de calendario (grids Mes / Semana / Día) ────────────────
// Semana que empieza en LUNES (locale es-CO). getDay(): dom=0..sáb=6.

const MONTH_TITLE_FMT = new Intl.DateTimeFormat("es-CO", { month: "long", year: "numeric" });
const MONTH_SHORT_FMT = new Intl.DateTimeFormat("es-CO", { month: "short" });
const DAY_MONTH_FMT = new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short" });
const FULL_DAY_FMT = new Intl.DateTimeFormat("es-CO", {
  weekday: "long",
  day: "numeric",
  month: "long",
});
const WEEKDAY_SHORT_FMT = new Intl.DateTimeFormat("es-CO", { weekday: "short" });

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}
/** Primer día del mes desplazado n meses (para navegar ‹ ›). */
export function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}
export function isToday(d: Date, nowMs: number): boolean {
  return isSameDay(d, new Date(nowMs));
}
export function isSameMonth(d: Date, ref: Date): boolean {
  return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth();
}

/** Matriz 6×7 de días que cubre el mes del cursor (relleno lun→dom fijo). */
export function monthMatrix(cursor: Date): Date[][] {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7; // lunes = 0
  let cur = addDays(first, -offset);
  const weeks: Date[][] = [];
  for (let w = 0; w < 6; w++) {
    const week: Date[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(cur);
      cur = addDays(cur, 1);
    }
    weeks.push(week);
  }
  return weeks;
}

/** Los 7 días (lunes→domingo) de la semana del cursor. */
export function weekDaysOf(cursor: Date): Date[] {
  const offset = (cursor.getDay() + 6) % 7;
  const monday = addDays(startOfDay(cursor), -offset);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** Encabezados cortos de columna del grid: ["lun","mar",…,"dom"]. */
export const WEEKDAY_HEADERS: string[] = weekDaysOf(new Date(2024, 0, 1)).map((d) =>
  WEEKDAY_SHORT_FMT.format(d).replace(".", ""),
);

export function monthTitle(cursor: Date): string {
  return cap(MONTH_TITLE_FMT.format(cursor));
}
export function dayTitle(cursor: Date): string {
  return cap(FULL_DAY_FMT.format(cursor));
}
/** "6 – 12 de jul 2026" · "28 jun – 4 jul 2026" (cruzando mes). */
export function weekTitle(days: Date[]): string {
  const a = days[0];
  const b = days[6];
  const year = b.getFullYear();
  if (isSameMonth(a, b)) {
    return `${a.getDate()} – ${b.getDate()} ${MONTH_SHORT_FMT.format(b).replace(".", "")} ${year}`;
  }
  return `${DAY_MONTH_FMT.format(a).replace(".", "")} – ${DAY_MONTH_FMT.format(b).replace(".", "")} ${year}`;
}

/** Clave local YYYY-MM-DD de una fecha (para indexar celdas del grid). */
export function dayKeyOf(d: Date): string {
  return dayKey(d);
}

/** Eventos cuyo día de inicio (local) coincide con `day`. */
export function eventsForDay(events: CalendarEvent[], day: Date): CalendarEvent[] {
  const key = dayKey(day);
  return events.filter((e) => dayKey(new Date(e.start)) === key);
}

/** Índice eventos-por-día (una pasada) para no filtrar el array en cada celda. */
export function eventsByDay(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const map = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    const k = dayKey(new Date(e.start));
    const bucket = map.get(k);
    if (bucket) bucket.push(e);
    else map.set(k, [e]);
  }
  return map;
}

/** Solo eventos de hoy en adelante (la vista Agenda mira hacia el futuro). */
export function upcomingOnly(events: CalendarEvent[], nowMs: number): CalendarEvent[] {
  const t0 = startOfDay(new Date(nowMs)).getTime();
  return events.filter((e) => new Date(e.end ?? e.start).getTime() >= t0);
}

/** Evento con hora ubicado en el timeline: minutos desde medianoche + columna. */
export interface PlacedEvent {
  event: CalendarEvent;
  /** Minutos [0,1440] desde medianoche local del día. */
  startMin: number;
  endMin: number;
  /** Columna asignada y total de columnas de su racimo de solapes. */
  col: number;
  cols: number;
}

/**
 * Ubica los eventos con hora de un día en el timeline resolviendo solapes:
 * los agrupa en racimos que se tocan y reparte columnas lado a lado (mismo
 * enfoque que Google Calendar). Los de día completo se excluyen (van a la
 * banda superior). Cada evento se recorta a [0,1440] y dura mínimo 20 min
 * visualmente para que siempre sea clickeable.
 */
export function layoutDay(events: CalendarEvent[], day: Date): PlacedEvent[] {
  const dayStart = startOfDay(day).getTime();
  const items: PlacedEvent[] = events
    .filter((e) => !e.allDay)
    .map((e) => {
      const s = new Date(e.start).getTime();
      const end = e.end ? new Date(e.end).getTime() : s + 60 * 60_000;
      const startMin = Math.max(0, Math.min(1440, (s - dayStart) / 60_000));
      const rawEnd = Math.max(0, Math.min(1440, (end - dayStart) / 60_000));
      return { event: e, startMin, endMin: Math.max(rawEnd, startMin + 20), col: 0, cols: 1 };
    })
    .sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);

  let cluster: PlacedEvent[] = [];
  let colEnds: number[] = [];
  const flush = () => {
    for (const it of cluster) it.cols = colEnds.length;
    cluster = [];
    colEnds = [];
  };
  for (const it of items) {
    // Nuevo racimo si este evento no solapa con ninguno del racimo actual.
    if (cluster.length && it.startMin >= Math.max(...cluster.map((c) => c.endMin))) flush();
    let placed = false;
    for (let ci = 0; ci < colEnds.length; ci++) {
      if (colEnds[ci] <= it.startMin) {
        it.col = ci;
        colEnds[ci] = it.endMin;
        placed = true;
        break;
      }
    }
    if (!placed) {
      it.col = colEnds.length;
      colEnds.push(it.endMin);
    }
    cluster.push(it);
  }
  flush();
  return items;
}

/** Etiqueta relativa fresca: "en curso" · "en 12m" · "en 3h" · "en 2 días" · "pasó". */
export function relativeLabel(ev: CalendarEvent, nowMs: number): string {
  const state = eventState(ev, nowMs);
  if (state === "en-curso") return "en curso";
  if (state === "pasado") return "pasó";
  if (ev.allDay) {
    const days = Math.round((new Date(ev.start).getTime() - nowMs) / (24 * 60 * 60_000));
    return days <= 1 ? "mañana" : `en ${days} días`;
  }
  const mins = Math.round((new Date(ev.start).getTime() - nowMs) / 60_000);
  if (mins < 60) return `en ${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `en ${hours}h`;
  const days = Math.round(mins / (60 * 24));
  return `en ${days} día${days === 1 ? "" : "s"}`;
}
