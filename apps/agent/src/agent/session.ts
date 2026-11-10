import type { HookCallbackMatcher, HookEvent, Options } from "@anthropic-ai/claude-agent-sdk";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import type { CapturedPrompt, ChatToolStep, HermesTask, RunTokenUsage, SdkAgentConfig, SpendModel } from "@hermes/shared";
import { needsApproval, parseModelUsage, tokensFromApiUsage, toolTarget } from "@hermes/shared";
import { officeWatched, registerOfficeWorker, setOfficeSpend } from "../office/state.js";
import { recordRunSpend } from "../usage.js";
import { requestApproval } from "../office/approvals.js";
import { env } from "../env.js";
import { emit } from "../events.js";
import { notifyMac } from "../notify.js";
import { setPresence } from "../presence.js";
import { supabase } from "../supabase.js";
import { buildBasePromptCaptured, buildTurnContext, withTurnContext, type TurnContext } from "./system-prompt.js";
import { startTrace, type TraceHandle } from "../office/trace.js";
import { checkTool } from "./guardrails.js";
import { PLUGIN_DIR, SKILLS_DIR, recordSkillUse } from "../learning/skills.js";
import { reviewTurnInBackground } from "../learning/review.js";
import { hermesMcpServer, HERMES_TOOL_NAMES, HERMES_TOOL_DEFS } from "./tools.js";
import { linearEnabled } from "../linear.js";
import { ensureCdpChrome, CDP_URL } from "../browser.js";
import { modelIdFor, type Feature } from "./models.js";
import { trackedQuery } from "./tracked-query.js";
import { chatProfile, toolProfileSpec, type ToolProfile } from "./tool-profiles.js";
import { ContextLedger, SnapshotCache, snapshotKey, wrapUserMessage } from "./turn-context.js";
import { skillUseName } from "./skill-use.js";
import { runLiveChatTurn, type LiveChatSpec } from "./chat-sessions.js";
import { CHAT_MAX_TURNS, chatToolDenial } from "./chat-session-policy.js";

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

/** Qué servidores y tools integradas lleva un perfil EN ESTA máquina. */
function profileSpec(profile: ToolProfile) {
  return toolProfileSpec(profile, { linear: linearEnabled(), browser: env.BROWSER_AGENT_ENABLED && resolveChromeMcpBin() !== null });
}

/** Tools que corren sin preguntar (lectura + MCP de Hermes + web + Linear). */
function sdkAllowedTools(profile: ToolProfile): string[] {
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
    ...(profileSpec(profile).mcpServers.includes("linear") ? ["mcp__linear"] : []),
  ];
}

function sdkMcpServers(profile: ToolProfile): NonNullable<Options["mcpServers"]> {
  const names = profileSpec(profile).mcpServers;
  const bin = resolveChromeMcpBin();
  return {
    hermes: hermesMcpServer,
    ...(names.includes("linear") ? { linear: linearMcpServer() } : {}),
    ...(names.includes("chrome-devtools") && bin ? { "chrome-devtools": chromeMcpServer(bin) } : {}),
  };
}

/** Tools que revisa el guardrail (guardrails.ts) dentro de canUseTool. */
const GUARDED_TOOLS = ["Bash", "Write", "Edit", "NotebookEdit"];
const CHROME_PREFIX = "mcp__chrome-devtools__";

/**
 * La configuración de permisos REAL de un perfil (por defecto el de las
 * tareas, que es lo que la Oficina muestra en "Qué tiene este agente"). Sale
 * de las mismas listas que usa la llamada al SDK: no hay una copia a mano que
 * se desactualice.
 */
