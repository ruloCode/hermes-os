"use client";

// «Hoy puedes gastar» + lo que nadie mira (v6, openspec/changes/v6-nucleo/specs/finanzas).
//
// Lo calcula el AGENTE (/finance/today, /finance/insights) con un método que
// cabe en una frase; aquí solo se pinta y se deja la frase a un clic. La misma
// respuesta la pinta Hermes Phone: nada se recalcula en el navegador.
//
// Jerarquía (docs/ui-v5-grafito.md): esto es la cabecera del DÍA, igual que el
// resumen es la cabecera del mes — va sin caja. El número grande es el único
// 40px de la vista. Las tres listas (repetidos · hormiga · desvíos) son
// lectura corta: sin caja, y cada una aparece SOLO si trae algo; si ninguna
// trae nada, la sección entera no existe.

import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { AntExpense, CategoryDrift, Currency, RecurringCharge } from "@hermes/shared";
import { Button } from "@/components/ui/Button";
import {
  getFinanceInsights,
  getFinanceToday,
  type FinanceInsightsData,
  type FinanceTodayData,
} from "@/lib/finance-today-api";
import { categoryLabel } from "./categories";
import { money, signedMoney } from "./FinanceSummary";
import { Stat } from "./kit";

const MONTHS_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** "2026-11-03" → "3 nov". */
function shortDate(d: string): string {
  return `${Number(d.slice(8, 10))} ${MONTHS_SHORT[Number(d.slice(5, 7)) - 1] ?? ""}`;
}

/** "2026-08" → "ago". */
function shortMonth(m: string): string {
  return MONTHS_SHORT[Number(m.slice(5, 7)) - 1] ?? m;
}

/** Montos con centavos cuando es USD (el disponible en dólares no se redondea a favor). */
function amount(n: number, c: Currency): string {
  if (c !== "USD") return money(n, c);
  return `US$${new Intl.NumberFormat("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`;
}

/**
 * Datos del día con poll propio (30 s) y refresco cuando cambian los
 * movimientos (`refreshKey`): registrar un gasto mueve el número al instante.
 */
function useFinanceToday(refreshKey: string) {
  const [today, setToday] = useState<FinanceTodayData | null | undefined>(undefined);
  const [insights, setInsights] = useState<FinanceInsightsData | null>(null);
  const load = useCallback(async () => {
    const [t, i] = await Promise.all([getFinanceToday(), getFinanceInsights()]);
    setToday(t);
    setInsights(i);
  }, []);
  useEffect(() => {
    void load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load, refreshKey]);
  return { today, insights };
}

function TodayBlock({ data }: { data: FinanceTodayData }) {
  const [showMethod, setShowMethod] = useState(false);

  if (!data.ok) {
    return (
      <section className="flex flex-col gap-1">
        <span className="text-xs text-text-dim">Hoy puedes gastar</span>
        <p className="text-sm text-text-dim">No se pudo calcular: {data.error}</p>
      </section>
    );
  }

  if (!data.today) {
    // Sin número: se dice qué falta y dónde se arregla (el plan se arma y se
    // confirma en el teléfono; la web aún no tiene editor de plan).
    return (
      <section className="flex flex-col gap-1.5">
        <span className="text-xs text-text-dim">Hoy puedes gastar</span>
        <p className="max-w-prose text-sm text-text">{data.reason}</p>
        {data.missing === "plan" && (
          <p className="max-w-prose text-xs text-text-dim">
            Ármalo y confírmalo en Hermes Phone, en Finanzas → «Arma tu plan mensual». Con los
            ingresos y gastos del mes, Hermes reparte lo libre entre los días que quedan.
          </p>
        )}
      </section>
    );
  }

  const t = data.today;
  const over = t.overBy != null;
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-xs text-text-dim">Hoy puedes gastar</span>
          <span className="text-4xl leading-none font-medium text-text tabular-nums">
            {amount(t.available, t.currency)}
          </span>
          <span className="text-xs text-text-faint">
            {t.daysLeft === 1
              ? "último día del mes"
              : `quedan ${t.daysLeft} días del mes, contando hoy`}
          </span>
        </div>
        <div className="grid min-w-0 grid-cols-2 gap-x-8">
          <Stat
            size="md"
            label="Gastado hoy"
            value={amount(t.spentToday, t.currency)}
            context={
              t.spentTodayPlanned > 0
                ? `+ ${amount(t.spentTodayPlanned, t.currency)} ya reservado en el plan`
                : undefined
            }
          />
          <Stat
            size="md"
            label="Te queda hoy"
            value={t.remaining < 0 ? signedMoney(t.remaining, t.currency) : amount(t.remaining, t.currency)}
            tone={t.remaining < 0 ? "red" : "text"}
            context={t.remaining < 0 ? "pasaste lo de hoy" : undefined}
          />
        </div>
      </div>

      {over && (
        <p className="flex items-center gap-2 text-xs text-text-dim">
          <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-red" />
          <span>
            Este mes ya te pasaste del plan por{" "}
            <span className="text-text tabular-nums">{amount(t.overBy!, t.currency)}</span>.
          </span>
        </p>
      )}

      <div className="flex flex-col items-start gap-1.5">
        <Button
          variant="ghost"
          size="xs"
          className="-ml-2"
          aria-expanded={showMethod}
          onClick={() => setShowMethod((v) => !v)}
        >
          {showMethod ? "Ocultar el cálculo" : "¿Cómo se calcula?"}
        </Button>
        {showMethod && <p className="max-w-prose text-xs leading-relaxed text-text-dim">{t.method}</p>}
      </div>
    </section>
  );
}

