// Oficina de agentes: el estado de cada personaje (una sesión viva del Agent
// SDK o un run de `claude -p`) reducido desde el bus de actividad. Puro, sin
// fs ni red: el agente lo corre sobre su bus y los tests con eventos sintéticos.
//
// Regla que ordena todo: los estados son HONESTOS. Un run callado es
// "pensando", un guardrail que niega una tool es "bloqueado" (solo hasta la
// siguiente tool) y "te necesita" existe SOLO mientras hay una solicitud de
// permiso viva en el agente (office-approvals.ts): el run está pausado de verdad
// esperando tu decisión.

import type { AgentActivityEvent } from "./types.js";
import { FAILS_TO_DESPAIR, outputFailed, toolAction, type OfficeAction } from "./office-actions.js";
import { PLAN_TOOL, type ApprovalOutcome, type OfficeApproval, type OfficeMode } from "./office-approvals.js";

export type OfficeWorkerStatus = "starting" | "working" | "thinking" | "blocked" | "needs_you" | "done" | "error";

/** De dónde viene la sesión: define qué stream puede abrirse al hacer clic. */
export type OfficeSource =
  | "run" // claude -p (consola, voz work_on_project, tareas del tracker, Linear)
  | "task" // POST /tasks (run_task por voz)
  | "scheduled"
  | "meeting"
  | "content-edit"
  | "content-chat"
  | "content-gen"
  | "english-report"
  | "other";

export interface OfficeWorker {
  /** taskId del bus (id del run, de la tarea, `content-edit-<pieza>`…). */
  id: string;
  source: OfficeSource;
  /** Slug del proyecto del vault; "general" si la sesión no tiene proyecto. */
  project: string;
  name: string;
  status: OfficeWorkerStatus;
  /** Lo que actúa ahora (última tool); undefined = teclear. */
  action?: OfficeAction;
  task: { name: string; summary: string };
  tool?: { name: string; target: string };
  startedAt: string;
  lastEventAt: string;
  finishedAt?: string;
  lastText?: string;
  toolCalls: number;
  /** Tests/builds fallidos seguidos (≥ FAILS_TO_DESPAIR → action "failing"). */
  failStreak: number;
  machine: string;
  /** Últimas líneas para la pantalla de la laptop. */
  lines: string[];
  /** Algún evento de la sesión fue privado (composición): no sale por el túnel. */
  private?: boolean;
  /** Sesión de Hermes del run (claude -p): hablarle al personaje la continúa. */
  sessionId?: string;
  /** Id del personaje al que este continúa (misma sesión): hereda su escritorio. */
  continues?: string;
  /** Permiso que espera AHORA (status "needs_you"): el run está pausado hasta que decidas. */
  approval?: OfficeApproval;
  /** Modo de permisos REAL de la sesión, tal como lo reporta el CLI (auto, editar, plan, preguntar). */
  mode?: OfficeMode;
}

export interface OfficeProject {
  slug: string;
  name: string;
  estado?: string;
}

/**
 * Lo que viaja por GET /office/events (canal propio: no se mezcla con el bus de
 * actividad, que tiene un búfer corto y alimenta el feed del dashboard).
 */
export type OfficeUpdate =
  | { type: "snapshot"; state: OfficeState }
  | { type: "worker"; worker: OfficeWorker }
  | { type: "removed"; id: string };

export interface OfficeState {
  workers: OfficeWorker[];
  projects: OfficeProject[];
  machine: string;
  ts: string;
}

/** Lo que un punto de arranque sabe de su sesión antes del primer evento. */
export interface OfficeRegistration {
  id: string;
  source: OfficeSource;
  project?: string;
  title?: string;
  machine?: string;
  sessionId?: string;
}

export const GENERAL_PROJECT = "general";
/** Sin eventos durante este tiempo, un personaje activo pasa a "pensando". */
export const THINKING_AFTER_MS = 12_000;
/** Tras terminar, el personaje se queda este tiempo en su escritorio y se va. */
export const GRACE_MS = 180_000;
export const LAPTOP_LINES = 12;
const LINE_MAX = 90;

