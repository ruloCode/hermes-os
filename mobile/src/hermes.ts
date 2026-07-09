/**
 * Cliente del agente Hermes (:8650 del Mac vía LAN/Tailscale). Mismo contrato
 * que el dashboard web (apps/web/src/lib/hermes.ts): fetch + Bearer opcional.
 * La app corre en el teléfono, así que NO hay CORS: golpea el agente directo.
 */
import { getBase, getKey } from "./config";
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
} from "./types";

function authHeaders(): Record<string, string> {
  const k = getKey();
  return k ? { Authorization: `Bearer ${k}` } : {};
}

async function req(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${getBase()}${path}`, {
    ...init,
    headers: { ...authHeaders(), ...(init?.headers as Record<string, string> | undefined) },
  });
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
