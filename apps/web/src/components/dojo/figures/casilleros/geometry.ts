// Geometría estática de los casilleros: todo lo que no cambia de forma se calcula
// una sola vez al cargar el módulo. Lo que se mueve (carro, paleta, carga) se
// construye en su posición de reposo y se traslada con translateAlong.

import {
  cylinder,
  insetPlan,
  knurl,
  lineOnTop,
  onTop,
  pathOf,
  planOutline,
  radialTicks,
  ring,
  sideArc,
  sideMatrix,
  sideSeam,
  sideTicks,
  slabOf,
  type Flat,
  type Plan,
} from "../../iso/iso-kit";
import { COLUMNS, SLOTS } from "./model";
import {
  BASE,
  BASE_H,
  CAB_BACK,
  CAB_W,
  CAB_X,
  CARD_H,
  CARD_T,
  CARD_W,
  CARD_X,
  CARRIAGE_Z,
  CELL_D,
  CELL_W,
  CHIP_H,
  CHIP_R,
  CHIP_X,
  CHIP_Y,
  CROWN_H,
  DIAL,
  DIAL_H,
  DIAL_R,
  DIV,
  DOCK_X,
  DOCK_Z,
  FOOT_H,
  ORDER_X0,
  ORDER_X1,
  ORDER_Y,
  ORDER_Z,
  P,
  PADDLE,
  POST,
  POSTS,
  RACK_FRONT,
  RACK_RISE,
  RACK_STEP_D,
  RAIL,
  RAIL_H,
  RAIL_Z,
  ROWS,
  SHELF_H,
  SIDE,
  STATION,
  STATION_H,
  STEM_TOP,
  TAG,
  TAG_Z0,
  TAG_Z1,
  TICKETS,
  TICKET_H,
  TOP_H,
  TOP_Z,
  TRAY_H,
  at,
  cardFace,
  cardLift,
  cellOf,
  colX,
} from "./view";

const slab = (plan: Plan, z: number, h: number, steps = 4, bevel = 0) => slabOf(plan, z, h, P, steps, bevel);
const puck = (cx: number, cy: number, r: number, z: number, h: number, steps = 28) => cylinder(cx, cy, r, z, h, P, steps);
const join = (paths: string[]) => paths.filter(Boolean).join("");

/** Un rectángulo cerrado en una cara vertical que mira a +y (en el plano x–z, a la altura y). */
export function faceRect(x0: number, x1: number, z0: number, z1: number, y: number, r = 0) {
  if (!r) return pathOf([at([x0, y, z0]), at([x1, y, z0]), at([x1, y, z1]), at([x0, y, z1])], true);
  const points: Flat[] = [];
  const arc = (cx: number, cz: number, from: number) => {
    for (let s = 0; s <= 4; s++) {
      const a = ((from + s * 22.5) * Math.PI) / 180;
      points.push(at([cx + r * Math.cos(a), y, cz + r * Math.sin(a)]));
    }
  };
  arc(x1 - r, z1 - r, 0);
  arc(x0 + r, z1 - r, 90);
  arc(x0 + r, z0 + r, 180);
  arc(x1 - r, z0 + r, 270);
  return pathOf(points, true);
}

/** Una línea horizontal en una cara que mira a +y, de borde a borde. */
const faceLine = (x0: number, x1: number, z: number, y: number) => pathOf([at([x0, y, z]), at([x1, y, z])]);

/** La matriz para escribir en una cara que mira a +y (texto a lo largo de x). */
export const frontText = (x: number, y: number, z: number) => sideMatrix([x, y], z, P, "left");

// ── Base ─────────────────────────────────────────────────────────────────

const FEET: Flat[] = [
  [BASE.x + 16, BASE.y + 14],
  [BASE.x + BASE.w - 16, BASE.y + 14],
  [BASE.x + 16, BASE.y + BASE.d - 14],
  [BASE.x + BASE.w - 16, BASE.y + BASE.d - 14],
];
const BASE_SCREWS: Flat[] = [
  [BASE.x + 7, BASE.y + 7],
  [BASE.x + BASE.w - 7, BASE.y + 7],
  [BASE.x + 7, BASE.y + BASE.d - 7],
  [BASE.x + BASE.w - 7, BASE.y + BASE.d - 7],
];
const NAME: Plan = { x: BASE.x + 14, y: BASE.y + BASE.d - 16, w: 40, d: 9, r: 1.5 };

