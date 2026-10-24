// Toda la geometría estática del componedor, calculada una vez al cargar el
// módulo con el kit. Lo que se mueve (fichas, tope, carros) se construye en su
// posición de reposo y se traslada con translateAlong; lo que depende de la
// lección (ancho de casilla, numeración) se construye por número de casillas y
// se guarda.

import {
  circleRing,
  extrude,
  insetPlan,
  knurl,
  onTop,
  pathOf,
  planOutline,
  ring,
  sideArc,
  sideMatrix,
  sideSeam,
  sideTicks,
  slabOf,
  type Flat,
  type Plan,
  type Plane,
  type Point3,
  type SolidPaths,
} from "../../iso/iso-kit";
import {
  BASE,
  BASE_H,
  BED,
  BED_TOP,
  BED_Z,
  BOX,
  BOX_H,
  CRADLES,
  FOOT_H,
  FRONT,
  HEAD,
  HEAD_TOP,
  KNEE_TOP,
  KNEE_W,
  P,
  POSTS,
  RAIL_D,
  RAIL_FROM,
  RAIL_H,
  RAIL_TO,
  RAIL_Y,
  RAIL_Z,
  SPACE_H,
  SPAN,
  STRIP_D,
  STRIP_H,
  STRIP_Z,
  TILE_D,
  TILE_GAP,
  TILE_H,
  TILE_Y,
  TIP_Z,
  WALL,
  WALL_TOP,
  WINDOW,
  at,
  slotWidth,
} from "./view";

const solid = (plan: Plan, z: number, h: number, steps = 3, bevel = 0) => slabOf(plan, z, h, P, steps, bevel);
const cyl = (cx: number, cy: number, r: number, z: number, h: number, steps = 24) => extrude(circleRing(cx, cy, r, steps), z, h, P, { convex: true });
const seg = (a: Point3, b: Point3) => pathOf([at(a), at(b)]);
const join = (paths: string[]) => paths.filter(Boolean).join("");

/** Un rectángulo en un plano y = cte (la cara que mira al frente). */
const faceRect = (x0: number, x1: number, z0: number, z1: number, y: number) =>
  pathOf([at([x0, y, z0]), at([x1, y, z0]), at([x1, y, z1]), at([x0, y, z1])], true);

/** Un rectángulo en un plano x = cte (la cara del costado). */
const sideRect = (x: number, y0: number, y1: number, z0: number, z1: number) =>
  pathOf([at([x, y0, z0]), at([x, y1, z0]), at([x, y1, z1]), at([x, y0, z1])], true);

/** Texto grabado en una cara frontal: centrado en x, con la línea base en z. */
export const frontText = (x: number, y: number, baseline: number) => sideMatrix([x, y], baseline, P, "left");

// ── Base ────────────────────────────────────────────────────────────────────

const FEET: Plane[] = [
  [BASE.x + 16, BASE.y + 12],
  [BASE.x + BASE.w - 16, BASE.y + 12],
  [BASE.x + 16, BASE.y + BASE.d - 12],
  [BASE.x + BASE.w - 16, BASE.y + BASE.d - 12],
];
const BASE_SCREWS: Plane[] = [
  [BASE.x + 7, BASE.y + 7],
  [BASE.x + BASE.w - 7, BASE.y + 7],
  [BASE.x + 7, BASE.y + BASE.d - 7],
  [BASE.x + BASE.w - 7, BASE.y + BASE.d - 7],
];
const LABEL: Plan = { x: SPAN / 2 - 22, y: 13, w: 44, d: 8.5, r: 1.4 };

