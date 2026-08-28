"use client";

import { useMemo, useState } from "react";
import type { Currency, FinanceSummary as Summary } from "@hermes/shared";
import { BarMeter } from "@/components/ui/BarMeter";
import { DonutChart, type DonutSlice } from "@/components/ui/DonutChart";
import { PanelState } from "@/components/ui/PanelState";
import { RadialGauge } from "@/components/ui/RadialGauge";
import { StatBlock } from "@/components/ui/StatBlock";
import { CHART_OTHER, CHART_SLOTS, chartVar } from "@/components/ui/tones";
import { CategoryIcon, categoryLabel } from "./categories";

/** Formato colombiano: $2.450.000 / US$120. */
export function money(amount: number, currency: Currency): string {
  const s = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 }).format(amount);
  return currency === "USD" ? `US$${s}` : `$${s}`;
}

/** Conmutador COP/USD — vive en el header del panel (right del Panel). */
export function CurrencyToggle({
  currency,
  onCurrency,
}: {
  currency: Currency;
  onCurrency: (c: Currency) => void;
}) {
  return (
    <div className="flex shrink-0 gap-1">
      {(["COP", "USD"] as const).map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onCurrency(c)}
          className={`rounded-sm border px-2 py-0.5 text-2xs tracking-label transition-colors ${
            c === currency
              ? "border-violet text-violet"
              : "border-line text-text-dim hover:border-line-2 hover:text-text"
          }`}
        >
          {c}
        </button>
      ))}
    </div>
  );
}

/** Rebanada de finanzas: DonutSlice + su cruce con presupuesto (gastos). */
interface FinanceSlice extends DonutSlice {
  budget?: number | null;
  budgetPct?: number | null;
}

export interface VidaSlices {
  expense: FinanceSlice[];
  income: FinanceSlice[];
  /** color por categoría para pintar consistente fuera del donut (movimientos). */
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
      sub: `${i.count} mov${i.count === 1 ? "" : "s"}`,
      budget: i.budget ?? null,
      budgetPct: i.pct ?? null,
    };
  });

  if (tail.length > 0) {
    for (const i of tail) colors.set(i.category, CHART_OTHER);
    const value = tail.reduce((a, i) => a + i.value, 0);
    const count = tail.reduce((a, i) => a + i.count, 0);
    slices.push({
      key: "__resto",
      label: `otras (${tail.length})`,
      value,
      color: CHART_OTHER,
      icon: <CategoryIcon category="otros" />,
      sub: `${count} movs`,
    });
  }
  return slices;
}

/** Rebanadas de ambos donuts + mapa de color por categoría (identidad única). */
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

/** Fila de leyenda: icono teñido + label + barra de presupuesto + monto + %. */
function LegendRow({
  slice,
  total,
  currency,
  hovered,
  onHover,
}: {
  slice: FinanceSlice;
  total: number;
  currency: Currency;
  hovered: string | null;
  onHover: (k: string | null) => void;
}) {
  const share = total > 0 ? Math.round((slice.value / total) * 100) : 0;
  // Un solo %: consumo del presupuesto si existe (estado), si no el share.
  const budgetPct = slice.budgetPct != null ? Math.round(slice.budgetPct * 100) : null;
  const pctClass =
    budgetPct == null
      ? "text-text-faint"
      : budgetPct >= 100
        ? "text-red"
        : budgetPct >= 80
          ? "text-amber"
          : "text-text-dim";

  return (
    <div
      onMouseEnter={() => onHover(slice.key)}
      onMouseLeave={() => onHover(null)}
      className={`flex items-center gap-2 rounded-sm px-1.5 py-1 transition-colors ${
        hovered === slice.key ? "bg-panel-2" : ""
      }`}
    >
      <span className="shrink-0" style={{ color: slice.color }}>
        {slice.icon}
      </span>
      <span className="min-w-0 flex-1 truncate text-2xs text-text">{slice.label}</span>
      {slice.budget != null && (
        <span className="w-14 shrink-0">
          <BarMeter
            value={slice.value}
            max={slice.budget}
            segments={0}
            height={4}
            tone="violet"
            thresholds={{ warn: 80, danger: 100 }}
            showValue={false}
          />
        </span>
      )}
      <span className="shrink-0 font-display text-2xs tabular-nums text-text-dim">
        {money(slice.value, currency)}
      </span>
      <span className={`w-8 shrink-0 text-right text-2xs tabular-nums ${pctClass}`}>
        {budgetPct ?? share}%
      </span>
    </div>
  );
}

