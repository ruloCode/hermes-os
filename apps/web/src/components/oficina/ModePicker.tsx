"use client";

// Modo de permisos de un agente, los mismos de Claude Code: Auto · Editar ·
// Plan · Preguntar. Shift+Tab (o View en el control) los recorre, como en la
// terminal. La explicación de abajo es la del modo elegido: qué va a pasar
// cuando el agente quiera hacer algo con efectos.

import { OFFICE_MODES, type OfficeMode } from "@hermes/shared";

export function ModePicker({
  value,
  onChange,
  padConnected,
  note,
}: {
  value: OfficeMode;
  onChange: (mode: OfficeMode) => void;
  padConnected: boolean;
  /** Aviso bajo la explicación (p. ej. "Haiku no soporta Auto"). */
  note?: string | null;
}) {
  const current = OFFICE_MODES.find((m) => m.value === value) ?? OFFICE_MODES[0];
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-text-dim">Modo</span>
        <span className="text-xs text-text-faint">{padConnected ? "View" : "Shift+Tab"} cambia</span>
      </div>
      <div role="radiogroup" aria-label="Modo de permisos" className="mt-1 grid grid-cols-4 gap-1 rounded-lg border border-line bg-panel-2 p-1">
        {OFFICE_MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            role="radio"
            aria-checked={m.value === value}
            title={m.hint}
            onClick={() => onChange(m.value)}
            className={`rounded-md px-2 py-1.5 text-sm transition-colors ${
              m.value === value ? "bg-accent font-medium text-white" : "text-text-dim hover:bg-panel hover:text-text"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-xs text-text-dim">{current.hint}</p>
      {note ? <p className="mt-1 text-xs text-amber">{note}</p> : null}
    </div>
  );
}

/** Con Haiku el CLI no tiene modo Auto: arranca preguntando todo. Mejor decirlo antes. */
export function modeNote(mode: OfficeMode, model: string): string | null {
  if (mode === "auto" && /haiku/i.test(model)) return "Haiku no tiene modo Auto: el CLI arrancará en Preguntar.";
  return null;
}
