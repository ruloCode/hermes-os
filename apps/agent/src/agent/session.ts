import { query } from "@anthropic-ai/claude-agent-sdk";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import type { ChatToolStep, HermesTask, RunTokenUsage, SdkAgentConfig, SpendModel } from "@hermes/shared";
import { needsApproval, parseModelUsage, tokensFromApiUsage, toolTarget } from "@hermes/shared";
import { officeWatched, registerOfficeWorker, setOfficeSpend } from "../office/state.js";
import { recordRunSpend } from "../usage.js";
import { requestApproval } from "../office/approvals.js";
import { env } from "../env.js";
import { emit } from "../events.js";
import { notifyMac } from "../notify.js";
import { setPresence } from "../presence.js";
import { supabase } from "../supabase.js";
import { buildSystemPromptCaptured } from "./system-prompt.js";
import { startTrace, type TraceHandle } from "../office/trace.js";
import { checkTool } from "./guardrails.js";
import { childEnv } from "./child-env.js";
import { PLUGIN_DIR } from "../learning/skills.js";
import { reviewTurnInBackground } from "../learning/review.js";
import { hermesMcpServer, HERMES_TOOL_NAMES, HERMES_TOOL_DEFS } from "./tools.js";
import { linearEnabled } from "../linear.js";
import { ensureCdpChrome, CDP_URL } from "../browser.js";

/**
 * MCP oficial de Linear (remoto, hosteado por ellos). Auth headless: la misma
 * LINEAR_API_KEY como Bearer — sin flujo OAuth interactivo. Híbrido a
 * propósito: crear issues va por la tool custom create_linear_issue (formato
 * "Copy prompt" garantizado por código); el MCP aporta el resto del catálogo
 * (actualizar estados, comentar, buscar proyectos/ciclos…).
 */
function linearMcpServer() {
  return {
    type: "http" as const,
    url: "https://mcp.linear.app/mcp",
    headers: { Authorization: `Bearer ${env.LINEAR_API_KEY}` },
  };
}

/**
 * MCP de chrome-devtools (navegación web agéntica). Stdio local: el node del
 * agente + el bin del paquete por ruta ABSOLUTA (launchd no tiene npx/PATH).
 * Con --browserUrl el MCP solo se CONECTA al Chrome CDP dedicado que maneja
 * browser.ts (ensureCdpChrome) — nunca lanza Chrome él mismo, así N sesiones
 * SDK concurrentes comparten la misma instancia visible.
 */
const localRequire = createRequire(import.meta.url);
let chromeMcpBin: string | null | undefined;
function resolveChromeMcpBin(): string | null {
  if (chromeMcpBin !== undefined) return chromeMcpBin;
  try {
    const pkgPath = localRequire.resolve("chrome-devtools-mcp/package.json");
    const pkg = localRequire("chrome-devtools-mcp/package.json") as {
      bin?: Record<string, string>;
    };
    const rel = pkg.bin?.["chrome-devtools-mcp"];
    chromeMcpBin = rel ? resolve(dirname(pkgPath), rel) : null;
  } catch {
    chromeMcpBin = null;
  }
  return chromeMcpBin;
}

function chromeMcpServer(bin: string) {
  return {
    type: "stdio" as const,
    command: process.execPath,
    args: [bin, `--browserUrl=${CDP_URL}`],
  };
}

/** Tools que corren sin preguntar (lectura + MCP de Hermes + web + Linear). */
function sdkAllowedTools(): string[] {
  return [
    "Read",
    "Glob",
    "Grep",
    "WebSearch",
    "WebFetch",
    "TodoWrite",
    ...HERMES_TOOL_NAMES,
    // "mcp__linear" pelado = todas las tools del server (regla de permisos
    // por prefijo). Son mutaciones de workspace, no de la máquina.
    ...(linearEnabled() ? ["mcp__linear"] : []),
  ];
}

/** Tools que revisa el guardrail (guardrails.ts) dentro de canUseTool. */
const GUARDED_TOOLS = ["Bash", "Write", "Edit", "NotebookEdit"];
const CHROME_PREFIX = "mcp__chrome-devtools__";

/**
 * La configuración de permisos REAL de las tareas del SDK, para el inventario
 * de la Oficina ("Qué tiene este agente"). Sale de las mismas listas que usa
 * query(): no hay una copia a mano que se desactualice.
 */
export function sdkAgentConfig(): SdkAgentConfig & { hermesTools: { name: string; description: string }[] } {
  return {
    allowedTools: sdkAllowedTools(),
    guardedTools: GUARDED_TOOLS,
    checkedPrefixes: [{ prefix: CHROME_PREFIX, note: "canUseTool: garantiza el Chrome CDP dedicado antes de cada uso (si no está, se niega)" }],
    approvalTools: ["Bash"],
    permissionMode: "default",
    mcpServers: ["hermes", ...(linearEnabled() ? ["linear"] : []), ...(env.BROWSER_AGENT_ENABLED && resolveChromeMcpBin() ? ["chrome-devtools"] : [])],
    hermesTools: HERMES_TOOL_DEFS,
  };
}

