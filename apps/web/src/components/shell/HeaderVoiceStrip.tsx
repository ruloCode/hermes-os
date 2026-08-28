"use client";

import { useConversationMode } from "@elevenlabs/react";
import { VoiceOrb } from "@/components/VoiceOrb";
import { VoiceWaveform } from "@/components/VoiceWaveform";
import { useVoiceBusy } from "@/components/VoiceBusyContext";
import { useVoiceConnect } from "@/hooks/useVoiceConnect";

/**
 * HeaderVoiceStrip — pieza central del header: espectro compacto del audio
 * REAL de la llamada + orbe de voz (control siempre visible) + estado mini.
 * Replica el mapeo de estado de VoicePanel (una sola verdad visual); todo
 * sale de hooks compartidos, sin props. Vive DENTRO del <ConversationProvider>.
 */
export function HeaderVoiceStrip() {
  const { configured, connected, connecting, mode } = useVoiceConnect();
  const { isSpeaking } = useConversationMode();
  const { action } = useVoiceBusy();

  const tutor = mode === "tutor";
  const label = !configured
    ? "N/A"
    : connected
      ? action
        ? "EJECUTANDO"
        : tutor
          ? "TUTOR EN" // sesión de práctica de inglés activa
          : isSpeaking
            ? "HABLANDO"
            : "ESCUCHANDO"
      : connecting
        ? "CONECTANDO"
        : "OFF";
  const labelClass = !configured
    ? "text-text-dim"
    : connected
      ? action
        ? "text-cyan"
        : tutor
          ? "text-green"
          : isSpeaking
            ? "text-violet-hot"
            : "text-green"
      : connecting
        ? "text-amber"
        : "text-text-dim";

  return (
    <div className="flex items-center gap-3">
      {/* Espectro compacto — solo en pantallas anchas */}
      <div className="hidden w-[150px] lg:block">
        <VoiceWaveform height={26} />
      </div>
      <VoiceOrb />
      <span className={`hidden text-2xs tracking-label uppercase md:inline ${labelClass}`}>
        {label}
      </span>
    </div>
  );
}
