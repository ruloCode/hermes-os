// Tipos compartidos entre el agent server (apps/agent) y el dashboard (apps/web).

export type MemoryType =
  | "user"
  | "feedback"
  | "project"
  | "reference"
  | "daily"
  | "agent";

export interface Memory {
  id: string;
  type: MemoryType;
  content: string;
  summary: string | null;
  project_slug: string | null;
  tags: string[];
  importance: number;
  source: string;
  machine: string | null;
  created_at: string;
}

export interface ProjectStatus {
  slug: string;
  name: string;
  estado: string;
  rama?: string;
  ruta_local?: string;
  estado_actual: string;
  tareas_pendientes: string[];
  actualizado?: string;
}

/** Resumen de un chat archivado de la consola (historial de chats). */
export interface ChatSummary {
  id: string;
  /** primer mensaje del usuario, recortado (título del chat). */
  title: string;
  /** fecha ISO del último mensaje. */
  ts: string;
  /** cantidad de mensajes. */
  messages: number;
}

// ── Sesiones de la consola leídas DIRECTO de ~/.claude/projects ────────
// (la misma fuente que ve `claude` abierto en Cursor dentro del repo)

/** Mensaje de texto de una sesión (user/assistant, sin tools ni thinking). */
export interface ChatSessionMessage {
  role: "user" | "assistant";
  content: string;
}

/** Resumen de una sesión de Claude para el historial/tabs de la consola. */
export interface ChatSessionSummary {
  /** uuid de la sesión (= nombre del .jsonl; sirve para resume). */
  id: string;
  title: string;
  /** última actividad (ISO, del mtime del archivo). */
  updatedAt: string;
  /** nº de mensajes de texto user+assistant. */
  messages: number;
}

/** Detalle de una sesión: sus mensajes de texto en orden. */
export interface ChatSessionDetail extends ChatSessionSummary {
  transcript: ChatSessionMessage[];
}

/** Una skill del proyecto, leída de .claude/skills/<name>/SKILL.md. */
export interface ProjectSkill {
  name: string;
  description: string;
}

/** Un server MCP declarado en el .mcp.json del proyecto. */
export interface ProjectMcpServer {
  name: string;
  /** stdio | http | sse | unknown — inferido de la config. */
  kind: string;
  /** command o url resumidos, como pista de qué es. */
  detail?: string;
  /** ¿habilitado explícitamente en settings? (undefined = sin dato). */
  enabled?: boolean;
}

/** Estado git real del repo local del proyecto (panel Versión del dashboard). */
export interface ProjectGit {
  /** rama actual (HEAD). */
  rama: string;
  /** hash corto del último commit. */
  commit: string;
  /** primera línea del mensaje del último commit (título). */
  mensaje: string;
  /** cuerpo del mensaje del commit (descripción); "" si no tiene. */
  descripcion: string;
  /** fecha del último commit (epoch ms). */
  commitAt: number;
  /** archivos con cambios sin commitear (git status --porcelain). */
  archivosCambiados: number;
}

/**
 * Contexto operativo de un proyecto: qué skills, MCP, herramientas y comandos
 * tiene su repo local (leído de ruta_local/.claude + .mcp.json). Lo consume el
 * panel de contexto del dashboard cuando se enfoca un proyecto.
 */
export interface ProjectContext {
  slug: string;
  ruta_local: string | null;
  /** ¿se pudo leer el repo local? (la ruta existe). */
  found: boolean;
  rama?: string;
  /** estado git del repo; null si la ruta no es un repo git. */
  git?: ProjectGit | null;
  hasClaudeMd: boolean;
  skills: ProjectSkill[];
  mcpServers: ProjectMcpServer[];
  /** permissions.allow (merge de settings.json + settings.local.json). */
  allowTools: string[];
  denyTools: string[];
  /** slash-commands en .claude/commands. */
  commands: string[];
}

/** Una línea del transcript de una corrida `claude -p` (stream-json → HUD). */
export interface ClaudeSessionLine {
  t: number;
  kind: string;
  text: string;
}

/** Campos comunes de una sesión de Claude Code (CLI) persistida por proyecto. */
export interface ClaudeSessionMeta {
  /** Id estable de la sesión (uuid, = --session-id del CLI). */
  id: string;
  projectSlug: string;
  title: string;
  model: string;
  status: "running" | "done" | "error";
  createdAt: string;
  updatedAt: string;
}

/** Resumen para la lista de sesiones (con conteo de líneas del transcript). */
export interface ClaudeSessionSummary extends ClaudeSessionMeta {
  lineCount: number;
}

/**
 * Resumen en vivo de un run de Claude Code (proceso `claude -p` en curso o
 * recién terminado). Lo consume el panel Orquestador para listar todo lo que
 * está corriendo en todos los proyectos a la vez (endpoint GET /claude/runs).
 */
export interface ClaudeRunSummary {
  /** Id de la corrida (run.id, corto). */
  id: string;
  /** Id estable de la sesión Hermes (para reabrir su stream/terminal). */
  sessionId: string;
  projectSlug: string;
  /** Prompt recortado, como etiqueta de la fila. */
  title: string;
  status: "running" | "done" | "error";
  startedAt: string;
  model: string;
  effort: string;
  /** Nº de tool_use vistos en el transcript hasta ahora. */
  toolCalls: number;
  exitCode?: number;
  /** Costo real del run en USD (del evento result del CLI); solo al terminar. */
  costUsd?: number;
  /** Duración reportada por el CLI en ms; solo al terminar. */
  durationMs?: number;
  /** Nº de turnos del run; solo al terminar. */
  numTurns?: number;
  /** Último texto del asistente (recortado) como preview del resultado. */
  lastText?: string;
}

/** Acumulado de gasto del día en runs de Claude Code (GET /stats). */
export interface DailyRunUsage {
  /** Suma de total_cost_usd de los runs terminados hoy. */
  costUsd: number;
  /** Nº de runs terminados hoy. */
  runs: number;
}

/** Detalle completo de una sesión de Claude Code, con su transcript. */
export interface ClaudeSessionDetail extends ClaudeSessionMeta {
  effort: string;
  permissionMode: string;
  cwd: string;
  /** Id de sesión del SDK/CLI a usar con `claude --resume` (sigue al último fork). */
  sdkSessionId: string;
  lines: ClaudeSessionLine[];
}

/** Evento del bus de actividad del agente (SSE /events + tabla agent_activity). */
export interface AgentActivityEvent {
  kind:
    | "task_start"
    | "tool_call"
    | "tool_result"
    | "text"
    | "task_done"
    | "error"
    | "session_start";
  taskId?: string;
  sessionId?: string;
  toolName?: string;
  detail?: string;
  machine?: string;
  ts: string;
}

export type TaskStatus = "running" | "done" | "error";

export interface HermesTask {
  id: string;
  prompt: string;
  status: TaskStatus;
  /** Resumen final (último texto del asistente) cuando status === done. */
  result?: string;
  error?: string;
  startedAt: string;
  finishedAt?: string;
  toolCalls: number;
}

export interface SystemVitals {
  memories: number;
  activeProjects: number;
  sessionsToday: number;
  tasksToday: number;
  machine: string;
  uptimeSeconds: number;
  supabase: boolean;
}
