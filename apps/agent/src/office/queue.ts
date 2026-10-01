// Cola de tareas de la Oficina: lo que le pasas (issues de Linear o tareas
// que propone el coordinador) se reparte a agentes NUEVOS, de a `max` a la vez.
// Cada tarea es un run real de `claude -p` (aparece en su escritorio como
// cualquier otro); los issues de Linear van por su puente (pasan a In
// Progress y se comenta el resultado). La lógica pura está en
// packages/shared/src/office-queue.ts; aquí se guarda y se corre.
//
// Se guarda en ~/.hermes-os/oficina/cola.json: un reinicio del agente no
// pierde lo encolado (lo que corría pasa a error con el motivo).

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  clampMax,
  nextToStart,
  pruneFinished,
  reconcileRunning,
  validateNewItems,
  type NewQueueItem,
  type QueueItem,
  type QueueState,
} from "@hermes/shared";
import { emit } from "../events.js";
import { getClaudeRun, startClaudeRun } from "../agent/claude-cli.js";
import { readProjects, resolveProjectRoot } from "../vault/projects.js";
import { executeLinearIssue } from "../linear-run.js";

export const QUEUE_PATH = process.env.HERMES_QUEUE_PATH || join(homedir(), ".hermes-os", "oficina", "cola.json");

let state: QueueState = { max: 1, items: [] };
let loaded = false;
let ticking = false;
/** Modo de permisos con que corren las tareas de la cola (el de la Oficina: Auto). */
let mode = "auto";

async function load() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = JSON.parse(await readFile(QUEUE_PATH, "utf8")) as Partial<QueueState> & { mode?: string };
    state = { max: clampMax(raw.max), items: Array.isArray(raw.items) ? raw.items : [] };
    if (typeof raw.mode === "string") mode = raw.mode;
  } catch {
    /* sin archivo: cola vacía */
  }
}

async function save() {
  await mkdir(dirname(QUEUE_PATH), { recursive: true });
  await writeFile(QUEUE_PATH, JSON.stringify({ ...state, mode }, null, 2));
}

export async function queueState(): Promise<QueueState & { mode: string }> {
  await load();
  return { ...state, mode };
}

/** Encola tareas. Devuelve las que entraron y las rechazadas (con el motivo). */
export async function enqueue(input: NewQueueItem[]): Promise<{ added: QueueItem[]; rejected: string[] }> {
  await load();
  const { ok, rejected } = validateNewItems(state, input);
  const now = new Date().toISOString();
  const added = ok.map(
    (n): QueueItem => ({
      id: randomUUID(),
      title: n.title,
      prompt: n.prompt,
      project: n.project ?? "general",
      source: n.source ?? "manual",
      ...(n.linearId ? { linearId: n.linearId } : {}),
      status: "queued",
      createdAt: now,
    }),
  );
  state.items.push(...added);
  await save();
  if (added.length) emit({ kind: "tool_call", toolName: "cola", detail: `${added.length} ${added.length === 1 ? "tarea encolada" : "tareas encoladas"}` });
  void tick();
  return { added, rejected };
}

/** Saca de la cola una tarea que no ha arrancado (lo que ya corre se detiene desde su panel). */
export async function cancelQueued(id: string): Promise<{ ok: boolean; error?: string }> {
  await load();
  const it = state.items.find((i) => i.id === id);
  if (!it) return { ok: false, error: "no está en la cola" };
  if (it.status !== "queued") return { ok: false, error: "ya arrancó: detenla desde el panel del agente" };
  it.status = "canceled";
  it.finishedAt = new Date().toISOString();
  await save();
  return { ok: true };
}

export async function setQueueSettings(input: { max?: unknown; mode?: unknown }): Promise<QueueState & { mode: string }> {
  await load();
  if (input.max !== undefined) state.max = clampMax(input.max);
  if (typeof input.mode === "string" && ["auto", "acceptEdits", "plan", "default", "manual"].includes(input.mode)) mode = input.mode;
  await save();
  void tick();
  return { ...state, mode };
}

async function startItem(it: QueueItem): Promise<void> {
  if (it.linearId) {
    // El puente de Linear ya hace todo: In Progress, run y comentario al final.
    const ref = await executeLinearIssue(it.linearId);
    if (!ref) throw new Error("no se pudo ejecutar el issue (¿Supabase o Linear?)");
    it.runId = ref.runId;
    return;
  }
  let cwd: string | undefined;
  if (it.project && it.project !== "general") {
    const p = (await readProjects()).find((x) => x.slug.toLowerCase() === it.project.toLowerCase());
    // Correr en la carpeta equivocada es peor que no correr.
    cwd = p ? (resolveProjectRoot(p) ?? undefined) : undefined;
    if (!cwd) throw new Error(`no encuentro la carpeta del proyecto ${it.project} en esta máquina`);
  }
  const run = startClaudeRun({
    prompt: it.prompt,
    permissionMode: mode,
    projectContext: it.project !== "general" ? it.project : undefined,
    cwd,
    projectSlug: it.project || "general",
    sessionId: randomUUID(),
  });
  emit({ kind: "task_start", taskId: run.id, detail: `cola: ${it.title.slice(0, 100)}` });
  it.runId = run.id;
}

/** Concilia lo que corre con sus runs y arranca lo siguiente. */
export async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    await load();
    const now = new Date().toISOString();
    const finished = reconcileRunning(state.items, (runId) => getClaudeRun(runId)?.status, now);
    for (const it of finished) emit({ kind: it.status === "done" ? "task_done" : "error", detail: `cola: ${it.title.slice(0, 100)}` });
    let changed = finished.length > 0;
    for (const it of nextToStart(state)) {
      it.status = "running";
      it.startedAt = new Date().toISOString();
      try {
        await startItem(it);
      } catch (err) {
        it.status = "error";
        it.finishedAt = new Date().toISOString();
        it.error = String((err as Error).message ?? err).slice(0, 200);
      }
      changed = true;
    }
    if (changed) {
      state.items = pruneFinished(state.items);
      await save();
    }
  } finally {
    ticking = false;
  }
}

let timer: ReturnType<typeof setInterval> | null = null;
export function startQueue() {
  if (timer || process.env.HERMES_JOBS === "off") return;
  timer = setInterval(() => void tick().catch((e) => console.error("[cola]", e)), 3000);
  void tick().catch((e) => console.error("[cola]", e));
}
