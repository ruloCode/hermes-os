// Mundo y cámara de la máquina "casilleros". Unidades ≈ 1 px del objeto real:
// x a lo largo de la base, y hacia el frente (el gabinete abre hacia +y), z arriba.
// Azimut 62°: el frente del gabinete mira al lector y el costado derecho asoma.

import { fitProjection, iso, type Flat, type Plan, type Point3 } from "../../iso/iso-kit";
import { COLUMNS } from "./model";

export const WIDTH = 600;
export const HEIGHT = 432;
export const AZIMUTH = 62;

// Base de la máquina.
export const BASE: Plan = { x: -128, y: -46, w: 276, d: 86, r: 8 };
export const BASE_H = 8;
export const FOOT_H = 6;

// Estación de entrada: caja con la rueda arriba y la boca que expulsa la etiqueta.
export const STATION: Plan = { x: -112, y: -34, w: 56, d: 38, r: 3 };
export const STATION_H = 30;
export const DIAL: Flat = [-98, -15];
export const DIAL_R = 11;
export const DIAL_H = 4;
export const DOCK_X = -84;
export const DOCK_Z = 20;

// Gabinete: 3 columnas × 2 filas de casilleros de 48 × 36 × 32.
export const CAB_X = -40;
export const SIDE = 5;
export const DIV = 3;
export const CELL_W = 48;
export const CELL_D = 32;
export const CAB_BACK = -CELL_D - 4;
export const CAB_W = SIDE * 2 + CELL_W * COLUMNS + DIV * (COLUMNS - 1);
export const SHELF_H = 10;
/** Fondo y techo de cada fila: fila 0 abajo, fila 1 arriba. */
export const ROWS = [
  { shelf: 6, floor: 16, ceil: 52 },
  { shelf: 52, floor: 62, ceil: 98 },
];
export const TOP_Z = 98;
export const TOP_H = 6;
export const CROWN_H = 3;

export const colX = (col: number) => CAB_X + SIDE + col * (CELL_W + DIV);
export const cellX = (col: number) => colX(col) + CELL_W / 2;

/** Casillero → fila y columna: arriba 0 1 2, abajo 3 4 5 (como se lee). */
export function cellOf(slot: number) {
  const row = slot < COLUMNS ? 1 : 0;
  const col = slot % COLUMNS;
  return { row, col, cx: cellX(col), ...ROWS[row]! };
}

// Riel y brazo.
export const RAIL: Plan = { x: -127, y: 19, w: 274, d: 6, r: 1 };
export const RAIL_Z = 128;
export const RAIL_H = 6;
export const POSTS = [-124, 136];
export const POST = 8;
export const CARRIAGE_Z = 118;
export const STEM_TOP = 114;

// Paleta (bandeja del brazo): se construye con su cara de arriba en z = 0 y se sube a zp.
export const PADDLE: Plan = { x: -14, y: 6, w: 28, d: 20, r: 1.2 };
export const TAG: Plan = { x: -15, y: 6, w: 30, d: 1, r: 0.4 };
export const TAG_Z0 = -8;
export const TAG_Z1 = -2;
/** Cuánto entra la etiqueta para encajar en el portaetiquetas. */
export const DOCK_DY = -4.8;

// Contenido de un casillero.
export const CHIP_R = 6.2;
export const CHIP_H = 2.2;
export const CHIP_Y = -14;
export const TRAY_H = 0.8;
export const CHIP_X = { single: -2, a: -10, b: 7 };
export const PAY_CHIP_Y = 16;
export const CARD_W = 22;
export const CARD_H = 11;
export const CARD_T = 1.2;
export const CARD_X = -3;
export const RACK_STEP_D = 6;
export const RACK_RISE = 4;
export const RACK_FRONT = -6;
export const PAY_CARD_Y = 14;
/** Cara frontal de la tarjeta k (0 = la del frente) y su altura sobre el piso. */
export const cardFace = (k: number) => RACK_FRONT - 1 - RACK_STEP_D * k;
export const cardLift = (k: number) => 1 + RACK_RISE * k;

// Riel de pedidos: dos tiques colgados al frente (lo que entra · lo que sale).
export const ORDER_Y = 34;
export const ORDER_Z = 16;
export const ORDER_X0 = -36;
export const ORDER_X1 = 120;
export const TICKETS = [
  { x: -30, w: 66 },
  { x: 42, w: 74 },
];
export const TICKET_H = 15;
export const TICKET_FONT = 4.8;
/** Caracteres que caben en un renglón del tique (monoespaciada ≈ 0.6 em). */
export const ticketChars = (w: number) => Math.floor((w - 5) / (TICKET_FONT * 0.66));

/**
 * Cómo va un texto en un tique de ancho `w`: en un renglón si cabe (achicando la
 * letra hasta un 25 % si hace falta), si no en dos, cortando después de un
 * espacio, una coma o un paréntesis, nunca a mitad de palabra si se puede.
 */
export function fitTicket(text: string, w: number): { lines: [string, string]; size: number } {
  const max = ticketChars(w);
  if (text.length <= max) return { lines: [text, ""], size: TICKET_FONT };
  if (text.length <= Math.floor(max * 1.25)) return { lines: [text, ""], size: (TICKET_FONT * max) / text.length };
  let at = -1;
  for (let i = Math.min(max, text.length - 1); i > max / 3; i--) {
    const c = text[i - 1];
    if (c === " " || c === "," || c === "(") {
      at = i;
      break;
    }
  }
  if (at < 0) at = max;
  const rest = text.slice(at).trim();
  return { lines: [text.slice(0, at).trim(), rest.length > max ? `${rest.slice(0, max - 1)}…` : rest], size: TICKET_FONT };
}

const corners = ({ x, y, w, d }: Plan, z0: number, z1: number): Point3[] => {
  const out: Point3[] = [];
  for (const px of [x, x + w]) for (const py of [y, y + d]) for (const z of [z0, z1]) out.push([px, py, z]);
  return out;
};

export const P = fitProjection(
  [
    ...corners(BASE, -BASE_H - FOOT_H, 0),
    ...corners({ x: RAIL.x, y: 18, w: RAIL.w, d: 12, r: 0 }, 0, RAIL_Z + RAIL_H + 4),
  ],
  WIDTH,
  HEIGHT,
  { pad: 14, azimuth: AZIMUTH },
);

export const at = (point: Point3) => iso(point, P);
