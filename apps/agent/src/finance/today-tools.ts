import { tool } from "@anthropic-ai/claude-agent-sdk";
import { moneyText } from "@hermes/shared";
import { OWNER } from "../owner.js";
import { financeInsights, financeToday } from "./today.js";

/**
 * Tool `get_finance_today`: lo mismo que `/finance/today` + `/finance/insights`,
 * en texto corto y CON el método de cada número (el modelo lo repite, no lo
 * recalcula). Va en el candado de finanzas (guard.ts): desde el teléfono sin
 * huella no existe.
 */

function text(t: string) {
  return { content: [{ type: "text" as const, text: t }] };
}

export async function financeTodayText(): Promise<string> {
  const [t, ins] = await Promise.all([financeToday(), financeInsights()]);
  if (!t.ok) return `No pude calcularlo: ${t.error}`;
  const lines: string[] = [];
  if (!t.today) {
    lines.push(`Sin disponible de hoy: ${t.reason}`);
  } else {
    const d = t.today;
    const m = (n: number) => moneyText(n, d.currency);
    lines.push(
      d.overBy != null
        ? `Hoy puedes gastar ${m(0)}: el mes ya se pasó del plan por ${m(d.overBy)}.`
        : `Hoy puedes gastar ${m(d.available)}. Llevas ${m(d.spentToday)} hoy; quedan ${m(d.remaining)}.`,
    );
    if (d.spentTodayPlanned > 0) lines.push(`Además hoy salieron ${m(d.spentTodayPlanned)} que el plan ya tenía reservados.`);
    lines.push(`Método: ${d.method}`);
  }
  if (ins.ok) {
    for (const r of ins.recurring.slice(0, 5)) lines.push(`Cargo repetido: ${r.merchant}, ${moneyText(r.monthly, r.currency)} al mes (último ${r.lastDate}). ${r.method}`);
    for (const a of ins.ant.slice(0, 5)) lines.push(`Gasto hormiga: ${a.merchant}. ${a.method}`);
    for (const d of ins.drift.slice(0, 5)) lines.push(`Desvío en ${d.category}: ${moneyText(d.over, d.currency)} de más. ${d.method}`);
  }
  return lines.join("\n");
}

export const FINANCE_TODAY_TOOLS = [
  tool(
    "get_finance_today",
    `Cuánto puede gastar HOY ${OWNER} sin salirse de su plan mensual (y lo gastado hoy y lo que queda), más cargos repetidos, gastos hormiga y categorías desviadas. ` +
      `Úsala cuando pregunte «¿cuánto puedo gastar hoy?», «¿cómo voy hoy?» o por suscripciones/gastos chicos. Repite las cifras y el método tal cual; no recalcules ni redondees a su favor.`,
    {},
    async () => text(await financeTodayText()),
  ),
];