export const BASE_ART = {
  halo: solid(BASE, -BASE_H - FOOT_H, BASE_H, 8).fill,
  feet: FEET.map(([x, y]) => [cyl(x, y, 6.5, -BASE_H - FOOT_H, 1.4), cyl(x, y, 5, -BASE_H - FOOT_H + 1.4, FOOT_H - 1.4)]),
  slab: solid(BASE, -BASE_H, BASE_H, 8, 1.4),
  seam: sideSeam(BASE, -BASE_H / 2, P, 8),
  groove: planOutline(insetPlan(BASE, 4.5), 0, P),
  screws: BASE_SCREWS.map(([x, y]) => at([x, y, 0])),
  screwRings: join(BASE_SCREWS.map(([x, y]) => ring(x, y, 2, 0, P, 16))),
  label: solid(LABEL, 0, 0.8, 3),
  labelLine: planOutline(insetPlan(LABEL, 1.5), 0.8, P),
  labelRule: join([0, 1, 2].map((row) => onTop([[LABEL.x + 7, LABEL.y + 3 + row * 2], [LABEL.x + (row === 1 ? 20 : 27), LABEL.y + 3 + row * 2]], 0.8, P))),
  labelScrews: [at([LABEL.x + 3.2, LABEL.y + LABEL.d / 2, 0.8]), at([LABEL.x + LABEL.w - 3.2, LABEL.y + LABEL.d / 2, 0.8])],
};

// ── Componedor ──────────────────────────────────────────────────────────────

const HEAD_SCREWS: Point3[] = [
  [HEAD.x + 4.5, HEAD.y + 4.5, HEAD_TOP],
  [HEAD.x + HEAD.w - 4.5, HEAD.y + 4.5, HEAD_TOP],
  [HEAD.x + 4.5, HEAD.y + HEAD.d - 4.5, HEAD_TOP],
  [HEAD.x + HEAD.w - 4.5, HEAD.y + HEAD.d - 4.5, HEAD_TOP],
];

export const STICK_ART = {
  cradles: CRADLES.map((plan) => solid(plan, 0, BED_Z, 3, 0.5)),
  cradleScrews: CRADLES.flatMap((plan) => [at([plan.x + 3, plan.y + plan.d - 3, BED_Z]), at([plan.x + plan.w - 3, plan.y + plan.d - 3, BED_Z])]),
  head: solid(HEAD, 0, HEAD_TOP, 3, 0.8),
  // La ranura por donde la regla negativa entra al cabezal, y su costura.
  headSlot: sideRect(HEAD.x + HEAD.w, FRONT - 0.2, FRONT + STRIP_D + 0.4, STRIP_Z - 0.4, STRIP_Z + STRIP_H + 0.4),
  headSeam: sideSeam(HEAD, BED_TOP, P, 3),
  headScrews: HEAD_SCREWS.map((point) => at(point)),
  headRings: join(HEAD_SCREWS.map(([x, y, z]) => ring(x, y, 1.6, z, P, 14))),
  wall: solid(WALL, BED_Z, WALL_TOP - BED_Z, 2, 0.3),
  wallScrews: [24, 70, 116, 162, SPAN + 8].map((x) => at([x, WALL.y + WALL.d / 2, WALL_TOP])),
  bed: solid(BED, BED_Z, BED_TOP - BED_Z, 2, 0.5),
  // La línea donde termina la regla fija y empieza el canal de la negativa.
  bedChannel: seg([0, FRONT, STRIP_Z + STRIP_H + 0.4], [BED.x + BED.w, FRONT, STRIP_Z + STRIP_H + 0.4]),
  // El asiento de las fichas: dos líneas a lo largo de la cama, de punta a punta.
  bedSeat: join([TILE_Y - 0.8, TILE_Y + TILE_D + 0.8].map((y) => onTop([[0, y], [BED.x + BED.w, y]], BED_TOP, P))),
};

// ── Tope móvil (construido en x = 0) ────────────────────────────────────────

const KNEE: Plan = { x: 0, y: WALL.y + WALL.d, w: KNEE_W, d: FRONT - (WALL.y + WALL.d), r: 0.8 };
const HOOK: Plan = { x: 0, y: WALL.y - 1.5, w: KNEE_W, d: WALL.d + 3, r: 0.6 };
const BRACKET: Plan = { x: 0, y: FRONT, w: KNEE_W, d: STRIP_D + 0.4, r: 0.3 };
const SCREW_AT: Plane = [KNEE_W / 2, WALL.y + WALL.d / 2];