/** Pide al CLI las tools de cada MCP (con la descripción que ve el modelo) y las skills; sin bloquear el loop. */
function captureInventory(q: { mcpServerStatus(): Promise<any[]>; supportedCommands(): Promise<any[]> }, trace: TraceHandle) {
  void Promise.all([q.mcpServerStatus().catch(() => []), q.supportedCommands().catch(() => [])])
    .then(([servers, commands]) => {
      trace.setInventory({
        mcp: (servers as any[]).map((sv) => ({
          server: String(sv?.name ?? ""),
          status: String(sv?.status ?? ""),
          tools: Array.isArray(sv?.tools) ? sv.tools.map((t: any) => ({ name: String(t?.name ?? ""), ...(t?.description ? { description: String(t.description) } : {}) })) : [],
        })),
        commands: (commands as any[]).map((c) => ({ name: String(c?.name ?? ""), description: String(c?.description ?? "") })),
      });
    })
    .catch(() => {});
}

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
  /**
   * Modelo de ESTE turno. Lo usan las tareas programadas, que congelan su
   * modelo al crearse: cambiar HERMES_MODEL después no debe mover en silencio
   * el destino de una tarea vieja. Sin él, el default global.
   */
  model?: string;
  onDelta?: (text: string) => void;
  /** Avisa el session id del SDK apenas llega el init (para tabs/resume). */
  onSession?: (sdkSessionId: string) => void;
  /** Avisa cada tool_use del turno (la consola los pinta como pasos). */
  onTool?: (step: ChatToolStep) => void;
}

// toolTarget (qué tocó cada tool) vive en @hermes/shared: lo usa también la Oficina.

export interface RunTurnResult {
  sdkSessionId?: string;
  finalText: string;
  toolCalls: number;
  isError: boolean;
  /** Métricas del result del SDK (costo, tokens, modelos), si llegó. */
  costUsd?: number;
  usage?: RunTokenUsage;
  models?: SpendModel[];
}

