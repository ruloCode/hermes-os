"use client";

// Pulso de las figuras con la voz REAL de cada sesión de la sala: por rAF y
// por ref, cero re-renders. Cada agente conectado pulsa con SU volumen de
// salida (dos pueden hablar en la tertulia, aunque el relevo evita que se
// pisen); sin volumen medible pero en modo "speaking", pulso fijo respirado.

import { useEffect, useRef } from "react";
import type { SalaCalls } from "@/lib/sala/calls";
import type { SalaFigure } from "@/lib/sala/figures";

interface Props {
  calls: () => SalaCalls | null;
  figures: () => SalaFigure[];
}

export function SalaVoice({ calls, figures }: Props) {
  const callsRef = useRef(calls);
  callsRef.current = calls;
  const figuresRef = useRef(figures);
  figuresRef.current = figures;

  useEffect(() => {
    let raf = 0;
    const levels = new Map<string, number>();
    const step = () => {
      raf = requestAnimationFrame(step);
      const c = callsRef.current();
      for (const fig of figuresRef.current()) {
        let target = 0;
        if (c && c.speaking(fig.key)) {
          const v = c.volume(fig.key);
          target = v > 0.01 ? Math.min(1, v * 1.6) : 0.45 + 0.15 * Math.sin(performance.now() / 120);
        }
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
