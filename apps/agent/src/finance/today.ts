/**
 * Finanzas de hoy del lado del agente: junta plan + movimientos + tasa y llama
 * la lógica pura de `@hermes/shared` (finance-today.ts). Es la VERDAD que
 * muestran la web, el teléfono y la tool `get_finance_today`: el teléfono la
 * pinta tal cual, no la recalcula.
 *
 * Solo lectura: no escribe nada.
 */
import {
  antExpenses,
  availableToday,
  categoryDrift,
  recurringCharges,
  type AntExpense,
  type AvailableToday,
  type CategoryDrift,
  type RecurringCharge,
  type TodayFx,
  type TodayMissing,
  type TodayTx,
} from "@hermes/shared";
import { addDays, todayBogota } from "../dates.js";
import { supabase } from "../supabase.js";
import { getUsdCopRate } from "./fx.js";
import { filePlanStore } from "./plan.js";

/** Historia que se lee: 13 meses alcanzan para «dos meses distintos», los tres de la mediana y el total del año. */
const LOOKBACK_DAYS = 400;

async function loadTxs(today: string): Promise<{ txs: TodayTx[]; error: string | null }> {
  if (!supabase) return { txs: [], error: "Supabase no está configurado en este agente." };
  const { data, error } = await supabase
    .from("transactions")
    .select("kind, amount, currency, category, note, occurred_on, voided_at")
    .is("voided_at", null)
    .gte("occurred_on", addDays(today, -LOOKBACK_DAYS))
    .lte("occurred_on", today)
    .order("occurred_on", { ascending: true })
    .limit(10_000);
  if (error) return { txs: [], error: `No se pudieron leer los movimientos: ${error.message}` };
  // numeric de Postgres llega como string.
  return { txs: (data ?? []).map((r) => ({ ...(r as unknown as TodayTx), amount: Number(r.amount) })), error: null };
}

async function loadFx(): Promise<TodayFx | null> {
  const r = await getUsdCopRate();
  return r ? { usdCop: r.rate, asOf: r.as_of } : null;
}

export type FinanceTodayResponse =
  | { ok: true; today: AvailableToday | null; reason?: string; missing?: TodayMissing }
  | { ok: false; error: string };

export async function financeToday(today = todayBogota()): Promise<FinanceTodayResponse> {
  const [plan, { txs, error }, fx] = await Promise.all([filePlanStore().load(), loadTxs(today), loadFx()]);
  if (error) return { ok: false, error };
  const r = availableToday(plan, txs, today, fx);
  return r.ok ? { ok: true, today: r.today } : { ok: true, today: null, reason: r.reason, missing: r.missing };
}

export type FinanceInsightsResponse =
  | { ok: true; recurring: RecurringCharge[]; ant: AntExpense[]; drift: CategoryDrift[]; asOf: string }
  | { ok: false; error: string };

export async function financeInsights(today = todayBogota()): Promise<FinanceInsightsResponse> {
  const { txs, error } = await loadTxs(today);
  if (error) return { ok: false, error };
  return {
    ok: true,
    recurring: recurringCharges(txs, today),
    ant: antExpenses(txs, today.slice(0, 7), today),
    drift: categoryDrift(txs, today),
    asOf: today,
  };
}
