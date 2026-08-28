"use client";

import { useEffect, useRef } from "react";
import { useConversationControls, useConversationMode } from "@elevenlabs/react";
import { useVoiceConnect } from "@/hooks/useVoiceConnect";
import { useWorkspace } from "@/state/WorkspaceContext";
import { useVoiceBusy } from "./VoiceBusyContext";

/**
 * Orbe de voz del header: INDICADOR de estado siempre visible + atajo a la
 * vista Voz en vivo (la entrada canónica a la llamada vive en el composer de
 * la consola y en ⌘K — patrón ChatGPT: un solo botón de iniciar por superficie).
 * El orbe reacciona al AUDIO REAL (volumen de entrada cuando escucha, de
 * salida cuando habla) y su color refleja el estado: OFF · CONECTANDO ·
 * ESCUCHANDO · HABLANDO · EJECUTANDO (una client tool de voz en curso).
 * Vive DENTRO del ConversationProvider.
 */
type OrbState = "na" | "off" | "connecting" | "listening" | "speaking" | "exec";

// Color runtime del orbe (alimenta la var --orb del CSS); no mapeable a clase.
const COLOR: Record<OrbState, string> = {
  na: "var(--color-text-dim)",
  off: "var(--color-violet)",
  connecting: "var(--color-amber)",
  listening: "var(--color-green)",
  speaking: "var(--color-violet-hot)",
  exec: "var(--color-cyan)",
};

// Clase de color del label según estado (mismo tono que el orbe).
const LABEL_CLASS: Record<OrbState, string> = {
  na: "text-text-dim",
  off: "text-violet",
  connecting: "text-amber",
  listening: "text-green",
  speaking: "text-violet-hot",
  exec: "text-cyan",
};

export function VoiceOrb() {
  const { error, configured, connected, connecting } = useVoiceConnect();
  const ws = useWorkspace();
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
        ? "OFF"
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

  // El orbe ya no conecta/cuelga: es estado + atajo (colgar vive en la vista Voz).
  const onClick = () => {
    if (!configured) return;
    ws.showPanel("voz");
  };

  const color = COLOR[state];

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!configured}
      title={error || (connected ? "Llamada activa — abrir Voz en vivo" : "Abrir Voz en vivo")}
      aria-label={configured ? label : "Voz no configurada"}
      className="voice-orb-btn mb-0.5 flex items-center gap-2"
    >
      <span
        ref={orbRef}
        className={`voice-orb ${connected ? "voice-orb-live" : ""}`}
        style={{ ["--orb" as string]: color }}
      />
      <span className="hidden flex-col items-start leading-none sm:flex">
        <span className={`text-2xs tracking-label uppercase ${LABEL_CLASS[state]}`}>{label}</span>
        <span className="text-2xs tracking-title uppercase text-text-dim">Voz</span>
      </span>
    </button>
  );
}
