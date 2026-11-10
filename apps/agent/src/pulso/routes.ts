import type { Hono } from "hono";
import { callsToday, dismissCard, neverKind, orderCards, PULSE_KINDS, pulseLocal, sweepInbox, type PulseKind } from "@hermes/shared";
import { env } from "../env.js";
import { currentMaxCalls, currentMode, pulseStore, runRealPulse } from "./index.js";

/**
 * Rutas del pulso (`/pulse/*`). Especificación: openspec/changes/v6-nucleo/specs/pulso
 * (contrato JSON en sus notas de implementación: el teléfono mostrará la bandeja).
 * Responden 200 con `{ ok:false, error }` cuando hay un motivo que mostrar.
 */
export function mountPulseRoutes(app: Hono): void {
  const fail = (err: unknown) => ({ ok: false as const, error: err instanceof Error ? err.message : String(err) });

  app.get("/pulse/inbox", async (c) => {
    try {
      const now = new Date();
      const [inbox, memory] = await Promise.all([pulseStore.loadInbox(), pulseStore.loadMemory()]);
      const cards = orderCards(sweepInbox(inbox, now).cards);
      const byKind: Partial<Record<PulseKind, number>> = {};
      for (const card of cards) byKind[card.kind] = (byKind[card.kind] ?? 0) + 1;
      return c.json({
        ok: true,
        mode: currentMode(),
        cards,
        counts: { live: cards.length, urgent: cards.filter((x) => x.urgent).length, byKind },
        never: inbox.never,
        lastRun: memory.lastRun,
        calls: { today: callsToday(memory.calls, pulseLocal(now, env.SCHEDULED_TZ).date), max: currentMaxCalls() },
      });
    } catch (err) {
      return c.json(fail(err));
    }
  });

  app.post("/pulse/cards/:id/dismiss", async (c) => {
    try {
      const r = dismissCard(await pulseStore.loadInbox(), c.req.param("id"), new Date());
      if (!r.card) return c.json({ ok: false, error: "Esa tarjeta ya no está en la bandeja." });
      await pulseStore.saveInbox(r.inbox);
      return c.json({ ok: true, card: r.card });
    } catch (err) {
      return c.json(fail(err));
    }
  });

  app.post("/pulse/cards/:id/never", async (c) => {
    try {
      const inbox = await pulseStore.loadInbox();
      const card = inbox.cards.find((x) => x.id === c.req.param("id"));
      if (!card) return c.json({ ok: false, error: "Esa tarjeta ya no está en la bandeja." });
      const next = neverKind(inbox, card.kind);
      await pulseStore.saveInbox(next);
      return c.json({ ok: true, kind: card.kind, removed: inbox.cards.length - next.cards.length });
    } catch (err) {
      return c.json(fail(err));
    }
  });

  /** Volver a permitir una clase silenciada (la web lo ofrece en la bandeja). */
  app.post("/pulse/never/:kind/undo", async (c) => {
    const kind = c.req.param("kind") as PulseKind;
    if (!PULSE_KINDS.includes(kind)) return c.json({ ok: false, error: "Clase desconocida." });
    const inbox = await pulseStore.loadInbox();
    await pulseStore.saveInbox({ ...inbox, never: inbox.never.filter((k) => k !== kind) });
    return c.json({ ok: true, kind });
  });

  /** Una pasada ahora (QA). `{dryRun:true}` no escribe ni avisa; `fresh` ignora la foto anterior; `model:false` no llama al modelo. */
  app.post("/pulse/run", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { dryRun?: unknown; fresh?: unknown; model?: unknown };
    try {
      const r = await runRealPulse({ dryRun: body.dryRun === true, fresh: body.fresh === true, model: body.model === false ? false : undefined });
      return c.json(r);
    } catch (err) {
      return c.json(fail(err));
    }
  });

  app.get("/pulse/log", async (c) => {
    const limit = Math.min(200, Math.max(1, Number(c.req.query("limit")) || 20));
    try {
      return c.json({ ok: true, lines: await pulseStore.readLog(limit) });
    } catch (err) {
      return c.json(fail(err));
    }
  });
}
