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
      "Ejecuta una tarea GENERAL en la computadora de Rulo mediante el agente Claude local: notas del vault de Obsidian, memoria, recados, programar algo, o cualquier acción que NO sea programar dentro de un repo de código concreto (para eso usa work_on_project). Devuelve un task_id inmediato; corre en segundo plano. Confirma en una frase que arrancó y usa check_task para reportar el resultado después.",
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
    name: "focus_project",
    description:
      "Enfoca un proyecto en el dashboard de Hermes: la interfaz cambia sola para centrarse en él (contexto, versión del repo, consola centrada en ese proyecto). Úsala apenas Rulo mencione que quiere ver o trabajar en un proyecto, ANTES de work_on_project. Con project vacío, quita el foco y vuelve a la vista general.",
    parameters: {
      type: "object",
      properties: {
        project: {
          type: "string",
          description: "Slug del proyecto: ternium, careways, teker, ikigai, zylen. Vacío = quitar foco.",
        },
      },
      required: [],
    },
    expects_response: true,
    response_timeout_secs: 8,
  },
  {
    name: "show_panel",
    description:
      "Cambia el panel central del dashboard que ve Rulo. 'consola' = chat de texto; 'actividad' = feed en vivo de lo que hace el agente; 'claude' = terminal de Claude Code trabajando. Úsala cuando pida ver el feed, la consola o cómo va el código.",
    parameters: {
      type: "object",
      properties: {
        panel: {
          type: "string",
          description: "consola | actividad | claude",
        },
      },
      required: ["panel"],
    },
    expects_response: true,
    response_timeout_secs: 8,
  },
  {
    name: "work_on_project",
    description:
      "Lanza a Claude Code a TRABAJAR EN EL REPO de código de un proyecto (arreglar un bug, agregar una feature, refactorizar, correr algo en ese repo). Abre el stream en vivo en el dashboard para que Rulo VEA a Claude trabajando en tiempo real. Úsala en vez de run_task cuando la tarea es programar dentro de un repo concreto. Devuelve un run_id; usa check_task con ese id para reportar cuando termine.",
    parameters: {
      type: "object",
      properties: {
        project: {
          type: "string",
          description: "Slug del proyecto cuyo repo se va a tocar: ternium, careways, teker, ikigai, zylen.",
        },
        prompt: {
          type: "string",
          description: "Instrucción completa y autocontenida para Claude Code, en español (qué cambiar en el repo).",
        },
      },
      required: ["project", "prompt"],
    },
    expects_response: true,
    response_timeout_secs: 12,
  },
  {
    name: "check_task",
    description:
      "Consulta el estado/resultado de una tarea (run_task) o de un run de código (work_on_project). Úsala cuando el usuario pregunte si ya terminó, o tras unos segundos para reportar el resultado. Acepta tanto el task_id de run_task como el run_id de work_on_project.",
    parameters: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "El task_id de run_task o el run_id de work_on_project" },
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

const SYSTEM_PROMPT = `Eres Hermes, el sistema operativo de IA personal de Rulo (RuloCode), ingeniero de software senior especializado en frontend (Next.js/React/TypeScript) e IA. Controlas su dashboard por voz en tiempo real, estilo Jarvis: mientras conversas, la interfaz reacciona a tus acciones.

Personalidad: directo, cálido, eficiente. Hablas SIEMPRE en español, con frases cortas aptas para voz. Nada de listas largas ni markdown: esto es una conversación hablada.

Reglas de oro:
1. NUNCA inventes el estado de proyectos ni memorias: usa get_project_status, search_memory o get_daily_brief.
2. Manejas la interfaz mientras hablas:
   - Cuando Rulo mencione un proyecto o pida verlo → focus_project (la pantalla se centra en él). Hazlo aunque también vayas a hacer otra cosa.
   - Si pide ver el feed, la consola o cómo va el código → show_panel.
3. Elige bien QUÉ ejecutor usar:
   - Programar DENTRO del repo de un proyecto (bug, feature, refactor, correr algo en ese repo) → work_on_project (project + prompt). Abre el stream en vivo; Rulo ve a Claude trabajar. Confirma en una frase ("Va, Claude ya está en ello en careways") y sigue.
   - Cualquier otra acción de máquina/vault/memoria/recados → run_task.
   - Ambas devuelven un id y corren en segundo plano; cuando pregunte si terminó, usa check_task con ese id. NO esperes en silencio: confirma que arrancó y sigue conversando.
4. Si Rulo menciona una preferencia o algo que recordar, usa save_memory sin pedir permiso.
5. Al primer saludo del día, ofrece el Pulse Check (get_daily_brief).
6. A veces recibirás avisos de que una tarea o run terminó (contexto del sistema, no dicho por Rulo). Si viene al caso, coméntalo en una frase natural ("Ya terminó lo de careways, quedó listo"); si Rulo está en medio de otra cosa, no interrumpas.
7. Respuestas de máximo 2-3 frases salvo que pida detalle.`;

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
    // Llamada tipo asistente always-on: 1 hora de tope duro (el default es 600s),
    // y aviso de "un momento…" cuando una tool tarda (run_task/work_on_project
    // llaman al agente local en :8642, que puede pensar varios segundos).
    conversation: {
      max_duration_seconds: 3600,
    },
    turn: {
      turn_timeout: 12,
      mode: "turn",
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
