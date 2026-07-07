/**
 * Setup idempotente del agente de voz "Hermes" en ElevenLabs.
 *
 * 1. Crea/actualiza los CLIENT TOOLS (corren en el browser y llaman a
 *    localhost:8642 — por eso la voz puede ejecutar cosas sin túnel).
 * 2. Crea/actualiza el agente conversacional con la voz "Rulo Voz".
 * 3. Imprime el AGENT_ID para pegarlo en .env.
 *
 * Uso: pnpm setup:elevenlabs
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(import.meta.url), "../../../..");
config({ path: resolve(root, ".env") });

const API = "https://api.elevenlabs.io/v1/convai";
const KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "NoS5MJPorMp1e5EcDXzn"; // Rulo Voz
// LLM router de la voz. Default verificado contra la doc de ElevenLabs (Claude Haiku 4.5,
// el mejor balance velocidad/precisión para voz). Override por env si cambia el enum.
const AGENT_LLM = process.env.ELEVENLABS_AGENT_LLM || "claude-haiku-4-5";
const AGENT_NAME = "Hermes";

if (!KEY) {
  console.error("Falta ELEVENLABS_API_KEY en .env");
  process.exit(1);
}

const headers = { "xi-api-key": KEY, "Content-Type": "application/json" };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, { ...init, headers });
  if (!res.ok) {
    throw new Error(`${init?.method ?? "GET"} ${path} → ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as T;
}

// ── Client tools ───────────────────────────────────────────────────────
interface ToolDef {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
  expects_response: boolean;
  response_timeout_secs?: number;
}

const TOOLS: ToolDef[] = [
  {
    name: "run_task",
    description:
      "Ejecuta una tarea real en la computadora de Rulo mediante el agente Claude local (editar archivos, actualizar notas del vault, correr comandos, programar). Úsala para CUALQUIER acción que toque la máquina o el vault. Devuelve un task_id inmediatamente; la tarea corre en segundo plano. Confirma al usuario que la tarea arrancó y usa check_task para reportar el resultado después.",
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "Instrucción completa y autocontenida para el agente local, en español",
        },
      },
      required: ["prompt"],
    },
    expects_response: true,
    response_timeout_secs: 10,
  },
  {
    name: "check_task",
    description:
      "Consulta el estado/resultado de una tarea lanzada con run_task. Úsala cuando el usuario pregunte si ya terminó, o tras unos segundos para reportar el resultado.",
    parameters: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "El task_id devuelto por run_task" },
      },
      required: ["task_id"],
    },
    expects_response: true,
    response_timeout_secs: 10,
  },
  {
    name: "get_project_status",
    description:
      "Lee el estado REAL de los proyectos de Rulo desde su vault de Obsidian. Úsala siempre que pregunte cómo va un proyecto — nunca inventes el estado.",
    parameters: {
      type: "object",
      properties: {
        project: {
          type: "string",
          description: "Slug del proyecto: ternium, careways, teker, ikigai, zylen. Omitir para todos los activos.",
        },
      },
      required: [],
    },
    expects_response: true,
    response_timeout_secs: 10,
  },
  {
    name: "search_memory",
    description:
      "Busca en la memoria persistente de Hermes (aprendizajes, decisiones, contexto de días anteriores). Úsala cuando Rulo pregunte por algo del pasado.",
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
    expects_response: true,
    response_timeout_secs: 10,
  },
  {
    name: "save_memory",
    description:
      "Guarda una memoria o preferencia que Rulo mencione y valga la pena recordar ('recuerda que...', 'prefiero...').",
    parameters: {
      type: "object",
      properties: {
        content: { type: "string" },
        type: {
          type: "string",
          description: "user | feedback | project | reference | daily | agent",
        },
      },
      required: ["content"],
    },
    expects_response: true,
    response_timeout_secs: 10,
  },
  {
    name: "get_daily_brief",
    description:
      "Devuelve el Pulse Check: resumen del estado de todos los proyectos activos con su próximo paso. Úsala cuando Rulo salude por primera vez en el día o pida un resumen.",
    parameters: { type: "object", properties: {}, required: [] },
    expects_response: true,
    response_timeout_secs: 10,
  },
];

const SYSTEM_PROMPT = `Eres Hermes, el sistema operativo de IA personal de Rulo (RuloCode), ingeniero de software senior especializado en frontend (Next.js/React/TypeScript) e IA.

Personalidad: directo, cálido, eficiente. Hablas SIEMPRE en español, con frases cortas aptas para voz. Nada de listas largas ni markdown: esto es una conversación hablada.

Reglas de oro:
1. NUNCA inventes el estado de proyectos ni memorias: usa get_project_status, search_memory o get_daily_brief.
2. TODO lo que implique tocar su máquina, su vault o ejecutar algo → run_task. Confirma en una frase que la tarea arrancó ("Listo, lo estoy trabajando") y sigue conversando. Cuando pregunte si terminó, usa check_task.
3. Si Rulo menciona una preferencia o algo que recordar, usa save_memory sin pedir permiso.
4. Al primer saludo del día, ofrece el Pulse Check (get_daily_brief).
5. Respuestas de máximo 2-3 frases salvo que pida detalle.`;

const FIRST_MESSAGE = "Hermes en línea. ¿En qué nos enfocamos hoy?";

async function upsertTools(): Promise<string[]> {
  const existing = await api<{ tools: { id: string; tool_config: { name: string } }[] }>("/tools");
  const byName = new Map(existing.tools.map((t) => [t.tool_config.name, t.id]));
  const ids: string[] = [];

  for (const def of TOOLS) {
    const body = JSON.stringify({ tool_config: { type: "client", ...def } });
    const found = byName.get(def.name);
    if (found) {
      await api(`/tools/${found}`, { method: "PATCH", body });
      console.log(`  ↻ tool ${def.name} actualizado (${found})`);
      ids.push(found);
    } else {
      const created = await api<{ id: string }>("/tools", { method: "POST", body });
      console.log(`  + tool ${def.name} creado (${created.id})`);
      ids.push(created.id);
    }
  }
  return ids;
}

async function upsertAgent(toolIds: string[]): Promise<string> {
  const conversationConfig = {
    agent: {
      first_message: FIRST_MESSAGE,
      language: "es",
      prompt: {
        prompt: SYSTEM_PROMPT,
        llm: AGENT_LLM,
        tool_ids: toolIds,
        temperature: 0.4,
      },
    },
    tts: {
      voice_id: VOICE_ID,
      model_id: "eleven_flash_v2_5",
    },
  };

  const list = await api<{ agents: { agent_id: string; name: string }[] }>(
    "/agents?page_size=100",
  );
  const found = list.agents.find((a) => a.name === AGENT_NAME);

  if (found) {
    await api(`/agents/${found.agent_id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: AGENT_NAME, conversation_config: conversationConfig }),
    });
    console.log(`  ↻ agente ${AGENT_NAME} actualizado`);
    return found.agent_id;
  }
  const created = await api<{ agent_id: string }>("/agents/create", {
    method: "POST",
    body: JSON.stringify({ name: AGENT_NAME, conversation_config: conversationConfig }),
  });
  console.log(`  + agente ${AGENT_NAME} creado`);
  return created.agent_id;
}

console.log("⚙️  Configurando client tools…");
const toolIds = await upsertTools();
console.log("⚙️  Configurando agente…");
const agentId = await upsertAgent(toolIds);
console.log(`\n✅ Listo. Agrega esto a tu .env:\n\nNEXT_PUBLIC_ELEVENLABS_AGENT_ID=${agentId}\n`);
