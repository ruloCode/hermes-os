// Todas las piezas estáticas de la máquina "pines", calculadas una vez al cargar
// el módulo con el kit de Anatomy. Las piezas que se mueven (puente, cabezal,
// martillo, pines) se construyen en su posición de reposo y se mueven con
// transformaciones; solo la aguja de la perilla y las manecillas se rehacen por
// cuadro (ver frame.ts).

import {
  circleRing,
  corners,
  cylinder,
  extrude,
  insetPlan,
  iso,
  knurl,
  lineOnTop,
  onTop,
  pathOf,
  planOutline,
  ring,
  segment,
  sideArc,
  sideMatrix,
  sideSeam,
  slabOf,
  topMatrix,
  type Flat,
  type Plan,
  type Plane,
  type Point3,
} from "../../iso/iso-kit";
import {
  BASE,
  BASE_H,
  BEAM_H,
  BEAM_TOP,
  BEAM_W,
  BEAM_Z,
  BED,
  BED_H,
  BUSH_R,
  CELL,
  COUNTER,
  COUNTER_H,
  DIGITS,
  FOOT_H,
  HEAD_H,
  HEAD_R,
  HEAD_Z,
  KNOB,
  LEG_R,
  P,
  PIN_TOP,
  RAIL_D,
  RAIL_H,
  RAIL_TOP,
  RAIL_X0,
  RAIL_X1,
  RAIL_Y,
  RAIL_Z,
  ROD_LEN,
  ROD_R,
  SHAFT_R,
  TIP_H,
  TIP_R,
  TIP_REST,
  TRUCK_H,
  TRUCK_Z,
  WATCH,
  WATCH_H,
  WATCH_R,
  WINDOW_X0,
  WINDOW_Z0,
  WINDOW_Z1,
  BRIDGE_BACK,
  at,
  pinX,
  pinY,
} from "./view";

const solid = (plan: Plan, z: number, h: number, steps = 4, bevel = 0) => slabOf(plan, z, h, P, steps, bevel);
const round = (cx: number, cy: number, r: number, z: number, h: number, steps = 28, bevel = 0) => cylinder(cx, cy, r, z, h, P, steps, bevel);
const seg = (a: Point3, b: Point3) => segment(a, b, P);
const join = (paths: string[]) => paths.filter(Boolean).join("");
const ringAt = (cx: number, cy: number, r: number, z: number, steps = 40) => ring(cx, cy, r, z, P, steps);

/** Punto de un ángulo de cuadrante: 0 = atrás (−y), creciendo en sentido horario visto desde arriba. */
export const polar = (cx: number, cy: number, r: number, angle: number): Plane => [cx + r * Math.sin(angle), cy - r * Math.cos(angle)];

// ── Base ───────────────────────────────────────────────────────────────

const FEET: Plane[] = corners(BASE, 17);
const SCREWS: Plane[] = corners(BASE, 7.5);
const LABEL: Plan = { x: 6, y: -73.5, w: 36, d: 8, r: 1.4 };

const byDepth = <T extends { 0: number; 1: number }>(list: T[]) =>
  [...list].sort((a, b) => iso([a[0], a[1], 0], P)[1] - iso([b[0], b[1], 0], P)[1]);

export const BASE_ART = {
  halo: solid(BASE, -BASE_H - FOOT_H, BASE_H).fill,
  feet: byDepth(FEET).map(([x, y]) => [round(x, y, 7, -BASE_H - FOOT_H, 1.6), round(x, y, 5.4, -BASE_H - FOOT_H + 1.6, FOOT_H - 1.6)]),
  slab: solid(BASE, -BASE_H, BASE_H, 8, 1.6),
  seam: sideSeam(BASE, -BASE_H + 2.4, P, 8),
  groove: planOutline(insetPlan(BASE, 4.2), 0, P),
  screws: SCREWS.map(([x, y]) => at([x, y, 0])),
  screwRings: join(SCREWS.map(([x, y]) => ringAt(x, y, 2.1, 0, 16))),
  label: solid(LABEL, 0, 0.8, 4),
  labelLine: planOutline(insetPlan(LABEL, 1.5), 0.8, P),
  labelRule: join(
    [0, 1, 2].map((row) => onTop([[LABEL.x + 7, LABEL.y + 2.4 + row * 1.6], [LABEL.x + (row === 1 ? 22 : row === 2 ? 17 : 29), LABEL.y + 2.4 + row * 1.6]], 0.8, P)),
  ),
  labelScrews: [at([LABEL.x + 3.2, LABEL.y + LABEL.d / 2, 0.8]), at([LABEL.x + LABEL.w - 3.2, LABEL.y + LABEL.d / 2, 0.8])],
};

