import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Transaction } from "@hermes/shared";
import { HERMES_HOME } from "../home.js";

/**
 * Plan mensual: lo que entra y sale CADA mes (sueldos, arriendo, servicios,
 * suscripciones). Es la base de las proyecciones del teléfono, así que lo
 * CONFIRMA el dueño: Hermes solo sugiere.
 *
 * Por qué no se deduce solo de las transacciones: el dueño dictó su plan en una
 * sentada (18 movimientos en 10 minutos el mismo día). Esas fechas son de
 * cuándo se dijo, no de cuándo se paga — tomarlas como día de pago inventaría
 * una precisión que no existe. Por eso `day` es null salvo que el dueño lo
 * ponga o que el mismo movimiento se haya repetido el mismo día en ≥2 meses.
 *
 * Vive en ~/.hermes-os/finance/plan.json (infra del dueño, sin migración).
 * Lógica pura y testeable; solo el store toca disco.
 */

export type PlanKind = "income" | "expense";
export type PlanCurrency = "COP" | "USD";

export interface PlanItem {
  id: string;
  kind: PlanKind;
  label: string;
  amount: number;
  currency: PlanCurrency;
  category: string;
  /** Día del mes en que cae (1-31). null = sin día fijo: se reparte parejo en el mes. */
  day: number | null;
}

export interface FinancePlan {
  items: PlanItem[];
  /** Cuándo lo confirmó el dueño. null = nunca: el teléfono muestra sugerencias, no proyección. */
  confirmed_at: string | null;
}

export interface PlanSuggestion extends PlanItem {
  /** Por qué se sugiere ("dice «mensual»", "se repitió en 3 meses"); null = candidato sin señal. */
  reason: string | null;
  /** Fecha del último movimiento que la respalda. */
  last_seen: string;
}

const MONTHLY_WORD = /\bmensual(es|mente)?\b/i;

