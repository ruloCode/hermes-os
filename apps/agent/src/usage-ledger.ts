/**
 * Registro de gasto por llamada al modelo (lado de disco).
 *
 * tracked-query.ts deja aquí una línea por turno: función, modelo, tokens,
 * caché, costo estimado y latencia. Vive en ~/.hermes-os/usage/ (no en el repo:
 * lo comparten producción y un agente de ensayo, y sobrevive a un `git clean`).
 * La lógica de lectura y agregación es pura y está en @hermes/shared.
 *
 * No reemplaza a usage.ts (el registro por RUN de la Oficina): aquel cuenta
 * runs con personaje; este cuenta TODA llamada al modelo.
 */
import { appendFile, mkdir, readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { callDay, lastDays, localDay, parseCallEntry, summarizeCalls, type CallEntry, type UsageSummary } from "@hermes/shared";

/** HERMES_USAGE_DIR existe para los tests (carpeta temporal). */
export function usageDir(): string {
  return process.env.HERMES_USAGE_DIR || join(process.env.HERMES_HOME || join(homedir(), ".hermes-os"), "usage");
}

function fileFor(day: string): string {
  return join(usageDir(), `calls-${day}.jsonl`);
}

// Una sola cadena de escritura: dos turnos que terminan a la vez no intercalan sus líneas.
let chain: Promise<unknown> = Promise.resolve();

/** Deja la línea del turno. Nunca lanza: medir no puede tumbar la llamada que se mide. */
export function recordCall(entry: CallEntry): void {
  chain = chain
    .then(async () => {
      await mkdir(usageDir(), { recursive: true });
      await appendFile(fileFor(callDay(entry)), `${JSON.stringify(entry)}\n`, "utf8");
    })
    .catch((err) => console.error("[usage] no se pudo registrar la llamada:", err));
}

/** Espera a que lo pendiente esté en disco (tests y lecturas). */
export async function flushCalls(): Promise<void> {
  await chain.catch(() => {});
}

/** Las llamadas de un día local (AAAA-MM-DD). */
export async function readCallsOfDay(day: string): Promise<CallEntry[]> {
  await flushCalls();
  let raw: string;
  try {
    raw = await readFile(fileFor(day), "utf8");
  } catch {
    return [];
  }
  const out: CallEntry[] = [];
  for (const line of raw.split("\n")) {
    const e = line.trim() ? parseCallEntry(line) : null;
    if (e) out.push(e);
  }
  return out;
}

/** Las llamadas de los últimos `days` días (hoy incluido). */
export async function readCalls(days: number, today: string = localDay(new Date())): Promise<CallEntry[]> {
  const out: CallEntry[] = [];
  for (const day of lastDays(today, Math.max(1, Math.min(days, 90)))) out.push(...(await readCallsOfDay(day)));
  return out;
}

/** Resumen por función, modelo y día de los últimos `days` días. */
export async function usageSummary(days: number): Promise<UsageSummary> {
  const n = Math.max(1, Math.min(days, 90));
  return summarizeCalls(await readCalls(n), n);
}

/** Primer día con registro en disco (para decir "se mide desde…"). null = aún no hay nada. */
export async function firstDayWithCalls(): Promise<string | null> {
  try {
    const days = (await readdir(usageDir()))
      .map((name) => /^calls-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(name)?.[1])
      .filter((d): d is string => Boolean(d))
      .sort();
    return days[0] ?? null;
  } catch {
    return null;
  }
}