/** Donut + leyenda de un lado del hero (ingresos o gastos). */
function DonutBlock({
  slices,
  centerLabel,
  total,
  tone,
  currency,
  emptyHint,
}: {
  slices: FinanceSlice[];
  centerLabel: string;
  total: number;
  tone: "green" | "red";
  currency: Currency;
  emptyHint: string;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const fmt = (v: number) => money(v, currency);

  return (
    <div className="flex min-w-0 flex-col items-center gap-1">
      <DonutChart
        slices={slices}
        size={232}
        thickness={18}
        centerLabel={centerLabel}
        centerValue={fmt(total)}
        centerTone={tone}
        format={fmt}
        hoveredKey={hovered}
        onHoverKey={setHovered}
        ariaLabel={`${centerLabel} del mes: ${fmt(total)}`}
        emptyHint={emptyHint}
      />
      {slices.length > 0 && (
        <div className="flex w-full max-w-72 flex-col">
          {slices.map((s) => (
            <LegendRow
              key={s.key}
              slice={s}
              total={total}
              currency={currency}
              hovered={hovered}
              onHover={setHovered}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Hero de finanzas del mes: donut de ingresos y donut de gastos por categoría
 * (callouts con icono, leyenda con presupuesto) alrededor del NETO con su
 * tasa de ahorro. Todo sale del FinanceSummary real del agente.
 */
export function FinanceSummaryPanel({
  summary,
  currency,
}: {
  summary: Summary | null;
  currency: Currency;
}) {
  const { expense, income } = useMemo(() => buildVidaSlices(summary), [summary]);

  if (!summary) {
    return <PanelState kind="offline" compact title="Sin datos" hint="¿Está el agente en línea?" />;
  }

  // Tasa de ahorro (neto/ingresos) solo cuando hay ingresos que la definan.
  const savings = summary.income > 0 ? summary.net / summary.income : null;
  const savingsTone = savings == null ? "neutral" : savings >= 0.2 ? "green" : savings > 0 ? "amber" : "red";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-evenly gap-x-6 gap-y-4">
        <DonutBlock
          slices={income}
          centerLabel="Ingresos"
          total={summary.income}
          tone="green"
          currency={currency}
          emptyHint="Sin ingresos"
        />

        {/* NETO: la cifra que resume el mes + qué tanto se ahorra */}
        <div className="flex flex-col items-center gap-3 self-center py-2">
          <StatBlock
            label="Neto del mes"
            value={money(summary.net, summary.currency)}
            size="lg"
            tone={summary.net >= 0 ? "green" : "red"}
          />
          {savings != null && (
            <RadialGauge
              value={Math.max(savings, 0) * 100}
              size={84}
              stroke={8}
              tone={savingsTone === "neutral" ? "violet" : savingsTone}
              label="ahorro"
              format={() => `${Math.round(savings * 100)}%`}
            />
          )}
          <span className="text-2xs text-text-dim tabular-nums">
            {summary.tx_count} movs · {summary.month}
          </span>
          {summary.fx && (
            <span
              className="text-2xs text-text-faint tabular-nums"
              title={`Tasa del ${summary.fx.as_of}`}
            >
              TRM US$1 = {money(Math.round(summary.fx.usd_cop), "COP")} ·{" "}
              {summary.fx.converted_count} mov{summary.fx.converted_count === 1 ? "" : "s"}{" "}
              {summary.currency === "COP" ? "USD" : "COP"} convertido
              {summary.fx.converted_count === 1 ? "" : "s"}
            </span>
          )}
        </div>

        <DonutBlock
          slices={expense}
          centerLabel="Gastado"
          total={summary.expense}
          tone="red"
          currency={currency}
          emptyHint="Sin gastos"
        />
      </div>

      {summary.by_category.length === 0 && summary.income_by_category?.length === 0 && (
        <p className="text-center text-2xs text-text-dim">
          Sin movimientos este mes en {currency}. Díselo a Hermes: “gasté 20 mil en un almuerzo”.
        </p>
      )}

      {summary.budgets_at_risk.length > 0 && (
        <p className="text-2xs text-amber">
          ⚠ En riesgo:{" "}
          {summary.budgets_at_risk
            .map((c) => `${categoryLabel(c.category)} ${c.pct != null ? Math.round(c.pct * 100) : "?"}%`)
            .join(" · ")}
        </p>
      )}
    </div>
  );
}
