"use client";

import { useCallback, useState } from "react";
import { useConversationControls, useConversationStatus } from "@elevenlabs/react";
import { useVoice, type VoiceMode } from "@/components/VoiceBusyContext";
import { hermesGet } from "@/lib/hermes";
import { useLiveMeeting } from "@/state/LiveMeetingProvider";

/**
 * Lógica de conexión de la llamada de voz, compartida entre el orbe del header
 * y el panel de voz (así no hay dos flujos de conexión que mantener en sync).
 *
 * Flujo: pide permiso de micrófono → obtiene credenciales efímeras de
 * /api/elevenlabs/token → arranca la sesión por WebRTC (o WebSocket de fallback).
 * El estado real (status) sale del ConversationProvider, así que ambos consumidores
 * ven lo mismo aunque uno haya iniciado la llamada.
 *
 * DOS AGENTES sobre el mismo ConversationProvider (startSession recibe el token
 * del agente elegido): "hermes" (default, Jarvis del dashboard) y "tutor"
 * (práctica de inglés — token con ?agent=tutor y dynamic vars propias).
 *
 * SCOPE DE PROYECTO (solo Hermes): si hay un proyecto enfocado al conectar, se
 * inyecta como la dynamic variable `session_scope` → el system prompt del agente
 * ya sabe que estamos dentro de ese proyecto desde el primer turno.
 */
export function useVoiceConnect() {
  const { startSession, endSession } = useConversationControls();
  const { status } = useConversationStatus();
  const { scope, mode, setMode } = useVoice();
  const { active: liveMeetingActive } = useLiveMeeting();
  const [error, setError] = useState("");

  // AGENT_ID es env pública → el cliente sabe si la voz está configurada y
  // degrada con elegancia (sin fetch fallido ni 500).
  const configured = Boolean(process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID);
  const tutorConfigured = Boolean(process.env.NEXT_PUBLIC_ELEVENLABS_TUTOR_AGENT_ID);

  const connect = useCallback(
    async (opts?: { mode?: VoiceMode }) => {
      const targetMode: VoiceMode = opts?.mode ?? "hermes";
      setError("");
      // Guard de mic compartido (bidireccional con LiveMeetingProvider.start):
      // mensaje explícito, sin auto-cortar la junta.
      if (liveMeetingActive) {
        setError("Hay una junta en vivo — termínala antes de llamar a Hermes.");
        return;
      }
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
        const res = await fetch(
          targetMode === "tutor" ? "/api/elevenlabs/token?agent=tutor" : "/api/elevenlabs/token",
        );
        const creds = (await res.json()) as {
          conversationToken?: string;
          signedUrl?: string;
          error?: string;
        };
        if (creds.error) throw new Error(creds.error);
        // Fecha/hora local para que el agente resuelva "mañana", "el viernes a
        // las 3" a datetimes absolutos al crear/mover eventos de calendario.
        const today = new Intl.DateTimeFormat("es-CO", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }).format(new Date());
        let dynamicVariables: Record<string, string>;
        if (targetMode === "tutor") {
          // Progreso real de práctica (última sesión, errores recurrentes,
          // vocabulario por repasar). Best-effort: sin agente local o sin
          // historial, el placeholder del agente cubre el arranque.
          const practiceContext = await hermesGet<{ context: string }>("/english/context")
            .then((r) => r.context)
            .catch(() => "First session — no history yet.");
          dynamicVariables = { practice_context: practiceContext, today };
        } else {
          // Se pasa SIEMPRE (default cuando no hay proyecto) → nunca queda sin valor.
          // scope.prompt (si viene) es un contexto libre que reemplaza al default:
          // /vida lo usa para inyectar el estado financiero real como asesor.
          const sessionScope = scope?.prompt
            ? scope.prompt
            : scope
              ? `El usuario está DENTRO del proyecto "${scope.name}" (slug: ${scope.slug}). Todas sus peticiones son sobre este proyecto salvo que nombre otro. Usa get_project_status con "${scope.slug}" para su estado y work_on_project con "${scope.slug}" para su repo.`
              : "El usuario está en la vista general, sin proyecto enfocado.";
          dynamicVariables = { session_scope: sessionScope, today };
        }
        // El modo se fija ANTES del startSession: los bridges (labels del
        // transcript, gating del scope) ya ven al agente correcto al conectar.
        setMode(targetMode);
        if (creds.conversationToken) {
          startSession({
            conversationToken: creds.conversationToken,
            connectionType: "webrtc",
            dynamicVariables,
          });
        } else if (creds.signedUrl) {
          startSession({ signedUrl: creds.signedUrl, connectionType: "websocket", dynamicVariables });
        } else {
          throw new Error("Sin credenciales de ElevenLabs");
        }
      } catch (err) {
        setMode("hermes");
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [startSession, scope, liveMeetingActive, setMode],
  );

  /** Corta la sesión actual (si la hay) y conecta con el otro agente. */
  const switchTo = useCallback(
    async (m: VoiceMode) => {
      if (status === "connected" || status === "connecting") {
        await endSession();
        // Respiro corto: deja que el SDK suelte el room WebRTC anterior.
        await new Promise((r) => setTimeout(r, 400));
      }
      await connect({ mode: m });
    },
    [status, endSession, connect],
  );

  return {
    connect,
    disconnect: endSession,
    switchToTutor: () => switchTo("tutor"),
    switchToHermes: () => switchTo("hermes"),
    status,
    error,
    configured,
    tutorConfigured,
    mode,
    connected: status === "connected",
    connecting: status === "connecting",
  };
}
