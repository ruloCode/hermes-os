import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Wallet } from "@hermes/shared";
import { HERMES_HOME } from "../home.js";

/**
 * Historia del saldo: una foto por día de lo que suman las billeteras. Los
 * saldos de `wallets` solo guardan el valor ACTUAL, así que sin esto no hay con
 * qué dibujar "cómo ha ido tu plata" — la gráfica se construye desde el día en
 * que empezó a tomarse la foto y no antes (nada se reconstruye ni se inventa).
 *
 * Una foto por día calendario (zona del dueño): la última del día manda.
 * ~/.hermes-os/finance/balances.json, máx. 730 días.
 */

export interface BalanceSnapshot {
  /** YYYY-MM-DD en la zona del dueño. */
  date: string;
  /** Suma por moneda, tal cual (sin convertir). */
  totals: Record<string, number>;
  wallets: Array<{ name: string; currency: string; balance: number }>;
  taken_at: string;
}

const KEEP_DAYS = 730;

export function dayIn(tz: string, at: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

export function snapshotOf(wallets: readonly Wallet[], at: Date, tz: string): BalanceSnapshot {
  const totals: Record<string, number> = {};
  for (const w of wallets) totals[w.currency] = (totals[w.currency] ?? 0) + Number(w.balance);
  return {
    date: dayIn(tz, at),
    totals,
    wallets: wallets.map((w) => ({ name: w.name, currency: w.currency, balance: Number(w.balance) })),
    taken_at: at.toISOString(),
  };
}

/** Inserta o reemplaza la foto del día; ordena y recorta. Sin billeteras no hay foto (no se guarda un $0 falso). */
export function upsertSnapshot(list: readonly BalanceSnapshot[], snap: BalanceSnapshot): BalanceSnapshot[] {
  if (!snap.wallets.length) return [...list];
  return [...list.filter((s) => s.date !== snap.date), snap]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-KEEP_DAYS);
}

export function parseHistory(raw: unknown): BalanceSnapshot[] {
  const list = Array.isArray((raw as { snapshots?: unknown })?.snapshots) ? (raw as { snapshots: unknown[] }).snapshots : [];
  return list.filter((s): s is BalanceSnapshot => {
    const x = s as Partial<BalanceSnapshot>;
    return typeof x?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x.date) && !!x.totals && Array.isArray(x.wallets);
  });
}

export const HISTORY_PATH = join(HERMES_HOME, "finance", "balances.json");

export async function loadHistory(path = HISTORY_PATH): Promise<BalanceSnapshot[]> {
  try {
    return parseHistory(JSON.parse(await readFile(path, "utf8")));
  } catch {
    return [];
  }
}

export async function saveHistory(list: BalanceSnapshot[], path = HISTORY_PATH): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify({ snapshots: list }) + "\n");
  await rename(tmp, path);
}

/** Toma la foto de hoy con las billeteras dadas. Devuelve cuántos días hay. */
export async function recordBalance(wallets: readonly Wallet[], tz: string, path = HISTORY_PATH): Promise<number> {
  const next = upsertSnapshot(await loadHistory(path), snapshotOf(wallets, new Date(), tz));
  await saveHistory(next, path);
  return next.length;
}
