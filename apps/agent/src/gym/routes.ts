/**
 * Rutas del gimnasio de articulación.
 *
 * GET  /gym/today  → rondas de hoy + repeticiones + racha + últimos 14 días; de
 *                    paso deja preparando temas nuevos si no hay de reserva.
 * POST /gym/rounds → otra ronda (es, en, es, en) sin límite: temas nuevos de
 *                    tecnología/IA/agentes; si no hay listos espera a generarlos
 *                    (~30 s) y solo si eso falla completa con el catálogo.
 * POST /gym/reps   → multipart `audio` (o `text` para escribir/QA) + `scenarioId`
 *                    + `durationSec` → transcribe con la cadena STT de juntas,
 *                    mide (palabras/min, muletillas, señales débiles), evalúa
 *                    con el modelo y guarda. Contrato { ok, rep, today | error }
 *                    en 200, como /office/dictate: la UI muestra el motivo.
 */
import { randomUUID } from "node:crypto";
import type { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import {
  composeRound,
  detectWeakPhrases,
  GYM_PLAN_ORDER,
  gymScore,
  wordCount,
  type GymRep,
} from "@hermes/shared";
import { countFillers } from "../meetings/live-coach.js";
import { transcribe } from "../meetings/stt.js";
import { todayBogota } from "../dates.js";
import { emit } from "../events.js";
import { analyzeRep } from "./analyze.js";
import { ensurePool, generateOnce, generating } from "./generate.js";
import {
  findScenario,
  generatedPool,
  gymToday,
  maybeCheckin,
  readReps,
  saveRep,
  saveRound,
  usedScenarioIds,
} from "./store.js";

async function todayPayload() {
  return { ...(await gymToday()), generating: generating() };
}

/** Menos que esto no es una respuesta (el mic no captó, o fue un "eh…"). */
const MIN_WORDS = 6;

export function mountGymRoutes(app: Hono): void {
  app.get("/gym/today", async (c) => {
    ensurePool();
    return c.json(await todayPayload());
  });

  app.post("/gym/rounds", async (c) => {
    const date = todayBogota();
    const enough = (pool: { lang: string }[]) =>
      GYM_PLAN_ORDER.every((lang) => pool.filter((x) => x.lang === lang).length >= GYM_PLAN_ORDER.filter((l) => l === lang).length);
    let pool = await generatedPool(date);
    if (!enough(pool)) {
      try {
        await generateOnce();
      } catch (err) {
        console.error("[gym] generar ronda:", String(err).slice(0, 200));
      }
      pool = await generatedPool(date);
    }
    const round = composeRound(pool, await usedScenarioIds(date));
    if (!round) return c.json({ ok: false, error: "No quedan temas por ahora: inténtalo en un minuto." });
    await saveRound(date, round.map((x) => x.id));
    ensurePool(); // la siguiente ronda se va preparando mientras practicas esta
    return c.json({ ok: true, today: await todayPayload() });
  });

  app.post("/gym/reps", bodyLimit({ maxSize: 15 * 1024 * 1024 }), async (c) => {
    const body = await c.req.parseBody();
    const scenario = typeof body.scenarioId === "string" ? await findScenario(body.scenarioId) : undefined;
    if (!scenario) return c.json({ ok: false, error: "Escenario desconocido." }, 400);
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
          ? `Solo te escuché «${transcript}». Responde con al menos una frase completa.`
          : "No te escuché. Revisa el micrófono e inténtalo otra vez.",
      });

    const date = todayBogota();
    const all = await readReps();
    const todays = all.filter((r) => r.date === date);
    const mine = todays.filter((r) => r.scenarioId === scenario.id);
    const previous = mine[mine.length - 1];
    const wpm = durationSec > 0 ? Math.round((words / durationSec) * 60) : 0;
    const fillers = countFillers(transcript, scenario.lang === "en" ? "en" : "both");
    const weak = detectWeakPhrases(transcript, scenario.lang).map((h) => h.match);

    try {
      const feedback = await analyzeRep({ scenario, transcript, durationSec, wpm, fillers, weak, previous });
      const rep: GymRep = {
        id: randomUUID().slice(0, 12),
        date,
        scenarioId: scenario.id,
        lang: scenario.lang,
        attempt: mine.length + 1,
        transcript,
        durationSec,
        words,
        wpm,
        fillers,
        weak,
        feedback,
        score: gymScore(feedback.scores),
        createdAt: new Date().toISOString(),
      };
      await saveRep(rep);
      await maybeCheckin(date, todays, [...todays, rep]);
      emit({
        kind: "task_done",
        taskId: `gym-${rep.id}`,
        detail: `gimnasio: ${scenario.lang === "en" ? "inglés" : "español"} · ${rep.score}/100`,
      });
      return c.json({ ok: true, rep, today: await todayPayload() });
    } catch (err) {
      console.error("[gym] análisis:", String(err).slice(0, 200));
      return c.json({
        ok: false,
        transcript,
        error: `No pude evaluar la respuesta: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  });
}
