import type { Hono } from "hono";
import { financeInsights, financeToday } from "./today.js";

/**
 * Rutas de finanzas de hoy (`/finance/today`, `/finance/insights`).
 * Especificación y contrato JSON: openspec/changes/v6-nucleo/specs/finanzas
 * («Notas de implementación»). Siempre 200: `{ ok: true, … }` o
 * `{ ok: false, error }`, para que la interfaz diga el motivo.
 */
export function mountFinanceTodayRoutes(app: Hono): void {
  app.get("/finance/today", async (c) => c.json(await financeToday()));
  app.get("/finance/insights", async (c) => c.json(await financeInsights()));
}
