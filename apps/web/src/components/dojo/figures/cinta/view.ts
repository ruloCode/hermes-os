// La cinta en el mundo: medidas (1 unidad ≈ 1 px de la máquina real), la
// cámara y los puntos donde cada ficha se detiene. x corre a lo largo de la
// cinta (de la tolva a la estación), y hacia el frente, z hacia arriba.
import { fitProjection, iso, translateAlong, type Flat, type Plan, type Point3 } from "../../iso/iso-kit";

export const WIDTH = 600;
export const HEIGHT = 320;
export const AZIMUTH = 60;

// ── Banco ───────────────────────────────────────────────────────────────
export const BASE: Plan = { x: -124, y: -31, w: 172 + 124, d: 62, r: 9 };
/** Dónde termina el banco según la estación (la más larga fija la cámara). */
export const BASE_END = { sum: 152, count: 152, best: 160, stamp: 172 } as const;
export type StationKey = keyof typeof BASE_END;
export const baseFor = (station: StationKey): Plan => ({ ...BASE, w: BASE_END[station] - BASE.x });
export const BASE_H = 8;
export const FOOT_H = 5;

// ── Cinta ───────────────────────────────────────────────────────────────
/** Altura de la cara de arriba de la banda (donde se apoyan las fichas). */
export const BT = 26;
/** Una vuelta del for = la cinta avanza un paso. */
export const PITCH = 24;
/** La ficha de ESTA vuelta espera bajo el lector. */
export const X_HEAD = 20;
/** Fin de la banda: aquí la ficha sale hacia la estación. */
export const X_END = X_HEAD + PITCH;
export const BELT: Plan = { x: -110, y: -12, w: 156, d: 24, r: 4 };
export const RAIL_D = 4;
export const RAIL_Z = 16;
export const ROLLERS = [-102, 38];
export const LEGS = [-98, -36, 28];

// ── Tolva (la lista que espera) y manivela ──────────────────────────────
export const HOPPER: Plan = { x: -112, y: -18, w: 32, d: 36, r: 2 };
export const HOPPER_TOP = 58;
export const CRANK_Y = 23;
export const CRANK_R = 7.5;

// ── Lector (el arco que dice "x vale …") ────────────────────────────────
export const ARCH_Y = 23;
export const BEAM_Z = 50;
export const READER_Z = 37;

// ── Estaciones ──────────────────────────────────────────────────────────
/** Trampa (compuerta) al final de la banda; bisagra en su borde derecho. */
export const FLAP: Plan = { x: X_END, y: -11, w: 22, d: 22, r: 0 };
export const FLAP_HINGE = FLAP.x + FLAP.w;
export const BIN: Plan = { x: 42, y: -20, w: 28, d: 40, r: 2 };
export const BIN_H = 8;
export const WALL = 1.4;

export const COUNTER: Plan = { x: 92, y: -14, w: 44, d: 28, r: 3 };
export const COUNTER_H = BT;
export const MOUTH: Plan = { x: 100, y: -9.5, w: 18, d: 19, r: 2 };
export const MOUTH_X = MOUTH.x + MOUTH.w / 2;
export const WINDOW = { u0: 112, u1: 131, z0: 8, z1: 19 };
export const DRUMS = 3;

export const PEDESTAL_X = 98;
export const TRAY: Plan = { x: 116, y: -18, w: 36, d: 36, r: 2 };
export const TRAY_H = 7;

export const PRESS_X = 56;
export const RAM_DROP = 6.6;
/** Borde del yunque: aquí la ficha estampada deja la prensa. */
export const EXIT_X = 72;
export const RACK: Plan = { x: 74, y: -28, w: 92, d: 56, r: 3 };
export const RACK_H = 3;
export const RACK_COLS = 5;
export const RACK_ROWS = 3;
export const RACK_PITCH = 18;

/** Fichas: 16 × 16 × 4 con canto redondeado. */
export const TOKEN: Plan = { x: -8, y: -8, w: 16, d: 16, r: 3.5 };
export const TOKEN_H = 4;

const corners = ({ x, y, w, d }: Plan, z0: number, z1: number): Point3[] => {
  const out: Point3[] = [];
  for (const px of [x, x + w]) for (const py of [y, y + d]) for (const z of [z0, z1]) out.push([px, py, z]);
  return out;
};

export const P = fitProjection(
  [
    ...corners(BASE, -BASE_H - FOOT_H, 0),
    ...corners(HOPPER, BT, HOPPER_TOP + 2),
    ...corners({ x: 36, y: -30, w: 34, d: 60, r: 0 }, 0, 76),
    [ROLLERS[0]!, CRANK_Y + 4, BT - 2],
  ],
  WIDTH,
  HEIGHT,
  { pad: 14, azimuth: AZIMUTH },
);

export const at = (point: Point3): Flat => iso(point, P);

/** Mueve algo dibujado en el origen hasta un punto del mundo. */
export const offset = (x: number, y: number, z: number) => translateAlong(P, [x, y, z]);

/** Corre el dibujo para que un banco más corto quede centrado en la tarjeta. */
export const centerFor = (station: StationKey) => offset((BASE.x + BASE.w - BASE_END[station]) / 2, 0, 0);
