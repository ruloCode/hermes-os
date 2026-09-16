import type { ScheduledTask, ScheduledTaskRun } from "@hermes/shared";
import { env } from "../env.js";
import { supabase } from "../supabase.js";
import { cronError, describeCron, nextRun } from "./cron.js";

/**
 * Tareas programadas: CRUD y cálculo de la próxima corrida.
 *
 * Viven en Postgres, no en el registry de jobs (jobs.ts es memoria pura y se
 * borra en cada reinicio — está bien para "cada 6h refresca el grafo", no para
 * "cada lunes dime qué está atascado"). El barrido es self-healing: lee lo
 * vencido y actúa, así un reinicio a mitad de camino no pierde nada.
 */

export interface CreateScheduledInput {
  title: string;
  prompt: string;
  cron: string;
  tz?: string;
  skills?: string[];
  model?: string | null;
  project?: string | null;
  deliver?: { notify?: boolean; memory?: boolean };
  createdBy?: string;
}

export async function createScheduledTask(
  input: CreateScheduledInput,
): Promise<{ ok: boolean; message: string; task?: ScheduledTask }> {
  if (!supabase) return { ok: false, message: "Supabase no configurado: no hay dónde guardar la tarea." };

  const problem = cronError(input.cron);
  if (problem) return { ok: false, message: `Cron inválido: ${problem}` };

  const tz = input.tz || env.SCHEDULED_TZ;
  const next = nextRun(input.cron, tz);
  if (!next) return { ok: false, message: "Ese cron nunca se cumple (revisa día y mes)." };

  const { data, error } = await supabase
    .from("scheduled_tasks")
    .insert({
      title: input.title.trim(),
      prompt: input.prompt.trim(),
      cron: input.cron.trim(),
      tz,
      skills: input.skills ?? [],
      // Congelado AL CREAR: cambiar HERMES_MODEL después no mueve esta tarea.
      model: input.model ?? process.env.HERMES_MODEL ?? null,
      project: input.project ?? null,
      deliver: input.deliver ?? { notify: true },
      next_run_at: next.toISOString(),
      machine: env.MACHINE_NAME,
      created_by: input.createdBy ?? "agent",
    })
    .select("*")
    .single();

  if (error) return { ok: false, message: `Error guardando la tarea: ${error.message}` };
  return {
    ok: true,
    message: `Tarea "${data.title}" programada ${describeCron(data.cron, data.tz)}. Primera corrida: ${next.toLocaleString("es-CO", { timeZone: tz })}.`,
    task: data as ScheduledTask,
  };
}

export async function listScheduledTasks(includeDisabled = true): Promise<ScheduledTask[]> {
  if (!supabase) return [];
  let q = supabase.from("scheduled_tasks").select("*").order("next_run_at", { ascending: true });
  if (!includeDisabled) q = q.eq("enabled", true);
  const { data } = await q;
  return (data ?? []) as ScheduledTask[];
}

export async function getScheduledTask(id: string): Promise<ScheduledTask | null> {
  if (!supabase) return null;
  const { data } = await supabase.from("scheduled_tasks").select("*").eq("id", id).maybeSingle();
  return (data as ScheduledTask) ?? null;
}

export interface UpdateScheduledInput {
  title?: string;
  prompt?: string;
  cron?: string;
  tz?: string;
  skills?: string[];
  model?: string | null;
  project?: string | null;
  deliver?: { notify?: boolean; memory?: boolean };
  enabled?: boolean;
  /** Limpia el bloqueo por fallos y vuelve a agendar. */
  unblock?: boolean;
}

export async function updateScheduledTask(
  id: string,
  input: UpdateScheduledInput,
): Promise<{ ok: boolean; message: string; task?: ScheduledTask }> {
  if (!supabase) return { ok: false, message: "Supabase no configurado." };
  const current = await getScheduledTask(id);
  if (!current) return { ok: false, message: "No existe esa tarea." };

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const key of ["title", "prompt", "skills", "model", "project", "deliver", "enabled"] as const) {
    if (input[key] !== undefined) patch[key] = input[key];
  }

  const cron = input.cron ?? current.cron;
  const tz = input.tz ?? current.tz;
  if (input.cron !== undefined || input.tz !== undefined) {
    const problem = cronError(cron);
    if (problem) return { ok: false, message: `Cron inválido: ${problem}` };
    patch.cron = cron;
    patch.tz = tz;
  }

  // Reagendar si cambió el horario, si se reactivó o si se desbloquea.
  const reschedule =
    input.cron !== undefined || input.tz !== undefined || input.enabled === true || input.unblock;
  if (reschedule) {
    const next = nextRun(cron, tz);
    if (!next) return { ok: false, message: "Ese cron nunca se cumple." };
    patch.next_run_at = next.toISOString();
    patch.retry_at = null;
  }
  if (input.unblock) {
    patch.blocked_reason = null;
    patch.consecutive_failures = 0;
    patch.incident_acked = false;
    patch.incident_signature = null;
  }

  const { data, error } = await supabase
    .from("scheduled_tasks")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) return { ok: false, message: `Error: ${error.message}` };
  return { ok: true, message: `Tarea "${data.title}" actualizada.`, task: data as ScheduledTask };
}

export async function deleteScheduledTask(id: string): Promise<{ ok: boolean; message: string }> {
  if (!supabase) return { ok: false, message: "Supabase no configurado." };
  const { error } = await supabase.from("scheduled_tasks").delete().eq("id", id);
  return error ? { ok: false, message: error.message } : { ok: true, message: "Tarea eliminada." };
}

export async function listTaskRuns(taskId: string, limit = 20): Promise<ScheduledTaskRun[]> {
  if (!supabase) return [];
  const { data } = await supabase
    .from("scheduled_task_runs")
    .select("*")
    .eq("task_id", taskId)
    .order("started_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as ScheduledTaskRun[];
}

/** Tareas vencidas: toca correrlas (o reintentarlas). */
export async function dueTasks(now = new Date()): Promise<ScheduledTask[]> {
  if (!supabase) return [];
  const iso = now.toISOString();
  const { data } = await supabase
    .from("scheduled_tasks")
    .select("*")
    .eq("enabled", true)
    .is("blocked_reason", null)
    .or(`next_run_at.lte.${iso},retry_at.lte.${iso}`)
    .limit(10);
  return (data ?? []) as ScheduledTask[];
}
