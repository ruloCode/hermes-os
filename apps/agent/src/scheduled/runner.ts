import { createHash } from "node:crypto";
import type { ScheduledTask } from "@hermes/shared";
import { env } from "../env.js";
import { emit } from "../events.js";
import { notifyMac } from "../notify.js";
import { saveMemory } from "../memory.js";
import { supabase } from "../supabase.js";
import { runAgentTurn } from "../agent/session.js";
import { resolveChatCwd } from "../agent/chat-history.js";
import { reviewTurnInBackground } from "../learning/review.js";
import { describeCron, nextRun } from "./cron.js";
import { dueTasks } from "./store.js";

/**
 * Ejecutor de tareas programadas.
 *
 * Cada corrida es una sesión FRESCA del agente (sin resume): una tarea de las
 * 8am no debe arrastrar el contexto de la de ayer. El modelo sale de la fila,
 * no del entorno — por eso `model` se congela al crear la tarea.
 *
 * Tres reglas que evitan que una tarea rota queme tokens para siempre:
 *
 * - REINTENTO SOLO SI NO HUBO TRABAJO. Si el turno falló sin llamar a ninguna
 *   tool ni producir texto, fue un fallo de infraestructura y se reintenta a
 *   los 5, 15 y 30 min. Si el modelo sí trabajó y falló, reintentar solo
 *   repite el gasto: se espera al próximo horario.
 * - BLOQUEO A LOS 3 FALLOS. La tarea deja de correr sola y lo dice; se
 *   reactiva a mano cuando la arreglas.
 * - INCIDENTE POR FIRMA. Un error que se repite avisa UNA vez, no en cada
 *   corrida.
 */

/** Minutos de espera del reintento, por número de intento. */
const RETRY_MINUTES = [5, 15, 30];
const MAX_FAILURES = 3;

/** Firma estable del error: mismo problema = mismo hash, aunque cambien ids. */
function signature(error: string): string {
  const normalized = error
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, "<uuid>")
    .replace(/\d+/g, "<n>")
    .slice(0, 300);
  return createHash("sha1").update(normalized).digest("hex").slice(0, 12);
}

/** Bloque de skills a aplicar en esta corrida (el CLI carga su contenido). */
function skillsBlock(skills: string[]): string {
  if (!skills.length) return "";
  return `\n\nAntes de empezar, carga estas skills y sigue su procedimiento: ${skills
    .map((s) => `/hermes:${s}`)
    .join(" ")}`;
}

export interface RunOutcome {
  ok: boolean;
  output: string;
  toolCalls: number;
  durationMs: number;
}