// ── Rieles ─────────────────────────────────────────────────────────────

const PEDESTALS = [RAIL_X0 + 4, -13, RAIL_X1 - 4];

function railArt(sign: 1 | -1) {
  const y = sign * RAIL_Y;
  const plan: Plan = { x: RAIL_X0, y: y - RAIL_D / 2, w: RAIL_X1 - RAIL_X0, d: RAIL_D, r: 1.2 };
  const pedestals = PEDESTALS.map((x) => solid({ x: x - 4, y: y - 4.5, w: 8, d: 9, r: 1.2 }, 0, RAIL_Z, 3, 0.4));
  return {
    pedestals,
    pedestalScrews: PEDESTALS.flatMap((x) => [at([x - 2.6, y + 3.2 * sign, RAIL_Z]), at([x + 2.6, y + 3.2 * sign, RAIL_Z])]),
    rail: solid(plan, RAIL_Z, RAIL_H, 3, 0.6),
    railSeam: sideSeam(plan, RAIL_Z + 1.1, P, 3),
    track: sign > 0 ? "" : lineOnTop([RAIL_X0 + 3, y], [RAIL_X1 - 3, y], RAIL_TOP, P),
    railScrews: PEDESTALS.map((x) => at([x, y, RAIL_TOP])),
    // Regla del for de afuera: una marca por columna, nacida del borde de frente del riel.
    ...(sign > 0 ? marks(10, (k, l) => [[pinX(k) - BRIDGE_BACK, y + RAIL_D / 2, RAIL_TOP], [pinX(k) - BRIDGE_BACK, y + RAIL_D / 2 - l * 0.9, RAIL_TOP]]) : { minor: "", major: "" }),
    stops: [RAIL_X0 + 1.2, RAIL_X1 - 3.2].map((x) => solid({ x, y: y - RAIL_D / 2 - 0.4, w: 2, d: RAIL_D + 0.8, r: 0.5 }, RAIL_TOP, 2.6, 3)),
  };
}

export const RAIL_BACK = railArt(-1);
export const RAIL_FRONT = railArt(1);

// ── Lecho, reglas y bujes ──────────────────────────────────────────────

const RULE_X: Plan = { x: pinX(0) - 3, y: BED.y + 1.2, w: pinX(9) - pinX(0) + 6, d: 3.4, r: 0.6 };
const RULE_Y: Plan = { x: BED.x + 1.2, y: pinY(0) - 3, w: 3.4, d: pinY(10) - pinY(0) + 6, r: 0.6 };
const RULE_TOP = BED_H + 0.5;
/** Marcas en las posiciones exactas de los pines (cada 5, una larga), nacidas del borde de la regla. */
function marks(count: number, place: (k: number, length: number) => [Point3, Point3]) {
  const minor: string[] = [];
  const major: string[] = [];
  for (let k = 0; k < count; k++) {
    const big = k % 5 === 0;
    const [a, b] = place(k, big ? 2.4 : 1.4);
    (big ? major : minor).push(seg(a, b));
  }
  return { minor: join(minor), major: join(major) };
}
const ticksX = marks(10, (k, l) => [[pinX(k), RULE_X.y + 0.5, RULE_TOP], [pinX(k), RULE_X.y + 0.5 + l, RULE_TOP]]);
const ticksY = marks(11, (k, l) => [[RULE_Y.x + 0.5, pinY(k), RULE_TOP], [RULE_Y.x + 0.5 + l, pinY(k), RULE_TOP]]);
const BED_SCREWS: Plane[] = [
  [BED.x + 3.2, BED.y + 3.2],
  [BED.x + BED.w - 3.2, BED.y + 3.2],
  [BED.x + 3.2, BED.y + BED.d - 3.2],
  [BED.x + BED.w - 3.2, BED.y + BED.d - 3.2],
];

