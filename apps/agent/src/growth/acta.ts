import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { CALL_LABEL, type CallKind } from "@hermes/shared";
import { env } from "../env.js";
import { OWNER } from "../owner.js";
import { childEnv } from "../agent/child-env.js";

/**
 * El acta de la revisión semanal: un modelo relee la llamada y la ordena en
 * las cuatro partes del diseño (qué se movió, qué no y por qué, el ajuste, una
 * persona). Solo con lo que se DIJO y los datos de la semana: lo que no se
 * habló queda como "No se habló", nunca se rellena.
 */

const MODEL = process.env.HERMES_GROWTH_MODEL || "sonnet";

export async function writeActa(input: {
  kind: CallKind;
  context: string[];
  transcript: { role: string; text: string }[];
  date: string;
}): Promise<string> {
  if (input.kind !== "weekly") return writeDayNote({ ...input, kind: input.kind });
  let captured: { moved: string; stuck: string; adjustment: string; person: string } | null = null;
  const record = tool(
    "record_review",
    "Registra el acta de la revisión semanal. Llámala UNA vez.",
    {
      moved: z.string().describe("Qué metas se movieron, con los datos de la semana que se mencionaron. 1-3 líneas."),
      stuck: z.string().describe("Qué plan no funcionó y POR QUÉ, con las palabras del dueño. 'No se habló' si no salió."),
      adjustment: z.string().describe("El ajuste que el dueño aceptó (no uno que Hermes propuso y él no aceptó). 'Ninguno' si no hubo."),
      person: z.string().describe("A quién dijo que le va a escribir esta semana. 'No se habló' si no salió."),
    },
    async (a) => {
      captured = a;
      return { content: [{ type: "text" as const, text: "Registrado." }] };
    },
  );
  const server = createSdkMcpServer({ name: "growth", version: "0.1.0", tools: [record] });
  const lines = input.transcript.map((l) => `${l.role === "user" ? OWNER : "Hermes"}: ${l.text}`).join("\n");
  const q = query({
    prompt: `Datos de la semana (con su fuente):
${input.context.join("\n")}

Conversación de la llamada:
"""
${lines.slice(0, 24_000)}
"""

Escribe el acta llamando a record_review.`,
    options: {
      systemPrompt: `Eres quien toma el acta de la revisión semanal entre ${OWNER} y Hermes, su agente.
Reglas:
- Solo lo que se dijo en la conversación y los datos de arriba. Nada inventado, ningún número que no esté ahí.
- "Plan nuevo", "sin dato" o "aún no le ha tocado" NO es cero ni "no lo hizo": escríbelo como falta de dato. Si en la llamada Hermes dijo una cifra que los datos no respaldan, no la copies.
- Sin elogios ni juicios. Tono neutro y corto, en español.
- Si una parte no se habló, escribe "No se habló".
- El ajuste es el que ${OWNER} aceptó, no el que Hermes propuso.`,
      model: MODEL,
      maxTurns: 4,
      settingSources: [],
      env: childEnv(),
      mcpServers: { growth: server },
      allowedTools: ["mcp__growth__record_review"],
      permissionMode: "default",
      canUseTool: async (name, i) =>
        name === "mcp__growth__record_review"
          ? { behavior: "allow", updatedInput: i }
          : { behavior: "deny", message: "El acta solo puede registrarse." },
    },
  });
  for await (const _ of q) {
    /* el trabajo ocurre en la tool */
  }
  const a = captured as { moved: string; stuck: string; adjustment: string; person: string } | null;
  if (!a) throw new Error("el modelo no registró el acta");
  return [
    `# Revisión semanal · ${input.date}`,
    "",
    "## Qué se movió",
    a.moved.trim(),
    "",
    "## Qué no funcionó y por qué",
    a.stuck.trim(),
    "",
    "## Ajuste",
    a.adjustment.trim(),
    "",
    "## Una persona esta semana",
    a.person.trim(),
    "",
    "## Datos de la semana",
    ...input.context.map((l) => `- ${l.trim()}`),
    "",
  ].join("\n");
}