export const BASE_ART = {
  halo: slab(BASE, -BASE_H - FOOT_H, BASE_H + FOOT_H).fill,
  feet: FEET.map(([x, y]) => [puck(x, y, 7, -BASE_H - FOOT_H, 1.6), puck(x, y, 5.4, -BASE_H - FOOT_H + 1.6, FOOT_H - 1.6)]),
  slab: slab(BASE, -BASE_H, BASE_H, 8, 1.6),
  seam: sideSeam(BASE, -BASE_H + 2.4, P, 8),
  groove: planOutline(insetPlan(BASE, 4.5), 0, P),
  screws: BASE_SCREWS.map(([x, y]) => at([x, y, 0])),
  screwRings: join(BASE_SCREWS.map(([x, y]) => ring(x, y, 2, 0, P, 16))),
  name: slab(NAME, 0, 0.8, 3),
  nameLine: planOutline(insetPlan(NAME, 1.4), 0.8, P),
  nameRule: join(
    [0, 1, 2].map((row) =>
      onTop(
        [
          [NAME.x + 6, NAME.y + 2.6 + row * 1.9],
          [NAME.x + (row === 1 ? 24 : 32), NAME.y + 2.6 + row * 1.9],
        ],
        0.8,
        P,
      ),
    ),
  ),
  nameScrews: [at([NAME.x + 3, NAME.y + NAME.d / 2, 0.8]), at([NAME.x + NAME.w - 3, NAME.y + NAME.d / 2, 0.8])],
};

// ── Estación: caja, rueda y cargador de etiquetas ────────────────────────

const ST_TOP = STATION_H;
const MAG: Plan = { x: -86, y: -27, w: 22, d: 22, r: 2 };
const MAG_H = 7;
const [DX, DY] = DIAL;
const DIAL_TICKS = radialTicks(DX, DY, DIAL_R - 1, 24, 4, ST_TOP + DIAL_H, [1.1, 2.4], P);
const VENTS = [0, 1, 2, 3].map((i) => {
  // Ranuras cerradas en el costado derecho (+x) de la caja.
  const y0 = STATION.y + 8 + i * 6.4;
  const x = STATION.x + STATION.w;
  return pathOf([at([x, y0, 9]), at([x, y0 + 3, 9]), at([x, y0 + 3, 22]), at([x, y0, 22])], true);
});

export const STATION_ART = {
  plinth: slab(insetPlan(STATION, -1.6), 0, 2.4, 4),
  body: slab(STATION, 2.4, ST_TOP - 2.4, 4, 1),
  seam: sideSeam(STATION, ST_TOP - 6, P, 4),
  lidLine: planOutline(insetPlan(STATION, 3), ST_TOP, P, 4),
  screws: [
    at([STATION.x + 4.5, STATION.y + 4.5, ST_TOP]),
    at([STATION.x + STATION.w - 4.5, STATION.y + 4.5, ST_TOP]),
    at([STATION.x + 4.5, STATION.y + STATION.d - 4.5, ST_TOP]),
    at([STATION.x + STATION.w - 4.5, STATION.y + STATION.d - 4.5, ST_TOP]),
  ],
  vents: join(VENTS),
  // Boca por donde sale la etiqueta, a la altura de la paleta.
  mouth: faceRect(DOCK_X - 16, DOCK_X + 16, DOCK_Z - 9, DOCK_Z + 3.5, STATION.y + STATION.d, 1.6),
  mouthLip: faceLine(DOCK_X - 16, DOCK_X + 16, DOCK_Z + 0.2, STATION.y + STATION.d),
  // La rueda: platina, bisel moleteado, carátula con 6 casilleros marcados.
  dialBase: puck(DX, DY, DIAL_R + 2, ST_TOP, 1.4, 40),
  dial: puck(DX, DY, DIAL_R, ST_TOP + 1.4, DIAL_H - 1.4, 48),
  dialKnurl: knurl(DX, DY, DIAL_R, ST_TOP + 1.4, ST_TOP + DIAL_H, 44, P, 0.3),
  dialBezel: ring(DX, DY, DIAL_R - 1, ST_TOP + DIAL_H, P, 48),
  dialMinor: DIAL_TICKS.minor,
  dialMajor: DIAL_TICKS.major,
  dialHub: puck(DX, DY, 1.4, ST_TOP + DIAL_H, 0.8, 14),
  // Cargador de etiquetas: bloque con una ranura arriba.
  mag: slab(MAG, ST_TOP, MAG_H, 3, 0.6),
  magSlot: planOutline({ x: MAG.x + 3, y: MAG.y + 2.5, w: MAG.w - 6, d: MAG.d - 5, r: 1 }, ST_TOP + MAG_H, P, 3),
  magScrews: [at([MAG.x + 1.6, MAG.y + 1.6, ST_TOP + MAG_H]), at([MAG.x + MAG.w - 1.6, MAG.y + MAG.d - 1.6, ST_TOP + MAG_H])],
};