/**
 * Campo del input que mejor describe QUÉ tocó la tool, en orden de preferencia
 * (Read→file_path, Grep→pattern, WebFetch→url…). Solo extrae el dato; la UI
 * decide el verbo y cómo lo acorta.
 */
export const TARGET_KEYS = [
  "file_path",
  "pattern",
  "url",
  "command",
  "query",
  "slug",
  "title",
  "name",
  "content",
] as const;

export function toolTarget(input: Record<string, unknown>): string {
  for (const key of TARGET_KEYS) {
    const v = input[key];
    if (typeof v === "string" && v.trim()) return v.trim().slice(0, 120);
  }
  return "";
}

/**
 * El `detail` de un tool_call es el input en JSON cortado a 300 caracteres, así
 * que puede llegar truncado. Si no parsea, se rescatan los campos conocidos con
 * una regex (lo que importa: la ruta, el patrón, el comando).
 */
export function parseToolInput(detail: string | undefined): Record<string, unknown> {
  if (!detail) return {};
  try {
    const v = JSON.parse(detail);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    const out: Record<string, unknown> = {};
    for (const key of TARGET_KEYS) {
      const m = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`).exec(detail);
      if (m) {
        try {
          out[key] = JSON.parse(`"${m[1]}"`);
        } catch {
          out[key] = m[1];
        }
      }
    }
    return out;
  }
}

/** "mcp__hermes__search_memory" → "search_memory"; "Read" queda igual. */
export function shortToolName(name: string): string {
  const m = /^mcp__.+?__(.+)$/.exec(name);
  return m ? m[1] : name;
}

/** Una línea legible de la tool: "Read apps/web/src/x.ts". Rutas largas se cortan por la izquierda. */
export function describeTool(name: string, target: string): string {
  const tool = shortToolName(name);
  if (!target) return tool;
  let t = target.replace(/\s+/g, " ");
  const room = LINE_MAX - tool.length - 1;
  if (t.length > room) {
    t = t.includes("/") && !t.includes(" ") ? `…${t.slice(-(room - 1))}` : `${t.slice(0, room - 1)}…`;
  }
  return `${tool} ${t}`;
}

// Palabras que no cierran bien un nombre corto ("Lee el README y" → "Lee el README").
const TRAILING_STOP = new Set([
  "y", "e", "o", "el", "la", "los", "las", "de", "del", "en", "a", "al", "con", "para", "por",
  "que", "un", "una", "su", "sus", "mi", "tu", "the", "and", "of", "to", "in", "for", "a", "an",
]);

/**
 * Nombre del personaje a partir del título o del prompt: sin etiquetas de
 * origen ("claude -p:", "tarea:", "Contexto:"), primera frase, hasta 4
 * palabras, sin conectores al final, ≤ 28 caracteres.
 */
export function nameWorker(seed: string | undefined): string {
  let s = (seed ?? "").replace(/^[❯>\s]+/, "").trim();
  // Etiquetas de origen: "claude -p: …", "tarea: …", "reunión: …".
  for (let i = 0; i < 2; i++) s = s.replace(/^[a-záéíóúñü]+(?: -?[a-z]+)?(?: \([a-z ]+\))?:\s+/i, "");
  s = s.split(/(?<=[.!?¿¡:])\s|\n/)[0]?.replace(/[.!?¿¡:;,]+$/g, "").trim() ?? "";
  const words = s.split(/\s+/).filter(Boolean).slice(0, 4);
  while (words.length > 1 && TRAILING_STOP.has(words[words.length - 1].toLowerCase())) words.pop();
  let name = words.join(" ");
  if (!name) return "Agente";
  name = name[0].toUpperCase() + name.slice(1);
  return name.length > 28 ? `${name.slice(0, 27).trimEnd()}…` : name;
}

/** La fuente por el prefijo del taskId (los que no pasan por registerOfficeWorker). */
export function sourceFromTaskId(id: string): OfficeSource {
  if (id.startsWith("content-edit-")) return "content-edit";
  if (id.startsWith("content-chat-")) return "content-chat";
  if (id.startsWith("content-gen-") || id.startsWith("content-variants-")) return "content-gen";
  if (id.startsWith("english-report-")) return "english-report";
  if (id.startsWith("composicion-")) return "other";
  return "task";
}

/** Quita el markdown que el modelo mete en su texto (**negritas**, `código`, # títulos). */
export function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "");
}

function oneLine(text: string, max = LINE_MAX): string {
  const t = stripMarkdown(text).replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function pushLine(w: OfficeWorker, line: string) {
  if (!line) return;
  w.lines.push(line);
  if (w.lines.length > LAPTOP_LINES) w.lines.splice(0, w.lines.length - LAPTOP_LINES);
}

function isTerminal(s: OfficeWorkerStatus): boolean {
  return s === "done" || s === "error";
}

function newWorker(id: string, at: string, machine: string): OfficeWorker {
  return {
    id,
    source: sourceFromTaskId(id),
    project: GENERAL_PROJECT,
    name: "Agente",
    status: "starting",
    task: { name: "Agente", summary: "" },
    startedAt: at,
    lastEventAt: at,
    toolCalls: 0,
    failStreak: 0,
    machine,
    lines: [],
  };
}

function setName(w: OfficeWorker, seed: string | undefined) {
  const name = nameWorker(seed);
  if (name === "Agente" && w.name !== "Agente") return;
  w.name = name;
  w.task.name = name;
}

/**
 * Registra lo que sabe el punto de arranque (proyecto, título, sesión). Crea o
 * completa el personaje. Si otro personaje tenía la MISMA sesión (una
 * conversación que continúa), este lo reemplaza: se marca `continues` para que
 * herede el escritorio y el viejo sale del mapa (`replaced`).
 */
export function registerWorker(
  workers: Map<string, OfficeWorker>,
  reg: OfficeRegistration,
  now = Date.now(),
): OfficeWorker & { replaced?: string } {
  const at = new Date(now).toISOString();
  // Un id terminado que vuelve a arrancar (una programada re-corre dentro de la
  // gracia) es una sesión nueva: se reemplaza, no se revive.
  const prev = workers.get(reg.id);
  const w = prev && !isTerminal(prev.status) ? prev : newWorker(reg.id, at, reg.machine ?? "");
  w.source = reg.source;
  if (reg.project) w.project = reg.project;
  if (reg.machine) w.machine = reg.machine;
  if (reg.title) {
    setName(w, reg.title);
    if (!w.lines.length) pushLine(w, `❯ ${oneLine(reg.title.replace(/^❯\s*/, ""))}`);
  }
  let replaced: string | undefined;
  if (reg.sessionId) {
    w.sessionId = reg.sessionId;
    for (const [id, other] of workers) {
      if (id === reg.id || other.sessionId !== reg.sessionId) continue;
      // La conversación sigue: mismo proyecto y mismo nombre, nuevo run.
      w.continues = id;
      w.project = other.project;
      w.name = other.name;
      w.task.name = other.name;
      workers.delete(id);
      replaced = id;
    }
  }
  workers.set(reg.id, w);
  return replaced ? Object.assign(w, { replaced }) : w;
}

/** Eventos que pueden hacer nacer un personaje (los de cierre solo actualizan). */
const BIRTH = new Set<AgentActivityEvent["kind"]>(["task_start", "session_start", "tool_call", "text", "scheduled"]);

/**
 * Aplica un evento del bus. Devuelve el personaje que cambió (el mismo objeto
 * del mapa) o null si el evento no toca la oficina.
 */
export function reduceOfficeEvent(
  workers: Map<string, OfficeWorker>,
  ev: AgentActivityEvent,
  now = Date.parse(ev.ts) || Date.now(),
): OfficeWorker | null {
  if (!ev.taskId) return null;
  const at = new Date(now).toISOString();
  let w = workers.get(ev.taskId);
  const restart = ev.kind === "scheduled" && ev.detail?.startsWith("▶");
  if (w && restart && isTerminal(w.status)) w = undefined;
  if (!w) {
    if (!BIRTH.has(ev.kind)) return null;
    if (ev.kind === "scheduled" && !ev.detail?.startsWith("▶")) return null;
    w = newWorker(ev.taskId, at, ev.machine ?? "");
    if (ev.kind === "scheduled") w.source = "scheduled";
    workers.set(ev.taskId, w);
  }
  if (ev.private) w.private = true;
  if (ev.machine && !w.machine) w.machine = ev.machine;
  w.lastEventAt = at;

  switch (ev.kind) {
    case "task_start":
      // Una conversación que continúa conserva el nombre de su personaje.
      if (!w.continues) setName(w, ev.detail);
      if (!isTerminal(w.status)) w.status = "starting";
      return w;
    case "session_start":
      if (w.status === "starting" || w.status === "thinking") w.status = "working";
      return w;
    case "scheduled": {
      const d = ev.detail ?? "";
      if (d.startsWith("▶")) {
        setName(w, d.slice(1));
        if (!isTerminal(w.status)) w.status = "starting";
      } else if (d.startsWith("✓")) finish(w, "done", at, d.slice(1).trim());
      else if (d.startsWith("✕")) finish(w, "error", at, d.slice(1).trim());
      return w;
    }
    case "tool_call": {
      if (isTerminal(w.status)) return w;
      const name = ev.toolName ?? "tool";
      const input = parseToolInput(ev.detail);
      const target = toolTarget(input);
      w.status = w.approval ? "needs_you" : "working";
      w.toolCalls += 1;
      w.tool = { name, target };
      const act = toolAction(name, input);
      w.action = w.failStreak >= FAILS_TO_DESPAIR && act === "test" ? "failing" : act;
      if (!w.approval) w.task.summary = describeTool(name, target);
      pushLine(w, `⚙ ${describeTool(name, target)}`);
      return w;
    }
    case "tool_result": {
      // El modo Auto no pregunta: lo que su clasificador juzga riesgoso lo niega
      // solo. Eso se ve como bloqueado, con el motivo que dio.
      const autoDenied = ev.detail ? AUTO_DENIED.exec(ev.detail) : null;
      if (autoDenied && !isTerminal(w.status)) {
        const reason = autoDenied[1] ? `: ${autoDenied[1]}` : "";
        w.status = "blocked";
        w.task.summary = `El modo Auto lo negó${reason}`;
        pushLine(w, `✗ el modo Auto lo negó${reason}`);
        return w;
      }
      if (ev.detail) pushLine(w, `↩ ${oneLine(ev.detail, LINE_MAX - 2)}`);
      if (w.tool && toolAction(w.tool.name, { command: w.tool.target }) === "test") {
        w.failStreak = ev.detail && outputFailed(ev.detail) ? w.failStreak + 1 : 0;
        if (w.failStreak >= FAILS_TO_DESPAIR && !isTerminal(w.status)) w.action = "failing";
      }
      return w;
    }
    case "text": {
      if (!ev.detail) return w;
      const line = oneLine(ev.detail.split("\n").find((l) => l.trim()) ?? ev.detail);
      w.lastText = ev.detail.slice(0, 300);
      if (!isTerminal(w.status) && !w.approval) {
        w.status = "working";
        w.task.summary = line;
      }
      pushLine(w, line);
      return w;
    }
    case "error": {
      if (isTerminal(w.status)) return w;
      const tool = ev.toolName ?? "";
      // Una tool negada (guardrail, Chrome CDP caído): el run sigue vivo.
      if ((tool && !tool.startsWith("claude(")) || ev.detail?.startsWith("GUARDRAIL")) {
        w.status = "blocked";
        w.task.summary = oneLine(ev.detail ?? "tool negada");
        pushLine(w, `✗ ${oneLine(ev.detail ?? "tool negada", LINE_MAX - 2)}`);
        return w;
      }
      finish(w, "error", at, ev.detail);
      return w;
    }
    case "task_done":
      // startTask emite task_done también cuando falló: si ya hubo error, se queda en error.
      if (w.status === "error") {
        if (ev.detail) w.lastText = ev.detail.slice(0, 300);
        return w;
      }
      finish(w, "done", at, ev.detail);
      return w;
    default:
      return w;
  }
}

function finish(w: OfficeWorker, status: "done" | "error", at: string, detail?: string) {
  w.status = status;
  w.finishedAt = at;
  w.action = undefined;
  w.approval = undefined;
  if (detail) {
    w.lastText = detail.slice(0, 300);
    w.task.summary = oneLine(detail);
  }
  pushLine(w, `${status === "done" ? "✓" : "✗"} ${oneLine(detail || (status === "done" ? "terminado" : "falló"), LINE_MAX - 2)}`);
}

// "…denied by the Claude Code auto mode classifier. Reason: [Data Exfiltration]…"
const AUTO_DENIED = /denied by the Claude Code auto mode classifier\.?(?:\s*Reason:\s*\[([^\]]+)\])?/i;

const OUTCOME_LINE: Record<ApprovalOutcome, string> = {
  allowed: "✓ aprobado por ti",
  denied: "✗ negado por ti",
  "plan-changes": "↺ pediste cambios al plan",
  timeout: "✗ nadie respondió: se negó sola",
  gone: "✗ la solicitud se cerró",
};

/**
 * Abre o cierra la solicitud de permiso de un personaje. Con `approval` levanta
 * la mano (status "needs_you"); con null la baja y vuelve a trabajar, dejando en
 * la laptop cómo se decidió. Devuelve el personaje o null si ya no existe.
 */
export function setWorkerApproval(
  workers: Map<string, OfficeWorker>,
  id: string,
  approval: OfficeApproval | null,
  outcome: ApprovalOutcome = "allowed",
  now = Date.now(),
): OfficeWorker | null {
  const w = workers.get(id);
  if (!w || isTerminal(w.status)) return null;
  w.lastEventAt = new Date(now).toISOString();
  if (approval) {
    w.approval = approval;
    w.status = "needs_you";
    w.task.summary = approval.tool === PLAN_TOOL ? `Propone un plan: ${approval.summary.replace(/^Plan: /, "")}` : `Pide permiso: ${approval.summary}`;
    pushLine(w, `✋ ${oneLine(approval.summary, LINE_MAX - 2)}`);
    return w;
  }
  if (!w.approval) return w;
  w.approval = undefined;
  if (w.status === "needs_you") w.status = "working";
  w.task.summary = OUTCOME_LINE[outcome].slice(2);
  pushLine(w, OUTCOME_LINE[outcome]);
  return w;
}

/** El CLI reportó el modo de la sesión (al arrancar o al cambiar, p. ej. plan aprobado → auto). */
export function setWorkerMode(workers: Map<string, OfficeWorker>, id: string, mode: OfficeMode | undefined): OfficeWorker | null {
  const w = workers.get(id);
  if (!w || !mode || w.mode === mode) return null;
  w.mode = mode;
  return w;
}

/**
 * Cambios que solo dependen del reloj: un personaje activo sin eventos pasa a
 * "pensando" y uno terminado se va tras la gracia.
 */
export function tickOffice(
  workers: Map<string, OfficeWorker>,
  now = Date.now(),
): { changed: OfficeWorker[]; removed: string[] } {
  const changed: OfficeWorker[] = [];
  const removed: string[] = [];
  for (const [id, w] of workers) {
    if (isTerminal(w.status)) {
      const end = Date.parse(w.finishedAt ?? w.lastEventAt);
      if (now - end >= GRACE_MS) {
        workers.delete(id);
        removed.push(id);
      }
      continue;
    }
    if ((w.status === "working" || w.status === "starting") && now - Date.parse(w.lastEventAt) >= THINKING_AFTER_MS) {
      w.status = "thinking";
      changed.push(w);
    }
  }
  return { changed, removed };
}

/** Conteos para el HUD (solo lo que hay). */
export function officeCounts(workers: Iterable<OfficeWorker>): Record<OfficeWorkerStatus, number> {
  const out: Record<OfficeWorkerStatus, number> = { starting: 0, working: 0, thinking: 0, blocked: 0, needs_you: 0, done: 0, error: 0 };
  for (const w of workers) out[w.status] += 1;
  return out;
}
