// El coordinador de la cola de la Oficina: le dices qué hay que hacer y lo
// parte en tareas chicas, cada una con un prompt autocontenido para un agente
// nuevo y el proyecto donde corre. PROPONE, no encola: la UI muestra las
// tareas y nada entra a la cola sin tu clic (gastan tokens al correr).
//
// Patrón de english/report.ts: Agent SDK + una tool que captura el resultado.
// Su única superficie es esa tool: sin Bash, sin Read, sin red.

import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { NewQueueItem } from "@hermes/shared";
import { env } from "../env.js";
import { readProjects } from "../vault/projects.js";
import { OWNER } from "../owner.js";

const MODEL = process.env.HERMES_QUEUE_MODEL || "claude-haiku-4-5";
export const PLAN_MAX_TASKS = 6;

export async function planQueue(text: string, project?: string): Promise<{ ok: true; tasks: NewQueueItem[] } | { ok: false; error: string }> {
  const ask = text.trim();
  if (!ask) return { ok: false, error: "dime qué hay que hacer" };
  const projects = (await readProjects().catch(() => [])).filter((p) => p.estado === "activo");
  const slugs = new Set(["general", ...projects.map((p) => p.slug)]);

  let captured: NewQueueItem[] | null = null;
  const propose = tool(
    "propose_tasks",
    "Propone las tareas para la cola. Llámala UNA sola vez con todas.",
    {
      tasks: z
        .array(
          z.object({
            title: z.string().describe("Título corto en imperativo, en español (máx. 80 caracteres)."),
            prompt: z.string().describe("Prompt autocontenido para un agente de Claude Code que NO conoce esta conversación: qué hacer, dónde y cuándo está terminado."),
            project: z.string().describe(`Slug del proyecto donde corre: uno de ${[...slugs].join(", ")}.`),
          }),
        )
        .min(1)
        .max(PLAN_MAX_TASKS),
    },
    async (args) => {
      captured = args.tasks.map((t) => ({
        title: t.title,
        prompt: t.prompt,
        // Un proyecto que no existe no se inventa: va a general.
        project: slugs.has(t.project) ? t.project : (project ?? "general"),
        source: "plan" as const,
      }));
      return { content: [{ type: "text" as const, text: "Propuestas registradas." }] };
    },
  );
  const server = createSdkMcpServer({ name: "cola", version: "0.1.0", tools: [propose] });

  try {
    const q = query({
      prompt: `Pedido de ${OWNER || "el dueño"}${project ? ` (proyecto sugerido: ${project})` : ""}:
"""
${ask.slice(0, 4000)}
"""

Proyectos activos: ${projects.map((p) => `${p.slug} (${p.name})`).join(", ") || "ninguno"}.

Parte el pedido en tareas y llama a propose_tasks.`,
      options: {
        cwd: env.VAULT_PATH || process.cwd(),
        systemPrompt: `Eres el coordinador de la cola de agentes de la Oficina de Hermes. Conviertes un pedido en tareas para agentes de Claude Code que arrancan desde cero, cada uno en su proyecto.

Reglas:
- Entre 1 y ${PLAN_MAX_TASKS} tareas. Si el pedido es una sola cosa, UNA tarea: no lo partas por partirlo.
- Cada tarea se puede hacer sola, sin esperar a otra. Si hay pasos que dependen uno de otro, júntalos en una tarea.
- El prompt es autocontenido: el agente no ve este pedido. Di qué hacer, dónde mirar y cómo saber que terminó.
- Nada destructivo ni irreversible (borrar, publicar, hacer push) a menos que el pedido lo diga con todas sus letras.
- Usa solo slugs de la lista; si no sabes cuál, "general".
- Responde SIEMPRE llamando a propose_tasks una sola vez.`,
        model: MODEL,
        maxTurns: 4,
        settingSources: [],
        mcpServers: { cola: server },
        allowedTools: ["mcp__cola__propose_tasks"],
        permissionMode: "default",
      },
    });
    for await (const message of q) void message;
  } catch (err) {
    // El SDK lanza desde el iterador con resultados de error; si ya propuso, sirve igual.
    if (!captured) return { ok: false, error: `El coordinador no respondió: ${String((err as Error).message ?? err).slice(0, 160)}` };
  }
  if (!captured) return { ok: false, error: "El coordinador no propuso tareas" };
  return { ok: true, tasks: captured };
}
