"use client";

/**
 * Waveform — visualización CSS del estado de voz.
 * Encapsula las clases globales .wave-bar / .wave-idle: cada barra anima
 * scaleY en loop ("wave" 0.9s infinite) y el modo idle (live=false) la
 * pausa y aplana. Es puramente decorativo (aria-hidden).
 *
 * Las alturas y delays son pseudo-aleatorios deterministas por índice
 * (sin Math.random) para evitar mismatch de hidratación SSR.
 */
export function Waveform({
  bars = 24,
  live,
  level,
  height = 28,
  className = "",
}: {
  bars?: number;
  live: boolean;
  /** Nivel de entrada 0..1 — escala la altura del conjunto vía scaleY. */
  level?: number;
  height?: number;
  className?: string;
}) {
  // Escala del contenedor según nivel; con piso para que nunca desaparezca.
  const scale = level == null ? 1 : Math.max(0.15, Math.min(1, level));
  return (
    <div
      aria-hidden
      className={`flex items-center gap-[2px] ${live ? "" : "wave-idle"} ${className}`}
      style={{
        height: `${height}px`,
        transform: `scaleY(${scale})`,
        transition: "transform 120ms ease-out",
      }}
    >
      {Array.from({ length: bars }, (_, i) => (
        <span
          key={i}
          className="wave-bar"
          style={{
            // Altura determinista por índice: 30%..99% de la altura total.
            height: `${30 + ((i * 37) % 70)}%`,
            animationDelay: `${(i * 57) % 900}ms`,
          }}
        />
      ))}
    </div>
  );
}