/** Elipse de pantalla de un círculo horizontal (para el hueco de un buje). */
const ellipse = (cx: number, cy: number, r: number, z: number, steps = 28) => pathOf(circleRing(cx, cy, r, steps).map(([x, y]) => at([x, y, z])), true);

const PINS: { a: number; b: number }[] = [];
for (let a = 0; a < 10; a++) for (let b = 0; b < 11; b++) PINS.push({ a, b });

export const BED_ART = {
  slab: solid(BED, 0, BED_H, 4, 0.9),
  seam: sideSeam(BED, 1.6, P, 4),
  ruleX: solid(RULE_X, BED_H, 0.5, 3),
  ruleY: solid(RULE_Y, BED_H, 0.5, 3),
  ticksMinor: ticksX.minor + ticksY.minor,
  ticksMajor: ticksX.major + ticksY.major,
  screws: BED_SCREWS.map(([x, y]) => at([x, y, BED_H])),
  bores: join(PINS.map(({ a, b }) => ellipse(pinX(a), pinY(b), HEAD_R + 0.25, BED_H))),
  bushes: join(PINS.map(({ a, b }) => ringAt(pinX(a), pinY(b), BUSH_R, BED_H, 24))),
};

// ── Pin (construido en el origen; cada uno se coloca con translate) ────

export const PIN_ART = {
  shaft: round(0, 0, SHAFT_R, BED_H - 5, PIN_TOP - HEAD_H - BED_H + 5, 14),
  head: round(0, 0, HEAD_R, PIN_TOP - HEAD_H, HEAD_H, 22, 0.35),
  dimple: ringAt(0, 0, 0.75, PIN_TOP, 12),
};

/** Recorte del pin en su buje: lo que baja del lecho se esconde dentro del hueco. */
export const PIN_CLIP = (() => {
  const [cx, cy] = at([0, 0, BED_H]);
  const rim = circleRing(0, 0, HEAD_R + 0.25, 40).map(([x, y]) => at([x, y, BED_H]));
  const half = rim.filter(([, y]) => y >= cy - 0.01).sort((p, q) => q[0] - p[0]);
  const f = (v: number) => Math.round(v * 100) / 100;
  return `M${f(cx - 40)} ${f(cy - 60)}H${f(cx + 40)}V${f(cy)}H${f(cx - 40)}Z` + pathOf([[cx + 40, cy], ...half, [cx - 40, cy]] as Flat[], true);
})();

export const PIN_ORDER = [...PINS].sort((p, q) => {
  const dp = pinX(p.a) * Math.cos((57 * Math.PI) / 180) + pinY(p.b) * Math.sin((57 * Math.PI) / 180);
  const dq = pinX(q.a) * Math.cos((57 * Math.PI) / 180) + pinY(q.b) * Math.sin((57 * Math.PI) / 180);
  return dp - dq;
});

// ── Puente (construido con la viga en x = 0; se mueve sobre x) ─────────

function truckArt(sign: 1 | -1) {
  const y = sign * RAIL_Y;
  const plan: Plan = { x: -6.5, y: y - 5, w: 13, d: 10, r: 1.6 };
  return {
    truck: solid(plan, TRUCK_Z, TRUCK_H, 4, 0.6),
    truckSeam: sideSeam(plan, TRUCK_Z + 1.4, P, 4),
    truckScrews: corners(plan, 2.2).map(([x, yy]) => at([x, yy, TRUCK_Z + TRUCK_H])),
    collar: round(0, y, 3.4, TRUCK_Z + TRUCK_H, 1.6, 28),
    leg: round(0, y, LEG_R, TRUCK_Z + TRUCK_H + 1.6, BEAM_Z - TRUCK_Z - TRUCK_H - 1.6, 24),
    legSeams: join([16, 21].map((z) => sideArc(0, y, LEG_R, z, P, 16))),
    // Índice en la cara de frente del carro: apunta a la regla del riel.
    index: sign > 0 ? seg([0, y + 5, TRUCK_Z + TRUCK_H], [0, y + 5, TRUCK_Z]) : "",
  };
}

export const TRUCK_BACK = truckArt(-1);
export const TRUCK_FRONT = truckArt(1);

const BEAM: Plan = { x: -BEAM_W / 2, y: -RAIL_Y - 5.5, w: BEAM_W, d: RAIL_Y * 2 + 11, r: 1.4 };
const beamTicks = marks(11, (k, l) => [[BEAM_W / 2, pinY(k), BEAM_TOP], [BEAM_W / 2, pinY(k), BEAM_TOP - l]]);

