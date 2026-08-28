"use client";

import { useMemo, useState } from "react";
import {
  FINANCE_CATEGORIES,
  type Currency,
  type Transaction,
  type TransactionKind,
  type Wallet,
} from "@hermes/shared";
import { Badge } from "@/components/ui/Badge";
import { CmdButton } from "@/components/ui/CmdButton";
import { PanelState } from "@/components/ui/PanelState";
import { CategoryIcon, categoryLabel } from "./categories";
import { money } from "./FinanceSummary";
import { TransactionDetail } from "./TransactionDetail";

const DAYS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

// Campos de la captura manual: mismo borde/focus para inputs y selects.
const FIELD =
  "rounded-sm border border-line bg-transparent outline-none transition-colors focus:border-line-2";

/** "2026-07-09" → "jue 09 jul" (sin Date local para no correrse de día). */
function dayLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
  const months = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  return `${DAYS[dow]} ${String(d).padStart(2, "0")} ${months[m - 1]}`;
}

/** Borrador de edición inline de un movimiento (montos como texto crudo). */
interface EditDraft {
  kind: TransactionKind;
  amount: string;
  category: string;
  date: string;
  note: string;
}

/**
 * Movimientos agrupados POR DÍA (seguimiento diario: cada día con su total
 * gastado), con captura manual compacta — fecha de pago opcional (default
 * hoy) y billetera opcional (descuenta su saldo) — y edición/anulación inline.
 */