export async function runAgentTurn(opts: RunTurnOptions): Promise<RunTurnResult> {
  const captured = await buildSystemPromptCaptured(opts.prompt, opts.project);
  const systemPrompt = captured.raw;
  // Traza completa del loop (solo tareas con personaje en la Oficina; el chat no tiene taskId).
  const trace = opts.taskId ? startTrace({ id: opts.taskId, source: "sdk", title: opts.prompt, project: opts.project || "general" }) : null;
  trace?.setPrompt(captured);
  let inventoryAsked = false;
  let sdkSessionId: string | undefined;
  let finalText = "";
  let toolCalls = 0;
  let isError = false;
  let deltasSeen = false;
  let costUsd: number | undefined;
  let usage: RunTokenUsage | undefined;
  let models: SpendModel[] | undefined;

  setPresence("working", opts.prompt.slice(0, 120));

  try {
    const q = query({
      prompt: opts.prompt,
      options: {
        cwd: opts.cwd || env.VAULT_PATH || process.cwd(),
        systemPrompt,
        model: opts.model || process.env.HERMES_MODEL || undefined,
        maxTurns: 40,
        includePartialMessages: true,
        settingSources: [],
        // Entorno saneado: el hijo NO hereda las llaves del .env (ver
        // child-env.ts). Las tools de Hermes corren en ESTE proceso.
        env: childEnv(),
        // Skills aprendidas (~/.hermes-os/plugin): el CLI las descubre del
        // disco y solo carga el cuerpo cuando la description matchea, así
        // el costo en contexto es el índice y no todos los procedimientos.
        plugins: [{ type: "local" as const, path: PLUGIN_DIR }],
        resume: opts.resumeSessionId,
        mcpServers: {
          hermes: hermesMcpServer,
          ...(linearEnabled() ? { linear: linearMcpServer() } : {}),
          ...(env.BROWSER_AGENT_ENABLED && resolveChromeMcpBin()
            ? { "chrome-devtools": chromeMcpServer(resolveChromeMcpBin()!) }
            : {}),
        },
        allowedTools: sdkAllowedTools(),
        permissionMode: "default",
        canUseTool: async (toolName, input) => {
          // Tools del navegador: NO van en allowedTools a propósito — pasar
          // por aquí garantiza el Chrome CDP dedicado ANTES de cada uso (el
          // MCP solo se conecta; si el Chrome no está, el tool fallaría).
          if (toolName.startsWith(CHROME_PREFIX)) {
            const chrome = await ensureCdpChrome();
            if (!chrome.ok) {
              emit({ kind: "error", taskId: opts.taskId, toolName, detail: chrome.error });
              trace?.permission({ tool: toolName, decision: "denied", by: "chrome", text: chrome.error ?? "Chrome CDP no disponible" });
              return { behavior: "deny", message: chrome.error ?? "Chrome CDP no disponible" };
            }
            return { behavior: "allow", updatedInput: input };
          }
          const verdict = checkTool(toolName, input as Record<string, unknown>);
          if (!verdict.allowed) {
            emit({
              kind: "error",
              taskId: opts.taskId,
              toolName,
              detail: `GUARDRAIL: ${verdict.reason}`,
            });
            trace?.guardrail(toolName, verdict.reason ?? "Bloqueado por guardrail", input);
            return { behavior: "deny", message: verdict.reason ?? "Bloqueado por guardrail" };
          }
          // Un Bash con efectos en una tarea con personaje, y alguien mirando la
          // Oficina: el agente levanta la mano y espera tu decisión. Sin nadie
          // mirando, el guardrail decide como siempre (una tarea por voz no se
          // queda colgada esperando a un humano que no está).
          if (opts.taskId && toolName === "Bash" && officeWatched() && needsApproval(toolName, input as Record<string, unknown>)) {
            const decision = await requestApproval(opts.taskId, toolName, input as Record<string, unknown>).decision;
            if (decision.behavior === "deny") return { behavior: "deny", message: decision.message };
          }
          return { behavior: "allow", updatedInput: input };
        },
      },
    });

    for await (const message of q) {
      const m = message as Record<string, any>;
      // La traza lleva el mensaje entero (sin los deltas parciales: el bloque completo llega después).
      if (trace && m.type !== "stream_event") {
        trace.ingest(m);
        if (!inventoryAsked && m.type === "system" && m.subtype === "init") {
          inventoryAsked = true;
          captureInventory(q, trace);
        }
      }

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
            const input = (block.input ?? {}) as Record<string, unknown>;
            emit({
              kind: "tool_call",
              taskId: opts.taskId,
              toolName: block.name as string,
              detail: JSON.stringify(input).slice(0, 300),
            });
            opts.onTool?.({ name: block.name as string, target: toolTarget(input) });
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
        // Gasto real del turno (la Oficina lo suma al tablero cuando es una tarea).
        if (typeof m.total_cost_usd === "number") costUsd = m.total_cost_usd;
        usage = tokensFromApiUsage(m.usage) ?? undefined;
        models = parseModelUsage(m.modelUsage);
        if (m.subtype === "success" && typeof m.result === "string") {
          finalText = m.result || finalText;
        } else if (m.subtype && m.subtype !== "success") {
          isError = true;
        }
      }
    }
  } catch (err) {
    // Resume de una sesión SDK que ya no existe (transcript limpiado o CLI
    // actualizado): reintenta UNA vez con sesión fresca. El session_id nuevo
    // se guarda al terminar el turno, así el mapeo stale se auto-repara.
    if (opts.resumeSessionId && /No conversation found with session ID/i.test(String(err))) {
      setPresence("idle");
      return runAgentTurn({ ...opts, resumeSessionId: undefined });
    }
    isError = true;
    finalText = finalText || `Error ejecutando al agente: ${String(err).slice(0, 500)}`;
    emit({ kind: "error", taskId: opts.taskId, detail: String(err).slice(0, 300) });
    trace?.error(`Error ejecutando al agente: ${String(err)}`);
  } finally {
    setPresence("idle");
    trace?.end();
  }

  return { sdkSessionId, finalText, toolCalls, isError, costUsd, usage, models };
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
  registerOfficeWorker({ id: task.id, source: "task", title: prompt });
  emit({ kind: "task_start", taskId: task.id, detail: prompt.slice(0, 200) });

  void (async () => {
    const result = await runAgentTurn({ prompt, taskId: task.id });
    task.status = result.isError ? "error" : "done";
    task.result = result.finalText;
    task.toolCalls = result.toolCalls;
    task.finishedAt = new Date().toISOString();
    if (result.isError) task.error = result.finalText;
    // Gasto de la tarea: tarjeta del personaje y tablero de gasto de la Oficina.
    if (result.costUsd !== undefined || result.usage) {
      setOfficeSpend(task.id, { costUsd: result.costUsd, tokens: result.usage, models: result.models?.map((m) => m.model), final: true });
    }
    recordRunSpend({
      ts: task.finishedAt ?? new Date().toISOString(),
      id: task.id,
      source: "task",
      project: "general",
      title: prompt.slice(0, 120),
      costUsd: result.costUsd ?? null,
      tokens: result.usage ?? null,
      models: result.models ?? [],
      status: result.isError ? "error" : "done",
    });
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
    // Las tareas por voz son la mejor fuente de procedimientos: se disparan
    // solas y suelen ser multi-paso. La revisión mira el resultado, no el turno.
    if (!result.isError) {
      reviewTurnInBackground({
        userText: prompt,
        assistantText: result.finalText,
        source: "task",
        sourceRef: task.id,
      });
    }
  })();

  return task;
}

export function getTask(id: string): HermesTask | undefined {
  return tasks.get(id);
}

export function listTasks(): HermesTask[] {
  return [...tasks.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}
