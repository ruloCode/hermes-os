import { getUpcomingCalendar } from "../calendar.js";
import { localDate } from "../day/plan.js";
import { ownerTasks } from "../day/index.js";
import { env } from "../env.js";
import { listScheduledTasks } from "../scheduled/store.js";
import { readScenes } from "../tv/scenes.js";
import { nextAlarm } from "../tv/schedule.js";
import { addDays, occurrencesOn, taskOnDay } from "./plan.js";

/**
 * La agenda combinada que pinta el teléfono: por día, el calendario, lo que
 * depende del dueño (sus pendientes) y lo que hacen sus agentes solos (tareas
 * programadas y escenas del cuarto con horario). Cada sección degrada sola.
 */

export interface AgendaItem {
  kind: "event" | "mine" | "agent";
  title: string;
  /** ISO; null = sin hora (todo el día o pendiente sin hora). */
  at: string | null;
  end?: string | null;
  done?: boolean;
  /** id del pendiente (para marcarlo desde el teléfono). */
  id?: number;
  /** Quién lo hace cuando no es el dueño ("Tarea programada", "Cuarto"). */
  who?: string;
}

export interface AgendaDay {
  date: string;
  items: AgendaItem[];
}

const sortItems = (a: AgendaItem, b: AgendaItem) =>
  (a.at == null ? 0 : 1) - (b.at == null ? 0 : 1) || (a.at ?? "").localeCompare(b.at ?? "") || Number(a.done) - Number(b.done);

export async function agendaDays(days = 7): Promise<AgendaDay[]> {
  const tz = env.SCHEDULED_TZ;
  const today = localDate(new Date(), tz);
  const dates = Array.from({ length: Math.max(1, Math.min(days, 31)) }, (_, i) => addDays(today, i));
  const [cal, tasks, scheduled, scenes, alarm] = await Promise.allSettled([
    getUpcomingCalendar(days + 1, 200, 1),
    ownerTasks(),
    listScheduledTasks(false),
    readScenes(),
    nextAlarm(),
  ]);
  const events = cal.status === "fulfilled" && cal.value.configured ? cal.value.events : [];
  const mine = tasks.status === "fulfilled" ? tasks.value : [];
  const jobs = scheduled.status === "fulfilled" ? scheduled.value.filter((t) => t.enabled && !t.blocked_reason) : [];
  const roomScenes = scenes.status === "fulfilled" ? scenes.value.scenes : [];
  const alarmAt = alarm.status === "fulfilled" ? alarm.value : null;

  return dates.map((date) => {
    const items: AgendaItem[] = [];
    for (const e of events) {
      const day = e.allDay ? e.start.slice(0, 10) : localDate(new Date(e.start), tz);
      if (day === date) items.push({ kind: "event", title: e.title, at: e.allDay ? null : e.start, end: e.allDay ? null : e.end });
    }
    for (const t of mine) {
      if (taskOnDay(t, date, today)) items.push({ kind: "mine", title: t.title, at: null, done: t.done, id: t.id });
    }
    for (const j of jobs) {
      for (const at of occurrencesOn(j.cron, j.tz || tz, date)) items.push({ kind: "agent", title: j.title, at: at.toISOString(), who: "Tarea programada" });
    }
    for (const s of roomScenes) {
      if (s.cron) for (const at of occurrencesOn(s.cron, tz, date)) items.push({ kind: "agent", title: s.name, at: at.toISOString(), who: "Cuarto" });
      if (s.before_alarm_min && alarmAt && localDate(new Date(alarmAt), tz) === date) {
        items.push({ kind: "agent", title: s.name, at: new Date(Date.parse(alarmAt) - s.before_alarm_min * 60_000).toISOString(), who: "Cuarto" });
      }
    }
    return { date, items: items.sort(sortItems) };
  });
}
