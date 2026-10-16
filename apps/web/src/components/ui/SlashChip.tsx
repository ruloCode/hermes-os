"use client";

/**
 * Chip de slash-command bajo el input de la consola ("/resumen diario").
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
  const state = disabled
    ? "cursor-not-allowed border-dashed border-line text-text-faint"
    : active
      ? "border-accent/40 bg-accent/10 text-accent"
      : "cursor-pointer border-line bg-panel text-text-dim hover:border-line-2 hover:bg-hover hover:text-text";

  // v5: píldora en sans, no caja en mono. El "/" va atenuado: lo que se lee
  // es la capacidad ("Resumen diario"), el slash es solo la sintaxis.
  const name = command.replace(/^\//, "");
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={description}
      aria-pressed={active || undefined}
      className={`inline-flex h-7 items-center rounded-full border px-3 text-xs transition-colors ${state}`}
    >
      <span className="mr-0.5 text-text-faint">/</span>
      {name}
    </button>
  );
}
