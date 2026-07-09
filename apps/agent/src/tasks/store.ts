/**
 * Store de tareas (tracker de misión). Verdad del ESTADO en Supabase (tabla
 * tasks); espejo humano en la nota del vault. Ejecutar una tarea lanza `claude
 * -p` en el repo del proyecto (reusa startClaudeRun) y sigue su fin para marcar
 * el estado. Sin Supabase, todo degrada a no-op (devuelve null/[]).
 */
import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Task, TaskSource, TaskState } from "@hermes/shared";
import { env } from "../env.js";
import { supabase } from "../supabase.js";
import { emit } from "../events.js";
import { safeName } from "../conversations.js";
import { extractSection, getProjectNote, readProjects } from "../vault/projects.js";
import { appendTaskLine, markTaskDone } from "../vault/tasks-note.js";
import { startClaudeRun, subscribeClaudeRun, getClaudeRun } from "../agent/claude-cli.js";
import { getClaudeSession } from "../agent/claude-sessions.js";
import { saveExecution } from "./executions.js";

const expandHome = (p: string) => (p.startsWith("~") ? join(homedir(), p.slice(1)) : p);

function localKey(...parts: string[]): string {
  return createHash("sha1").update(parts.join("|")).digest("hex");
}

// ── Crear / editar ─────────────────────────────────────────────────────

export interface CreateTaskInput {
  project: string;
  title: string;
  detail?: string | null;
  exec_prompt?: string | null;
  source: TaskSource;
  meetingId?: string | null;
  meetingIdx?: number | null;
  status?: TaskState;
  /** false para tareas importadas del vault (ya están en la nota). */
  mirrorToVault?: boolean;
}

export async function createTask(input: CreateTaskInput): Promise<Task | null> {
  if (!supabase) return null;
  const slug = safeName(input.project);
  const title = input.title.trim();
  const key =
    input.source === "meeting" && input.meetingId != null
      ? localKey(slug, "meeting", input.meetingId, String(input.meetingIdx))
      : input.source === "vault"
        ? localKey(slug, "vault", title.toLowerCase())
        : localKey(slug, "manual", title.toLowerCase(), new Date().toISOString());
  const status = input.status ?? "pending";
  const { data, error } = await supabase
    .from("tasks")
    .upsert(
      {
        local_key: key,
        project_slug: slug,
        title,
        detail: input.detail ?? null,
        exec_prompt: input.exec_prompt ?? null,
        status,
        source: input.source,
        meeting_id: input.meetingId ?? null,
        meeting_idx: input.meetingIdx ?? null,
        machine: env.MACHINE_NAME,
      },
      { onConflict: "local_key" },
    )
    .select()
    .single();
  if (error) {
    console.error("[tasks] create:", error.message);
    return null;
  }
  // Espejo al vault (no para ignoradas ni para las que ya venían del vault).
  if (status !== "dismissed" && input.mirrorToVault !== false) {
    void appendTaskLine(input.project, title).catch(() => {});
  }
  return data as Task;
}

export async function updateTask(
  id: number,
  patch: { title?: string; detail?: string },
): Promise<Task | null> {
  if (!supabase) return null;
  const { data } = await supabase
    .from("tasks")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .maybeSingle();
  return (data as Task) ?? null;
}

// ── Lectura ────────────────────────────────────────────────────────────

export async function listTasks(
  opts: { project?: string; status?: TaskState } = {},
): Promise<Task[]> {
  if (!supabase) return [];
  let q = supabase.from("tasks").select("*").order("created_at", { ascending: false }).limit(500);
  if (opts.project) q = q.eq("project_slug", safeName(opts.project));
  if (opts.status) q = q.eq("status", opts.status);
  const { data } = await q;
  return (data ?? []) as Task[];
}

export async function getTask(id: number): Promise<Task | null> {
  if (!supabase) return null;
  const { data } = await supabase.from("tasks").select("*").eq("id", id).maybeSingle();
  return (data as Task) ?? null;
}

/** Tareas ya triadas de una reunión (para superponer estado en el detalle). */
export async function tasksForMeeting(meetingId: string): Promise<Task[]> {
  if (!supabase) return [];
  const { data } = await supabase.from("tasks").select("*").eq("meeting_id", meetingId);
  return (data ?? []) as Task[];
}

// ── Estado ─────────────────────────────────────────────────────────────

export async function setTaskStatus(
  id: number,
  status: TaskState,
  extra: { runId?: string; sessionId?: string } = {},
): Promise<Task | null> {
  if (!supabase) return null;
  const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
  if (extra.runId !== undefined) patch.run_id = extra.runId;
  if (extra.sessionId !== undefined) patch.session_id = extra.sessionId;
  if (status === "done") patch.done_at = new Date().toISOString();
  const { data } = await supabase.from("tasks").update(patch).eq("id", id).select().maybeSingle();
  const task = (data as Task) ?? null;
  if (task && status === "done") void markTaskDone(task.project_slug, task.title).catch(() => {});
  return task;
}

// ── Importar del vault ─────────────────────────────────────────────────

