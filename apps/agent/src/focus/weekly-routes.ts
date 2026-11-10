import type { Hono } from "hono";
import { focusWeekly, focusWeeklyLine, isFocusWeeklyDate } from "@hermes/shared";
import { todayBogota } from "../dates.js";
import { fileFocusStore } from "./store.js";

/**
 * Resumen semanal de foco (`GET /focus/weekly?week=AAAA-MM-DD`; sin `week`, la
 * semana de hoy). Lee lo que el teléfono subió por día (`PUT /focus/usage/:fecha`,
 * en index.ts) y lo resume con la lógica pura de `@hermes/shared/focus-weekly`.
 * Especificación: openspec/changes/v6-nucleo/specs/telefono-foco. Siempre 200:
 * `{ ok: true, …resumen, line }` o `{ ok: false, error }`.
 */
export function mountFocusWeeklyRoutes(app: Hono): void {
  const store = fileFocusStore();
  app.get("/focus/weekly", async (c) => {
    const today = todayBogota();
    const week = c.req.query("week")?.trim() || today;
    if (!isFocusWeeklyDate(week)) return c.json({ ok: false, error: "semana inválida: usa una fecha AAAA-MM-DD de esa semana" });
    try {
      const data = await store.load();
      const w = focusWeekly(data.usage, week, today);
      return c.json({ ok: true, ...w, line: focusWeeklyLine(w) });
    } catch (e) {
      return c.json({ ok: false, error: `no pude leer el uso guardado: ${(e as Error).message}` });
    }
  });
}
