"use client";

// HUD del juego: el combo (desde 10 teclas seguidas sin error) y los avisos que
// suben y se desvanecen. Encima de todo y sin interceptar el puntero. La
// animación va por Web Animations (no hay keyframes propios en globals.css).

import { useEffect, useRef, useSyncExternalStore } from "react";
import { gameState, subscribeGame, type GamePop } from "@/lib/dojo/game";

const POP_TONE: Record<GamePop["tone"], string> = {
  xp: "border-green/40 bg-green/12 text-green",
  combo: "border-accent/45 bg-accent/15 text-accent",
  level: "border-transparent bg-accent-solid text-on-accent",
  miss: "border-line bg-panel text-text-faint",
};

function Pop({ pop }: { pop: GamePop }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.animate(
      [
        { transform: "translateY(10px) scale(0.92)", opacity: 0 },
        { transform: "translateY(0) scale(1.04)", opacity: 1, offset: 0.12 },
        { transform: "translateY(-6px) scale(1)", opacity: 1, offset: 0.7 },
        { transform: "translateY(-28px) scale(0.98)", opacity: 0 },
      ],
      { duration: 1800, easing: "cubic-bezier(.2,.7,.2,1)", fill: "forwards" },
    );
  }, []);
  return (
    <div
      ref={ref}
      className={`rounded-full border px-3 py-1 text-sm font-semibold tabular-nums shadow-[var(--shadow-card)] ${POP_TONE[pop.tone]} ${
        pop.tone === "level" ? "px-4 py-1.5 text-md" : ""
      }`}
    >
      {pop.text}
    </div>
  );
}

export function GameHud() {
  const s = useSyncExternalStore(subscribeGame, gameState, gameState);
  const comboRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (s.combo >= 10 && s.combo % 5 === 0)
      comboRef.current?.animate([{ transform: "scale(1.18)" }, { transform: "scale(1)" }], {
        duration: 220,
        easing: "ease-out",
      });
  }, [s.combo]);

  return (
    <div className="pointer-events-none fixed top-16 right-8 z-40 flex flex-col items-end gap-2" aria-live="polite">
      {s.combo >= 10 && (
        <div className="flex items-baseline gap-1.5 rounded-sm border border-line bg-panel/90 px-3 py-1.5 backdrop-blur-sm">
          <span className="text-xs text-text-faint">Combo</span>
          <span
            ref={comboRef}
            className={`inline-block font-mono text-lg font-semibold tabular-nums ${
              s.combo >= 50 ? "text-accent" : "text-text"
            }`}
          >
            ×{s.combo}
          </span>
        </div>
      )}
      {s.pops.map((p) => (
        <Pop key={p.id} pop={p} />
      ))}
    </div>
  );
}
