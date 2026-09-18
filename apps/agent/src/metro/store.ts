import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  activeNotices,
  EstacionConfigError,
  localClock,
  matchStations,
  nextDepartures,
  networkSummary,
  noticesForLines,
  parseMetroStatus,
  parsePlaces,
  placesNear,
  planRoute,
  resolveStation,
  stationsWithPlaces,
  type MetroNotice,
  type RoutePlan,
  type StationPlace,
} from "@hermes/shared";
import { HERMES_HOME } from "../home.js";
import { salaStation } from "../sala/store.js";
import { loadMetro, GTFS_DIR } from "./gtfs.js";

/**
 * Lo que el tótem responde, sobre datos REALES:
 *  - la ruta sale del GTFS (metro/gtfs.ts),
 *  - las novedades del servicio de `~/.hermes-os/metro-status.json` (no hay
 *    API pública de estado: lo escribe el humano),
 *  - los lugares cerca de una estación de `~/.hermes-os/lugares.json`.
 *
 * Sin archivo → lista vacía y la UI no pinta nada. Un JSON roto NO se traga en
 * silencio: se devuelve el motivo con la ruta del archivo, como sala.json.
 */

export const METRO_STATUS_PATH: string = process.env.HERMES_METRO_STATUS_PATH || join(HERMES_HOME, "metro-status.json");
export const PLACES_PATH: string = process.env.HERMES_PLACES_PATH || join(HERMES_HOME, "lugares.json");
/** Zona del sistema de transporte: la del feed (agency_timezone) o la del .env. */
export const METRO_TZ: string = process.env.HERMES_METRO_TZ || process.env.WEATHER_TZ || "America/Bogota";

async function readJson(path: string): Promise<unknown | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new EstacionConfigError(`${path}: JSON inválido (${(err as Error).message})`);
  }
}

/** Novedades del servicio VIGENTES ahora. Sin archivo → []. */
export async function readStatus(): Promise<{ notices: MetroNotice[]; all: MetroNotice[]; path: string; exists: boolean }> {
  const raw = await readJson(METRO_STATUS_PATH);
  if (raw === null) return { notices: [], all: [], path: METRO_STATUS_PATH, exists: false };
  const all = parseMetroStatus(raw);
  const clock = localClock(new Date(), METRO_TZ);
  const nowIso = `${clock.date.slice(0, 4)}-${clock.date.slice(4, 6)}-${clock.date.slice(6, 8)}T${String(Math.floor(clock.seconds / 3600)).padStart(2, "0")}:${String(Math.floor((clock.seconds % 3600) / 60)).padStart(2, "0")}`;
  return { notices: activeNotices(all, nowIso), all, path: METRO_STATUS_PATH, exists: true };
}

/** Lugares cargados. Sin archivo → []. */
export async function readPlaces(): Promise<{ places: StationPlace[]; path: string; exists: boolean }> {
  const raw = await readJson(PLACES_PATH);
  if (raw === null) return { places: [], path: PLACES_PATH, exists: false };
  return { places: parsePlaces(raw), path: PLACES_PATH, exists: true };
}

export interface RouteAnswer {
  ok: boolean;
  error?: string;
  /** Candidatas cuando un nombre no se reconoce (para que el agente repregunte). */
  suggestions?: string[];
  plan?: {
    from: string;
    to: string;
    minutes: number;
    rideMinutes: number;
    transferMinutes: number;
    transfers: number;
    transferEstimated: boolean;
    legs: {
      line: string;
      lineName: string;
      color: string;
      kind: string;
      from: string;
      to: string;
      headsign: string | null;
      stations: string[];
      stops: number;
      minutes: number;
    }[];
  };
  /** Novedades vigentes que tocan alguna línea del plan. */
  notices?: { line: string; text: string; severity: string; delayMin: number | null }[];
  /** Próximas salidas en el origen (horario del feed). */
  next?: { line: string; headsign: string; inMinutes: number[] }[];
  /** true = el feed venció y las salidas son horario de referencia. */
  scheduleStale?: boolean;
  /** Texto de una línea para la voz. */
  say?: string;
}

function publicPlan(plan: RoutePlan): NonNullable<RouteAnswer["plan"]> {
  return {
    from: plan.from.name,
    to: plan.to.name,
    minutes: plan.minutes,
    rideMinutes: plan.rideMinutes,
    transferMinutes: plan.transferMinutes,
    transfers: plan.transfers,
    transferEstimated: plan.transferEstimated,
    legs: plan.legs.map((l) => ({
      line: l.lineShort,
      lineName: l.lineName,
      color: l.color,
      kind: l.kind,
      from: l.fromName,
      to: l.toName,
      headsign: l.headsign,
      stations: l.stations,
      stops: l.stopsCount,
      minutes: l.minutes,
    })),
  };
}

/** Frase corta para la voz: la ruta como la diría alguien en el andén. */
export function sayPlan(plan: RoutePlan): string {
  const legs = plan.legs.map((l, i) => {
    const head = i === 0 ? `la ${l.lineName}` : `la ${l.lineName}`;
    const dir = l.headsign ? ` sentido ${l.headsign}` : "";
    return `${head}${dir} hasta ${l.toName}`;
  });
  const chain =
    legs.length === 1 ? `Toma ${legs[0]}` : `Toma ${legs[0]}, ahí cambias a ${legs.slice(1).join(", y luego a ")}`;
  const tr = plan.transfers === 0 ? "sin transbordos" : plan.transfers === 1 ? "un transbordo" : `${plan.transfers} transbordos`;
  return `${chain}. Son ${plan.minutes} minutos y ${tr}.`;
}

