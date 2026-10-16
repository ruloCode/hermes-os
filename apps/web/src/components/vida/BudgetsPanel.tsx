"use client";

// Presupuestos del mes (patrón Monarch: límite vs gastado con "queda X").
// La verdad del gasto viene del FinanceSummary (by_category ya cruza budget);
// aquí además se listan presupuestos sin gasto aún y se editan los límites
// (setBudget existía en el agente y la voz, pero no tenía UI).
//
// v5: cada presupuesto era una cajita con borde y una barra del color del
// acento. Ahora es una fila del riel: categoría, "gastado de límite" y una
// barra fina NEUTRA que solo se pinta cuando dice algo (ámbar al 80 %, rojo al
// pasarse). Un presupuesto en $0 no es una alarma.

import { useMemo, useState } from "react";
import type { Budget, Currency, FinanceSummary } from "@hermes/shared";
import { Button } from "@/components/ui/Button";
import { PanelState } from "@/components/ui/PanelState";
import { money } from "./FinanceSummary";
import { CategoryIcon, categoryLabel, EXPENSE_CATEGORIES } from "./categories";
import { FIELD, IconPlus, Progress } from "./kit";

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
    <div className="flex flex-col gap-2">
      {rows.length === 0 && !adding && (
        <PanelState
          kind="empty"
          compact
          title="Sin presupuestos"
          hint="Ponle techo a una categoría — o díselo a Hermes: “presupuesto de 800 mil para mercado”."
        />
      )}

      {rows.length > 0 && (
        <ul className="flex flex-col gap-1">
          {rows.map((r) => {
            const pct = r.limit > 0 ? r.spent / r.limit : 0;
            const left = r.limit - r.spent;
            const state = pct >= 1 ? "text-red" : pct >= 0.8 ? "text-amber" : "text-text-faint";
            return (
              <li key={r.category} className="flex flex-col gap-1.5 rounded-sm px-2 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className={pct >= 0.8 ? state : "text-text-dim"}>
                    <CategoryIcon category={r.category} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-text">
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
                      className={`${FIELD} h-7 w-32 text-right tabular-nums`}
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
                      className="shrink-0 cursor-pointer rounded-xs px-1 text-xs text-text-dim tabular-nums transition-colors hover:bg-hover hover:text-text"
                    >
                      <span className="text-text">{money(r.spent, currency)}</span> de{" "}
                      {money(r.limit, currency)}
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <Progress
                      value={r.spent}
                      max={r.limit}
                      warnAt={0.8}
                      dangerAt={1}
                      label={`${categoryLabel(r.category)}: ${Math.round(pct * 100)} % del límite`}
                    />
                  </div>
                  <span className={`shrink-0 text-xs tabular-nums ${state}`}>
                    {left < 0 ? `${money(-left, currency)} pasado` : `quedan ${money(left, currency)}`}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Alta de presupuesto: categoría libre + límite */}
      {adding ? (
        <div
          className="flex items-center gap-2 rounded-sm border border-line p-2"
          onKeyDown={(e) => {
            if (e.key === "Escape") setAdding(false);
          }}
        >
          <select
            value={newCat}
            onChange={(e) => setNewCat(e.target.value)}
            className={FIELD}
            aria-label="Categoría del presupuesto"
          >
            {freeCategories.map((c) => (
              <option key={c} value={c}>
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
            }}
            placeholder={`Límite mensual en ${currency}`}
            aria-label="Límite mensual"
            className={`${FIELD} min-w-0 flex-1 tabular-nums`}
            inputMode="numeric"
          />
          <Button
            variant="primary"
            size="md"
            onClick={() => void save(newCat)}
            disabled={!draft.trim()}
          >
            Crear
          </Button>
        </div>
      ) : (
        freeCategories.length > 0 && (
          <Button
            variant="ghost"
            icon={<IconPlus size={13} />}
            onClick={() => {
              setAdding(true);
              setDraft("");
              setNewCat(freeCategories[0]);
            }}
            className="self-start"
          >
            Agregar presupuesto
          </Button>
        )
      )}
    </div>
  );
}