/** Fila de lista: nombre + cifra a la derecha, contexto debajo; el método en el title. */
function Row({ name, value, context, method }: { name: string; value: string; context: string; method: string }) {
  return (
    <li title={method} className="flex min-w-0 flex-col gap-0.5 py-1.5">
      <div className="flex min-w-0 items-baseline gap-3">
        <span className="min-w-0 flex-1 truncate text-sm text-text">{name}</span>
        <span className="shrink-0 text-sm text-text tabular-nums">{value}</span>
      </div>
      <span className="truncate text-xs text-text-faint">{context}</span>
    </li>
  );
}

function List({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex flex-col">
        <h3 className="text-xs text-text-dim">{title}</h3>
        <span className="text-xs text-text-faint">{hint}</span>
      </div>
      <ul className="flex flex-col divide-y divide-line">{children}</ul>
    </div>
  );
}

const MAX_ROWS = 5;

function Insights({
  recurring,
  ant,
  drift,
}: {
  recurring: RecurringCharge[];
  ant: AntExpense[];
  drift: CategoryDrift[];
}) {
  const lists = [
    recurring.length > 0 && (
      <List key="rec" title="Cargos repetidos" hint="Mismo comercio, monto parecido, un cobro al mes">
        {recurring.slice(0, MAX_ROWS).map((r) => (
          <Row
            key={`${r.currency}|${r.key}|${r.monthly}`}
            name={r.merchant}
            value={`${amount(r.monthly, r.currency)}/mes`}
            context={`${r.months} meses · último ${shortDate(r.lastDate)} · ${amount(r.yearTotal, r.currency)} en el año`}
            method={r.method}
          />
        ))}
      </List>
    ),
    ant.length > 0 && (
      <List key="ant" title="Gastos hormiga" hint={`5 o más compras chicas este mes`}>
        {ant.slice(0, MAX_ROWS).map((a) => (
          <Row
            key={`${a.currency}|${a.key}`}
            name={a.merchant}
            value={amount(a.total, a.currency)}
            context={`${a.count} compras bajo ${amount(a.threshold, a.currency)}`}
            method={a.method}
          />
        ))}
      </List>
    ),
    drift.length > 0 && (
      <List key="drift" title="Desvíos" hint="Por encima de lo habitual a esta altura del mes">
        {drift.slice(0, MAX_ROWS).map((d) => (
          <Row
            key={`${d.currency}|${d.category}`}
            name={categoryLabel(d.category)}
            value={`${amount(d.over, d.currency)} de más`}
            context={`llevas ${amount(d.spent, d.currency)} · lo habitual ${amount(d.expected, d.currency)} (mediana ${d.baseMonths.map(shortMonth).join("–")})`}
            method={d.method}
          />
        ))}
      </List>
    ),
  ].filter(Boolean);

  if (lists.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-text">Para revisar</h2>
      <div className="@container">
        {/* Una sola lista no se estira a todo el ancho: la cifra se alejaría de su nombre. */}
        <div className={`grid gap-x-10 gap-y-6 ${lists.length === 1 ? "max-w-xl" : "@2xl:grid-cols-2"} ${lists.length > 2 ? "@5xl:grid-cols-3" : ""}`}>
          {lists}
        </div>
      </div>
    </section>
  );
}

/**
 * El día y lo que hay que revisar. `refreshKey` cambia cuando cambian los
 * movimientos de la vista. Sin agente no se pinta nada: el resumen del mes,
 * justo debajo, ya dice que está fuera de línea.
 */
export function FinanceToday({ refreshKey }: { refreshKey: string }) {
  const { today, insights } = useFinanceToday(refreshKey);
  if (!today) return null;
  return (
    <div className="flex flex-col gap-10">
      <TodayBlock data={today} />
      {insights?.ok && <Insights recurring={insights.recurring} ant={insights.ant} drift={insights.drift} />}
    </div>
  );
}
