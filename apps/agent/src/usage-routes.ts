/**
 * Rutas del registro de gasto (`/usage/*`).
 * Especificación: openspec/changes/v6-nucleo/specs/gasto.
 *
 * Solo lectura: el registro lo escribe tracked-query.ts y aquí se sirve
 * agregado (usage-ledger.ts + @hermes/shared). Contrato `{ ok, … | error }` con
 * 200, como /gym: el panel muestra el motivo tal cual en vez de un "falló".
 */
import type { Hono } from "hono";
import { localDay, type CallEntry } from "@hermes/shared";
import { TIER_MODELS, catalogView, tierModel, tierOf, type ModelTier } from "./agent/models.js";
import { firstDayWithCalls, readCallsOfDay, usageSummary } from "./usage-ledger.js";

export const USAGE_DAYS_DEFAULT = 7;
export const USAGE_DAYS_MAX = 90;
export const USAGE_CALLS_DEFAULT = 200;
/** Un día de juntas en vivo deja miles de turnos: el detalle se pide por tramos, no entero. */
export const USAGE_CALLS_MAX = 1000;

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * `?days=`: entero de 1 a 90; ausente = 7. Un valor inválido es un error dicho
 * (no se recorta en silencio: pedir 400 días y recibir 90 haría creer que el
 * resumen cubre lo que no cubre).
 */
export function parseDays(raw: string | undefined | null): Parsed<number> {
  if (raw === undefined || raw === null || raw === "") return { ok: true, value: USAGE_DAYS_DEFAULT };
  if (!/^\d{1,3}$/.test(raw.trim())) return { ok: false, error: `«days» debe ser un entero de 1 a ${USAGE_DAYS_MAX}.` };
  const n = Number(raw.trim());
  if (n < 1 || n > USAGE_DAYS_MAX) return { ok: false, error: `«days» debe estar entre 1 y ${USAGE_DAYS_MAX}.` };
  return { ok: true, value: n };
}

/**
 * `?day=`: AAAA-MM-DD de una fecha que existe; ausente = hoy (día local, como
 * el registro). El formato estricto importa: el día termina en el nombre de un
 * archivo, así que nada que no sea una fecha llega al disco.
 */
export function parseDay(raw: string | undefined | null, today: string = localDay(new Date())): Parsed<string> {
  if (raw === undefined || raw === null || raw === "") return { ok: true, value: today };
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!m) return { ok: false, error: "«day» debe tener la forma AAAA-MM-DD." };
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  // Date "corrige" el 30 de febrero al 2 de marzo: si no vuelve igual, la fecha no existe.
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) {
    return { ok: false, error: `«day» no es una fecha que exista: ${raw.trim()}.` };
  }
  return { ok: true, value: raw.trim() };
}

/** `?limit=`: entero de 1 a 1000; ausente = 200. */
export function parseLimit(raw: string | undefined | null): Parsed<number> {
  if (raw === undefined || raw === null || raw === "") return { ok: true, value: USAGE_CALLS_DEFAULT };
  if (!/^\d{1,5}$/.test(raw.trim())) return { ok: false, error: `«limit» debe ser un entero de 1 a ${USAGE_CALLS_MAX}.` };
  const n = Number(raw.trim());
  if (n < 1 || n > USAGE_CALLS_MAX) return { ok: false, error: `«limit» debe estar entre 1 y ${USAGE_CALLS_MAX}.` };
  return { ok: true, value: n };
}

/** Las llamadas de un día, la más reciente primero, con tope. `total` es el del día completo. */
export function latestCalls(calls: CallEntry[], limit: number): { calls: CallEntry[]; total: number; truncated: boolean } {
  const sorted = [...calls].sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
  return { calls: sorted.slice(0, limit), total: sorted.length, truncated: sorted.length > limit };
}

export interface UsageModelInfo {
  /** Nivel del catálogo al que pertenece el modelo; null = fuera del catálogo vigente. */
  tier: ModelTier | null;
  /** Nombre legible, solo si es EXACTAMENTE el modelo de lista de su nivel (un Opus viejo no es "Opus 5.5"). */
  label: string | null;
}

/** Nivel y nombre de cada modelo que aparece en un resumen (el panel no conoce el catálogo). */
export function describeModels(ids: Iterable<string>): Record<string, UsageModelInfo> {
  const out: Record<string, UsageModelInfo> = {};
  for (const id of ids) {
    const tier = tierOf(id);
    out[id] = { tier, label: tier && TIER_MODELS[tier].id === id.toLowerCase() ? TIER_MODELS[tier].label : null };
  }
  return out;
}

/** Los niveles con su modelo de lista, su precio y el modelo que de verdad está en uso. */
export function tiersView(env: Record<string, string | undefined> = process.env) {
  return (Object.keys(TIER_MODELS) as ModelTier[]).map((tier) => {
    const active = tierModel(tier, env);
    return {
      tier,
      ...TIER_MODELS[tier],
      /** El modelo en uso para el nivel (HERMES_MODEL_TIER_<NIVEL> o el de lista). */
      active,
      /** "env" = el nivel está cambiado por variable: el precio de lista ya no describe lo que corre. */
      source: active === TIER_MODELS[tier].id ? ("catalog" as const) : ("env" as const),
    };
  });
}

export function mountUsageRoutes(app: Hono): void {
  // Resumen por función, modelo y día. `since` = primer día con registro EN DISCO
  // (aunque quede fuera de la ventana): con él el panel dice "se mide desde…".
  app.get("/usage/summary", async (c) => {
    const days = parseDays(c.req.query("days"));
    if (!days.ok) return c.json({ ok: false, error: days.error });
    try {
      const [summary, since] = await Promise.all([usageSummary(days.value), firstDayWithCalls()]);
      const ids = new Set<string>(summary.byModel.map((m) => m.model));
      for (const f of summary.byFeature) for (const m of f.models) ids.add(m);
      return c.json({ ok: true, summary, since, models: describeModels(ids) });
    } catch (err) {
      return c.json({ ok: false, error: `No se pudo leer el registro de gasto: ${err instanceof Error ? err.message : String(err)}` });
    }
  });

  // Las llamadas de un día, la más reciente primero.
  app.get("/usage/calls", async (c) => {
    const day = parseDay(c.req.query("day"));
    if (!day.ok) return c.json({ ok: false, error: day.error });
    const limit = parseLimit(c.req.query("limit"));
    if (!limit.ok) return c.json({ ok: false, error: limit.error });
    try {
      return c.json({ ok: true, day: day.value, ...latestCalls(await readCallsOfDay(day.value), limit.value) });
    } catch (err) {
      return c.json({ ok: false, error: `No se pudo leer el registro de gasto: ${err instanceof Error ? err.message : String(err)}` });
    }
  });

  // El catálogo resuelto con el entorno de ESTE agente: qué modelo usa cada
  // función y de dónde salió, más los niveles con su precio de lista.
  app.get("/usage/models", (c) => c.json({ ok: true, features: catalogView(), tiers: tiersView() }));
}
