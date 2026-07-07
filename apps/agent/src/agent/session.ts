import { query } from "@anthropic-ai/claude-agent-sdk";
import { randomUUID } from "node:crypto";
import type { HermesTask } from "@hermes/shared";
import { env } from "../env.js";
import { emit } from "../events.js";
import { notifyMac } from "../notify.js";
import { setPresence } from "../presence.js";
import { supabase } from "../supabase.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { checkTool } from "./guardrails.js";
import { hermesMcpServer, HERMES_TOOL_NAMES } from "./tools.js";

/**
 * Corre UN turno agéntico con el Claude Agent SDK.
 *
 * Diseño de permisos:
 * - Las tools seguras (lectura + MCP hermes + web) van en allowedTools.
 * - Bash/Write/Edit NO van en allowedTools: pasan por canUseTool, donde
 *   el guardrail (guardrails.ts) decide. Así ninguna tarea disparada por
 *   voz puede ejecutar algo destructivo sin pasar por el deny-list.
 */
export interface RunTurnOptions {
  prompt: string;
  resumeSessionId?: string;
  taskId?: string;
  /** Slug del proyecto en foco: centra el system prompt en él. */
  project?: string;
  /**
   * Directorio de trabajo de la sesión SDK. Con proyecto en foco es su
   * ruta_local: así el transcript cae en ~/.claude/projects/<repo> y
   * `claude` abierto en ese repo (Cursor) ve la MISMA conversación.
   */
  cwd?: string;
  onDelta?: (text: string) => void;
  /** Avisa el session id del SDK apenas llega el init (para tabs/resume). */
  onSession?: (sdkSessionId: string) => void;
}

export interface RunTurnResult {
  sdkSessionId?: string;
  finalText: string;
  toolCalls: number;
  isError: boolean;
}

export async function runAgentTurn(opts: RunTurnOptions): Promise<RunTurnResult> {
  const systemPrompt = await buildSystemPrompt(opts.prompt, opts.project);
  let sdkSessionId: string | undefined;
  let finalText = "";
  let toolCalls = 0;
  let isError = false;
  let deltasSeen = false;

  setPresence("working", opts.prompt.slice(0, 120));

  try {
    const q = query({
      prompt: opts.prompt,
      options: {
        cwd: opts.cwd || env.VAULT_PATH || process.cwd(),
        systemPrompt,
        model: process.env.HERMES_MODEL || undefined,
        maxTurns: 40,
        includePartialMessages: true,
        settingSources: [],
        resume: opts.resumeSessionId,
        mcpServers: { hermes: hermesMcpServer },
        allowedTools: [
          "Read",
          "Glob",
          "Grep",
          "WebSearch",
          "WebFetch",
          "TodoWrite",
          ...HERMES_TOOL_NAMES,
        ],
        permissionMode: "default",
        canUseTool: async (toolName, input) => {
          const verdict = checkTool(toolName, input as Record<string, unknown>);
          if (!verdict.allowed) {
            emit({
              kind: "error",
              taskId: opts.taskId,
              toolName,
              detail: `GUARDRAIL: ${verdict.reason}`,
            });
            return { behavior: "deny", message: verdict.reason ?? "Bloqueado por guardrail" };
          }
          return { behavior: "allow", updatedInput: input };
        },
      },
    });

    for await (const message of q) {
      const m = message as Record<string, any>;

      if (m.type === "system" && m.session_id) {
        sdkSessionId = m.session_id as string;
        if (m.subtype === "init") {
          opts.onSession?.(sdkSessionId);
          emit({ kind: "session_start", sessionId: sdkSessionId, taskId: opts.taskId });
        }
        continue;
      }

      // Streaming de texto (partial message events del SDK)
      if (m.type === "stream_event") {
        const ev = m.event;
        if (ev?.type === "content_block_delta" && ev.delta?.type === "text_delta") {
          deltasSeen = true;
          opts.onDelta?.(ev.delta.text as string);
        }
        continue;
      }

      if (m.type === "assistant") {
        const content = m.message?.content ?? m.content ?? [];
        for (const block of content) {
          if (block.type === "text" && block.text) {
            finalText = block.text as string;
            if (!deltasSeen) opts.onDelta?.(block.text as string);
            emit({ kind: "text", taskId: opts.taskId, detail: (block.text as string).slice(0, 200) });
          }
          if (block.type === "tool_use") {
            toolCalls += 1;
            setPresence("thinking", `${block.name}`);
            emit({
              kind: "tool_call",
              taskId: opts.taskId,
              toolName: block.name as string,
              detail: JSON.stringify(block.input ?? {}).slice(0, 300),
            });
          }
        }
        continue;
      }

      if (m.type === "user") {
        const content = m.message?.content ?? m.content ?? [];
        for (const block of Array.isArray(content) ? content : []) {
          if (block.type === "tool_result") {
            const raw =
              typeof block.content === "string"
                ? block.content
                : JSON.stringify(block.content ?? "");
            emit({
              kind: "tool_result",
              taskId: opts.taskId,
              detail: raw.slice(0, 200),
            });
          }
        }
        continue;
      }

      if (m.type === "result") {
        if (m.subtype === "success" && typeof m.result === "string") {
          finalText = m.result || finalText;
        } else if (m.subtype && m.subtype !== "success") {
          isError = true;
        }
      }
    }
  } catch (err) {
    isError = true;
    finalText = finalText || `Error ejecutando al agente: ${String(err).slice(0, 500)}`;
    emit({ kind: "error", taskId: opts.taskId, detail: String(err).slice(0, 300) });
  } finally {
    setPresence("idle");
  }

  return { sdkSessionId, finalText, toolCalls, isError };
}

