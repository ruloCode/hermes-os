/**
 * Asesor financiero: agrega el mes en TS (volumen personal, sin RPC SQL) y
 * cruza con presupuestos para detectar riesgo — por porcentaje ya gastado o
 * por proyección al ritmo que va el mes. También arma la línea del daily brief.
 */
import type {
  CategorySummary,
  Currency,
  FinanceSummary,
  FxInfo,
  IncomeCategorySummary,
  Transaction,
} from "@hermes/shared";
import { currentMonthBogota, monthProgress } from "../dates.js";
import { getUsdCopRate } from "./fx.js";
import { listBudgets, listTransactions } from "./store.js";
import { balancesToText } from "./wallets.js";

/** Formatea montos al estilo colombiano: $2.450.000 / US$120. */
export function formatAmount(amount: number, currency: Currency): string {
  const s = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 }).format(amount);
  return currency === "USD" ? `US$${s}` : `$${s}`;
}

/**
 * Resumen del mes (default: mes actual Bogotá). Por defecto filtra a UNA
 * moneda; con `combined` trae ambas y convierte la otra a `currency` con la
 * TRM real — el gran total del mes en una sola cifra. Si nunca hubo tasa
 * disponible, degrada al comportamiento de una moneda (fx: null).
 */
export async function getFinanceSummary(
  month?: string,
  currency: Currency = "COP",
  opts: { combined?: boolean } = {},
): Promise<FinanceSummary> {
  const m = month ?? currentMonthBogota();

  let txs: Transaction[];
  let fx: FxInfo | null = null;
  if (opts.combined) {
    const all = await listTransactions({ month: m, limit: 2000 });
    const foreign = all.filter((t) => t.currency !== currency);
    if (foreign.length === 0) {
      txs = all;
    } else {
      const rate = await getUsdCopRate();
      if (rate) {
        txs = all.map((t) =>
          t.currency === currency
            ? t
            : {
                ...t,
                currency,
                amount: currency === "COP" ? t.amount * rate.rate : t.amount / rate.rate,
              },
        );
        fx = { usd_cop: rate.rate, as_of: rate.as_of, converted_count: foreign.length };
      } else {
        txs = all.filter((t) => t.currency === currency);
      }
    }
  } else {
    txs = await listTransactions({ month: m, currency, limit: 2000 });
  }

  const budgets = await listBudgets();
  const limitFor = new Map(
    budgets.filter((b) => b.currency === currency).map((b) => [b.category, b.monthly_limit]),
  );

  let income = 0;
  let expense = 0;
  const byCat = new Map<string, { spent: number; count: number }>();
  const incomeByCat = new Map<string, { amount: number; count: number }>();
  for (const tx of txs) {
    if (tx.kind === "income") {
      income += tx.amount;
      const agg = incomeByCat.get(tx.category) ?? { amount: 0, count: 0 };
      agg.amount += tx.amount;
      agg.count += 1;
      incomeByCat.set(tx.category, agg);
      continue;
    }
    expense += tx.amount;
    const agg = byCat.get(tx.category) ?? { spent: 0, count: 0 };
    agg.spent += tx.amount;
    agg.count += 1;
    byCat.set(tx.category, agg);
  }

  const { daysInMonth, dayOfMonth } = monthProgress(m);
  const by_category: CategorySummary[] = [...byCat.entries()]
    .map(([category, agg]) => {
      const budget = limitFor.get(category) ?? null;
      return {
        category,
        spent: agg.spent,
        budget,
        pct: budget ? agg.spent / budget : null,
        count: agg.count,
      };
    })
    .sort((a, b) => b.spent - a.spent);

  // Riesgo: ya en el 80% del presupuesto, o proyectado a excederlo al ritmo
  // del mes (spent/día * días del mes > límite).
  const budgets_at_risk = by_category.filter((c) => {
    if (c.budget == null || c.pct == null) return false;
    const projected = (c.spent / Math.max(dayOfMonth, 1)) * daysInMonth;
    return c.pct >= 0.8 || projected > c.budget;
  });

  const income_by_category: IncomeCategorySummary[] = [...incomeByCat.entries()]
    .map(([category, agg]) => ({ category, amount: agg.amount, count: agg.count }))
    .sort((a, b) => b.amount - a.amount);

  return {
    month: m,
    currency,
    income,
    expense,
    net: income - expense,
    by_category,
    income_by_category,
    budgets_at_risk,
    tx_count: txs.length,
    fx,
  };
}

const MONTH_NAMES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/** Resumen como texto corto en español, apto para narrar por voz. */
export function summaryToText(s: FinanceSummary): string {
  if (s.tx_count === 0) return `Sin movimientos registrados en ${s.currency} este mes.`;
  const monthName = MONTH_NAMES[Number(s.month.slice(5, 7)) - 1] ?? s.month;
  const lines = [
    `${monthName} (${s.currency}): gastados ${formatAmount(s.expense, s.currency)}` +
      (s.income > 0
        ? `, ingresos ${formatAmount(s.income, s.currency)}, neto ${formatAmount(s.net, s.currency)}`
        : "") +
      ` en ${s.tx_count} movimientos.`,
  ];
  const top = s.by_category.slice(0, 5).map((c) => {
    const pct = c.pct != null ? ` (${Math.round(c.pct * 100)}% del presupuesto)` : "";
    return `${c.category}: ${formatAmount(c.spent, s.currency)}${pct}`;
  });
  if (top.length) lines.push(`Top categorías — ${top.join(" · ")}.`);
  if (s.budgets_at_risk.length) {
    lines.push(
      `Riesgo: ${s.budgets_at_risk
        .map((c) => `${c.category} ${c.pct != null ? Math.round(c.pct * 100) : "?"}%`)
        .join(", ")}.`,
    );
  }
  return lines.join("\n");
}

/** Línea corta para el daily brief; null si no hay datos del mes ni saldo. */
export async function financeBriefLine(): Promise<string | null> {
  const s = await getFinanceSummary();
  const saldo = await balancesToText();
  if (s.tx_count === 0 && !saldo) return null;
  const bits: string[] = [];
  if (saldo) bits.push(saldo);
  if (s.tx_count > 0) {
    const totalBudget = s.by_category.reduce((acc, c) => acc + (c.budget ?? 0), 0);
    let line = `Finanzas: gastados ${formatAmount(s.expense, s.currency)}`;
    if (totalBudget > 0) line += ` de ${formatAmount(totalBudget, s.currency)} presupuestados`;
    line += " este mes.";
    if (s.budgets_at_risk.length) {
      line += ` Riesgo: ${s.budgets_at_risk
        .map((c) => `${c.category} ${c.pct != null ? Math.round(c.pct * 100) : "?"}%`)
        .join(", ")}.`;
    }
    bits.push(line);
  }
  return bits.join(" ");
}
