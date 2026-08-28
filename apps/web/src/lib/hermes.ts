import type {
  Budget,
  Currency,
  EnglishSession,
  FinanceSummary,
  FxRate,
  Goal,
  GoalStatus,
  Habit,
  HabitCadence,
  HabitCheckin,
  HabitToday,
  ProjectContext,
  ChatSessionSummary,
  ChatSessionDetail,
  ChatToolStep,
  ClaudeSessionSummary,
  ClaudeSessionDetail,
  LiveMeetingSnapshot,
  MachinePresence,
  Meeting,
  MeetingSummary,
  PieceMedia,
  PieceMediaFile,
  Task,
  TaskState,
  TaskExecution,
  TaskExecutionSummary,
  Transaction,
  TransactionKind,
  VaultDoc,
  VocabEntry,
  Wallet,
} from "@hermes/shared";
import { downloadText } from "./download";

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
export function hermesFetch(path: string, init?: RequestInit): Promise<Response> {
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
    /** Recibe cada paso agéntico (tool_use) del turno, en orden. */
    onTool?: (step: ChatToolStep) => void;
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
      // Paso agéntico (tool_use) del turno — mismo sobre `hermes`.
      const tool = parsed?.hermes?.tool;
      if (tool && typeof tool.name === "string") opts?.onTool?.(tool as ChatToolStep);
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

/** Detiene una corrida en curso (kill del proceso `claude -p`). */
export async function claudeKillRun(runId: string): Promise<boolean> {
  try {
    await hermesPost(`/claude/run/${encodeURIComponent(runId)}/kill`);
    return true;
  } catch {
    return false;
  }
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

// ── Reuniones/Juntas por proyecto ──────────────────────────────────────

export interface MeetingJobRef {
  meeting_job_id: string;
  status: string;
}

/** Estado de un job de ingest de reunión (transcripción + resumen). */
export interface MeetingJobStatus {
  id: string;
  status: "running" | "done" | "error";
  /** id de la reunión creada (cuando status === done). */
  meetingId?: string;
  title?: string;
  error?: string;
}

function blobExt(blob: Blob): string {
  const t = (blob.type || "").toLowerCase();
  if (t.includes("webm")) return "webm";
  if (t.includes("mp4") || t.includes("m4a")) return "m4a";
  if (t.includes("mpeg") || t.includes("mp3")) return "mp3";
  if (t.includes("wav")) return "wav";
  if (t.includes("ogg")) return "ogg";
  return "webm";
}

// ── Estudio: voz en off y archivos de la carpeta de la pieza ───────────

/**
 * Sube una toma de voz en off. `stem` es el bloque del guion ("02-3-12s") o el
 * nombre de una toma libre; el sufijo `-vo` y el número de toma los pone el
 * agente (nunca se manda un nombre de archivo desde el browser). Devuelve el
 * escaneo fresco de la carpeta para pintar el estado real de una.
 */
export async function uploadVoiceover(
  pieceId: number,
  input: { stem: string; blob: Blob },
): Promise<{ file?: PieceMediaFile; media?: PieceMedia; transcoded?: boolean }> {
  const form = new FormData();
  form.append("stem", input.stem);
  form.append("audio", input.blob, `voz.${blobExt(input.blob)}`);
  const res = await hermesFetch(`/content/pieces/${pieceId}/voiceover`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(
      (detail as { error?: string } | null)?.error ?? `voz en off → ${res.status}`,
    );
  }
  return (await res.json()) as { file?: PieceMediaFile; media?: PieceMedia; transcoded?: boolean };
}

/**
 * Descarga un archivo de la carpeta de la pieza como blob URL (para el <audio>
 * del dashboard): el endpoint va con Bearer, así que no sirve un src directo.
 * Quien la pide es responsable de revocarla.
 */
export async function pieceMediaFileUrl(
  pieceId: number,
  name: string,
  sub: "crudos" | "assets" | "exports" = "assets",
): Promise<string> {
  const q = new URLSearchParams({ sub, name });
  const res = await hermesFetch(`/content/pieces/${pieceId}/media/file?${q.toString()}`);
  if (!res.ok) throw new Error(`archivo → ${res.status}`);
  return URL.createObjectURL(await res.blob());
}

/**
 * Sube una reunión (audio grabado/subido o transcripción pegada) y devuelve el
 * id del job para seguir el progreso. Usa multipart: NO fijamos Content-Type,
 * el browser pone el boundary correcto (hermesFetch solo inyecta el Bearer).
 */
export async function uploadMeeting(input: {
  project: string;
  audioBlob?: Blob;
  transcript?: string;
  title?: string;
  source?: "audio" | "upload" | "paste";
  durationSec?: number;
  filename?: string;
}): Promise<MeetingJobRef> {
  const form = new FormData();
  form.append("project", input.project);
  if (input.title) form.append("title", input.title);
  if (input.source) form.append("source", input.source);
  if (input.durationSec != null) form.append("durationSec", String(Math.round(input.durationSec)));
  if (input.audioBlob) {
    form.append("audio", input.audioBlob, input.filename ?? `reunion.${blobExt(input.audioBlob)}`);
  } else if (input.transcript) {
    form.append("transcript", input.transcript);
  }
  const res = await hermesFetch(`/meetings`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`/meetings → ${res.status}`);
  return (await res.json()) as MeetingJobRef;
}

export async function getMeetingJob(id: string): Promise<MeetingJobStatus | null> {
  try {
    return await hermesGet<MeetingJobStatus>(`/meetings/jobs/${encodeURIComponent(id)}`);
  } catch {
    return null;
  }
}

/** Historial de reuniones de un proyecto (más recientes primero). */
export async function listMeetings(project: string): Promise<MeetingSummary[]> {
  try {
    return await hermesGet<MeetingSummary[]>(`/meetings/${encodeURIComponent(project)}`);
  } catch {
    return [];
  }
}

/** Detalle de una reunión (resumen + accionables + transcripción). */
export async function getMeeting(project: string, id: string): Promise<Meeting | null> {
  try {
    return await hermesGet<Meeting>(
      `/meetings/${encodeURIComponent(project)}/${encodeURIComponent(id)}`,
    );
  } catch {
    return null;
  }
}

/**
 * Baja la junta como archivo: `txt` = transcripción · `md` = acta completa
 * (el .md del vault, con sugerencias en vivo y coach incluidos).
 */
export async function downloadMeeting(
  project: string,
  id: string,
  format: "txt" | "md",
): Promise<void> {
  const res = await hermesFetch(
    `/meetings/${encodeURIComponent(project)}/${encodeURIComponent(id)}/export?format=${format}`,
  );
  if (!res.ok) throw new Error(`/meetings/export → ${res.status}`);
  const text = await res.text();
  downloadText(
    `${id}${format === "txt" ? "-transcripcion.txt" : ".md"}`,
    text,
    format === "txt" ? "text/plain" : "text/markdown",
  );
}

/** Búsqueda semántica en reuniones (opcionalmente acotada a un proyecto). */
export async function searchMeetings(q: string, project?: string): Promise<MeetingSummary[]> {
  const p = project ? `&project=${encodeURIComponent(project)}` : "";
  try {
    return await hermesGet<MeetingSummary[]>(`/meetings/search?q=${encodeURIComponent(q)}${p}`);
  } catch {
    return [];
  }
}

/**
 * Arranca la ejecución de un accionable: lanza `claude -p` con su exec_prompt en
 * el repo del proyecto. Devuelve el run para abrir su stream en el terminal.
 */
export async function executeActionable(
  project: string,
  meetingId: string,
  idx: number,
): Promise<{ runId: string; sessionId: string; slug: string } | null> {
  try {
    const res = await hermesPost<{ run_id: string; session_id: string; slug: string }>(
      `/meetings/${encodeURIComponent(project)}/${encodeURIComponent(meetingId)}/actionables/${idx}/execute`,
    );
    return { runId: res.run_id, sessionId: res.session_id, slug: res.slug };
  } catch {
    return null;
  }
}

// ── Junta EN VIVO (copiloto en tiempo real) ────────────────────────────
// Controles por REST (sobreviven caídas del WS); el WS solo sube audio y
// baja eventos. El contrato vive en @hermes/shared (sección "Junta EN VIVO").

/**
 * Crea la sesión en vivo. Si ya hay una activa el agente responde 409 con su
 * snapshot → se devuelve ESA (el flujo de start es "reanudar la activa").
 */
export async function startLiveMeeting(input: {
  project: string;
  title?: string;
  /** presencial (default) = solo mic · remoto = mic + audio de pestaña (Meet). */
  mode?: "presencial" | "remoto";
  /** Bias de idioma del STT (["es"] default, ["es","en"] = code-switching). */
  languages?: ("es" | "en")[];
  suggestionLang?: "auto" | "es" | "en";
}): Promise<LiveMeetingSnapshot> {
  const res = await hermesFetch(`/meetings/live/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (res.status === 409) {
    // El agente manda { error, active: snapshot } (LiveConflictError en index.ts).
    const body = (await res.json().catch(() => null)) as {
      error?: string;
      active?: LiveMeetingSnapshot;
    } | null;
    if (body?.active?.id) return body.active;
    throw new Error("Ya hay una junta en vivo activa en el agente.");
  }
  if (res.status === 503) {
    throw new Error("El STT en vivo no está configurado en el agente (falta la API key).");
  }
  if (!res.ok) throw new Error(`/meetings/live/start → ${res.status}`);
  return (await res.json()) as LiveMeetingSnapshot;
}

/** Snapshot de una sesión en vivo (rehidratar tras ⌘R / poll de cierre). */
export async function getLiveMeeting(id: string): Promise<LiveMeetingSnapshot | null> {
  try {
    return await hermesGet<LiveMeetingSnapshot>(`/meetings/live/${encodeURIComponent(id)}`);
  } catch {
    return null;
  }
}

/** Sesiones en vivo del agente (a lo sumo una activa por diseño). */
export async function listLiveMeetings(): Promise<LiveMeetingSnapshot[]> {
  try {
    return await hermesGet<LiveMeetingSnapshot[]>(`/meetings/live`);
  } catch {
    return [];
  }
}

/** Cierra la junta: el agente drena el STT e ingesta. El fin llega por WS `done`. */
export async function stopLiveMeeting(id: string): Promise<void> {
  await hermesPost(`/meetings/live/${encodeURIComponent(id)}/stop`);
}

/** Renombra un label del provider ("A" → "Carlos"); aplica al vivo y al .md final. */
export async function renameLiveSpeaker(
  id: string,
  speaker: string,
  name: string,
): Promise<void> {
  await hermesPost(`/meetings/live/${encodeURIComponent(id)}/rename`, { speaker, name });
}

/** "Soplar ahora": fuerza una tanda de sugerencias. false = ya hay una en vuelo (409). */
export async function suggestNowLive(id: string): Promise<boolean> {
  const res = await hermesFetch(`/meetings/live/${encodeURIComponent(id)}/suggest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (res.status === 409) return false;
  if (!res.ok) throw new Error(`/meetings/live/:id/suggest → ${res.status}`);
  return true;
}

/**
 * URL del WS de la junta (audio ↑ binario, eventos ↓ JSON). Reusa sseUrl:
 * mismo ?key= (el browser no manda headers en WS) y respeta el selector
 * multi-Mac; http→ws y https→wss con el mismo replace.
 */
export function liveMeetingWsUrl(id: string): string {
  return sseUrl(`/meetings/live/${encodeURIComponent(id)}/ws`).replace(/^http/, "ws");
}

// ── Control por gestos (mano → cursor) ─────────────────────────────────

export interface GestureAgentStatus {
  enabled: boolean;
  available?: boolean;
  error?: string | null;
  /** null = robotjs no cargó; false = falta permiso Accessibility para node. */
  accessibility?: boolean | null;
  screen?: { width: number; height: number } | null;
}

export async function getGestureStatus(): Promise<GestureAgentStatus | null> {
  try {
    const res = await hermesFetch("/input/gestures/status");
    if (!res.ok) return null;
    return (await res.json()) as GestureAgentStatus;
  } catch {
    return null;
  }
}

/** WS del control por gestos (JSON en ambos sentidos). Mismo ?key= que SSE. */
export function gesturesWsUrl(): string {
  return sseUrl("/input/gestures/ws").replace(/^http/, "ws");
}

// ── Tracker de tareas por proyecto ─────────────────────────────────────

export interface RunRef {
  runId: string;
  sessionId: string;
  slug: string;
}

/** Lista tareas (tablero). Filtrable por proyecto y estado. */
export async function listTasks(opts: { project?: string; status?: TaskState } = {}): Promise<Task[]> {
  const q = new URLSearchParams();
  if (opts.project) q.set("project", opts.project);
  if (opts.status) q.set("status", opts.status);
  const qs = q.toString();
  try {
    return await hermesGet<Task[]>(`/tracker/tasks${qs ? `?${qs}` : ""}`);
  } catch {
    return [];
  }
}

export async function getTask(id: number): Promise<Task | null> {
  try {
    return await hermesGet<Task>(`/tracker/tasks/${id}`);
  } catch {
    return null;
  }
}

/** Crea una tarea manual en un proyecto. */
export async function createTask(project: string, title: string, detail?: string): Promise<Task | null> {
  try {
    return await hermesPost<Task>("/tracker/tasks", { project, title, detail });
  } catch {
    return null;
  }
}

/** Cambia el estado (completar/ignorar/reabrir). */
export async function setTaskStatus(id: number, status: TaskState): Promise<Task | null> {
  try {
    return await hermesPost<Task>(`/tracker/tasks/${id}/status`, { status });
  } catch {
    return null;
  }
}

/** Lanza `claude -p` con la tarea; devuelve el run para abrir su stream. */
export async function executeTask(id: number): Promise<RunRef | null> {
  try {
    const r = await hermesPost<{ run_id: string; session_id: string; slug: string }>(
      `/tracker/tasks/${id}/execute`,
    );
    return { runId: r.run_id, sessionId: r.session_id, slug: r.slug };
  } catch {
    return null;
  }
}

/**
 * Continúa/envía otro prompt a la tarea: resume su sesión de Claude Code con un
 * run nuevo (misma conversación). Sin prompt, envía un "continúa" por defecto.
 */
export async function continueTask(id: number, prompt?: string): Promise<RunRef | null> {
  try {
    const r = await hermesPost<{ run_id: string; session_id: string; slug: string }>(
      `/tracker/tasks/${id}/continue`,
      { prompt },
    );
    return { runId: r.run_id, sessionId: r.session_id, slug: r.slug };
  } catch {
    return null;
  }
}

/** Historial de ejecuciones de una tarea (memoria: prompt · análisis · resultado). */
export async function listTaskExecutions(taskId: number): Promise<TaskExecutionSummary[]> {
  try {
    return await hermesGet<TaskExecutionSummary[]>(`/tracker/tasks/${taskId}/executions`);
  } catch {
    return [];
  }
}

/** Documento completo de una ejecución (con markdown para renderizar). */
export async function getTaskExecution(
  project: string,
  id: string,
): Promise<TaskExecution | null> {
  try {
    return await hermesGet<TaskExecution>(
      `/tracker/executions/${encodeURIComponent(project)}/${encodeURIComponent(id)}`,
    );
  } catch {
    return null;
  }
}

// ── Linear (tablero Linear-first del tab TAREAS) ───────────────────────

export interface LinearBoardIssue {
  identifier: string;
  title: string;
  url: string;
  priority: number;
  updatedAt: string;
  state: { name: string; type: string };
  labels: { nodes: { name: string }[] };
  project: { name: string } | null;
  hasPrompt: boolean;
  /** Fila-puente local (si el issue ya se ejecutó alguna vez). */
  local?: {
    task_id: number;
    status: TaskState;
    run_id: string | null;
    session_id: string | null;
  };
}

export interface LinearIssueFull {
  id: string;
  identifier: string;
  title: string;
  description: string;
  url: string;
  priority: number;
  createdAt: string;
  updatedAt: string;
  state: { id: string; name: string; type: string };
  project: { name: string } | null;
  labels: { nodes: { name: string }[] };
  copyPrompt: string | null;
}

export type LinearStateType = "backlog" | "unstarted" | "started" | "completed" | "canceled";

/** Tablero: issues del team + overlay de ejecución local. */
export async function getLinearBoard(
  project?: string,
): Promise<{ available: boolean; issues: LinearBoardIssue[] }> {
  try {
    return await hermesGet<{ available: boolean; issues: LinearBoardIssue[] }>(
      `/linear/board${project ? `?project=${encodeURIComponent(project)}` : ""}`,
    );
  } catch {
    return { available: false, issues: [] };
  }
}

export async function getLinearIssue(identifier: string): Promise<LinearIssueFull | null> {
  try {
    return await hermesGet<LinearIssueFull>(`/linear/issue/${encodeURIComponent(identifier)}`);
  } catch {
    return null;
  }
}

/** Ejecuta el issue con Claude Code; devuelve el run + la fila-puente local. */
export async function executeLinearIssue(
  identifier: string,
): Promise<(RunRef & { taskId: number }) | null> {
  try {
    const r = await hermesPost<{
      task_id: number;
      run_id: string;
      session_id: string;
      slug: string;
    }>(`/linear/issue/${encodeURIComponent(identifier)}/execute`);
    return { runId: r.run_id, sessionId: r.session_id, slug: r.slug, taskId: r.task_id };
  } catch {
    return null;
  }
}

/** Cambia el estado del issue en Linear (Done tras revisar, reabrir…). */
export async function setLinearIssueState(
  identifier: string,
  type: LinearStateType,
): Promise<boolean> {
  try {
    await hermesPost(`/linear/issue/${encodeURIComponent(identifier)}/state`, { type });
    return true;
  } catch {
    return false;
  }
}

/** Nueva tarea: Hermes la crea en Linear con contexto + Copy prompt (async). */
export async function createLinearTask(
  instruction: string,
  project?: string,
): Promise<boolean> {
  try {
    await hermesPost("/linear/issues", { instruction, project });
    return true;
  } catch {
    return false;
  }
}

// ── Práctica de inglés (página /ingles) ────────────────────────────────

/** Sesión completa con transcript (GET /english/sessions/:id). */
export async function getEnglishSessionDetail(
  id: number,
): Promise<(EnglishSession & { transcript: string | null }) | null> {
  try {
    return await hermesGet<EnglishSession & { transcript: string | null }>(
      `/english/sessions/${id}`,
    );
  } catch {
    return null;
  }
}

/** Marca un término como repasado (≥3 repasos lo dan por aprendido). */
export async function reviewVocabEntry(id: number): Promise<VocabEntry | null> {
  try {
    return await hermesPost<VocabEntry>(`/english/vocab/${id}/review`);
  } catch {
    return null;
  }
}

/** Importa las "Tareas Pendientes" ya escritas en la nota del proyecto. */
export async function importVaultTasks(project: string): Promise<{ imported: number }> {
  try {
    return await hermesPost<{ imported: number }>(`/tracker/import/${encodeURIComponent(project)}`);
  } catch {
    return { imported: 0 };
  }
}

/**
 * Triage Linear-first de un accionable de junta: ejecutar/pendiente crean el
 * issue en Linear PRIMERO (el exec_prompt es su Copy prompt); ignorar queda
 * solo local. Devuelve también el issue creado para pintar el chip RUL-x.
 */
export async function triageActionable(
  project: string,
  meetingId: string,
  idx: number,
  decision: "ejecutar" | "pendiente" | "ignorar",
): Promise<{
  task: Task | null;
  run?: RunRef;
  issue?: { identifier: string; url: string };
}> {
  const res = await hermesPost<{
    task: Task | null;
    issue?: { identifier: string; url: string };
    run_id?: string;
    session_id?: string;
    slug?: string;
  }>(`/meetings/${encodeURIComponent(project)}/${encodeURIComponent(meetingId)}/actionables/${idx}/triage`, {
    decision,
  });
  const run =
    res.run_id && res.session_id && res.slug
      ? { runId: res.run_id, sessionId: res.session_id, slug: res.slug }
      : undefined;
  return { task: res.task, run, issue: res.issue };
}

// ── Finanzas personales ────────────────────────────────────────────────

export async function listTransactions(
  opts: { month?: string; category?: string; kind?: TransactionKind; currency?: Currency; limit?: number } = {},
): Promise<Transaction[]> {
  const q = new URLSearchParams();
  if (opts.month) q.set("month", opts.month);
  if (opts.category) q.set("category", opts.category);
  if (opts.kind) q.set("kind", opts.kind);
  if (opts.currency) q.set("currency", opts.currency);
  if (opts.limit) q.set("limit", String(opts.limit));
  const qs = q.toString();
  try {
    return await hermesGet<Transaction[]>(`/finance/transactions${qs ? `?${qs}` : ""}`);
  } catch {
    return [];
  }
}

/** Crea un movimiento manual desde la web. deduped=true si ya existía hoy. */
export async function createTransaction(input: {
  kind: TransactionKind;
  amount: number;
  currency?: Currency;
  category?: string;
  account?: string;
  note?: string;
  occurred_on?: string;
  allow_duplicate?: boolean;
}): Promise<(Transaction & { deduped?: boolean }) | null> {
  try {
    return await hermesPost<Transaction & { deduped?: boolean }>("/finance/transactions", input);
  } catch {
    return null;
  }
}

export async function updateTransaction(
  id: number,
  patch: Partial<Pick<Transaction, "amount" | "currency" | "category" | "note" | "occurred_on" | "kind">>,
): Promise<Transaction | null> {
  try {
    return await hermesPost<Transaction>(`/finance/transactions/${id}`, patch);
  } catch {
    return null;
  }
}

/** Anula (soft-delete) un movimiento. */
export async function voidTransaction(id: number): Promise<boolean> {
  try {
    const res = await hermesFetch(`/finance/transactions/${id}`, { method: "DELETE" });
    return res.ok;
  } catch {
    return false;
  }
}

export async function getFinanceSummary(
  month?: string,
  currency?: Currency,
  combined?: boolean,
): Promise<FinanceSummary | null> {
  const q = new URLSearchParams();
  if (month) q.set("month", month);
  if (currency) q.set("currency", currency);
  if (combined) q.set("combined", "1");
  const qs = q.toString();
  try {
    return await hermesGet<FinanceSummary>(`/finance/summary${qs ? `?${qs}` : ""}`);
  } catch {
    return null;
  }
}

export async function listBudgets(): Promise<Budget[]> {
  try {
    return await hermesGet<Budget[]>("/finance/budgets");
  } catch {
    return [];
  }
}

export async function setBudget(category: string, monthlyLimit: number, currency?: Currency): Promise<Budget | null> {
  try {
    return await hermesPost<Budget>("/finance/budgets", { category, monthly_limit: monthlyLimit, currency });
  } catch {
    return null;
  }
}

/** TRM vigente USD→COP; null si el agente nunca consiguió tasa. */
export async function getFxRate(): Promise<FxRate | null> {
  try {
    return await hermesGet<FxRate | null>("/finance/fx");
  } catch {
    return null;
  }
}

/** Billeteras con saldo actual (bancolombia, nu, nequi, ontop…). */
export async function listWallets(): Promise<Wallet[]> {
  try {
    return await hermesGet<Wallet[]>("/finance/wallets");
  } catch {
    return [];
  }
}

/** Fija (o crea) el saldo de una billetera — recalibre manual. */
export async function setWallet(name: string, balance: number, currency?: Currency): Promise<Wallet | null> {
  try {
    return await hermesPost<Wallet>("/finance/wallets", { name, balance, currency });
  } catch {
    return null;
  }
}

// ── Hábitos y metas ────────────────────────────────────────────────────

export async function listHabitsToday(): Promise<HabitToday[]> {
  try {
    return await hermesGet<HabitToday[]>("/habits/today");
  } catch {
    return [];
  }
}

export async function createHabit(input: {
  name: string;
  cadence?: HabitCadence;
  times_per_week?: number;
}): Promise<Habit | null> {
  try {
    return await hermesPost<Habit>("/habits", input);
  } catch {
    return null;
  }
}

export async function archiveHabit(id: number): Promise<boolean> {
  try {
    await hermesPost(`/habits/${id}/archive`);
    return true;
  } catch {
    return false;
  }
}

/** Marca (o des-marca con done=false) el hábito hoy. */
export async function checkinHabit(id: number, opts: { done?: boolean; note?: string } = {}): Promise<HabitCheckin | null> {
  try {
    return await hermesPost<HabitCheckin>(`/habits/${id}/checkin`, opts);
  } catch {
    return null;
  }
}

export async function listGoals(status?: GoalStatus): Promise<Goal[]> {
  try {
    return await hermesGet<Goal[]>(`/goals${status ? `?status=${status}` : ""}`);
  } catch {
    return [];
  }
}

export async function createGoal(input: {
  title: string;
  description?: string;
  target_value?: number;
  unit?: string;
  milestones?: string[];
  due_date?: string;
}): Promise<Goal | null> {
  try {
    return await hermesPost<Goal>("/goals", input);
  } catch {
    return null;
  }
}

export async function updateGoal(
  id: number,
  patch: { current_value?: number; delta?: number; status?: GoalStatus; milestone_done?: string },
): Promise<Goal | null> {
  try {
    return await hermesPost<Goal>(`/goals/${id}`, patch);
  } catch {
    return null;
  }
}

// Resuelve una referencia .md del vault (wikilink o ruta) para el visor Notion.
export function getVaultDoc(ref: string, project?: string): Promise<VaultDoc> {
  const q = new URLSearchParams({ ref });
  if (project) q.set("project", project);
  return hermesGet<VaultDoc>(`/vault/doc?${q.toString()}`);
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

export async function hermesDelete<T>(path: string): Promise<T> {
  const res = await hermesFetch(path, { method: "DELETE" });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return (await res.json()) as T;
}

export async function hermesPatch<T>(path: string, body?: unknown): Promise<T> {
  const res = await hermesFetch(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return (await res.json()) as T;
}

// ── Capa de datos del rediseño (dashboard/strip + memoria) ─────────────
import type {
  CodeGraph3D,
  DashboardSnapshot,
  KnowledgeHit,
  KnowledgeSource,
  KnowledgeStats,
  TrackerSummary,
  UpcomingCalendar,
} from "@hermes/shared";

/** Grafo de código de graphify (nodos+aristas+comunidades) para el render 3D. */
export function getCodeGraph3D(project?: string): Promise<CodeGraph3D> {
  const q = project ? `?project=${encodeURIComponent(project)}` : "";
  return hermesGet<CodeGraph3D>(`/code-graph/graph${q}`);
}

/** Búsqueda semántica unificada (memorias+reuniones+ejecuciones+chats+vault). */
export function searchKnowledge(
  query: string,
  opts?: { sources?: KnowledgeSource[]; project?: string; limit?: number },
): Promise<KnowledgeHit[]> {
  return hermesPost<KnowledgeHit[]>("/knowledge/search", { query, ...opts });
}

/** Conteos reales de la base de conocimiento (panel MEMORIA ACTIVA). */
export function getKnowledgeStats(): Promise<KnowledgeStats> {
  return hermesGet<KnowledgeStats>("/knowledge/stats");
}

/** Snapshot único del dashboard (strip inferior + presencia + jobs + clima). */
export function getDashboard(): Promise<DashboardSnapshot> {
  return hermesGet<DashboardSnapshot>("/dashboard");
}

/**
 * Feed ICS de Google Calendar para la página AGENDA. Ventana amplia hacia
 * atrás (mes/semana pasados navegables) y adelante para llenar las vistas de
 * calendario; el strip inferior sigue usando el snapshot de /dashboard con su
 * propia ventana corta.
 */
export function getUpcomingCalendar(
  days = 120,
  limit = 1500,
  back = 45,
): Promise<UpcomingCalendar> {
  return hermesGet<UpcomingCalendar>(
    `/calendar/upcoming?days=${days}&limit=${limit}&back=${back}`,
  );
}

/** Conteos del tracker por estado (progreso real de un proyecto). */
export function getTrackerSummary(project?: string): Promise<TrackerSummary> {
  const q = project ? `?project=${encodeURIComponent(project)}` : "";
  return hermesGet<TrackerSummary>(`/tracker/summary${q}`);
}

// ── Máquinas de la red interna (multi-PC) ───────────────────────────────
// El dashboard lo sirve UNA máquina y lo abren varias: cada browser elige a
// qué agente le habla (override en localStorage, que es por-máquina). La lista
// NO se hornea en una env — la publica cada agente en su heartbeat.

/**
 * Máquinas conocidas según el agente activo (él lee agent_presence). La que
 * viene con `self: true` es justamente la que está respondiendo: así el
 * selector sabe cuál marcar sin comparar URLs (localhost vs IP LAN).
 */
export async function listMachines(): Promise<MachinePresence[]> {
  try {
    const { machines } = await hermesGet<{ machines: MachinePresence[] }>("/machines");
    return machines ?? [];
  } catch {
    return [];
  }
}

/**
 * ¿Contesta ese agente AHORA? /health no exige auth y devuelve el nombre de la
 * máquina: un heartbeat viejo en Supabase no prueba que se le pueda hablar
 * desde ESTE browser (otra subred, firewall, PC dormido).
 */
export async function probeMachine(
  baseUrl: string,
): Promise<{ ok: boolean; machine?: string }> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return { ok: false };
    const body = (await res.json()) as { machine?: string };
    return { ok: true, machine: body.machine };
  } catch {
    return { ok: false };
  }
}
