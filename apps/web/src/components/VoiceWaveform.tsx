"use client";

import { useEffect, useRef } from "react";
import { useConversation, useConversationStatus } from "@elevenlabs/react";
import { readToken } from "@/components/ui/tones";

/**
 * VoiceWaveform — espectro REAL de la llamada de voz (frecuencias del SDK de
 * ElevenLabs). Una sola implementación compartida por el panel lateral, la
 * vista Voz y el header: dibuja la SALIDA (violeta) cuando habla Hermes y la
 * ENTRADA (cian) cuando escucha. En reposo (sin llamada) queda una línea
 * plana y tenue, sin rAF corriendo. Vive DENTRO del <ConversationProvider>.
 */
export function VoiceWaveform({
  height = 44,
  className = "",
  idleMessage = false,
}: {
  height?: number;
  className?: string;
  /** Muestra un mini label "EN REPOSO" sobre la línea plana sin llamada. */
  idleMessage?: boolean;
}) {
  const { status } = useConversationStatus();
  const connected = status === "connected";
  const conversation = useConversation();
  const { isSpeaking, getInputByteFrequencyData, getOutputByteFrequencyData } = conversation;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  // isSpeaking en un ref → el loop rAF no se recrea al alternar hablar/escuchar.
  const speakingRef = useRef(isSpeaking);
  speakingRef.current = isSpeaking;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const dpr = Math.max(1, window.devicePixelRatio || 1);

    // Backing store en píxeles físicos → nítido en retina, sin blur.
    const syncSize = () => {
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.round(height * dpr));
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
    };

    // Barras centradas verticalmente; `level(t)` devuelve 0..1 para la
    // posición normalizada t de cada barra. Piso de 2px → línea plana.
    const drawBars = (color: string, level: (t: number) => number) => {
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      const bw = 3.5 * dpr;
      const gap = 1.5 * dpr;
      const bars = Math.max(8, Math.floor(w / (bw + gap)));
      ctx.fillStyle = color;
      for (let i = 0; i < bars; i++) {
        const bh = Math.max(2 * dpr, level(i / bars) * h);
        ctx.fillRect(i * (bw + gap), (h - bh) / 2, bw, bh);
      }
    };

    if (!connected) {
      // Reposo: línea plana y tenue. Cero animación — solo redibuja al resize.
      const faint = readToken("--color-text-faint", "#6b74a8");
      const drawIdle = () => {
        syncSize();
        ctx.globalAlpha = 0.5;
        drawBars(faint, () => 0);
        ctx.globalAlpha = 1;
      };
      drawIdle();
      const ro = new ResizeObserver(drawIdle);
      ro.observe(canvas);
      return () => ro.disconnect();
    }

    // Llamada activa: frecuencias reales del SDK a 60fps.
    const violet = readToken("--color-violet-hot", "#c4b5fd");
    const cyan = readToken("--color-cyan", "#67e8f9");
    const faint = readToken("--color-text-faint", "#6b74a8");
    let raf = 0;
    const draw = () => {
      syncSize();
      const data = speakingRef.current
        ? getOutputByteFrequencyData()
        : getInputByteFrequencyData();
      if (data && data.length) {
        drawBars(speakingRef.current ? violet : cyan, (t) => {
          const idx = Math.min(data.length - 1, Math.floor(t * data.length));
          return data[idx] / 255;
        });
      } else {
        drawBars(faint, () => 0);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    const ro = new ResizeObserver(syncSize);
    ro.observe(canvas);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [connected, height, getInputByteFrequencyData, getOutputByteFrequencyData]);

  return (
    <div className={`relative ${className}`} style={{ height: `${height}px` }}>
      <canvas ref={canvasRef} aria-hidden className="block h-full w-full" />
      {idleMessage && !connected && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="bg-panel px-2 text-2xs tracking-label text-text-faint uppercase">
            en reposo
          </span>
        </span>
      )}
    </div>
  );
}
