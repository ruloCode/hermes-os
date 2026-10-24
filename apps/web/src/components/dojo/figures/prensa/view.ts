// Mundo de la prensa: medidas (unidades ≈ 1 px del objeto real, x a lo largo
// de la máquina, y hacia el que mira, z arriba), la cámara y dos ayudas que el
// kit no trae: cilindros acostados sobre el eje x (el cilindro del empujador, el
// volante) y la medida del texto que va grabado en las fichas.

import {
  boxCorners,
  depthOf,
  fitProjection,
  iso,
  pathOf,
  type Flat,
  type Plan,
  type Point3,
  type SolidPaths,
} from "../../iso/iso-kit";

export const WIDTH = 480;
export const HEIGHT = 318;
export const AZIMUTH = 58;

// ── Banco ──
export const BASE: Plan = { x: -128, y: -46, w: 258, d: 92, r: 8 };
export const BASE_H = 8;
export const FOOT_H = 5;

/** Altura del riel: todo lo que se desliza (fichas, empujador) va encima. */
export const RAIL_TOP = 5;

// ── Fichas ──
export const TILE_D = 16;
export const TILE_H = 3.5;
/** Los números van grandes; los textos, más chicos para que quepan en el troquel. */
export const textSize = (text: string) =>
  Math.min(/[A-Za-zÁÉÍÓÚáéíóúñÑ]/.test(text) ? 6.2 : 8, Math.max(3.4, 52 / (Math.max(1, text.length) * 0.64)));
export const tileWidth = (text: string) => Math.max(16, Math.round((text.length * textSize(text) * 0.64 + 8) * 10) / 10);
/** Carriles del cargador: uno al centro o dos (base atrás, altura adelante). */
export const lanesFor = (count: number) => (count > 1 ? [-8.2, 8.2] : [0]);

// ── Cargador (la tolva de los argumentos) ──
export const MAG_X = -72;
export const MAG_HALF = 16;
export const MAG_TOP = 58;
export const DROP_FROM = 66;
export const POST_Y = 19.75;

// ── Riel de entrada y empujador ──
export const RAIL: Plan = { x: -108, y: -18, w: 78, d: 36, r: 1.5 };
export const GUIDE_H = 9;
export const PUSHER_HOME = -92;
export const PUSHER_LEN = 9;
export const CYL_X0 = -124;
export const CYL_X1 = -108;
export const CYL_Z = 11;
export const CYL_R = 6;

// ── Prensa (marco en C) ──
export const DIE_X = 0;
export const COLUMN: Plan = { x: -20, y: -42, w: 40, d: 16, r: 2 };
export const BOLSTER: Plan = { x: -30, y: -26, w: 60, d: 45, r: 2 };
export const BOLSTER_TOP = 4;
export const HEAD: Plan = { x: -29.6, y: -44, w: 59.2, d: 61, r: 3 };
export const HEAD_Z = 58;
export const HEAD_TOP = 82;
export const RAM_R = 6;
export const PUNCH: Plan = { x: -16, y: -15, w: 32, d: 30, r: 2 };
export const PUNCH_H = 9;
/** Abajo del troquel en reposo; baja STROKE hasta tocar la ficha. */
export const PUNCH_REST = 30;
export const STROKE = PUNCH_REST - RAIL_TOP - TILE_H;
export const GLAND_R = 5;
export const GLAND_TOP = HEAD_TOP + 3;
export const ROD_R = 2.3;
export const ROD_REST_TOP = GLAND_TOP + 24;
export const GUARD: Plan = { x: -29.6, y: HEAD.y + HEAD.d, w: 59.2, d: 1.6, r: 0.5 };
/** Costado de la guarda (cara +x): deja abajo la ranura por donde sale la ficha. */
export const GUARD_SIDE: Plan = { x: 28, y: -26, w: 1.6, d: HEAD.y + HEAD.d + 26, r: 0.3 };
export const EXIT_SLOT = 10;
export const WHEEL = { x: HEAD.x + HEAD.w, y: -14, z: 70, r: 10 };