/** Crea tareas (idempotentes) desde "## Tareas Pendientes" de la nota. */
export async function importVaultTasks(project: string): Promise<{ imported: number }> {
  if (!supabase) return { imported: 0 };
  const note = await getProjectNote(project);
  if (!note) return { imported: 0 };
  const slug = safeName(project);
  // Títulos YA trackeados (cualquier fuente) → no re-importar líneas que las
  // tareas manuales/de junta ya espejaron a la nota (evita duplicados).
  const { data: existing } = await supabase.from("tasks").select("title").eq("project_slug", slug);
  const seen = new Set((existing ?? []).map((r) => String(r.title).trim().toLowerCase()));

  const section = extractSection(note.raw, /^#{1,3}\s*.*Tareas Pendientes/i);
  let imported = 0;
  for (const raw of section.split("\n")) {
    const box = raw.match(/^\s*[-*]\s*\[( |x|X)\]\s*(.+)$/);
    const bullet = raw.match(/^\s*[-*]\s+(.+)$/);
    const title = (box ? box[2] : bullet ? bullet[1] : "").trim();
    if (!title || seen.has(title.toLowerCase())) continue;
    seen.add(title.toLowerCase());
    const done = box ? box[1].toLowerCase() === "x" : false;
    const task = await createTask({
      project,
      title,
      source: "vault",
      status: done ? "done" : "pending",
      mirrorToVault: false, // ya está en la nota
    });
    if (task) imported += 1;
  }
  return { imported };
}

// ── Ejecutar ───────────────────────────────────────────────────────────

export interface TaskRunRef {
  task: Task;
  runId: string;
  sessionId: string;
  slug: string;
}

/**
 * Lanza un run de Claude Code para la tarea. Con `resume` continúa la MISMA
 * sesión (mismo transcript) vía `claude --resume`; si no, arranca una nueva.
 * Marca la tarea como running y, al terminar el run, refleja done/pending.
 */
async function launch(
  task: Task,
  opts: { prompt: string; resume: boolean; label: string },
): Promise<TaskRunRef> {
  const p = (await readProjects()).find(
    (x) => x.slug.toLowerCase() === task.project_slug.toLowerCase(),
  );
  const cwd = p?.ruta_local ? expandHome(p.ruta_local) : undefined;
  const slug = p?.slug ?? task.project_slug;

  let sessionId = task.session_id ?? randomUUID();
  let resumeSdkSessionId: string | undefined;
  if (opts.resume && task.session_id) {
    sessionId = task.session_id;
    const existing = await getClaudeSession(slug, task.session_id);
    resumeSdkSessionId = existing?.sdkSessionId ?? task.session_id;
  }

  const run = startClaudeRun({
    prompt: opts.prompt,
    projectContext: slug,
    cwd,
    projectSlug: slug,
    sessionId,
    resumeSdkSessionId,
    // acceptEdits explícito: la ejecución la aprobó un humano (triage
    // "Ejecutar" o botón del dashboard) y la deny-list de claude-settings.json
    // bloquea lo destructivo. Sin esto caería al default restrictivo y la
    // tarea no podría editar archivos en modo headless.
    permissionMode: "acceptEdits",
  });
  await setTaskStatus(task.id, "running", { runId: run.id, sessionId });
  emit({ kind: "task_start", taskId: run.id, detail: `${opts.label}: ${task.title.slice(0, 100)}` });

  const unsub = subscribeClaudeRun(run.id, (line) => {
    if ((line.kind === "done" || line.kind === "error") && line.text.includes("finaliz")) {
      void setTaskStatus(task.id, line.kind === "done" ? "done" : "pending", {
        runId: run.id,
        sessionId,
      });
      // Memoria de la ejecución: documento {prompt · análisis · resultado} en el
      // vault + espejo en Supabase. El run sigue vivo aquí (ventana de 5 min), así
      // que run.lines y las métricas ya están pobladas. Best-effort, no bloquea.
      void saveExecution({
        task,
        prompt: opts.prompt,
        kind: opts.label === "continuar" ? "continue" : "execute",
        runId: run.id,
        sessionId,
        slug,
        status: line.kind === "done" ? "done" : "error",
        lines: run.lines,
        model: run.model,
        effort: run.effort,
        costUsd: run.costUsd,
        durationMs: run.durationMs,
        numTurns: run.numTurns,
      }).catch((e) => console.error("[executions]", e));
      unsub?.();
    }
  });

  return { task, runId: run.id, sessionId, slug };
}

/** Ejecuta la tarea (sesión nueva) con su exec_prompt. */
export async function executeTask(id: number): Promise<TaskRunRef | null> {
  const task = await getTask(id);
  if (!task) return null;
  const prompt =
    task.exec_prompt?.trim() ||
    `En el proyecto ${task.project_slug}, ejecuta esta tarea: ${task.title}${task.detail ? `\n${task.detail}` : ""}`;
  return launch(task, { prompt, resume: false, label: "tarea" });
}

/** Continúa la tarea: resume su sesión con un prompt nuevo (o "continúa"). */
export async function continueTask(id: number, prompt?: string): Promise<TaskRunRef | null> {
  const task = await getTask(id);
  if (!task) return null;
  const p = (prompt ?? "").trim() || "Continúa con la tarea donde te quedaste.";
  return launch(task, { prompt: p, resume: true, label: "continuar" });
}

/**
 * Arregla tareas que quedaron 'running' pero cuyo run ya no vive (típico: el
 * agente se reinició a mitad del run y se perdió la suscripción que marcaba el
 * fin). Si la sesión persistida terminó ok → done; si no → pending (reintentar).
 * Se corre al bootear el agente y bajo demanda.
 */
export async function reconcileRunningTasks(): Promise<number> {
  if (!supabase) return 0;
  const { data } = await supabase.from("tasks").select("*").eq("status", "running");
  const running = (data ?? []) as Task[];
  let fixed = 0;
  for (const t of running) {
    // Sigue vivo de verdad en este proceso → no tocar.
    if (t.run_id && getClaudeRun(t.run_id)?.status === "running") continue;
    let status: TaskState = "pending";
    if (t.session_id) {
      const sess = await getClaudeSession(t.project_slug, t.session_id);
      if (sess?.status === "done") status = "done";
    }
    await setTaskStatus(t.id, status);
    fixed += 1;
  }
  if (fixed) console.log(`[tasks] reconciliadas ${fixed} tareas 'running' huérfanas`);
  return fixed;
}
