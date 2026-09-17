"use client";

// Pulso de las figuras con la voz REAL: por rAF y por ref, cero re-renders.
// `pulseOf(key)` devuelve el nivel objetivo (0..1) de cada figura — en el
// elenco es el volumen de salida SOLO para el personaje que está sonando; en
// el modo de sesiones separadas, el volumen de la sesión de cada agente. Sin
// volumen medible pero hablando, pulso fijo respirado.

import { useEffect, useRef } from "react";
import type { SalaFigure } from "@/lib/sala/figures";

interface Props {
  /** Nivel objetivo por figura: { speaking, volume }. */
  pulseOf: (key: string) => { speaking: boolean; volume: number };
  figures: () => SalaFigure[];
}

export function SalaVoice({ pulseOf, figures }: Props) {
  const pulseRef = useRef(pulseOf);
  pulseRef.current = pulseOf;
  const figuresRef = useRef(figures);
  figuresRef.current = figures;

  useEffect(() => {
    let raf = 0;
    const levels = new Map<string, number>();
    const step = () => {
      raf = requestAnimationFrame(step);
      for (const fig of figuresRef.current()) {
        const { speaking, volume } = pulseRef.current(fig.key);
        let target = 0;
        if (speaking) target = volume > 0.01 ? Math.min(1, volume * 1.6) : 0.45 + 0.15 * Math.sin(performance.now() / 120);
        const prev = levels.get(fig.key) ?? 0;
        // Ataque rápido, caída suave: se lee como voz, no como estrobo.
        const level = target > prev ? prev + (target - prev) * 0.5 : prev + (target - prev) * 0.15;
        levels.set(fig.key, level);
        fig.setPulse(level);
      }
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      for (const fig of figuresRef.current()) fig.setPulse(0);
    };
  }, []);

  return null;
}
