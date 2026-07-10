/**
 * Cliente del agente Hermes (LAN o túnel público, según resolvió config.ts).
 * Mismo contrato que el dashboard web (apps/web/src/lib/hermes.ts).
 * Credencial: el JWT de la sesión Supabase (login email+contraseña); si no hay
 * sesión cae al API key manual de Ajustes. En 401 refresca el token y reintenta
 * una vez. La app corre en el teléfono, así que NO hay CORS.
 */
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
