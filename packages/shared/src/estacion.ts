/**
 * TÓTEM DE ESTACIÓN — los datos que NO están en el GTFS.
 *
 * Dos cosas que ningún feed publica y que ninguna API abierta da: las
 * novedades del servicio (una línea demorada ahora mismo) y qué hay cerca de
 * una estación (con su horario). Las escribe el humano en
 * `~/.hermes-os/metro-status.json` y `~/.hermes-os/lugares.json`; aquí vive
 * solo el CONTRATO: tipos + validación pura + filtro de vigencia.
 *
 * Regla: sin archivo, no hay banner ni tarjetas. Nada se rellena con ejemplos.
 */

import { normalizeName } from "./gtfs.js";

export type NoticeSeverity = "info" | "demora" | "suspension";

export interface MetroNotice {
  /** route_short_name de la línea afectada ("A", "K", "T-A"), o "" = todo el sistema. */
  line: string;
  text: string;
  severity: NoticeSeverity;
  /** Minutos de demora informados (null = no se informó un número). */
  delayMin: number | null;
  /** ISO local ("2026-09-18T20:00") hasta cuando aplica; null = sin caducidad. */
  until: string | null;
  /** Desde cuándo aplica (ISO local); null = ya. */
  since: string | null;
  /** Quién lo informó (cuenta oficial, aviso en estación). */
  source: string | null;
}

export interface StationPlace {
  name: string;
  /** Estación de referencia, tal como se escribió (se resuelve contra el GTFS). */
  station: string;
  /** Minutos a pie desde la estación. */
  walkMinutes: number;
  /** Horario tal como está publicado ("Mar-dom 10:00-17:00"); null = no publicado. */
  hours: string | null;
  note: string | null;
  /** De dónde salió el horario: obligatorio para mostrarlo como dato. */
  source: string | null;
  url: string | null;
  /** Etiqueta libre ("museo", "comida"). */
  category: string | null;
}

export class EstacionConfigError extends Error {}

function fail(msg: string): never {
  throw new EstacionConfigError(msg);
}

function str(v: unknown, where: string, max = 400): string {
  if (typeof v !== "string" || !v.trim()) fail(`${where}: texto vacío`);
  if (v.length > max) fail(`${where}: más de ${max} caracteres`);
  return v.trim();
}

function optStr(v: unknown, where: string, max = 400): string | null {
  if (v === undefined || v === null || v === "") return null;
  return str(v, where, max);
}

const ISO_LOCAL = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?$/;

function optIso(v: unknown, where: string): string | null {
  const s = optStr(v, where, 40);
  if (s === null) return null;
  if (!ISO_LOCAL.test(s)) fail(`${where}: fecha inválida ("${s}"), usa 2026-09-18T20:00`);
  return s.replace(" ", "T");
}

/** Valida `metro-status.json` (lista, o { notices: [...] }). */
export function parseMetroStatus(raw: unknown): MetroNotice[] {
  const list = Array.isArray(raw) ? raw : (raw as { notices?: unknown })?.notices;
  if (list === undefined) return [];
  if (!Array.isArray(list)) fail('metro-status.json: debe ser una lista o { "notices": [...] }');
  return list.map((item, i) => {
    if (!item || typeof item !== "object") fail(`metro-status.json[${i}]: no es un objeto`);
    const n = item as Record<string, unknown>;
    const where = `metro-status.json[${i}]`;
    const delay = n.delayMin ?? n.delay_min;
    if (delay !== undefined && delay !== null && !(typeof delay === "number" && delay >= 0 && delay < 600)) {
      fail(`${where}.delayMin: minutos fuera de rango`);
    }
    const sev = n.severity ?? (typeof delay === "number" && delay > 0 ? "demora" : "info");
    if (sev !== "info" && sev !== "demora" && sev !== "suspension") fail(`${where}.severity: info|demora|suspension`);
    return {
      line: typeof n.line === "string" ? n.line.trim() : "",
      text: str(n.text, `${where}.text`, 600),
      severity: sev,
      delayMin: typeof delay === "number" ? delay : null,
      until: optIso(n.until, `${where}.until`),
      since: optIso(n.since, `${where}.since`),
      source: optStr(n.source, `${where}.source`),
    };
  });
}