/** Las etiquetas que esperan en el cargador (de atrás hacia adelante). */
export const QUEUE_CARDS = Array.from({ length: 8 }, (_, i) =>
  slab({ x: MAG.x + 4, y: MAG.y + 3.4 + i * 2.1, w: MAG.w - 8, d: 0.7, r: 0.2 }, ST_TOP + MAG_H - 1, 6.4, 2),
);

export const DIAL_TOP = ST_TOP + DIAL_H;

/** La aguja de la rueda apuntando a `angle` (0 = −y, sentido horario visto desde arriba). */
export function needleAt(angle: number) {
  const r = DIAL_R - 2.4;
  const s = Math.sin(angle);
  const c = -Math.cos(angle);
  return lineOnTop([DX - s * 2.6, DY - c * 2.6], [DX + s * r, DY + c * r], DIAL_TOP + 0.4, P);
}

// ── Gabinete ─────────────────────────────────────────────────────────────

const INNER_X0 = CAB_X + SIDE;
const INNER_X1 = CAB_X + CAB_W - SIDE;
const DEPTH: [number, number] = [-CELL_D, 0];

const shelf = (z: number) => slab({ x: INNER_X0, y: DEPTH[0], w: INNER_X1 - INNER_X0, d: CELL_D, r: 0 }, z, SHELF_H, 2, 0.6);

function holder(slot: number) {
  const { cx, shelf: s0 } = cellOf(slot);
  const plan: Plan = { x: cx - 17, y: 0, w: 34, d: 1.2, r: 0.5 };
  return {
    frame: slab(plan, s0 + 1, 8, 2, 0.3),
    window: faceRect(cx - 15.6, cx + 15.6, s0 + 2.2, s0 + 7.8, 1.2, 0.8),
    screws: [at([cx - 16.2, 1.2, s0 + 5]), at([cx + 16.2, 1.2, s0 + 5])],
    text: frontText(cx, 1.2, s0 + 3.4),
  };
}

export const HOLDERS = Array.from({ length: SLOTS }, (_, slot) => holder(slot));

/** Divisiones entre columnas, por fila (de izquierda a derecha). */
function dividers(row: number) {
  const { floor, ceil } = ROWS[row]!;
  return Array.from({ length: COLUMNS - 1 }, (_, i) => {
    const x = colX(i) + CELL_W;
    const plan: Plan = { x, y: DEPTH[0], w: DIV, d: CELL_D, r: 0 };
    return { solid: slab(plan, floor, ceil - floor, 2, 0.4), seam: "" };
  });
}

const BACK: Plan = { x: INNER_X0, y: CAB_BACK, w: INNER_X1 - INNER_X0, d: 4, r: 0 };
const SIDE_L: Plan = { x: CAB_X, y: CAB_BACK, w: SIDE, d: -CAB_BACK, r: 0.6 };
const SIDE_R: Plan = { x: CAB_X + CAB_W - SIDE, y: CAB_BACK, w: SIDE, d: -CAB_BACK, r: 0.6 };
const CROWN: Plan = { x: CAB_X - 1.6, y: CAB_BACK - 1.6, w: CAB_W + 3.2, d: -CAB_BACK + 3.2, r: 1.2 };

/** Tablas verticales del fondo, vistas dentro de cada casillero (juntas de borde a borde). */
function backBoards(row: number) {
  const { floor, ceil } = ROWS[row]!;
  const lines: string[] = [];
  for (let col = 0; col < COLUMNS; col++) {
    for (const f of [1 / 3, 2 / 3]) {
      const x = colX(col) + CELL_W * f;
      lines.push(pathOf([at([x, -CELL_D, floor]), at([x, -CELL_D, ceil])]));
    }
  }
  return join(lines);
}

