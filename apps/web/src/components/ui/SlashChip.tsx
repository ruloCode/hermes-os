"use client";

/**
 * Chip de slash-command bajo el input de la consola. Muestra el comando
 * tal cual (p. ej. "/resumen diario"); al pasar el mouse o estar activo
 * se enciende en el acento con un glow suave.
 */
export function SlashChip({
  command,
  description,
  onClick,
  active = false,
  disabled = false,
}: {
  command: string;
  description?: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  // El glow en hover va como arbitrary property (glow-box-accent es una
  // clase CSS plana, no una utility, y no admite el variant hover:).
  const state = disabled
    ? "cursor-not-allowed border-line text-text-dim opacity-40"
    : active
      ? "border-accent text-accent glow-box-accent"
      : "border-line text-text-dim hover:border-accent hover:text-accent hover:[box-shadow:0_0_12px_color-mix(in_srgb,var(--color-accent)_25%,transparent)]";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={description}
      aria-pressed={active || undefined}
      className={`min-h-7 border bg-transparent px-2 py-1 font-mono text-2xs transition-colors ${state}`}
    >
      {command}
    </button>
  );
}
