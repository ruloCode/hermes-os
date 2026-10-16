"use client";

// Ritmo del mes (patrón Quicken/Rocket Money): barras de gasto POR DÍA del
// mes en curso + línea de promedio, y stats derivadas de datos reales —
// promedio diario, proyección a fin de mes contra el mes anterior y el mayor
// gasto. Complementa la composición de la cabecera con la dimensión que
// faltaba: EL TIEMPO (¿en qué días se me fue la plata? ¿voy más rápido que
// el mes pasado?).
//
// v5: las barras dejan de ir en el color del acento (el acento es para lo que
// se toca, y aquí cada día pintado en índigo competía con el botón primario):
// son grises y "hoy" sube a tinta plena. El "gasto vs mes pasado" se fue a la
// cifra de Gastado de la cabecera — dos veces el mismo número es ruido.

import { useMemo, useState } from "react";
import type { Currency, FinanceSummary, FxRate, Transaction } from "@hermes/shared";
import { PanelState } from "@/components/ui/PanelState";
import { categoryLabel } from "./categories";
import { money } from "./FinanceSummary";
import { Stat } from "./kit";

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

    // Gasto total del mes anterior (mismo resumen combined del agente).
    const prevExpense = prevSummary?.expense ?? 0;

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
    <div className="flex flex-col gap-5">
      {/* Barras por día, con la línea punteada del promedio diario */}
      <div>
        <div className="relative" style={{ height: CHART_H }}>
          {data.avgDaily > 0 && (
            <div
              aria-hidden
              title={`Promedio diario: ${money(Math.round(data.avgDaily), currency)}`}
              className="absolute right-0 left-0 border-t border-dashed border-text-faint/50"
              style={{ bottom: avgY }}
            />
          )}
          <div className="flex h-full items-end gap-[3px]">
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
                    className={`w-full rounded-t-[3px] transition-colors ${
                      future
                        ? "bg-line"
                        : isToday || hoverDay === day
                          ? "bg-text"
                          : v > 0
                            ? "bg-text-faint/70"
                            : "bg-line-2"
                    }`}
                    style={{ height: Math.max(h, v > 0 ? 2 : 1) }}
                  />
                </div>
              );
            })}
          </div>
        </div>
        {/* Eje: día 1 · hoy · fin de mes; hover pisa el centro con el día activo */}
        <div className="mt-1.5 flex justify-between text-xs text-text-faint tabular-nums">
          <span>01</span>
          <span className={hoverDay ? "text-text" : ""}>
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
      <div className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-3">
        <Stat
          size="md"
          label="Promedio diario"
          value={money(Math.round(data.avgDaily), currency)}
          context={`${data.dayToday} día${data.dayToday === 1 ? "" : "s"} contados`}
        />
        {data.isCurrentMonth && (
          <Stat
            size="md"
            label="Proyección del mes"
            value={money(Math.round(data.projection), currency)}
            // Ámbar = atención: a este ritmo se gasta más que el mes pasado.
            tone={data.prevExpense > 0 && data.projection > data.prevExpense ? "amber" : "text"}
            context={
              data.prevExpense > 0
                ? `${money(Math.round(data.prevExpense), currency)} el mes pasado`
                : "al ritmo actual"
            }
          />
        )}
        {data.largest && (
          <Stat
            size="md"
            label="Mayor gasto"
            value={money(data.largest.amount, data.largest.currency)}
            context={data.largest.note || categoryLabel(data.largest.category)}
          />
        )}
      </div>
    </div>
  );
}
