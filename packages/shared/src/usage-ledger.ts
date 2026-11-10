/**
 * Registro de gasto por llamada al modelo (lógica pura).
 *
 * Cada llamada al Agent SDK deja una línea (CallEntry) en
 * ~/.hermes-os/usage/calls-AAAA-MM-DD.jsonl. Aquí se leen y se agregan: por
 * función, por modelo y por día. Regla del dashboard: solo datos reales — una
 * función sin llamadas no aparece y un percentil sin muestras es null.
 *
 * `costUsd` es la estimación del cliente del SDK, no la factura: con
 * suscripción sirve para comparar funciones entre sí, no para cuadrar pagos.
 */

export type CallStatus = "ok" | "error" | "aborted" | "cut";

export interface CallEntry {
  /** ISO de cuando terminó el turno. */
  ts: string;
  /** Función del catálogo (agent/models.ts): "chat", "copilot.fast"… */
  feature: string;
  /** Modelo principal del turno (el que más tokens de salida produjo). */
  model: string;
  /** Todos los modelos que participaron (subagentes, clasificadores). */
  models: string[];
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** null = el SDK no lo informó. */
  costUsd: number | null;
  /** Duración del turno, de que entró el mensaje a que llegó el resultado. */
  ms: number;
  /** Tiempo al primer texto; null si no hubo texto. */
  ttftMs: number | null;
  turns: number;
  status: CallStatus;
  project?: string;
  ref?: string;
}

const STATUSES: readonly string[] = ["ok", "error", "aborted", "cut"];

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Una línea del registro. null = línea rota o de otra forma (se ignora, no tumba el resumen). */
export function parseCallEntry(line: string): CallEntry | null {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.ts !== "string" || typeof r.feature !== "string" || !r.feature) return null;
  if (Number.isNaN(Date.parse(r.ts))) return null;
  const models = Array.isArray(r.models) ? r.models.filter((m): m is string => typeof m === "string") : [];
  const model = typeof r.model === "string" && r.model ? r.model : (models[0] ?? "desconocido");
  const cost = r.costUsd === null || r.costUsd === undefined ? null : Number(r.costUsd);
  const ttft = r.ttftMs === null || r.ttftMs === undefined ? null : Number(r.ttftMs);
  return {
    ts: r.ts,
    feature: r.feature,
    model,
    models: models.length ? models : [model],
    input: num(r.input),
    output: num(r.output),
    cacheRead: num(r.cacheRead),
    cacheWrite: num(r.cacheWrite),
    costUsd: cost !== null && Number.isFinite(cost) && cost >= 0 ? cost : null,
    ms: num(r.ms),
    ttftMs: ttft !== null && Number.isFinite(ttft) && ttft >= 0 ? ttft : null,
    turns: num(r.turns),
    status: typeof r.status === "string" && STATUSES.includes(r.status) ? (r.status as CallStatus) : "ok",
    ...(typeof r.project === "string" && r.project ? { project: r.project } : {}),
    ...(typeof r.ref === "string" && r.ref ? { ref: r.ref } : {}),
  };
}

export interface UsageBucket {
  calls: number;
  errors: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** Suma de los costos informados; null si ninguna llamada lo informó. */
  costUsd: number | null;
  /**
   * Parte de la entrada que se leyó de caché: cacheRead / (input + cacheRead + cacheWrite).
   * null sin tokens de entrada. Es LA medida de si el prefijo estable está funcionando.
   */
  cacheRatio: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  p50TtftMs: number | null;
}

export interface FeatureUsage extends UsageBucket {
  feature: string;
  /** Modelos que usó esta función en el periodo, del más usado al menos. */
  models: string[];
}

export interface ModelUsage extends UsageBucket {
  model: string;
}

export interface DayUsage extends UsageBucket {
  day: string;
}

export interface UsageSummary {
  /** Primer día con datos dentro de lo leído; null = no hay registro. */
  since: string | null;
  days: number;
  total: UsageBucket;
  /** Ordenadas por costo (las que no informan costo, por tokens de salida). */
  byFeature: FeatureUsage[];
  byModel: ModelUsage[];
  /** Solo los días con llamadas, en orden. */
  byDay: DayUsage[];
}

/** Percentil por rango más cercano. null sin muestras. */
export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function bucket(entries: CallEntry[]): UsageBucket {
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let cost = 0;
  let costSeen = false;
  let errors = 0;
  const ms: number[] = [];
  const ttft: number[] = [];
  for (const e of entries) {
    input += e.input;
    output += e.output;
    cacheRead += e.cacheRead;
    cacheWrite += e.cacheWrite;
    if (e.costUsd !== null) {
      cost += e.costUsd;
      costSeen = true;
    }
    if (e.status === "error") errors += 1;
    // La latencia se mide sobre lo que terminó bien: un abortado a los 200 ms mentiría hacia abajo.
    if (e.status === "ok") {
      if (e.ms > 0) ms.push(e.ms);
      if (e.ttftMs !== null) ttft.push(e.ttftMs);
    }
  }
  const prompt = input + cacheRead + cacheWrite;
  return {
    calls: entries.length,
    errors,
    input,
    output,
    cacheRead,
    cacheWrite,
    costUsd: costSeen ? Math.round(cost * 1e6) / 1e6 : null,
    cacheRatio: prompt > 0 ? cacheRead / prompt : null,
    p50Ms: percentile(ms, 50),
    p95Ms: percentile(ms, 95),
    p50TtftMs: percentile(ttft, 50),
  };
}

function byCost<T extends UsageBucket>(a: T, b: T): number {
  return (b.costUsd ?? 0) - (a.costUsd ?? 0) || b.output - a.output || b.calls - a.calls;
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = out.get(k);
    if (list) list.push(item);
    else out.set(k, [item]);
  }
  return out;
}

/** Día local (AAAA-MM-DD) de una entrada: el gasto "de hoy" no rota a las 7 pm por UTC. */
export function callDay(e: CallEntry): string {
  const d = new Date(e.ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Agrega las entradas ya leídas. `days` solo se devuelve como referencia de la ventana pedida. */
export function summarizeCalls(entries: CallEntry[], days: number): UsageSummary {
  const byFeature: FeatureUsage[] = [...groupBy(entries, (e) => e.feature)].map(([feature, list]) => {
    const counts = new Map<string, number>();
    for (const e of list) counts.set(e.model, (counts.get(e.model) ?? 0) + 1);
    return { feature, models: [...counts].sort((a, b) => b[1] - a[1]).map(([m]) => m), ...bucket(list) };
  });
  const byModel: ModelUsage[] = [...groupBy(entries, (e) => e.model)].map(([model, list]) => ({ model, ...bucket(list) }));
  const byDay: DayUsage[] = [...groupBy(entries, callDay)].map(([day, list]) => ({ day, ...bucket(list) }));
  byDay.sort((a, b) => a.day.localeCompare(b.day));
  return {
    since: byDay[0]?.day ?? null,
    days,
    total: bucket(entries),
    byFeature: byFeature.sort(byCost),
    byModel: byModel.sort(byCost),
    byDay,
  };
}