export function TransactionList({
  transactions,
  wallets,
  categoryColor,
  onAdd,
  onEdit,
  onVoid,
}: {
  transactions: Transaction[];
  wallets: Wallet[];
  /** color de los donuts por categoría — el icono mantiene la identidad. */
  categoryColor?: (category: string) => string | undefined;
  onAdd: (input: {
    kind: TransactionKind;
    amount: number;
    currency?: Currency;
    category?: string;
    account?: string;
    note?: string;
    occurred_on?: string;
  }) => Promise<unknown>;
  onEdit: (
    id: number,
    patch: Partial<Pick<Transaction, "amount" | "category" | "note" | "occurred_on" | "kind">>,
  ) => Promise<unknown>;
  onVoid: (id: number) => Promise<unknown>;
}) {
  const [kind, setKind] = useState<TransactionKind>("expense");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<Currency>("COP");
  const [category, setCategory] = useState("otros");
  const [account, setAccount] = useState("");
  const [date, setDate] = useState(""); // vacío = hoy
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  // Edición inline: un movimiento a la vez (✎ en la fila).
  const [editingId, setEditingId] = useState<number | null>(null);
  const [edit, setEdit] = useState<EditDraft | null>(null);

  // Detalle (clic en la fila): overlay con todos los metadatos + acciones.
  const [selected, setSelected] = useState<Transaction | null>(null);

  // Búsqueda y filtros (patrón Monarch/Origin: buscar en nota, categoría,
  // billetera y monto; chips de tipo; filtro por categoría).
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | TransactionKind>("all");
  const [categoryFilter, setCategoryFilter] = useState("");

  const startEdit = (t: Transaction) => {
    setEditingId(t.id);
    setEdit({
      kind: t.kind,
      amount: String(t.amount),
      category: t.category,
      date: t.occurred_on,
      note: t.note ?? "",
    });
  };

  const commitEdit = async (t: Transaction) => {
    if (!edit) return;
    const n = Number(edit.amount.replace(/[.,\s]/g, ""));
    if (!n || n <= 0) return;
    setEditingId(null);
    await onEdit(t.id, {
      kind: edit.kind,
      amount: n,
      category: edit.category,
      occurred_on: edit.date || t.occurred_on,
      note: edit.note.trim() || null,
    });
  };

  const add = async () => {
    const n = Number(amount.replace(/[.,\s]/g, ""));
    if (!n || n <= 0) return;
    setSaving(true);
    await onAdd({
      kind,
      amount: n,
      currency,
      category,
      account: account || undefined,
      note: note.trim() || undefined,
      occurred_on: date || undefined,
    });
    setAmount("");
    setNote("");
    setDate("");
    setSaving(false);
  };

  // Filtrado en cliente (los 400 del mes ya están cargados).
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return transactions.filter((t) => {
      if (kindFilter !== "all" && t.kind !== kindFilter) return false;
      if (categoryFilter && t.category !== categoryFilter) return false;
      if (!q) return true;
      return (
        (t.note ?? "").toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q) ||
        categoryLabel(t.category).toLowerCase().includes(q) ||
        (t.account ?? "").toLowerCase().includes(q) ||
        String(t.amount).includes(q.replace(/[.,\s]/g, ""))
      );
    });
  }, [transactions, query, kindFilter, categoryFilter]);

  // Totales del conjunto visible (strip estilo Origin: siempre datos reales).
  const totals = useMemo(() => {
    let spentCop = 0, spentUsd = 0, inCop = 0, inUsd = 0;
    for (const t of filtered) {
      if (t.kind === "expense") {
        if (t.currency === "USD") spentUsd += t.amount;
        else spentCop += t.amount;
      } else {
        if (t.currency === "USD") inUsd += t.amount;
        else inCop += t.amount;
      }
    }
    return { spentCop, spentUsd, inCop, inUsd };
  }, [filtered]);

  // Categorías presentes (para el filtro: solo las que tienen movimientos).
  const presentCategories = useMemo(
    () => [...new Set(transactions.map((t) => t.category))].sort(),
    [transactions],
  );

  // Agrupación por día (vienen ordenadas desc por occurred_on).
  const days = useMemo(() => {
    const out: { date: string; items: Transaction[]; spentCop: number; spentUsd: number }[] = [];
    for (const t of filtered) {
      let g = out[out.length - 1];
      if (!g || g.date !== t.occurred_on) {
        g = { date: t.occurred_on, items: [], spentCop: 0, spentUsd: 0 };
        out.push(g);
      }
      g.items.push(t);
      if (t.kind === "expense") {
        if (t.currency === "USD") g.spentUsd += t.amount;
        else g.spentCop += t.amount;
      }
    }
    return out;
  }, [filtered]);

  return (
    <div className="flex h-full flex-col gap-2">
      {/* Captura manual */}
      <div className="flex flex-wrap items-center gap-1.5">
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as TransactionKind)}
          className={`${FIELD} px-1.5 py-1 text-2xs ${kind === "income" ? "text-green" : "text-red"}`}
        >
          <option value="expense" className="bg-bg">Gasto</option>
          <option value="income" className="bg-bg">Ingreso</option>
        </select>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void add()}
          placeholder="Monto"
          inputMode="numeric"
          className={`${FIELD} w-20 px-2 py-1 text-xs text-text tabular-nums`}
        />
        <select
          value={currency}
          onChange={(e) => setCurrency(e.target.value as Currency)}
          className={`${FIELD} px-1.5 py-1 text-2xs text-text`}
        >
          <option value="COP" className="bg-bg">COP</option>
          <option value="USD" className="bg-bg">USD</option>
        </select>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className={`${FIELD} px-1.5 py-1 text-2xs text-text`}
        >
          {FINANCE_CATEGORIES.map((c) => (
            <option key={c} value={c} className="bg-bg">
              {c}
            </option>
          ))}
        </select>
        {/* Billetera opcional: descuenta/suma su saldo */}
        <select
          value={account}
          onChange={(e) => setAccount(e.target.value)}
          title="Billetera (opcional): descuenta o suma su saldo"
          className={`${FIELD} px-1.5 py-1 text-2xs ${account ? "text-cyan" : "text-text-dim"}`}
        >
          <option value="" className="bg-bg">sin billetera</option>
          {wallets.map((w) => (
            <option key={w.id} value={w.name} className="bg-bg">
              {w.name}
            </option>
          ))}
        </select>
        {/* Fecha de pago opcional (default hoy) */}
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          title="Fecha de pago (opcional, default hoy)"
          className={`${FIELD} px-1.5 py-[3px] text-2xs [color-scheme:dark] ${date ? "text-text" : "text-text-dim"}`}
        />
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void add()}
          placeholder="Nota…"
          className={`${FIELD} min-w-0 flex-1 px-2 py-1 text-xs text-text`}
        />
        {/* Wrapper shrink-0: .cmd-btn trae width:100% y aquí va inline */}
        <div className="shrink-0">
          <CmdButton
            size="sm"
            onClick={() => void add()}
            disabled={!amount.trim()}
            loading={saving}
          >
            Registrar
          </CmdButton>
        </div>
      </div>

      {/* Búsqueda + filtros + totales del conjunto visible */}
      <div className="flex flex-wrap items-center gap-1.5 border-t border-line pt-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar nota, categoría, billetera…"
          aria-label="Buscar movimientos"
          className={`${FIELD} min-w-32 flex-1 px-2 py-1 text-xs text-text`}
        />
        <div className="flex gap-1" role="group" aria-label="Filtrar por tipo">
          {(
            [
              ["all", "Todos"],
              ["expense", "Gastos"],
              ["income", "Ingresos"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setKindFilter(k)}
              className={`rounded-sm border px-2 py-0.5 text-2xs tracking-label transition-colors ${
                kindFilter === k
                  ? "border-violet text-violet"
                  : "border-line text-text-dim hover:border-line-2 hover:text-text"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          aria-label="Filtrar por categoría"
          className={`${FIELD} px-1.5 py-1 text-2xs ${categoryFilter ? "text-cyan" : "text-text-dim"}`}
        >
          <option value="" className="bg-bg">todas las categorías</option>
          {presentCategories.map((c) => (
            <option key={c} value={c} className="bg-bg">
              {categoryLabel(c)}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-baseline justify-between px-1 text-2xs text-text-dim tabular-nums">
        <span>
          {filtered.length} mov{filtered.length === 1 ? "" : "s"}
          {filtered.length !== transactions.length && ` de ${transactions.length}`}
        </span>
        <span>
          {(totals.spentCop > 0 || totals.spentUsd > 0) && (
            <span className="text-red">
              −{totals.spentCop > 0 && money(totals.spentCop, "COP")}
              {totals.spentCop > 0 && totals.spentUsd > 0 && " · "}
              {totals.spentUsd > 0 && money(totals.spentUsd, "USD")}
            </span>
          )}
          {(totals.inCop > 0 || totals.inUsd > 0) && (
            <span className="ml-2 text-green">
              +{totals.inCop > 0 && money(totals.inCop, "COP")}
              {totals.inCop > 0 && totals.inUsd > 0 && " · "}
              {totals.inUsd > 0 && money(totals.inUsd, "USD")}
            </span>
          )}
        </span>
      </div>

      {/* Días */}
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {days.length === 0 && (
          <PanelState
            kind="empty"
            compact
            title={filtered.length === 0 && transactions.length > 0 ? "Sin resultados" : "Sin movimientos aún"}
          />
        )}
        {days.map((g) => (
          <div key={g.date}>
            {/* Header del día con su total gastado */}
            <div className="mb-1 flex items-baseline justify-between border-b border-line px-1 pb-0.5">
              <span className="text-2xs tracking-label text-violet uppercase">
                {dayLabel(g.date)}
              </span>
              <span className="text-2xs text-text-dim tabular-nums">
                {g.spentCop > 0 && <>gastado {money(g.spentCop, "COP")}</>}
                {g.spentCop > 0 && g.spentUsd > 0 && " · "}
                {g.spentUsd > 0 && <>{money(g.spentUsd, "USD")}</>}
                {g.spentCop === 0 && g.spentUsd === 0 && "sin gastos"}
              </span>
            </div>
            <div className="space-y-1">
              {g.items.map((t) =>
                editingId === t.id && edit ? (
                  // Fila en edición: mismos campos de la captura, compactos.
                  <div
                    key={t.id}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void commitEdit(t);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    className="flex flex-wrap items-center gap-1.5 rounded-sm border border-line-2 px-2 py-1"
                  >
                    <select
                      value={edit.kind}
                      onChange={(e) => setEdit({ ...edit, kind: e.target.value as TransactionKind })}
                      className={`${FIELD} px-1.5 py-1 text-2xs ${edit.kind === "income" ? "text-green" : "text-red"}`}
                    >
                      <option value="expense" className="bg-bg">Gasto</option>
                      <option value="income" className="bg-bg">Ingreso</option>
                    </select>
                    <input
                      autoFocus
                      value={edit.amount}
                      onChange={(e) => setEdit({ ...edit, amount: e.target.value })}
                      inputMode="numeric"
                      className={`${FIELD} w-24 px-2 py-1 text-xs text-text tabular-nums`}
                    />
                    <select
                      value={edit.category}
                      onChange={(e) => setEdit({ ...edit, category: e.target.value })}
                      className={`${FIELD} px-1.5 py-1 text-2xs text-text`}
                    >
                      {FINANCE_CATEGORIES.map((c) => (
                        <option key={c} value={c} className="bg-bg">
                          {c}
                        </option>
                      ))}
                    </select>
                    <input
                      type="date"
                      value={edit.date}
                      onChange={(e) => setEdit({ ...edit, date: e.target.value })}
                      className={`${FIELD} px-1.5 py-[3px] text-2xs text-text [color-scheme:dark]`}
                    />
                    <input
                      value={edit.note}
                      onChange={(e) => setEdit({ ...edit, note: e.target.value })}
                      placeholder="Nota…"
                      className={`${FIELD} min-w-24 flex-1 px-2 py-1 text-xs text-text`}
                    />
                    <button
                      type="button"
                      onClick={() => void commitEdit(t)}
                      title="Guardar cambios (Enter)"
                      className="shrink-0 text-xs text-green transition-colors hover:text-text"
                    >
                      ✓
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      title="Cancelar (Esc)"
                      className="shrink-0 text-xs text-text-dim transition-colors hover:text-text"
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  // Fila clicable (patrón Monarch/Midday): abre el detalle con
                  // todos los metadatos; anular vive ALLÍ, con confirmación.
                  <div
                    key={t.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelected(t)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelected(t);
                      }
                    }}
                    title="Ver detalle"
                    className="group flex cursor-pointer items-center gap-2 rounded-sm border border-line px-2 py-1 transition-colors hover:border-line-2 hover:bg-panel-2 focus-visible:border-line-2"
                  >
                    <span className="flex w-24 shrink-0 items-center gap-1.5 text-2xs text-text-dim">
                      <span
                        className="shrink-0"
                        style={{ color: categoryColor?.(t.category) ?? "var(--color-text-faint)" }}
                      >
                        <CategoryIcon category={t.category} className="h-3 w-3" />
                      </span>
                      <span className="truncate">{categoryLabel(t.category)}</span>
                    </span>
                    {t.account && (
                      <Badge tone="neutral" size="sm">
                        {t.account}
                      </Badge>
                    )}
                    <span className="min-w-0 flex-1 truncate text-2xs text-text-dim">
                      {t.note ?? ""}
                    </span>
                    <span
                      className={`shrink-0 font-display text-xs tabular-nums ${
                        t.kind === "income" ? "text-green" : "text-red"
                      }`}
                    >
                      {t.kind === "income" ? "+" : "−"}
                      {money(t.amount, t.currency)}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        startEdit(t);
                      }}
                      title="Editar movimiento"
                      aria-label="Editar movimiento"
                      className="shrink-0 text-xs text-text-dim opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:text-text"
                    >
                      ✎
                    </button>
                  </div>
                ),
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Overlay de detalle (fila clicada) */}
      {selected && (
        <TransactionDetail
          transaction={selected}
          categoryColor={categoryColor}
          onEdit={onEdit}
          onVoid={onVoid}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
