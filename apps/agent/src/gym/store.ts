/**
 * Gimnasio de articulación: las repeticiones viven en disco local
 * (~/.hermes-os/gym/reps.jsonl, una línea por repetición, sin migración como
 * focus/ y finance/plan). Son pocas (≈4-8 al día) y solo las lee este agente.
 *
 * El día que tiene una repetición en español Y una en inglés hace check-in del
 * hábito "Gimnasio de articulación" (racha en /habitos), una vez, con la fecha
 * de la repetición.
 */
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  dailyPlan,
  gymDayCounts,
  gymScenario,
  gymStreak,
  gymTrainedDays,
  mentionsName,
  withReference,
  type GymRep,
  type GymScenario,
  type GymToday,
} from "@hermes/shared";
import { HERMES_HOME } from "../home.js";
import { env } from "../env.js";
import { OWNER } from "../owner.js";
import { addDays, todayBogota } from "../dates.js";
import { checkinHabit, createHabit, resolveHabit } from "../habits/store.js";

export const GYM_DIR = join(HERMES_HOME, "gym");
const REPS_FILE = join(GYM_DIR, "reps.jsonl");
/** Escenarios que escribió Hermes (todos, usados o no). */
const SCENARIOS_FILE = join(GYM_DIR, "scenarios.jsonl");
/** Rondas extra por día ({ "2026-10-14": [["id",…], …] }); la ronda 1 es dailyPlan. */
const ROUNDS_FILE = join(GYM_DIR, "rounds.json");
const ROUNDS_KEEP_DAYS = 30;
/** Días hacia atrás en los que un escenario hecho o propuesto no vuelve a salir. */
const USED_DAYS = 7;
const HABIT_NAME = "Gimnasio de articulación";
const RECENT_DAYS = 14;

/** Todas las repeticiones (las líneas rotas se saltan: un append cortado no tumba el gimnasio). */
export async function readReps(file = REPS_FILE): Promise<GymRep[]> {
  return readJsonl<GymRep>(file);
}

async function readJsonl<T>(file: string): Promise<T[]> {
  let raw = "";
  try {
    raw = await readFile(file, "utf8");
  } catch {
    return [];
  }
  const out: T[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as T);
    } catch {
      /* línea a medias */
    }
  }
  return out;
}

export async function readGenerated(file = SCENARIOS_FILE): Promise<GymScenario[]> {
  return readJsonl<GymScenario>(file);
}

export async function saveGenerated(list: GymScenario[], file = SCENARIOS_FILE): Promise<void> {
  if (!list.length) return;
  await mkdir(GYM_DIR, { recursive: true });
  await appendFile(file, list.map((x) => JSON.stringify(x)).join("\n") + "\n", "utf8");
}

/** Escenario por id: catálogo o generado. */
export async function findScenario(id: string): Promise<GymScenario | undefined> {
  return gymScenario(id) ?? (await readGenerated()).find((x) => x.id === id);
}

type RoundsFile = Record<string, string[][]>;

async function readRounds(): Promise<RoundsFile> {
  try {
    return JSON.parse(await readFile(ROUNDS_FILE, "utf8")) as RoundsFile;
  } catch {
    return {};
  }
}

