/**
 * Análisis de una repetición del gimnasio (patrón english/report.ts): Agent
 * SDK + UNA tool que captura el resultado. Nota por hábito citando lo que
 * dijiste, tu respuesta dicha mejor (en el idioma del escenario, sin inventar
 * datos) y un consejo para el siguiente intento.
 */
import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
  articulationRules,
  GYM_HABITS,
  GYM_KIND_LABEL,
  stripWrappingQuotes,
  type GymFeedback,
  type GymHabit,
  type GymRep,
  type GymScenario,
} from "@hermes/shared";
import { childEnv } from "../agent/child-env.js";
import { env } from "../env.js";
import { OWNER, soulSection } from "../owner.js";

const TIMEOUT_MS = 60_000;

export interface AnalyzeInput {
  scenario: GymScenario;
  transcript: string;
  durationSec: number;
  wpm: number;
  fillers: number;
  /** Fragmentos débiles que vio el detector (pista para el modelo). */
  weak: string[];
  /** Intento anterior del mismo escenario hoy (para decir qué mejoró). */
  previous?: GymRep;
}

const score = z.number().int().min(1).max(5);
const note = z.string().max(220);

export function buildGymSystemPrompt(about: string): string {
  return [
    `# Hermes — entrenador de articulación de ${OWNER}

${OWNER} entrena a diario a decir sus ideas con claridad y convicción, en español y en inglés. Te llega un escenario de trabajo y lo que ${OWNER} respondió en voz alta (transcrito por un STT: puede traer errores de transcripción — no los cuentes como suyos).

Puntúa cinco hábitos de 1 a 5 (5 = así lo diría alguien que cree en su idea y lo dice en su mejor día):
${GYM_HABITS.map((h) => `- ${h.key}: ${h.label} — ${h.hint}`).join("\n")}

Escala: 1 = el hábito falla de forma evidente · 3 = correcto pero blando · 5 = impecable. Si un hábito no aplica (no había nada que contradecir, así que no hubo «pero»), dale 5 y dilo en la nota.

## Reglas
- Las notas en ESPAÑOL, una línea cada una, citando entre «» lo que dijo. Nada de generalidades ("podrías ser más claro").
- \`better\`: SU respuesta dicha mejor, en el idioma del escenario, máximo 60 palabras, decible de un aliento: el punto en la primera frase. COMPLETA y lista para decirse tal cual: usa SUS ideas y SUS datos, y donde le faltó un dato concreto pon uno realista y coherente con el escenario ("el viernes", "un 30 %", "unas 200 conversaciones"). NUNCA corchetes ni huecos por llenar.
- \`tip\`: UNA instrucción para el siguiente intento, accionable en 10 segundos ("Empieza por «Propongo…» y deja el contexto para la segunda frase").
- Si hay intento anterior, \`progress\`: qué mejoró y qué no, en una línea, con números de los hábitos.
- Exigente pero justo: un 5 se gana.
- Responde SIEMPRE llamando a la tool \`record_gym_feedback\` UNA sola vez.`,
    articulationRules(OWNER),
    about.trim() ? `## Quién es ${OWNER} (datos reales para el «better»)\n${about.trim().slice(0, 1_200)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function buildGymUserPrompt(i: AnalyzeInput): string {
  const s = i.scenario;
  const prev = i.previous
    ? `\n\nIntento anterior (${i.previous.score}/100):\n"""\n${i.previous.transcript}\n"""\nNotas que recibió: ${GYM_HABITS.map((h) => `${h.key} ${i.previous!.feedback.scores[h.key]}`).join(" · ")}. Consejo que recibió: ${i.previous.feedback.tip}`
    : "";
  return `Escenario (${s.lang === "en" ? "en inglés" : "en español"} · ${GYM_KIND_LABEL[s.kind]} · foco: ${s.focus}):
${s.situation}
${s.prompt}

Lo que ${OWNER} respondió (${i.durationSec} s, ${i.wpm} palabras/min, ${i.fillers} muletillas):
"""
${i.transcript}
"""${i.weak.length ? `\nSeñales débiles detectadas: ${i.weak.map((w) => `«${w}»`).join(", ")}.` : ""}${prev}`;
}

/** Lo que se dice tal cual va sin las comillas con que a veces lo envuelve el modelo. */
export function cleanFeedback(f: GymFeedback): GymFeedback {
  return { ...f, better: stripWrappingQuotes(f.better) };
}

export async function analyzeRep(i: AnalyzeInput): Promise<GymFeedback> {
  let captured: GymFeedback | null = null;
  const habitShape = <T extends z.ZodTypeAny>(t: T) =>
    z.object(Object.fromEntries(GYM_HABITS.map((h) => [h.key, t])) as Record<GymHabit, T>);
  const record = tool(
    "record_gym_feedback",
    "Registra la evaluación de esta repetición. Llámala UNA sola vez.",
    {
      scores: habitShape(score).describe("1-5 por hábito"),
      notes: habitShape(note).describe("Una línea por hábito, en español, citando lo que dijo"),
      better: z.string().max(600).describe("Su respuesta dicha mejor, en el idioma del escenario"),
      tip: z.string().max(240).describe("Una instrucción para el siguiente intento"),
      progress: z.string().max(240).optional().describe("Solo si hubo intento anterior"),
    },
    async (args) => {
      captured = args as GymFeedback;
      return { content: [{ type: "text", text: "ok" }] };
    },
  );
  const server = createSdkMcpServer({ name: "gym", version: "0.1.0", tools: [record] });
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), TIMEOUT_MS);
  try {
    const q = query({
      prompt: buildGymUserPrompt(i),
      options: {
        systemPrompt: buildGymSystemPrompt(soulSection("Quién soy")),
        model: env.GYM_MODEL,
        // Sin razonamiento extendido: la nota tiene que llegar mientras la frase está fresca.
        thinking: { type: "disabled" },
        maxTurns: 3,
        settingSources: [],
        env: childEnv(),
        abortController,
        mcpServers: { gym: server },
        allowedTools: ["mcp__gym__record_gym_feedback"],
        permissionMode: "default",
        canUseTool: async (name, input) =>
          name === "mcp__gym__record_gym_feedback"
            ? { behavior: "allow", updatedInput: input }
            : { behavior: "deny", message: "El gimnasio solo registra la evaluación." },
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
  return cleanFeedback(captured);
}
