/**
 * Dónde vive la hoja de preparación: `~/.hermes-os/meetings/prep/<proyecto>/<día>.json`.
 *
 * Módulo aparte (y sin importar nada de las juntas) porque lo leen dos lados:
 * `prep.ts`, que la genera, y `meeting-context.ts`, que la mete al contexto del
 * copiloto al arrancar una junta en vivo. Si viviera en prep.ts habría un
 * ciclo meeting-context ↔ prep.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { MeetingPrep } from "@hermes/shared";
import { todayBogota } from "../dates.js";

/** Se resuelve en cada llamada: los tests apuntan HERMES_HOME a una carpeta temporal. */
export function prepDir(): string {
  return join(process.env.HERMES_HOME || join(homedir(), ".hermes-os"), "meetings", "prep");
}

/** El slug como nombre de carpeta: sin barras ni puntos (nada de salirse de prep/). */
function safeSlug(project: string): string {
  return project.toLowerCase().replace(/[^a-z0-9_-]/g, "");
}

export function prepPath(project: string, day: string): string {
  return join(prepDir(), safeSlug(project), `${day.replace(/[^0-9-]/g, "")}.json`);
}

export async function readPrep(project: string, day: string = todayBogota()): Promise<MeetingPrep | null> {
  if (!safeSlug(project)) return null;
  try {
    const prep = JSON.parse(await readFile(prepPath(project, day), "utf8")) as MeetingPrep;
    return prep && prep.version === 1 && prep.day === day ? prep : null;
  } catch {
    return null; // no existe o quedó corrupta: como si no hubiera
  }
}

export async function writePrep(prep: MeetingPrep): Promise<void> {
  const path = prepPath(prep.project, prep.day);
  await mkdir(join(prepDir(), safeSlug(prep.project)), { recursive: true });
  // Escribir y renombrar: una lectura a mitad (el copiloto arrancando) nunca ve medio JSON.
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(prep, null, 2)}\n`, "utf8");
  await rename(tmp, path);
}