// ── Mapeo sesión-cliente (X-Hermes-Session-Id) → sesión SDK ────────────
const sessionMap = new Map<string, string>();

export async function getSdkSession(clientId: string): Promise<string | undefined> {
  if (sessionMap.has(clientId)) return sessionMap.get(clientId);
  if (supabase) {
    const { data } = await supabase
      .from("sessions")
      .select("sdk_session_id")
      .eq("title", clientId)
      .not("sdk_session_id", "is", null)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data?.sdk_session_id) {
      sessionMap.set(clientId, data.sdk_session_id);
      return data.sdk_session_id;
    }
  }
  return undefined;
}

export async function saveSdkSession(
  clientId: string,
  sdkSessionId: string,
  channel: "text" | "voice" | "task" = "text",
) {
  const existing = sessionMap.get(clientId);
  sessionMap.set(clientId, sdkSessionId);
  if (supabase && existing !== sdkSessionId) {
    await supabase.from("sessions").insert({
      sdk_session_id: sdkSessionId,
      channel,
      title: clientId,
      machine: env.MACHINE_NAME,
    });
  }
}

// ── Registro de tareas async (para run_task por voz) ───────────────────
const tasks = new Map<string, HermesTask>();

export function startTask(prompt: string): HermesTask {
  const task: HermesTask = {
    id: randomUUID().slice(0, 8),
    prompt,
    status: "running",
    startedAt: new Date().toISOString(),
    toolCalls: 0,
  };
  tasks.set(task.id, task);
  emit({ kind: "task_start", taskId: task.id, detail: prompt.slice(0, 200) });

  void (async () => {
    const result = await runAgentTurn({ prompt, taskId: task.id });
    task.status = result.isError ? "error" : "done";
    task.result = result.finalText;
    task.toolCalls = result.toolCalls;
    task.finishedAt = new Date().toISOString();
    if (result.isError) task.error = result.finalText;
    emit({
      kind: "task_done",
      taskId: task.id,
      detail: (result.finalText || "").slice(0, 300),
    });
    notifyMac(
      "tarea",
      result.isError
        ? `❌ falló: ${prompt.slice(0, 80)}`
        : `✅ terminó: ${prompt.slice(0, 80)}`,
    );
  })();

  return task;
}

export function getTask(id: string): HermesTask | undefined {
  return tasks.get(id);
}

export function listTasks(): HermesTask[] {
  return [...tasks.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}
