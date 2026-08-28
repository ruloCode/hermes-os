"use client";

// Command Deck 2×4 (referencia): 8 acciones REALES del registry de comandos.
// Las que requieren proyecto en foco se deshabilitan con explicación.

import { Panel } from "./ui/Panel";
import { COMMANDS, DECK_IDS, useCommandContext } from "@/lib/commands";

export function CommandDeck() {
  const ctx = useCommandContext();
  const deck = DECK_IDS.map((id) => COMMANDS.find((c) => c.id === id)).filter(
    (c): c is NonNullable<typeof c> => Boolean(c),
  );

  return (
    <Panel
      title="Command Deck"
      delay={180}
      right={
        <span className="text-2xs tracking-label text-text-dim uppercase">acceso rápido</span>
      }
    >
      <div className="grid grid-cols-2 gap-2">
        {deck.map((cmd) => {
          const disabled = Boolean(cmd.requiresProject && !ctx.selectedProject);
          return (
            <button
              key={cmd.id}
              className="cmd-btn"
              disabled={disabled}
              title={
                disabled ? `${cmd.hint ?? cmd.label} — enfoca un proyecto primero` : cmd.hint
              }
              style={disabled ? { opacity: 0.4, cursor: "not-allowed" } : undefined}
              onClick={() => void cmd.run(ctx)}
            >
              <span className="min-w-0 truncate">{cmd.label}</span>
            </button>
          );
        })}
      </div>
    </Panel>
  );
}
