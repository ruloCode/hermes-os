// Disposición del componedor en el mundo (x a lo largo del componedor, y hacia
// el que mira, z arriba; ~1 unidad = 1 px del objeto real) y la cámara.
//
// Las casillas van de x = 0 (la cara del cabezal) a x = SPAN. El ancho de cada
// casilla depende de la lección (cuántas casillas necesita su ejemplo más
// largo); la cámara es la misma para todas, así el objeto no cambia de tamaño
// entre lecciones.

import { fitProjection, iso, type Flat, type Plan, type Point3 } from "../../iso/iso-kit";

export const WIDTH = 600;
export const HEIGHT = 300;
export const AZIMUTH = 64;
export const ELEVATION = 30;

/** Largo útil del componedor: donde caben las casillas. */
export const SPAN = 198;

// Base sobre patas.
export const BASE: Plan = { x: -40, y: -34, w: SPAN + 124, d: 58, r: 7 };
export const BASE_H = 7;
export const FOOT_H = 4;

// El componedor: cama, pared del fondo, cabezal fijo y dos cunas que lo cargan.
export const BED: Plan = { x: 0, y: -10, w: SPAN + 16, d: 18, r: 1 };
export const BED_Z = 2;
export const BED_TOP = 16;
export const FRONT = BED.y + BED.d; // la cara de la regla
export const WALL: Plan = { x: 0, y: -13, w: SPAN + 16, d: 3, r: 0.6 };
export const WALL_TOP = 35;
export const HEAD: Plan = { x: -18, y: -13, w: 18, d: 23, r: 1.2 };
export const HEAD_TOP = 36;
export const CRADLES: Plan[] = [
  { x: 26, y: -16, w: 20, d: 28, r: 1.5 },
  { x: SPAN - 40, y: -16, w: 20, d: 28, r: 1.5 },
];

// Las fichas.
export const TILE_Y = -6;
export const TILE_D = 12;
export const TILE_H = 16;
export const SPACE_H = 10;
export const TILE_GAP = 0.6;

// El tope móvil (cierra en len) y la regla negativa que viaja con él.
export const KNEE_W = 9;
export const KNEE_TOP = 35;
export const STRIP_Z = 2.8;
export const STRIP_H = 5.2;
export const STRIP_D = 1.2;

// El riel de los carros, atrás y arriba.
export const RAIL_Y = -24;
export const RAIL_D = 6;
export const RAIL_Z = 53;
export const RAIL_H = 6;
export const POSTS = [-27, SPAN + 46];
export const RAIL_FROM = -33;
export const RAIL_TO = SPAN + 52;
export const TIP_Z = 37.8;
/** Donde se estacionan los carros (x de mundo). */
export const PARK_A = -9;
export const PARK_B = SPAN + 21;

// La caja de salida con su ventana.
export const BOX: Plan = { x: SPAN + 24, y: -12, w: 52, d: 28, r: 1.5 };
export const BOX_H = 22;
export const WINDOW = { x0: BOX.x + 4, x1: BOX.x + BOX.w - 4, z0: 6, z1: 17 };

export const P = fitProjection(
  [
    ...corners(BASE, -BASE_H - FOOT_H, 0),
    ...corners({ x: RAIL_FROM, y: RAIL_Y, w: RAIL_TO - RAIL_FROM, d: RAIL_D, r: 0 }, RAIL_Z, RAIL_Z + RAIL_H + 5),
  ],
  WIDTH,
  HEIGHT,
  { pad: 22, azimuth: AZIMUTH, elevation: ELEVATION },
);

function corners({ x, y, w, d }: Plan, z0: number, z1: number): Point3[] {
  const out: Point3[] = [];
  for (const px of [x, x + w]) for (const py of [y, y + d]) for (const z of [z0, z1]) out.push([px, py, z]);
  return out;
}

export const at = (point: Point3): Flat => iso(point, P);

/** Ancho de casilla para una lección con `cap` casillas. */
export const slotWidth = (cap: number) => SPAN / Math.max(1, cap);
