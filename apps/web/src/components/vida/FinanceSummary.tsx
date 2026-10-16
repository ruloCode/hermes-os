"use client";

// Cabecera del mes en Finanzas: la fila de cifras + de qué se compone.
//
// v5 (2026-10): esto eran dos donuts de 232px alrededor de un neto con un
// gauge de ahorro. Con los datos reales de un mes normal se veía así:
// "otros ingresos 100%" en un anillo lleno, "otros 100%" en otro anillo lleno
// y un gauge con un "% de ahorro" negativo de cuatro cifras. Un anillo de UNA categoría no compara
// nada, y un porcentaje de ahorro de cuatro cifras no es una cifra: es un
// síntoma. Ahora:
//  - Cuatro cifras sin caja (Ingresos · Gastado · Neto · Ahorro), cada una con
//    una línea de contexto REAL (contra el mes anterior, cuántos movimientos).
//  - El color dice algo o no aparece: el neto lleva su signo (+ verde / −
//    rojo); ingresos y gastos son totales y van en el gris del texto.
//  - El ahorro se dice en palabras cuando el número deja de significar algo:
//    si gastaste más de lo que entró no hay "−1900 %", hay "Sin ahorro" y la
//    proporción real ("gastaste 20× lo que entró").
//  - El desglose por categoría solo se DIBUJA con dos o más categorías; con
//    una se dice en una frase.

import { useMemo } from "react";
import type { Currency, FinanceSummary as Summary } from "@hermes/shared";
import { PanelState } from "@/components/ui/PanelState";
import { Segmented } from "@/components/ui/Segmented";
import type { DonutSlice } from "@/components/ui/DonutChart";
import { CHART_OTHER, CHART_SLOTS, chartVar } from "@/components/ui/tones";
import { CategoryIcon, categoryLabel } from "./categories";
import { Stat, StatStrip } from "./kit";

/** Formato colombiano: $2.450.000 / US$120. */
export function money(amount: number, currency: Currency): string {
  const s = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 }).format(amount);
  return currency === "USD" ? `US$${s}` : `$${s}`;
}

/** Monto con signo tipográfico (−, no guion): "+$12.000" / "−$48.500". */
export function signedMoney(amount: number, currency: Currency): string {
  return `${amount < 0 ? "−" : "+"}${money(Math.abs(amount), currency)}`;
}

const MONTHS_LONG = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/** "2026-10" → "octubre de 2026". */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return MONTHS_LONG[m - 1] ? `${MONTHS_LONG[m - 1]} de ${y}` : month;
}

/** Nombre del mes de un resumen ("2026-09" → "septiembre"). */
function monthName(month: string): string {
  return MONTHS_LONG[Number(month.split("-")[1]) - 1] ?? "el mes pasado";
}

/** Conmutador COP/USD — vive en las acciones de la cabecera de la vista. */
export function CurrencyToggle({
  currency,
  onCurrency,
}: {
  currency: Currency;
  onCurrency: (c: Currency) => void;
}) {
  return (
    <Segmented
      ariaLabel="Moneda"
      value={currency}
      onChange={onCurrency}
      options={[
        { value: "COP", label: "COP", title: "Pesos (los dólares se convierten a la TRM)" },
        { value: "USD", label: "USD", title: "Dólares (los pesos se convierten a la TRM)" },
      ]}
    />
  );
}

/** Rebanada de finanzas: DonutSlice + su cruce con presupuesto (gastos). */
interface FinanceSlice extends DonutSlice {
  budget?: number | null;
  budgetPct?: number | null;
  count: number;
}

export interface VidaSlices {
  expense: FinanceSlice[];
  income: FinanceSlice[];
  /** color por categoría para pintar consistente fuera del desglose. */
  colorFor: (category: string) => string | undefined;
}

/** Top-5 por valor con paleta chart-1..5; la cola se pliega en "otras" gris. */
function fold(
  items: { category: string; value: number; count: number; budget?: number | null; pct?: number | null }[],
  colors: Map<string, string>,
): FinanceSlice[] {
  const sorted = items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  const head = sorted.slice(0, CHART_SLOTS);
  const tail = sorted.slice(CHART_SLOTS);

  const slices: FinanceSlice[] = head.map((i, idx) => {
    const color = chartVar(idx);
    colors.set(i.category, color);
    return {
      key: i.category,
      label: categoryLabel(i.category),
      value: i.value,
      color,
      icon: <CategoryIcon category={i.category} />,
      count: i.count,
      budget: i.budget ?? null,
      budgetPct: i.pct ?? null,
    };
  });

  if (tail.length > 0) {
    for (const i of tail) colors.set(i.category, CHART_OTHER);
    slices.push({
      key: "__resto",
      label: `otras (${tail.length})`,
      value: tail.reduce((a, i) => a + i.value, 0),
      color: CHART_OTHER,
      icon: <CategoryIcon category="otros" />,
      count: tail.reduce((a, i) => a + i.count, 0),
    });
  }
  return slices;
}

