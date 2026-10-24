/**
 * Rutas del plan de estudios de inglés.
 *
 * GET  /english/plan        → la ruta entera: unidades y estado de cada lección,
 *                             XP, racha, cómo va cada patrón en tus clases y las
 *                             preguntas del quiz (salen de tus errores reales).
 * POST /english/plan/quiz   → { lessonId, correct, total } — la regla.
 * POST /english/plan/drill  → multipart `audio` (o `text`) + `lessonId` +
 *                             `durationSec` → transcribe con la cadena STT de
 *                             juntas, evalúa el patrón y guarda. Contrato
 *                             { ok, attempt, plan | error } en 200, como /gym/reps.
 * POST /english/plan/tutor  → { lessonId } abre la lección de voz: deja la marca
 *                             y devuelve el {{practice_context}} de la lección +
 *                             el primer turno. La cierra la práctica al guardarse.
 * DELETE /english/plan/tutor → cancela la lección de voz abierta.
 */
import type { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { planLesson, planUnit, tutorLessonBlock, tutorLessonOpening, wordCount } from "@hermes/shared";
import { transcribe } from "../meetings/stt.js";
import { emit } from "../events.js";
import { buildPracticeContext, listEnglishSessions } from "./store.js";
import { evaluateDrill } from "./plan-drill.js";
import {
  buildPlanPayload,
  clearPending,
  readAttempts,
  readPending,
  realErrorsOf,
  saveAttempt,
  setPending,
} from "./plan-store.js";

const MIN_WORDS = 8;

async function planPayload() {
  const [attempts, sessions, pending] = await Promise.all([
    readAttempts(),
    listEnglishSessions(200),
    readPending(),
  ]);
  return buildPlanPayload(attempts, sessions, pending);
}

export function mountEnglishPlanRoutes(app: Hono): void {
  app.get("/english/plan", async (c) => c.json(await planPayload()));

  app.post("/english/plan/quiz", async (c) => {
    const b = await c.req
      .json<{ lessonId?: string; correct?: number; total?: number }>()
      .catch(() => ({}) as Record<string, never>);
    const lesson = b.lessonId ? planLesson(b.lessonId) : undefined;
    if (!lesson || lesson.kind !== "regla") return c.json({ ok: false, error: "Lección desconocida." }, 400);
    const total = Math.max(1, Math.round(Number(b.total) || 0));
    const correct = Math.min(total, Math.max(0, Math.round(Number(b.correct) || 0)));
    const attempt = await saveAttempt({
      lessonId: lesson.id,
      kind: "regla",
      score: Math.round((correct / total) * 100),
      quiz: { correct, total },
    });
    return c.json({ ok: true, attempt, plan: await planPayload() });
  });

  app.post("/english/plan/drill", bodyLimit({ maxSize: 15 * 1024 * 1024 }), async (c) => {
    const body = await c.req.parseBody();
    const lesson = typeof body.lessonId === "string" ? planLesson(body.lessonId) : undefined;
    const unit = lesson ? planUnit(lesson.unit) : undefined;
    if (!lesson?.drill || !unit) return c.json({ ok: false, error: "Ejercicio desconocido." }, 400);
    const durationSec = Math.max(0, Math.round(Number(body.durationSec) || 0));

    let transcript = typeof body.text === "string" ? body.text.trim() : "";
    if (!transcript) {
      const audio = body.audio;
      if (!audio || typeof audio === "string")
        return c.json({ ok: false, error: "Falta el audio (o el texto)." }, 400);
      try {
        const r = await transcribe(audio);
        transcript = r.text.replace(/\*\*[^*\n]{1,40}:\*\*\s*/g, "").replace(/\s+/g, " ").trim();
      } catch (err) {
        return c.json({ ok: false, error: `No pude transcribir: ${err instanceof Error ? err.message : String(err)}` });
      }
    }
    const words = wordCount(transcript);
    if (words < MIN_WORDS)
      return c.json({
        ok: false,
        transcript,
        error: transcript
          ? `Solo te escuché «${transcript}». Responde con al menos dos frases.`
          : "No te escuché. Revisa el micrófono e inténtalo otra vez.",
      });

    try {
      const sessions = await listEnglishSessions(200);
      const result = await evaluateDrill({
        unit,
        drill: lesson.drill,
        transcript,
        durationSec,
        realErrors: realErrorsOf(unit.key, sessions),
        isTest: lesson.kind === "prueba",
      });
      const attempt = await saveAttempt({
        lessonId: lesson.id,
        kind: lesson.kind,
        score: result.score,
        drill: { ...result, transcript, durationSec, words },
      });
      emit({
        kind: "task_done",
        taskId: `english-plan-${attempt.id}`,
        detail: `plan de inglés: ${unit.title} · ${attempt.score}/100${attempt.passed ? " ✓" : ""}`,
      });
      return c.json({ ok: true, attempt, plan: await planPayload() });
    } catch (err) {
      console.error("[english-plan] evaluación:", String(err).slice(0, 200));
      return c.json({
        ok: false,
        transcript,
        error: `No pude evaluar la respuesta: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  });

  app.post("/english/plan/tutor", async (c) => {
    const b = await c.req.json<{ lessonId?: string }>().catch(() => ({}) as { lessonId?: string });
    const lesson = b.lessonId ? planLesson(b.lessonId) : undefined;
    const unit = lesson ? planUnit(lesson.unit) : undefined;
    if (!lesson || lesson.kind !== "tutora" || !unit)
      return c.json({ ok: false, error: "Lección desconocida." }, 400);
    const sessions = await listEnglishSessions(200);
    await setPending(lesson.id);
    const context = `${tutorLessonBlock(unit, realErrorsOf(unit.key, sessions))} ${await buildPracticeContext()}`;
    return c.json({ ok: true, context, opening: tutorLessonOpening(unit) });
  });

  app.delete("/english/plan/tutor", async (c) => {
    await clearPending();
    return c.json({ ok: true });
  });
}
