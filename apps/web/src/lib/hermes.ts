import type {
  ProjectContext,
  ChatSessionSummary,
  ChatSessionDetail,
  ClaudeSessionSummary,
  ClaudeSessionDetail,
} from "@hermes/shared";

/**
 * Cliente del agent server (local o remoto vía Tailscale).
 * Portado del contrato Hermes original (zylen-web/hermes.service.ts):
 * OpenAI-compatible SSE + X-Hermes-Session-Id para memoria de sesión.
 *
 * Multi-Mac: la URL base es DINÁMICA — el selector de máquina puede apuntar
 * el dashboard al agente de otra Mac (override en localStorage). Si el agente
 * exige HERMES_API_KEY, el Bearer va en cada request (y como ?key= en los SSE,
 * porque EventSource no puede mandar headers).
 */
const DEFAULT_HERMES_URL = (
  process.env.NEXT_PUBLIC_HERMES_URL || "http://localhost:8650"
).replace(/\/$/, "");

const AGENT_URL_KEY = "hermes_agent_url";

/** URL del agente activo: override del selector de máquina o el env local. */
export function getHermesUrl(): string {
  try {
    const override = localStorage.getItem(AGENT_URL_KEY);
    if (override) return override.replace(/\/$/, "");
  } catch {
    /* SSR/prerender: sin localStorage */
  }
  return DEFAULT_HERMES_URL;
}

/** Fija (o limpia con null) el agente activo. El selector recarga después. */
export function setHermesUrl(url: string | null): void {
  try {
    if (url && url.replace(/\/$/, "") !== DEFAULT_HERMES_URL) {
      localStorage.setItem(AGENT_URL_KEY, url.replace(/\/$/, ""));
    } else {
      localStorage.removeItem(AGENT_URL_KEY);
    }
  } catch {
    /* noop */
  }
}

/** API key compartida entre agentes (multi-Mac). Vacía = sin auth (local). */
export function getHermesKey(): string {
  return process.env.NEXT_PUBLIC_HERMES_API_KEY || "";
}

function authHeaders(): Record<string, string> {
  const key = getHermesKey();
  return key ? { Authorization: `Bearer ${key}` } : {};
}

