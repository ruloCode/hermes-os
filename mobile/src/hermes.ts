/**
 * Cliente del agente Hermes (LAN o túnel público, según resolvió config.ts).
 * Mismo contrato que el dashboard web (apps/web/src/lib/hermes.ts).
 * Credencial: el JWT de la sesión Supabase (login email+contraseña); si no hay
 * sesión cae al API key manual de Ajustes. En 401 refresca el token y reintenta
 * una vez. La app corre en el teléfono, así que NO hay CORS.
 */
import { fetch as expoFetch } from "expo/fetch";
import { getBase, getKey } from "./config";
import { ensureFreshToken, getAccessToken, getSession, refreshSession } from "./auth";
import type {
  ProjectStatus,
  Task,
  TaskState,
  MeetingSummary,
  Meeting,
  MeetingJobStatus,
  SystemStats,
  TaskExecution,
  TaskExecutionSummary,
  Currency,
  FinanceSummary,
  Transaction,
  TransactionKind,
  Wallet,
  ChatToolStep,
  LinearBoardIssue,
  LinearIssueFull,
  LinearStateType,
} from "./types";

function authHeaders(): Record<string, string> {
  const token = getAccessToken() || getKey();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function req(path: string, init?: RequestInit): Promise<Response> {
  await ensureFreshToken();
  const doFetch = () =>
    fetch(`${getBase()}${path}`, {
      ...init,
      headers: { ...authHeaders(), ...(init?.headers as Record<string, string> | undefined) },
    });
  let res = await doFetch();
  // 401 con sesión viva: el access token pudo vencer en vuelo → refresh + retry.
  if (res.status === 401 && getSession()) {
    const ok = await refreshSession();
    if (ok) res = await doFetch();
  }
  return res;
}

export async function get<T>(path: string): Promise<T> {
  const res = await req(path);
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return (await res.json()) as T;
}

export async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await req(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return (await res.json()) as T;
}

// ── Salud / stats ──────────────────────────────────────────────────────
export interface Health {
  ok: boolean;
  machine?: string;
  uptime?: number;
}
export async function health(): Promise<Health> {
  return get<Health>("/health");
}
export async function stats(): Promise<SystemStats> {
  return get<SystemStats>("/stats");
}

// ── Proyectos ──────────────────────────────────────────────────────────
export async function projects(): Promise<ProjectStatus[]> {
  return get<ProjectStatus[]>("/projects");
}

// ── Tareas (tracker de misión) ─────────────────────────────────────────
export async function tasks(opts: { project?: string; status?: TaskState } = {}): Promise<Task[]> {
  const q = new URLSearchParams();
  if (opts.project) q.set("project", opts.project);
  if (opts.status) q.set("status", opts.status);
  const qs = q.toString();
  return get<Task[]>(`/tracker/tasks${qs ? `?${qs}` : ""}`);
}
export async function createTask(project: string, title: string, detail?: string): Promise<Task> {
  return post<Task>("/tracker/tasks", { project, title, detail });
}
export async function setTaskStatus(id: number, status: TaskState): Promise<Task> {
  return post<Task>(`/tracker/tasks/${id}/status`, { status });
}
export async function executeTask(id: number): Promise<{ run_id: string; slug: string }> {
  return post(`/tracker/tasks/${id}/execute`);
}
export async function continueTask(id: number, prompt?: string): Promise<{ run_id: string; slug: string }> {
  return post(`/tracker/tasks/${id}/continue`, { prompt });
}

// ── Ejecuciones de una tarea (memoria: prompt · análisis · resultado) ──
export async function listTaskExecutions(taskId: number): Promise<TaskExecutionSummary[]> {
  try {
    return await get<TaskExecutionSummary[]>(`/tracker/tasks/${taskId}/executions`);
  } catch {
    return [];
  }
}
export async function getTaskExecution(project: string, id: string): Promise<TaskExecution | null> {
  try {
    return await get<TaskExecution>(
      `/tracker/executions/${encodeURIComponent(project)}/${encodeURIComponent(id)}`,
    );
  } catch {
    return null;
  }
}

// ── Reuniones ──────────────────────────────────────────────────────────
export async function listMeetings(project: string): Promise<MeetingSummary[]> {
  return get<MeetingSummary[]>(`/meetings/${encodeURIComponent(project)}`);
}
export async function getMeeting(project: string, id: string): Promise<Meeting> {
  return get<Meeting>(`/meetings/${encodeURIComponent(project)}/${encodeURIComponent(id)}`);
}
export async function getMeetingJob(id: string): Promise<MeetingJobStatus> {
  return get<MeetingJobStatus>(`/meetings/jobs/${encodeURIComponent(id)}`);
}

/**
 * Sube una grabación (uri local del recorder de expo-audio) como multipart.
 * En RN NO se fija Content-Type: la plataforma pone el boundary correcto.
 */
export async function uploadMeetingAudio(input: {
  project: string;
  uri: string;
  filename?: string;
  mime?: string;
  title?: string;
  durationSec?: number;
}): Promise<{ meeting_job_id: string; status: string }> {
  const form = new FormData();
  form.append("project", input.project);
  form.append("source", "audio");
  if (input.title) form.append("title", input.title);
  if (input.durationSec != null) form.append("durationSec", String(Math.round(input.durationSec)));
  form.append("audio", {
    uri: input.uri,
    name: input.filename ?? "reunion.m4a",
    type: input.mime ?? "audio/m4a",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  const res = await req("/meetings", { method: "POST", body: form });
  if (!res.ok) throw new Error(`/meetings → ${res.status}`);
  return (await res.json()) as { meeting_job_id: string; status: string };
}

export async function uploadMeetingTranscript(input: {
  project: string;
  transcript: string;
  title?: string;
}): Promise<{ meeting_job_id: string; status: string }> {
  const form = new FormData();
  form.append("project", input.project);
  form.append("source", "paste");
  form.append("transcript", input.transcript);
  if (input.title) form.append("title", input.title);
  const res = await req("/meetings", { method: "POST", body: form });
  if (!res.ok) throw new Error(`/meetings → ${res.status}`);
  return (await res.json()) as { meeting_job_id: string; status: string };
}

export async function triageActionable(
  project: string,
  meetingId: string,
  idx: number,
  decision: "ejecutar" | "pendiente" | "ignorar",
): Promise<{ task: Task | null }> {
  return post(
    `/meetings/${encodeURIComponent(project)}/${encodeURIComponent(meetingId)}/actionables/${idx}/triage`,
    { decision },
  );
}

// ── Tools de voz (mismos endpoints que usa el dashboard) ───────────────
export async function toolGetProjectStatus(project?: string): Promise<unknown[]> {
  return post<unknown[]>("/tools/get_project_status", { project });
}
export async function toolDailyBrief(): Promise<{ brief: string }> {
  return post<{ brief: string }>("/tools/get_daily_brief", {});
}
export async function toolSearchMemory(query: string): Promise<unknown[]> {
  return post<unknown[]>("/tools/search_memory", { query });
}
export async function toolSaveMemory(content: string, type?: string): Promise<unknown> {
  return post("/tools/save_memory", { content, type });
}

// ── Tareas async del SDK (run_task / check_task) ───────────────────────
export async function startTask(prompt: string): Promise<{ task_id: string; status: string }> {
  return post("/tasks", { prompt });
}
export interface AsyncTask {
  id: string;
  status: string;
  result?: string;
  toolCalls: number;
}
export async function getAsyncTask(id: string): Promise<AsyncTask> {
  return get<AsyncTask>(`/tasks/${encodeURIComponent(id)}`);
}

// ── Claude Code (work_on_project) ──────────────────────────────────────
export async function startClaudeRun(
  project: string,
  prompt: string,
): Promise<{ run_id: string; session_id: string }> {
  return post("/claude/run", { project, prompt });
}
export interface ClaudeRun {
  id: string;
  status: string;
  lastText?: string;
  projectSlug: string;
}
export async function claudeRuns(): Promise<ClaudeRun[]> {
  return get<ClaudeRun[]>("/claude/runs");
}

// ── Finanzas personales (mismos endpoints que la página /vida) ─────────

export async function financeSummary(opts: { month?: string; currency?: Currency; combined?: boolean } = {}): Promise<FinanceSummary> {
  const q = new URLSearchParams();
  if (opts.month) q.set("month", opts.month);
  if (opts.currency) q.set("currency", opts.currency);
  if (opts.combined !== false) q.set("combined", "1");
  return get<FinanceSummary>(`/finance/summary?${q.toString()}`);
}

export async function listWallets(): Promise<Wallet[]> {
  return get<Wallet[]>("/finance/wallets");
}

export async function listTransactions(opts: { limit?: number; month?: string } = {}): Promise<Transaction[]> {
  const q = new URLSearchParams();
  q.set("limit", String(opts.limit ?? 25));
  if (opts.month) q.set("month", opts.month);
  return get<Transaction[]>(`/finance/transactions?${q.toString()}`);
}

export async function addTransaction(input: {
  kind: TransactionKind;
  amount: number;
  currency?: Currency;
  category?: string;
  account?: string;
  note?: string;
}): Promise<Transaction & { deduped?: boolean }> {
  return post<Transaction & { deduped?: boolean }>("/finance/transactions", input);
}

export async function voidTransaction(id: number): Promise<{ ok: boolean }> {
  const res = await req(`/finance/transactions/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`void → ${res.status}`);
  return (await res.json()) as { ok: boolean };
}

// ── Chat de texto con Hermes (contrato /v1/chat/completions, SSE) ──────
// Mismo contrato que el dashboard web (apps/web/src/lib/hermes.ts):
// OpenAI-compatible + X-Hermes-Session-Id (memoria) + X-Hermes-Resume
// ("new" = sesión SDK fresca · uuid = resume) + X-Hermes-Project (foco).
// El fetch nativo de RN no expone response.body → usamos expo/fetch
// (WinterCG), que sí streamea. Funciona igual por LAN o por el túnel.

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** TextDecoder incremental con fallback puro-JS (por si el runtime no lo trae). */
function makeUtf8Decoder(): {
  decode: (chunk: Uint8Array) => string;
  /** Vuelca lo retenido al cerrar el stream (multi-byte cortado en el último chunk). */
  flush: () => string;
} {
  if (typeof TextDecoder !== "undefined") {
    const td = new TextDecoder();
    return {
      decode: (chunk) => td.decode(chunk, { stream: true }),
      flush: () => td.decode(),
    };
  }
  // Junta bytes y decodifica dejando en cola la secuencia multi-byte incompleta
  // del final (un delta SSE puede cortar un emoji/tilde a la mitad).
  let pending: number[] = [];
  return {
    decode(chunk: Uint8Array): string {
      const bytes = pending.concat(Array.from(chunk));
      let end = bytes.length;
      for (let i = Math.max(0, bytes.length - 4); i < bytes.length; i++) {
        const b = bytes[i];
        if (b < 0xc0) continue;
        const need = b >= 0xf0 ? 4 : b >= 0xe0 ? 3 : 2;
        if (i + need > bytes.length) {
          end = i;
          break;
        }
      }
      pending = bytes.slice(end);
      let out = "";
      for (let i = 0; i < end; ) {
        const b = bytes[i];
        let cp: number;
        let len: number;
        if (b < 0x80) {
          cp = b;
          len = 1;
        } else if (b < 0xe0) {
          cp = b & 0x1f;
          len = 2;
        } else if (b < 0xf0) {
          cp = b & 0x0f;
          len = 3;
        } else {
          cp = b & 0x07;
          len = 4;
        }
        for (let j = 1; j < len && i + j < end; j++) cp = (cp << 6) | (bytes[i + j] & 0x3f);
        out += String.fromCodePoint(cp > 0x10ffff ? 0xfffd : cp);
        i += len;
      }
      return out;
    },
    flush() {
      const out = pending.length ? "�" : "";
      pending = [];
      return out;
    },
  };
}

/**
 * Stream de chat contra el agente. Va llamando onDelta con cada trozo de texto;
 * onSession anuncia el session id del SDK (para resumir la MISMA conversación
 * en turnos siguientes) y onTool cada paso agéntico del turno.
 */
export async function streamChat(
  messages: ChatMessage[],
  opts: {
    /** Clave de sesión del cliente (estable por conversación). */
    sessionKey: string;
    /** Sesión SDK a resumir (uuid); null/undefined = conversación nueva. */
    resume?: string | null;
    /** Proyecto en foco: el agente centra el system prompt ahí. */
    project?: string | null;
    signal?: AbortSignal;
    onDelta: (text: string) => void;
    onSession?: (sdkSessionId: string) => void;
    onTool?: (step: ChatToolStep) => void;
  },
): Promise<void> {
  await ensureFreshToken();
  const buildHeaders = (): Record<string, string> => {
    const h: Record<string, string> = {
      ...authHeaders(),
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      "X-Hermes-Session-Id": opts.sessionKey,
      "X-Hermes-Resume": opts.resume || "new",
    };
    if (opts.project) h["X-Hermes-Project"] = opts.project;
    return h;
  };
  const doFetch = () =>
    expoFetch(`${getBase()}/v1/chat/completions`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({ messages, stream: true }),
      signal: opts.signal,
    });

  let res = await doFetch();
  // 401 con sesión viva: access token vencido en vuelo → refresh + retry.
  if (res.status === 401 && getSession()) {
    const ok = await refreshSession();
    if (ok) res = await doFetch();
  }
  if (!res.ok || !res.body) {
    throw new Error(`Hermes no responde (${res.status}).`);
  }

  const reader = res.body.getReader();
  const decoder = makeUtf8Decoder();
  let buffer = "";

  const handleEvent = (rawEvent: string): boolean => {
    const data = rawEvent
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n");
    if (!data) return false;
    if (data === "[DONE]") return true;
    try {
      const parsed = JSON.parse(data) as {
        hermes?: { session_id?: string; tool?: ChatToolStep };
        choices?: { delta?: { content?: string } }[];
      };
      const sid = parsed?.hermes?.session_id;
      if (typeof sid === "string" && sid) opts.onSession?.(sid);
      const tool = parsed?.hermes?.tool;
      if (tool && typeof tool.name === "string") opts.onTool?.(tool);
      const delta = parsed?.choices?.[0]?.delta?.content;
      if (typeof delta === "string" && delta) opts.onDelta(delta);
    } catch {
      /* keep-alive */
    }
    return false;
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) buffer += decoder.decode(value);
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const rawEvent = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      if (handleEvent(rawEvent)) {
        try {
          await reader.cancel();
        } catch {
          /* stream ya cerrado */
        }
        return;
      }
    }
  }
  buffer += decoder.flush();
  if (buffer.trim()) handleEvent(buffer);
}

// ── Linear (tablero Linear-first del tab TAREAS) ───────────────────────

/** Tablero: issues del team + overlay de ejecución local. */
export async function linearBoard(
  project?: string,
): Promise<{ available: boolean; issues: LinearBoardIssue[] }> {
  try {
    return await get<{ available: boolean; issues: LinearBoardIssue[] }>(
      `/linear/board${project ? `?project=${encodeURIComponent(project)}` : ""}`,
    );
  } catch {
    return { available: false, issues: [] };
  }
}

export async function linearIssue(identifier: string): Promise<LinearIssueFull | null> {
  try {
    return await get<LinearIssueFull>(`/linear/issue/${encodeURIComponent(identifier)}`);
  } catch {
    return null;
  }
}

/** Ejecuta el issue con Claude Code en la Mac; devuelve el run + fila-puente. */
export async function executeLinearIssue(
  identifier: string,
): Promise<{ task_id: number; run_id: string; session_id: string; slug: string } | null> {
  try {
    return await post<{ task_id: number; run_id: string; session_id: string; slug: string }>(
      `/linear/issue/${encodeURIComponent(identifier)}/execute`,
    );
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
    await post(`/linear/issue/${encodeURIComponent(identifier)}/state`, { type });
    return true;
  } catch {
    return false;
  }
}

/** Nueva tarea: Hermes la crea en Linear con contexto + Copy prompt (async). */
export async function createLinearIssue(instruction: string, project?: string): Promise<boolean> {
  try {
    await post("/linear/issues", { instruction, project });
    return true;
  } catch {
    return false;
  }
}

// ── Token efímero de ElevenLabs (endpoint nuevo del agente) ────────────
export interface VoiceCreds {
  conversationToken?: string;
  signedUrl?: string;
  error?: string;
  notConfigured?: boolean;
}
export async function voiceToken(): Promise<VoiceCreds> {
  const res = await req("/elevenlabs/token");
  const data = (await res.json().catch(() => ({}))) as VoiceCreds;
  if (!res.ok && !data.error) return { error: `token → ${res.status}` };
  return data;
}
