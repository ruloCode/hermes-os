/**
 * Rutas del repaso diario de inglés (`/english/review/*`).
 * Especificación y contrato JSON exacto: openspec/changes/v6-nucleo/specs/ingles/spec.md
 * → "Notas de implementación" (el teléfono se construye leyendo solo eso).
 *
 * GET  /english/review/today    → { ok, review }
 * POST /english/review/answer   → { cardId, kind, answer, clientId, answeredAt?, day? } → { ok, …veredicto, next }
 * POST /english/review/answers  → { answers: [...] } → { ok, results, next }  (cola del teléfono)
 * GET  /english/review/stats    → { ok, patterns, totalCards, mastered, discarded }
 *
 * Los errores de validación responden 200 con { ok:false, error } para que la
 * interfaz diga el motivo (como /gym/*).
 */
import type { Hono } from "hono";
import { join } from "node:path";
import { HERMES_HOME } from "../home.js";
import { createReviewService, type ReviewAnswerInput, type ReviewService } from "./review.js";

const HABIT_NAME = "Práctica de inglés";
const BATCH_MAX = 200;

let service: ReviewService | null = null;
function reviewService(): ReviewService {
  if (service) return service;
  service = createReviewService({
    dir: join(HERMES_HOME, "english-review"),
    dry: process.env.HERMES_ENGLISH_REVIEW_DRY === "1",
    loadSessions: async () => {
      const { listEnglishSessions } = await import("./store.js");
      return listEnglishSessions(500);
    },
    checkin: async (day) => {
      const { checkinHabit, createHabit, resolveHabit } = await import("../habits/store.js");
      const habit = (await resolveHabit(HABIT_NAME)) ?? (await createHabit({ name: HABIT_NAME }));
      if (habit) await checkinHabit(habit.id, { date: day, source: "english-review" });
    },
  });
  return service;
}

const fail = (err: unknown) => ({ ok: false as const, error: err instanceof Error ? err.message : String(err) });

export function mountEnglishReviewRoutes(app: Hono): void {
  app.get("/english/review/today", async (c) => {
    try {
      return c.json({ ok: true, review: await reviewService().today() });
    } catch (err) {
      return c.json(fail(err));
    }
  });

  app.post("/english/review/answer", async (c) => {
    const body = await c.req.json<ReviewAnswerInput>().catch(() => null);
    if (!body || typeof body !== "object") return c.json({ ok: false, error: "Cuerpo JSON inválido." });
    try {
      const { result, next } = await reviewService().answer(body);
      return c.json({ ...result, next });
    } catch (err) {
      return c.json(fail(err));
    }
  });

  app.post("/english/review/answers", async (c) => {
    const body = await c.req.json<{ answers?: ReviewAnswerInput[] }>().catch(() => null);
    const list = Array.isArray(body?.answers) ? body.answers : null;
    if (!list) return c.json({ ok: false, error: "Falta answers (lista)." });
    if (list.length > BATCH_MAX) return c.json({ ok: false, error: `Máximo ${BATCH_MAX} respuestas por lote.` });
    try {
      const { results, next } = await reviewService().answers(
        // Un elemento que no es objeto responde su error en SU posición (results[i] ↔ answers[i]).
        list.map((a) => (a && typeof a === "object" ? a : {})),
      );
      return c.json({ ok: true, results, next });
    } catch (err) {
      return c.json(fail(err));
    }
  });

  app.get("/english/review/stats", async (c) => {
    try {
      return c.json({ ok: true, ...(await reviewService().stats()) });
    } catch (err) {
      return c.json(fail(err));
    }
  });
}
