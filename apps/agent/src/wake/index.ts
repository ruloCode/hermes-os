import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { localDate } from "../day/plan.js";
import { env } from "../env.js";
import { emit } from "../events.js";
import { OWNER } from "../owner.js";
import { nextRun } from "../scheduled/cron.js";
import { readAlarm } from "../tv/alarm.js";
import {
  pickWakeTarget,
  pointsIfNow,
  scoreWake,
  wakeStats,
  type TargetCandidate,
  type WakeRecord,
  type WakeStats,
} from "./plan.js";

/**
 * Despertar con puntos (docs/despertar.md): la escena `despertar` abre una
 * SESIÓN al arrancar (con su hora objetivo congelada), la TV muestra "¿Ya
 * estás de pie?" y la sesión se cierra cuando el dueño confirma (OK en el
 * control, o el chat) o cuando la escena se rinde. Todo en ~/.hermes-os/wake/
 * (sin migración): state.json (sesión + compromiso) e history.json (una fila
 * por mañana).
 */

const DIR = join(homedir(), ".hermes-os", "wake");
const STATE_PATH = join(DIR, "state.json");
const HISTORY_PATH = join(DIR, "history.json");
const tz = () => env.SCHEDULED_TZ;

export interface WakeSession {
  date: string;
  target_at: string;
  target_source: WakeRecord["target_source"];
  started_at: string;
  /** Minutos de recordatorio ya dichos. */
  nudges: number[];
}

/** "Mañana me levanto a las 5:20": vale para esa mañana y manda sobre la alarma. */
export interface WakeCommit {
  at: string;
  said_at: string;
}

interface WakeState {
  session: WakeSession | null;
  commit: WakeCommit | null;
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(DIR, { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2));
}

const readState = () => readJson<WakeState>(STATE_PATH, { session: null, commit: null });
const writeState = (s: WakeState) => writeJson(STATE_PATH, s);
export const readWakeHistory = () => readJson<WakeRecord[]>(HISTORY_PATH, []);

async function saveRecord(r: WakeRecord): Promise<void> {
  const list = (await readWakeHistory()).filter((x) => x.date !== r.date);
  list.push(r);
  list.sort((a, b) => a.date.localeCompare(b.date));
  await writeJson(HISTORY_PATH, list);
}

/** Un compromiso que ya pasó hace más de 6 h no sirve para nada. */
const commitAlive = (c: WakeCommit | null, now: Date) => !!c && Date.parse(c.at) + 6 * 3600_000 > now.getTime();

/** Las horas a las que el dueño dijo/quiere despertarse: compromiso + alarma del teléfono (y la que acaba de sonar). */
export async function wakeCandidates(now = new Date()): Promise<TargetCandidate[]> {
  const [state, alarm] = await Promise.all([readState(), readAlarm()]);
  const list: TargetCandidate[] = [];
  if (commitAlive(state.commit, now)) list.push({ at: state.commit!.at, source: "compromiso" });
  for (const at of [alarm.at, alarm.prev]) if (at) list.push({ at, source: "alarma" });
  return list;
}

/**
 * Las horas que disparan las escenas "antes de la alarma": si hay compromiso
 * vigente, SOLO él (la alarma de esa mañana no vuelve a disparar el cuarto).
 */
export async function wakeTriggerTimes(now = new Date()): Promise<string[]> {
  const c = await wakeCandidates(now);
  const commit = c.filter((x) => x.source === "compromiso");
  return (commit.length ? commit : c).map((x) => x.at);
}

export type OpenResult = { session: WakeSession; record: null } | { session: null; record: WakeRecord };

/**
 * La escena del despertar arranca: abre la sesión de HOY con su hora objetivo
 * congelada. Si hoy ya confirmó, devuelve ese registro (no hay segunda vuelta).
 */
export async function openWake(now = new Date()): Promise<OpenResult> {
  const date = localDate(now, tz());
  const done = (await readWakeHistory()).find((r) => r.date === date && r.confirmed_at);
  if (done) return { session: null, record: done };
  const state = await readState();
  if (state.session?.date === date) return { session: state.session, record: null };
  const target = pickWakeTarget(await wakeCandidates(now), now);
  const session: WakeSession = { date, target_at: target.at, target_source: target.source, started_at: now.toISOString(), nudges: [] };
  await writeState({ ...state, session });
  console.log(`[wake] sesión abierta: objetivo ${target.at} (${target.source})`);
  return { session, record: null };
}

