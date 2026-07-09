"use client";

import { useCallback, useState } from "react";
import { useConversationControls, useConversationStatus } from "@elevenlabs/react";
import { useVoice } from "@/components/VoiceBusyContext";

/**
 * Lógica de conexión de la llamada de voz, compartida entre el orbe del header
 * y el panel de voz (así no hay dos flujos de conexión que mantener en sync).
 *
 * Flujo: pide permiso de micrófono → obtiene credenciales efímeras de
 * /api/elevenlabs/token → arranca la sesión por WebRTC (o WebSocket de fallback).
 * El estado real (status) sale del ConversationProvider, así que ambos consumidores
 * ven lo mismo aunque uno haya iniciado la llamada.
 *
 * SCOPE DE PROYECTO: si hay un proyecto enfocado al conectar, se inyecta como la
 * dynamic variable `session_scope` → el system prompt del agente ya sabe que
 * estamos dentro de ese proyecto y responde centrado en él desde el primer turno.
 */
export function useVoiceConnect() {
  const { startSession, endSession } = useConversationControls();
  const { status } = useConversationStatus();
  const { scope } = useVoice();
  const [error, setError] = useState("");

  // AGENT_ID es env pública → el cliente sabe si la voz está configurada y
  // degrada con elegancia (sin fetch fallido ni 500).
  const configured = Boolean(process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID);

  const connect = useCallback(async () => {
    setError("");
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      const res = await fetch("/api/elevenlabs/token");
      const creds = (await res.json()) as {
        conversationToken?: string;
        signedUrl?: string;
        error?: string;
      };
      if (creds.error) throw new Error(creds.error);
      // Se pasa SIEMPRE (default cuando no hay proyecto) → nunca queda sin valor.
      const sessionScope = scope
        ? `El usuario está DENTRO del proyecto "${scope.name}" (slug: ${scope.slug}). Todas sus peticiones son sobre este proyecto salvo que nombre otro. Usa get_project_status con "${scope.slug}" para su estado y work_on_project con "${scope.slug}" para su repo.`
        : "El usuario está en la vista general, sin proyecto enfocado.";
      const dynamicVariables = { session_scope: sessionScope };
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
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [startSession, scope]);

  return {
    connect,
    disconnect: endSession,
    status,
    error,
    configured,
    connected: status === "connected",
    connecting: status === "connecting",
  };
}
