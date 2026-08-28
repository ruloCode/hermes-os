/**
 * Store de finanzas personales (tablas transactions + budgets). Verdad en
 * Supabase, sin espejo en vault. Idempotencia por local_key determinístico:
 * la MISMA frase el mismo día colisiona a propósito (retry de la voz no
 * duplica) y el caller decide si forzar con allowDuplicate. Sin Supabase,
 * todo degrada a no-op (null/[]).
 */
import { createHash, randomUUID } from "node:crypto";
import type { Budget, Currency, Transaction, TransactionKind, Wallet } from "@hermes/shared";
import { env } from "../env.js";
import { supabase } from "../supabase.js";
import { monthRange, todayBogota } from "../dates.js";
import { applyTxToWallet, resolveWallet } from "./wallets.js";

function localKey(...parts: string[]): string {
  return createHash("sha1").update(parts.join("|")).digest("hex");
}

/** numeric de Postgres llega como string del cliente JS → normalizar. */
function mapTx(row: Record<string, unknown>): Transaction {
  return { ...(row as unknown as Transaction), amount: Number(row.amount) };
}

// ── Transacciones ──────────────────────────────────────────────────────

export interface CreateTransactionInput {
  kind: TransactionKind;
  amount: number;
  currency?: Currency;
  category?: string;
  account?: string | null;
  note?: string | null;
  /** default: hoy en Bogotá. */
  occurredOn?: string;
  /** voice | chat | web | agent. */
  source?: string;
  /** rompe la idempotencia (gasto genuinamente repetido el mismo día). */
  allowDuplicate?: boolean;
}

/**
 * Crea (o encuentra) una transacción. `deduped=true` significa que el upsert
 * chocó con un registro previo idéntico de hoy — el caller (voz/chat) avisa
 * y ofrece repetir con allowDuplicate. Si `account` coincide con una
 * billetera (misma moneda), ajusta su saldo (gasto resta, ingreso suma) y la
 * devuelve en `wallet` para confirmar "queda $X".
 */
export async function createTransaction(
  input: CreateTransactionInput,
): Promise<{ tx: Transaction; deduped: boolean; wallet: Wallet | null } | null> {
  if (!supabase) return null;
  const currency = input.currency ?? "COP";
  const category = (input.category ?? "otros").trim().toLowerCase();
  const occurredOn = input.occurredOn ?? todayBogota();
  const note = input.note?.trim() || null;
  // Nombre canónico de la billetera si el texto dicho coincide con una.
  const matched = input.account ? await resolveWallet(input.account) : null;
  const account = matched?.name ?? input.account?.trim() ?? null;
  const key = localKey(
    "tx",
    input.kind,
    input.amount.toFixed(2),
    currency,
    category,
    occurredOn,
    note ?? "",
    ...(input.allowDuplicate ? [randomUUID()] : []),
  );
  const { data, error } = await supabase
    .from("transactions")
    .upsert(
      {
        local_key: key,
        kind: input.kind,
        amount: input.amount,
        currency,
        category,
        account,
        note,
        occurred_on: occurredOn,
        source: input.source ?? "agent",
        machine: env.MACHINE_NAME,
      },
      { onConflict: "local_key" },
    )
    .select()
    .single();
  if (error || !data) {
    console.error("[finance] create:", error?.message);
    return null;
  }
  // Si la fila ya existía (misma frase), su created_at es viejo → deduped.
  const deduped = Date.now() - new Date(data.created_at as string).getTime() > 5_000;
  const tx = mapTx(data);
  // Ajuste de saldo solo en creación real (el dedup ya ajustó la primera vez).
  const wallet = !deduped ? await applyTxToWallet(tx, 1) : null;
  return { tx, deduped, wallet };
}

