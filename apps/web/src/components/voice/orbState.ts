"use client";

// Estado del orbe de voz + volumen real de la llamada, en UN solo sitio.
// Antes esta derivación vivía dentro de VoiceOrb; se extrajo para que el orbe
// CSS del header y el orbe 3D del home lean EXACTAMENTE el mismo estado y no
// se desincronicen.
// Vive DENTRO del ConversationProvider.

import { useCallback, useRef } from "react";
import { useConversationControls, useConversationMode } from "@elevenlabs/react";
import { useVoiceConnect } from "@/hooks/useVoiceConnect";
import { useVoiceBusy } from "@/components/VoiceBusyContext";

export type OrbState = "na" | "off" | "connecting" | "listening" | "speaking" | "exec";

export function useOrbState(): { state: OrbState; getVolume: () => number } {
  const { configured, connected, connecting } = useVoiceConnect();
  const { isSpeaking } = useConversationMode();
  const { getInputVolume, getOutputVolume } = useConversationControls();
  const { action } = useVoiceBusy();

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

  // Refs para que getVolume sea estable: el loop rAF del orbe 3D lo llama cada
  // frame y no debe recrearse en cada cambio de modo.
  const speakingRef = useRef(isSpeaking);
  speakingRef.current = isSpeaking;
  const connectedRef = useRef(connected);
  connectedRef.current = connected;

  const getVolume = useCallback(() => {
    if (!connectedRef.current) return 0;
    const v = speakingRef.current ? getOutputVolume() : getInputVolume();
    return Number.isFinite(v) ? v : 0;
  }, [getInputVolume, getOutputVolume]);

  return { state, getVolume };
}
