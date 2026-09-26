"use client";

/**
 * Cuenta de entrada 4·3·2·1 en una HOJA PEQUEÑA (patrón VEED: la cuenta no
 * tapa lo que vas a grabar). El número lo cambia el motor en cada clic
 * (`onBeat`), así lo que ves y lo que oyes son el mismo instante; los puntos
 * dicen cuántos tiempos quedan. Esc cancela (lo maneja RecordStage, que es el
 * dueño de la grabación).
 */
export function CountInSheet({ count, beats, section }: { count: number; beats: number; section: string }) {
  const n = Math.max(1, Math.min(beats, count));
  return (
    <div
      role="status"
      aria-live="assertive"
      aria-label={`Cuenta de entrada: ${n}`}
      className="pointer-events-none absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-4 rounded-md border border-line bg-panel px-5 py-3 shadow-[var(--shadow-pop)]"
    >
      {/* key={n}: el número re-entra con su animación en cada clic. */}
      <span key={n} className="count-in-pop w-9 text-center font-mono text-4xl leading-none text-text tabular-nums">
        {n}
      </span>
      <span className="flex flex-col gap-1.5">
        <span className="flex gap-1.5" aria-hidden>
          {Array.from({ length: beats }, (_, i) => (
            <span
              key={i}
              className={`h-2 w-2 rounded-full ${i < beats - n ? "bg-text-faint/40" : "bg-accent"}`}
            />
          ))}
        </span>
        <span className="text-xs text-text-dim">
          Entra en «{section}» · <kbd className="font-mono text-2xs">Esc</kbd> cancela
        </span>
      </span>
      <style>{`@keyframes count-in-pop{from{transform:scale(1.25);opacity:.55}to{transform:scale(1);opacity:1}}.count-in-pop{animation:count-in-pop .18s ease-out}@media (prefers-reduced-motion: reduce){.count-in-pop{animation:none}}`}</style>
    </div>
  );
}
