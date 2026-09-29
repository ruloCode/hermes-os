"use client";

// Control de juego para la Oficina: sondea la Gamepad API en cada frame
// (requestAnimationFrame: se pausa solo con la pestaña oculta), entrega los
// sticks y gatillos (onFrame) y las pulsaciones nuevas (onPress), y hace vibrar
// el control. La lógica de mapeo es pura y está probada en @hermes/shared
// (gamepad.ts).
//
// Ojo navegador: Chrome no expone un control hasta que se presiona un botón
// con la página enfocada (regla de privacidad). Por eso el HUD pide "presiona
// cualquier botón" hasta que aparece.

import { useEffect, useRef, useState } from "react";
import { PadEdges, padLabel, pickGamepad, readPad, type GamepadLike, type PadButton, type PadState } from "@hermes/shared";

export interface GamepadInfo {
  connected: boolean;
  label: string;
}

export type Rumble = "tap" | "success" | "alert";

interface Handlers {
  onFrame: (state: PadState | null, dt: number) => void;
  onPress: (button: PadButton) => void;
}

interface VibrationActuatorLike {
  playEffect?: (type: string, params: Record<string, number>) => Promise<unknown>;
}

const RUMBLES: Record<Rumble, { duration: number; strongMagnitude: number; weakMagnitude: number }> = {
  tap: { duration: 60, strongMagnitude: 0.1, weakMagnitude: 0.35 },
  success: { duration: 220, strongMagnitude: 0.45, weakMagnitude: 0.6 },
  alert: { duration: 380, strongMagnitude: 0.8, weakMagnitude: 0.4 },
};

function listPads(): readonly (GamepadLike | null)[] {
  if (typeof navigator === "undefined" || !navigator.getGamepads) return [];
  return navigator.getGamepads() as unknown as readonly (GamepadLike | null)[];
}

export function useGamepad(handlers: Handlers): GamepadInfo & { rumble: (kind: Rumble) => void } {
  const [info, setInfo] = useState<GamepadInfo>({ connected: false, label: "" });
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const idRef = useRef<string | null>(null);

  useEffect(() => {
    const edges = new PadEdges();
    let raf = 0;
    let last = performance.now();
    const step = () => {
      raf = requestAnimationFrame(step);
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const gp = pickGamepad(listPads());
      const id = gp?.id ?? null;
      if (id !== idRef.current) {
        idRef.current = id;
        edges.reset();
        setInfo(gp ? { connected: true, label: padLabel(gp.id) } : { connected: false, label: "" });
      }
      const state = gp ? readPad(gp) : null;
      for (const b of edges.update(state)) handlersRef.current.onPress(b);
      handlersRef.current.onFrame(state, dt);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);

  const rumble = (kind: Rumble) => {
    const gp = pickGamepad(listPads()) as (GamepadLike & { vibrationActuator?: VibrationActuatorLike }) | null;
    void gp?.vibrationActuator?.playEffect?.("dual-rumble", { startDelay: 0, ...RUMBLES[kind] })?.catch(() => {});
  };

  return { ...info, rumble };
}
