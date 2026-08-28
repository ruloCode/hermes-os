"use client";

// Detalle de un movimiento (patrón Monarch/Midday: fila → tarjeta con TODO):
// monto hero, fecha completa, cuándo/desde dónde se registró, billetera, nota
// sin truncar, y las acciones — editar en el mismo overlay y anular con
// confirmación en dos pasos (nada destructivo a un clic). Cierra con Esc,
// la X o tocando el fondo.

import { useEffect, useState } from "react";
import {
  FINANCE_CATEGORIES,
  type Transaction,
  type TransactionKind,
} from "@hermes/shared";
import { Badge } from "@/components/ui/Badge";
import { CmdButton } from "@/components/ui/CmdButton";
import { DataRow } from "@/components/ui/DataRow";
import { CategoryIcon, categoryLabel } from "./categories";
import { money } from "./FinanceSummary";

const FIELD =
  "rounded-sm border border-line bg-transparent outline-none transition-colors focus:border-line-2";

const MONTHS_LONG = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];
const DAYS_LONG = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

/** "2026-07-09" → "jueves 9 de julio de 2026" (UTC noon: sin corrimiento). */
function fullDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
  return `${DAYS_LONG[dow]} ${d} de ${MONTHS_LONG[m - 1]} de ${y}`;
}

/** created_at ISO → "9 jul, 11:28" en hora de Bogotá. */
function registeredAt(ts: string): string {
  try {
    return new Intl.DateTimeFormat("es-CO", {
      timeZone: "America/Bogota",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(ts));
  } catch {
    return ts;
  }
}

/** De dónde entró el movimiento (source de la DB → etiqueta humana). */
const SOURCE_LABEL: Record<string, string> = {
  web: "manual (web)",
  agent: "Hermes",
  voice: "voz",
  mobile: "móvil",
};

interface EditDraft {
  kind: TransactionKind;
  amount: string;
  category: string;
  date: string;
  note: string;
}

export function TransactionDetail({
  transaction: t,
  categoryColor,
  onEdit,
  onVoid,
  onClose,
}: {
  transaction: Transaction;
  categoryColor?: (category: string) => string | undefined;
  onEdit: (
    id: number,
    patch: Partial<Pick<Transaction, "amount" | "category" | "note" | "occurred_on" | "kind">>,
  ) => Promise<unknown>;
  onVoid: (id: number) => Promise<unknown>;
  onClose: () => void;
}) {
  const [edit, setEdit] = useState<EditDraft | null>(null);
  const [confirmVoid, setConfirmVoid] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    // capture: gana al listener global de useHotkeys (que también mira Esc).
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const startEdit = () =>
    setEdit({
      kind: t.kind,
      amount: String(t.amount),
      category: t.category,
      date: t.occurred_on,
      note: t.note ?? "",
    });

  const commitEdit = async () => {
    if (!edit) return;
    const n = Number(edit.amount.replace(/[.,\s]/g, ""));
    if (!n || n <= 0) return;
    setSaving(true);
    await onEdit(t.id, {
      kind: edit.kind,
      amount: n,
      category: edit.category,
      occurred_on: edit.date || t.occurred_on,
      note: edit.note.trim() || null,
    });
    setSaving(false);
    onClose();
  };

  const doVoid = async () => {
    setSaving(true);
    await onVoid(t.id);
    setSaving(false);
    onClose();
  };

  const color = categoryColor?.(t.category) ?? "var(--color-text-faint)";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-bg/70 p-4 backdrop-blur-sm hud-in"
      style={{ animationDuration: "120ms" }}
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Detalle del movimiento"
        onClick={(e) => e.stopPropagation()}
        className="hud-panel relative flex max-h-[85vh] w-full max-w-md flex-col gap-3 overflow-y-auto overscroll-contain p-5"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar"
          className="absolute top-3 right-3 grid h-6 w-6 place-items-center rounded-sm border border-line text-text-dim transition-colors hover:border-line-2 hover:text-text"
        >
          ✕
        </button>

        {/* Identidad: categoría + tipo */}
        <div className="flex items-center gap-2 pr-8">
          <span style={{ color }}>
            <CategoryIcon category={t.category} className="h-4 w-4" />
          </span>
          <span className="text-sm text-text">{categoryLabel(t.category)}</span>
          <Badge tone={t.kind === "income" ? "green" : "red"} size="sm">
            {t.kind === "income" ? "Ingreso" : "Gasto"}
          </Badge>
        </div>

        {/* Monto hero */}
        <div
          className={`font-display text-3xl tabular-nums ${
            t.kind === "income" ? "text-green" : "text-red"
          }`}
        >
          {t.kind === "income" ? "+" : "−"}
          {money(t.amount, t.currency)}
        </div>

        {edit ? (
          /* Edición dentro del overlay: mismos campos de la captura */
          <div
            className="flex flex-col gap-2"
            onKeyDown={(e) => {
              if (e.key === "Enter") void commitEdit();
            }}
          >
            <div className="flex flex-wrap items-center gap-1.5">
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
                className={`${FIELD} w-28 px-2 py-1 text-xs text-text tabular-nums`}
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
            </div>
            <input
              value={edit.note}
              onChange={(e) => setEdit({ ...edit, note: e.target.value })}
              placeholder="Nota…"
              className={`${FIELD} w-full px-2 py-1 text-xs text-text`}
            />
            <div className="flex gap-2">
              <CmdButton size="sm" onClick={() => void commitEdit()} loading={saving}>
                Guardar
              </CmdButton>
              <CmdButton size="sm" onClick={() => setEdit(null)}>
                Cancelar
              </CmdButton>
            </div>
          </div>
        ) : (
          <>
            {/* Metadatos completos */}
            <div className="flex flex-col border-t border-line pt-2">
              <DataRow label="Fecha" value={fullDate(t.occurred_on)} />
              <DataRow label="Registrado" value={registeredAt(t.created_at)} />
              <DataRow label="Vía" value={SOURCE_LABEL[t.source] ?? t.source} />
              <DataRow label="Billetera" value={t.account ?? "—"} />
              <DataRow label="Moneda" value={t.currency} />
            </div>
            {t.note && (
              <div className="rounded-sm border border-line px-2.5 py-2">
                <span className="mb-1 block text-2xs tracking-label text-text-dim uppercase">
                  Nota
                </span>
                <p className="text-xs leading-relaxed whitespace-pre-wrap text-text">{t.note}</p>
              </div>
            )}

            {/* Acciones */}
            <div className="flex items-center gap-2 border-t border-line pt-3">
              <CmdButton size="sm" onClick={startEdit}>
                ✎ Editar
              </CmdButton>
              {confirmVoid ? (
                <span className="flex items-center gap-2 text-2xs text-red">
                  ¿Anular este movimiento?
                  <button
                    type="button"
                    onClick={() => void doVoid()}
                    disabled={saving}
                    className="rounded-sm border border-red px-2 py-1 font-semibold text-red transition-colors hover:bg-red/10"
                  >
                    Sí, anular
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmVoid(false)}
                    className="rounded-sm border border-line px-2 py-1 text-text-dim transition-colors hover:text-text"
                  >
                    No
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmVoid(true)}
                  className="rounded-sm border border-line px-2 py-1 text-2xs text-red transition-colors hover:border-red"
                >
                  ✕ Anular
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