/** "luz Usme mensual" → "luz usme": la llave para agrupar el mismo concepto. */
export function conceptKey(note: string): string {
  return note
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(MONTHLY_WORD, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** "luz Usme mensual" → "Luz Usme" (lo que el dueño ve). */
export function planLabel(note: string): string {
  const clean = note.replace(MONTHLY_WORD, "").replace(/\s+/g, " ").trim();
  return clean ? clean[0].toUpperCase() + clean.slice(1) : "Sin nombre";
}

function itemId(kind: string, key: string, currency: string): string {
  return createHash("sha1").update(`plan|${kind}|${key}|${currency}`).digest("hex").slice(0, 12);
}

/**
 * Sugerencias a partir de las transacciones (no anuladas):
 * - `suggestions`: dicen "mensual" o se repitieron en ≥2 meses distintos.
 * - `candidates`: el resto, sin marcar, para que el dueño agregue lo que falte
 *   (un arriendo dictado sin la palabra "mensual" también es mensual).
 * Un concepto aparece una sola vez, con su monto más reciente.
 */
export function suggestPlan(txs: readonly Transaction[]): {
  suggestions: PlanSuggestion[];
  candidates: PlanSuggestion[];
} {
  const groups = new Map<string, Transaction[]>();
  for (const tx of txs) {
    if (tx.voided_at) continue;
    const note = (tx.note ?? "").trim() || tx.category;
    const key = `${tx.kind}|${tx.currency}|${conceptKey(note)}`;
    const g = groups.get(key);
    if (g) g.push(tx);
    else groups.set(key, [tx]);
  }

  const suggestions: PlanSuggestion[] = [];
  const candidates: PlanSuggestion[] = [];
  for (const [key, list] of groups) {
    const sorted = [...list].sort((a, b) => b.occurred_on.localeCompare(a.occurred_on));
    const last = sorted[0];
    const note = (last.note ?? "").trim() || last.category;
    const months = new Set(list.map((t) => t.occurred_on.slice(0, 7)));
    const days = new Set(list.map((t) => Number(t.occurred_on.slice(8, 10))));
    const saysMonthly = list.some((t) => MONTHLY_WORD.test(t.note ?? ""));
    const repeated = months.size >= 2;
    const reason = saysMonthly ? "dice «mensual»" : repeated ? `se repitió en ${months.size} meses` : null;
    const item: PlanSuggestion = {
      id: itemId(last.kind, key.split("|")[2] || last.category, last.currency),
      kind: last.kind,
      label: planLabel(note),
      amount: Number(last.amount),
      currency: last.currency,
      category: last.category,
      // Solo con evidencia: el mismo día en ≥2 meses. Si no, sin día fijo.
      day: repeated && days.size === 1 ? [...days][0] : null,
      reason,
      last_seen: last.occurred_on,
    };
    (reason ? suggestions : candidates).push(item);
  }
  const order = (a: PlanSuggestion, b: PlanSuggestion) =>
    a.kind === b.kind ? b.amount - a.amount : a.kind === "income" ? -1 : 1;
  return { suggestions: suggestions.sort(order), candidates: candidates.sort(order) };
}

/** Valida lo que manda el teléfono: un ítem roto se descarta con motivo, no tumba el plan. */
export function validatePlanItems(raw: unknown): { items: PlanItem[]; rejected: string[] } {
  const list = Array.isArray(raw) ? raw : [];
  const items: PlanItem[] = [];
  const rejected: string[] = [];
  const seen = new Set<string>();
  list.forEach((r, i) => {
    const x = (r ?? {}) as Record<string, unknown>;
    const label = typeof x.label === "string" ? x.label.trim().slice(0, 80) : "";
    const amount = Number(x.amount);
    const kind = x.kind === "income" || x.kind === "expense" ? x.kind : null;
    const currency = x.currency === "USD" ? "USD" : x.currency === "COP" || x.currency == null ? "COP" : null;
    const dayN = x.day == null || x.day === "" ? null : Number(x.day);
    const day = dayN != null && Number.isInteger(dayN) && dayN >= 1 && dayN <= 31 ? dayN : null;
    if (!label) return void rejected.push(`#${i + 1}: falta el nombre`);
    if (!kind) return void rejected.push(`${label}: tipo inválido`);
    if (!currency) return void rejected.push(`${label}: moneda inválida`);
    if (!Number.isFinite(amount) || amount <= 0) return void rejected.push(`${label}: monto inválido`);
    if (dayN != null && day == null) return void rejected.push(`${label}: día fuera de 1-31`);
    const id = typeof x.id === "string" && x.id ? x.id.slice(0, 40) : itemId(kind, conceptKey(label), currency);
    if (seen.has(id)) return void rejected.push(`${label}: repetido`);
    seen.add(id);
    items.push({
      id,
      kind,
      label,
      amount,
      currency,
      category: typeof x.category === "string" && x.category.trim() ? x.category.trim().slice(0, 40) : "otros",
      day,
    });
  });
  return { items, rejected };
}

/** Totales mensuales del plan por moneda (para el agente y el brief). */
export function planTotals(items: readonly PlanItem[]): Record<PlanCurrency, { income: number; expense: number }> {
  const out: Record<PlanCurrency, { income: number; expense: number }> = {
    COP: { income: 0, expense: 0 },
    USD: { income: 0, expense: 0 },
  };
  for (const it of items) out[it.currency][it.kind] += it.amount;
  return out;
}

export interface PlanStore {
  load(): Promise<FinancePlan>;
  save(plan: FinancePlan): Promise<void>;
}

export const PLAN_PATH = join(HERMES_HOME, "finance", "plan.json");

export function filePlanStore(path = PLAN_PATH): PlanStore {
  return {
    async load() {
      try {
        const raw = JSON.parse(await readFile(path, "utf8")) as Partial<FinancePlan>;
        return {
          items: validatePlanItems(raw.items).items,
          confirmed_at: typeof raw.confirmed_at === "string" ? raw.confirmed_at : null,
        };
      } catch {
        return { items: [], confirmed_at: null };
      }
    },
    async save(plan) {
      await mkdir(dirname(path), { recursive: true });
      const tmp = `${path}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(plan, null, 2) + "\n");
      await rename(tmp, path);
    },
  };
}
