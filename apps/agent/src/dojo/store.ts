/**
 * Dojo de algoritmos: los intentos viven en disco local
 * (~/.hermes-os/dojo/attempts.jsonl, una línea por intento, sin migración —
 * como gym/ y english-plan/). Son pocos y solo los lee este agente.
 *
 * Un intento se guarda al pasar los tests, al rendirse o al terminar una
 * lección de concepto. Lo aprobado cuenta para el hábito "Dojo" de /habitos
 * (idempotente por día). Aparte, cada pasada de mecanografía (un ejemplo
 * copiado tecleando, una solución reescrita) va a typing.jsonl.
 */
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  BIG_O,
  DOJO_UNITS,
  dojoItem,
  dojoView,
  type DojoAttempt,
  type DojoPayload,
  type DojoTyping,
} from "@hermes/shared";
import { HERMES_HOME } from "../home.js";
import { todayBogota } from "../dates.js";
import { checkinHabit, createHabit, resolveHabit } from "../habits/store.js";

export const DOJO_DIR = join(HERMES_HOME, "dojo");
const ATTEMPTS_FILE = join(DOJO_DIR, "attempts.jsonl");
const TYPING_FILE = join(DOJO_DIR, "typing.jsonl");
const HABIT_NAME = "Dojo";
/** Código y notas que se guardan por intento (un pegado gigante no infla el archivo). */
const MAX_CODE = 20_000;
const MAX_NOTE = 1_000;

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
      /* línea a medias: un append cortado no tumba el dojo */
    }
  }
  return out;
}

export const readAttempts = (file = ATTEMPTS_FILE) => readJsonl<DojoAttempt>(file);
export const readTyping = (file = TYPING_FILE) => readJsonl<DojoTyping>(file);

export async function dojoPayload(files: { attempts?: string; typing?: string } = {}): Promise<DojoPayload> {
  const [attempts, typing] = await Promise.all([readAttempts(files.attempts), readTyping(files.typing)]);
  return dojoView(DOJO_UNITS, attempts, todayBogota(), typing);
}

const clip = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.slice(0, max) : undefined);
const int = (v: unknown, min: number, max: number) =>
  Math.min(max, Math.max(min, Math.round(Number(v) || 0)));

/**
 * Valida lo que manda la web y lo convierte en un intento. Devuelve un motivo
 * en texto si no sirve. La web decide si pasó (corre los tests en el
 * navegador): el agente no puede re-correr Python, así que confía en ella, como
 * confía el plan de inglés en el puntaje del quiz.
 */
export function parseAttempt(
  body: Record<string, unknown>,
): Omit<DojoAttempt, "id" | "date" | "createdAt"> | string {
  const item = typeof body.itemId === "string" ? dojoItem(body.itemId) : undefined;
  if (!item) return "Lección desconocida.";
  const gaveUp = body.gaveUp === true;
  const passed = body.passed === true;
  if (!passed && !gaveUp) return "Un intento se guarda al pasar o al rendirse.";
  if (item.kind === "concepto" && !passed) return "Una lección se guarda al terminarla.";
  const tests =
    body.tests && typeof body.tests === "object"
      ? (body.tests as Record<string, unknown>)
      : null;
  const checks =
    body.checks && typeof body.checks === "object"
      ? (body.checks as Record<string, unknown>)
      : null;
  const guessed = BIG_O.find((o) => o === body.guessedTime);
  return {
    itemId: item.id,
    kind: item.kind,
    passed,
    gaveUp,
    hints: int(body.hints, 0, 4),
    review: body.review === true,
    ms: typeof body.ms === "number" && body.ms > 0 ? Math.round(body.ms) : undefined,
    tests: tests ? { passed: int(tests.passed, 0, 999), total: int(tests.total, 0, 999) } : undefined,
    checks: checks ? { correct: int(checks.correct, 0, 99), total: int(checks.total, 0, 99) } : undefined,
    code: clip(body.code, MAX_CODE),
    understanding: clip(body.understanding, MAX_NOTE),
    plan: clip(body.plan, MAX_NOTE),
    learned: clip(body.learned, MAX_NOTE),
    guessedTime: guessed,
  };
}

export async function saveAttempt(
  input: Omit<DojoAttempt, "id" | "date" | "createdAt">,
  file = ATTEMPTS_FILE,
): Promise<DojoAttempt> {
  const attempt: DojoAttempt = {
    ...input,
    id: randomUUID().slice(0, 12),
    date: todayBogota(),
    createdAt: new Date().toISOString(),
  };
  await mkdir(DOJO_DIR, { recursive: true });
  await appendFile(file, JSON.stringify(attempt) + "\n", "utf8");
  if (attempt.passed && file === ATTEMPTS_FILE) {
    try {
      const habit = (await resolveHabit(HABIT_NAME)) ?? (await createHabit({ name: HABIT_NAME }));
      if (habit) await checkinHabit(habit.id, { source: "dojo" });
    } catch (err) {
      console.error("[dojo] check-in:", String(err).slice(0, 120));
    }
  }
  return attempt;
}

/**
 * Una pasada de mecanografía. Se descartan las imposibles (más de 30
 * caracteres por segundo, o en menos de 0,3 s): mejor no contar que
 * inflar el promedio con un pegado.
 */
export function parseTyping(body: Record<string, unknown>): Omit<DojoTyping, "id" | "date" | "createdAt"> | string {
  const item = typeof body.itemId === "string" ? dojoItem(body.itemId) : undefined;
  if (!item) return "Lección desconocida.";
  const source = body.source === "solucion" ? "solucion" : body.source === "ejemplo" ? "ejemplo" : null;
  if (!source) return "Origen desconocido.";
  const chars = int(body.chars, 0, 100_000);
  const ms = int(body.ms, 0, 3_600_000);
  if (chars < 1 || ms < 300) return "Pasada demasiado corta.";
  if (chars / (ms / 1000) > 30) return "Más de 30 caracteres por segundo: no parece tecleado.";
  return {
    itemId: item.id,
    source,
    blind: body.blind === true,
    chars,
    ms,
    errors: int(body.errors, 0, 100_000),
    maxCombo: int(body.maxCombo, 0, chars),
  };
}

export async function saveTyping(
  input: Omit<DojoTyping, "id" | "date" | "createdAt">,
  file = TYPING_FILE,
): Promise<DojoTyping> {
  const rec: DojoTyping = {
    ...input,
    id: randomUUID().slice(0, 12),
    date: todayBogota(),
    createdAt: new Date().toISOString(),
  };
  await mkdir(DOJO_DIR, { recursive: true });
  await appendFile(file, JSON.stringify(rec) + "\n", "utf8");
  return rec;
}
