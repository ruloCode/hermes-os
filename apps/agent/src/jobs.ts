/**
 * Registro en memoria de los jobs periódicos del agente (panel AUTOMATIZACIONES).
 *
 * Cada módulo registra su job con registerJob() y este archivo se encarga del
 * timer, de medir duración y de acumular el estado de la última corrida.
 * Los datos salen SOLO de este proceso: es memoria pura y se resetea con cada
 * reinicio — a propósito, porque el panel refleja el proceso vivo, no historia.
 */
import type { JobResult, JobStatus } from "@hermes/shared";

/** Estado interno de un job; se proyecta a JobStatus en listJobs(). */
interface JobEntry {
  intervalMs: number;
  lastRunAt: string | null;
  lastDurationMs: number | null;
  lastResult: JobResult | null;
  lastError: string | null;
  lastDetail: string | null;
  nextRunAt: string | null;
  runsOk: number;
  runsError: number;
  /** true mientras la corrida anterior sigue en vuelo (evita solapes). */
  running: boolean;
}

const registry = new Map<string, JobEntry>();

/**
 * Registra un job periódico: corre YA (al registrar) y luego cada intervalMs.
 *
 * - `describe` convierte el resultado en un detalle humano; si devuelve null,
 *   la corrida se marca "skipped" (convención: el job decidió no hacer nada,
 *   p.ej. sin Supabase configurado o ya corriendo).
 * - Los errores del job nunca se propagan: quedan en lastError (200 chars).
 * - Las corridas no se solapan: si la anterior sigue corriendo cuando toca la
 *   siguiente, esa vuelta se salta sin tocar lastResult.
 * - Registrar dos veces el mismo name es un bug: se loguea y no se duplica.
 */
export function registerJob<T>(
  name: string,
  intervalMs: number,
  fn: () => Promise<T>,
  describe?: (result: T) => string | null,
): void {
  if (registry.has(name)) {
    console.error(`[hermes] jobs: "${name}" ya registrado, se ignora`);
    return;
  }

  const entry: JobEntry = {
    intervalMs,
    lastRunAt: null,
    lastDurationMs: null,
    lastResult: null,
    lastError: null,
    lastDetail: null,
    nextRunAt: new Date(Date.now() + intervalMs).toISOString(),
    runsOk: 0,
    runsError: 0,
    running: false,
  };
  registry.set(name, entry);

  const run = async () => {
    if (entry.running) {
      // La corrida anterior sigue viva: saltamos esta vuelta sin tocar estado.
      entry.nextRunAt = new Date(Date.now() + intervalMs).toISOString();
      return;
    }
    entry.running = true;
    const startedAt = Date.now();
    entry.lastRunAt = new Date(startedAt).toISOString();
    try {
      const result = await fn();
      const detail = describe ? describe(result) : null;
      entry.lastDetail = detail;
      // describe devolvió null → el job decidió no hacer nada esta vuelta.
      entry.lastResult = describe && detail === null ? "skipped" : "ok";
      entry.lastError = null;
      if (entry.lastResult === "ok") entry.runsOk++;
    } catch (err) {
      entry.lastResult = "error";
      entry.lastError = String(
        (err as { message?: unknown })?.message ?? err,
      ).slice(0, 200);
      entry.runsError++;
    } finally {
      entry.running = false;
      entry.lastDurationMs = Date.now() - startedAt;
      entry.nextRunAt = new Date(Date.now() + intervalMs).toISOString();
    }
  };

  void run();
  setInterval(() => void run(), intervalMs).unref();
}

/** Estado de todos los jobs registrados, ordenados por nombre. */
export function listJobs(): JobStatus[] {
  return [...registry.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, e]) => ({
      name,
      intervalMs: e.intervalMs,
      lastRunAt: e.lastRunAt,
      lastDurationMs: e.lastDurationMs,
      lastResult: e.lastResult,
      lastError: e.lastError,
      lastDetail: e.lastDetail,
      nextRunAt: e.nextRunAt,
      runsOk: e.runsOk,
      runsError: e.runsError,
    }));
}
