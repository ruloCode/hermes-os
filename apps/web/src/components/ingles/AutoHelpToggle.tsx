"use client";

// "Sola: Frase · Pistas · No" — qué ayuda aparece sin pedirla cuando te
// preguntan. v5: el selector segmentado canónico (antes uno hecho a mano con
// el activo en acento; el acento queda para acciones y foco).

import { AUTO_HELP_OPTIONS, useAutoHelp } from "@/lib/auto-help";
import { Segmented } from "@/components/ui/Segmented";

export function AutoHelpToggle({ compact = false }: { compact?: boolean }) {
  const [mode, setMode] = useAutoHelp();
  return (
    <div className="flex items-center gap-2">
      {!compact && <span className="text-xs text-text-faint">Ayuda sola</span>}
      <Segmented
        size="sm"
        ariaLabel="Ayuda automática"
        value={mode}
        onChange={setMode}
        options={AUTO_HELP_OPTIONS.map((o) => ({ value: o.mode, label: o.label, title: o.title }))}
      />
    </div>
  );
}