export const KNEE_ART = {
  body: solid(KNEE, BED_TOP, KNEE_TOP - BED_TOP, 2, 0.5),
  bodyLine: sideSeam(KNEE, 26, P, 2),
  hook: solid(HOOK, WALL_TOP, 3, 2, 0.3),
  screw: cyl(SCREW_AT[0], SCREW_AT[1], 2.3, WALL_TOP + 3, 5),
  screwKnurl: knurl(SCREW_AT[0], SCREW_AT[1], 2.3, WALL_TOP + 3, WALL_TOP + 8, 18, P, 0.5),
  screwTop: ring(SCREW_AT[0], SCREW_AT[1], 1, WALL_TOP + 8, P, 12),
  bracket: solid(BRACKET, BED_Z, BED_TOP + 4 - BED_Z, 2, 0.2),
  rivets: [at([KNEE_W / 2, FRONT + STRIP_D + 0.4, BED_Z + 2.3]), at([KNEE_W / 2, FRONT + STRIP_D + 0.4, BED_TOP + 1.8])],
  // El índice del tope: una raya en la cama, justo en el borde donde cierra.
  index: seg([0, FRONT, BED_TOP], [0, FRONT, BED_TOP - 3.6]),
};

// ── Riel y carros ───────────────────────────────────────────────────────────

const RAIL: Plan = { x: RAIL_FROM, y: RAIL_Y, w: RAIL_TO - RAIL_FROM, d: RAIL_D, r: 0.8 };
const POST_PLANS: Plan[] = POSTS.map((x) => ({ x: x - 3, y: RAIL_Y, w: 6, d: RAIL_D, r: 1 }));

export const RAIL_ART = {
  feet: POST_PLANS.map((plan) => solid(insetPlan(plan, -3), 0, 1.6, 3, 0.3)),
  footScrews: POST_PLANS.flatMap((plan) => [at([plan.x - 1.4, plan.y + 3, 1.6]), at([plan.x + plan.w + 1.4, plan.y + 3, 1.6])]),
  posts: POST_PLANS.map((plan) => solid(plan, 1.6, RAIL_Z - 1.6, 2)),
  postSeams: POST_PLANS.map((plan) => sideSeam(plan, RAIL_Z - 6, P, 2)),
  beam: solid(RAIL, RAIL_Z, RAIL_H, 2, 0.5),
  beamScrews: POSTS.map((x) => at([x, RAIL_Y + RAIL_D / 2, RAIL_Z + RAIL_H])),
  ends: join([RAIL_FROM + 2, RAIL_TO - 2].map((x) => seg([x, RAIL_Y + RAIL_D, RAIL_Z], [x, RAIL_Y + RAIL_D, RAIL_Z + RAIL_H]))),
};

/** La graduación del riel: una raya por borde de casilla, colgando del canto. */
export function railTicks(cap: number) {
  const w = slotWidth(cap);
  const every = cap > 10 ? 5 : 1;
  return sideTicks(0, SPAN + 0.01, w, every, RAIL_Y + RAIL_D, RAIL_Z + RAIL_H, [1.8, 3], P);
}

const TOP_BLOCK: Plan = { x: -6, y: RAIL_Y - 1.2, w: 12, d: RAIL_D + 4.4, r: 1 };
const CHEEK: Plan = { x: -6, y: RAIL_Y + RAIL_D, w: 12, d: 2, r: 0.4 };
const ARM: Plan = { x: -2, y: RAIL_Y + RAIL_D + 2, w: 4, d: -(RAIL_Y + RAIL_D + 2) + 2, r: 0.6 };

