// Cliente de las rutas /usage/* del agente (el registro de gasto por llamada al
// modelo). Solo lectura. Las rutas responden `{ ok, … | error }` con 200, así
// que aquí hay TRES resultados y el panel los distingue: dato, motivo dicho por
// el agente (`error`) y agente que no contesta (`offline`).

import type { CallEntry, UsageSummary } from "@hermes/shared";
import { hermesFetch } from "./hermes";

export type ModelTier = "fast" | "balanced" | "deep" | "frontier";

/** Nivel y nombre de un modelo que aparece en el resumen (lo resuelve el agente con su catálogo). */
export interface UsageModelInfo {
  tier: ModelTier | null;
  /** Solo si es el modelo de lista de su nivel; null = se muestra el id. */
  label: string | null;
}

export interface UsageSummaryData {
  summary: UsageSummary;
  /** Primer día con registro en disco (aunque quede fuera del periodo). null = aún no se ha medido nada. */
  since: string | null;
  models: Record<string, UsageModelInfo>;
}

export interface CatalogFeature {
  feature: string;
  /** Para qué se usa, en palabras. */
  label: string;
  tier: ModelTier;
  model: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  thinking?: "off" | "adaptive";
  /** De dónde salió el modelo: la tabla del catálogo o una variable de entorno. */
  source: "catalog" | "env";
}

export interface CatalogTier {
  tier: ModelTier;
  /** Modelo de lista del nivel. */
  id: string;
  label: string;
  /** USD por millón de tokens, precio de lista. */
  inputUsd: number;
  outputUsd: number;
  /** El modelo en uso para el nivel (puede estar cambiado por variable). */
  active: string;
  source: "catalog" | "env";
}

export interface UsageCatalog {
  features: CatalogFeature[];
  tiers: CatalogTier[];
}

export interface UsageCallsData {
  day: string;
  calls: CallEntry[];
  total: number;
  truncated: boolean;
}

export type UsageResult<T> =
  | { ok: true; data: T }
  /** `offline` = el agente no contestó (o contestó algo que no es su contrato); si no, `error` es SU motivo. */
  | { ok: false; error: string; offline: boolean };

async function getUsage<T>(path: string): Promise<UsageResult<T>> {
  let res: Response;
  try {
    res = await hermesFetch(path, { signal: AbortSignal.timeout(12_000) });
  } catch {
    return { ok: false, error: "El agente no contesta.", offline: true };
  }
  // Un agente anterior a v6 no tiene /usage/*: 404 no es "sin gasto".
  if (res.status === 404) return { ok: false, error: "Este agente todavía no registra el gasto (es anterior a v6).", offline: false };
  if (!res.ok) return { ok: false, error: `El agente respondió ${res.status}.`, offline: res.status >= 500 };
  let body: ({ ok?: boolean; error?: string } & Partial<T>) | null;
  try {
    body = await res.json();
  } catch {
    return { ok: false, error: "El agente respondió algo que no se pudo leer.", offline: true };
  }
  if (!body || body.ok !== true) return { ok: false, error: body?.error ?? "El agente no devolvió datos.", offline: false };
  return { ok: true, data: body as T };
}

/** Resumen por función, modelo y día de los últimos `days` días (1..90). */
export function getUsageSummary(days: number): Promise<UsageResult<UsageSummaryData>> {
  return getUsage<UsageSummaryData>(`/usage/summary?days=${days}`);
}

/** Qué modelo usa cada función y los niveles con su precio de lista. */
export function getUsageCatalog(): Promise<UsageResult<UsageCatalog>> {
  return getUsage<UsageCatalog>("/usage/models");
}

/** Las llamadas de un día (AAAA-MM-DD; sin día = hoy), la más reciente primero. */
export function getUsageCalls(day?: string, limit?: number): Promise<UsageResult<UsageCallsData>> {
  const q = new URLSearchParams();
  if (day) q.set("day", day);
  if (limit) q.set("limit", String(limit));
  const qs = q.toString();
  return getUsage<UsageCallsData>(`/usage/calls${qs ? `?${qs}` : ""}`);
}