export function sdkAgentConfig(profile: ToolProfile = "task"): SdkAgentConfig & { hermesTools: { name: string; description: string }[] } {
  return {
    allowedTools: sdkAllowedTools(profile),
    guardedTools: GUARDED_TOOLS,
    checkedPrefixes: [{ prefix: CHROME_PREFIX, note: "canUseTool: garantiza el Chrome CDP dedicado antes de cada uso (si no está, se niega)" }],
    approvalTools: ["Bash"],
    permissionMode: "default",
    mcpServers: profileSpec(profile).mcpServers,
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
 * Hook PostToolUse sobre `Skill`: cada vez que el modelo carga una skill del
 * plugin de Hermes, cuenta un uso. Sin esto recordSkillUse no tenía llamador y
 * el curador archivaba a los 45 días skills que se usaban a diario. Nunca
 * frena el turno: el registro es en segundo plano y un fallo solo se loguea.
 */
const isHermesSkill = (name: string) => /^[a-z0-9-]+$/.test(name) && existsSync(join(SKILLS_DIR, name, "SKILL.md"));
export const SKILL_USE_HOOKS: Partial<Record<HookEvent, HookCallbackMatcher[]>> = {
  PostToolUse: [
    {
      matcher: "Skill",
      hooks: [
        async (input) => {
          const name = input.hook_event_name === "PostToolUse" ? skillUseName(input.tool_input, isHermesSkill) : null;
          if (name) void recordSkillUse(name).catch((err) => console.error("[skills] uso:", String(err).slice(0, 160)));
          return { continue: true };
        },
      ],
    },
  ],
};

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
   * modelo al crearse: cambiar el catálogo después no debe mover en silencio
   * el destino de una tarea vieja. Sin él, el del catálogo para el canal.
   */
  model?: string;
  /**
   * Qué es este turno: el chat de texto, una tarea (/tasks, voz) o una
   * programada. Decide la función del catálogo (modelo y registro de gasto) y
   * las tools. Sin él: tarea si trae taskId, chat si no.
   */
  channel?: "chat" | "task" | "scheduled";
  /** Chat: X-Hermes-Session-Id. Con él la base del prompt se fotografía por sesión y la sesión del CLI queda viva. */
  clientSession?: string;
  /** Chat: quién escribe (X-Hermes-Client). El teléfono carga menos tools. */
  client?: "web" | "phone";
  /** Lo que escribió el usuario, sin notas del canal: con eso se busca el contexto. */
  userText?: string;
  /** Chat: el cliente pidió una conversación NUEVA (X-Hermes-Resume: new). */
  fresh?: boolean;
  onDelta?: (text: string) => void;
  /** Avisa el session id del SDK apenas llega el init (para tabs/resume). */
  onSession?: (sdkSessionId: string) => void;
  /** Avisa cada tool_use del turno (la consola los pinta como pasos). */
  onTool?: (step: ChatToolStep) => void;
  /**
   * Stop del cliente: si el request se cierra (el teléfono tocó Detener o se
   * fue), el turno del SDK se corta de verdad en vez de seguir gastando.
   */
  signal?: AbortSignal;
  /** Tools que NO existen en este turno (p. ej. finanzas desde un teléfono sin huella: finance/guard.ts). */
  disallowedTools?: string[];
}

// toolTarget (qué tocó cada tool) vive en @hermes/shared: lo usa también la Oficina.

export interface RunTurnResult {
  sdkSessionId?: string;
  finalText: string;
  toolCalls: number;
  isError: boolean;
  /**
   * Métricas del result del SDK (costo, tokens, modelos), si llegó. En la
   * sesión viva del chat el costo y los modelos son ACUMULADOS de la sesión
   * (el gasto por turno lo lleva el registro de trackedQuery).
   */
  costUsd?: number;
  usage?: RunTokenUsage;
  models?: SpendModel[];
}

/**
 * Lo que un turno hace con cada mensaje del SDK (texto en streaming, tools,
 * sesión, resultado). Lo comparten el camino de una vuelta y la sesión viva:
 * los dos pintan lo mismo en la consola y en la Oficina.
 */
export class TurnCollector {
  sdkSessionId?: string;
  finalText = "";
  toolCalls = 0;
  isError = false;
  costUsd?: number;
  usage?: RunTokenUsage;
  models?: SpendModel[];
  /** Ya salió algo hacia el cliente (texto o tool): un reintento lo duplicaría. */
  emitted = false;
  private deltasSeen = false;
  private announced?: string;

  constructor(private readonly opts: Pick<RunTurnOptions, "onDelta" | "onSession" | "onTool" | "taskId">) {}

  announce(sdkSessionId: string): void {
    this.sdkSessionId = sdkSessionId;
    if (this.announced === sdkSessionId) return;
    this.announced = sdkSessionId;
    this.opts.onSession?.(sdkSessionId);
    emit({ kind: "session_start", sessionId: sdkSessionId, taskId: this.opts.taskId });
  }

  /** Procesa un mensaje; true = era el `result` que cierra el turno. */
  handle(message: unknown): boolean {
    const m = message as Record<string, any>;
    const taskId = this.opts.taskId;
    if (m.type === "system" && m.session_id) {
      this.sdkSessionId = m.session_id as string;
      if (m.subtype === "init") this.announce(this.sdkSessionId);
      return false;
    }
    // Streaming de texto (partial message events del SDK)
    if (m.type === "stream_event") {
      const ev = m.event;
      if (ev?.type === "content_block_delta" && ev.delta?.type === "text_delta") {
        this.deltasSeen = true;
        this.emitted = true;
        this.opts.onDelta?.(ev.delta.text as string);
      }
      return false;
    }
    if (m.type === "assistant") {
      const content = m.message?.content ?? m.content ?? [];
      for (const block of content) {
        if (block.type === "text" && block.text) {
          this.finalText = block.text as string;
          if (!this.deltasSeen) {
            this.emitted = true;
            this.opts.onDelta?.(block.text as string);
          }
          emit({ kind: "text", taskId, detail: (block.text as string).slice(0, 200) });
        }
        if (block.type === "tool_use") {
          this.toolCalls += 1;
          this.emitted = true;
          setPresence("thinking", `${block.name}`);
          const input = (block.input ?? {}) as Record<string, unknown>;
          emit({ kind: "tool_call", taskId, toolName: block.name as string, detail: JSON.stringify(input).slice(0, 300) });
          this.opts.onTool?.({ name: block.name as string, target: toolTarget(input) });
        }
      }
      return false;
    }
    if (m.type === "user") {
      const content = m.message?.content ?? m.content ?? [];
      for (const block of Array.isArray(content) ? content : []) {
        if (block.type === "tool_result") {
          const raw = typeof block.content === "string" ? block.content : JSON.stringify(block.content ?? "");
          emit({ kind: "tool_result", taskId, detail: raw.slice(0, 200) });
        }
      }
      return false;
    }
    if (m.type === "result") {
      // Gasto real del turno (la Oficina lo suma al tablero cuando es una tarea).
      if (typeof m.total_cost_usd === "number") this.costUsd = m.total_cost_usd;
      this.usage = tokensFromApiUsage(m.usage) ?? undefined;
      this.models = parseModelUsage(m.modelUsage);
      if (m.subtype === "success" && typeof m.result === "string") {
        this.finalText = m.result || this.finalText;
      } else if (m.subtype && m.subtype !== "success") {
        this.isError = true;
      }
      return true;
    }
    return false;
  }

  result(): RunTurnResult {
    const { sdkSessionId, finalText, toolCalls, isError, costUsd, usage, models } = this;
    return { sdkSessionId, finalText, toolCalls, isError, costUsd, usage, models };
  }
}

// ── Prompt: base por sesión + contexto del turno ───────────────────────

interface PromptSnapshot {
  base: CapturedPrompt;
  /** Lo que ya viajó en <contexto-hermes> en esta sesión. */
  ledger: ContextLedger;
}

/** La base de cada sesión de chat, reutilizada 1 h (spec «sesion»). */
const snapshots = new SnapshotCache<PromptSnapshot>();

async function promptSnapshot(opts: RunTurnOptions): Promise<PromptSnapshot> {
  if (!opts.clientSession) return { base: await buildBasePromptCaptured(opts.project), ledger: new ContextLedger() };
  const key = snapshotKey(opts.clientSession, opts.project);
  if (opts.fresh) snapshots.delete(key);
  const hit = snapshots.get(key, Date.now());
  if (hit) return hit;
  const snap = { base: await buildBasePromptCaptured(opts.project), ledger: new ContextLedger() };
  snapshots.set(key, snap, Date.now());
  return snap;
}

function channelOf(opts: RunTurnOptions): "chat" | "task" | "scheduled" {
  return opts.channel ?? (opts.taskId ? "task" : "chat");
}

function profileOf(opts: RunTurnOptions): ToolProfile {
  const ch = channelOf(opts);
  return ch === "chat" ? chatProfile(opts.client) : ch;
}

/**
 * El modelo que corre. Una programada vieja sin modelo congelado (fila con
 * null) corría con el default del CLI (claude-opus-5-5): sigue en el nivel de
 * las tareas para no cambiarle el modelo en silencio.
 */
function modelOf(opts: RunTurnOptions): { feature: Feature; model: string } {
  const ch = channelOf(opts);
  if (opts.model) return { feature: ch, model: opts.model };
  return { feature: ch, model: modelIdFor(ch === "scheduled" ? "task" : ch) };
}

/** Las opciones del SDK de un turno (las mismas para una vuelta y para la sesión viva). */
function turnOptions(opts: RunTurnOptions, p: { systemPrompt: string; model: string; resume?: string; abort?: AbortController; trace: TraceHandle | null }): Options {
  const profile = profileOf(opts);
  const spec = profileSpec(profile);
  return {
    cwd: opts.cwd || env.VAULT_PATH || process.cwd(),
    systemPrompt: p.systemPrompt,
    model: p.model,
    // En la sesión viva del chat el CLI lo cuenta por mensaje (CHAT_MAX_TURNS), igual que aquí.
    maxTurns: CHAT_MAX_TURNS,
    includePartialMessages: true,
    settingSources: [],
    // Sin `env`: trackedQuery pone childEnv() — el hijo NO hereda las llaves
    // del .env (ver child-env.ts). Las tools de Hermes corren en ESTE proceso.
    // Skills aprendidas (~/.hermes-os/plugin): el CLI las descubre del
    // disco y solo carga el cuerpo cuando la description matchea, así
    // el costo en contexto es el índice y no todos los procedimientos.
    plugins: [{ type: "local" as const, path: PLUGIN_DIR }],
    hooks: SKILL_USE_HOOKS,
    ...(spec.builtinTools ? { tools: spec.builtinTools } : {}),
    ...(p.resume ? { resume: p.resume } : {}),
    ...(p.abort ? { abortController: p.abort } : {}),
    mcpServers: sdkMcpServers(profile),
    allowedTools: sdkAllowedTools(profile),
    ...(opts.disallowedTools?.length ? { disallowedTools: opts.disallowedTools } : {}),
    permissionMode: "default",
    canUseTool: async (toolName, input) => {
      const trace = p.trace;
      // Doble seguro: si una tool apagada llegara a pedirse, se niega aquí también.
      if (opts.disallowedTools?.includes(toolName)) return { behavior: "deny", message: "Finanzas está bloqueada en el teléfono." };
      // Chat: nada en segundo plano (un Bash de fondo abre un turno propio del
      // CLI y descuadra la sesión viva). El modelo recibe el motivo y cambia de plan.
      if (channelOf(opts) === "chat") {
        const denial = chatToolDenial(toolName, input as Record<string, unknown>);
        if (denial) return { behavior: "deny", message: denial };
      }
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
        emit({ kind: "error", taskId: opts.taskId, toolName, detail: `GUARDRAIL: ${verdict.reason}` });
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
  };
}

/** HERMES_CHAT_SESSION=oneshot fuerza el camino de una vuelta. Default: sesión viva. */
function liveChatEnabled(): boolean {
  return (process.env.HERMES_CHAT_SESSION || "").toLowerCase() !== "oneshot";
}

export async function runAgentTurn(opts: RunTurnOptions): Promise<RunTurnResult> {
  const snap = await promptSnapshot(opts);
  const ctx: TurnContext = await buildTurnContext({ message: opts.userText ?? opts.prompt, focusSlug: opts.project, ledger: snap.ledger });
  const userMessage = wrapUserMessage(ctx.text, opts.prompt);
  const { feature, model } = modelOf(opts);

  // Chat con sesión de cliente: el proceso del CLI queda vivo entre turnos.
  // "default" = un cliente que no mandó X-Hermes-Session-Id (voz, clientes
  // viejos): varios comparten ese id, así que no se les da un proceso vivo
  // común; van de una vuelta como siempre.
  if (channelOf(opts) === "chat" && opts.clientSession && opts.clientSession !== "default" && liveChatEnabled()) {
    setPresence("working", (opts.userText ?? opts.prompt).slice(0, 120));
    try {
      const collector = new TurnCollector(opts);
      const spec: LiveChatSpec = {
        clientId: opts.clientSession,
        profile: profileOf(opts),
        model,
        project: opts.project,
        disallowedTools: opts.disallowedTools,
        resume: opts.resumeSessionId,
        fresh: Boolean(opts.fresh),
        meta: { project: opts.project },
        options: (resume) => turnOptions(opts, { systemPrompt: snap.base.raw, model, resume, trace: null }),
      };
      const outcome = await runLiveChatTurn(spec, userMessage, collector, opts.signal);
      if (outcome === "ok") return collector.result();
      if (outcome === "aborted") return { ...collector.result(), isError: false };
      // Falló con algo ya enviado al cliente: repetirlo lo duplicaría.
      if (collector.emitted) return { ...collector.result(), isError: true, finalText: collector.finalText || "La sesión se cortó a mitad de la respuesta." };
      console.warn("[chat] la sesión viva falló antes de responder: este turno va por el camino de una vuelta");
      return runOneShot(opts, snap, ctx, userMessage, feature, model, collector.sdkSessionId ?? opts.resumeSessionId);
    } finally {
      setPresence("idle");
    }
  }
  return runOneShot(opts, snap, ctx, userMessage, feature, model, opts.resumeSessionId);
}

/** El camino de una vuelta: un proceso del CLI por turno, con `resume` para el hilo. */
async function runOneShot(
  opts: RunTurnOptions,
  snap: PromptSnapshot,
  ctx: TurnContext,
  userMessage: string,
  feature: Feature,
  model: string,
  resume: string | undefined,
): Promise<RunTurnResult> {
  // Traza completa del loop (solo tareas con personaje en la Oficina; el chat no tiene taskId).
  const trace = opts.taskId ? startTrace({ id: opts.taskId, source: "sdk", title: opts.prompt, project: opts.project || "general" }) : null;
  trace?.setPrompt(withTurnContext(snap.base, ctx));
  let inventoryAsked = false;
  const collector = new TurnCollector(opts);

  setPresence("working", opts.prompt.slice(0, 120));

  const abort = new AbortController();
  if (opts.signal) {
    if (opts.signal.aborted) abort.abort();
    else opts.signal.addEventListener("abort", () => abort.abort(), { once: true });
  }

  try {
    const q = trackedQuery(
      feature,
      { prompt: userMessage, options: turnOptions(opts, { systemPrompt: snap.base.raw, model, resume, abort, trace }) },
      { project: opts.project, ref: opts.taskId },
    );
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
      collector.handle(m);
    }
  } catch (err) {
    // Detenido por el cliente: lo dicho hasta aquí vale y no es un error.
    // (el finally igual corre: presencia y traza se cierran ahí).
    if (abort.signal.aborted) return { ...collector.result(), isError: false };
    // Resume de una sesión SDK que ya no existe (transcript limpiado o CLI
    // actualizado): reintenta UNA vez con sesión fresca. El session_id nuevo
    // se guarda al terminar el turno, así el mapeo stale se auto-repara.
    if (resume && /No conversation found with session ID/i.test(String(err))) {
      setPresence("idle");
      trace?.end();
      return runOneShot(opts, snap, ctx, userMessage, feature, model, undefined);
    }
    collector.isError = true;
    collector.finalText = collector.finalText || `Error ejecutando al agente: ${String(err).slice(0, 500)}`;
    emit({ kind: "error", taskId: opts.taskId, detail: String(err).slice(0, 300) });
    trace?.error(`Error ejecutando al agente: ${String(err)}`);
  } finally {
    setPresence("idle");
    trace?.end();
  }

  return collector.result();
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

export function startTask(prompt: string, opts: { disallowedTools?: string[] } = {}): HermesTask {
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
    const result = await runAgentTurn({ prompt, taskId: task.id, channel: "task", disallowedTools: opts.disallowedTools });
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
