import type { CalendarEvent, HabitToday } from "@hermes/shared";
import { getUpcomingCalendar } from "../calendar.js";
import { habitsToday } from "../habits/store.js";
import { listTasks } from "../tasks/store.js";
import { evolutionReport, type EvolutionReport } from "./evolution.js";

/**
 * GET /phone/home: UN poll para la pantalla de inicio del teléfono. Reusa los
 * stores de siempre; una fuente sin configurar da null / lista vacía — nunca
 * un placeholder. Cada sección degrada sola (como /dashboard).
 */

export interface PhoneHome {
  evolution: EvolutionReport | null;
  next_event: { title: string; start: string; location?: string } | null;
  today: Array<{ kind: "habit" | "task"; title: string }>;
}

const TODAY_MAX = 3;

/** Próximo evento que aún no empieza (los de todo el día de hoy ya "empezaron"). */
export function pickNextEvent(events: readonly CalendarEvent[]): PhoneHome["next_event"] {
  const ev = events
    .filter((e) => e.startsInMin >= 0)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))[0];
  if (!ev) return null;
  return { title: ev.title, start: ev.start, ...(ev.location ? { location: ev.location } : {}) };
}

/** ¿Este hábito sigue pendiente HOY? Semanal con la cuota cumplida ya no lo está. */
export function habitPendingToday(h: HabitToday): boolean {
  if (h.done_today) return false;
  if (h.cadence === "weekly") return h.week_count < Math.max(1, h.times_per_week);
  return true;
}

/** Hábitos pendientes primero (son de HOY); las tareas rellenan hasta 3. */
export function pickToday(
  habits: readonly HabitToday[],
  taskTitles: readonly string[],
  max = TODAY_MAX,
): PhoneHome["today"] {
  const out: PhoneHome["today"] = habits
    .filter(habitPendingToday)
    .map((h) => ({ kind: "habit" as const, title: h.name }));
  for (const title of taskTitles) out.push({ kind: "task", title });
  return out.slice(0, max);
}

export async function phoneHome(): Promise<PhoneHome> {
  const [evo, cal, habits, tasks] = await Promise.allSettled([
    evolutionReport(),
    getUpcomingCalendar(7, 10),
    habitsToday(),
    listTasks({ status: "pending" }),
  ]);
  const log = (what: string, r: PromiseSettledResult<unknown>) => {
    if (r.status === "rejected") console.error(`[phone/home] ${what}:`, r.reason instanceof Error ? r.reason.message : r.reason);
  };
  log("evolución", evo);
  log("calendario", cal);
  log("hábitos", habits);
  log("tareas", tasks);
  return {
    evolution: evo.status === "fulfilled" ? evo.value : null,
    next_event: cal.status === "fulfilled" && cal.value.configured ? pickNextEvent(cal.value.events) : null,
    today: pickToday(
      habits.status === "fulfilled" ? habits.value : [],
      tasks.status === "fulfilled" ? tasks.value.map((t) => t.title) : [],
    ),
  };
}
