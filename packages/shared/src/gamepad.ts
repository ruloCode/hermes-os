// Control de juego (Gamepad API, mapeo "standard" de W3C) para la Oficina de
// agentes. Puro: recibe lo que da navigator.getGamepads() y devuelve sticks con
// zona muerta, gatillos y botones con nombre; detecta pulsaciones (flanco de
// subida) para que una acción no se repita mientras el botón sigue apretado.
//
// Probado con el Xbox Wireless Controller (Microsoft 045e, producto 02fd) por
// Bluetooth en Chrome/macOS, que llega con mapping "standard":
//   botones 0 A · 1 B · 2 X · 3 Y · 4 LB · 5 RB · 6 LT · 7 RT · 8 View · 9 Menu
//           10 L3 · 11 R3 · 12 ↑ · 13 ↓ · 14 ← · 15 → · 16 Xbox (macOS casi nunca lo entrega)
//   ejes    0 stick izq. x · 1 stick izq. y · 2 stick der. x · 3 stick der. y (y: arriba = -1)

export type PadButton =
  | "A"
  | "B"
  | "X"
  | "Y"
  | "LB"
  | "RB"
  | "LT"
  | "RT"
  | "VIEW"
  | "MENU"
  | "LS"
  | "RS"
  | "UP"
  | "DOWN"
  | "LEFT"
  | "RIGHT"
  | "HOME";

export const STANDARD_BUTTONS: readonly PadButton[] = [
  "A", "B", "X", "Y", "LB", "RB", "LT", "RT", "VIEW", "MENU", "LS", "RS", "UP", "DOWN", "LEFT", "RIGHT", "HOME",
];

/** Lo mínimo de un Gamepad del navegador (para probar sin DOM). */
export interface GamepadLike {
  id: string;
  mapping?: string;
  connected?: boolean;
  axes: readonly number[];
  buttons: readonly { pressed: boolean; value: number }[];
}

export interface PadState {
  /** Stick izquierdo con zona muerta: x derecha +, y abajo + (arriba = adelante). */
  move: { x: number; y: number };
  /** Stick derecho con zona muerta. */
  look: { x: number; y: number };
  /** Gatillos analógicos 0..1. */
  lt: number;
  rt: number;
  held: Set<PadButton>;
}

/** Zona muerta de los sticks: el Xbox deriva ~0,05-0,1 en reposo. */
export const STICK_DEADZONE = 0.16;
/** Un gatillo cuenta como apretado desde aquí. */
export const TRIGGER_ON = 0.35;

/**
 * Zona muerta RADIAL con re-escalado: por debajo del umbral es 0 y por encima
 * va de 0 a 1 sin salto (el personaje arranca suave, no de golpe).
 */
export function radialDeadzone(x: number, y: number, dz = STICK_DEADZONE): { x: number; y: number } {
  const mag = Math.hypot(x, y);
  if (!Number.isFinite(mag) || mag < dz) return { x: 0, y: 0 };
  const k = Math.min(1, (mag - dz) / (1 - dz)) / mag;
  return { x: x * k, y: y * k };
}

export function readPad(gp: GamepadLike): PadState {
  const axis = (i: number) => gp.axes[i] ?? 0;
  const btn = (i: number) => gp.buttons[i];
  const held = new Set<PadButton>();
  STANDARD_BUTTONS.forEach((name, i) => {
    const b = btn(i);
    if (!b) return;
    const on = name === "LT" || name === "RT" ? b.value >= TRIGGER_ON || b.pressed : b.pressed;
    if (on) held.add(name);
  });
  return {
    move: radialDeadzone(axis(0), axis(1)),
    look: radialDeadzone(axis(2), axis(3)),
    lt: btn(6)?.value ?? 0,
    rt: btn(7)?.value ?? 0,
    held,
  };
}

/** Pulsaciones nuevas (flanco de subida) entre una lectura y la siguiente. */
export class PadEdges {
  private prev = new Set<PadButton>();

  update(state: PadState | null): PadButton[] {
    const now = state?.held ?? new Set<PadButton>();
    const pressed = [...now].filter((b) => !this.prev.has(b));
    this.prev = new Set(now);
    return pressed;
  }

  reset() {
    this.prev.clear();
  }
}

/**
 * Nombre legible del control: Chrome entrega
 * "Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 02fd)".
 */
export function padLabel(id: string): string {
  const name = id.replace(/\s*\(.*\)\s*$/, "").replace(/^[0-9a-f]{4}-[0-9a-f]{4}-/i, "").trim();
  return name || "Control";
}

/** El primer control conectado, prefiriendo el de mapeo estándar. */
export function pickGamepad(list: readonly (GamepadLike | null)[]): GamepadLike | null {
  const live = list.filter((g): g is GamepadLike => !!g && g.connected !== false);
  return live.find((g) => g.mapping === "standard") ?? live[0] ?? null;
}