/**
 * Las llamadas diarias dejan una nota corta: lo que se habló y lo que el dueño
 * dijo que va a hacer. Sin cifras que no estén en los datos.
 */
async function writeDayNote(input: {
  kind: "morning" | "evening";
  context: string[];
  transcript: { role: string; text: string }[];
  date: string;
}): Promise<string> {
  let captured: { resumen: string; compromiso: string } | null = null;
  const record = tool(
    "record_day",
    "Registra la nota de la llamada diaria. Llámala UNA vez.",
    {
      resumen: z.string().describe("Qué se habló, en 1-3 líneas, solo con lo dicho y los datos de arriba."),
      compromiso: z.string().describe(`Lo que ${OWNER} dijo que va a hacer (hoy o mañana). 'Ninguno' si no dijo nada.`),
    },
    async (a) => {
      captured = a;
      return { content: [{ type: "text" as const, text: "Registrado." }] };
    },
  );
  const server = createSdkMcpServer({ name: "growth", version: "0.1.0", tools: [record] });
  const lines = input.transcript.map((l) => `${l.role === "user" ? OWNER : "Hermes"}: ${l.text}`).join("\n");
  const q = query({
    prompt: `Datos del día (con su fuente):\n${input.context.join("\n")}\n\nConversación:\n"""\n${lines.slice(0, 12_000)}\n"""\n\nEscribe la nota llamando a record_day.`,
    options: {
      systemPrompt: `Tomas la nota de la llamada corta de ${input.kind === "morning" ? "la mañana" : "la tarde"} entre ${OWNER} y Hermes.
Reglas: solo lo dicho y los datos de arriba; nada inventado; "sin dato" o "plan nuevo" NO es cero; tono neutro, corto, en español; sin elogios ni juicios.`,
      model: MODEL,
      maxTurns: 4,
      settingSources: [],
      env: childEnv(),
      mcpServers: { growth: server },
      allowedTools: ["mcp__growth__record_day"],
      permissionMode: "default",
      canUseTool: async (name, i) =>
        name === "mcp__growth__record_day"
          ? { behavior: "allow", updatedInput: i }
          : { behavior: "deny", message: "La nota solo puede registrarse." },
    },
  });
  for await (const _ of q) {
    /* el trabajo ocurre en la tool */
  }
  const a = captured as { resumen: string; compromiso: string } | null;
  if (!a) throw new Error("el modelo no registró la nota");
  return [`## ${CALL_LABEL[input.kind]} · ${input.date}`, "", a.resumen.trim(), "", `**Compromiso:** ${a.compromiso.trim()}`, ""].join("\n");
}

/** Semana ISO ("2026-S42") de una fecha local. */
export function isoWeek(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7; // lunes = 0
  d.setUTCDate(d.getUTCDate() - day + 3); // el jueves de esa semana decide el año
  const year = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week = 1 + Math.round(((d.getTime() - jan4.getTime()) / 86_400_000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${year}-S${String(week).padStart(2, "0")}`;
}

/**
 * La semanal va a `40 Diario/Revisión semanal AAAA-Sxx.md`; las diarias se
 * AGREGAN a la nota del día (`40 Diario/AAAA-MM-DD.md`), que se crea si no
 * existe. Sin vault (máquina solo-ejecución), null.
 */
export async function saveActa(md: string, date: string, kind: CallKind = "weekly"): Promise<string | null> {
  if (!env.VAULT_PATH) return null;
  const dir = join(env.VAULT_PATH, "40 Diario");
  if (kind !== "weekly") {
    const day = join(dir, `${date}.md`);
    await mkdir(dir, { recursive: true });
    const exists = await readFile(day, "utf8").then(() => true, () => false);
    if (!exists) await writeFile(day, `---\nfecha: ${date}\ntipo: diario\n---\n\n# ${date}\n`, "utf8");
    await appendFile(day, `\n${md.trim()}\n`, "utf8");
    return day;
  }
  const path = join(dir, `Revisión semanal ${isoWeek(date)}.md`);
  await mkdir(dir, { recursive: true });
  const front = `---\ntipo: revision-semanal\nfecha: ${date}\n---\n\n`;
  await writeFile(path, front + md, "utf8");
  return path;
}
