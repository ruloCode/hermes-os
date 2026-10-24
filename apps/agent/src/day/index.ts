import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { getUpcomingCalendar } from "../calendar.js";
import { env } from "../env.js";
import { habitsToday } from "../habits/store.js";
import { createTask, listTasks, setTaskStatus } from "../tasks/store.js";
import { tvAdbConfigured, tvPowerState } from "../tv/adb.js";
import { taskOnDay } from "../agenda/plan.js";
import {
  addSample,
  DAY_PROJECT,
  DESK_ACTIVE_MAX_IDLE_S,
  emptyDay,
  eventsToday,
  localDate,
  parseHidIdleSeconds,
  type DayEvent,
  type DayLog,
  type DayTask,
} from "./plan.js";

/**
 * "Mi día" (idea 1 del cuarto, 2026-10-20): agenda de hoy + pendientes del día
 * + hábitos + tiempo en el escritorio y en la TV. Lo pinta la TV (inicio y
 * salvapantallas de Hermes TV) y el teléfono (pestaña Cuarto). Registro por
 * día en ~/.hermes-os/day/AAAA-MM-DD.json (sin migración).
 */

const DIR = join(homedir(), ".hermes-os", "day");
const tz = () => env.SCHEDULED_TZ;

async function readLog(date: string): Promise<DayLog> {
  try {
    return { ...emptyDay(date), ...(JSON.parse(await readFile(join(DIR, `${date}.json`), "utf8")) as DayLog), date };
  } catch {
    return emptyDay(date);
  }
}

async function writeLog(log: DayLog): Promise<void> {
  await mkdir(DIR, { recursive: true });
  await writeFile(join(DIR, `${log.date}.json`), JSON.stringify(log));
}

function hidIdleSeconds(): Promise<number | null> {
  return new Promise((resolve) => {
    execFile("/usr/sbin/ioreg", ["-c", "IOHIDSystem", "-d", "4"], { timeout: 4000 }, (err, out) =>
      resolve(err ? null : parseHidIdleSeconds(out)),
    );
  });
}

/** Job de cada minuto: ¿alguien tocó la Mac? ¿la TV está prendida? */
export async function sampleDay(): Promise<{ desk: boolean; tv: boolean } | null> {
  const idle = await hidIdleSeconds();
  if (idle == null) return null; // sin ioreg (otra máquina): no se cuenta nada
  const deskActive = idle <= DESK_ACTIVE_MAX_IDLE_S;
  const tvOn = tvAdbConfigured() ? (await tvPowerState()) === "on" : false;
  const now = new Date();
  const log = await readLog(localDate(now, tz()));
  await writeLog(addSample(log, { at: now, deskActive, tvOn }));
  return { desk: deskActive, tv: tvOn };
}

export interface DayView {
  date: string;
  events: DayEvent[];
  tasks: DayTask[];
  habits: Array<{ name: string; done: boolean }>;
  desk_min: number;
  tv_min: number;
}

/** Un poll para "Mi día". Cada sección degrada sola: sin calendario no hay agenda, nunca un placeholder. */
export async function dayView(): Promise<DayView> {
  const date = localDate(new Date(), tz());
  const [cal, tasks, habits, log] = await Promise.allSettled([
    getUpcomingCalendar(1, 30, 1),
    tasksOn(date),
    habitsToday(),
    readLog(date),
  ]);
  const l = log.status === "fulfilled" ? log.value : emptyDay(date);
  return {
    date,
    events: cal.status === "fulfilled" && cal.value.configured ? eventsToday(cal.value.events, date, tz()) : [],
    tasks: tasks.status === "fulfilled" ? tasks.value.map(({ id, title, done }) => ({ id, title, done })) : [],
    habits: habits.status === "fulfilled" ? habits.value.map((h) => ({ name: h.name, done: h.done_today })) : [],
    desk_min: l.desk_min,
    tv_min: l.tv_min,
  };
}

// ── Pendientes del dueño (con fecha opcional) ───────────────────────────
// La fecha vive en ~/.hermes-os/day/due.json (id → AAAA-MM-DD): la tabla tasks
// no tiene columna de fecha y esto no merece una migración. Sin fecha = hoy.

const DUE_PATH = join(DIR, "due.json");

async function readDue(): Promise<Record<string, string>> {
  try {
    return JSON.parse(await readFile(DUE_PATH, "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}

export interface OwnerTask extends DayTask {
  due: string | null;
  doneOn: string | null;
}

/** Todos los pendientes del dueño con su fecha y, si están hechos, el día en que se cerraron. */
export async function ownerTasks(): Promise<OwnerTask[]> {
  const [tasks, due] = await Promise.all([listTasks({ project: DAY_PROJECT }), readDue()]);
  return tasks
    .filter((t) => t.status !== "dismissed")
    .map((t) => {
      const done = t.status === "done";
      const at = (t as typeof t & { updated_at?: string }).updated_at;
      return { id: t.id, title: t.title, done, due: due[String(t.id)] ?? null, doneOn: done && at ? localDate(new Date(at), tz()) : null };
    });
}

/** Los del día `date` (hoy por defecto): pendientes primero, hechos al final. */
export async function tasksOn(date = localDate(new Date(), tz())): Promise<OwnerTask[]> {
  const today = localDate(new Date(), tz());
  return (await ownerTasks())
    .filter((t) => taskOnDay(t, date, today))
    .sort((a, b) => Number(a.done) - Number(b.done) || a.id - b.id);
}

export async function addDayTask(title: string, due: string | null = null, source: "manual" | "voice" = "manual"): Promise<OwnerTask | null> {
  // mirrorToVault:false — son pendientes del dueño, no tareas de un proyecto del vault.
  const t = await createTask({ project: DAY_PROJECT, title, source, mirrorToVault: false });
  if (!t) return null;
  if (due) {
    const map = await readDue();
    map[String(t.id)] = due;
    await mkdir(DIR, { recursive: true });
    await writeFile(DUE_PATH, JSON.stringify(map));
  }
  return { id: t.id, title: t.title, done: false, due, doneOn: null };
}

/** Busca un pendiente abierto por id o por un trozo del título (para "ya hice lo de X"). */
export async function findOwnerTask(idOrText: string): Promise<OwnerTask | null> {
  const all = (await ownerTasks()).filter((t) => !t.done);
  const n = Number(idOrText);
  if (Number.isInteger(n)) return all.find((t) => t.id === n) ?? null;
  const q = idOrText.trim().toLowerCase();
  return all.find((t) => t.title.toLowerCase().includes(q)) ?? null;
}

export async function setDayTaskDone(id: number, done: boolean): Promise<boolean> {
  return !!(await setTaskStatus(id, done ? "done" : "pending"));
}
