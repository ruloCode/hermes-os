// Formato de las cifras del panel de gasto. Regla de la casa: lo que no tiene
// dato NO se disfraza de cero — un costo `null` dice «sin dato» y un percentil
// sin muestras devuelve null para que quien pinta lo omita.

import { formatUsd } from "@hermes/shared";
import type { CatalogTier, ModelTier, UsageModelInfo } from "@/lib/usage-api";

/** Costo estimado: "$1.42" · "<$0.01" · «sin dato» (nunca "$0" para un null). */
export function usd(n: number | null | undefined): string {
  return n == null || !Number.isFinite(n) ? "sin dato" : formatUsd(n);
}

/** 850 ms · 2.4 s · 1 min 12 s. null = sin muestras (no se pinta). */
export function duration(ms: number | null | undefined): string | null {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return null;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return s ? `${m} min ${s} s` : `${m} min`;
}

/** 78% · <1% · 0%. null = sin tokens de entrada (no se pinta). */
export function percent(ratio: number | null | undefined): string | null {
  if (ratio == null || !Number.isFinite(ratio)) return null;
  if (ratio > 0 && ratio < 0.01) return "<1%";
  return `${Math.round(ratio * 100)}%`;
}

const WEEKDAY = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const MONTH = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function parts(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** "9 nov" (con año si no es el actual: "9 nov 2025"). */
export function dayLabel(day: string, now: Date = new Date()): string {
  const d = parts(day);
  const base = `${d.getDate()} ${MONTH[d.getMonth()]}`;
  return d.getFullYear() === now.getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

/** "lun 9 nov" */
export function dayLabelLong(day: string): string {
  const d = parts(day);
  return `${WEEKDAY[d.getDay()]} ${d.getDate()} ${MONTH[d.getMonth()]}`;
}

/** Etiqueta corta bajo una barra: el número del día. */
export function dayOfMonth(day: string): string {
  return String(parts(day).getDate());
}

export const TIER_ORDER: ModelTier[] = ["fast", "balanced", "deep", "frontier"];

export const TIER_LABEL: Record<ModelTier, string> = {
  fast: "Rápido",
  balanced: "Equilibrado",
  deep: "Profundo",
  frontier: "Frontera",
};

/**
 * Nombre de un modelo para leer: el del catálogo si es exactamente el modelo de
 * lista ("Sonnet 5.5"); si no, su id tal cual (un alias o un modelo anterior no
 * se rebautiza).
 */
export function modelName(
  id: string,
  info?: Record<string, UsageModelInfo> | null,
  tiers?: CatalogTier[] | null,
): string {
  return info?.[id]?.label ?? tiers?.find((t) => t.id === id)?.label ?? id;
}

export const EFFORT_LABEL: Record<string, string> = {
  low: "esfuerzo bajo",
  medium: "esfuerzo medio",
  high: "esfuerzo alto",
  xhigh: "esfuerzo muy alto",
  max: "esfuerzo máximo",
};
