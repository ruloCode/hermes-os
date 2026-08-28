// Tonos semánticos del design system. Un `Tone` viaja como prop por los
// primitivos UI y se resuelve a las CSS vars que emite el @theme de
// globals.css — nunca a un hex directo.

export type Tone = "violet" | "cyan" | "blue" | "green" | "amber" | "red" | "neutral";

/** Var CSS del tono, para style/stroke/fill en JSX y SVG. */
export const toneVar = (tone: Tone): string =>
  tone === "neutral" ? "var(--color-text-dim)" : `var(--color-${tone})`;

/** Variante "hot" (más clara) para extremos de gradientes. */
export const toneHotVar = (tone: Tone): string =>
  tone === "violet" ? "var(--color-violet-hot)" : toneVar(tone);

/** Slots de la paleta categórica de charts (--color-chart-1..N del @theme). */
export const CHART_SLOTS = 5;

/** Var CSS del slot categórico i (0-based); fuera de rango cae al gris "otros". */
export const chartVar = (i: number): string =>
  i >= 0 && i < CHART_SLOTS ? `var(--color-chart-${i + 1})` : CHART_OTHER;

/** Gris de la cola plegada ("otros") — nunca compite con los slots. */
export const CHART_OTHER = "var(--color-text-faint)";

// Canvas no resuelve var(): readToken entrega el valor computado del token
// con caché por sesión (los tokens no cambian en runtime — no hay themes).
let tokenCache: Map<string, string> | null = null;

/** Valor computado de un token CSS (p. ej. "--color-violet") para canvas. */
export function readToken(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  if (!tokenCache) tokenCache = new Map();
  const hit = tokenCache.get(name);
  if (hit) return hit;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const resolved = value || fallback;
  tokenCache.set(name, resolved);
  return resolved;
}