export async function noteNudge(minute: number): Promise<void> {
  const state = await readState();
  if (!state.session) return;
  await writeState({ ...state, session: { ...state.session, nudges: [...state.session.nudges, minute] } });
}

type Closed = { ok: true; record: WakeRecord; stats: WakeStats; already: boolean } | { ok: false; error: string };

async function close(confirmedAt: string | null, by: string | null, now: Date): Promise<Closed> {
  const state = await readState();
  const history = await readWakeHistory();
  const date = localDate(now, tz());
  const done = history.find((r) => r.date === date && r.confirmed_at);
  if (done) return { ok: true, record: done, stats: wakeStats(history, date), already: true };
  const s = state.session;
  if (!s) return { ok: false, error: "No hay un despertar en curso: la escena del despertar no ha arrancado hoy." };
  const record = scoreWake({ date: s.date, target_at: s.target_at, target_source: s.target_source, started_at: s.started_at, confirmed_at: confirmedAt, confirmed_by: by }, history);
  await saveRecord(record);
  // El compromiso era para esta mañana: ya se usó.
  await writeState({ session: null, commit: s.target_source === "compromiso" ? null : state.commit });
  const stats = wakeStats(await readWakeHistory(), s.date);
  emit({
    kind: "tv",
    detail: confirmedAt ? `despertar · de pie (${by}) a ${record.delta_min} min · ${record.points} puntos` : "despertar · no confirmó: 0 puntos",
  });
  return { ok: true, record, stats, already: false };
}

/** "Ya me levanté" (OK en la TV, chat). Idempotente: confirmar dos veces devuelve lo mismo. */
export const confirmWake = (by: string, now = new Date()) => close(now.toISOString(), by, now);

/** La escena se rindió (pasó el tope sin confirmación): la mañana queda en 0. */
export const missWake = (now = new Date()) => close(null, null, now);

/** ¿Sigue abierta la sesión? (la escena lo consulta mientras espera) */
export async function wakeSession(): Promise<WakeSession | null> {
  return (await readState()).session;
}

/** "Mañana me levanto a las 5:20" → la próxima vez que sean las 5:20 en la zona del dueño. null borra. */
export async function setWakeCommit(hhmm: string | null, now = new Date()): Promise<{ ok: true; commit: WakeCommit | null } | { ok: false; error: string }> {
  const state = await readState();
  if (hhmm == null) {
    await writeState({ ...state, commit: null });
    return { ok: true, commit: null };
  }
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return { ok: false, error: `La hora debe ser HH:MM (recibí '${hhmm}').` };
  const at = nextRun(`${Number(m[2])} ${Number(m[1])} * * *`, tz(), now);
  if (!at) return { ok: false, error: "No pude calcular esa hora." };
  const commit = { at: at.toISOString(), said_at: now.toISOString() };
  await writeState({ ...state, commit });
  return { ok: true, commit };
}

export interface WakeStatus {
  /** Nombre del dueño (el teléfono saluda con él). */
  owner: string;
  date: string;
  /** Sesión en curso (la TV está esperando el OK). */
  session: (WakeSession & { minutes_late: number; points_now: number }) | null;
  /** Lo de hoy, si ya hay. */
  today: WakeRecord | null;
  stats: WakeStats;
  commit: WakeCommit | null;
  /** La próxima hora a la que te vas a despertar (compromiso o alarma), si se sabe. */
  next: TargetCandidate | null;
  recent: WakeRecord[];
}

/** Un poll para la TV (pantalla de espera), el teléfono y el chat. */
export async function wakeStatus(now = new Date()): Promise<WakeStatus> {
  const [state, history, alarm] = await Promise.all([readState(), readWakeHistory(), readAlarm()]);
  const date = localDate(now, tz());
  const s = state.session;
  const live = s ? pointsIfNow(s.target_at, now, history, s.date) : null;
  const commit = commitAlive(state.commit, now) ? state.commit : null;
  const nextAlarm = alarm.at && Date.parse(alarm.at) > now.getTime() ? alarm.at : null;
  return {
    owner: OWNER,
    date,
    session: s && live ? { ...s, minutes_late: live.delta_min, points_now: live.points } : null,
    today: history.find((r) => r.date === date) ?? null,
    stats: wakeStats(history, date),
    commit,
    next: commit && Date.parse(commit.at) > now.getTime() ? { at: commit.at, source: "compromiso" } : nextAlarm ? { at: nextAlarm, source: "alarma" } : null,
    recent: history.slice(-14).reverse(),
  };
}
