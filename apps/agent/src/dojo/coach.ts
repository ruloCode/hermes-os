/**
 * Hermes en el Dojo (patrón gym/analyze.ts): Agent SDK + UNA tool que captura
 * la respuesta. Tres momentos: revisar si entendiste el problema, cuestionar tu
 * plan y explicar por qué falla un test.
 *
 * La regla: NUNCA escribe la solución ni código que la resuelva. El modelo ve
 * la solución de referencia para saber a dónde va el problema (sin eso no puede
 * juzgar un plan), así que el prompt lo prohíbe y `stripCode` quita lo que se
 * cuele de todos modos.
 */
import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { stripCode, type DojoCoachFeedback, type DojoCoachStage, type DojoItem } from "@hermes/shared";
import { childEnv } from "../agent/child-env.js";
import { env } from "../env.js";
import { OWNER } from "../owner.js";

const TIMEOUT_MS = 45_000;

export interface CoachInput {
  item: DojoItem;
  stage: DojoCoachStage;
  understanding?: string;
  edgeCase?: string;
  plan?: string;
  code?: string;
  /** El primer test que falla, tal como lo vio el harness. */
  failing?: { call: string; expected: string; got: string | null; error?: string | null };
}

const STAGE_TASK: Record<DojoCoachStage, string> = {
  entender: `${OWNER} acaba de leer el problema y escribió con sus palabras qué entra, qué sale y un caso que podría romper la solución. Dile si lo entendió. Si falta algo (un borde, un detalle del enunciado), señálalo con una pregunta que lo lleve a verlo. NO hables todavía de cómo resolverlo.`,
  plan: `${OWNER} escribió su enfoque antes de programar. Cuestiónalo como un buen entrevistador: ¿funciona en los ejemplos?, ¿en los bordes?, ¿qué complejidad tiene y alcanza para los límites del problema? Si va bien, dilo y nombra el riesgo principal al implementarlo. Si no va, NO le des el enfoque correcto: hazle una pregunta o dale un caso concreto donde su plan falla.`,
  debug: `El código de ${OWNER} falla un test. Explica POR QUÉ falla ese caso concreto: qué hace su código paso a paso con esa entrada y dónde se separa de lo esperado. Puedes citar SU línea o el nombre de SU variable. NO le digas cómo arreglarlo con código: a lo sumo, qué debería pasar en ese punto.`,
};

export function buildCoachSystemPrompt(): string {
  return `# Hermes — sensei del Dojo de algoritmos

${OWNER} está aprendiendo a resolver problemas de programación desde cero, en Python, y quiere escribir cada línea por su cuenta. Tú eres su tutor socrático.

## Reglas (no negociables)
- NUNCA escribas la solución, ni código que la resuelva, ni pseudocódigo completo. Nada de bloques de código ni líneas de Python. Puedes nombrar herramientas en línea (\`set\`, \`dict.get\`, \`%\`) o citar UNA expresión corta de SU código.
- La solución de referencia que recibes es solo para que sepas a dónde va el problema. Jamás la muestres, la parafrasees línea por línea ni la insinúes entera.
- Español, directo y cálido. Máximo 4 frases en \`message\`. Nada de elogios vacíos: si algo está bien, di QUÉ está bien.
- \`question\` (opcional): una sola pregunta que lo haga pensar el siguiente paso.
- Responde SIEMPRE llamando a la tool \`record_coach\` UNA sola vez.`;
}

export function buildCoachUserPrompt(i: CoachInput): string {
  const p = i.item.problem!;
  const visible = p.cases
    .filter((c) => !c.hidden && c.args)
    .map((c) => `- ${p.fn}(${c.args!.map((a) => JSON.stringify(a)).join(", ")}) → ${JSON.stringify(c.expected)}`)
    .join("\n");
  const parts = [
    `## Problema: ${i.item.title}`,
    p.statement.join("\n"),
    `Firma: \`${p.signature}\``,
    visible ? `Ejemplos:\n${visible}` : "",
    p.timeLimitMs ? `Tiene casos grandes con límite de ${p.timeLimitMs} ms por caso.` : "",
    `## Solo para ti (NO la muestres)\nComplejidad esperada: ${p.complexity.time}.\n${p.solution}`,
    `## Tarea\n${STAGE_TASK[i.stage]}`,
  ];
  if (i.understanding) parts.push(`## Lo que entendió\n${i.understanding}`);
  if (i.edgeCase) parts.push(`## Caso que podría romperlo\n${i.edgeCase}`);
  if (i.plan) parts.push(`## Su plan\n${i.plan}`);
  if (i.code) parts.push(`## Su código\n${i.code}`);
  if (i.failing)
    parts.push(
      `## El test que falla\nLlamada: ${i.failing.call}\nEsperado: ${i.failing.expected}\n${
        i.failing.error ? `Error: ${i.failing.error}` : `Obtuvo: ${i.failing.got}`
      }`,
    );
  return parts.filter(Boolean).join("\n\n");
}

/** Lo que llega al dojo, sin código colado. */
export function cleanCoach(f: DojoCoachFeedback): DojoCoachFeedback {
  const message = stripCode(f.message);
  const question = f.question ? stripCode(f.question).text : undefined;
  return {
    verdict: f.verdict,
    message:
      message.text ||
      "Tenía una respuesta con código y la quité: aquí no se escribe tu solución. Pídeme la siguiente pista o cuéntame dónde te trabas.",
    question: question || undefined,
  };
}

export async function coach(i: CoachInput): Promise<DojoCoachFeedback> {
  let captured: DojoCoachFeedback | null = null;
  const record = tool(
    "record_coach",
    "Registra tu respuesta para el Dojo. Llámala UNA sola vez.",
    {
      verdict: z.enum(["bien", "casi", "no"]).describe("bien = va bien · casi = falta algo · no = hay un malentendido"),
      message: z.string().max(700).describe("Máximo 4 frases, en español, sin código"),
      question: z.string().max(240).optional().describe("Una pregunta para que piense el siguiente paso"),
    },
    async (args) => {
      captured = args as DojoCoachFeedback;
      return { content: [{ type: "text", text: "ok" }] };
    },
  );
  const server = createSdkMcpServer({ name: "dojo", version: "0.1.0", tools: [record] });
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), TIMEOUT_MS);
  try {
    const q = query({
      prompt: buildCoachUserPrompt(i),
      options: {
        systemPrompt: buildCoachSystemPrompt(),
        model: env.DOJO_MODEL,
        thinking: { type: "disabled" },
        maxTurns: 3,
        settingSources: [],
        env: childEnv(),
        abortController,
        mcpServers: { dojo: server },
        allowedTools: ["mcp__dojo__record_coach"],
        permissionMode: "default",
        canUseTool: async (name, input) =>
          name === "mcp__dojo__record_coach"
            ? { behavior: "allow", updatedInput: input }
            : { behavior: "deny", message: "El dojo solo registra la respuesta." },
      },
    });
    try {
      for await (const message of q) void message;
    } catch (err) {
      if (!captured) throw err;
    }
  } finally {
    clearTimeout(timer);
  }
  if (!captured) throw new Error("el modelo no registró la respuesta");
  return cleanCoach(captured);
}
