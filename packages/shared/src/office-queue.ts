// Cola de tareas de la Oficina (puro: sin fs, red ni procesos). Le pasas
// trabajo —un issue de Linear o tareas que propone el coordinador— y la cola
// lo reparte a agentes nuevos sin pasar de un tope de concurrencia. El agente
// (apps/agent/src/office/queue.ts) corre los runs; aquí solo se decide qué
// arranca, cómo cambia cada tarea y qué se ve.
//
// Honestidad: "en curso" existe solo con un run vivo detrás (runId); si el
// agente se reinició y el run ya no existe, la tarea pasa a error con el motivo.

export type QueueStatus = "queued" | "running" | "done" | "error" | "canceled";

export interface QueueItem {
  id: string;
  title: string;
  /** Lo que se le pide al agente (para issues de Linear, el issue manda su propio prompt). */
  prompt: string;
  /** Slug del proyecto del vault ("general" = sin proyecto). */
  project: string;
  source: "linear" | "plan" | "manual";
  /** Issue de Linear (RUL-12): se ejecuta con el puente de Linear (pasa a In Progress, comenta al final). */
  linearId?: string;
  status: QueueStatus;
  runId?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
}

export interface QueueState {
  /** Cuántos agentes de la cola corren a la vez (1-3). */
  max: number;
  items: QueueItem[];
}

export const QUEUE_MAX_LIMIT = 3;
/** Terminadas que se guardan (las más recientes); las viejas se van. */
export const QUEUE_KEEP_FINISHED = 20;

export function clampMax(n: unknown): number {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(QUEUE_MAX_LIMIT, Math.max(1, v)) : 1;
}

export function queueCounts(items: readonly QueueItem[]): Record<QueueStatus, number> {
  const out: Record<QueueStatus, number> = { queued: 0, running: 0, done: 0, error: 0, canceled: 0 };
  for (const i of items) out[i.status]++;
  return out;
}

/** Las que toca arrancar ahora: en orden de llegada, hasta llenar el tope. */
export function nextToStart(state: QueueState): QueueItem[] {
  const free = clampMax(state.max) - state.items.filter((i) => i.status === "running").length;
  if (free <= 0) return [];
  return state.items.filter((i) => i.status === "queued").slice(0, free);
}

export interface NewQueueItem {
  title: string;
  prompt: string;
  project?: string;
  source?: QueueItem["source"];
  linearId?: string;
}

/**
 * Valida y normaliza lo que llega a la cola. Sin título o sin prompt no entra;
 * un issue de Linear que ya está en cola o corriendo tampoco (no se duplica).
 */
export function validateNewItems(state: QueueState, input: readonly NewQueueItem[]): { ok: NewQueueItem[]; rejected: string[] } {
  const ok: NewQueueItem[] = [];
  const rejected: string[] = [];
  const live = new Set(state.items.filter((i) => i.status === "queued" || i.status === "running").map((i) => i.linearId).filter(Boolean));
  for (const raw of input) {
    const title = String(raw?.title ?? "").trim().slice(0, 140);
    const prompt = String(raw?.prompt ?? "").trim();
    if (!title || (!prompt && !raw.linearId)) {
      rejected.push(title || "(sin título)");
      continue;
    }
    if (raw.linearId && live.has(raw.linearId)) {
      rejected.push(`${raw.linearId} ya está en la cola`);
      continue;
    }
    if (raw.linearId) live.add(raw.linearId);
    ok.push({ ...raw, title, prompt: prompt.slice(0, 8000), project: String(raw.project || "general") });
  }
  return { ok, rejected };
}

/** Recorta las terminadas viejas: quedan todas las vivas y las últimas N terminadas. */
export function pruneFinished(items: readonly QueueItem[]): QueueItem[] {
  const finished = items.filter((i) => i.status !== "queued" && i.status !== "running");
  const keep = new Set(
    finished
      .slice()
      .sort((a, b) => (b.finishedAt ?? b.createdAt).localeCompare(a.finishedAt ?? a.createdAt))
      .slice(0, QUEUE_KEEP_FINISHED)
      .map((i) => i.id),
  );
  return items.filter((i) => i.status === "queued" || i.status === "running" || keep.has(i.id));
}

/**
 * Concilia las que figuran "en curso" con el estado real de su run:
 * `runStatus(runId)` devuelve el del motor, o undefined si el run ya no existe
 * (reinicio del agente). Devuelve las que cambiaron.
 */
export function reconcileRunning(
  items: QueueItem[],
  runStatus: (runId: string) => "running" | "done" | "error" | undefined,
  now: string,
): QueueItem[] {
  const changed: QueueItem[] = [];
  for (const it of items) {
    if (it.status !== "running") continue;
    const st = it.runId ? runStatus(it.runId) : undefined;
    if (st === "running") continue;
    it.status = st === "done" ? "done" : "error";
    it.finishedAt = now;
    if (st === undefined) it.error = "El run ya no existe (el agente se reinició)";
    else if (st === "error") it.error = "El run terminó con error";
    changed.push(it);
  }
  return changed;
}
