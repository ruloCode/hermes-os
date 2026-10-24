/**
 * Plan de estudios de inglés: los intentos viven en disco local
 * (~/.hermes-os/english-plan/attempts.jsonl, una línea por intento, sin
 * migración — como gym/ y focus/). Son pocos y solo los lee este agente.
 *
 * La lección con la tutora no tiene un "enviar": se abre la llamada y la
 * tutora guarda la práctica al colgar. Por eso al pedir el contexto de la
 * lección se deja una marca (pending-tutor.json) y `notePracticeSaved` — que
 * llama saveEnglishSession — la cierra con la sesión real: así cuenta igual si
 * la práctica se hizo desde el dashboard o desde el móvil.
 */
import { appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  classifyError,
  classTrend,
  planDays,
  PASS_SCORE,
  PLAN_DAILY_XP,
  PLAN_UNITS,
  planLesson,
  planStreak,
  planUnit,
  planView,
  planXp,
  patternReach,
  quizItemsFor,
  TUTOR_MIN_SEC,
  type EnglishPlanPayload,
  type EnglishSession,
  type PlanAttempt,
  type PlanPattern,
  type QuizItem,
  type SessionErrorsLike,
} from "@hermes/shared";
import { randomUUID } from "node:crypto";
import { HERMES_HOME } from "../home.js";
import { todayBogota } from "../dates.js";
import { checkinHabit, createHabit, resolveHabit } from "../habits/store.js";

export const PLAN_DIR = join(HERMES_HOME, "english-plan");
const ATTEMPTS_FILE = join(PLAN_DIR, "attempts.jsonl");
const PENDING_FILE = join(PLAN_DIR, "pending-tutor.json");
/** Pasado esto sin que se guarde una práctica, la marca de la lección se ignora. */
const PENDING_TTL_MS = 3 * 60 * 60 * 1000;
const HABIT_NAME = "Práctica de inglés";

export async function readAttempts(file = ATTEMPTS_FILE): Promise<PlanAttempt[]> {
  let raw = "";
  try {
    raw = await readFile(file, "utf8");
  } catch {
    return [];
  }
  const out: PlanAttempt[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as PlanAttempt);
    } catch {
      /* línea a medias: un append cortado no tumba el plan */
    }
  }
  return out;
}

export async function saveAttempt(
  input: Omit<PlanAttempt, "id" | "date" | "createdAt" | "passed"> & { passed?: boolean },
  file = ATTEMPTS_FILE,
): Promise<PlanAttempt> {
  const attempt: PlanAttempt = {
    ...input,
    id: randomUUID().slice(0, 12),
    date: todayBogota(),
    createdAt: new Date().toISOString(),
    passed: input.passed ?? input.score >= PASS_SCORE[input.kind],
  };
  await mkdir(PLAN_DIR, { recursive: true });
  await appendFile(file, JSON.stringify(attempt) + "\n", "utf8");
  // La racha de /habitos: una lección aprobada cuenta como práctica de inglés
  // (idempotente por día; la práctica con la tutora ya hace su propio check-in).
  if (attempt.passed && attempt.kind !== "tutora") {
    try {
      const habit = (await resolveHabit(HABIT_NAME)) ?? (await createHabit({ name: HABIT_NAME }));
      if (habit) await checkinHabit(habit.id, { source: "english-plan" });
    } catch (err) {
      console.error("[english-plan] check-in:", String(err).slice(0, 120));
    }
  }
  return attempt;
}

// ── Lección con la tutora ──────────────────────────────────────────────

interface Pending {
  lessonId: string;
  since: string;
}

export async function readPending(file = PENDING_FILE): Promise<Pending | null> {
  try {
    const p = JSON.parse(await readFile(file, "utf8")) as Pending;
    if (!planLesson(p.lessonId)) return null;
    if (Date.now() - Date.parse(p.since) > PENDING_TTL_MS) return null;
    return p;
  } catch {
    return null;
  }
}

export async function setPending(lessonId: string, file = PENDING_FILE): Promise<void> {
  await mkdir(PLAN_DIR, { recursive: true });
  await writeFile(file, JSON.stringify({ lessonId, since: new Date().toISOString() }), "utf8");
}

export async function clearPending(file = PENDING_FILE): Promise<void> {
  await rm(file, { force: true });
}

/**
 * Una práctica con la tutora se guardó: si había una lección de voz abierta,
 * la cierra con ESA sesión. Una clase real no cuenta (es otra cosa), y una
 * llamada de menos de 3 minutos tampoco — colgar no es hacer la lección.
 */
export async function notePracticeSaved(
  session: Pick<EnglishSession, "id" | "source" | "duration_sec" | "errors" | "started_at">,
  files: { attempts?: string; pending?: string } = {},
): Promise<PlanAttempt | null> {
  if (session.source === "class") return null;
  const pending = await readPending(files.pending);
  if (!pending) return null;
  // La sesión tiene que haber empezado después de abrir la lección (con margen
  // por relojes): una sesión vieja reintentada no cierra la lección de hoy.
  if (Date.parse(session.started_at) < Date.parse(pending.since) - 5 * 60_000) return null;
  const duration = session.duration_sec ?? 0;
  if (duration < TUTOR_MIN_SEC) return null;
  const lesson = planLesson(pending.lessonId)!;
  const patternErrors = session.errors.filter((e) => classifyError(e) === lesson.unit).length;
  await clearPending(files.pending);
  return saveAttempt(
    {
      lessonId: lesson.id,
      kind: "tutora",
      // Hacerla es aprobarla; la nota refleja cuánto se te escapó el patrón.
      score: Math.max(40, 100 - 15 * patternErrors),
      passed: true,
      tutor: { sessionId: session.id, durationSec: duration, patternErrors, totalErrors: session.errors.length },
    },
    files.attempts,
  );
}

// ── Lo que ve el dashboard ─────────────────────────────────────────────

/** Errores reales de un patrón, en una línea cada uno (para la tutora). */
export function realErrorsOf(unit: PlanPattern, sessions: SessionErrorsLike[], max = 5): string[] {
  const unitDef = planUnit(unit);
  if (!unitDef) return [];
  return quizItemsFor(unitDef, sessions, max, 0)
    .filter((q) => q.source)
    .map((q) => `"${q.wrong}" → "${q.right}"`);
}

export function buildPlanPayload(
  attempts: PlanAttempt[],
  sessions: SessionErrorsLike[],
  pending: Pending | null,
  today = todayBogota(),
): EnglishPlanPayload {
  const { units, current } = planView(attempts);
  const xp = planXp(attempts);
  const quizzes = Object.fromEntries(PLAN_UNITS.map((u) => [u.key, quizItemsFor(u, sessions)])) as Record<
    PlanPattern,
    QuizItem[]
  >;
  return {
    today,
    units,
    current,
    xp: { total: xp.total, today: xp.byDate[today] ?? 0, goal: PLAN_DAILY_XP },
    streak: planStreak(attempts, today),
    days: planDays(xp.byDate, today),
    trend: classTrend(sessions),
    reach: patternReach(sessions),
    sessionsCount: sessions.length,
    quizzes,
    pendingTutor: pending,
    recent: [...attempts].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 12),
  };
}
