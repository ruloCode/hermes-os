/**
 * Subconjunto de los tipos compartidos del monorepo (packages/shared) que la app
 * móvil consume del agente Hermes en :8650. Copiados aquí a propósito: la app es
 * standalone (fuera del workspace pnpm) para no arrastrar el build de Metro.
 */

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

export type TaskState = "pending" | "running" | "done" | "dismissed";
export type TaskSource = "meeting" | "manual" | "vault" | "voice";

export interface Task {
  id: number;
  project_slug: string;
  title: string;
  detail?: string | null;
  exec_prompt?: string | null;
  status: TaskState;
  source: TaskSource;
  meeting_id?: string | null;
  meeting_idx?: number | null;
  run_id?: string | null;
  session_id?: string | null;
  created_at: string;
  updated_at?: string | null;
  done_at?: string | null;
}

export type MeetingSource = "audio" | "upload" | "paste";

export interface MeetingSummary {
  id: string;
  project_slug: string;
  title: string;
  fecha: string;
  source: MeetingSource;
  stt_provider?: string | null;
  duracion_min?: number | null;
  accionables_count: number;
}

export interface MeetingActionable {
  id: string;
  idx: number;
  title: string;
  one_liner: string;
  exec_prompt: string;
  taskId?: number | null;
  status?: TaskState | null;
  run_id?: string | null;
}

export interface Meeting extends MeetingSummary {
  summary: string;
  transcript: string;
  actionables: MeetingActionable[];
  participantes?: string[];
  vault_path?: string;
}

export interface MeetingJobStatus {
  id: string;
  status: "running" | "done" | "error";
  meetingId?: string;
  title?: string;
  error?: string;
}

export interface SystemStats {
  activeProjects?: number;
  totalProjects?: number;
  machine?: string;
  supabase?: boolean;
}

// ── Ejecuciones de tareas (memoria de Control de Misión) ───────────────
// Cada Ejecutar/Continuar de una tarea genera un documento {prompt·análisis·
// resultado}. Verdad en el vault; espejo en Supabase. Lo consume la app leyendo
// /tracker/tasks/:id/executions y /tracker/executions/:project/:id del agente.

export type TaskExecutionKind = "execute" | "continue";
export type TaskExecutionStatus = "done" | "error";

export interface TaskExecutionSummary {
  id: string;
  task_id: number | null;
  project_slug: string;
  kind: TaskExecutionKind;
  status: TaskExecutionStatus;
  result_snippet: string;
  cost_usd?: number | null;
  duration_ms?: number | null;
  created_at: string;
}

export interface TaskExecution extends TaskExecutionSummary {
  run_id: string | null;
  session_id: string | null;
  prompt: string;
  analysis: string;
  result: string;
  markdown: string;
  model: string;
  effort: string;
  num_turns?: number | null;
  machine?: string | null;
  vault_path?: string | null;
  finished_at?: string | null;
}