/** Agrega una ronda extra al día (escritura atómica; poda lo de hace más de 30 días). */
export async function saveRound(date: string, ids: string[]): Promise<void> {
  const all = await readRounds();
  all[date] = [...(all[date] ?? []), ids];
  const cutoff = addDays(date, -ROUNDS_KEEP_DAYS);
  for (const d of Object.keys(all)) if (d < cutoff) delete all[d];
  await mkdir(GYM_DIR, { recursive: true });
  const tmp = `${ROUNDS_FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(all), "utf8");
  await rename(tmp, ROUNDS_FILE);
}

/**
 * Lo que no debe volver a salir: escenarios en rondas (incluido el plan) o
 * con repeticiones en los últimos días.
 */
export async function usedScenarioIds(date: string): Promise<Set<string>> {
  const since = addDays(date, -USED_DAYS);
  const [rounds, reps] = await Promise.all([readRounds(), readReps()]);
  const used = new Set<string>();
  for (const [d, list] of Object.entries(rounds)) if (d > since) for (const r of list) r.forEach((id) => used.add(id));
  for (let i = 0; i <= USED_DAYS; i++) dailyPlan(addDays(date, -i)).forEach((x) => used.add(x.id));
  for (const r of reps) if (r.date > since) used.add(r.scenarioId);
  return used;
}

/** Temas generados que todavía no salieron en ninguna ronda. */
export async function generatedPool(date: string): Promise<GymScenario[]> {
  const [gen, used] = await Promise.all([readGenerated(), usedScenarioIds(date)]);
  // Las tandas viejas traían [huecos] en la referencia o hablaban del dueño en
  // tercera persona («Rulo presenta…»): esas ya no salen.
  return gen.filter(
    (x) =>
      !used.has(x.id) &&
      !/[[\]]/.test(x.reference?.example ?? "") &&
      !mentionsName(`${x.situation} ${x.prompt} ${x.reference?.example ?? ""}`, ownerNames()),
  );
}

/** Nombres con los que se nombra al dueño (los temas le hablan de tú, nunca así). */
export function ownerNames(): string[] {
  return [OWNER, ...env.OWNER_ALIASES];
}

/** Cuántas tandas se han generado (para rotar los temas). */
export async function generatedBatches(): Promise<number> {
  return Math.floor((await readGenerated()).length / 4);
}

export async function saveRep(rep: GymRep, file = REPS_FILE): Promise<void> {
  await mkdir(GYM_DIR, { recursive: true });
  await appendFile(file, `${JSON.stringify(rep)}\n`, "utf8");
}

export async function gymToday(): Promise<GymToday> {
  const date = todayBogota();
  const [all, rounds, generated, pool] = await Promise.all([
    readReps(),
    readRounds(),
    readGenerated(),
    generatedPool(date),
  ]);
  const reps = all.filter((r) => r.date === date);
  const since = addDays(date, -RECENT_DAYS);
  const byId = new Map(generated.map((x) => [x.id, x]));
  const resolve = (id: string) => gymScenario(id) ?? byId.get(id);
  // Cada escenario sale con su referencia: las del catálogo viven en código TS
  // y el teléfono no las tiene (la web las resolvía sola con referenceOf).
  const plan = dailyPlan(date).map(withReference);
  const extra = (rounds[date] ?? [])
    .map((ids) => ids.map(resolve).filter((x): x is GymScenario => !!x).map(withReference))
    .filter((r) => r.length);
  return {
    date,
    plan,
    rounds: [plan, ...extra],
    poolReady: pool.length,
    reps,
    streak: gymStreak(all, date),
    trainedDays: gymTrainedDays(all),
    dayDone: gymDayCounts(reps),
    recent: all.filter((r) => r.date > since),
  };
}

/** Intento N de este escenario hoy (1 = primera vez). */
export async function nextAttempt(date: string, scenarioId: string): Promise<number> {
  const reps = await readReps();
  return reps.filter((r) => r.date === date && r.scenarioId === scenarioId).length + 1;
}

/** Check-in del hábito cuando el día recién empieza a contar (es + en). */
export async function maybeCheckin(date: string, before: GymRep[], after: GymRep[]): Promise<void> {
  if (gymDayCounts(before) || !gymDayCounts(after)) return;
  try {
    const habit = (await resolveHabit(HABIT_NAME)) ?? (await createHabit({ name: HABIT_NAME }));
    if (habit) await checkinHabit(habit.id, { date, source: "gym" });
  } catch (err) {
    console.error("[gym] check-in hábito:", String(err).slice(0, 120));
  }
}
