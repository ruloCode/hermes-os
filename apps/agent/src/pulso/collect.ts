/**
 * Arma la foto del estado agregado (`PulseState`) leyendo cada fuente con SUS
 * funciones de lectura. `Promise.allSettled`: una fuente rota no tumba el pulso,
 * solo queda en `sources.failed` (y su sección conserva la foto anterior: ver
 * `carryOver`). Una fuente que no existe en esta máquina (sin lista de apps de
 * distracción, sin finanzas) simplemente no aparece.
 *
 * Solo lectura: nada aquí escribe.
 */
import type {
  PulseEvent,
  PulseFinance,
  PulseFocus,
  PulseGoal,
  PulseHabit,
  PulseMeeting,
  PulseOpportunity,
  PulseScheduled,
  PulseState,
  PulseTask,
} from "@hermes/shared";
import { MEETING_RECENT_DAYS, pulseLocal } from "@hermes/shared";
import { getUpcomingCalendar } from "../calendar.js";
import { tasksOn } from "../day/index.js";
import { env } from "../env.js";
import { fileFocusStore } from "../focus/store.js";
import { companion } from "../growth/index.js";
import { habitsToday } from "../habits/store.js";
import { nextPrep } from "../meetings/prep.js";
import { getMeeting, listMeetings } from "../meetings/store.js";
import { listScheduledTasks } from "../scheduled/store.js";
import { fileOpportunityStore } from "../upwork/store.js";
import { readProjects } from "../vault/projects.js";

/** Eventos de las próximas horas que entran a la foto. */
const EVENT_HORIZON_H = 12;
/** Días completos de uso que promedia el foco. */
const FOCUS_AVG_DAYS = 7;

const tz = () => env.SCHEDULED_TZ;

async function events(now: Date): Promise<PulseEvent[]> {
  const [cal, next] = await Promise.all([getUpcomingCalendar(1, 25), nextPrep().catch(() => null)]);
  if (!cal.configured) throw new Error("calendario sin configurar");
  const horizon = now.getTime() + EVENT_HORIZON_H * 3_600_000;
  return cal.events
    .filter((e) => Date.parse(e.start) <= horizon && (e.end ? Date.parse(e.end) : Date.parse(e.start)) >= now.getTime())
    .map((e) => {
      const ev: PulseEvent = { id: e.id, title: e.title, start: e.start, allDay: e.allDay };
      // Solo el evento que la preparación de juntas reconoce tiene proyecto (y por tanto hoja posible).
      if (next?.event && next.project && next.event.title === e.title && next.event.startsAt === e.start) {
        ev.project = next.project;
        ev.prepared = !!next.prep;
      }
      return ev;
    });
}

async function tasks(): Promise<PulseTask[]> {
  return (await tasksOn()).filter((t) => !t.done).map((t) => ({ id: t.id, title: t.title, due: t.due }));
}

async function habits(): Promise<PulseHabit[]> {
  return (await habitsToday()).map((h) => ({ name: h.name, done: h.done_today }));
}

async function meetings(now: Date): Promise<PulseMeeting[]> {
  const projects = (await readProjects()).filter((p) => p.estado === "activo");
  const since = now.getTime() - MEETING_RECENT_DAYS * 86_400_000;
  const out: PulseMeeting[] = [];
  for (const p of projects) {
    const recent = (await listMeetings(p.slug).catch(() => [])).filter((m) => Date.parse(m.fecha) >= since && m.accionables_count > 0);
    for (const m of recent) {
      const full = await getMeeting(p.slug, m.id).catch(() => null);
      if (!full) continue;
      const untriaged = full.actionables.filter((a) => a.taskId == null && !a.status && !a.linear_identifier).length;
      out.push({ project: m.project_slug, id: m.id, title: m.title, date: m.fecha, untriaged });
    }
  }
  return out;
}

async function goals(): Promise<PulseGoal[]> {
  const s = await companion.status();
  return s.goals
    .filter((g) => g.stage === "en_marcha")
    .map((g) => ({
      id: g.id,
      title: g.title,
      due: g.due_date ?? null,
      occurrences: g.plans.reduce((a, p) => a + p.week.occurrences, 0),
      done: g.plans.reduce((a, p) => a + p.week.done, 0),
    }));
}

async function scheduled(): Promise<PulseScheduled[]> {
  return (await listScheduledTasks(true))
    .filter((t) => t.blocked_reason || (t.enabled && t.consecutive_failures >= 2))
    .map((t) => ({ id: t.id, title: t.title, blocked: t.blocked_reason, failures: t.consecutive_failures }));
}

async function opportunities(): Promise<PulseOpportunity[]> {
  return (await fileOpportunityStore().all())
    .filter((o) => o.status === "nueva" && o.score >= env.UPWORK_NOTIFY_MIN)
    .map((o) => ({ id: o.jobId, title: o.job.title, score: o.score, receivedAt: new Date(o.receivedAt).toISOString(), url: o.job.url }));
}

/** Paquetes que el dueño marcó como distracción (`HERMES_PULSE_DISTRACTION_APPS`). Sin lista no hay foco: sin regla suya no hay intervención. */
function distractionApps(): Set<string> {
  return new Set(
    (process.env.HERMES_PULSE_DISTRACTION_APPS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

async function focus(now: Date): Promise<PulseFocus | undefined> {
  const apps = distractionApps();
  if (!apps.size) return undefined;
  const data = await fileFocusStore().load();
  const today = pulseLocal(now, tz()).date;
  const mins = (d: { apps: { package: string; minutes: number }[] }) => d.apps.filter((a) => apps.has(a.package)).reduce((s, a) => s + a.minutes, 0);
  const full = Object.values(data.usage)
    .filter((d) => d.complete && d.date < today)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, FOCUS_AVG_DAYS);
  const t = data.usage[today];
  if (!t) return undefined;
  return { date: today, minutes: mins(t), average: full.length ? full.reduce((s, d) => s + mins(d), 0) / full.length : 0, days: full.length };
}

/** Finanzas de hoy (paquete «finanzas»): import dinámico y protegido. Solo banderas y nombres de categoría, nunca montos. */
async function finance(now: Date): Promise<PulseFinance | undefined> {
  let mod: typeof import("../finance/today.js");
  try {
    mod = await import("../finance/today.js");
  } catch {
    return undefined;
  }
  const [t, i] = await Promise.all([mod.financeToday(), mod.financeInsights()]);
  if (!t.ok) throw new Error(t.error);
  return {
    month: pulseLocal(now, tz()).date.slice(0, 7),
    over: !!(t.today && (t.today.overBy ?? 0) > 0),
    drift: i.ok ? i.drift.filter((d) => d.over > 0).map((d) => d.category) : [],
  };
}

export async function collectPulseState(now = new Date()): Promise<PulseState> {
  const jobs = {
    events: events(now),
    tasks: tasks(),
    habits: habits(),
    meetings: meetings(now),
    goals: goals(),
    scheduled: scheduled(),
    opportunities: opportunities(),
    focus: focus(now),
    finance: finance(now),
  } as const;
  const names = Object.keys(jobs) as (keyof typeof jobs)[];
  const settled = await Promise.allSettled(names.map((n) => jobs[n]));
  const state: PulseState = { at: now.toISOString(), sources: { ok: [], failed: [] } };
  settled.forEach((r, i) => {
    const name = names[i]!;
    if (r.status === "rejected") {
      state.sources.failed.push(name);
      return;
    }
    if (r.value === undefined) return; // fuente que no existe aquí: no está
    (state as unknown as Record<string, unknown>)[name] = r.value;
    state.sources.ok.push(name);
  });
  return state;
}
