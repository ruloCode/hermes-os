/**
 * Un turno de chat contra el modelo local (modo avión).
 *
 * No pasa por el Agent SDK: el system prompt de Claude Code + las tools de
 * Hermes suman ~20k tokens, y un 4B en un M2 los lee a ~150 tok/s (más de dos
 * minutos antes de la primera palabra). Aquí el prompt es corto y ESTABLE
 * dentro del día —llama-server reusa su caché KV y desde el segundo turno solo
 * lee lo nuevo— y el historial lo trae el cliente en `messages`, como en
 * cualquier API de chat: no hay sesión que resumir.
 */
import type { ChatToolStep } from "@hermes/shared";
import { OWNER, soulPromptBlock } from "../owner.js";
import { profilePromptBlock } from "../profile.js";
import { localBaseUrl, localStatus, modelLabel, waitUntilReady } from "./server.js";
import {
  parseArgs,
  splitSse,
  ToolCallAccumulator,
  trimHistory,
  type ChatMsg,
  type ToolCall,
} from "./stream.js";
import { LOCAL_TOOL_DEFS, runLocalTool, STEP_NAME } from "./tools.js";

const MAX_TOOL_ROUNDS = 4;
// ~16k de contexto: ~1,5k el prompt, ~1k las tools, el resto historial + respuesta.
const HISTORY_CHARS = 24_000;

async function systemPrompt(project?: string): Promise<string> {
  const now = new Date();
  const day = now.toLocaleDateString("es-CO", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const parts = [
    `Eres Hermes, el asistente personal de ${OWNER}. Ahora corres como modelo local (${modelLabel()}) en su Mac. Sabes de todo lo general: respóndelo con gusto.`,
    // El 2B se presentaba como el dueño ("¡Hola! Soy Rulo"): se lo dice explícito.
    `Tú eres Hermes; quien te escribe es ${OWNER}. Háblale de tú y nunca digas que eres ${OWNER}.`,
    `Hoy es ${day}.`,
    [
      "Reglas:",
      "- Responde en el idioma del usuario (normalmente español). CORTO: 1 a 5 líneas, al grano, salvo que pida detalle o una lista larga. Sin introducciones ni resúmenes al final.",
      "- Lo que tienes: sus proyectos (list_projects, get_project_status), el código que está en esta Mac (search_code, read_file) y notas (capture_idea).",
      "- Preguntas generales (consejos, explicaciones, ideas, código, redactar): responde normal con lo que sabes, SIN mencionar que no tienes internet.",
      "- Solo si piden algo EN VIVO que no tienes (noticias, clima, precios, correo, calendario, Linear, finanzas) di que en modo avión no lo tienes y pregunta si quiere que lo anotes para hacerlo al aterrizar.",
      "- Para datos de proyectos o código usa las tools ANTES de responder; nunca inventes estados, tareas ni rutas. Si una tool no trae el dato, dilo.",
      "- capture_idea SOLO cuando el usuario dice «anota», «guarda», «apunta» o «recuérdame». Nunca la uses por tu cuenta.",
    ].join("\n"),
    soulPromptBlock(),
    await profilePromptBlock(),
  ];
  if (project) parts.push(`El usuario tiene en foco el proyecto "${project}".`);
  return parts.filter(Boolean).join("\n\n");
}

type WireMsg =
  | { role: "system" | "user" | "assistant"; content: string }
  | {
      role: "assistant";
      content: string;
      tool_calls: { id: string; type: "function"; function: { name: string; arguments: string } }[];
    }
  | { role: "tool"; tool_call_id: string; content: string };

/** Una llamada streaming al modelo: deltas de texto afuera, tool calls de vuelta. */
async function completion(
  messages: WireMsg[],
  onDelta: (t: string) => void,
  signal?: AbortSignal,
  retried = false,
): Promise<{ text: string; calls: ToolCall[] }> {
  const res = await fetch(`${localBaseUrl()}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      model: "hermes-local",
      messages,
      tools: LOCAL_TOOL_DEFS,
      stream: true,
      // Recomendados por Qwen para modo sin razonamiento.
      temperature: 0.7,
      top_p: 0.8,
      top_k: 20,
      // Cada token cuesta ~60 ms en un M2: el tope corta los monólogos.
      max_tokens: 700,
      cache_prompt: true,
    }),
  });
  // 503 = "Loading model": se cayó y está recargando entre la salud y el pedido.
  if (res.status === 503 && !retried && (await waitUntilReady(signal))) {
    return completion(messages, onDelta, signal, true);
  }
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(`El modelo local respondió ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const acc = new ToolCallAccumulator();
  let buffer = "";
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const { data, rest } = splitSse(buffer);
    buffer = rest;
    for (const d of data) {
      if (d === "[DONE]") continue;
      try {
        const delta = JSON.parse(d)?.choices?.[0]?.delta;
        if (typeof delta?.content === "string" && delta.content) {
          text += delta.content;
          onDelta(delta.content);
        }
        acc.add(delta?.tool_calls);
      } catch {
        /* keep-alive o línea parcial */
      }
    }
  }
  return { text, calls: acc.calls() };
}

export interface LocalTurnResult {
  text: string;
  tools: string[];
}

export async function runLocalTurn(opts: {
  messages: ChatMsg[];
  project?: string;
  onDelta: (t: string) => void;
  onTool?: (step: ChatToolStep) => void;
  signal?: AbortSignal;
}): Promise<LocalTurnResult> {
  if (!(await waitUntilReady(opts.signal))) {
    const st = await localStatus();
    throw new Error(st.error ?? "el modelo no terminó de cargar (mira ~/.hermes-os/logs/llama-server.log)");
  }
  const wire: WireMsg[] = [
    { role: "system", content: await systemPrompt(opts.project) },
    ...trimHistory(opts.messages, HISTORY_CHARS).map(
      (m) => ({ role: m.role as "user" | "assistant", content: m.content }),
    ),
  ];
  let text = "";
  const tools: string[] = [];
  const emit = (t: string) => {
    text += t;
    opts.onDelta(t);
  };

  for (let round = 0; ; round++) {
    const res = await completion(wire, emit, opts.signal);
    if (!res.calls.length) break;
    if (round >= MAX_TOOL_ROUNDS) {
      emit("\n\n(Me detuve: demasiadas consultas seguidas. Pregúntame algo más concreto.)");
      break;
    }
    wire.push({
      role: "assistant",
      content: res.text,
      tool_calls: res.calls.map((c) => ({
        id: c.id,
        type: "function",
        function: { name: c.name, arguments: c.arguments },
      })),
    });
    for (const call of res.calls) {
      const args = parseArgs(call.arguments);
      tools.push(call.name);
      const target = String(args.query ?? args.path ?? args.text ?? args.project ?? "").slice(0, 80);
      opts.onTool?.({ name: STEP_NAME[call.name] ?? call.name, target: target || undefined });
      wire.push({ role: "tool", tool_call_id: call.id, content: await runLocalTool(call.name, args) });
    }
    // Separa el texto previo a las tools de la respuesta final.
    if (res.text.trim()) emit("\n\n");
  }
  return { text, tools };
}
