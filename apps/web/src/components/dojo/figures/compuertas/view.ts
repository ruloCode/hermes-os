// Mundo de la clasificadora: medidas en unidades de mundo (x a lo largo del
// canal, y hacia el frente, z hacia arriba) y la proyección que encuadra cada
// variante. La máquina crece con el número de ramas: un cajón y una compuerta
// por rama, a paso fijo, así que cada lección tiene su propio layout.

import { fitProjection, iso, type Flat, type Point3, type Projection } from "../../iso/iso-kit";

export const WIDTH = 600;
export const AZIMUTH = 68;

/** Paso entre compuertas (y entre cajones). */
export const PITCH = 70;
/** Radio de la ficha: una vuelta exacta por paso, así llega derecha a cada parada. */
export const R = PITCH / (2 * Math.PI);
/** Grosor de la ficha (a lo largo de y). */
export const COIN_T = 4;

// Canal (riel con piso y dos labios).
export const FLOOR_Z = 44;
export const FLOOR_TOP = 48;
export const LIP_TOP = 53;
export const CHANNEL = 6; // medio ancho exterior del canal
export const LIP_IN = 3.5; // medio ancho interior (entre labios)
/** Altura del centro de la ficha cuando rueda sobre el canal. */
export const COIN_TRACK_Z = FLOOR_TOP + R;

// Trampillas: dos hojas por compuerta, una a cada lado del centro del cajón.
export const DOOR_HALF = 15;
export const DOOR_T = 2.4;

// Hoja de la compuerta (la que detiene la ficha) y su pórtico.
export const BLADE_X = R + 0.5; // cara izquierda de la hoja, medida desde la parada
export const BLADE_W = 2;
export const BLADE_H = 23;
export const BLADE_LIFT = 23;
export const PORTAL_TOP = 95;

// Cajones (gavetas de taller con frente bajo).
export const BIN_HALF = 30;
export const BIN_BACK = -17;
export const BIN_FRONT = 16;
export const BIN_WALL = 2;
export const BIN_BACK_H = 22;
export const BIN_FRONT_H = 12;
export const BIN_FLOOR_TOP = 2;
export const COIN_BIN_Z = BIN_FLOOR_TOP + R;
/** Lugares de reposo dentro del cajón: centro, atrás-izquierda, adelante-derecha. */
export const SLOTS: [number, number][] = [
  [0, 0],
  [-11.4, -6],
  [11.4, 5.5],
];

// Tablero de fondo.
export const PANEL_Y0 = -28;
export const PANEL_Y1 = -22;
export const PANEL_TOP = 118;

// Placas con la condición, sobre el tablero.
export const SIGN_Z0 = 100;
export const SIGN_Z1 = 113;

// Tubo de fichas (la cola de ejemplos) a la izquierda.
export const CHUTE_X = -PITCH;
export const QUEUE_GAP = 2 * R + 0.8;
export const CHUTE_TOP = 117;

// Base.
export const BASE_H = 8;
export const FOOT_H = 4;

export interface Layout {
  bins: number;
  gates: number;
  /** Centro de cada cajón (las compuertas paran la ficha justo ahí). */
  binX: number[];
  /** Fin del canal (el borde por donde cae el else). */
  edgeX: number;
  baseX0: number;
  baseX1: number;
  panelX0: number;
  panelX1: number;
  height: number;
  P: Projection;
  at: (point: Point3) => Flat;
}

function boxPoints(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): Point3[] {
  const out: Point3[] = [];
  for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) out.push([x, y, z]);
  return out;
}

const layouts = new Map<number, Layout>();

export function layoutOf(bins: number): Layout {
  const hit = layouts.get(bins);
  if (hit) return hit;
  const binX = Array.from({ length: bins }, (_, i) => i * PITCH);
  const last = binX[bins - 1];
  const baseX0 = CHUTE_X - 36;
  const baseX1 = last + BIN_HALF + 12;
  const panelX0 = CHUTE_X - 26;
  const panelX1 = last + BIN_HALF + 4;
  const points = [
    ...boxPoints(baseX0, baseX1, PANEL_Y0 - 5, BIN_FRONT + 9, -BASE_H - FOOT_H, 0),
    ...boxPoints(panelX0, panelX1, PANEL_Y0, PANEL_Y1, 0, PANEL_TOP + 4),
  ];
  // La altura del cuadro sigue a la máquina: más ramas = más ancha, misma escala vertical relativa.
  const unit: Projection = { origin: [0, 0], scale: 1, azimuth: AZIMUTH };
  const flat = points.map((p) => iso(p, unit));
  const w = Math.max(...flat.map((f) => f[0])) - Math.min(...flat.map((f) => f[0]));
  const h = Math.max(...flat.map((f) => f[1])) - Math.min(...flat.map((f) => f[1]));
  const pad = 22;
  const height = Math.round(Math.min(470, Math.max(330, (WIDTH - pad * 2) * (h / w) + pad * 2)));
  const P = fitProjection(points, WIDTH, height, { pad, azimuth: AZIMUTH });
  const layout: Layout = {
    bins,
    gates: bins - 1,
    binX,
    edgeX: last - 24,
    baseX0,
    baseX1,
    panelX0,
    panelX1,
    height,
    P,
    at: (point) => iso(point, P),
  };
  layouts.set(bins, layout);
  return layout;
}
