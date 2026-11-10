import type { Hono } from "hono";
import { KNOWLEDGE_SOURCES, type KnowledgeSource, type SearchMode } from "@hermes/shared";
import { applyProposal, readProposals, writeProposals } from "./dream.js";
import { searchMemoria, withIndex } from "./service.js";
import { memoriaStatus } from "./status.js";
import { runMemoriaDream, runMemoriaSync } from "./jobs.js";

/**
 * Rutas de la memoria v2 (`/memoria/*`). Especificación: openspec/changes/v6-nucleo/specs/memoria.
 * Contrato `{ ok: true, … } | { ok: false, error }` con 200: el panel muestra el motivo tal cual.
 */
export function mountMemoriaRoutes(app: Hono): void {
  app.get("/memoria/status", async (c) => {
    try {
      return c.json(await memoriaStatus());
    } catch (err) {
      return c.json({ ok: false, error: (err as Error).message });
    }
  });

  // Búsqueda directa en el índice local (depurar y evaluar). `history=1` incluye lo reemplazado;
  // `mode=lexical|vector|hybrid` fuerza una vía. La búsqueda del agente sigue siendo searchKnowledge.
  app.get("/memoria/search", async (c) => {
    const q = (c.req.query("q") ?? "").trim();
    if (!q) return c.json({ ok: false, error: "Falta «q»." });
    const limit = Math.min(30, Math.max(1, Number(c.req.query("limit")) || 10));
    const sources = (c.req.query("sources") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s): s is KnowledgeSource => (KNOWLEDGE_SOURCES as readonly string[]).includes(s));
    const modeRaw = c.req.query("mode");
    const mode = modeRaw === "lexical" || modeRaw === "vector" || modeRaw === "hybrid" ? (modeRaw as SearchMode) : undefined;
    try {
      const t = Date.now();
      const out = await searchMemoria(q, {
        limit,
        sources: sources.length ? sources : undefined,
        project: c.req.query("project") || undefined,
        mode,
        includeSuperseded: c.req.query("history") === "1",
      });
      return c.json({ ok: true, mode: out.mode, ms: Date.now() - t, why: out.why ?? null, hits: out.hits });
    } catch (err) {
      return c.json({ ok: false, error: (err as Error).message });
    }
  });

  app.post("/memoria/sync", async (c) => {
    try {
      return c.json({ ok: true, result: await runMemoriaSync() });
    } catch (err) {
      return c.json({ ok: false, error: (err as Error).message });
    }
  });

  app.post("/memoria/dream", async (c) => {
    try {
      return c.json({ ok: true, run: await runMemoriaDream(true) });
    } catch (err) {
      return c.json({ ok: false, error: (err as Error).message });
    }
  });

  app.get("/memoria/proposals", async (c) => {
    try {
      const all = await withIndex(async (idx) => readProposals(idx));
      const status = c.req.query("status") ?? "pending";
      return c.json({ ok: true, proposals: status === "all" ? all : all.filter((p) => p.status === status) });
    } catch (err) {
      return c.json({ ok: false, error: (err as Error).message });
    }
  });

  const decide = (action: "approve" | "discard") => async (c: any) => {
    const id = c.req.param("id");
    try {
      const out = await withIndex(async (idx) => {
        const list = await readProposals(idx);
        const p = list.find((x) => x.id === id);
        if (!p) return { ok: false as const, error: "No existe esa propuesta." };
        if (p.status !== "pending") return { ok: false as const, error: `Ya estaba ${p.status === "applied" ? "aplicada" : "descartada"}.` };
        if (action === "approve") applyProposal(idx, p);
        p.status = action === "approve" ? "applied" : "discarded";
        p.decidedAt = new Date().toISOString();
        await writeProposals(idx, list);
        if (action === "approve") await idx.persistState();
        return { ok: true as const, proposal: p };
      });
      return c.json(out);
    } catch (err) {
      return c.json({ ok: false, error: (err as Error).message });
    }
  };
  app.post("/memoria/proposals/:id/approve", decide("approve"));
  app.post("/memoria/proposals/:id/discard", decide("discard"));
}
