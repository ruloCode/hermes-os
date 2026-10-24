/**
 * Evaluación de un ejercicio hablado del plan de inglés (patrón gym/analyze.ts):
 * Agent SDK + UNA tool que captura el resultado. A diferencia del gimnasio de
 * articulación (que puntúa cómo dices tu idea), aquí se puntúa EL PATRÓN de la
 * unidad: si los verbos van en pasado, si cada frase tiene sujeto, si la
 * preposición es la correcta… El resto de errores se anota pero pesa poco.
 */
import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { stripWrappingQuotes, type PlanDrill, type PlanDrillResult, type PlanUnit } from "@hermes/shared";
import { childEnv } from "../agent/child-env.js";
import { env } from "../env.js";
import { OWNER, soulSection } from "../owner.js";

const TIMEOUT_MS = 60_000;

export interface DrillInput {
  unit: PlanUnit;
  drill: PlanDrill;
  transcript: string;
  durationSec: number;
  /** Errores reales del patrón (para reconocer recurrencias). */
  realErrors: string[];
  /** Es la prueba de la unidad: se exige más. */
  isTest: boolean;
}

export function buildDrillSystemPrompt(about: string): string {
  return [
    `# Hermes — coach de inglés hablado de ${OWNER}

${OWNER} es hispanohablante y entrena inglés hablado con un plan por unidades: cada unidad ataca UN patrón de error que se le repite en sus clases reales. Te llega el ejercicio, la regla de la unidad y lo que ${OWNER} respondió en voz alta (transcrito por un STT: puede traer errores de transcripción — no los cuentes como suyos; si una palabra rara suena parecida a la correcta, asume la correcta).

## Cómo puntuar (score 0-100)
- 70 % de la nota = el PATRÓN de la unidad: cuántas veces lo necesitó y cuántas lo hizo bien. Un solo error del patrón en una respuesta corta ya baja de 85.
- 20 % = usó las estructuras objetivo (no hace falta usarlas todas, sí la mayoría y bien).
- 10 % = el resto: claridad, que la respuesta tenga sentido y el largo pedido. Errores de otros patrones se anotan pero casi no restan.
- Si respondió en español o con menos de dos frases en inglés: máximo 30.
- Exigente pero justo: 90+ es impecable en el patrón.

## Reglas
- \`targetsUsed\`: SOLO las estructuras objetivo que dijo BIEN, escritas igual que en la lista.
- \`errors\`: hasta 6, PRIMERO los del patrón de la unidad. \`quote\` = lo que dijo, literal y corto; \`correction\` = la versión correcta; \`note_es\` = la regla en español en una línea.
- \`better\`: SU respuesta dicha bien en inglés hablado natural, máximo 70 palabras, completa y decible tal cual: usa SUS ideas y SUS datos; donde le faltó un dato pon uno realista. Nunca corchetes.
- \`tip\`: UNA instrucción en español para el siguiente intento, accionable en 10 segundos.
- Responde SIEMPRE llamando a la tool \`record_drill_result\` UNA sola vez.`,
    about.trim() ? `## Quién es ${OWNER} (datos reales para el «better»)\n${about.trim().slice(0, 1_200)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function buildDrillUserPrompt(i: DrillInput): string {
  return `Unidad: ${i.unit.title} — ${i.unit.subtitle}
Regla:
${i.unit.rule.map((r) => `- ${r}`).join("\n")}
${i.realErrors.length ? `\nErrores REALES de este patrón en sus sesiones: ${i.realErrors.join(" · ")}\n` : ""}
${i.isTest ? "PRUEBA DE LA UNIDAD (aprueba con 80): exige el patrón en TODA la respuesta.\n" : ""}Ejercicio: ${i.drill.situation}
Pregunta: "${i.drill.prompt}"
Estructuras objetivo: ${i.drill.targets.join(" · ")}
Largo esperado: ~${i.drill.targetSec} s

Lo que ${OWNER} respondió (${i.durationSec} s):
"""
${i.transcript}
"""`;
}

export async function evaluateDrill(i: DrillInput): Promise<PlanDrillResult> {
  let captured: PlanDrillResult | null = null;
  const record = tool(
    "record_drill_result",
    "Registra la evaluación del ejercicio. Llámala UNA sola vez.",
    {
      score: z.number().int().min(0).max(100),
      targetsUsed: z.array(z.string()).max(10),
      errors: z
        .array(
          z.object({
            quote: z.string().max(200),
            correction: z.string().max(220),
            note_es: z.string().max(200).optional(),
          }),
        )
        .max(6),
      better: z.string().max(700),
      tip: z.string().max(240),
    },
    async (args) => {
      captured = args as PlanDrillResult;
      return { content: [{ type: "text", text: "ok" }] };
    },
  );
  const server = createSdkMcpServer({ name: "plan", version: "0.1.0", tools: [record] });
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), TIMEOUT_MS);
  try {
    const q = query({
      prompt: buildDrillUserPrompt(i),
      options: {
        systemPrompt: buildDrillSystemPrompt(soulSection("Quién soy")),
        model: env.GYM_MODEL,
        // Sin razonamiento extendido: la nota tiene que llegar con la frase fresca.
        thinking: { type: "disabled" },
        maxTurns: 3,
        settingSources: [],
        env: childEnv(),
        abortController,
        mcpServers: { plan: server },
        allowedTools: ["mcp__plan__record_drill_result"],
        permissionMode: "default",
        canUseTool: async (name, input) =>
          name === "mcp__plan__record_drill_result"
            ? { behavior: "allow", updatedInput: input }
            : { behavior: "deny", message: "El plan solo registra la evaluación." },
      },
    });
    try {
      for await (const message of q) void message;
    } catch (err) {
      // El SDK lanza desde el iterador con un result de error: si la tool ya
      // corrió, la evaluación sirve igual (patrón del ingest de juntas).
      if (!captured) throw err;
    }
  } finally {
    clearTimeout(timer);
  }
  if (!captured) throw new Error("el modelo no registró la evaluación");
  const r = captured as PlanDrillResult;
  // Las estructuras usadas solo cuentan si están en la lista (el modelo a veces parafrasea).
  const targets = new Map(i.drill.targets.map((t) => [t.toLowerCase(), t]));
  return {
    ...r,
    targetsUsed: [...new Set(r.targetsUsed.map((t) => targets.get(t.toLowerCase())).filter((t): t is string => !!t))],
    better: stripWrappingQuotes(r.better),
  };
}
