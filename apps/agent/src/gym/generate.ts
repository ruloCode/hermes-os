/**
 * Temas nuevos para el gimnasio: Hermes escribe escenarios de tecnología, IA
 * e ingeniería de agentes, con su respuesta de referencia, usando quién eres
 * (SOUL "Quién soy") y tus proyectos activos del vault. Agent SDK + UNA tool
 * (patrón analyze.ts); lo que devuelve se valida con `sanitizeGenerated`.
 *
 * Corre en SEGUNDO PLANO para tener la próxima ronda lista (`ensurePool`):
 * pedir "otra ronda" es instantáneo mientras haya temas preparados.
 */
import { randomUUID } from "node:crypto";
import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
  articulationRules,
  detectWeakPhrases,
  GYM_HABITS,
  GYM_KIND_LABEL,
  GYM_PLAN_ORDER,
  guessLang,
  sanitizeGenerated,
  topicsFor,
  type GeneratedScenarioDraft,
  type GymScenario,
} from "@hermes/shared";
import { childEnv } from "../agent/child-env.js";
import { env } from "../env.js";
import { OWNER, soulSection } from "../owner.js";
import { readProjects } from "../vault/projects.js";
import { todayBogota } from "../dates.js";
import { generatedBatches, generatedPool, ownerNames, readGenerated, saveGenerated } from "./store.js";

const TIMEOUT_MS = 90_000;
/** Temas preparados que se mantienen de reserva (una ronda = 4). */
const POOL_TARGET = 4;
/** Prompts recientes que se le muestran al modelo para que no los repita. */
const AVOID_RECENT = 40;

export function buildGenerateSystemPrompt(): string {
  return [
    `# Hermes — escritor de ejercicios de articulación

${OWNER} entrena a diario a decir sus ideas con el punto primero y con convicción, en español y en inglés. Escribes escenarios de práctica sobre TECNOLOGÍA, INTELIGENCIA ARTIFICIAL e INGENIERÍA DE AGENTES — su terreno: construye agentes de IA para empresas y crea contenido sobre eso.

Cada escenario:
- \`lang\`: "es" o "en" (te dicen el orden exacto). TODO el escenario va en ese idioma: situación, lo que le dicen, pasos y respuesta.
- \`kind\`: uno de ${Object.keys(GYM_KIND_LABEL).join(" · ")}.
- \`situation\`: 1-2 frases con quién, dónde y qué está en juego, en SEGUNDA persona: le hablas a quien va a practicar ("Presentas a un CTO escéptico el agente que construiste…" · "You're on a call with…"). Nunca su nombre ni "él": se lee como si le pasara a otro. Situaciones VARIADAS: reunión con un cliente, su equipo, una entrevista de trabajo, una charla o meetup, grabando un video para redes, un CTO escéptico, una gerente sin perfil técnico, un inversionista, un colega que no está de acuerdo.
- \`prompt\`: lo que le acaban de decir, entre comillas, o la consigna. Concreto y con tensión (una objeción, una pregunta difícil, un "¿y eso para qué?").
- \`focus\`: el hábito que más pone a prueba: ${GYM_HABITS.map((h) => h.key).join(" · ")}.
- \`targetSec\`: 25-45.
- \`steps\`: 2-4 pasos cortos (máx. 6 palabras) con la forma de una buena respuesta.
- \`example\`: una respuesta modelo de 30-60 palabras que sigue esos pasos, técnicamente correcta, COMPLETA y lista para decirse tal cual: con cifras, nombres, plazos y ejemplos concretos y realistas ("bajamos el costo un 40 %", "el viernes", "300 conversaciones"). NUNCA corchetes ni huecos por llenar.

## Reglas
- Cada escenario de la tanda trata un TEMA distinto (te dan los temas) y un \`kind\` distinto.
- Nada de repetir situaciones de la lista "ya salieron".
- Técnicamente correcto: si no estás seguro de un dato, no lo pongas.
- Responde SIEMPRE llamando a la tool \`record_scenarios\` UNA sola vez.`,
    articulationRules(OWNER),
  ].join("\n\n");
}

