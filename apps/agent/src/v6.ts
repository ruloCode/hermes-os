/**
 * Puntos de montaje de v6 «Núcleo» (openspec/changes/v6-nucleo).
 *
 * index.ts llama a estas dos funciones y nada más: cada paquete llena SU archivo
 * de rutas y de jobs, así varias personas (o agentes) trabajan a la vez sin
 * tocar las 4.000 líneas de index.ts.
 */
import type { Hono } from "hono";
import { mountEnglishReviewRoutes } from "./english/review-routes.js";
import { mountFinanceTodayRoutes } from "./finance/today-routes.js";
import { mountFocusWeeklyRoutes } from "./focus/weekly-routes.js";
import { mountMeetingPrepRoutes } from "./meetings/prep-routes.js";
import { registerMemoriaJobs } from "./memoria/jobs.js";
import { mountMemoriaRoutes } from "./memoria/routes.js";
import { mountUsageRoutes } from "./usage-routes.js";

export function mountV6Routes(app: Hono): void {
  mountUsageRoutes(app);
  mountMemoriaRoutes(app);
  mountMeetingPrepRoutes(app);
  mountEnglishReviewRoutes(app);
  mountFinanceTodayRoutes(app);
  mountFocusWeeklyRoutes(app);
}

/** Se llama junto a los demás registerJob: con HERMES_JOBS=off no corre nada. */
export function registerV6Jobs(): void {
  registerMemoriaJobs();
}
