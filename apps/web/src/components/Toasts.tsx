"use client";

import { useEffect, useRef, useState } from "react";
import type { AgentActivityEvent } from "@hermes/shared";
import { useOrchestrator } from "@/state/OrchestratorProvider";
import { useWorkspace } from "@/state/WorkspaceContext";

/**
 * Toasts del centro de mando: avisos flotantes cuando una tarea/run termina o
 * falla, aunque estés mirando otro panel. Consume los MISMOS events que ya
 * llegan por el SSE de useAgentEvents (no abre otra conexión); detecta las
 * llegadas nuevas por ts y las apila abajo a la derecha con auto-cierre.
 * Si el evento corresponde a un run aún vivo en el orquestador, el clic ABRE
 * su stream (antes solo cerraba el aviso).
 */

interface Toast {
  id: string;
  kind: "ok" | "error";
  text: string;
  /** id del run (taskId del evento) para abrir su stream al hacer clic. */
  runId?: string;
}

const TOAST_MS = 6000;
const MAX_TOASTS = 4;

export function Toasts({ events }: { events: AgentActivityEvent[] }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const { runs } = useOrchestrator();
  const ws = useWorkspace();
  // ts del último evento ya procesado. Empieza en "ahora" para no tostear el
  // replay histórico que el SSE manda al conectar.
  const lastSeenRef = useRef<string>(new Date().toISOString());

  useEffect(() => {
    const fresh = events.filter(
      (e) => e.ts > lastSeenRef.current && (e.kind === "task_done" || e.kind === "error"),
    );
    if (events.length) {
      const newest = events[events.length - 1].ts;
      if (newest > lastSeenRef.current) lastSeenRef.current = newest;
    }
    if (!fresh.length) return;

    const incoming: Toast[] = fresh.map((e) => ({
      id: `${e.ts}-${e.taskId ?? e.toolName ?? "x"}`,
      kind: e.kind === "task_done" ? "ok" : "error",
      runId: e.taskId,
      text:
        e.kind === "task_done"
          ? `✅ Terminó: ${(e.detail || e.taskId || "tarea").slice(0, 90)}`
          : `❌ ${(e.detail || "error del agente").slice(0, 90)}`,
    }));
    setToasts((prev) => [...prev, ...incoming].slice(-MAX_TOASTS));
    for (const t of incoming) {
      setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== t.id)), TOAST_MS);
    }
  }, [events]);

  if (!toasts.length) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
      {toasts.map((t) => {
        // Si el run sigue en el orquestador (ventana de 5 min), el clic abre
        // su stream; si ya se evictó, el clic solo cierra el aviso.
        const run = t.runId ? runs.find((r) => r.id === t.runId) : undefined;
        return (
          <div
            key={t.id}
            role="status"
            className={`hud-in pointer-events-auto cursor-pointer rounded-sm border bg-[rgba(8,10,22,0.92)] px-3 py-2 text-xs leading-snug text-text backdrop-blur ${
              t.kind === "ok" ? "border-green glow-box-green" : "border-red glow-box-red"
            }`}
            onClick={() => {
              if (run) ws.openRun({ slug: run.projectSlug, runId: run.id, sessionId: run.sessionId });
              setToasts((prev) => prev.filter((x) => x.id !== t.id));
            }}
            title={run ? "Abrir el stream de este run" : "Cerrar"}
          >
            {t.text}
            {run && (
              <span className="mt-0.5 block text-2xs tracking-label text-text-dim uppercase">
                clic para abrir el stream ▸
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
