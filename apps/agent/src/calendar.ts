/**
 * Próximas reuniones del calendario (panel CALENDARIO del dashboard).
 *
 * Fuente: la URL iCal SECRETA de Google Calendar (env.GOOGLE_CALENDAR_ICS_URL,
 * la "Dirección secreta en formato iCal"). Es un secreto real: quien tenga la
 * URL ve todo el calendario — nunca loguearla ni devolverla al front. Ojo:
 * Google cachea el feed en su edge, así que los cambios recientes pueden
 * tardar minutos u horas en aparecer aquí.
 *
 * Cache en memoria de 5 min con lock in-flight (mismo patrón que weather):
 * requests concurrentes comparten un solo fetch. Si el fetch falla se sirve
 * el cache viejo con stale: true; sin cache previo se devuelve vacío. Nunca
 * lanza hacia el router.
 */
import ical from "node-ical";
import type { CalendarResponse, VEvent } from "node-ical";
import type { CalendarEvent, UpcomingCalendar } from "@hermes/shared";
import { env } from "./env.js";
import * as gcal from "./google-calendar.js";

const CACHE_TTL_MS = 5 * 60_000;
const FETCH_TIMEOUT_MS = 15_000;
/** Incluye eventos que empezaron hace ≤6h (siguen "en curso" en el panel). */
const LOOKBACK_MS = 6 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
/** Cache corto para la lectura por API (la escritura lo invalida al instante). */
const API_TTL_MS = 45_000;

interface FeedCache {
  data: CalendarResponse;
  fetchedAt: string;
  atMs: number;
}

let cache: FeedCache | null = null;
let inflight: Promise<void> | null = null;

/** Descarga y parsea el ICS; solo actualiza el cache si todo salió bien. */
async function refreshFeed(): Promise<void> {
  const res = await fetch(env.GOOGLE_CALENDAR_ICS_URL, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`ICS HTTP ${res.status}`);
  const text = await res.text();
  const data = await ical.async.parseICS(text);
  cache = { data, fetchedAt: new Date().toISOString(), atMs: Date.now() };
}

/** node-ical marca las fechas de día completo con .dateOnly en el Date. */
function isAllDay(d: Date | undefined): boolean {
  return Boolean((d as { dateOnly?: boolean } | undefined)?.dateOnly ?? false);
}

/** summary/location pueden venir como string o como { params, val }. */
function paramText(v: unknown): string | null {
  if (typeof v === "string") return v || null;
  if (v && typeof v === "object" && "val" in v) {
    const val = (v as { val: unknown }).val;
    return typeof val === "string" && val ? val : null;
  }
  return null;
}

/**
 * Google guarda las notas del evento como HTML: convierte <br>/</p> en saltos
 * de línea, quita el resto de tags y decodifica las entidades más comunes para
 * que "Notas" se lea como texto plano limpio en el front.
 */
function cleanDescription(raw: string | null): string | null {
  if (!raw) return null;
  const text = raw
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\/\s*(p|div|li)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text || null;
}

/** Compara por día + hora (UTC): suficiente para casar exdate con instancia. */
function sameDayHour(a: Date, b: Date): boolean {
  return a.toISOString().slice(0, 13) === b.toISOString().slice(0, 13);
}

/** true si la instancia está excluida por un EXDATE del evento. */
function isExcluded(ev: VEvent, instanceStart: Date): boolean {
  if (!ev.exdate) return false;
  return Object.values(ev.exdate).some((ex) => sameDayHour(ex, instanceStart));
}

/** Instancia modificada de un recurrente (los tipos de node-ical dejan las
 *  entradas de `recurrences` casi opacas; tipamos solo lo que usamos). */
interface OverrideEvent {
  start?: Date;
  end?: Date;
  summary?: unknown;
  location?: unknown;
  description?: unknown;
}

/** Override (RECURRENCE-ID) para esa fecha: node-ical indexa por ISO completo
 *  y por día (YYYY-MM-DD); probamos ambas llaves. */
function findOverride(ev: VEvent, date: Date): OverrideEvent | undefined {
  const rec = ev.recurrences as Record<string, OverrideEvent> | undefined;
  if (!rec) return undefined;
  const iso = date.toISOString();
  return rec[iso] ?? rec[iso.slice(0, 10)];
}

function toEvent(
  uid: string,
  title: string | null,
  start: Date,
  end: Date | null,
  allDay: boolean,
  location: string | null,
  description: string | null,
  nowMs: number,
): CalendarEvent {
  return {
    id: `${uid}_${start.toISOString()}`,
    title: title || "(sin título)",
    start: start.toISOString(),
    end: end ? end.toISOString() : null,
    allDay,
    location,
    description,
    startsInMin: Math.round((start.getTime() - nowMs) / 60_000),
  };
}

/**
 * Expande el feed parseado a eventos dentro de la ventana. Hacia atrás:
 * `backDays` días si viene (vistas de calendario que navegan al pasado), o el
 * lookback corto de 6h por defecto (strip/panel de próximos). Hacia adelante:
 * `days` días.
 */
