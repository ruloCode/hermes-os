/**
 * Billeteras (tabla wallets): el saldo ACTUAL del dueño por cuenta. Se fija
 * conversacionalmente ("tengo 55 mil en nequi") y se ajusta automáticamente
 * con cada transacción que indique billetera (gasto resta, ingreso suma) —
 * ver los hooks en finance/store.ts. Recalibrar = volver a fijar el saldo.
 * Sin Supabase, degrada a no-op (null/[]).
 */
import { createHash } from "node:crypto";
import type { Currency, Transaction, Wallet } from "@hermes/shared";
import { getUsdCopRate } from "./fx.js";
import { supabase } from "../supabase.js";

function localKey(...parts: string[]): string {
  return createHash("sha1").update(parts.join("|")).digest("hex");
}

function mapWallet(row: Record<string, unknown>): Wallet {
  return { ...(row as unknown as Wallet), balance: Number(row.balance) };
}

export async function listWallets(): Promise<Wallet[]> {
  if (!supabase) return [];
  const { data } = await supabase.from("wallets").select("*").order("balance", { ascending: false });
  return (data ?? []).map(mapWallet);
}

/** Resuelve "nequi" → billetera por nombre (exact → includes). */
export async function resolveWallet(name: string): Promise<Wallet | null> {
  const needle = name.trim().toLowerCase();
  if (!needle) return null;
  const wallets = await listWallets();
  return (
    wallets.find((w) => w.name.toLowerCase() === needle) ??
    wallets.find((w) => w.name.toLowerCase().includes(needle)) ??
    wallets.find((w) => needle.includes(w.name.toLowerCase())) ??
    null
  );
}

/** Fija (o crea) el saldo de una billetera — el recalibre conversacional. */
export async function setWalletBalance(
  name: string,
  balance: number,
  currency: Currency = "COP",
): Promise<Wallet | null> {
  if (!supabase) return null;
  // Si ya existe (aunque el nombre dicho sea parcial), actualiza ESA.
  const existing = await resolveWallet(name);
  const canonical = existing?.name ?? name.trim();
  const { data, error } = await supabase
    .from("wallets")
    .upsert(
      {
        local_key: localKey("wallet", canonical.toLowerCase()),
        name: canonical,
        currency: existing?.currency ?? currency,
        balance,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "local_key" },
    )
    .select()
    .single();
  if (error) {
    console.error("[wallets] set:", error.message);
    return null;
  }
  return mapWallet(data);
}

/** Efecto de una transacción sobre su billetera: gasto resta, ingreso suma. */
function txEffect(tx: Pick<Transaction, "kind" | "amount">): number {
  return tx.kind === "expense" ? -Number(tx.amount) : Number(tx.amount);
}

/**
 * Aplica (sign=+1) o revierte (sign=-1) el efecto de una transacción sobre la
 * billetera de su campo `account`. Best-effort: si no hay billetera que
 * coincida o la moneda no cuadra, no toca nada. Devuelve la billetera
 * actualizada (para confirmar "queda $X") o null.
 */
export async function applyTxToWallet(
  tx: Pick<Transaction, "kind" | "amount" | "currency" | "account">,
  sign: 1 | -1,
): Promise<Wallet | null> {
  if (!supabase || !tx.account) return null;
  const wallet = await resolveWallet(tx.account);
  if (!wallet || wallet.currency !== tx.currency) return null;
  const balance = wallet.balance + sign * txEffect(tx);
  const { data, error } = await supabase
    .from("wallets")
    .update({ balance, updated_at: new Date().toISOString() })
    .eq("id", wallet.id)
    .select()
    .maybeSingle();
  if (error) {
    console.error("[wallets] adjust:", error.message);
    return null;
  }
  return data ? mapWallet(data) : null;
}

const fmt = (n: number, c: Currency) =>
  `${c === "USD" ? "US$" : "$"}${new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 }).format(n)}`;

/** Saldo total por moneda + detalle por billetera, como texto para narrar. */
export async function balancesToText(): Promise<string | null> {
  const wallets = await listWallets();
  if (!wallets.length) return null;
  const byCur = (cur: Currency) => wallets.filter((w) => w.currency === cur);
  const parts: string[] = [];
  const cop = byCur("COP");
  const copTotal = cop.reduce((a, w) => a + w.balance, 0);
  if (cop.length) {
    parts.push(`${fmt(copTotal, "COP")} COP (${cop.map((w) => `${w.name} ${fmt(w.balance, "COP")}`).join(" · ")})`);
  }
  const usd = byCur("USD");
  const usdTotal = usd.reduce((a, w) => a + w.balance, 0);
  if (usd.length) {
    parts.push(`${fmt(usdTotal, "USD")} (${usd.map((w) => `${w.name} ${fmt(w.balance, "USD")}`).join(" · ")})`);
  }
  let text = `Saldo actual: ${parts.join(" + ")}.`;
  // Con ambas monedas, el gran total en COP a la TRM del día (si hay tasa).
  if (cop.length && usd.length) {
    const rate = await getUsdCopRate();
    if (rate) {
      text += ` Total combinado: ${fmt(Math.round(copTotal + usdTotal * rate.rate), "COP")} COP al cambio de hoy.`;
    }
  }
  return text;
}
