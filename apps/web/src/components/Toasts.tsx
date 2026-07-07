"use client";

import { useEffect, useRef, useState } from "react";
import type { AgentActivityEvent } from "@hermes/shared";

/**
 * Toasts del centro de mando: avisos flotantes cuando una tarea/run termina o
 * falla, aunque estés mirando otro panel. Consume los MISMOS events que ya
 * llegan por el SSE de useAgentEvents (no abre otra conexión); detecta las
 * llegadas nuevas por ts y las apila abajo a la derecha con auto-cierre.
 */

interface Toast {
  id: string;
  kind: "ok" | "error";
  text: string;
}

const TOAST_MS = 6000;
const MAX_TOASTS = 4;

export function Toasts({ events }: { events: AgentActivityEvent[] }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
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
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className="hud-in pointer-events-auto cursor-pointer rounded-sm border px-3 py-2 text-[11px] leading-snug backdrop-blur"
          style={{
            borderColor: t.kind === "ok" ? "var(--green)" : "var(--red)",
            background: "rgba(8,10,22,0.92)",
            color: "var(--text)",
            boxShadow: `0 0 14px ${t.kind === "ok" ? "rgba(110,231,160,0.25)" : "rgba(251,113,133,0.25)"}`,
          }}
          onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
          title="Cerrar"
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
