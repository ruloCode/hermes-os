"use client";

import { AUTO_HELP_OPTIONS, useAutoHelp } from "@/lib/auto-help";

/** "Sola: Frase · Pistas · No" — qué ayuda aparece sin pedirla cuando te preguntan. */
export function AutoHelpToggle({ compact = false }: { compact?: boolean }) {
  const [mode, setMode] = useAutoHelp();
  return (
    <div className="flex items-center gap-1.5">
      {!compact && <span className="text-2xs text-text-dim">Sola:</span>}
      <div role="radiogroup" aria-label="Ayuda automática" className="flex rounded-sm border border-line">
        {AUTO_HELP_OPTIONS.map((o) => (
          <button
            key={o.mode}
            type="button"
            role="radio"
            aria-checked={mode === o.mode}
            onClick={() => setMode(o.mode)}
            title={o.title}
            className={`px-2 py-0.5 text-2xs transition-colors ${
              mode === o.mode ? "bg-accent/15 text-accent" : "text-text-dim hover:text-text"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
