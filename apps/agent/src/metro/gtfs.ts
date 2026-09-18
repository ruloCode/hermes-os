import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { buildNetwork, type MetroConfig, type MetroNetwork } from "@hermes/shared";
import { HERMES_HOME } from "../home.js";

/**
 * Carga del GTFS del sistema de transporte (Tótem de estación). Los archivos
 * viven FUERA del repo en `~/.hermes-os/gtfs/metro/` (override
 * `HERMES_GTFS_DIR`) y la config de nombres en `~/.hermes-os/metro.json`
 * (override `HERMES_METRO_CONFIG`, plantilla en docs/metro.example.json).
 * La red se construye UNA vez por proceso (stop_times pesa ~15 MB: medio
 * segundo) y se reutiliza; sin carpeta → null y las rutas responden 404 con
 * el motivo, no una ruta inventada.
 */

export const GTFS_DIR: string = process.env.HERMES_GTFS_DIR || join(HERMES_HOME, "gtfs", "metro");
export const METRO_CONFIG_PATH: string = process.env.HERMES_METRO_CONFIG || join(HERMES_HOME, "metro.json");

const REQUIRED = ["stops", "routes", "trips", "stop_times"] as const;
const OPTIONAL = ["transfers", "calendar", "calendar_dates"] as const;

export interface MetroLoad {
  net: MetroNetwork;
  dir: string;
  configPath: string | null;
  /** ms que tardó construir la red (log). */
  buildMs: number;
}

let cache: Promise<MetroLoad | null> | null = null;

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

export async function readMetroConfig(): Promise<MetroConfig | null> {
  const raw = await readOptional(METRO_CONFIG_PATH);
  if (raw === undefined) return null;
  const json = JSON.parse(raw) as MetroConfig;
  if (!json || typeof json !== "object") throw new Error(`${METRO_CONFIG_PATH}: la raíz debe ser un objeto`);
  return json;
}

/** Red del sistema (cacheada). null = no hay GTFS en disco. Lanza si el feed está roto. */
export function loadMetro(): Promise<MetroLoad | null> {
  if (!cache) {
    cache = load().catch((err) => {
      cache = null; // que el siguiente request reintente (p. ej. tras descargar el feed)
      throw err;
    });
  }
  return cache;
}

async function load(): Promise<MetroLoad | null> {
  try {
    if (!(await stat(GTFS_DIR)).isDirectory()) return null;
  } catch {
    return null;
  }
  const t0 = performance.now();
  const files: Record<string, string | undefined> = {};
  for (const name of REQUIRED) {
    const text = await readOptional(join(GTFS_DIR, `${name}.txt`));
    if (text === undefined) throw new Error(`GTFS incompleto: falta ${join(GTFS_DIR, `${name}.txt`)}`);
    files[name] = text;
  }
  for (const name of OPTIONAL) files[name] = await readOptional(join(GTFS_DIR, `${name}.txt`));
  const config = await readMetroConfig();
  const net = buildNetwork(
    {
      stops: files.stops!,
      routes: files.routes!,
      trips: files.trips!,
      stop_times: files.stop_times!,
      transfers: files.transfers,
      calendar: files.calendar,
      calendar_dates: files.calendar_dates,
    },
    config ?? {},
  );
  return { net, dir: GTFS_DIR, configPath: config ? METRO_CONFIG_PATH : null, buildMs: Math.round(performance.now() - t0) };
}

/** Olvida la red cacheada (tests, o tras reemplazar el feed). */
export function resetMetroCache(): void {
  cache = null;
}
