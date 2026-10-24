import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * La alarma del teléfono (POST /day/alarm). Va aparte de schedule.ts para que
 * el despertar (wake/) la lea sin cargar el control de la TV.
 *
 * `prev` existe porque al sonar la alarma Android avisa YA la siguiente
 * (mañana): sin guardarla, la escena "a la hora de la alarma" y la hora
 * objetivo del despertar verían la de mañana a las 5:30:02.
 */

const DIR = join(homedir(), ".hermes-os", "day");
const ALARM_PATH = join(DIR, "alarm.json");

export interface AlarmState {
  /** Próxima alarma del teléfono (ISO) o null si no hay ninguna puesta. */
  at: string | null;
  /** La alarma anterior, si ya sonó (para la mañana en curso). */
  prev: string | null;
  updated_at: string | null;
  /** escena → hora (instante) para la que ya se disparó. */
  fired: Record<string, string>;
}

export async function readAlarm(): Promise<AlarmState> {
  try {
    const raw = JSON.parse(await readFile(ALARM_PATH, "utf8")) as Partial<AlarmState>;
    return { at: raw.at ?? null, prev: raw.prev ?? null, updated_at: raw.updated_at ?? null, fired: raw.fired ?? {} };
  } catch {
    return { at: null, prev: null, updated_at: null, fired: {} };
  }
}

export async function writeAlarm(a: AlarmState): Promise<void> {
  await mkdir(DIR, { recursive: true });
  await writeFile(ALARM_PATH, JSON.stringify(a));
}

/** Si la alarma que se reemplaza ya sonó (o está sonando), queda como `prev`. */
export function nextAlarmState(a: AlarmState, at: string | null, now: Date): AlarmState {
  const old = a.at ? Date.parse(a.at) : NaN;
  const rang = Number.isFinite(old) && old <= now.getTime() + 2 * 60_000 && a.at !== at;
  return { ...a, at, prev: rang ? a.at : a.prev, updated_at: now.toISOString() };
}

/** El teléfono avisa su próxima alarma (al conectar, al cambiar). null = no hay alarma. */
export async function setNextAlarm(at: string | null): Promise<AlarmState> {
  const next = nextAlarmState(await readAlarm(), at, new Date());
  await writeAlarm(next);
  return next;
}

export const nextAlarm = async (): Promise<string | null> => (await readAlarm()).at;