/** Corre UNA tarea ahora mismo (el barrido y el botón "▶ Correr" usan esto). */
export async function runScheduledTask(task: ScheduledTask, attempt = 1): Promise<RunOutcome> {
  const startedAt = Date.now();
  emit({ kind: "scheduled", taskId: task.id, detail: `▶ ${task.title}` });

  const cwd = task.project ? await resolveChatCwd(task.project) : undefined;
  const prompt =
    `${task.prompt}${skillsBlock(task.skills)}\n\n` +
    `(Esta es una tarea programada de ${env.MACHINE_NAME}: "${task.title}", ${describeCron(task.cron, task.tz)}. ` +
    `Nadie está mirando la pantalla, así que termina con un resumen corto y autosuficiente de lo que encontraste o hiciste.)`;

  const result = await runAgentTurn({
    prompt,
    taskId: task.id,
    project: task.project ?? undefined,
    cwd,
    model: task.model ?? undefined,
  });

  const durationMs = Date.now() - startedAt;
  const output = (result.finalText || "").trim();
  const ok = !result.isError;

  // "Trabajó" = usó tools o produjo texto. Distingue un fallo de infra de un
  // fallo del trabajo, y de eso depende si reintentar o no.
  const didWork = result.toolCalls > 0 || output.length > 0;

  if (supabase) {
    await supabase.from("scheduled_task_runs").insert({
      task_id: task.id,
      finished_at: new Date().toISOString(),
      status: ok ? "ok" : "error",
      output: output.slice(0, 4000) || null,
      error: ok ? null : output.slice(0, 1000) || "fallo sin salida",
      tool_calls: result.toolCalls,
      duration_ms: durationMs,
      attempt,
      machine: env.MACHINE_NAME,
    });

    const patch: Record<string, unknown> = {
      last_run_at: new Date().toISOString(),
      last_status: ok ? "ok" : "error",
      last_output: output.slice(0, 4000) || null,
      updated_at: new Date().toISOString(),
    };

    if (ok) {
      patch.consecutive_failures = 0;
      patch.retry_at = null;
      patch.incident_signature = null;
      patch.incident_acked = false;
      patch.next_run_at = nextRun(task.cron, task.tz)?.toISOString() ?? null;
    } else {
      const failures = task.consecutive_failures + 1;
      patch.consecutive_failures = failures;
      const sig = signature(output || "sin salida");
      // Mismo error que la vez pasada: no volver a gritar.
      patch.incident_signature = sig;
      patch.incident_acked = task.incident_signature === sig ? task.incident_acked : false;

      if (failures >= MAX_FAILURES) {
        patch.blocked_reason = `${failures} fallos seguidos. Último: ${(output || "sin salida").slice(0, 200)}`;
        patch.retry_at = null;
        patch.next_run_at = null;
      } else if (!didWork && attempt <= RETRY_MINUTES.length) {
        // Falló sin gastar: vale la pena reintentar pronto.
        patch.retry_at = new Date(Date.now() + RETRY_MINUTES[attempt - 1] * 60_000).toISOString();
      } else {
        // Falló haciendo trabajo: al próximo horario, sin insistir.
        patch.retry_at = null;
        patch.next_run_at = nextRun(task.cron, task.tz)?.toISOString() ?? null;
      }
    }
    await supabase.from("scheduled_tasks").update(patch).eq("id", task.id);
  }

  emit({
    kind: "scheduled",
    taskId: task.id,
    detail: `${ok ? "✓" : "✕"} ${task.title}${ok ? "" : " — falló"}`,
  });

  if (task.deliver?.notify !== false) {
    // Con el mismo incidente ya avisado, no repetimos la notificación.
    const repeat = !ok && task.incident_acked && task.incident_signature === signature(output || "sin salida");
    if (!repeat) {
      notifyMac(
        task.title,
        ok ? output.slice(0, 160) || "listo" : `falló: ${(output || "sin salida").slice(0, 120)}`,
      );
    }
  }

  if (ok && task.deliver?.memory && output) {
    await saveMemory({
      content: `[${task.title}] ${output.slice(0, 2000)}`,
      type: "daily",
      project: task.project ?? undefined,
      source: "scheduled",
    });
  }

  if (ok && output) {
    reviewTurnInBackground({
      userText: task.prompt,
      assistantText: output,
      source: "scheduled",
      sourceRef: task.id,
    });
  }

  return { ok, output, toolCalls: result.toolCalls, durationMs };
}

export interface SweepResult {
  ran: number;
  failed: number;
  blocked: string[];
}

/**
 * Barrido: corre lo vencido. Lo llama el registry de jobs cada minuto.
 * Escanea-y-actúa a propósito: si el agente estuvo caído, al volver ejecuta
 * lo que quedó vencido en vez de perderlo.
 */
export async function scheduledSweep(): Promise<SweepResult | null> {
  if (!supabase) return null;
  const due = await dueTasks();
  if (!due.length) return null;

  const out: SweepResult = { ran: 0, failed: 0, blocked: [] };
  for (const task of due) {
    // El intento se deduce de los fallos acumulados: 1 en una corrida normal.
    const attempt = task.retry_at ? task.consecutive_failures + 1 : 1;
    try {
      const res = await runScheduledTask(task, attempt);
      out.ran += 1;
      if (!res.ok) {
        out.failed += 1;
        if (task.consecutive_failures + 1 >= MAX_FAILURES) out.blocked.push(task.title);
      }
    } catch (err) {
      out.failed += 1;
      console.error(`[hermes] scheduled "${task.title}":`, String(err).slice(0, 200));
    }
  }
  return out;
}
