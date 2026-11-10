/**
 * Rutas de oportunidades de Upwork (HERMES_UPWORK=off las apaga).
 *
 * GET  /upwork/opportunities?status=&limit=  → lista (puntaje, motivos, borrador)
 * POST /upwork/sync  {dryRun?}              → corre el barrido ya
 * POST /upwork/opportunities/:id/status {status}  → nueva|descartada|avisada|aplicada
 * POST /upwork/opportunities/:id/draft      → (re)escribe el borrador; no envía nada
 *
 * Contrato {ok, …|error} en 200, como /gym: la UI y la voz relatan el motivo.
 */
import type { Hono } from "hono";
import { env } from "../env.js";
import { notifyMac } from "../notify.js";
import { phoneLink } from "../phone/link.js";
import { draftProposal } from "./draft.js";
import { fileOpportunityStore, OPPORTUNITY_STATUSES, type Opportunity, type OpportunityStatus } from "./store.js";
import { syncUpwork, type SyncResult } from "./sync.js";

export const upworkEnabled = () => env.UPWORK !== "off";

async function notify(o: Opportunity, n: { title: string; body: string }): Promise<void> {
  const notice = await phoneLink.notify({ title: n.title, body: n.body, source: "agent", ref: `upwork:${o.jobId}` });
  notifyMac("Upwork", `${o.score} · ${o.job.title}`);
  if (notice?.status === "dropped") throw new Error(`el teléfono lo descartó: ${notice.reason ?? "sin motivo"}`);
}

/** Lo que corre el job cada 10 min (null = saltado). */
export async function runUpworkSync(opts: { dryRun?: boolean } = {}): Promise<SyncResult | null> {
  if (!upworkEnabled()) return null;
  return syncUpwork({
    tz: env.SCHEDULED_TZ,
    min: env.UPWORK_NOTIFY_MIN,
    dryRun: opts.dryRun,
    notify,
    draft: draftProposal,
  });
}

export function mountUpworkRoutes(app: Hono): void {
  const off = { ok: false, error: "Upwork apagado (HERMES_UPWORK=off)" };

  app.get("/upwork/opportunities", async (c) => {
    if (!upworkEnabled()) return c.json(off);
    const status = c.req.query("status") as OpportunityStatus | undefined;
    const limit = Math.min(Number(c.req.query("limit")) || 50, 500);
    const all = await fileOpportunityStore().all();
    const list = all
      .filter((o) => !status || o.status === status)
      .sort((a, b) => b.receivedAt - a.receivedAt)
      .slice(0, limit);
    return c.json({ ok: true, opportunities: list });
  });

  app.post("/upwork/sync", async (c) => {
    if (!upworkEnabled()) return c.json(off);
    const body = (await c.req.json().catch(() => ({}))) as { dryRun?: boolean };
    try {
      const r = await runUpworkSync({ dryRun: Boolean(body.dryRun) });
      return c.json(r ? { ok: true, ...r } : { ok: false, error: "Gmail no está configurado" });
    } catch (err) {
      return c.json({ ok: false, error: String(err).slice(0, 300) });
    }
  });

  app.post("/upwork/opportunities/:id/status", async (c) => {
    if (!upworkEnabled()) return c.json(off);
    const { status } = (await c.req.json().catch(() => ({}))) as { status?: OpportunityStatus };
    if (!status || !OPPORTUNITY_STATUSES.includes(status)) {
      return c.json({ ok: false, error: `estado inválido; usa ${OPPORTUNITY_STATUSES.join("/")}` });
    }
    const store = fileOpportunityStore();
    const o = await store.get(c.req.param("id"));
    if (!o) return c.json({ ok: false, error: "no existe esa oportunidad" });
    const at = new Date().toISOString();
    const next: Opportunity = { ...o, status, updatedAt: at, ...(status === "aplicada" ? { appliedAt: at } : {}) };
    await store.put(next);
    return c.json({ ok: true, opportunity: next });
  });

  app.post("/upwork/opportunities/:id/draft", async (c) => {
    if (!upworkEnabled()) return c.json(off);
    const store = fileOpportunityStore();
    const o = await store.get(c.req.param("id"));
    if (!o) return c.json({ ok: false, error: "no existe esa oportunidad" });
    try {
      const draft = await draftProposal(o);
      const next = { ...o, draft, updatedAt: new Date().toISOString() };
      await store.put(next);
      return c.json({ ok: true, opportunity: next });
    } catch (err) {
      return c.json({ ok: false, error: String(err).slice(0, 300) });
    }
  });
}