// ── Salida ──
export const CHUTE: Plan = { x: 30, y: -18, w: 24, d: 36, r: 1.5 };
export const TRAY: Plan = { x: 54, y: -20, w: 66, d: 40, r: 2 };
export const TRAY_FLOOR = 2;
export const TRAY_WALL = 10;
export const TRAY_X = 87;

// ── Visor de print (solo en el concepto) ──
export const VISOR: Plan = { x: -22, y: 1, w: 16, d: 14, r: 1.5 };
export const VISOR_TOP = HEAD_TOP + 14;

// ── Cámara ──
export const P = fitProjection(
  [
    ...boxCorners(BASE, -BASE_H - FOOT_H, 0),
    [0, 0, ROD_REST_TOP + 3],
    ...boxCorners({ x: MAG_X - MAG_HALF, y: -POST_Y, w: MAG_HALF * 2, d: POST_Y * 2, r: 0 }, 0, DROP_FROM + TILE_H),
    ...boxCorners(VISOR, 0, VISOR_TOP),
  ],
  WIDTH,
  HEIGHT,
  { pad: 20, azimuth: AZIMUTH },
);

export const at = (point: Point3): Flat => iso(point, P);
export const depth = (point: Point3) => depthOf(point, P);

// ── Cilindros acostados (eje x) ──

function hull(points: Flat[]): Flat[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Flat, a: Flat, b: Flat) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Flat[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Flat[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Un anillo en el plano x = cte. */
export function ringX(x: number, cy: number, cz: number, r: number, steps = 40): Flat[] {
  return Array.from({ length: steps }, (_, i) => {
    const a = (i / steps) * Math.PI * 2;
    return at([x, cy + r * Math.cos(a), cz + r * Math.sin(a)]);
  });
}

/**
 * Cilindro con eje x, de x0 a x1: la silueta es la envolvente de las dos tapas,
 * la cara curva se sombrea por facetas como el kit sombrea un prisma (luz
 * horizontal, las que miran arriba toman el tono de tapa) y la tapa que mira al
 * lector (la de x1) va en el tono 0, igual que cualquier cara +x del kit.
 */
export function barrelX(x0: number, x1: number, cy: number, cz: number, r: number, steps = 36): SolidPaths {
  const a = ringX(x0, cy, cz, r, steps);
  const b = ringX(x1, cy, cz, r, steps);
  const outline = pathOf(hull([...a, ...b]), true);
  const buckets: string[][] = [[], [], [], []];
  const tops: string[] = [];
  const rad = (AZIMUTH * Math.PI) / 180;
  const [lx, ly] = [-Math.sin(rad), Math.cos(rad)];
  for (let i = 0; i < steps; i++) {
    const m = ((i + 0.5) / steps) * Math.PI * 2;
    const n: Point3 = [0, Math.cos(m), Math.sin(m)];
    if (depthOf(n, P) <= 1e-9) continue;
    const j = (i + 1) % steps;
    const quad = pathOf([a[i]!, a[j]!, b[j]!, b[i]!], true);
    if (n[2] > 0.72) {
      tops.push(quad);
      continue;
    }
    const lit = (n[1] * ly + 0 * lx + 1) / 2;
    buckets[Math.min(3, Math.max(0, Math.floor(lit * 4)))]!.push(quad);
  }
  buckets[0]!.push(pathOf(b, true));
  return {
    fill: outline,
    outline: outline + pathOf(b, true),
    crease: "",
    top: tops.join(""),
    shades: buckets.map((list) => list.join("")),
  };
}

/** Línea en la tapa +x de un cilindro acostado (rayos del volante). */
export const onFaceX = (x: number, cy: number, cz: number, from: [number, number], to: [number, number]) =>
  pathOf([at([x, cy + from[0], cz + from[1]]), at([x, cy + to[0], cz + to[1]])]);

/** Lo de x de un punto a otro, en pantalla: para mover piezas con translate. */
export function shift(by: Point3) {
  const o = at([0, 0, 0]);
  const p = at(by);
  const f = (v: number) => Math.round(v * 100) / 100;
  return `translate(${f(p[0] - o[0])} ${f(p[1] - o[1])})`;
}