/** Valida `lugares.json` (lista, o { places: [...] }). */
export function parsePlaces(raw: unknown): StationPlace[] {
  const list = Array.isArray(raw) ? raw : (raw as { places?: unknown })?.places;
  if (list === undefined) return [];
  if (!Array.isArray(list)) fail('lugares.json: debe ser una lista o { "places": [...] }');
  return list.map((item, i) => {
    if (!item || typeof item !== "object") fail(`lugares.json[${i}]: no es un objeto`);
    const p = item as Record<string, unknown>;
    const where = `lugares.json[${i}]`;
    const walk = p.walkMinutes ?? p.walk_minutes ?? p.minutos;
    if (!(typeof walk === "number" && walk >= 0 && walk <= 120)) fail(`${where}.walkMinutes: minutos a pie (0-120)`);
    return {
      name: str(p.name, `${where}.name`, 120),
      station: str(p.station, `${where}.station`, 120),
      walkMinutes: Math.round(walk),
      hours: optStr(p.hours ?? p.horario, `${where}.hours`, 200),
      note: optStr(p.note ?? p.nota, `${where}.note`, 400),
      source: optStr(p.source ?? p.fuente, `${where}.source`, 300),
      url: optStr(p.url, `${where}.url`, 400),
      category: optStr(p.category ?? p.categoria, `${where}.category`, 60),
    };
  });
}

/**
 * Novedades vigentes AHORA (`now` en ISO local, ya en la zona del sistema:
 * comparar strings ISO es correcto y evita arrastrar una librería de fechas).
 * Una novedad sin `until` no caduca: si el humano la escribió, sigue.
 */
export function activeNotices(notices: MetroNotice[], nowIso: string): MetroNotice[] {
  const now = nowIso.replace(" ", "T");
  return notices.filter((n) => {
    if (n.since && now < padIso(n.since, "00:00")) return false;
    if (n.until && now > padIso(n.until, "23:59")) return false;
    return true;
  });
}

/** "2026-09-18" → "2026-09-18T00:00" / "T23:59" según sea inicio o fin. */
function padIso(iso: string, time: string): string {
  return iso.includes("T") ? iso : `${iso}T${time}`;
}

/** Lugares de una estación (por nombre normalizado; tolera tildes y "estación"). */
export function placesNear(places: StationPlace[], stationName: string): StationPlace[] {
  const key = normalizeName(stationName);
  return places
    .filter((p) => normalizeName(p.station) === key)
    .sort((a, b) => a.walkMinutes - b.walkMinutes || a.name.localeCompare(b.name));
}

/** Estaciones que tienen lugares cargados (para decir cuáles sí hay). */
export function stationsWithPlaces(places: StationPlace[]): string[] {
  return [...new Set(places.map((p) => p.station))].sort((a, b) => a.localeCompare(b));
}

/** Novedades que afectan a un plan (por línea; "" = todo el sistema). */
export function noticesForLines(notices: MetroNotice[], lineShorts: string[]): MetroNotice[] {
  const set = new Set(lineShorts.map((l) => l.toUpperCase()));
  return notices.filter((n) => !n.line || set.has(n.line.toUpperCase()));
}

/** Texto hablado de una novedad: lo que Hermes dice antes de la ruta. */
export function describeNotice(n: MetroNotice): string {
  const line = n.line ? `Línea ${n.line}: ` : "";
  const delay = n.delayMin ? ` (unos ${n.delayMin} minutos de demora)` : "";
  return `${line}${n.text}${delay}`;
}