/** Rebanadas de gastos e ingresos + mapa de color por categoría. */
export function buildVidaSlices(summary: Summary | null): VidaSlices {
  const colors = new Map<string, string>();
  if (!summary) return { expense: [], income: [], colorFor: () => undefined };

  const expense = fold(
    summary.by_category.map((c) => ({
      category: c.category,
      value: c.spent,
      count: c.count,
      budget: c.budget,
      pct: c.pct,
    })),
    colors,
  );

  // `?? []`: un agente sin redeploy aún no manda income_by_category.
  let incomeItems = (summary.income_by_category ?? []).map((c) => ({
    category: c.category,
    value: c.amount,
    count: c.count,
  }));
  if (incomeItems.length === 0 && summary.income > 0) {
    incomeItems = [{ category: "otros_ingreso", value: summary.income, count: 0 }];
  }
  const income = fold(incomeItems, colors);

  return { expense, income, colorFor: (c) => colors.get(c) };
}

/**
 * Contexto de una cifra contra el mes anterior. Un % sobre una base chica se
 * dispara (de $10.000 a $2.000.000 es "+19.900 %"), y ese número no informa:
 * pasado el ±300 % se dice el monto del mes anterior en vez del porcentaje.
 */
function versus(
  current: number,
  prev: Summary | null | undefined,
  pick: (s: Summary) => number,
  noun: string,
  currency: Currency,
): string | undefined {
  if (!prev) return undefined;
  const prevName = monthName(prev.month);
  const base = pick(prev);
  if (prev.tx_count === 0) return `sin movimientos en ${prevName}`;
  if (base <= 0) return `sin ${noun} en ${prevName}`;
  const delta = (current - base) / base;
  if (Math.abs(delta) > 3) return `${money(base, currency)} en ${prevName}`;
  const pct = Math.round(delta * 100);
  if (pct === 0) return `igual que en ${prevName}`;
  return `${pct > 0 ? "↑" : "↓"} ${Math.abs(pct)} % vs. ${prevName}`;
}

/** "12.5" → "12,5" (decimal colombiano), sin decimales a partir de 10×… salvo uno. */
function ratioLabel(r: number): string {
  return new Intl.NumberFormat("es-CO", { maximumFractionDigits: 1 }).format(r);
}

/** Celda de ahorro: número cuando significa algo, frase cuando no. */
function SavingsStat({ income, expense }: { income: number; expense: number }) {
  const net = income - expense;
  const savings = net / income;
  if (savings >= 0) {
    const pct = Math.round(savings * 100);
    return (
      <Stat
        label="Ahorro"
        value={`${pct} %`}
        tone={pct >= 20 ? "green" : "text"}
        context="de lo que entró quedó libre"
      />
    );
  }
  // Gastaste más de lo que entró: el % negativo (−1900 %) no se lee. Se dice
  // la proporción real. Sin rojo: el neto de al lado ya lo dice en rojo, y dos
  // alarmas para el mismo hecho son ruido.
  const ratio = expense / income;
  return (
    <Stat
      label="Ahorro"
      value="Sin ahorro"
      context={
        ratio >= 2
          ? `gastaste ${ratioLabel(ratio)}× lo que entró`
          : `gastaste ${Math.round((ratio - 1) * 100)} % más de lo que entró`
      }
    />
  );
}

