import type { Transaction, Wallet } from "@hermes/shared";
import { createTransaction } from "./store.js";

/**
 * Movimientos leídos de los avisos del banco en el teléfono (Hermes Phone,
 * core/BankParser). El teléfono ya los entendió; aquí solo se validan y se
 * registran. El texto crudo del aviso NUNCA llega: solo lo estructurado.
 *
 * Idempotente por la huella del aviso (`notif:<key>`): el teléfono reintenta
 * sin miedo (cola local, sin red, reinicios) y el mismo aviso es una sola fila.
 * El saldo de la billetera lo ajusta createTransaction, como con la voz.
 */

export const NOTIF_ACCOUNTS = ["bancolombia", "nu", "nequi"] as const;

export interface NotifMovement {
  key: string;
  kind: "expense" | "income";
  amount: number;
  currency: "COP" | "USD";
  account: (typeof NOTIF_ACCOUNTS)[number];
  note: string;
  occurred_on: string;
}

export function validateNotifMovements(raw: unknown): { items: NotifMovement[]; rejected: string[] } {
  const list = Array.isArray(raw) ? raw.slice(0, 200) : [];
  const items: NotifMovement[] = [];
  const rejected: string[] = [];
  for (const [i, r] of list.entries()) {
    const x = (r ?? {}) as Record<string, unknown>;
    const key = typeof x.key === "string" ? x.key.trim() : "";
    const amount = Number(x.amount);
    const account = typeof x.account === "string" ? x.account.toLowerCase() : "";
    const day = typeof x.occurred_on === "string" ? x.occurred_on : "";
    if (!/^(sms|app):[0-9a-f]{8,40}$/.test(key)) { rejected.push(`#${i + 1}: huella inválida`); continue; }
    if (x.kind !== "expense" && x.kind !== "income") { rejected.push(`#${i + 1}: tipo inválido`); continue; }
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1e10) { rejected.push(`#${i + 1}: monto inválido`); continue; }
    if (!(NOTIF_ACCOUNTS as readonly string[]).includes(account)) { rejected.push(`#${i + 1}: cuenta desconocida`); continue; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) { rejected.push(`#${i + 1}: fecha inválida`); continue; }
    items.push({
      key,
      kind: x.kind,
      amount,
      currency: x.currency === "USD" ? "USD" : "COP",
      account: account as NotifMovement["account"],
      note: typeof x.note === "string" && x.note.trim() ? x.note.trim().slice(0, 120) : "Aviso del banco",
      occurred_on: day,
    });
  }
  return { items, rejected };
}

export interface NotifResult {
  key: string;
  status: "created" | "duplicate" | "error";
  tx?: Transaction;
  wallet?: Wallet | null;
}

export async function ingestNotifMovements(items: readonly NotifMovement[]): Promise<NotifResult[]> {
  const out: NotifResult[] = [];
  // En serie: dos movimientos de la misma billetera ajustan su saldo uno tras otro.
  for (const m of items) {
    const r = await createTransaction({
      kind: m.kind,
      amount: m.amount,
      currency: m.currency,
      category: m.kind === "income" ? "otros_ingreso" : "otros",
      account: m.account,
      note: m.note,
      occurredOn: m.occurred_on,
      source: "notification",
      localKey: `notif:${m.key}`,
    });
    out.push(r ? { key: m.key, status: r.deduped ? "duplicate" : "created", tx: r.tx, wallet: r.wallet } : { key: m.key, status: "error" });
  }
  return out;
}
