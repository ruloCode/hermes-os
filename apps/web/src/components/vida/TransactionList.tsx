"use client";

import { useMemo, useState } from "react";
import {
  FINANCE_CATEGORIES,
  isTransfer,
  type Currency,
  type Transaction,
  type TransactionKind,
  type Wallet,
} from "@hermes/shared";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { PanelState } from "@/components/ui/PanelState";
import { Segmented } from "@/components/ui/Segmented";
import { CategoryIcon, categoryLabel } from "./categories";
import { money } from "./FinanceSummary";
import { FIELD, IconPencil } from "./kit";
import { TransactionDetail } from "./TransactionDetail";

const DAYS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

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
 *
 * v5: la fila se lee de izquierda a derecha como un extracto — categoría (gris,
 * con su icono), QUÉ fue (la nota, en tinta plena: es lo que buscas con los
 * ojos), billetera como etiqueta neutra y el monto alineado a la derecha. Un
 * gasto va en tinta normal con su "−"; solo el ingreso se pinta de verde: en
 * un extracto casi todo es gasto, y una columna roja entera no avisa de nada.
 * Sin borde por fila (eran 30 cajitas apiladas): hover y nada más.
 */
export function TransactionList({
  transactions,
  wallets,
  onAdd,
  onEdit,
  onVoid,
}: {
  transactions: Transaction[];
  wallets: Wallet[];
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

  // Edición inline: un movimiento a la vez (lápiz en la fila).
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
      // Entre cuentas propias: no es ingreso ni gasto (inflaría los dos totales).
      if (isTransfer(t)) continue;
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
      if (t.kind === "expense" && !isTransfer(t)) {
        if (t.currency === "USD") g.spentUsd += t.amount;
        else g.spentCop += t.amount;
      }
    }
    return out;
  }, [filtered]);

  return (
    <div className="flex h-full flex-col">
      {/* Captura manual: dos líneas que no se desarman — qué, cuánto y de dónde
          arriba; cuándo, nota y el botón abajo. Todo a h-8, como <Button
          size="md">; los selects crecen para cerrar la fila a ras. */}
      <div className="flex flex-col gap-2 border-b border-line p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            ariaLabel="Tipo de movimiento"
            value={kind}
            onChange={setKind}
            options={[
              { value: "expense", label: "Gasto" },
              { value: "income", label: "Ingreso" },
            ]}
          />
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void add()}
            placeholder="Monto"
            aria-label="Monto"
            inputMode="numeric"
            className={`${FIELD} w-24 tabular-nums`}
          />
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value as Currency)}
            aria-label="Moneda"
            className={FIELD}
          >
            <option value="COP">COP</option>
            <option value="USD">USD</option>
          </select>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            aria-label="Categoría"
            className={`${FIELD} min-w-28 flex-1`}
          >
            {FINANCE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {categoryLabel(c)}
              </option>
            ))}
          </select>
          {/* Billetera opcional: descuenta/suma su saldo */}
          <select
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            title="Billetera (opcional): descuenta o suma su saldo"
            aria-label="Billetera"
            className={`${FIELD} min-w-28 flex-1 ${account ? "" : "text-text-faint"}`}
          >
            <option value="">Sin billetera</option>
            {wallets.map((w) => (
              <option key={w.id} value={w.name}>
                {w.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Fecha de pago opcional (default hoy) */}
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            title="Fecha de pago (opcional, default hoy)"
            aria-label="Fecha de pago"
            className={`${FIELD} ${date ? "" : "text-text-faint"}`}
          />
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void add()}
            placeholder="Nota (opcional)…"
            aria-label="Nota"
            className={`${FIELD} min-w-40 flex-1`}
          />
          <Button
            variant="primary"
            size="md"
            onClick={() => void add()}
            disabled={!amount.trim() || saving}
          >
            {saving ? "Registrando…" : "Registrar"}
          </Button>
        </div>
      </div>

      {/* Búsqueda + filtros + totales del conjunto visible */}
      <div className="flex flex-wrap items-center gap-2 px-3 pt-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar nota, categoría, billetera…"
          aria-label="Buscar movimientos"
          className={`${FIELD} min-w-40 flex-1`}
        />
        <Segmented
          ariaLabel="Filtrar por tipo"
          value={kindFilter}
          onChange={setKindFilter}
          options={[
            { value: "all", label: "Todos" },
            { value: "expense", label: "Gastos" },
            { value: "income", label: "Ingresos" },
          ]}
        />
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          aria-label="Filtrar por categoría"
          className={`${FIELD} ${categoryFilter ? "" : "text-text-dim"}`}
        >
          <option value="">Todas las categorías</option>
          {presentCategories.map((c) => (
            <option key={c} value={c}>
              {categoryLabel(c)}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-baseline justify-between gap-3 px-5 pt-3 pb-1 text-xs tabular-nums">
        <span className="text-text-faint">
          {filtered.length} movimiento{filtered.length === 1 ? "" : "s"}
          {filtered.length !== transactions.length && ` de ${transactions.length}`}
        </span>
        <span className="flex gap-3">
          {(totals.spentCop > 0 || totals.spentUsd > 0) && (
            <span className="text-text-dim">
              −{totals.spentCop > 0 && money(totals.spentCop, "COP")}
              {totals.spentCop > 0 && totals.spentUsd > 0 && " · "}
              {totals.spentUsd > 0 && money(totals.spentUsd, "USD")}
            </span>
          )}
          {(totals.inCop > 0 || totals.inUsd > 0) && (
            <span className="text-green">
              +{totals.inCop > 0 && money(totals.inCop, "COP")}
              {totals.inCop > 0 && totals.inUsd > 0 && " · "}
              {totals.inUsd > 0 && money(totals.inUsd, "USD")}
            </span>
          )}
        </span>
      </div>

      {/* Días */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {days.length === 0 && (
          <PanelState
            kind="empty"
            compact
            title={filtered.length === 0 && transactions.length > 0 ? "Sin resultados" : "Sin movimientos aún"}
            hint={
              filtered.length === 0 && transactions.length > 0
                ? "Prueba con otra búsqueda o quita los filtros."
                : "Regístralo arriba o díselo a Hermes: “gasté 20 mil en un almuerzo”."
            }
          />
        )}
        {days.map((g) => (
          <section key={g.date} className="pt-3">
            {/* Encabezado del día con su total gastado */}
            <div className="flex items-baseline justify-between gap-2 border-b border-line px-2 pb-1.5">
              <span className="text-xs font-medium text-text-dim">{dayLabel(g.date)}</span>
              <span className="text-xs text-text-faint tabular-nums">
                {g.spentCop > 0 && <>gastado {money(g.spentCop, "COP")}</>}
                {g.spentCop > 0 && g.spentUsd > 0 && " · "}
                {g.spentUsd > 0 && <>{money(g.spentUsd, "USD")}</>}
                {g.spentCop === 0 && g.spentUsd === 0 && "sin gastos"}
              </span>
            </div>
            <div className="flex flex-col pt-1">
              {g.items.map((t) =>
                editingId === t.id && edit ? (
                  // Fila en edición: mismos campos de la captura, compactos.
                  <div
                    key={t.id}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void commitEdit(t);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    className="my-1 flex flex-col gap-2 rounded-sm bg-hover p-2"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Segmented
                        ariaLabel="Tipo de movimiento"
                        value={edit.kind}
                        onChange={(k) => setEdit({ ...edit, kind: k })}
                        options={[
                          { value: "expense", label: "Gasto" },
                          { value: "income", label: "Ingreso" },
                        ]}
                      />
                      <input
                        autoFocus
                        value={edit.amount}
                        onChange={(e) => setEdit({ ...edit, amount: e.target.value })}
                        inputMode="numeric"
                        aria-label="Monto"
                        className={`${FIELD} w-28 tabular-nums`}
                      />
                      <select
                        value={edit.category}
                        onChange={(e) => setEdit({ ...edit, category: e.target.value })}
                        aria-label="Categoría"
                        className={`${FIELD} min-w-28 flex-1`}
                      >
                        {FINANCE_CATEGORIES.map((c) => (
                          <option key={c} value={c}>
                            {categoryLabel(c)}
                          </option>
                        ))}
                      </select>
                      <input
                        type="date"
                        value={edit.date}
                        onChange={(e) => setEdit({ ...edit, date: e.target.value })}
                        aria-label="Fecha"
                        className={FIELD}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        value={edit.note}
                        onChange={(e) => setEdit({ ...edit, note: e.target.value })}
                        placeholder="Nota…"
                        aria-label="Nota"
                        className={`${FIELD} min-w-0 flex-1`}
                      />
                      <Button size="md" variant="ghost" onClick={() => setEditingId(null)}>
                        Cancelar
                      </Button>
                      <Button size="md" variant="primary" onClick={() => void commitEdit(t)}>
                        Guardar
                      </Button>
                    </div>
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
                    className="group flex min-w-0 cursor-pointer items-center gap-3 rounded-sm px-2 py-1.5 transition-colors hover:bg-hover"
                  >
                    <span className="flex w-32 shrink-0 items-center gap-2 text-text-dim">
                      <CategoryIcon category={t.category} className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate text-xs">{categoryLabel(t.category)}</span>
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-text">
                      {t.note || <span className="text-text-faint">Sin nota</span>}
                    </span>
                    {t.account && (
                      <Badge tone="neutral" size="sm">
                        {t.account}
                      </Badge>
                    )}
                    <span
                      className={`w-28 shrink-0 text-right text-sm tabular-nums ${
                        t.kind === "income" && !isTransfer(t) ? "text-green" : "text-text"
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
                      className="grid h-6 w-6 shrink-0 cursor-pointer place-items-center rounded-xs text-text-faint opacity-0 transition-[opacity,color,background-color] group-hover:opacity-100 hover:bg-hover hover:text-text focus-visible:opacity-100"
                    >
                      <IconPencil size={13} />
                    </button>
                  </div>
                ),
              )}
            </div>
          </section>
        ))}
      </div>

      {/* Overlay de detalle (fila clicada) */}
      {selected && (
        <TransactionDetail
          transaction={selected}
          onEdit={onEdit}
          onVoid={onVoid}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
