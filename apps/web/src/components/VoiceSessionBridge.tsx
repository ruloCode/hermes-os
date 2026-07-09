"use client";

import { useEffect, useRef } from "react";
import type { AgentActivityEvent } from "@hermes/shared";
import { useConversation, useConversationControls } from "@elevenlabs/react";
import { hermesGet } from "@/lib/hermes";
import { useVoice } from "./VoiceBusyContext";

/**
 * Puente de sesión de voz (no renderiza nada). Tres trabajos:
 *
 * 1. Transcripción central: registra cada mensaje (usuario/Hermes) en el estado
 *    compartido (sobrevive a pausar/reactivar la llamada).
 * 2. MEMORIA DE SESIÓN: si se pausa la llamada y se reactiva SIN recargar la
 *    página, al reconectar le reenvía a Hermes lo último que hablamos como
 *    contextual update, para que retome el hilo en vez de empezar de cero.
 * 3. Preview de artefactos: cuando una tarea lanzada por voz termina, trae su
 *    resultado COMPLETO y lo publica como markdown para el centro de la pantalla.
 */
export function VoiceSessionBridge({
  events,
  onConnected,
}: {
  events: AgentActivityEvent[];
  /** Se llama en cada (re)conexión → la página cambia a la vista Voz. */
  onConnected?: () => void;
}) {
  const { pushLine, transcript, artifact, setArtifact } = useVoice();
  const { sendContextualUpdate } = useConversationControls();

  const transcriptRef = useRef(transcript);
  transcriptRef.current = transcript;
  const connectedBeforeRef = useRef(false);
  const onConnectedRef = useRef(onConnected);
  onConnectedRef.current = onConnected;

  useConversation({
    onMessage: (p) => pushLine({ who: p.role === "user" ? "TÚ" : "HERMES", text: p.message }),
    onConnect: () => {
      onConnectedRef.current?.();
      // Reconexión (ya hubo una conexión antes en esta carga de página) con
      // historial → reinyecta el contexto para no perder el hilo.
      if (connectedBeforeRef.current && transcriptRef.current.length) {
        const recap = transcriptRef.current
          .slice(-24)
          .map((l) => `${l.who}: ${l.text}`)
          .join("\n");
        sendContextualUpdate(
          `[Continuidad de sesión] El usuario reactivó la voz sin recargar la página: es la MISMA conversación de hace un momento, no una nueva. No vuelvas a saludar como si empezáramos; retoma el hilo con naturalidad. Lo último que hablamos fue:\n${recap}`.slice(
            0,
            1800,
          ),
        );
      }
      connectedBeforeRef.current = true;
    },
  });

  // Artefacto: al terminar la tarea de voz en curso, trae el resultado completo.
  const artRef = useRef(artifact);
  artRef.current = artifact;
  const fetchedRef = useRef<string>("");
  useEffect(() => {
    const a = artRef.current;
    if (!a || a.status !== "running" || !a.taskId || fetchedRef.current === a.taskId) return;
    const hit = events.find(
      (e) => e.taskId === a.taskId && (e.kind === "task_done" || e.kind === "error"),
    );
    if (!hit) return;
    fetchedRef.current = a.taskId;
    void (async () => {
      try {
        const t = await hermesGet<{ status: string; result?: string }>(
          `/tasks/${encodeURIComponent(a.taskId!)}`,
        );
        setArtifact({
          title: a.title,
          taskId: a.taskId,
          md: t.result?.trim() || "_(La tarea terminó sin devolver contenido.)_",
          status: t.status === "error" ? "error" : "done",
        });
      } catch {
        setArtifact({ ...a, status: "error", md: a.md || "_(No pude leer el resultado de la tarea.)_" });
      }
    })();
  }, [events, setArtifact]);

  return null;
}
