"use client";

import { useEffect, useRef } from "react";
import { useConversationControls, useConversationMode } from "@elevenlabs/react";
import { useVoiceConnect } from "@/hooks/useVoiceConnect";
import { useVoiceBusy } from "./VoiceBusyContext";

/**
 * Orbe de voz del header: el control siempre visible para iniciar/colgar la
 * llamada con Hermes desde cualquier vista. El orbe reacciona al AUDIO REAL
 * (volumen de entrada cuando escucha, de salida cuando habla) y su color refleja
 * el estado: OFF · CONECTANDO · ESCUCHANDO · HABLANDO · EJECUTANDO (una client
 * tool de voz en curso). Vive DENTRO del ConversationProvider.
 */
type OrbState = "na" | "off" | "connecting" | "listening" | "speaking" | "exec";

const COLOR: Record<OrbState, string> = {
  na: "var(--text-dim)",
  off: "var(--violet)",
  connecting: "var(--amber)",
  listening: "var(--green)",
  speaking: "var(--violet-hot)",
  exec: "var(--cyan)",
};

export function VoiceOrb() {
  const { connect, disconnect, error, configured, connected, connecting } = useVoiceConnect();
  const { isSpeaking } = useConversationMode();
  const { getInputVolume, getOutputVolume } = useConversationControls();
  const { action } = useVoiceBusy();
  const orbRef = useRef<HTMLSpanElement>(null);
  // isSpeaking en un ref → el loop rAF no se recrea en cada cambio de modo.
  const speakingRef = useRef(isSpeaking);
  speakingRef.current = isSpeaking;

  const state: OrbState = !configured
    ? "na"
    : connecting
      ? "connecting"
      : !connected
        ? "off"
        : action
          ? "exec"
          : isSpeaking
            ? "speaking"
            : "listening";

  const label =
    state === "na"
      ? "VOZ N/A"
      : state === "off"
        ? "HABLAR"
        : state === "connecting"
          ? "CONECTANDO"
          : state === "exec"
            ? (action ?? "EJECUTANDO")
            : state === "speaking"
              ? "HABLANDO"
              : "ESCUCHANDO";

  // Glow/escala reactivos al volumen real. rAF solo mientras hay llamada.
  useEffect(() => {
    if (!connected) {
      orbRef.current?.style.setProperty("--v", "0");
      return;
    }
    let raf = 0;
    const tick = () => {
      const vol = speakingRef.current ? getOutputVolume() : getInputVolume();
      const v = Math.min(1, Math.max(0, Number.isFinite(vol) ? vol : 0));
      orbRef.current?.style.setProperty("--v", v.toFixed(3));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [connected, getInputVolume, getOutputVolume]);

  const onClick = () => {
    if (!configured) return;
    if (connected || connecting) disconnect();
    else void connect();
  };

  const color = COLOR[state];

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!configured}
      title={error || (connected ? "Terminar llamada con Hermes" : "Hablar con Hermes")}
      aria-label={configured ? label : "Voz no configurada"}
      className="voice-orb-btn mb-0.5 flex items-center gap-2"
    >
      <span
        ref={orbRef}
        className={`voice-orb ${connected ? "voice-orb-live" : ""}`}
        style={{ ["--orb" as string]: color }}
      />
      <span className="hidden flex-col items-start leading-none sm:flex">
        <span className="text-[9px] tracking-[0.25em] uppercase" style={{ color }}>
          {label}
        </span>
        <span className="text-[8px] tracking-[0.28em] uppercase" style={{ color: "var(--text-dim)" }}>
          Voz
        </span>
      </span>
    </button>
  );
}