export const BEAM_ART = {
  beam: solid(BEAM, BEAM_Z, BEAM_H, 4, 0.8),
  seam: sideSeam(BEAM, BEAM_Z + 1.5, P, 4),
  track: join([-1.6, 1.6].map((x) => lineOnTop([x, BEAM.y + 3], [x, BEAM.y + BEAM.d - 3], BEAM_TOP, P))),
  ticksMinor: beamTicks.minor,
  ticksMajor: beamTicks.major,
  endScrews: [-1, 1].flatMap((s) => [at([0, s * (RAIL_Y + 2.5), BEAM_TOP]), at([0, s * (RAIL_Y - 1.5), BEAM_TOP])]),
};

// ── Cabezal (construido en b = 0 sobre la viga; se mueve sobre y) ──────

const SADDLE: Plan = { x: -5.6, y: -5.8, w: 19.4, d: 11.6, r: 1.6 };
const BLOCK: Plan = { x: BEAM_W / 2 + 0.2, y: -4.4, w: 8.6, d: 8.8, r: 1.2 };
const STRIKE_X = BRIDGE_BACK;
const BLOCK_FACE = BLOCK.x + BLOCK.w;

export const HEAD_ART = {
  block: solid(BLOCK, HEAD_Z, BEAM_TOP - HEAD_Z, 4, 0.5),
  blockSeam: sideSeam(BLOCK, HEAD_Z + 2.2, P, 4),
  slot: pathOf(
    [
      [BLOCK_FACE, -1.2, HEAD_Z + 4.5],
      [BLOCK_FACE, 1.2, HEAD_Z + 4.5],
      [BLOCK_FACE, 1.2, BEAM_TOP - 3.5],
      [BLOCK_FACE, -1.2, BEAM_TOP - 3.5],
    ].map((p) => at(p as Point3)),
    true,
  ),
  blockScrews: [at([BLOCK_FACE, -3.2, BEAM_TOP - 2]), at([BLOCK_FACE, 3.2, BEAM_TOP - 2]), at([BLOCK_FACE, -3.2, HEAD_Z + 1.4]), at([BLOCK_FACE, 3.2, HEAD_Z + 1.4])],
  collar: round(STRIKE_X, 0, 2.2, HEAD_Z - 1.4, 1.4, 24),
  saddle: solid(SADDLE, BEAM_TOP, 2.4, 4, 0.6),
  saddleScrews: corners(SADDLE, 2).map(([x, y]) => at([x, y, BEAM_TOP + 2.4])),
  knobNeck: round(-1.2, 0, 1.2, BEAM_TOP + 2.4, 1.2, 16),
  knob: round(-1.2, 0, 2.6, BEAM_TOP + 3.6, 2.6, 24, 0.3),
  knobKnurl: knurl(-1.2, 0, 2.6, BEAM_TOP + 3.6, BEAM_TOP + 6.2, 22, P),
  rod: round(STRIKE_X, 0, ROD_R, TIP_REST + TIP_H, ROD_LEN, 16),
  rodMarks: join([TIP_REST + TIP_H + 2.2].map((z) => sideArc(STRIKE_X, 0, ROD_R, z, P, 12))),
  tip: round(STRIKE_X, 0, TIP_R, TIP_REST, TIP_H, 20, 0.25),
};

// ── Contador de pasos (cuentavueltas de 13 ruedas) ─────────────────────

const C = COUNTER;
const FACE_Y = C.y + C.d;
const RECESS = 1.3;
const WIN_X1 = WINDOW_X0 + DIGITS * CELL;
const LUGS: Plan[] = [
  { x: C.x - 5, y: C.y + 3, w: 6, d: C.d - 6, r: 1 },
  { x: C.x + C.w - 1, y: C.y + 3, w: 6, d: C.d - 6, r: 1 },
];
const BUTTON: Plane = [C.x + C.w - 8, C.y + 7];

/** Ruedas: grupos de tres separados por un punto en la cara (miles). */
const groupDots: Flat[] = [];
for (let k = 3; k < DIGITS; k += 3) groupDots.push(at([WIN_X1 - k * CELL, FACE_Y, WINDOW_Z0 - 1.3]));