export async function listTransactions(
  opts: {
    month?: string;
    category?: string;
    kind?: TransactionKind;
    currency?: Currency;
    limit?: number;
  } = {},
): Promise<Transaction[]> {
  if (!supabase) return [];
  let q = supabase
    .from("transactions")
    .select("*")
    .is("voided_at", null)
    .order("occurred_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 200);
  if (opts.month) {
    const { from, to } = monthRange(opts.month);
    q = q.gte("occurred_on", from).lt("occurred_on", to);
  }
  if (opts.category) q = q.eq("category", opts.category.toLowerCase());
  if (opts.kind) q = q.eq("kind", opts.kind);
  if (opts.currency) q = q.eq("currency", opts.currency);
  const { data, error } = await q;
  if (error) console.error("[finance] list:", error.message);
  return (data ?? []).map(mapTx);
}

export async function updateTransaction(
  id: number,
  patch: Partial<Pick<Transaction, "amount" | "currency" | "category" | "note" | "occurred_on" | "kind" | "account">>,
): Promise<Transaction | null> {
  if (!supabase) return null;
  // Estado previo: para revertir su efecto en la billetera antes de re-aplicar.
  const { data: before } = await supabase.from("transactions").select("*").eq("id", id).maybeSingle();
  const clean: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.amount !== undefined) clean.amount = patch.amount;
  if (patch.currency !== undefined) clean.currency = patch.currency;
  if (patch.category !== undefined) clean.category = patch.category.toLowerCase();
  if (patch.note !== undefined) clean.note = patch.note;
  if (patch.occurred_on !== undefined) clean.occurred_on = patch.occurred_on;
  if (patch.kind !== undefined) clean.kind = patch.kind;
  if (patch.account !== undefined) clean.account = patch.account;
  const { data, error } = await supabase
    .from("transactions")
    .update(clean)
    .eq("id", id)
    .select()
    .maybeSingle();
  if (error) console.error("[finance] update:", error.message);
  if (!data) return null;
  const tx = mapTx(data);
  // Corrección de billetera: revierte el efecto viejo y aplica el nuevo
  // (cubre cambio de monto, tipo o billetera). Solo si no está anulada.
  if (before && !before.voided_at) {
    await applyTxToWallet(mapTx(before), -1);
    await applyTxToWallet(tx, 1);
  }
  return tx;
}

/** Anulación soft ("bórrala"): conserva el rastro para auditar correcciones. */
export async function voidTransaction(id: number): Promise<boolean> {
  if (!supabase) return false;
  const { data: before } = await supabase.from("transactions").select("*").eq("id", id).maybeSingle();
  const { error } = await supabase
    .from("transactions")
    .update({ voided_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) console.error("[finance] void:", error.message);
  // Devuelve el efecto a la billetera (si tenía y no estaba ya anulada).
  if (!error && before && !before.voided_at) await applyTxToWallet(mapTx(before), -1);
  return !error;
}

/** Última transacción no anulada de los últimos N minutos (correcciones por voz). */
export async function getRecentTransaction(withinMinutes = 15): Promise<Transaction | null> {
  if (!supabase) return null;
  const since = new Date(Date.now() - withinMinutes * 60_000).toISOString();
  const { data } = await supabase
    .from("transactions")
    .select("*")
    .is("voided_at", null)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? mapTx(data) : null;
}

// ── Presupuestos ───────────────────────────────────────────────────────

function mapBudget(row: Record<string, unknown>): Budget {
  return { ...(row as unknown as Budget), monthly_limit: Number(row.monthly_limit) };
}

export async function listBudgets(): Promise<Budget[]> {
  if (!supabase) return [];
  const { data } = await supabase.from("budgets").select("*").order("category");
  return (data ?? []).map(mapBudget);
}

export async function setBudget(
  category: string,
  monthlyLimit: number,
  currency: Currency = "COP",
): Promise<Budget | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("budgets")
    .upsert(
      {
        category: category.toLowerCase(),
        monthly_limit: monthlyLimit,
        currency,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "category" },
    )
    .select()
    .single();
  if (error) {
    console.error("[finance] budget:", error.message);
    return null;
  }
  return mapBudget(data);
}

export async function deleteBudget(category: string): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.from("budgets").delete().eq("category", category.toLowerCase());
  return !error;
}
