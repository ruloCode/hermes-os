import type { Hono } from "hono";
import { ensurePrep, nextPrep, PrepError, todayPrep } from "./prep.js";

/**
 * Rutas de la preparación de junta (`/meetings/prep*`). Especificación:
 * openspec/changes/v6-nucleo/specs/juntas (el contrato JSON está en sus notas
 * de implementación: lo consume también el teléfono).
 *
 * Responden 200 con `{ ok:false, error }` cuando la interfaz debe mostrar el
 * motivo (proyecto que no existe, fallo de lectura), como /gym/*.
 */
export function mountMeetingPrepRoutes(app: Hono): void {
  const fail = (err: unknown) => ({
    ok: false as const,
    error: err instanceof PrepError ? err.message : `No se pudo leer la preparación: ${err instanceof Error ? err.message : String(err)}`,
  });

  // Antes que cualquier /meetings/:project/:id: "prep" no es un proyecto.
  app.get("/meetings/prep/next", async (c) => {
    try {
      return c.json({ ok: true, ...(await nextPrep()) });
    } catch (err) {
      return c.json(fail(err));
    }
  });

  app.get("/meetings/prep", async (c) => {
    const project = (c.req.query("project") ?? "").trim();
    if (!project) return c.json({ ok: false, error: "Falta ?project=<slug>." });
    try {
      return c.json({ ok: true, ...(await todayPrep(project)) });
    } catch (err) {
      return c.json(fail(err));
    }
  });

  app.post("/meetings/prep", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { project?: unknown; force?: unknown };
    const project = typeof body.project === "string" ? body.project.trim() : "";
    if (!project) return c.json({ ok: false, error: "Falta «project» en el cuerpo." });
    try {
      const { prep, cached } = await ensurePrep(project, { force: body.force === true });
      return c.json({ ok: true, prep, cached });
    } catch (err) {
      return c.json(fail(err));
    }
  });
}