export const COUNTER_ART = {
  lugs: LUGS.map((plan) => solid(plan, 0, 1.4, 3, 0.3)),
  lugScrews: LUGS.map((plan) => at([plan.x + plan.w / 2, plan.y + plan.d / 2, 1.4])),
  body: solid(C, 1.4, COUNTER_H - 1.4, 4, 0.9),
  seam: sideSeam(C, COUNTER_H - 2.6, P, 4),
  plinthSeam: sideSeam(C, 3, P, 4),
  topScrews: corners(C, 2.4).map(([x, y]) => at([x, y, COUNTER_H])),
  // El hueco de la ventana: bordes, piso y pared izquierda del rebaje.
  windowRim: pathOf(
    [
      [WINDOW_X0 - 1, FACE_Y, WINDOW_Z1 + 0.6],
      [WIN_X1 + 1, FACE_Y, WINDOW_Z1 + 0.6],
      [WIN_X1 + 1, FACE_Y, WINDOW_Z0 - 0.6],
      [WINDOW_X0 - 1, FACE_Y, WINDOW_Z0 - 0.6],
    ].map((p) => at(p as Point3)),
    true,
  ),
  windowFloor: pathOf(
    [
      [WINDOW_X0 - 1, FACE_Y, WINDOW_Z0 - 0.6],
      [WIN_X1 + 1, FACE_Y, WINDOW_Z0 - 0.6],
      [WIN_X1 + 1, FACE_Y - RECESS, WINDOW_Z0 - 0.6],
      [WINDOW_X0 - 1, FACE_Y - RECESS, WINDOW_Z0 - 0.6],
    ].map((p) => at(p as Point3)),
    true,
  ),
  windowWall: pathOf(
    [
      [WINDOW_X0 - 1, FACE_Y, WINDOW_Z0 - 0.6],
      [WINDOW_X0 - 1, FACE_Y, WINDOW_Z1 + 0.6],
      [WINDOW_X0 - 1, FACE_Y - RECESS, WINDOW_Z1 + 0.6],
      [WINDOW_X0 - 1, FACE_Y - RECESS, WINDOW_Z0 - 0.6],
    ].map((p) => at(p as Point3)),
    true,
  ),
  /** Transformación al plano del fondo de la ventana (u → +x, v → hacia abajo). */
  drums: sideMatrix([WINDOW_X0, FACE_Y - RECESS], WINDOW_Z1 + 0.6, P, "left"),
  /** Separadores entre ruedas, sobre el fondo. */
  dividers: join(
    Array.from({ length: DIGITS - 1 }, (_, k) => {
      const x = WINDOW_X0 + (k + 1) * CELL;
      return seg([x, FACE_Y - RECESS, WINDOW_Z0 - 0.6], [x, FACE_Y - RECESS, WINDOW_Z1 + 0.6]);
    }),
  ),
  groupDots,
  button: [round(BUTTON[0], BUTTON[1], 3.2, COUNTER_H, 0.8, 24), round(BUTTON[0], BUTTON[1], 2.2, COUNTER_H + 0.8, 1.8, 20, 0.3)],
  engrave: topMatrix([C.x + 6.5, C.y + 8.6], COUNTER_H, P, "x"),
  engraveRule: lineOnTop([C.x + 6.5, C.y + 10.4], [C.x + 30, C.y + 10.4], COUNTER_H, P),
};

/** Alto de la ventana de las ruedas en el plano del fondo (unidades del mundo). */
export const DRUM_H = WINDOW_Z1 - WINDOW_Z0 + 1.2;
export const DRUM_W = CELL;

// ── Perilla de n ───────────────────────────────────────────────────────

const [KX, KY] = KNOB;
export const KNOB_TOP = 9.4;
export const KNOB_SPAN = (270 * Math.PI) / 180;
export const knobAngle = (index: number, count: number) => (count <= 1 ? 0 : -KNOB_SPAN / 2 + (index / (count - 1)) * KNOB_SPAN);

export function knobScale(count: number) {
  const major: string[] = [];
  for (let k = 0; k < count; k++) {
    const angle = knobAngle(k, count);
    const [x0, y0] = polar(KX, KY, 10.4, angle);
    const [x1, y1] = polar(KX, KY, 8.3, angle);
    major.push(lineOnTop([x0, y0], [x1, y1], 0.7, P));
  }
  return join(major);
}

