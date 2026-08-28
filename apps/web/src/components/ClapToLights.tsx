"use client";

import { useEffect, useRef } from "react";
import { useConversationStatus } from "@elevenlabs/react";
import { hermesPost } from "@/lib/hermes";
import { createClapDetector } from "@/lib/clap-detector";
import { useVoice } from "./VoiceBusyContext";

/**
 * 👏👏 → toggle de la tira de luces, SOLO con el modo voz conectado (agente
 * Hermes, no el tutor). No renderiza nada: es un bridge como VoiceClientTools.
 *
 * Abre un SEGUNDO stream del micrófono (Chrome multiplexa sin pelear con la
 * llamada WebRTC) con AEC activo — cancela la voz TTS de Hermes saliendo por
 * los parlantes — y SIN noise suppression ni AGC, que suavizan justo los
 * transitorios que buscamos. El análisis corre a ~60 fps sobre un
 * AnalyserNode; la lógica de "qué es un doble aplauso" vive pura en
 * lib/clap-detector.ts.
 *
 * QA sin aplaudir: window.__hermesClapSim() dispara el toggle real.
 */
export function ClapToLights() {
  const { status } = useConversationStatus();
  const { mode, setAction } = useVoice();
  const busyRef = useRef(false);
  const active = status === "connected" && mode === "hermes";

  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let raf = 0;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;

    const toggle = async () => {
      if (busyRef.current) return;
      busyRef.current = true;
      setAction("👏 Luces");
      try {
        const res = await hermesPost<{ ok: boolean; detail?: string; error?: string }>(
          "/lights/command",
          { action: "toggle" },
        );
        setAction(res.ok ? `👏 ${res.detail ?? "luces"}` : "👏 luces sin respuesta");
      } catch {
        setAction("👏 luces sin respuesta");
      } finally {
        setTimeout(() => setAction(null), 1600);
        busyRef.current = false;
      }
    };

    const detector = createClapDetector({ onDoubleClap: () => void toggle() });

    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false },
        });
        if (stopped) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        ctx = new AudioContext();
        void ctx.resume();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        ctx.createMediaStreamSource(stream).connect(analyser);
        const buf = new Float32Array(analyser.fftSize);
        const loop = () => {
          if (stopped) return;
          analyser.getFloatTimeDomainData(buf);
          let peak = 0;
          for (let i = 0; i < buf.length; i++) {
            const a = Math.abs(buf[i]);
            if (a > peak) peak = a;
          }
          detector.feed(peak, performance.now());
          raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
      } catch {
        // Sin permiso o sin mic: el aplauso simplemente no está — la voz sigue.
      }
    })();

    const w = window as unknown as { __hermesClapSim?: () => void };
    w.__hermesClapSim = () => void toggle();
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      void ctx?.close();
      delete w.__hermesClapSim;
    };
  }, [active, setAction]);

  return null;
}
