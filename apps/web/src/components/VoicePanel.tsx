"use client";

import { useEffect, useRef } from "react";
import { useConversation } from "@elevenlabs/react";
import { Panel } from "./Panel";
import { useVoiceConnect } from "@/hooks/useVoiceConnect";
import { useVoice } from "./VoiceBusyContext";

/**
 * Panel de voz (sidebar): waveform REAL del audio (frecuencias del SDK) +
 * transcripción de la llamada. La transcripción se lee del estado COMPARTIDO
 * (VoiceSessionBridge la registra), así coincide con la vista Voz y sobrevive
 * a pausar/reactivar. El control de conexión comparte `useVoiceConnect` con el
 * orbe del header. Vive DENTRO de <ConversationProvider>.
 */
export function VoicePanel() {
  const { action, transcript } = useVoice();
  const { connect, disconnect, error, configured, connected, connecting } = useVoiceConnect();

  const conversation = useConversation();
  const { isSpeaking, getInputByteFrequencyData, getOutputByteFrequencyData } = conversation;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const speakingRef = useRef(isSpeaking);
  speakingRef.current = isSpeaking;

  // Waveform real: barras de frecuencia. Salida cuando habla Hermes, entrada
  // cuando escucha. rAF solo mientras hay llamada.
  useEffect(() => {
    if (!connected) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    let raf = 0;
    const draw = () => {
      const data = speakingRef.current
        ? getOutputByteFrequencyData()
        : getInputByteFrequencyData();
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      if (data && data.length) {
        const bars = 44;
        const step = Math.floor(data.length / bars) || 1;
        const bw = w / bars;
        ctx.fillStyle = speakingRef.current ? "#c4b5fd" : "#6ee7a0";
        for (let i = 0; i < bars; i++) {
          const v = data[i * step] / 255;
          const bh = Math.max(2, v * h);
          ctx.fillRect(i * bw, (h - bh) / 2, bw - 1.5, bh);
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [connected, getInputByteFrequencyData, getOutputByteFrequencyData]);

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
  const statusColor = !configured
    ? "var(--text-dim)"
    : connected
      ? action
        ? "var(--cyan)"
        : isSpeaking
          ? "var(--violet-hot)"
          : "var(--green)"
      : connecting
        ? "var(--amber)"
        : "var(--text-dim)";

  return (
    <Panel
      title="Voz"
      delay={150}
      right={
        <span className="text-[9px] tracking-[0.2em] uppercase" style={{ color: statusColor }}>
          {statusText}
        </span>
      }
    >
      <div className="flex flex-col gap-2.5">
        {/* Waveform real (o barras idle decorativas cuando no hay llamada) */}
        <div className="flex h-11 items-center justify-center">
          {connected ? (
            <canvas ref={canvasRef} width={280} height={40} className="h-10 w-full" />
          ) : (
            <div className="wave-idle flex h-10 items-center justify-center gap-[3px]">
              {Array.from({ length: 28 }).map((_, i) => (
                <span
                  key={i}
                  className="wave-bar"
                  style={{
                    height: `${10 + Math.abs(Math.sin(i * 0.5)) * 20}px`,
                    animationDelay: `${(i % 8) * 0.09}s`,
                  }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Acción de voz en curso */}
        {action && (
          <div className="text-[10px]" style={{ color: "var(--cyan)" }}>
            ⚙ {action}…
          </div>
        )}

        {/* Transcripción en vivo */}
        <div
          ref={scrollRef}
          className="max-h-24 min-h-[28px] space-y-1 overflow-y-auto pr-1 text-[10.5px] leading-snug"
        >
          {error ? (
            <span style={{ color: "var(--red)" }}>⚠ {error}</span>
          ) : !configured ? (
            <span style={{ color: "var(--text-dim)" }}>
              Voz no configurada — agrega <code className="text-[10px]">ELEVENLABS_API_KEY</code> y corre{" "}
              <code className="text-[10px]">pnpm setup:elevenlabs</code>.
            </span>
          ) : transcript.length ? (
            transcript.map((l, i) => (
              <div key={i} className="flex gap-1.5">
                <b
                  className="shrink-0"
                  style={{ color: l.who === "TÚ" ? "var(--cyan)" : "var(--violet)" }}
                >
                  {l.who}
                </b>
                <span style={{ color: "var(--text)" }}>{l.text}</span>
              </div>
            ))
          ) : connected ? (
            <span className="cursor-blink" style={{ color: "var(--text-dim)" }}>
              Hermes te escucha
            </span>
          ) : (
            <span style={{ color: "var(--text-dim)" }}>
              Inicia la voz para hablar con Hermes en tiempo real.
            </span>
          )}
        </div>

        {/* Control (comparte estado con el orbe del header) */}
        {!configured ? (
          <button className="cmd-btn justify-center" disabled title="Configura ElevenLabs en .env">
            Voz no configurada
          </button>
        ) : connected ? (
          <button className="cmd-btn justify-center" onClick={() => disconnect()}>
            Terminar llamada
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