export const CABINET_ART = {
  halo: slab(insetPlan({ x: CAB_X, y: CAB_BACK, w: CAB_W, d: -CAB_BACK, r: 0 }, 2), 0, 0.2).fill,
  plinth: slab({ x: INNER_X0 + 1, y: CAB_BACK + 2, w: INNER_X1 - INNER_X0 - 2, d: -CAB_BACK - 4.5, r: 0 }, 0, 6, 2, 0.3),
  sideL: slab(SIDE_L, 0, TOP_Z + TOP_H, 2, 0.6),
  sideR: slab(SIDE_R, 0, TOP_Z + TOP_H, 2, 0.6),
  sideRSeams: join([ROWS[0]!.ceil + 5, 12].map((z) => sideSeam(SIDE_R, z, P, 2))),
  sideRScrews: [0, 1].flatMap((row) => [at([CAB_X + CAB_W, -8, ROWS[row]!.shelf + 5]), at([CAB_X + CAB_W, CAB_BACK + 8, ROWS[row]!.shelf + 5])]),
  back: slab(BACK, 6, TOP_Z - 6, 2),
  boards: [backBoards(0), backBoards(1)],
  shelves: [shelf(ROWS[0]!.shelf), shelf(ROWS[1]!.shelf)],
  shelfSeams: [0, 1].map((row) => faceLine(INNER_X0, INNER_X1, ROWS[row]!.shelf + SHELF_H - 1.2, 0)),
  dividers: [dividers(0), dividers(1)],
  top: slab({ x: INNER_X0, y: CAB_BACK, w: INNER_X1 - INNER_X0, d: -CAB_BACK, r: 0 }, TOP_Z, TOP_H, 2),
  crown: slab(CROWN, TOP_Z + TOP_H, CROWN_H, 3, 0.8),
  crownScrews: [at([CAB_X + 6, -4, TOP_Z + TOP_H + CROWN_H]), at([CAB_X + CAB_W - 6, -4, TOP_Z + TOP_H + CROWN_H])],
  topRule: (() => {
    // Regla de casilleros en la corona: marcas que nacen del canto del frente.
    const front = CROWN.y + CROWN.d;
    const z = TOP_Z + TOP_H + CROWN_H;
    const minor: string[] = [];
    const major: string[] = [];
    for (let x = CAB_X + 4, i = 0; x <= CAB_X + CAB_W - 4; x += 4, i++) {
      const big = i % 4 === 0;
      (big ? major : minor).push(lineOnTop([x, front], [x, front - (big ? 2.4 : 1.2)], z, P));
    }
    return { minor: join(minor), major: join(major) };
  })(),
};

// ── Lo que va dentro de un casillero ─────────────────────────────────────

/** Bandeja redonda donde se apilan las fichas. */
export const chipTray = (cx: number, floor: number) => puck(cx, CHIP_Y, CHIP_R + 1.8, floor, TRAY_H, 32);
export const chipAt = (cx: number, floor: number, n: number) => puck(cx, CHIP_Y, CHIP_R, floor + TRAY_H + n * CHIP_H, CHIP_H, 32);
export const chipSeam = (cx: number, floor: number, n: number) => sideArc(cx, CHIP_Y, CHIP_R, floor + TRAY_H + n * CHIP_H + CHIP_H / 2, P, 24);

/** Escalerilla de tres peldaños para las tarjetas (de atrás hacia adelante). */
export function rack(cx: number, floor: number) {
  return [2, 1, 0].map((k) =>
    slab({ x: cx + CARD_X - CARD_W / 2 - 1, y: RACK_FRONT - RACK_STEP_D * (k + 1), w: CARD_W + 2, d: RACK_STEP_D, r: 0.4 }, floor, cardLift(k), 2, 0.3),
  );
}

export function cardAt(cx: number, floor: number, k: number) {
  const face = cardFace(k);
  const x0 = cx + CARD_X - CARD_W / 2;
  const z0 = floor + cardLift(k);
  return {
    solid: slab({ x: x0, y: face - CARD_T, w: CARD_W, d: CARD_T, r: 0.3 }, z0, CARD_H, 2),
    rule: faceLine(x0 + 3, x0 + CARD_W - 3, z0 + 3, face),
    text: frontText(cx + CARD_X, face, z0 + CARD_H - 4.6),
  };
}

// ── Riel, postes y carro ─────────────────────────────────────────────────

const RAIL_TOP = RAIL_Z + RAIL_H;
const RAIL_FACE = RAIL.y + RAIL.d;
const STOPS = [-110, 116];