export const CARRIAGE_ART = {
  block: solid(TOP_BLOCK, RAIL_Z + RAIL_H, 5, 2, 0.5),
  blockScrews: [at([-3, RAIL_Y + RAIL_D / 2, RAIL_Z + RAIL_H + 5]), at([3, RAIL_Y + RAIL_D / 2, RAIL_Z + RAIL_H + 5])],
  cheek: solid(CHEEK, RAIL_Z - 0.5, RAIL_H + 0.5, 2, 0.2),
  cheekScrews: [at([-3.4, RAIL_Y + RAIL_D + 2, RAIL_Z + 2]), at([3.4, RAIL_Y + RAIL_D + 2, RAIL_Z + 2])],
  arm: solid(ARM, RAIL_Z + 2, 4, 2, 0.3),
  stem: cyl(0, 0, 1.3, TIP_Z + 3.5, RAIL_Z + 2 - (TIP_Z + 3.5), 18),
  collar: cyl(0, 0, 2.4, TIP_Z + 9, 3.2, 22),
  collarKnurl: knurl(0, 0, 2.4, TIP_Z + 9, TIP_Z + 12.2, 16, P, 0.4),
  collarSeam: sideArc(0, 0, 1.3, TIP_Z + 3.5, P, 12),
  tip: cyl(0, 0, 0.8, TIP_Z, 3.5, 14),
  point: at([0, 0, TIP_Z]),
};

// ── Caja de salida ──────────────────────────────────────────────────────────

const BOX_FRONT = BOX.y + BOX.d;

export const BOX_ART = {
  body: solid(BOX, 0, BOX_H, 3, 1),
  lid: planOutline(insetPlan(BOX, 3), BOX_H, P, 3),
  lidScrews: [
    at([BOX.x + 5.5, BOX.y + 5.5, BOX_H]),
    at([BOX.x + BOX.w - 5.5, BOX.y + 5.5, BOX_H]),
    at([BOX.x + 5.5, BOX.y + BOX.d - 5.5, BOX_H]),
    at([BOX.x + BOX.w - 5.5, BOX.y + BOX.d - 5.5, BOX_H]),
  ],
  // La ventana, hundida: el vidrio, el marco y las paredes del hueco.
  glass: faceRect(WINDOW.x0 + 0.8, WINDOW.x1 - 0.8, WINDOW.z0 + 0.8, WINDOW.z1 - 0.8, BOX_FRONT - 1.2),
  bezel: faceRect(WINDOW.x0, WINDOW.x1, WINDOW.z0, WINDOW.z1, BOX_FRONT),
  recessFloor: pathOf(
    [
      at([WINDOW.x0, BOX_FRONT, WINDOW.z0]),
      at([WINDOW.x1, BOX_FRONT, WINDOW.z0]),
      at([WINDOW.x1 - 0.8, BOX_FRONT - 1.2, WINDOW.z0 + 0.8]),
      at([WINDOW.x0 + 0.8, BOX_FRONT - 1.2, WINDOW.z0 + 0.8]),
    ],
    true,
  ),
  recessSide: pathOf(
    [
      at([WINDOW.x0, BOX_FRONT, WINDOW.z0]),
      at([WINDOW.x0, BOX_FRONT, WINDOW.z1]),
      at([WINDOW.x0 + 0.8, BOX_FRONT - 1.2, WINDOW.z1 - 0.8]),
      at([WINDOW.x0 + 0.8, BOX_FRONT - 1.2, WINDOW.z0 + 0.8]),
    ],
    true,
  ),
  windowScrews: [at([WINDOW.x0 - 2, BOX_FRONT, WINDOW.z1 + 2]), at([WINDOW.x1 + 2, BOX_FRONT, WINDOW.z1 + 2])],
  // El texto va centrado en la ventana (dominant-baseline central) y su tamaño
  // sale del largo: lo más ancho que se muestra es 'IndexError'.
  text: frontText((WINDOW.x0 + WINDOW.x1) / 2, BOX_FRONT - 1.2, (WINDOW.z0 + WINDOW.z1) / 2),
  clip: faceRect(WINDOW.x0 + 0.8, WINDOW.x1 - 0.8, WINDOW.z0 + 0.8, WINDOW.z1 - 0.8, BOX_FRONT - 1.2),
  baseSeam: sideSeam(BOX, 3, P, 3),
};

/** Tamaño del texto de la ventana para que quepa con margen (mono ≈ 0,62 em por letra). */
export const windowSize = (text: string) => Math.min(8.5, (WINDOW.x1 - WINDOW.x0 - 5) / (0.62 * Math.max(1, text.length)));