/** Desglose de un lado (gasto o ingreso): barra apilada + filas. ≥2 categorías. */
function Breakdown({
  title,
  slices,
  total,
  currency,
}: {
  title: string;
  slices: FinanceSlice[];
  total: number;
  currency: Currency;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-text-dim">{title}</span>
        <span className="text-xs text-text-faint tabular-nums">{money(total, currency)}</span>
      </div>
      {/* Barra apilada: la composición en una línea (el donut sin el anillo). */}
      <div className="flex h-2 gap-0.5 overflow-hidden rounded-full" aria-hidden>
        {slices.map((s) => (
          <span
            key={s.key}
            className="h-full first:rounded-l-full last:rounded-r-full"
            style={{ width: `${(s.value / total) * 100}%`, background: s.color }}
          />
        ))}
      </div>
      <ul className="flex flex-col">
        {slices.map((s) => {
          const share = total > 0 ? Math.round((s.value / total) * 100) : 0;
          return (
            <li key={s.key} className="flex min-w-0 items-center gap-2.5 py-1">
              <span
                aria-hidden
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: s.color }}
              />
              <span className="shrink-0 text-text-faint">{s.icon}</span>
              <span className="min-w-0 flex-1 truncate text-sm text-text">{s.label}</span>
              {s.count > 0 && (
                <span className="shrink-0 text-xs text-text-faint tabular-nums">
                  {s.count} mov{s.count === 1 ? "" : "s"}
                </span>
              )}
              <span className="w-24 shrink-0 text-right text-sm text-text tabular-nums">
                {money(s.value, currency)}
              </span>
              <span className="w-10 shrink-0 text-right text-xs text-text-faint tabular-nums">
                {share} %
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** "en «otros» (10 movimientos)" — la frase que reemplaza a un anillo lleno. */
function singleLine(slice: FinanceSlice): string {
  const n = slice.count > 0 ? ` (${slice.count} movimiento${slice.count === 1 ? "" : "s"})` : "";
  return `«${slice.label}»${n}`;
}

/**
 * El mes en cifras + su composición. Todo sale del FinanceSummary real del
 * agente (combined: la otra moneda convertida a la TRM).
 */
export function FinanceSummaryPanel({
  summary,
  prevSummary,
  currency,
}: {
  summary: Summary | null;
  /** Mes anterior (mismo combined) para el contexto de cada cifra. */
  prevSummary?: Summary | null;
  currency: Currency;
}) {
  const { expense, income } = useMemo(() => buildVidaSlices(summary), [summary]);

  if (!summary) {
    return <PanelState kind="offline" compact title="Sin datos" hint="¿Está el agente en línea?" />;
  }

  const cur = summary.currency;
  const empty = summary.tx_count === 0;

  // Frases para los lados con UNA sola categoría (no se dibujan).
  const sentences: string[] = [];
  if (expense.length === 1) sentences.push(`Todo el gasto del mes fue en ${singleLine(expense[0])}.`);
  if (income.length === 1) sentences.push(`Todo el ingreso llegó como ${singleLine(income[0])}.`);
  const charts = [
    expense.length >= 2 && (
      <Breakdown
        key="expense"
        title="Gasto por categoría"
        slices={expense}
        total={summary.expense}
        currency={cur}
      />
    ),
    income.length >= 2 && (
      <Breakdown
        key="income"
        title="Ingreso por fuente"
        slices={income}
        total={summary.income}
        currency={cur}
      />
    ),
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-6">
      <StatStrip>
        <Stat
          label="Ingresos"
          value={money(summary.income, cur)}
          context={versus(summary.income, prevSummary, (p) => p.income, "ingresos", cur)}
        />
        <Stat
          label="Gastado"
          value={money(summary.expense, cur)}
          context={versus(summary.expense, prevSummary, (p) => p.expense, "gastos", cur)}
        />
        <Stat
          label="Neto del mes"
          value={signedMoney(summary.net, cur)}
          tone={summary.net > 0 ? "green" : summary.net < 0 ? "red" : "text"}
          context={`${summary.tx_count} movimiento${summary.tx_count === 1 ? "" : "s"}`}
        />
        {summary.income > 0 ? (
          <SavingsStat income={summary.income} expense={summary.expense} />
        ) : (
          // Sin ingresos el ahorro no está definido: se dice, no se inventa.
          <Stat label="Ahorro" value="—" context="sin ingresos este mes" />
        )}
      </StatStrip>

      {empty && (
        <p className="text-sm text-text-dim">
          Sin movimientos este mes en {currency}. Díselo a Hermes: “gasté 20 mil en un almuerzo”.
        </p>
      )}

      {charts.length > 0 && (
        <div className="@container">
          <div className="grid gap-x-10 gap-y-6 @2xl:grid-cols-2">{charts}</div>
        </div>
      )}

      {(sentences.length > 0 || summary.fx || summary.budgets_at_risk.length > 0) && (
        <div className="flex flex-col gap-1.5 text-xs text-text-dim">
          {sentences.length > 0 && <p>{sentences.join(" ")}</p>}
          {summary.budgets_at_risk.length > 0 && (
            <p className="flex items-center gap-2">
              <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber" />
              <span>
                Presupuestos en riesgo:{" "}
                {summary.budgets_at_risk
                  .map(
                    (c) =>
                      `${categoryLabel(c.category)} ${c.pct != null ? `${Math.round(c.pct * 100)} %` : ""}`,
                  )
                  .join(" · ")}
              </span>
            </p>
          )}
          {summary.fx && (
            <p className="text-text-faint" title={`Tasa del ${summary.fx.as_of}`}>
              Incluye {summary.fx.converted_count} movimiento
              {summary.fx.converted_count === 1 ? "" : "s"} en {cur === "COP" ? "USD" : "COP"}{" "}
              convertido{summary.fx.converted_count === 1 ? "" : "s"} a la TRM de{" "}
              <span className="tabular-nums">{money(Math.round(summary.fx.usd_cop), "COP")}</span>.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
