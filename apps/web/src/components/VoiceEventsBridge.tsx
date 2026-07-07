"use client";

import { useEffect, useRef } from "react";
import type { AgentActivityEvent } from "@hermes/shared";
import { useConversationControls, useConversationStatus } from "@elevenlabs/react";

/**
 * Proactividad estilo Jarvis: con una llamada activa, cuando una tarea o un run
 * de Claude Code termina (o falla), le pasa al agente de voz una actualización
 * CONTEXTUAL (sendContextualUpdate). No fuerza a hablar: Hermes decide si lo
 * comenta o no según el prompt. Consume los MISMOS `events` del SSE que ya tiene
 * el dashboard (no abre otra conexión). No renderiza nada.
 *
 * Dedupe por `ts` (mismo patrón que Toasts): mientras no hay llamada, avanza el
 * marcador para no soltar en bloque todo el historial al conectar.
 */
export function VoiceEventsBridge({ events }: { events: AgentActivityEvent[] }) {
  const { status } = useConversationStatus();
  const { sendContextualUpdate } = useConversationControls();
  const lastSeenRef = useRef<string>(new Date().toISOString());
  const connected = status === "connected";

  useEffect(() => {
    const newest = events.length ? events[events.length - 1].ts : null;

    if (!connected) {
      if (newest && newest > lastSeenRef.current) lastSeenRef.current = newest;
      return;
    }

    const fresh = events.filter(
      (e) => e.ts > lastSeenRef.current && (e.kind === "task_done" || e.kind === "error"),
    );
    if (newest && newest > lastSeenRef.current) lastSeenRef.current = newest;

    for (const e of fresh) {
      const label = e.toolName ? `${e.toolName} — ` : "";
      const detail = (e.detail ?? "").slice(0, 400);
      const msg =
        e.kind === "task_done"
          ? `[Aviso del sistema] Terminó una tarea en segundo plano. ${label}${detail}`
          : `[Aviso del sistema] Una tarea en segundo plano falló. ${label}${detail}`;
      sendContextualUpdate(msg.slice(0, 500));
    }
  }, [events, connected, sendContextualUpdate]);

  return null;
}
