/**
 * Candado de finanzas para lo que llega del TELÉFONO. Tener el teléfono
 * desbloqueado no basta para ver la plata: la app pide la huella para abrir
 * Finanzas y, mientras está abierta, manda `X-Hermes-Finance: unlocked`.
 * Sin esa marca, a un turno que viene del teléfono se le APAGAN las tools de
 * finanzas en el SDK (disallowedTools) — no es una instrucción al modelo que
 * se pueda convencer, es que la tool no existe en ese turno.
 *
 * Desde la Mac (dashboard, voz del escritorio, tareas programadas) no cambia nada.
 */

export const FINANCE_TOOLS = [
  "log_transaction",
  "list_transactions",
  "get_finance_summary",
  "get_balance",
  "set_wallet_balance",
  "set_budget",
].map((t) => `mcp__hermes__${t}`);

export interface FinanceGate {
  locked: boolean;
  disallowedTools: string[];
  /** Línea para el turno: el modelo sabe POR QUÉ no tiene las tools y qué decir. */
  note: string | null;
}

export function financeGate(header: (name: string) => string | undefined): FinanceGate {
  const fromPhone = header("X-Hermes-Client") === "phone";
  const unlocked = header("X-Hermes-Finance") === "unlocked";
  if (!fromPhone || unlocked) return { locked: false, disallowedTools: [], note: null };
  return {
    locked: true,
    disallowedTools: FINANCE_TOOLS,
    note: "[Finanzas está BLOQUEADA en el teléfono: no tienes tools de plata en este turno. Si pregunta por saldos, gastos o movimientos, no los adivines ni los saques de memorias: dile que abra Tú → Finanzas y confirme con su huella, y que luego te pregunte.]",
  };
}