export const KNOB_ART = {
  plate: round(KX, KY, 10.9, 0, 0.7, 48, 0.3),
  boss: round(KX, KY, 7, 0.7, 1.4, 40),
  body: round(KX, KY, 5.4, 2.1, 5.7, 36),
  knurl: knurl(KX, KY, 5.4, 2.1, 7.8, 40, P),
  band: sideArc(KX, KY, 5.4, 7.8, P, 24),
  cap: round(KX, KY, 4.3, 7.8, KNOB_TOP - 7.8, 32, 0.35),
};

export const knobPointer = (angle: number) => {
  const [x0, y0] = polar(KX, KY, 0.9, angle);
  const [x1, y1] = polar(KX, KY, 3.6, angle);
  return lineOnTop([x0, y0], [x1, y1], KNOB_TOP, P);
};

// ── Cronómetro (una vuelta = 1 s; el pequeño, 30 min) ─────────────────

const [WX, WY] = WATCH;
const FACE_Z = WATCH_H + 0.4;
export const SUB: Plane = [WX, WY + 4.2];

function ticksAround(cx: number, cy: number, r: number, count: number, every: number, z: number, minor: number, major: number) {
  const out = { minor: [] as string[], major: [] as string[], zero: "" };
  for (let k = 0; k < count; k++) {
    const angle = (k / count) * Math.PI * 2;
    const long = k % every === 0;
    const [x0, y0] = polar(cx, cy, r, angle);
    const [x1, y1] = polar(cx, cy, r - (long ? major : minor), angle);
    const d = lineOnTop([x0, y0], [x1, y1], z, P);
    if (k === 0) out.zero = d;
    else (long ? out.major : out.minor).push(d);
  }
  return { minor: join(out.minor), major: join(out.major), zero: out.zero };
}

const dialTicks = ticksAround(WX, WY, WATCH_R - 2.3, 50, 5, FACE_Z, 0.9, 1.8);
const subTicks = ticksAround(SUB[0], SUB[1], 2.9, 6, 1, FACE_Z, 0.7, 0.7);

export const WATCH_ART = {
  case: round(WX, WY, WATCH_R, 0, WATCH_H - 1.6, 64, 0.5),
  bezel: round(WX, WY, WATCH_R - 0.4, WATCH_H - 1.6, 2, 64, 0.5),
  bezelKnurl: knurl(WX, WY, WATCH_R - 0.4, WATCH_H - 1.6, WATCH_H + 0.4, 72, P, 0.3),
  seam: sideArc(WX, WY, WATCH_R, 1.6, P, 40),
  face: ringAt(WX, WY, WATCH_R - 2.1, FACE_Z, 64),
  minor: dialTicks.minor + subTicks.minor,
  major: dialTicks.major + subTicks.major,
  zero: dialTicks.zero,
  subRing: ringAt(SUB[0], SUB[1], 2.9, FACE_Z, 32),
  stem: solid({ x: WX + WATCH_R - 0.2, y: WY - 1.3, w: 2.4, d: 2.6, r: 0.5 }, 2.2, 1.8, 3),
  crown: solid({ x: WX + WATCH_R + 2.2, y: WY - 2.1, w: 1.8, d: 4.2, r: 0.8 }, 1.8, 2.6, 3, 0.2),
  pusher: [solid({ x: WX - 1.3, y: WY - WATCH_R - 2.2, w: 2.6, d: 2.4, r: 0.5 }, 2.2, 1.8, 3)],
};

export const watchHand = (angle: number) => {
  const [x0, y0] = polar(WX, WY, 1.8, angle + Math.PI);
  const [x1, y1] = polar(WX, WY, WATCH_R - 3, angle);
  return lineOnTop([x0, y0], [x1, y1], FACE_Z + 0.15, P);
};

export const subHand = (angle: number) => {
  const [x1, y1] = polar(SUB[0], SUB[1], 2.4, angle);
  return lineOnTop(SUB, [x1, y1], FACE_Z + 0.1, P);
};

export const WATCH_HUB = at([WX, WY, FACE_Z + 0.2]);
export const SUB_HUB = at([SUB[0], SUB[1], FACE_Z + 0.1]);

// Por si hace falta un prisma cualquiera.
export const prism = (ring: Plane[], z: number, h: number) => extrude(ring, z, h, P);
