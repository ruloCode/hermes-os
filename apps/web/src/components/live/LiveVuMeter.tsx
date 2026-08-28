"use client";

import { useEffect, useRef, type RefObject } from "react";

const BARS = 12;

/**
 * VU meter REAL del mic de la junta: lee `levelRef` (RMS que escribe el
 * worklet) con rAF y prende barras con peak-hold. Solo este componente
 * repinta — nada de estado React por frame de audio.
 */
export function LiveVuMeter({ levelRef }: { levelRef: RefObject<number> }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const peakRef = useRef(0);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const rms = levelRef.current ?? 0;
      // sqrt comprime el rango: la voz normal (RMS ~0.02-0.3) llena el meter.
      const level = Math.min(1, Math.sqrt(rms) * 1.8);
      peakRef.current = Math.max(level, peakRef.current - 0.012); // decay del peak
      const el = boxRef.current;
      if (el) {
        const lit = Math.round(level * BARS);
        const peakBar = Math.ceil(peakRef.current * BARS) - 1;
        for (let i = 0; i < el.children.length; i++) {
          const bar = el.children[i] as HTMLElement;
          bar.style.opacity = i < lit || i === peakBar ? "1" : "0.15";
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [levelRef]);

  return (
    <div
      ref={boxRef}
      role="img"
      aria-label="Nivel del micrófono"
      className="flex h-3.5 items-end gap-[2px]"
    >
      {Array.from({ length: BARS }, (_, i) => (
        <span
          key={i}
          // Tonos por zona (verde→amber→rojo) vía clases de token; la altura
          // en rampa es layout, no color.
          className={`w-[3px] rounded-[1px] ${i < 8 ? "bg-green" : i < 10 ? "bg-amber" : "bg-red"}`}
          style={{ height: `${40 + (i / (BARS - 1)) * 60}%`, opacity: 0.15 }}
        />
      ))}
    </div>
  );
}
