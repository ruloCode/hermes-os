"use client";

// Voz de la Sala de Agentes: (1) monta las client tools que la llamada
// necesita — la página /sala vive FUERA del shell, así que VoiceClientTools y
// EnglishTutorTools no están montadas y sin ellas get_project_status,
// run_task o save_vocab caerían al vacío; (2) hace pulsar la figura del agente
// que habla con el volumen REAL de salida del SDK (fallback: isSpeaking da un
// pulso fijo). El loop va por rAF y toca la figura por ref: cero re-renders.

import { useEffect, useRef } from "react";
import { useConversationControls, useConversationMode, useConversationStatus } from "@elevenlabs/react";
import { useHermesDataContext } from "@/state/HermesDataProvider";
import { useWorkspace } from "@/state/WorkspaceContext";
import { VoiceClientTools } from "@/components/VoiceClientTools";
import { EnglishTutorTools } from "@/components/EnglishTutorTools";
import type { SalaFigure } from "@/lib/sala/figures";

interface Props {
  /** Figura del agente seleccionado (la que debe pulsar), o undefined. */
  figure: () => SalaFigure | undefined;
}

export function SalaVoice({ figure }: Props) {
  const { projects } = useHermesDataContext();
  const ws = useWorkspace();
  const { status } = useConversationStatus();
  const { isSpeaking } = useConversationMode();
  const { getOutputVolume } = useConversationControls();

  const speakingRef = useRef(isSpeaking);
  speakingRef.current = isSpeaking;
  const connectedRef = useRef(status === "connected");
  connectedRef.current = status === "connected";
  const figureRef = useRef(figure);
  figureRef.current = figure;
  const lastFigureRef = useRef<SalaFigure | undefined>(undefined);

  useEffect(() => {
    let raf = 0;
    let level = 0;
    const step = () => {
      raf = requestAnimationFrame(step);
      const fig = figureRef.current();
      // Cambió el agente: la figura anterior deja de pulsar.
      if (lastFigureRef.current && lastFigureRef.current !== fig) lastFigureRef.current.setPulse(0);
      lastFigureRef.current = fig;
      if (!fig) return;
      let target = 0;
      if (connectedRef.current && speakingRef.current) {
        const v = getOutputVolume();
        // Sin volumen real (algunos transportes no lo exponen): pulso fijo respirado.
        target = Number.isFinite(v) && v > 0.01 ? Math.min(1, v * 1.6) : 0.45 + 0.15 * Math.sin(performance.now() / 120);
      }
      // Ataque rápido, caída suave: se lee como voz, no como estrobo.
      level = target > level ? level + (target - level) * 0.5 : level + (target - level) * 0.15;
      fig.setPulse(level);
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      lastFigureRef.current?.setPulse(0);
    };
  }, [getOutputVolume]);

  return (
    <>
      <VoiceClientTools
        projects={projects}
        onFocusProject={ws.focusProject}
        onShowPanel={ws.showPanel}
        onWork={ws.launchClaudeRun}
      />
      <EnglishTutorTools />
    </>
  );
}
