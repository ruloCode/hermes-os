"use client";

import { useState } from "react";
import { useConversation } from "@elevenlabs/react";
import { Panel } from "./Panel";

/**
 * Panel de voz. Vive DENTRO de <ConversationProvider> (ver page.tsx),
 * donde también están registrados los clientTools que llaman al agente
 * local en localhost:8642.
 */
export function VoicePanel() {
  const [lastLine, setLastLine] = useState<string>("");
  const [error, setError] = useState<string>("");

  // El AGENT_ID es una env pública → el cliente puede saber si la voz está
  // configurada y degradar con elegancia (sin fetch fallido ni 500).
  const voiceConfigured = Boolean(process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID);

  const conversation = useConversation({
    onMessage: (payload: { message: string; role?: string; source?: string }) => {
      const who = payload.role === "user" || payload.source === "user" ? "TÚ" : "HERMES";
      setLastLine(`${who}: ${payload.message}`);
    },
    onError: (message: unknown) => setError(String(message)),
  });

  const { status, isSpeaking } = conversation;
  const connected = status === "connected";
  const connecting = status === "connecting";

  const connect = async () => {
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
        conversation.startSession({
          conversationToken: creds.conversationToken,
          connectionType: "webrtc",
        });
      } else if (creds.signedUrl) {
        conversation.startSession({
          signedUrl: creds.signedUrl,
          connectionType: "websocket",
        });
      } else {
        throw new Error("Sin credenciales de ElevenLabs");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Panel
      title="Voice Command"
      delay={300}
      right={
        <span
          className="text-[9px] tracking-[0.2em] uppercase"
          style={{
            color: !voiceConfigured
              ? "var(--text-dim)"
              : connected
                ? "var(--green)"
                : connecting
                  ? "var(--amber)"
                  : "var(--text-dim)",
          }}
        >
          {!voiceConfigured
            ? "N/A"
            : connected
              ? isSpeaking
                ? "HABLANDO"
                : "ESCUCHANDO"
              : connecting
                ? "CONECTANDO"
                : "OFF"}
        </span>
      }
    >
      <div className="flex flex-col gap-3">
        {/* Waveform */}
        <div
          className={`flex h-12 items-center justify-center gap-[3px] ${
            connected && isSpeaking ? "" : "wave-idle"
          }`}
        >
          {Array.from({ length: 32 }).map((_, i) => (
            <span
              key={i}
              className="wave-bar"
              style={{
                height: `${14 + Math.abs(Math.sin(i * 0.55)) * 26}px`,
                animationDelay: `${(i % 8) * 0.09}s`,
                animationDuration: `${0.7 + (i % 5) * 0.08}s`,
              }}
            />
          ))}
        </div>

        <div className="min-h-[28px] text-[10.5px] leading-snug" style={{ color: "var(--text-dim)" }}>
          {!voiceConfigured ? (
            <span>
              Voz no configurada — agrega{" "}
              <code className="text-[10px]">ELEVENLABS_API_KEY</code> y corre{" "}
              <code className="text-[10px]">pnpm setup:elevenlabs</code>.
            </span>
          ) : error ? (
            <span style={{ color: "var(--red)" }}>⚠ {error}</span>
          ) : lastLine ? (
            <span className="line-clamp-2">{lastLine}</span>
          ) : connected ? (
            <span className="cursor-blink">Hermes te escucha </span>
          ) : (
            "Conecta el micrófono para hablar con Hermes en tiempo real."
          )}
        </div>

        {!voiceConfigured ? (
          <button className="cmd-btn justify-center" disabled title="Configura ElevenLabs en .env">
            Voz no configurada
          </button>
        ) : connected ? (
          <button className="cmd-btn justify-center" onClick={() => void conversation.endSession()}>
            Terminar sesión
          </button>
        ) : (
          <button className="cmd-btn justify-center" disabled={connecting} onClick={() => void connect()}>
            {connecting ? "Conectando…" : "Iniciar voz"}
          </button>
        )}
      </div>
    </Panel>
  );
}
