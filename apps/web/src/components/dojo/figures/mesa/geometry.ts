// La mesa de trabajo (Fig 0): el banco donde se ven TUS variables. Mundo con x
// a lo largo del banco, y hacia quien mira, z arriba (~1 unidad = 1 px). La
// cámara es fija para que el banco no salte de tamaño cuando aparece o se va
// una variable: lo único que cambia entre pasos es lo que hay en las bandejas.

import {
  boxCorners,
  corners,
  cylinder,
  depthOf,
  fitProjection,
  haloOf,
  insetPlan,
  planOutline,
  pointsAt,
  slabOf,
  topMatrix,
  topTicks,
  type Plan,
  type Projection,
  type SolidPaths,
} from "../../iso/iso-kit";

export const WIDTH = 600;
export const HEIGHT = 300;

export const TOP: Plan = { x: 0, y: 0, w: 270, d: 138, r: 5 };
export const TOP_Z = 0;
export const TOP_H = 9;
const LEG_H = 26;
const SURFACE = TOP_Z + TOP_H;

/** Seis bandejas: dos filas de tres. La última fila, a la derecha, es la de "devuelve". */
export const SLOTS: Plan[] = [0, 1].flatMap((row) =>
  [0, 1, 2].map((col) => ({ x: 9 + col * 86, y: 10 + row * 62, w: 80, d: 54, r: 2.5 })),
);
export const RETURN_SLOT = 5;
export const TRAY_H = 3;
export const TRAY_TOP = SURFACE + TRAY_H;

export const P: Projection = fitProjection(
  [...boxCorners(TOP, -LEG_H, SURFACE + 28)],
  WIDTH,
  HEIGHT,
  { pad: 4, azimuth: 62, elevation: 36 },
);

// ── El banco (estático) ──

const legPlans: Plan[] = corners(insetPlan(TOP, 10), 0).map(([x, y]) => ({ x: x - 5, y: y - 5, w: 10, d: 10, r: 1.2 }));

export const BENCH = {
  halo: haloOf(insetPlan(TOP, -4), -LEG_H, 2, P),
  legs: legPlans.map((p) => slabOf(p, -LEG_H, LEG_H, P, 3, 0.4)),
  feet: legPlans.map((p) => cylinder(p.x + p.w / 2, p.y + p.d / 2, 6.5, -LEG_H, 2.2, P, 20, 0.3)),
  stretcher: slabOf({ x: TOP.x + 14, y: TOP.y + TOP.d - 16, w: TOP.w - 28, d: 5, r: 1 }, -LEG_H + 8, 5, P, 3, 0.3),
  top: slabOf(TOP, TOP_Z, TOP_H, P, 8, 1.2),
  groove: planOutline(insetPlan(TOP, 4), SURFACE, P),
  screws: pointsAt(corners(TOP, 6).map(([x, y]) => [x, y, SURFACE] as [number, number, number]), P),
  ruler: topTicks(TOP.x + 12, TOP.x + TOP.w - 12, 3, 5, TOP.y + TOP.d - 4.5, SURFACE, [1.4, 2.6], P),
  plate: slabOf({ x: TOP.x + TOP.w - 58, y: TOP.y + TOP.d - 4.2, w: 44, d: 2.6, r: 0.4 }, SURFACE - 6.5, 5, P, 2, 0.2),
};

// ── Las bandejas ──

export function trayOf(slot: Plan) {
  return {
    halo: haloOf(slot, SURFACE, TRAY_H, P),
    base: slabOf(slot, SURFACE, TRAY_H, P, 4, 0.5),
    inlay: planOutline(insetPlan(slot, 3), TRAY_TOP, P),
    label: topMatrix([slot.x + 5, slot.y + slot.d - 6], TRAY_TOP, P, "x"),
  };
}

export const TRAYS = SLOTS.map(trayOf);

/** De la bandeja más lejana a la más cercana: cada una se pinta con sus piezas encima. */
export const SLOT_ORDER = SLOTS.map((p, i) => ({ i, d: depthOf([p.x + p.w / 2, p.y + p.d / 2, TRAY_TOP], P) }))
  .sort((a, b) => a.d - b.d)
  .map((x) => x.i);

/** Una pieza de valor sobre la bandeja: un bloque (escalares) o una celda (listas, dicts). */
export interface Piece {
  solid: SolidPaths;
  text: string;
  textAt: string;
  size: number;
}

const cap = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function blockOn(slot: Plan, text: string): Piece {
  const plan: Plan = { x: slot.x + 8, y: slot.y + 8, w: slot.w - 16, d: 24, r: 1.5 };
  return {
    solid: slabOf(plan, TRAY_TOP, 9, P, 3, 0.6),
    text: cap(text, 18),
    textAt: topMatrix([plan.x + 4, plan.y + 16], TRAY_TOP + 9, P, "x"),
    size: text.length <= 7 ? 10 : text.length <= 11 ? 8 : 6,
  };
}

/** Hasta 6 celdas en fila (lista, tupla, set) o 3 pares clave → valor (dict). */
export function cellsOn(slot: Plan, texts: string[], pairs: boolean): Piece[] {
  if (pairs) {
    return texts.slice(0, 6).map((t, i) => {
      const row = Math.floor(i / 2);
      const isKey = i % 2 === 0;
      const plan: Plan = { x: slot.x + 6 + (isKey ? 0 : 36), y: slot.y + 6 + row * 11, w: isKey ? 34 : 32, d: 9, r: 1 };
      return {
        solid: slabOf(plan, TRAY_TOP, isKey ? 5 : 7, P, 2, 0.3),
        text: cap(t, isKey ? 9 : 8),
        textAt: topMatrix([plan.x + 2, plan.y + 6.8], TRAY_TOP + (isKey ? 5 : 7), P, "x"),
        size: 5.6,
      };
    });
  }
  const n = Math.min(texts.length, 6);
  const w = n ? Math.min(16, (slot.w - 12) / n - 1.2) : 0;
  return texts.slice(0, 6).map((t, i) => {
    const plan: Plan = { x: slot.x + 6 + i * (w + 1.2), y: slot.y + 10, w, d: 22, r: 1 };
    return {
      solid: slabOf(plan, TRAY_TOP, 8, P, 2, 0.3),
      text: cap(t, Math.max(2, Math.floor(w / 3))),
      textAt: topMatrix([plan.x + 1.6, plan.y + 14], TRAY_TOP + 8, P, "x"),
      size: 5.8,
    };
  });
}
