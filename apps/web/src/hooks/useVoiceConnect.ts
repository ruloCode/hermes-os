"use client";

import { useCallback, useState } from "react";
import { useConversationControls, useConversationStatus } from "@elevenlabs/react";

/**
 * Lógica de conexión de la llamada de voz, compartida entre el orbe del header
 * y el panel de voz (así no hay dos flujos de conexión que mantener en sync).
 *
 * Flujo: pide permiso de micrófono → obtiene credenciales efímeras de
 * /api/elevenlabs/token → arranca la sesión por WebRTC (o WebSocket de fallback).
 * El estado real (status) sale del ConversationProvider, así que ambos consumidores
 * ven lo mismo aunque uno haya iniciado la llamada.
 */
export function useVoiceConnect() {
  const { startSession, endSession } = useConversationControls();
  const { status } = useConversationStatus();
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
      if (creds.conversationToken) {
        startSession({ conversationToken: creds.conversationToken, connectionType: "webrtc" });
      } else if (creds.signedUrl) {
        startSession({ signedUrl: creds.signedUrl, connectionType: "websocket" });
      } else {
        throw new Error("Sin credenciales de ElevenLabs");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [startSession]);

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