/** fetch contra el agente activo con el Bearer inyectado (si hay key). */
function hermesFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${getHermesUrl()}${path}`, {
    ...init,
    headers: { ...authHeaders(), ...(init?.headers as Record<string, string> | undefined) },
  });
}

/** URL para EventSource: anexa ?key= porque SSE no admite headers. */
export function sseUrl(path: string): string {
  const key = getHermesKey();
  if (!key) return `${getHermesUrl()}${path}`;
  const sep = path.includes("?") ? "&" : "?";
  return `${getHermesUrl()}${path}${sep}key=${encodeURIComponent(key)}`;
}

const SESSION_KEY = "hermes_os_session_id";

export function getSessionId(): string {
  try {
    const existing = localStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const created = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, created);
    return created;
  } catch {
    return crypto.randomUUID();
  }
}

export function resetSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* noop */
  }
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** Stream de chat contra el agente local (SSE estilo OpenAI). */
export async function streamChat(
  messages: ChatMessage[],
  onChunk: (delta: string) => void,
  opts?: {
    project?: string | null;
    signal?: AbortSignal;
    /** Clave de sesión del cliente (una por tab); default: la global. */
    sessionKey?: string;
    /** Sesión SDK a resumir (uuid del jsonl); null = conversación nueva. */
    resume?: string | null;
    /** Recibe el session id real del SDK apenas el agente lo anuncia. */
    onSession?: (sdkSessionId: string) => void;
  },
): Promise<void> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    "X-Hermes-Session-Id": opts?.sessionKey || getSessionId(),
    // "new" fuerza sesión SDK fresca; un uuid resume esa sesión exacta.
    "X-Hermes-Resume": opts?.resume || "new",
  };
  // Foco de conversación: el agente centra el system prompt en este proyecto.
  if (opts?.project) headers["X-Hermes-Project"] = opts.project;

  const response = await hermesFetch(`/v1/chat/completions`, {
    method: "POST",
    signal: opts?.signal,
    headers,
    body: JSON.stringify({ messages, stream: true }),
  });

  if (!response.ok || !response.body) {
    throw new Error(
      `Hermes no responde (${response.status}). ¿Está corriendo el agent server en ${getHermesUrl()}?`,
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const handleEvent = (rawEvent: string): boolean => {
    const dataLines = rawEvent
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""));
    if (!dataLines.length) return false;
    const data = dataLines.join("\n");
    if (data === "[DONE]") return true;
    try {
      const parsed = JSON.parse(data);
      // Anuncio del session id del SDK (evento propio de Hermes en el stream).
      const sid = parsed?.hermes?.session_id;
      if (typeof sid === "string" && sid) opts?.onSession?.(sid);
      const delta = parsed?.choices?.[0]?.delta?.content;
      if (typeof delta === "string" && delta) onChunk(delta);
    } catch {
      /* keep-alive */
    }
    return false;
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const rawEvent = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      if (handleEvent(rawEvent)) {
        await reader.cancel();
        return;
      }
    }
  }
  if (buffer.trim()) handleEvent(buffer);
}

// ── Claude Code (CLI real) ─────────────────────────────────────────────
export interface ClaudeExecConfig {
  model: string;
  effort: string;
  permissionMode: string;
}

/** Abre una Terminal.app real con `claude` interactivo. */
export async function claudeOpenTerminal(
  prompt: string,
  cfg: ClaudeExecConfig,
  project?: string | null,
): Promise<void> {
  await hermesPost("/claude/terminal", { prompt, ...cfg, project: project ?? undefined });
}

/**
 * Inicia una corrida headless de `claude -p`. Si `resumeSessionId` viene, resume
 * esa sesión; si no, crea una nueva. Devuelve el run_id (para el stream) y el
 * session_id (para marcar la sesión activa en el panel).
 */
export async function claudeStartRun(
  prompt: string,
  cfg: ClaudeExecConfig,
  project?: string | null,
  resumeSessionId?: string | null,
): Promise<{ runId: string; sessionId: string }> {
  const res = await hermesPost<{ run_id: string; session_id: string }>("/claude/run", {
    prompt,
    ...cfg,
    project: project ?? undefined,
    resumeSessionId: resumeSessionId ?? undefined,
  });
  return { runId: res.run_id, sessionId: res.session_id };
}

/** URL del stream SSE de una corrida embebida (con ?key= si aplica). */
export function claudeRunStreamUrl(runId: string): string {
  return sseUrl(`/claude/run/${runId}/stream`);
}

// ── Sesiones de Claude Code (CLI) por proyecto ─────────────────────────
/** Lista las sesiones de Claude Code de un proyecto (más recientes primero). */
export async function listClaudeSessions(
  project?: string | null,
): Promise<ClaudeSessionSummary[]> {
  try {
    return await hermesGet<ClaudeSessionSummary[]>(
      `/claude/sessions/${encodeURIComponent(project || "general")}`,
    );
  } catch {
    return [];
  }
}

/** Trae el detalle (con transcript) de una sesión para reabrirla. */
export async function getClaudeSession(
  project: string | null | undefined,
  id: string,
): Promise<ClaudeSessionDetail | null> {
  try {
    return await hermesGet<ClaudeSessionDetail>(
      `/claude/sessions/${encodeURIComponent(project || "general")}/${encodeURIComponent(id)}`,
    );
  } catch {
    return null;
  }
}

/** Borra el registro local de una sesión de Claude Code. */
export async function deleteClaudeSession(
  project: string | null | undefined,
  id: string,
): Promise<void> {
  await hermesFetch(
    `/claude/sessions/${encodeURIComponent(project || "general")}/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  ).catch(() => {});
}

// ── Sesiones de la consola: DIRECTO de ~/.claude/projects ──────────────
// La misma fuente que ve `claude` abierto en el repo del proyecto (Cursor).

/** Lista las sesiones del cwd del proyecto (más recientes primero). */
export async function listChatSessions(
  project?: string | null,
): Promise<ChatSessionSummary[]> {
  const q = project ? `?project=${encodeURIComponent(project)}` : "";
  return hermesGet<ChatSessionSummary[]>(`/chat/sessions${q}`);
}

/** Lee una sesión completa (mensajes de texto en orden) para abrirla en un tab. */
export async function getChatSession(
  project: string | null | undefined,
  id: string,
): Promise<ChatSessionDetail | null> {
  try {
    const q = project ? `?project=${encodeURIComponent(project)}` : "";
    return await hermesGet<ChatSessionDetail>(
      `/chat/sessions/${encodeURIComponent(id)}${q}`,
    );
  } catch {
    return null;
  }
}

// ── Contexto operativo de un proyecto (skills · MCP · tools) ───────────
/** Lee skills, servers MCP, herramientas y comandos del repo local del proyecto. */
export async function getProjectContext(slug: string): Promise<ProjectContext> {
  return hermesGet<ProjectContext>(`/projects/${encodeURIComponent(slug)}/context`);
}

/**
 * Abre el repo local del proyecto en Cursor (el agente lo lanza en el host).
 * No lanza excepción: devuelve el error del backend para mostrarlo en el panel.
 */
export async function openProjectInCursor(
  slug: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await hermesFetch(`/projects/${encodeURIComponent(slug)}/open-editor`, {
      method: "POST",
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || !data.ok) return { ok: false, error: data.error ?? `HTTP ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "agente offline" };
  }
}

// ── Helpers REST simples ───────────────────────────────────────────────
export async function hermesGet<T>(path: string): Promise<T> {
  const res = await hermesFetch(path);
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return (await res.json()) as T;
}

export async function hermesPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await hermesFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return (await res.json()) as T;
}
