"use client";

// Marca v5 "Grafito": una hoja índigo redondeada con una "H" cuyo travesaño
// SUBE — el mensajero en marcha. Reemplaza al hexágono terracota de v4, que
// era el color de otro producto. Usa tokens (accent-solid / on-accent), así
// que sigue al tema sin variantes.

/** Marca v5: hoja índigo con una "H" cuyo travesaño sube — el mensajero en marcha. */
export function HermesMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect width="24" height="24" rx="7" className="fill-accent-solid" />
      <path
        d="M8.2 6.8v10.4M15.8 6.8v10.4M8.2 13.4l7.6-2.8"
        stroke="var(--color-on-accent)"
        strokeWidth="2.1"
        strokeLinecap="round"
      />
    </svg>
  );
}