export const RAIL_ART = {
  feet: POSTS.map((x) => slab({ x: x - 3, y: 15, w: POST + 6, d: POST + 6, r: 1.5 }, 0, 2, 3, 0.4)),
  footScrews: POSTS.flatMap((x) => [at([x - 1.4, 22, 2]), at([x + POST + 1.4, 22, 2])]),
  posts: POSTS.map((x) => slab({ x, y: 18, w: POST, d: POST, r: 1 }, 2, RAIL_Z - 2, 3, 0.4)),
  postSeams: POSTS.map((x) => join([24, 70].map((z) => sideSeam({ x, y: 18, w: POST, d: POST, r: 1 }, z, P, 3)))),
  rail: slab(RAIL, RAIL_Z, RAIL_H, 3, 0.6),
  ticks: sideTicks(-104, 108, 4, 5, RAIL_FACE, RAIL_TOP, [1.2, 2.4], P, "x"),
  railScrews: POSTS.map((x) => at([x + POST / 2, 22, RAIL_TOP])),
  stops: STOPS.map((x) => slab({ x: x - 1.6, y: RAIL.y - 0.6, w: 3.2, d: RAIL.d + 1.2, r: 0.6 }, RAIL_TOP, 2.4, 2, 0.3)),
  // Retenes: una muesca en el riel por cada parada del carro (estación y 3 columnas).
  detents: [DOCK_X, ...[0, 1, 2].map((c) => colX(c) + CELL_W / 2)].map((x) => at([x, 22, RAIL_TOP])),
};

// El carro se construye en x = 0 y se traslada a lo largo del riel.
export const CARRIAGE_ART = {
  rollers: [-6, 6].map((x) => puck(x, 22, 2.6, RAIL_TOP, 2, 18)),
  rollerHubs: [-6, 6].map((x) => at([x, 22, RAIL_TOP + 2])),
  body: slab({ x: -11, y: 15.5, w: 22, d: 13, r: 1.5 }, CARRIAGE_Z, RAIL_Z - CARRIAGE_Z, 3, 0.5),
  cheek: slab({ x: -11, y: 28.5, w: 22, d: 1.6, r: 0.5 }, CARRIAGE_Z, RAIL_TOP + 3 - CARRIAGE_Z, 2, 0.3),
  cheekScrews: [
    at([-8, 30.1, RAIL_TOP + 0.8]),
    at([8, 30.1, RAIL_TOP + 0.8]),
    at([-8, 30.1, CARRIAGE_Z + 3]),
    at([8, 30.1, CARRIAGE_Z + 3]),
  ],
  collar: puck(0, 22, 3, STEM_TOP, CARRIAGE_Z - STEM_TOP, 20),
  collarSeam: sideArc(0, 22, 3, STEM_TOP + 2, P, 16),
};

/** El vástago del brazo, desde el collar del carro hasta la paleta (cambia de largo). */
export function stemAt(zp: number) {
  const z0 = zp + 3;
  return slab({ x: -1.3, y: 20.7, w: 2.6, d: 2.6, r: 1.1 }, z0, Math.max(0.5, STEM_TOP - z0), 3);
}

// La paleta se construye con su cara de arriba en z = 0 (se sube a la altura de cada fila).
export const PADDLE_ART = {
  plate: slab(PADDLE, -1.4, 1.4, 2, 0.3),
  lips: [PADDLE.x, PADDLE.x + PADDLE.w - 1.2].map((x) => slab({ x, y: PADDLE.y + 4, w: 1.2, d: PADDLE.d - 4, r: 0.3 }, 0, 1.4, 2)),
  block: slab({ x: -3.5, y: 19, w: 7, d: 6, r: 1 }, 0, 3, 2, 0.3),
  blockScrew: at([0, 22, 3]),
  clips: [-9, 9].map((x) => at([x, PADDLE.y + 0.5, -1.4])),
  tag: slab(TAG, TAG_Z0, TAG_Z1 - TAG_Z0, 2, 0.2),
  tagText: frontText(0, TAG.y + TAG.d, TAG_Z0 + 1.4),
};

/** Ficha sobre la paleta (con su cara de arriba en z = 0 de la paleta). */
export const payChip = (dx: number) => puck(dx, 16, CHIP_R, 0, CHIP_H, 32);
export const payChipSeam = (dx: number) => sideArc(dx, 16, CHIP_R, CHIP_H / 2, P, 24);
export function payCard() {
  const face = 14 + CARD_T;
  const x0 = CARD_X - CARD_W / 2;
  return {
    solid: slab({ x: x0, y: 14, w: CARD_W, d: CARD_T, r: 0.3 }, 0, CARD_H, 2),
    rule: faceLine(x0 + 3, x0 + CARD_W - 3, 3, face),
    text: frontText(CARD_X, face, CARD_H - 4.6),
  };
}

