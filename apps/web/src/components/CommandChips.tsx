"use client";

// Fila de slash-commands bajo el input de la consola (referencia). Cada chip
// ejecuta una capacidad real del registry; los que requieren proyecto se
// deshabilitan con tooltip.

import { SlashChip } from "./ui/SlashChip";
import { CHIP_IDS, COMMANDS, useCommandContext } from "@/lib/commands";

export function CommandChips() {
  const ctx = useCommandContext();
  const chips = CHIP_IDS.map((id) => COMMANDS.find((c) => c.id === id)).filter(
    (c): c is NonNullable<typeof c> => Boolean(c?.slash),
  );

  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Comandos rápidos">
      {chips.map((cmd) => {
        const disabled = Boolean(cmd.requiresProject && !ctx.selectedProject);
        return (
          <SlashChip
            key={cmd.id}
            command={cmd.slash!}
            description={
              disabled ? `${cmd.hint ?? cmd.label} — enfoca un proyecto primero` : cmd.hint
            }
            disabled={disabled}
            onClick={() => void cmd.run(ctx)}
          />
        );
      })}
    </div>
  );
}
