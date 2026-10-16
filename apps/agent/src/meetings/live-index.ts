/**
 * Índice DURABLE sesión en vivo → junta (`~/.hermes-os/live-sessions.json`).
 *
 * Las sesiones en vivo viven en memoria y se olvidan 10 min después de
 * cerrar; el agente además puede reiniciarse. Cuando el teléfono sube el
 * archivo completo de una junta que también mandó en vivo, hay que saber QUÉ
 * acta salió de esa sesión para completarla en vez de crear otra.
 *
 * Estados:
 * - `done`    → la ingesta en vivo creó `meetingId`.
 * - `pending` → la ingesta falló y el snapshot quedó para el recover del boot.
 * - `error`   → terminó sin acta (junta muy corta, abandonada).
 * Además guarda `completionJobId`: el job que completó la sesión con el archivo
 * del teléfono (dos subidas distintas de la misma sesión no hacen dos juntas).
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { LiveClientKind } from "@hermes/shared";

export type LiveOutcomeStatus = "done" | "pending" | "error";

export interface LiveIndexEntry {
  status?: LiveOutcomeStatus;
  meetingId?: string;
  project?: string;
  coachMode?: string;
  client?: LiveClientKind;
  error?: string;
  /** ISO de la última escritura. */
  at: string;
  completionJobId?: string;
}

type LiveIndex = Record<string, LiveIndexEntry>;

// Override para tests y agentes de ensayo (no tocar ~/.hermes-os).
const indexPath = () =>
  process.env.HERMES_LIVE_INDEX_PATH || join(homedir(), ".hermes-os", "live-sessions.json");

// Las entradas viejas ya no le sirven a nadie: el teléfono sube en horas, no meses.
const MAX_AGE_MS = 90 * 24 * 60 * 60_000;

/** Id de sesión en vivo seguro (8 hex de randomUUID; tolera ids de prueba). */
export const isLiveSessionId = (id: unknown): id is string =>
  typeof id === "string" && /^[A-Za-z0-9_-]{4,64}$/.test(id);

async function readIndex(): Promise<LiveIndex> {
  try {
    const parsed = JSON.parse(await readFile(indexPath(), "utf8")) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as LiveIndex) : {};
  } catch {
    return {};
  }
}

// Escrituras en cadena: dos cierres casi simultáneos no se pisan el archivo.
let chain: Promise<unknown> = Promise.resolve();
function mutate<T>(fn: (idx: LiveIndex) => T): Promise<T> {
  const next = chain.then(async () => {
    const idx = await readIndex();
    const out = fn(idx);
    const cutoff = Date.now() - MAX_AGE_MS;
    for (const [k, v] of Object.entries(idx)) if (Date.parse(v.at) < cutoff) delete idx[k];
    const path = indexPath();
    await mkdir(dirname(path), { recursive: true });
    // tmp + rename: un corte a mitad de escritura no deja el JSON roto.
    const tmp = `${path}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(idx, null, 2), "utf8");
    await rename(tmp, path);
    return out;
  });
  chain = next.catch(() => undefined);
  return next;
}

export async function getLiveOutcome(id: string): Promise<LiveIndexEntry | undefined> {
  await chain.catch(() => undefined);
  return (await readIndex())[id];
}

/** Anota cómo terminó una sesión en vivo. Nunca lanza (el cierre no depende de esto). */
export async function recordLiveOutcome(
  id: string,
  entry: Omit<LiveIndexEntry, "at" | "completionJobId">,
): Promise<void> {
  try {
    await mutate((idx) => {
      idx[id] = { ...idx[id], ...entry, at: new Date().toISOString() };
    });
  } catch (err) {
    console.error("[live] índice de sesiones:", String(err).slice(0, 160));
  }
}

/** Suelta un reclamo cuyo job no llegó a crearse (solo si sigue siendo suyo). */
export function releaseCompletion(id: string, jobId: string): Promise<void> {
  return mutate((idx) => {
    if (idx[id]?.completionJobId === jobId) delete idx[id].completionJobId;
  });
}

/**
 * Reclama la completación de una sesión para `jobId`. Si otro job ya la
 * reclamó, devuelve ESE id (y no se crea otro).
 */
export function claimCompletion(id: string, jobId: string): Promise<string> {
  return mutate((idx) => {
    const prev = idx[id]?.completionJobId;
    if (prev) return prev;
    idx[id] = { ...idx[id], completionJobId: jobId, at: new Date().toISOString() };
    return jobId;
  });
}
