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
import { Button } from "@/components/ui/Button";
import { DataRow } from "@/components/ui/DataRow";
import { Segmented } from "@/components/ui/Segmented";
import { CategoryIcon, categoryLabel } from "./categories";
import { money } from "./FinanceSummary";
import { FIELD, IconPencil, IconX } from "./kit";

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
  notification: "aviso del banco (teléfono)",
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
  onEdit,
  onVoid,
  onClose,
}: {
  transaction: Transaction;
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
        className="hud-panel elev-2 relative flex max-h-[85vh] w-full max-w-md flex-col gap-3 overflow-y-auto overscroll-contain p-5"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar"
          className="absolute top-3 right-3 grid h-7 w-7 cursor-pointer place-items-center rounded-xs text-text-faint transition-colors hover:bg-hover hover:text-text"
        >
          <IconX />
        </button>

        {/* Identidad: categoría + tipo */}
        <div className="flex items-center gap-2 pr-8 text-text-dim">
          <CategoryIcon category={t.category} className="h-4 w-4" />
          <span className="text-sm">{categoryLabel(t.category)}</span>
          <Badge tone="neutral" size="sm">
            {t.kind === "income" ? "Ingreso" : "Gasto"}
          </Badge>
        </div>

        {/* Monto hero: el signo lo dice; solo el ingreso va en verde. */}
        <div
          className={`text-2xl font-medium tabular-nums ${
            t.kind === "income" ? "text-green" : "text-text"
          }`}
        >
          {t.kind === "income" ? "+" : "−"}
          {money(t.amount, t.currency)}
        </div>
        {t.note && !edit && (
          <p className="-mt-1 text-sm break-words whitespace-pre-wrap text-text-dim">{t.note}</p>
        )}

        {edit ? (
          /* Edición dentro del overlay: mismos campos de la captura */
          <div
            className="flex flex-col gap-2 border-t border-line pt-3"
            onKeyDown={(e) => {
              if (e.key === "Enter") void commitEdit();
            }}
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
                className={FIELD}
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
            <input
              value={edit.note}
              onChange={(e) => setEdit({ ...edit, note: e.target.value })}
              placeholder="Nota…"
              aria-label="Nota"
              className={`${FIELD} w-full`}
            />
            <div className="flex justify-end gap-2 pt-1">
              <Button size="md" variant="ghost" onClick={() => setEdit(null)}>
                Cancelar
              </Button>
              <Button
                size="md"
                variant="primary"
                onClick={() => void commitEdit()}
                disabled={saving}
              >
                {saving ? "Guardando…" : "Guardar"}
              </Button>
            </div>
          </div>
        ) : (
          <>
            {/* Metadatos completos */}
            <div className="flex flex-col border-t border-line pt-2">
              <DataRow label="Fecha" value={fullDate(t.occurred_on)} />
              <DataRow label="Registrado" value={registeredAt(t.created_at)} />
              <DataRow label="Vía" value={SOURCE_LABEL[t.source] ?? t.source} />
              <DataRow label="Billetera" value={t.account ?? "Sin billetera"} />
              <DataRow label="Moneda" value={t.currency} />
            </div>

            {/* Acciones: anular pide confirmación (nada destructivo a un clic). */}
            <div className="flex items-center justify-between gap-2 border-t border-line pt-3">
              {confirmVoid ? (
                <span className="flex items-center gap-2 text-xs text-text-dim">
                  ¿Anular este movimiento?
                  <Button variant="danger" onClick={() => void doVoid()} disabled={saving}>
                    Sí, anular
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirmVoid(false)}>
                    No
                  </Button>
                </span>
              ) : (
                <Button variant="danger" onClick={() => setConfirmVoid(true)}>
                  Anular
                </Button>
              )}
              <Button icon={<IconPencil size={13} />} onClick={startEdit}>
                Editar
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