/**
 * Ruta entre dos lugares dichos en lenguaje natural. Nunca inventa: si no
 * reconoce un nombre, devuelve candidatas. Sin origen (el caso normal en el
 * tótem: el viajero solo dice a dónde va) el origen es la estación donde está
 * plantada la pantalla, de sala.json.station.
 */
export async function routeBetween(fromText: string, toText: string): Promise<RouteAnswer> {
  const loaded = await loadMetro();
  if (!loaded) return { ok: false, error: `No hay datos del sistema en ${GTFS_DIR}` };
  const { net } = loaded;
  if (!fromText.trim()) {
    const station = await salaStation().catch(() => null);
    if (!station) return { ok: false, error: "falta el origen y esta pantalla no tiene estación configurada" };
    fromText = station.name;
  }
  const from = resolveStation(net, fromText);
  const to = resolveStation(net, toText);
  if (!from || !to) {
    const missing = !from ? fromText : toText;
    const near = matchStations(net, missing, 4).map((m) => m.station.name);
    return {
      ok: false,
      error: `No reconozco la estación "${missing}"`,
      suggestions: near.length ? near : networkSummary(net).stations.slice(0, 6).map((s) => s.name),
    };
  }
  if (from.station.key === to.station.key) {
    return { ok: false, error: `${from.station.name} es el mismo punto de origen y destino` };
  }
  const plan = planRoute(net, from.station.key, to.station.key);
  if (!plan) return { ok: false, error: `No hay ruta entre ${from.station.name} y ${to.station.name}` };
  const status = await readStatus().catch(() => ({ notices: [] as MetroNotice[] }));
  const notices = noticesForLines(status.notices, plan.legs.map((l) => l.lineShort));
  const clock = localClock(new Date(), METRO_TZ);
  const dep = nextDepartures(net, from.station.key, clock, { limit: 2 });
  const firstLine = plan.legs[0].line;
  const next = (dep?.departures ?? [])
    .filter((d) => d.line === firstLine)
    .map((d) => ({ line: d.lineShort, headsign: d.headsign, inMinutes: d.inMinutes }));
  return {
    ok: true,
    plan: publicPlan(plan),
    notices: notices.map((n) => ({ line: n.line, text: n.text, severity: n.severity, delayMin: n.delayMin })),
    next,
    scheduleStale: dep?.stale ?? false,
    say: sayPlan(plan),
  };
}

/** Lista de estaciones y líneas (para la UI y para que el agente sepa qué existe). */
export async function stationList(): Promise<{
  ok: boolean;
  error?: string;
  stations?: { key: string; name: string; lines: string[] }[];
  lines?: { id: string; short: string; name: string; color: string; kind: string; stations: string[] }[];
  feed?: { start: string | null; end: string | null };
  aliases?: string[];
}> {
  const loaded = await loadMetro();
  if (!loaded) return { ok: false, error: `No hay datos del sistema en ${GTFS_DIR}` };
  const s = networkSummary(loaded.net);
  return { ok: true, ...s, aliases: [...loaded.net.aliases.keys()].sort() };
}

/** Próximas salidas en una estación (horario del feed; `stale` si el feed venció). */
export async function departuresAt(stationText: string): Promise<{
  ok: boolean;
  error?: string;
  suggestions?: string[];
  station?: string;
  stale?: boolean;
  feedEnd?: string | null;
  departures?: { line: string; lineName: string; color: string; headsign: string; inMinutes: number[] }[];
}> {
  const loaded = await loadMetro();
  if (!loaded) return { ok: false, error: `No hay datos del sistema en ${GTFS_DIR}` };
  const m = resolveStation(loaded.net, stationText);
  if (!m) {
    return { ok: false, error: `No reconozco la estación "${stationText}"`, suggestions: matchStations(loaded.net, stationText, 4).map((x) => x.station.name) };
  }
  const clock = localClock(new Date(), METRO_TZ);
  const r = nextDepartures(loaded.net, m.station.key, clock, { limit: 2 });
  return {
    ok: true,
    station: m.station.name,
    stale: r?.stale ?? false,
    feedEnd: r?.feedEnd ?? null,
    departures: (r?.departures ?? []).map((d) => ({ line: d.lineShort, lineName: d.lineName, color: d.color, headsign: d.headsign, inMinutes: d.inMinutes })),
  };
}

/** Lugares cerca de una estación. Sin archivo o sin coincidencias → lista vacía. */
export async function placesAt(stationText: string): Promise<{
  ok: boolean;
  error?: string;
  station?: string;
  places: StationPlace[];
  /** Estaciones que sí tienen lugares cargados (para que el agente lo diga). */
  available: string[];
  configured: boolean;
  path: string;
}> {
  const { places, path, exists } = await readPlaces();
  const available = stationsWithPlaces(places);
  if (!exists) return { ok: true, places: [], available, configured: false, path };
  let name = stationText.trim();
  const loaded = await loadMetro().catch(() => null);
  if (loaded) {
    const m = resolveStation(loaded.net, name);
    if (m) name = m.station.name;
  }
  // El nombre del archivo puede diferir del nombre del feed: se prueban los dos.
  const found = placesNear(places, name);
  const byRaw = found.length ? found : placesNear(places, stationText);
  return { ok: true, station: name, places: byRaw, available, configured: true, path };
}
