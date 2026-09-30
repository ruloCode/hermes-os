// Estado vivo de la Oficina de agentes (/oficina): un personaje por sesión del
// Agent SDK o run de `claude -p`, reducido desde el bus de actividad con la
// lógica pura de @hermes/shared (office.ts). El browser no reduce nada: recibe
// un snapshot al conectarse a GET /office/events y luego un mensaje por cada
// personaje que cambia.
//
// Canal PROPIO a propósito: meter estas actualizaciones en el bus general
// duplicaría cada tool call y empujaría fuera los eventos reales del búfer
// corto de /events y del feed del dashboard.

import {
  GENERAL_PROJECT,
  reduceOfficeEvent,
  registerWorker,
  setWorkerApproval,
  tickOffice,
  type ApprovalOutcome,
  type OfficeApproval,
  type OfficeProject,
  type OfficeRegistration,
  type OfficeState,
  type OfficeUpdate,
  type OfficeWorker,
} from "@hermes/shared";
import { subscribe } from "../events.js";
import { env } from "../env.js";
import { readProjects } from "../vault/projects.js";
import { CONTENT_PROJECT_SLUG } from "../content/store.js";

type Listener = (update: OfficeUpdate) => void;

const workers = new Map<string, OfficeWorker>();
const listeners = new Set<Listener>();
const TICK_MS = 2000;

function publish(update: OfficeUpdate) {
  for (const l of listeners) {
    try {
      l(update);
    } catch {
      /* suscriptor caído */
    }
  }
}

/** Las sesiones del Estudio no traen proyecto: son todas del proyecto de contenido. */
function placeProject(w: OfficeWorker) {
  if (w.project === GENERAL_PROJECT && w.source.startsWith("content-")) w.project = CONTENT_PROJECT_SLUG;
}

/**
 * Lo llaman los puntos de arranque (run de claude -p, tarea async, edición,
 * programada) para que el personaje nazca con su proyecto y su título, antes
 * del primer evento. Si un punto de arranque no lo llama, el personaje igual
 * nace con el primer evento, en el pod "general".
 */
export function registerOfficeWorker(reg: Omit<OfficeRegistration, "machine">): void {
  const w = registerWorker(workers, { ...reg, machine: env.MACHINE_NAME });
  placeProject(w);
  // Una conversación que continúa: el personaje anterior se va y el nuevo hereda su escritorio.
  if (w.replaced) {
    publish({ type: "removed", id: w.replaced });
    delete w.replaced;
  }
  publish({ type: "worker", worker: w });
}

/**
 * Abre o cierra el "te necesita" de un personaje (lo llama office/approvals.ts).
 * Devuelve false si el personaje ya no existe o terminó.
 */
export function setOfficeApproval(id: string, approval: OfficeApproval | null, outcome?: ApprovalOutcome): boolean {
  const w = setWorkerApproval(workers, id, approval, outcome);
  if (!w) return false;
  publish({ type: "worker", worker: w });
  return true;
}

// Quién está mirando la Oficina: pedir permiso solo tiene sentido si alguien
// puede darlo. Cada conexión a GET /office/events cuenta mientras dure.
let viewers = 0;

export function officeViewerJoined(): () => void {
  viewers += 1;
  let left = false;
  return () => {
    if (left) return;
    left = true;
    viewers = Math.max(0, viewers - 1);
  };
}

export function officeWatched(): boolean {
  return viewers > 0;
}

export function subscribeOffice(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function officeWorkers(): OfficeWorker[] {
  return [...workers.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

/** Proyectos activos del vault (los pods). Si el vault falla, la oficina sigue con "general". */
async function officeProjects(): Promise<OfficeProject[]> {
  try {
    const projects = await readProjects();
    return projects
      .filter((p) => p.estado === "activo")
      .map((p) => ({ slug: p.slug, name: p.name || p.slug, estado: p.estado }));
  } catch {
    return [];
  }
}

export async function officeState(): Promise<OfficeState> {
  return {
    workers: officeWorkers(),
    projects: await officeProjects(),
    machine: env.MACHINE_NAME,
    ts: new Date().toISOString(),
  };
}

let started = false;

/** Se engancha al bus y arranca el reloj (pensando por silencio, salida tras la gracia). Idempotente. */
export function startOffice(): void {
  if (started) return;
  started = true;
  subscribe((ev) => {
    const w = reduceOfficeEvent(workers, ev);
    if (!w) return;
    placeProject(w);
    publish({ type: "worker", worker: w });
  });
  const timer = setInterval(() => {
    const { changed, removed } = tickOffice(workers);
    for (const w of changed) publish({ type: "worker", worker: w });
    for (const id of removed) publish({ type: "removed", id });
  }, TICK_MS);
  timer.unref();
}