function extractEvents(
  data: CalendarResponse,
  days: number,
  limit: number,
  backDays?: number,
): CalendarEvent[] {
  const nowMs = Date.now();
  const lookbackMs = Number.isFinite(backDays) ? (backDays as number) * DAY_MS : LOOKBACK_MS;
  const windowStart = new Date(nowMs - lookbackMs);
  const windowEnd = new Date(nowMs + days * DAY_MS);
  const out: CalendarEvent[] = [];

  for (const comp of Object.values(data)) {
    if (!comp || comp.type !== "VEVENT") continue;
    const ev = comp as VEvent;
    try {
      if (!ev.start) continue;
      // Las instancias modificadas de recurrentes ya vienen dentro de
      // ev.recurrences del evento base; como top-level serían duplicados.
      if (ev.recurrenceid) continue;

      const title = paramText(ev.summary);
      const location = paramText(ev.location);
      const description = cleanDescription(paramText(ev.description));
      const baseDurationMs = ev.end ? ev.end.getTime() - ev.start.getTime() : null;

      if (!ev.rrule) {
        const t = ev.start.getTime();
        if (t < windowStart.getTime() || t > windowEnd.getTime()) continue;
        out.push(
          toEvent(
            ev.uid,
            title,
            ev.start,
            ev.end ?? null,
            isAllDay(ev.start),
            location,
            description,
            nowMs,
          ),
        );
        continue;
      }

      // Recurrente: expandir dentro de la ventana con exdate + overrides.
      const instances = ev.rrule.between(windowStart, windowEnd, true);
      for (const date of instances) {
        if (isExcluded(ev, date)) continue;
        const override = findOverride(ev, date);
        const start = override?.start ?? date;
        const t = start.getTime();
        // Un override puede mover la instancia fuera de la ventana.
        if (t < windowStart.getTime() || t > windowEnd.getTime()) continue;
        // Duración de la instancia = la del evento base (o el end propio del override).
        let end: Date | null = null;
        if (override?.end) end = override.end;
        else if (baseDurationMs !== null) end = new Date(t + baseDurationMs);
        out.push(
          toEvent(
            ev.uid,
            override ? (paramText(override.summary) ?? title) : title,
            start,
            end,
            isAllDay(override?.start ?? ev.start),
            override ? (paramText(override.location) ?? location) : location,
            override ? (cleanDescription(paramText(override.description)) ?? description) : description,
            nowMs,
          ),
        );
      }
    } catch (err) {
      // Un VEVENT malformado no debe tumbar el panel entero.
      console.error(
        "[hermes] calendar evento",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // ISO strings del mismo formato: orden lexicográfico = cronológico.
  out.sort((a, b) => a.start.localeCompare(b.start));
  return out.slice(0, limit);
}

/**
 * Próximos eventos del calendario. days = tamaño de la ventana hacia adelante,
 * limit = máximo de eventos. Sin GOOGLE_CALENDAR_ICS_URL no toca la red.
 */
// ── Lectura por Google Calendar API (fuente cuando OAuth está configurado) ──
interface ApiCacheEntry {
  data: CalendarEvent[];
  fetchedAt: string;
  atMs: number;
}
const apiCache = new Map<string, ApiCacheEntry>();

/** La escritura (crear/mover/borrar) llama esto para que la próxima lectura sea fresca. */
export function invalidateCalendarCache(): void {
  apiCache.clear();
}

/**
 * Lee de la API con cache de 45s por ventana. Devuelve null (para caer al ICS)
 * solo si el fetch falla Y no hay cache previo; con cache viejo lo sirve stale.
 */
async function getFromApi(
  days: number,
  limit: number,
  backDays?: number,
): Promise<UpcomingCalendar | null> {
  const key = `${backDays ?? ""}:${days}:${limit}`;
  const hit = apiCache.get(key);
  if (hit && Date.now() - hit.atMs < API_TTL_MS) {
    return { configured: true, fetchedAt: hit.fetchedAt, stale: false, events: hit.data };
  }
  try {
    const lookbackMs = Number.isFinite(backDays) ? (backDays as number) * DAY_MS : LOOKBACK_MS;
    const timeMin = new Date(Date.now() - lookbackMs);
    const timeMax = new Date(Date.now() + days * DAY_MS);
    const events = await gcal.listEvents(timeMin, timeMax, limit);
    const fetchedAt = new Date().toISOString();
    apiCache.set(key, { data: events, fetchedAt, atMs: Date.now() });
    return { configured: true, fetchedAt, stale: false, events };
  } catch (err) {
    console.error("[hermes] calendar API", err instanceof Error ? err.message : String(err));
    if (hit) return { configured: true, fetchedAt: hit.fetchedAt, stale: true, events: hit.data };
    return null; // sin cache → el caller intenta el ICS
  }
}

export async function getUpcomingCalendar(
  days = 7,
  limit = 10,
  backDays?: number,
): Promise<UpcomingCalendar> {
  // Preferimos la API (refleja escrituras al instante y da IDs reales);
  // si falla sin cache, caemos al feed ICS de abajo.
  if (gcal.isConfigured()) {
    const viaApi = await getFromApi(days, limit, backDays);
    if (viaApi) return viaApi;
  }

  if (!env.GOOGLE_CALENDAR_ICS_URL) {
    // Sin ICS: "configurado" si al menos la API lo está (aunque ahora falle).
    const api = gcal.isConfigured();
    return { configured: api, fetchedAt: null, stale: api, events: [] };
  }

  let stale = false;
  if (!cache || Date.now() - cache.atMs > CACHE_TTL_MS) {
    // Lock in-flight: requests concurrentes esperan el mismo fetch.
    inflight ??= refreshFeed().finally(() => {
      inflight = null;
    });
    try {
      await inflight;
    } catch (err) {
      // No incluimos la URL en el log: es secreta.
      console.error(
        "[hermes] calendar fetch",
        err instanceof Error ? err.message : String(err),
      );
      stale = true;
    }
  }

  if (!cache) {
    return { configured: true, fetchedAt: null, stale: true, events: [] };
  }
  return {
    configured: true,
    fetchedAt: cache.fetchedAt,
    stale,
    events: extractEvents(cache.data, days, limit, backDays),
  };
}
