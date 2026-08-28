/**
 * Google Calendar API (escritura): crear / mover / borrar eventos por voz y
 * lectura fresca de eventos. A diferencia del feed ICS (solo lectura, cacheado
 * en el edge de Google minutos u horas), la API refleja los cambios al instante
 * y devuelve los IDs reales de evento — necesarios para modificar/borrar.
 *
 * Auth: OAuth2 con refresh token (el agente actúa como el usuario). Sin librería
 * de Google: se piden access tokens por fetch al token endpoint y se llaman los
 * endpoints REST v3 directamente. Si faltan credenciales, isConfigured()=false y
 * el resto del sistema cae al feed ICS.
 */
import type { CalendarEvent } from "@hermes/shared";
import { env } from "./env.js";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API_BASE = "https://www.googleapis.com/calendar/v3";

export function isConfigured(): boolean {
  return Boolean(
    env.GOOGLE_OAUTH_CLIENT_ID &&
      env.GOOGLE_OAUTH_CLIENT_SECRET &&
      env.GOOGLE_OAUTH_REFRESH_TOKEN,
  );
}

// ── Access token (cacheado hasta ~1 min antes de expirar) ──────────────
let tokenCache: { token: string; expMs: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expMs) return tokenCache.token;
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      refresh_token: env.GOOGLE_OAUTH_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`OAuth token HTTP ${res.status} ${detail.slice(0, 200)}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = {
    token: json.access_token,
    expMs: Date.now() + (json.expires_in - 60) * 1000,
  };
  return json.access_token;
}

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = await getAccessToken();
  return fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers as Record<string, string> | undefined),
    },
    signal: AbortSignal.timeout(15_000),
  });
}

const calId = () => encodeURIComponent(env.GOOGLE_CALENDAR_ID);

// ── Mapeo Google → CalendarEvent (mismo shape que el feed ICS) ─────────
interface GEventTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}
interface GEvent {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  start?: GEventTime;
  end?: GEventTime;
}

/** Descripción de Google puede traer HTML: la reducimos a texto plano. */
function cleanDescription(raw: string | undefined): string | null {
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

/** ISO del inicio/fin: dateTime tal cual, o date (día completo) a medianoche local. */
function timeToIso(t: GEventTime | undefined): string | null {
  if (!t) return null;
  if (t.dateTime) return new Date(t.dateTime).toISOString();
  if (t.date) return new Date(`${t.date}T00:00:00`).toISOString();
  return null;
}

function toCalendarEvent(ev: GEvent, nowMs: number): CalendarEvent | null {
  const startIso = timeToIso(ev.start);
  if (!startIso) return null;
  return {
    id: ev.id,
    title: ev.summary || "(sin título)",
    start: startIso,
    end: timeToIso(ev.end),
    allDay: Boolean(ev.start?.date),
    location: ev.location || null,
    description: cleanDescription(ev.description),
    startsInMin: Math.round((new Date(startIso).getTime() - nowMs) / 60_000),
  };
}

/**
 * Lista eventos expandidos (singleEvents) en [timeMin, timeMax]. Devuelve el
 * shape CalendarEvent para que la capa de lectura sea intercambiable con el ICS.
 */
export async function listEvents(
  timeMin: Date,
  timeMax: Date,
  limit = 2500,
): Promise<CalendarEvent[]> {
  const params = new URLSearchParams({
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "2500",
    showDeleted: "false",
  });
  const nowMs = Date.now();
  const out: CalendarEvent[] = [];
  let pageToken: string | undefined;
  do {
    if (pageToken) params.set("pageToken", pageToken);
    const res = await apiFetch(`/calendars/${calId()}/events?${params.toString()}`);
    if (!res.ok) throw new Error(`events.list HTTP ${res.status}`);
    const json = (await res.json()) as { items?: GEvent[]; nextPageToken?: string };
    for (const ev of json.items ?? []) {
      if (ev.status === "cancelled") continue;
      const mapped = toCalendarEvent(ev, nowMs);
      if (mapped) out.push(mapped);
      if (out.length >= limit) return out;
    }
    pageToken = json.nextPageToken;
  } while (pageToken);
  return out;
}

// ── Escritura ──────────────────────────────────────────────────────────
export interface EventInput {
  title: string;
  /** "YYYY-MM-DDTHH:MM[:SS]" en hora local (día completo: "YYYY-MM-DD"). */
  start: string;
  end?: string;
  durationMin?: number;
  allDay?: boolean;
  description?: string;
  location?: string;
}

/** Suma minutos a un "YYYY-MM-DDTHH:MM(:SS)" local sin tocar la zona. */
function addMinutesLocal(local: string, mins: number): string {
  const d = new Date(local);
  d.setMinutes(d.getMinutes() + mins);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`;
}

