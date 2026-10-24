/**
 * Rutas del Dojo de algoritmos.
 *
 * GET  /dojo           → la vista: estado de cada lección, racha, repasos que
 *                        vencen y cómo va cada unidad. El contenido (enunciados,
 *                        tests, pistas) vive en @hermes/shared y no viaja.
 * POST /dojo/attempts  → guarda un intento (pasó, se rindió o terminó una
 *                        lección). Contrato { ok, attempt, dojo | error } en 200.
 * POST /dojo/typing    → { itemId, source, blind, chars, errors, ms }: una pasada
 *                        de mecanografía. { ok, dojo | error }.
 * POST /dojo/coach     → { itemId, stage, understanding?, edgeCase?, plan?,
 *                        code?, failing? } → Hermes revisa SIN escribir código.
 *                        { ok, feedback | error } en 200, como /gym/reps.
 */
import type { Hono } from "hono";
import { dojoItem, type DojoCoachStage } from "@hermes/shared";
import { coach } from "./coach.js";
import { dojoPayload, parseAttempt, parseTyping, saveAttempt, saveTyping } from "./store.js";

const STAGES: DojoCoachStage[] = ["entender", "plan", "debug"];
const text = (v: unknown, max = 4_000) => (typeof v === "string" && v.trim() ? v.slice(0, max) : undefined);

export function mountDojoRoutes(app: Hono): void {
  app.get("/dojo", async (c) => c.json(await dojoPayload()));

  app.post("/dojo/attempts", async (c) => {
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
    const parsed = parseAttempt(body);
    if (typeof parsed === "string") return c.json({ ok: false, error: parsed }, 400);
    const attempt = await saveAttempt(parsed);
    return c.json({ ok: true, attempt, dojo: await dojoPayload() });
  });

  app.post("/dojo/typing", async (c) => {
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
    const parsed = parseTyping(body);
    if (typeof parsed === "string") return c.json({ ok: false, error: parsed }, 400);
    await saveTyping(parsed);
    return c.json({ ok: true, dojo: await dojoPayload() });
  });

  app.post("/dojo/coach", async (c) => {
    const b = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    const item = typeof b.itemId === "string" ? dojoItem(b.itemId) : undefined;
    if (!item?.problem) return c.json({ ok: false, error: "Problema desconocido." }, 400);
    const stage = STAGES.find((s) => s === b.stage);
    if (!stage) return c.json({ ok: false, error: "Momento desconocido." }, 400);
    const f = b.failing && typeof b.failing === "object" ? (b.failing as Record<string, unknown>) : null;
    try {
      const feedback = await coach({
        item,
        stage,
        understanding: text(b.understanding, 1_000),
        edgeCase: text(b.edgeCase, 500),
        plan: text(b.plan, 1_500),
        code: text(b.code, 8_000),
        failing: f
          ? {
              call: text(f.call, 300) ?? "",
              expected: text(f.expected, 300) ?? "",
              got: text(f.got, 300) ?? null,
              error: text(f.error, 300) ?? null,
            }
          : undefined,
      });
      return c.json({ ok: true, feedback });
    } catch (err) {
      console.error("[dojo] coach:", String(err).slice(0, 200));
      return c.json({ ok: false, error: "Hermes no pudo responder ahora. Sigue con las pistas." });
    }
  });
}
