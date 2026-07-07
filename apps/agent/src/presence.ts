import { supabase } from "./supabase.js";
import { env } from "./env.js";

let currentStatus: "idle" | "working" | "thinking" = "idle";
let currentTask: string | null = null;

export function setPresence(
  status: "idle" | "working" | "thinking",
  task?: string | null,
) {
  currentStatus = status;
  currentTask = task ?? null;
  void push();
}

export function getPresence() {
  return { status: currentStatus, currentTask };
}

async function push() {
  if (!supabase) return;
  const { error } = await supabase.from("agent_presence").upsert({
    machine: env.MACHINE_NAME,
    status: currentStatus,
    current_task: currentTask,
    last_heartbeat: new Date().toISOString(),
    version: "0.1.0",
  });
  if (error) console.error("[hermes] presence upsert", error.message);
}

/** Heartbeat cada 30s para que otras máquinas sepan que estamos vivos. */
export function startHeartbeat() {
  void push();
  setInterval(() => void push(), 30_000);
}
