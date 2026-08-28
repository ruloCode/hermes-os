"use client";

import { useEffect, useRef } from "react";
import { useConversationMode } from "@elevenlabs/react";
import { Panel } from "@/components/ui/Panel";
import { VoiceWaveform } from "./VoiceWaveform";
import { useVoiceConnect } from "@/hooks/useVoiceConnect";
import { useVoice } from "./VoiceBusyContext";

/**
 * Panel de voz (sidebar): MINI-ESTADO de la llamada — waveform REAL del audio
 * (VoiceWaveform compartido) + transcripción. La transcripción se lee del
 * estado COMPARTIDO (VoiceSessionBridge la registra), así coincide con la
 * vista Voz y sobrevive a pausar/reactivar. La entrada canónica a la llamada
 * vive en el composer de la consola / ⌘K (un solo botón de iniciar por
 * superficie); aquí solo queda colgar. Vive DENTRO de <ConversationProvider>.
 */
export function VoicePanel() {
  const { action, transcript } = useVoice();
  const { disconnect, error, configured, connected, connecting } = useVoiceConnect();
  const { isSpeaking } = useConversationMode();

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [transcript.length]);

  const statusText = !configured
    ? "N/A"
    : connected
      ? action
        ? "EJECUTANDO"
        : isSpeaking
          ? "HABLANDO"
          : "ESCUCHANDO"
      : connecting
        ? "CONECTANDO"
        : "OFF";
  const statusClass = !configured
    ? "text-text-dim"
    : connected
      ? action
        ? "text-cyan"
        : isSpeaking
          ? "text-violet-hot"
          : "text-green"
      : connecting
        ? "text-amber"
        : "text-text-dim";

  return (
    <Panel
      title="Voz"
      delay={150}
      right={
        <span className={`text-2xs tracking-label uppercase ${statusClass}`}>{statusText}</span>
      }
    >
      <div className="flex flex-col gap-2.5">
        {/* Waveform real (línea plana y tenue cuando no hay llamada) */}
        <VoiceWaveform height={44} idleMessage />

        {/* Acción de voz en curso */}
        {action && <div className="text-2xs text-cyan">⚙ {action}…</div>}

        {/* Transcripción en vivo */}
        <div
          ref={scrollRef}
          className="max-h-24 min-h-[28px] space-y-1 overflow-y-auto pr-1 text-xs leading-snug"
        >
          {error ? (
            <span className="text-red">⚠ {error}</span>
          ) : !configured ? (
            <span className="text-text-dim">
              Voz no configurada — agrega <code className="text-2xs">ELEVENLABS_API_KEY</code> y
              corre <code className="text-2xs">pnpm setup:elevenlabs</code>.
            </span>
          ) : transcript.length ? (
            transcript.map((l, i) => (
              <div key={i} className="flex gap-1.5">
                <b className={`shrink-0 ${l.who === "TÚ" ? "text-cyan" : "text-violet"}`}>
                  {l.who}
                </b>
                <span className="text-text">{l.text}</span>
              </div>
            ))
          ) : connected ? (
            <span className="cursor-blink text-text-dim">Hermes te escucha</span>
          ) : connecting ? (
            <span className="text-amber">Conectando la llamada…</span>
          ) : (
            <span className="text-text-dim">
              Hablar con Hermes vive en la consola (botón de audífonos) o en ⌘K.
            </span>
          )}
        </div>

        {/* Solo colgar: iniciar vive en el composer de la consola / ⌘K */}
        {connected && (
          <button className="cmd-btn justify-center" onClick={() => disconnect()}>
            Terminar llamada
          </button>
        )}
      </div>
    </Panel>
  );
}
