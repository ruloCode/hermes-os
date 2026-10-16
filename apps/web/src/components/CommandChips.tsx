"use client";

// Fila de slash-commands bajo el input de la consola (referencia). Cada chip
// ejecuta una capacidad real del registry.
//
// v5: los que requieren proyecto NO se muestran hasta que hay uno enfocado.
// Antes salían al 40% de opacidad con un tooltip — se leían como rotos, y la
// mitad de la fila era ruido justo en la primera pantalla.

import { SlashChip } from "./ui/SlashChip";
import { CHIP_IDS, COMMANDS, useCommandContext } from "@/lib/commands";

export function CommandChips() {
  const ctx = useCommandContext();
  const chips = CHIP_IDS.map((id) => COMMANDS.find((c) => c.id === id)).filter(
    (c): c is NonNullable<typeof c> => Boolean(c?.slash),
  );

  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Comandos rápidos">
      {chips
        .filter((cmd) => !(cmd.requiresProject && !ctx.selectedProject))
        .map((cmd) => (
          <SlashChip
            key={cmd.id}
            command={cmd.slash!}
            description={cmd.hint}
            onClick={() => void cmd.run(ctx)}
          />
        ))}
    </div>
  );
}
