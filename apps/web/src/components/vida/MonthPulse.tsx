"use client";

// Ritmo del mes (patrón Quicken/Rocket Money): barras de gasto POR DÍA del
// mes en curso + línea de promedio, y stats derivadas de datos reales —
// promedio diario, proyección a fin de mes, delta vs mes anterior y el mayor
// gasto. Complementa los donuts del hero (composición) con la dimensión que
// faltaba: EL TIEMPO (¿en qué días se me fue la plata? ¿voy más rápido que
// el mes pasado?).

import { useMemo, useState } from "react";
import type { Currency, FinanceSummary, FxRate, Transaction } from "@hermes/shared";
import { PanelState } from "@/components/ui/PanelState";
import { StatBlock } from "@/components/ui/StatBlock";
import { categoryLabel } from "./categories";
import { money } from "./FinanceSummary";

const DAYS_SHORT = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const MONTHS_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** Hoy en Bogotá como YYYY-MM-DD (en-CA formatea ISO). */
function todayBogota(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
}

export function MonthPulse({
  transactions,
  summary,
  prevSummary,
  currency,
  fx,
}: {
  transactions: Transaction[];
  summary: FinanceSummary | null;
  /** Resumen del mes anterior (mismo combined) para el delta de ritmo. */
  prevSummary: FinanceSummary | null;
  currency: Currency;
  fx: FxRate | null;
}) {
  const [hoverDay, setHoverDay] = useState<number | null>(null);

  const data = useMemo(() => {
    if (!summary) return null;
    const [year, month] = summary.month.split("-").map(Number);
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const today = todayBogota();
    const isCurrentMonth = today.startsWith(summary.month);
    const dayToday = isCurrentMonth ? Number(today.slice(8, 10)) : daysInMonth;

    // TRM para combinar ambas monedas en la del toggle (la misma del hero).
    const rate = summary.fx?.usd_cop ?? fx?.usd_cop ?? null;
    const toSelected = (amount: number, cur: Currency): number => {
      if (cur === currency) return amount;
      if (!rate) return 0; // sin TRM no se inventa conversión
      return currency === "COP" ? amount * rate : amount / rate;
    };

    const perDay = Array.from({ length: daysInMonth }, () => 0);
    let largest: Transaction | null = null;
    let largestValue = 0;
    for (const t of transactions) {
      if (t.kind !== "expense" || !t.occurred_on.startsWith(summary.month)) continue;
      const v = toSelected(t.amount, t.currency);
      perDay[Number(t.occurred_on.slice(8, 10)) - 1] += v;
      if (v > largestValue) {
        largestValue = v;
        largest = t;
      }
    }

    const spentSoFar = perDay.slice(0, dayToday).reduce((a, b) => a + b, 0);
    const avgDaily = dayToday > 0 ? spentSoFar / dayToday : 0;
    const projection = avgDaily * daysInMonth;
    const max = Math.max(...perDay);

    // Delta de gasto vs mes anterior (mismo resumen combined del agente).
    const prevExpense = prevSummary?.expense ?? 0;
    const delta = prevExpense > 0 ? (summary.expense - prevExpense) / prevExpense : null;

    return {
      year,
      month,
      daysInMonth,
      dayToday,
      isCurrentMonth,
      perDay,
      max,
      avgDaily,
      projection,
      delta,
      prevExpense,
      largest,
    };
  }, [summary, prevSummary, transactions, currency, fx]);

  if (!data || !summary) {
    return <PanelState kind="offline" compact title="Sin datos" hint="¿Está el agente en línea?" />;
  }
  if (data.max <= 0) {
    return <PanelState kind="empty" compact title="Sin gastos este mes todavía" />;
  }

  const CHART_H = 72;
  const avgY = data.max > 0 ? (data.avgDaily / data.max) * CHART_H : 0;
  const fmtDay = (d: number) => {
    const dow = new Date(Date.UTC(data.year, data.month - 1, d, 12)).getUTCDay();
    return `${DAYS_SHORT[dow]} ${String(d).padStart(2, "0")} ${MONTHS_SHORT[data.month - 1]}`;
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Barras por día, con la línea punteada del promedio diario */}
      <div>
        <div className="relative" style={{ height: CHART_H }}>
          {data.avgDaily > 0 && (
            <div
              aria-hidden
              title={`Promedio diario: ${money(Math.round(data.avgDaily), currency)}`}
              className="absolute right-0 left-0 border-t border-dashed border-line-2"
              style={{ bottom: avgY }}
            />
          )}
          <div className="flex h-full items-end gap-px">
            {data.perDay.map((v, i) => {
              const day = i + 1;
              const future = data.isCurrentMonth && day > data.dayToday;
              const isToday = data.isCurrentMonth && day === data.dayToday;
              const h = data.max > 0 ? Math.round((v / data.max) * CHART_H) : 0;
              return (
                <div
                  key={day}
                  onMouseEnter={() => setHoverDay(day)}
                  onMouseLeave={() => setHoverDay(null)}
                  title={future ? undefined : `${fmtDay(day)} · ${money(Math.round(v), currency)}`}
                  className="relative flex h-full flex-1 items-end"
                >
                  <div
                    className={`w-full rounded-t-xs transition-opacity ${
                      future ? "bg-line" : isToday ? "bg-cyan" : "bg-violet"
                    }`}
                    style={{
                      height: Math.max(h, v > 0 ? 2 : 1),
                      opacity: future ? 0.5 : hoverDay === day ? 1 : isToday ? 0.95 : 0.7,
                    }}
                  />
                </div>
              );
            })}
          </div>
        </div>
        {/* Eje: día 1 · hoy · fin de mes; hover pisa el centro con el día activo */}
        <div className="mt-1 flex justify-between text-2xs text-text-faint tabular-nums">
          <span>01</span>
          <span className={hoverDay ? "text-text-dim" : ""}>
            {hoverDay
              ? `${fmtDay(hoverDay)} · ${money(Math.round(data.perDay[hoverDay - 1] ?? 0), currency)}`
              : data.isCurrentMonth
                ? `hoy ${String(data.dayToday).padStart(2, "0")}`
                : ""}
          </span>
          <span>{String(data.daysInMonth).padStart(2, "0")}</span>
        </div>
      </div>

      {/* Stats del ritmo — todas derivadas de movimientos reales */}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <StatBlock
          label="Promedio diario"
          value={money(Math.round(data.avgDaily), currency)}
        />
        {data.isCurrentMonth && (
          <StatBlock
            label="Proyección del mes"
            value={money(Math.round(data.projection), currency)}
            tone={
              data.prevExpense > 0 && data.projection > data.prevExpense ? "amber" : "neutral"
            }
          />
        )}
        {data.delta != null && (
          <StatBlock
            label="Gasto vs mes pasado"
            value={`${data.delta > 0 ? "+" : ""}${Math.round(data.delta * 100)}%`}
            tone={data.delta > 0.05 ? "red" : data.delta < -0.05 ? "green" : "neutral"}
            trend={{ dir: data.delta > 0.05 ? "up" : data.delta < -0.05 ? "down" : "flat" }}
          />
        )}
        {data.largest && (
          <StatBlock
            label="Mayor gasto"
            value={money(data.largest.amount, data.largest.currency)}
            unit={data.largest.note?.slice(0, 24) || categoryLabel(data.largest.category)}
            tone="neutral"
          />
        )}
      </div>
    </div>
  );
}