// ── Gabinete cerrado (el pedido) ─────────────────────────────────────────

export const SHUTTERS = Array.from({ length: SLOTS }, (_, slot) => {
  const { cx, floor, ceil } = cellOf(slot);
  const x0 = cx - CELL_W / 2;
  const x1 = cx + CELL_W / 2;
  const slats: string[] = [];
  for (let z = floor + 4; z < ceil - 1; z += 4) slats.push(faceLine(x0, x1, z, -1.2));
  return {
    solid: slab({ x: x0, y: -2.4, w: CELL_W, d: 1.2, r: 0 }, floor, ceil - floor, 2),
    slats: join(slats),
    handle: slab({ x: cx - 5, y: -1.2, w: 10, d: 1.4, r: 0.5 }, floor + 2.2, 1.8, 2),
  };
});

const BAR_X = colX(1) + CELL_W / 2;
const LOCK_Z = ROWS[0]!.floor + 12;
export const LOCK_ART = {
  staples: [ROWS[0]!.shelf + 2, TOP_Z + 1].map((z) => slab({ x: BAR_X - 3, y: 0, w: 6, d: 2.6, r: 0.6 }, z, 3.2, 2, 0.2)),
  bar: slab({ x: BAR_X - 1.4, y: 2.6, w: 2.8, d: 1.6, r: 0.6 }, ROWS[0]!.shelf + 1, TOP_Z + 4 - ROWS[0]!.shelf - 1, 2),
  hasp: slab({ x: BAR_X - 2.6, y: 4.2, w: 5.2, d: 1.2, r: 0.4 }, LOCK_Z + 6, 4, 2),
  shackle: (() => {
    // Arco del candado en el plano de su cara (y fijo), de patita a patita.
    const y = 7;
    const pts: Flat[] = [];
    for (let s = 0; s <= 16; s++) {
      const a = Math.PI - (s / 16) * Math.PI;
      pts.push(at([BAR_X + 3.6 * Math.cos(a), y, LOCK_Z + 5 + 4.4 * Math.sin(a)]));
    }
    return pathOf([at([BAR_X - 3.6, y, LOCK_Z + 1]), ...pts, at([BAR_X + 3.6, y, LOCK_Z + 1])]);
  })(),
  body: slab({ x: BAR_X - 6, y: 5, w: 12, d: 4, r: 1.6 }, LOCK_Z - 9, 10, 4, 0.5),
  keyhole: faceRect(BAR_X - 0.9, BAR_X + 0.9, LOCK_Z - 6.4, LOCK_Z - 3.2, 9, 0.8),
};

// ── Riel de pedidos ──────────────────────────────────────────────────────

export const ORDER_ART = {
  posts: [ORDER_X0, ORDER_X1].map((x) => slab({ x: x - 2, y: ORDER_Y - 2, w: 4, d: 4, r: 1 }, 0, ORDER_Z + 1.5, 2, 0.3)),
  feet: [ORDER_X0, ORDER_X1].map((x) => slab({ x: x - 4, y: ORDER_Y - 4, w: 8, d: 8, r: 1.4 }, 0, 1.2, 2, 0.2)),
  bar: slab({ x: ORDER_X0 - 3, y: ORDER_Y - 1.2, w: ORDER_X1 - ORDER_X0 + 6, d: 2.4, r: 1 }, ORDER_Z, 2.2, 2, 0.3),
  tickets: TICKETS.map(({ x, w }) => ({
    solid: slab({ x, y: ORDER_Y + 1.2, w, d: 0.6, r: 0.2 }, ORDER_Z - TICKET_H, TICKET_H - 0.4, 2),
    clip: slab({ x: x + w / 2 - 4, y: ORDER_Y + 1.2, w: 8, d: 1.6, r: 0.5 }, ORDER_Z - 2.4, 4.8, 2, 0.2),
    perf: faceLine(x, x + w, ORDER_Z - 3.6, ORDER_Y + 1.8),
    lines: [0, 1].map((i) => frontText(x + w / 2, ORDER_Y + 1.8, ORDER_Z - 8 - i * 5.6)),
  })),
};
