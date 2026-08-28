import type { ActivityBucket, ActivitySeries, AgentActivityEvent } from "@hermes/shared";
import { supabase } from "./supabase.js";
import { env } from "./env.js";

/**
 * Bus de eventos en memoria: cada suscriptor (SSE /events) recibe todo lo
 * que el agente hace en vivo. Además espejamos cada evento en Supabase
 * (agent_activity) para que otras máquinas lo vean vía Realtime.
 */
type Listener = (event: AgentActivityEvent) => void;

const listeners = new Set<Listener>();
const recent: AgentActivityEvent[] = [];
const RECENT_LIMIT = 200;

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function recentEvents(): AgentActivityEvent[] {
  return [...recent];
}

export function emit(event: Omit<AgentActivityEvent, "ts" | "machine">): void {
  const full: AgentActivityEvent = {
    ...event,
    machine: env.MACHINE_NAME,
    ts: new Date().toISOString(),
  };
  recent.push(full);
  if (recent.length > RECENT_LIMIT) recent.shift();
  for (const l of listeners) {
    try {
      l(full);
    } catch {
      /* listener roto: lo ignoramos */
    }
  }
  // Espejo asíncrono en Supabase (fire and forget)
  if (supabase) {
    void supabase
      .from("agent_activity")
      .insert({
        task_id: full.taskId ?? null,
        kind: full.kind,
        tool_name: full.toolName ?? null,
        payload: { detail: full.detail ?? null },
        machine: full.machine,
      })
      .then(({ error }) => {
        if (error) console.error("[hermes] agent_activity insert", error.message);
      });
  }
}

// ── Serie horaria de actividad (área chart 24h del dashboard) ───────────
// Fuente preferida: RPC activity_hourly sobre agent_activity (migración 011):
// persiste reinicios e incluye TODAS las Macs. Fallback: bucketizar el buffer
// en memoria (parcial — solo esta máquina y desde el último arranque).

let seriesCache: { at: number; hours: number; series: ActivitySeries } | null = null;
const SERIES_TTL_MS = 60_000;

function emptyBuckets(hours: number): ActivityBucket[] {
  const base = new Date();
  base.setMinutes(0, 0, 0);
  return Array.from({ length: hours }, (_, i) => ({
    hour: new Date(base.getTime() - (hours - 1 - i) * 3_600_000).toISOString(),
    total: 0,
    toolCalls: 0,
    tasks: 0,
    errors: 0,
  }));
}

function bucketsFromMemory(hours: number): ActivityBucket[] {
  const buckets = emptyBuckets(hours);
  const index = new Map(buckets.map((b, i) => [b.hour, i]));
  for (const ev of recent) {
    const h = new Date(ev.ts);
    h.setMinutes(0, 0, 0);
    const i = index.get(h.toISOString());
    if (i == null) continue;
    const b = buckets[i];
    b.total += 1;
    if (ev.kind === "tool_call" || ev.kind === "tool_result") b.toolCalls += 1;
    if (ev.kind === "task_start" || ev.kind === "task_done") b.tasks += 1;
    if (ev.kind === "error") b.errors += 1;
  }
  return buckets;
}

export async function activityHourly(hours = 24): Promise<ActivitySeries> {
  if (seriesCache && seriesCache.hours === hours && Date.now() - seriesCache.at < SERIES_TTL_MS) {
    return seriesCache.series;
  }
  let series: ActivitySeries | null = null;
  if (supabase) {
    const { data, error } = await supabase.rpc("activity_hourly", { hours });
    if (!error && data) {
      // El RPC solo trae horas con actividad: se rellena a `hours` buckets.
      const buckets = emptyBuckets(hours);
      const index = new Map(buckets.map((b, i) => [b.hour, i]));
      for (const row of data as {
        hour: string;
        total: number;
        tool_calls: number;
        tasks: number;
        errors: number;
      }[]) {
        const i = index.get(new Date(row.hour).toISOString());
        if (i == null) continue;
        buckets[i] = {
          hour: buckets[i].hour,
          total: Number(row.total) || 0,
          toolCalls: Number(row.tool_calls) || 0,
          tasks: Number(row.tasks) || 0,
          errors: Number(row.errors) || 0,
        };
      }
      series = { hours, source: "supabase", buckets };
    } else if (error) {
      console.error("[hermes] activity_hourly rpc", error.message);
    }
  }
  if (!series) series = { hours, source: "memoria", buckets: bucketsFromMemory(hours) };
  seriesCache = { at: Date.now(), hours, series };
  return series;
}