// ── Lo que depende del número de casillas ───────────────────────────────────

export interface SlotArt {
  cap: number;
  w: number;
  ticks: string;
  numerals: { text: string; transform: string }[];
  strip: SolidPaths;
  stripNumerals: { text: string; transform: string }[];
  stripTicks: string;
  stripClip: string;
  tile: SolidPaths;
  tilePanel: string;
  tileNick: string;
  space: SolidPaths;
  spaceNick: string;
  letter: string;
  letterSize: number;
  numeralSize: number;
  negativeSize: number;
}

const cache = new Map<string, SlotArt>();

/** Arte por lección: ancho de casilla, reglas y fichas. `chars` = el rótulo más largo. */
export function slotArt(cap: number, chars: number): SlotArt {
  const key = `${cap}:${chars}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const w = slotWidth(cap);
  const digits = String(cap).length;
  const numeralSize = Math.min(5.4, (w - 1.6) / (0.64 * digits + 0.6));
  const negativeSize = Math.min(4.6, (w - 1.2) / (0.64 * (digits + 1)));
  const ticks: string[] = [];
  for (let index = 0; index <= cap; index++) ticks.push(seg([index * w, FRONT, BED_TOP], [index * w, FRONT, BED_TOP - 1.6]));
  const numerals = Array.from({ length: cap }, (_, index) => ({ text: String(index), transform: frontText((index + 0.5) * w, FRONT, STRIP_Z + STRIP_H + 1.7) }));
  // La regla negativa vive a la izquierda del tope (x ≤ 0 al construirla).
  const stripPlan: Plan = { x: -cap * w, y: FRONT, w: cap * w, d: STRIP_D, r: 0.2 };
  const stripNumerals = Array.from({ length: cap }, (_, index) => ({
    text: String(-(index + 1)),
    transform: frontText(-(index + 0.5) * w, FRONT + STRIP_D, STRIP_Z + 1.1),
  }));
  const stripTicks = join(Array.from({ length: cap + 1 }, (_, index) => seg([-index * w, FRONT + STRIP_D, STRIP_Z + STRIP_H], [-index * w, FRONT + STRIP_D, STRIP_Z + STRIP_H - 1])));
  const body: Plan = { x: TILE_GAP, y: TILE_Y, w: w - TILE_GAP * 2, d: TILE_D, r: Math.min(1, w / 8) };
  const inset = Math.min(1.4, w / 9);
  const letterSize = Math.min(11.5, (w - TILE_GAP * 2 - inset * 2 - 1.6) / (0.64 * Math.max(1, chars)));
  const art: SlotArt = {
    cap,
    w,
    ticks: join(ticks),
    numerals,
    strip: solid(stripPlan, STRIP_Z, STRIP_H, 2, 0),
    stripNumerals,
    stripTicks,
    stripClip: solid({ x: 0, y: FRONT - 1, w: SPAN + 40, d: STRIP_D + 3, r: 0 }, STRIP_Z - 2, STRIP_H + 4, 1).fill,
    tile: solid(body, BED_TOP, TILE_H, 2, 0.5),
    tilePanel: faceRect(body.x + inset, body.x + body.w - inset, BED_TOP + 1.6, BED_TOP + TILE_H - 1.6, TILE_Y + TILE_D),
    tileNick: seg([body.x, TILE_Y + TILE_D, BED_TOP + 0.9], [body.x + body.w, TILE_Y + TILE_D, BED_TOP + 0.9]),
    space: solid(body, BED_TOP, SPACE_H, 2, 0.4),
    spaceNick: seg([body.x, TILE_Y + TILE_D, BED_TOP + 3], [body.x + body.w, TILE_Y + TILE_D, BED_TOP + 3]),
    letter: frontText(w / 2, TILE_Y + TILE_D, BED_TOP + TILE_H / 2 - letterSize * 0.34),
    letterSize,
    numeralSize,
    negativeSize,
  };
  cache.set(key, art);
  return art;
}

/** Punto de la punta de un carro en x de mundo (para la lectura del acento). */
export const tipAt = (x: number): Flat => at([x, 0, TIP_Z]);