export function buildGenerateUserPrompt(p: {
  topics: string[];
  about: string;
  projects: string[];
  avoid: string[];
}): string {
  return [
    `Escribe ${p.topics.length} escenarios, en este orden de idioma: ${GYM_PLAN_ORDER.slice(0, p.topics.length).join(", ")}.`,
    `Temas (uno por escenario, en este orden):\n${p.topics.map((t, i) => `${i + 1}. ${t}`).join("\n")}`,
    p.about.trim() ? `Quién es ${OWNER}:\n${p.about.trim().slice(0, 1_000)}` : "",
    p.projects.length
      ? `Proyectos en los que trabaja hoy (úsalos como contexto de alguna situación si encaja; nunca inventes datos de ellos):\n${p.projects.map((x) => `- ${x}`).join("\n")}`
      : "",
    p.avoid.length ? `Ya salieron (no repitas estas situaciones):\n${p.avoid.map((x) => `- ${x}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Genera una tanda (2 es + 2 en) y la guarda. Devuelve las que pasaron la validación. */
export async function generateBatch(): Promise<GymScenario[]> {
  const [batch, generated, projects] = await Promise.all([
    generatedBatches(),
    readGenerated(),
    readProjects().catch(() => []),
  ]);
  const topics = topicsFor(batch, GYM_PLAN_ORDER.length);
  let drafts: GeneratedScenarioDraft[] | null = null;
  const record = tool(
    "record_scenarios",
    "Registra los escenarios de práctica. Llámala UNA sola vez.",
    {
      scenarios: z
        .array(
          z.object({
            lang: z.enum(["es", "en"]),
            kind: z.string(),
            situation: z.string(),
            prompt: z.string(),
            focus: z.string(),
            targetSec: z.number(),
            steps: z.array(z.string()),
            example: z.string(),
          }),
        )
        .min(1)
        .max(6),
    },
    async (args) => {
      drafts = args.scenarios;
      return { content: [{ type: "text", text: "ok" }] };
    },
  );
  const server = createSdkMcpServer({ name: "gymgen", version: "0.1.0", tools: [record] });
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), TIMEOUT_MS);
  try {
    const q = query({
      prompt: buildGenerateUserPrompt({
        topics,
        about: soulSection("Quién soy"),
        projects: projects
          .filter((p) => p.estado === "activo")
          .slice(0, 10)
          .map((p) => `${p.name}${p.estado_actual ? ` — ${p.estado_actual.replace(/\s+/g, " ").slice(0, 140)}` : ""}`),
        avoid: generated.slice(-AVOID_RECENT).map((x) => x.prompt),
      }),
      options: {
        systemPrompt: buildGenerateSystemPrompt(),
        model: env.GYM_MODEL,
        thinking: { type: "disabled" },
        maxTurns: 3,
        settingSources: [],
        env: childEnv(),
        abortController,
        mcpServers: { gymgen: server },
        allowedTools: ["mcp__gymgen__record_scenarios"],
        permissionMode: "default",
        canUseTool: async (name, input) =>
          name === "mcp__gymgen__record_scenarios"
            ? { behavior: "allow", updatedInput: input }
            : { behavior: "deny", message: "Solo registras escenarios." },
      },
    });
    try {
      for await (const message of q) void message;
    } catch (err) {
      if (!drafts) throw err;
    }
  } finally {
    clearTimeout(timer);
  }
  if (!drafts) throw new Error("el modelo no registró escenarios");
  const clean = sanitizeGenerated(
    drafts,
    () => `gen-${randomUUID().slice(0, 8)}`,
    (t) => detectWeakPhrases(t),
    (t) => guessLang(t),
    ownerNames(),
  );
  await saveGenerated(clean);
  console.log(`[gym] tanda ${batch}: ${clean.length}/${(drafts as unknown[]).length} escenarios válidos (${topics.join(" · ").slice(0, 120)})`);
  return clean;
}

let inFlight: Promise<GymScenario[]> | null = null;

/** Una sola generación a la vez: quien llega durante una, espera esa misma. */
export function generateOnce(): Promise<GymScenario[]> {
  inFlight ??= generateBatch().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

export function generating(): boolean {
  return inFlight != null;
}

/** En segundo plano: si quedan menos de una ronda de temas nuevos, prepara otra tanda. */
export function ensurePool(): void {
  if (inFlight) return;
  void generatedPool(todayBogota())
    .then((pool) => {
      const es = pool.filter((x) => x.lang === "es").length;
      const en = pool.filter((x) => x.lang === "en").length;
      if (es >= POOL_TARGET / 2 && en >= POOL_TARGET / 2) return;
      return generateOnce();
    })
    .catch((err) => console.error("[gym] generar temas:", String(err).slice(0, 200)));
}
