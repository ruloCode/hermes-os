// Mundo y cámara de la máquina "pines". Unidades de ~1 px del objeto real: x y
// y en el piso, z hacia arriba. El tablero tiene 10 columnas (a, sobre x: el for
// de afuera mueve el puente) y 11 filas (b, sobre y: el for de adentro mueve el
// cabezal por la viga). La fila 11 solo la usa la suma (rectángulo n × (n + 1)).

import { fitProjection, iso, type Flat, type Plan, type Point3 } from "../../iso/iso-kit";

export const WIDTH = 600;
export const HEIGHT = 330;
export const AZIMUTH = 57;

export const PITCH = 9;
export const pinX = (a: number) => -40.5 + PITCH * a;
export const pinY = (b: number) => -45 + PITCH * b;

export const BASE: Plan = { x: -78, y: -76, w: 136, d: 172, r: 9 };
export const BASE_H = 8;
export const FOOT_H = 5;

// Lecho de los pines.
export const BED: Plan = { x: -49.5, y: -53.5, w: 99, d: 107, r: 3 };
export const BED_H = 5;

// Pin: vástago fino y cabeza; hundido, la cabeza baja a ras del buje.
export const SHAFT_R = 1.1;
export const HEAD_R = 2.15;
export const HEAD_H = 1.4;
export const PIN_TOP = 11.6;
export const PIN_SUNK = 4.6; // cuánto baja la cabeza al hundirse
export const BUSH_R = 2.9;

// Rieles: atrás y adelante del lecho, sobre x.
export const RAIL_Y = 61;
export const RAIL_D = 6;
export const RAIL_X0 = -72;
export const RAIL_X1 = 42;
export const RAIL_Z = 4;
export const RAIL_H = 3.5;
export const RAIL_TOP = RAIL_Z + RAIL_H;

// Puente: dos carros sobre los rieles, dos columnas y la viga (sobre y).
export const BRIDGE_BACK = 8; // la viga va 8 detrás de la columna de pines que sirve
export const TRUCK_Z = RAIL_TOP;
export const TRUCK_H = 5;
export const LEG_R = 2.3;
export const BEAM_Z = 26;
export const BEAM_H = 5.5;
export const BEAM_W = 7;
export const BEAM_TOP = BEAM_Z + BEAM_H;

// Cabezal y martillo.
export const HEAD_Z = 18.5;
export const TIP_R = 1.55;
export const TIP_H = 1.2;
export const TIP_REST = PIN_TOP + 2.8; // punta arriba
export const ROD_R = 0.95;
export const ROD_LEN = 15;

// Banda de instrumentos al frente.
export const COUNTER: Plan = { x: -46, y: 71, w: 82, d: 16, r: 2 };
export const COUNTER_H = 14;
export const DIGITS = 13;
export const CELL = 5.3;
export const WINDOW_X0 = COUNTER.x + 4.4;
export const WINDOW_Z0 = 3.6;
export const WINDOW_Z1 = 10.6;
export const KNOB: Flat = [47, 79];
export const WATCH: Flat = [-63, 80];
export const WATCH_R = 10.5;
export const WATCH_H = 6;

// Proyección: el borde de la base, las patas y lo más alto del puente.
const corners = ({ x, y, w, d }: Plan, z0: number, z1: number): Point3[] => {
  const out: Point3[] = [];
  for (const px of [x, x + w]) for (const py of [y, y + d]) for (const z of [z0, z1]) out.push([px, py, z]);
  return out;
};

export const P = fitProjection(
  [
    ...corners(BASE, -BASE_H - FOOT_H, 0),
    ...corners({ x: pinX(-1.15) - BRIDGE_BACK - 6, y: -RAIL_Y - 5, w: pinX(9) - pinX(-1.15) + 16, d: RAIL_Y * 2 + 10, r: 0 }, 0, BEAM_TOP + 3),
  ],
  WIDTH,
  HEIGHT,
  { pad: 30, azimuth: AZIMUTH },
);

export const at = (point: Point3) => iso(point, P);

const ORIGIN = at([0, 0, 0]);
const minus = (a: Flat, b: Flat): Flat => [a[0] - b[0], a[1] - b[1]];
export const EX = minus(at([1, 0, 0]), ORIGIN);
export const EY = minus(at([0, 1, 0]), ORIGIN);
export const EZ = minus(at([0, 0, 1]), ORIGIN);

const fine = (value: number) => Math.round(value * 100) / 100;

/** Desplazamiento de pantalla de un movimiento en el mundo. */
export const shift = (x: number, y = 0, z = 0) =>
  `translate(${fine(EX[0] * x + EY[0] * y + EZ[0] * z)} ${fine(EX[1] * x + EY[1] * y + EZ[1] * z)})`;