/** Suma días a un "YYYY-MM-DD". */
function addDaysDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Normaliza un input de voz al bloque {start,end} del recurso de Google. */
function buildTimes(input: {
  start: string;
  end?: string;
  durationMin?: number;
  allDay?: boolean;
}): { start: GEventTime; end: GEventTime } {
  const tz = env.GOOGLE_CALENDAR_TZ;
  if (input.allDay) {
    const startDate = input.start.slice(0, 10);
    const endDate = input.end ? input.end.slice(0, 10) : addDaysDate(startDate, 1);
    return { start: { date: startDate }, end: { date: endDate } };
  }
  const start = input.start.length <= 16 ? `${input.start}:00` : input.start;
  const end = input.end
    ? input.end.length <= 16
      ? `${input.end}:00`
      : input.end
    : addMinutesLocal(start, input.durationMin ?? 60);
  return {
    start: { dateTime: start, timeZone: tz },
    end: { dateTime: end, timeZone: tz },
  };
}

export async function createEvent(input: EventInput): Promise<CalendarEvent> {
  const { start, end } = buildTimes(input);
  const body = {
    summary: input.title,
    description: input.description,
    location: input.location,
    start,
    end,
  };
  const res = await apiFetch(`/calendars/${calId()}/events`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`events.insert HTTP ${res.status} ${await res.text().catch(() => "")}`);
  const created = (await res.json()) as GEvent;
  const mapped = toCalendarEvent(created, Date.now());
  if (!mapped) throw new Error("events.insert devolvió un evento sin inicio");
  return mapped;
}

export interface EventPatch {
  title?: string;
  start?: string;
  end?: string;
  durationMin?: number;
  allDay?: boolean;
  description?: string;
  location?: string;
}

export async function updateEvent(eventId: string, patch: EventPatch): Promise<CalendarEvent> {
  const body: Record<string, unknown> = {};
  if (patch.title !== undefined) body.summary = patch.title;
  if (patch.description !== undefined) body.description = patch.description;
  if (patch.location !== undefined) body.location = patch.location;
  if (patch.start !== undefined) {
    const { start, end } = buildTimes({
      start: patch.start,
      end: patch.end,
      durationMin: patch.durationMin,
      allDay: patch.allDay,
    });
    body.start = start;
    body.end = end;
  }
  const res = await apiFetch(`/calendars/${calId()}/events/${encodeURIComponent(eventId)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`events.patch HTTP ${res.status} ${await res.text().catch(() => "")}`);
  const updated = (await res.json()) as GEvent;
  const mapped = toCalendarEvent(updated, Date.now());
  if (!mapped) throw new Error("events.patch devolvió un evento sin inicio");
  return mapped;
}

export async function deleteEvent(eventId: string): Promise<void> {
  const res = await apiFetch(`/calendars/${calId()}/events/${encodeURIComponent(eventId)}`, {
    method: "DELETE",
  });
  // 410 = ya estaba borrado: lo tratamos como éxito idempotente.
  if (!res.ok && res.status !== 410) {
    throw new Error(`events.delete HTTP ${res.status}`);
  }
}

/**
 * Busca eventos que casen un texto libre en una ventana (para modificar/borrar
 * por voz). Devuelve los candidatos con su ID real. Ventana por defecto:
 * -1 día a +30 días (el usuario suele referirse a algo cercano).
 */
export async function findEvents(
  query: string,
  opts: { timeMin?: Date; timeMax?: Date; limit?: number } = {},
): Promise<CalendarEvent[]> {
  const timeMin = opts.timeMin ?? new Date(Date.now() - 24 * 60 * 60_000);
  const timeMax = opts.timeMax ?? new Date(Date.now() + 30 * 24 * 60 * 60_000);
  const params = new URLSearchParams({
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "20",
  });
  if (query) params.set("q", query);
  const res = await apiFetch(`/calendars/${calId()}/events?${params.toString()}`);
  if (!res.ok) throw new Error(`events.list(q) HTTP ${res.status}`);
  const json = (await res.json()) as { items?: GEvent[] };
  const nowMs = Date.now();
  return (json.items ?? [])
    .filter((e) => e.status !== "cancelled")
    .map((e) => toCalendarEvent(e, nowMs))
    .filter((e): e is CalendarEvent => e !== null)
    .slice(0, opts.limit ?? 10);
}
