"use client";

// HUD de un minijuego de la azotea: el juego, tu puntaje de ESTA partida, tu
// récord real (localStorage de este navegador), el estado y los controles.
// Esc o B sale; con la partida terminada, Espacio o A juega otra.

import { GAME_INFO } from "@hermes/shared";
import type { GameHud } from "@/lib/oficina/games";
import { PadGlyph } from "./VoiceComposer";

export function GameOverlay({ hud, pad, onExit }: { hud: GameHud; pad: boolean; onExit: () => void }) {
  const info = GAME_INFO[hud.id];
  return (
    <section
      role="dialog"
      aria-label={`Minijuego: ${hud.title}`}
      data-game={hud.id}
      className="pointer-events-auto absolute bottom-4 left-1/2 z-30 w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 rounded-2xl border border-line bg-panel/90 px-5 py-3 shadow-xl backdrop-blur-md"
    >
      <div className="flex items-baseline gap-3">
        <h2 className="text-base font-semibold text-text">{hud.title}</h2>
        <p className="ml-auto text-sm text-text-dim">
          Puntaje <span className="font-mono text-lg font-semibold text-text tabular-nums" data-game-score>{hud.score}</span>
        </p>
        <p className="text-sm text-text-dim">
          Récord <span className="font-mono text-text tabular-nums" data-game-best>{hud.best ?? "—"}</span>
        </p>
      </div>
      <p className="mt-1 text-sm text-text" data-game-status>
        {hud.status}
      </p>
      {hud.meter !== undefined && hud.meter > 0 ? (
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-panel-2" role="meter" aria-label="Fuerza" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(hud.meter * 100)}>
          <div className={`h-full rounded-full ${hud.meter > 0.8 ? "bg-red" : hud.meter > 0.5 ? "bg-amber" : "bg-green"}`} style={{ width: `${hud.meter * 100}%` }} />
        </div>
      ) : null}
      <ul className="mt-2 space-y-0.5 text-xs text-text-dim">
        {(pad ? info.pad : info.keys).map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      <div className="mt-2 flex items-center gap-3 text-xs text-text-dim">
        {hud.over ? <span className="text-text">{pad ? <PadGlyph b="A" /> : <kbd className="rounded border border-line px-1">Espacio</kbd>} otra partida</span> : null}
        <button type="button" onClick={onExit} className="ml-auto flex items-center gap-1.5 rounded-md px-2 py-1 hover:bg-panel-2 hover:text-text">
          {pad ? <PadGlyph b="B" /> : <kbd className="rounded border border-line px-1">Esc</kbd>} salir
        </button>
      </div>
    </section>
  );
}
