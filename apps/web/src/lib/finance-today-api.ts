// Cliente de /finance/today y /finance/insights (v6 «finanzas de hoy»). Solo
// lectura. Las rutas responden `{ ok, … | error }` con 200, así que hay TRES
// resultados y la vista los distingue: dato, motivo dicho por el agente y
// agente que no contesta (null).

import type { AntExpense, AvailableToday, CategoryDrift, RecurringCharge, TodayMissing } from "@hermes/shared";
import { hermesFetch } from "./hermes";

export type FinanceTodayData =
  | { ok: true; today: AvailableToday | null; reason?: string; missing?: TodayMissing }
  | { ok: false; error: string };

export type FinanceInsightsData =
  | { ok: true; recurring: RecurringCharge[]; ant: AntExpense[]; drift: CategoryDrift[]; asOf: string }
  | { ok: false; error: string };

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await hermesFetch(path);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export const getFinanceToday = () => getJson<FinanceTodayData>("/finance/today");
export const getFinanceInsights = () => getJson<FinanceInsightsData>("/finance/insights");
