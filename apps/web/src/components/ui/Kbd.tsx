"use client";

// Tecla o atajo ("⌘K", "Esc", "Espacio"). Una sola pieza para las seis
// variantes locales que había (palette, gimnasio, barra lateral, agenda…).
export function Kbd({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={`inline-flex h-5 min-w-5 items-center justify-center rounded-xs border border-line bg-panel px-1 font-sans text-2xs text-text-faint ${className}`}
    >
      {children}
    </kbd>
  );
}
