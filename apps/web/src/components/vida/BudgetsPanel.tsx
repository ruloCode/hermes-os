"use client";

// Presupuestos del mes (patrón Monarch: límite vs gastado con "queda X").
// La verdad del gasto viene del FinanceSummary (by_category ya cruza budget);
// aquí además se listan presupuestos sin gasto aún y se editan los límites
// (setBudget existía en el agente y la voz, pero no tenía UI).

import { useMemo, useState } from "react";
import type { Budget, Currency, FinanceSummary } from "@hermes/shared";
import { BarMeter } from "@/components/ui/BarMeter";
import { PanelState } from "@/components/ui/PanelState";
import { money } from "./FinanceSummary";
import { CategoryIcon, categoryLabel, EXPENSE_CATEGORIES } from "./categories";

const FIELD =
  "rounded-sm border border-line bg-transparent outline-none transition-colors focus:border-line-2";

interface Row {
  category: string;
  limit: number;
  spent: number;
}

export function BudgetsPanel({
  summary,
  budgets,
  currency,
  onSave,
}: {
  summary: FinanceSummary | null;
  budgets: Budget[];
  currency: Currency;
  onSave: (category: string, limit: number) => Promise<unknown>;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [newCat, setNewCat] = useState<string>("mercado");

  const rows = useMemo<Row[]>(() => {
    const spentBy = new Map(
      (summary?.by_category ?? []).map((c) => [c.category, c.spent]),
    );
    return budgets
      .filter((b) => b.currency === currency)
      .map((b) => ({
        category: b.category,
        limit: b.monthly_limit,
        spent: spentBy.get(b.category) ?? 0,
      }))
      .sort((a, b) => b.spent / b.limit - a.spent / a.limit);
  }, [summary, budgets, currency]);

  const save = async (category: string) => {
    const limit = Number(draft.replace(/[^\d]/g, ""));
    setEditing(null);
    setAdding(false);
    if (limit > 0) await onSave(category, limit);
  };

  const freeCategories = EXPENSE_CATEGORIES.filter(
    (c) => !rows.some((r) => r.category === c),
  );

  return (
    <div className="flex h-full flex-col gap-1.5">
      {rows.length === 0 && !adding && (
        <PanelState
          kind="empty"
          compact
          title="Sin presupuestos"
          hint="Ponle techo a una categoría — o díselo a Hermes: “presupuesto de 800 mil para mercado”."
        />
      )}

      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
        {rows.map((r) => {
          const pct = r.limit > 0 ? r.spent / r.limit : 0;
          const left = r.limit - r.spent;
          return (
            <div key={r.category} className="rounded-sm border border-line px-2 py-1.5">
              <div className="flex items-center gap-2">
                <span className={pct >= 1 ? "text-red" : pct >= 0.8 ? "text-amber" : "text-text-dim"}>
                  <CategoryIcon category={r.category} />
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-text">
                  {categoryLabel(r.category)}
                </span>
                {editing === r.category ? (
                  <input
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void save(r.category);
                      if (e.key === "Escape") setEditing(null);
                    }}
                    onBlur={() => void save(r.category)}
                    className={`${FIELD} w-24 px-1.5 py-0.5 text-right text-2xs text-text tabular-nums`}
                    inputMode="numeric"
                    aria-label={`Límite mensual de ${categoryLabel(r.category)}`}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(r.category);
                      setDraft(String(r.limit));
                    }}
                    title="Editar límite mensual"
                    className="shrink-0 font-display text-2xs text-text-dim tabular-nums transition-colors hover:text-text"
                  >
                    {money(r.spent, currency)} / {money(r.limit, currency)}
                  </button>
                )}
              </div>
              <div className="mt-1 flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <BarMeter
                    value={r.spent}
                    max={r.limit}
                    segments={0}
                    height={5}
                    tone="violet"
                    thresholds={{ warn: 80, danger: 100 }}
                    showValue={false}
                  />
                </div>
                <span
                  className={`shrink-0 text-2xs tabular-nums ${
                    left < 0 ? "text-red" : pct >= 0.8 ? "text-amber" : "text-text-dim"
                  }`}
                >
                  {left < 0
                    ? `${money(-left, currency)} pasado`
                    : `queda ${money(left, currency)}`}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Alta de presupuesto: categoría libre + límite */}
      {adding ? (
        <div className="flex shrink-0 items-center gap-1.5">
          <select
            value={newCat}
            onChange={(e) => setNewCat(e.target.value)}
            className={`${FIELD} px-1.5 py-1 text-2xs text-text`}
            aria-label="Categoría del presupuesto"
          >
            {freeCategories.map((c) => (
              <option key={c} value={c} className="bg-bg">
                {categoryLabel(c)}
              </option>
            ))}
          </select>
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void save(newCat);
              if (e.key === "Escape") setAdding(false);
            }}
            placeholder={`Límite mensual en ${currency}`}
            className={`${FIELD} min-w-0 flex-1 px-2 py-1 text-2xs text-text tabular-nums`}
            inputMode="numeric"
          />
        </div>
      ) : (
        freeCategories.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setAdding(true);
              setDraft("");
              setNewCat(freeCategories[0]);
            }}
            className="shrink-0 self-start text-2xs tracking-label text-text-dim uppercase transition-colors hover:text-violet"
          >
            + presupuesto
          </button>
        )
      )}
    </div>
  );
}
