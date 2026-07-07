import type { AgentActivityEvent } from "@hermes/shared";
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
