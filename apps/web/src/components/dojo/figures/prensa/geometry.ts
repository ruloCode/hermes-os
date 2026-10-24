// Toda la geometría fija de la prensa, calculada una vez al cargar el módulo.
// Lo que se mueve (fichas, empujador, ariete, volante) se construye en reposo y
// se desplaza con translate; lo que cambia de forma va en frame().

import {
  circleRing,
  extrude,
  insetPlan,
  onTop,
  pathOf,
  planOutline,
  ringSeam,
  roundedPlan,
  sideArc,
  sideMatrix,
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
  BOLSTER,
  BOLSTER_TOP,
  CHUTE,
  COLUMN,
  CYL_R,
  CYL_X0,
  CYL_X1,
  CYL_Z,
  DROP_FROM,
  FOOT_H,
  GLAND_R,
  GLAND_TOP,
  GUARD,
  GUARD_SIDE,
  EXIT_SLOT,
  GUIDE_H,
  HEAD,
  HEAD_TOP,
  HEAD_Z,
  MAG_HALF,
  MAG_TOP,
  MAG_X,
  P,
  POST_Y,
  PUNCH,
  PUNCH_H,
  PUNCH_REST,
  PUSHER_HOME,
  PUSHER_LEN,
  RAIL,
  RAIL_TOP,
  RAM_R,
  TILE_D,
  TILE_H,
  TRAY,
  TRAY_FLOOR,
  TRAY_WALL,
  VISOR,
  VISOR_TOP,
  WHEEL,
  at,
  barrelX,
  depth,
  textSize,
  tileWidth,
} from "./view";

const solid = (plan: Plan, z: number, h: number, steps = 5, bevel = 0) => slabOf(plan, z, h, P, steps, bevel);
const cyl = (cx: number, cy: number, r: number, z: number, h: number, steps = 32) =>
  extrude(circleRing(cx, cy, r, steps), z, h, P, { convex: true });
const ring = (cx: number, cy: number, r: number, z: number, steps = 32) => onTop(circleRing(cx, cy, r, steps), z, P, true);
const seg = (a: Point3, b: Point3) => pathOf([at(a), at(b)]);
const join = (list: string[]) => list.join("");
const byDepth = (points: Plane[]) => [...points].sort((a, b) => depth([a[0], a[1], 0]) - depth([b[0], b[1], 0]));

/** Una ranura cerrada en el plano y = cte (rejillas de la guarda). */
function slotY(y: number, x0: number, x1: number, z: number, h: number) {
  const r = h / 2;
  const pts: Flat[] = [];
  for (let i = 0; i <= 8; i++) {
    const a = -Math.PI / 2 + (i / 8) * Math.PI;
    pts.push(at([x1 - r + r * Math.cos(a), y, z + r * Math.sin(a)]));
  }
  for (let i = 0; i <= 8; i++) {
    const a = Math.PI / 2 + (i / 8) * Math.PI;
    pts.push(at([x0 + r + r * Math.cos(a), y, z + r * Math.sin(a)]));
  }
  return pathOf(pts, true);
}

/** Una ranura vertical cerrada en el plano y = cte (la mirilla de carrera). */
function slotV(y: number, x: number, z0: number, z1: number, w: number) {
  const r = w / 2;
  const pts: Flat[] = [];
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * Math.PI;
    pts.push(at([x + r * Math.cos(a), y, z1 - r + r * Math.sin(a)]));
  }
  for (let i = 0; i <= 8; i++) {
    const a = Math.PI + (i / 8) * Math.PI;
    pts.push(at([x + r * Math.cos(a), y, z0 + r + r * Math.sin(a)]));
  }
  return pathOf(pts, true);
}

/** Una ranura horizontal cerrada en el plano x = cte (rejilla del costado). */
function slotX(x: number, y0: number, y1: number, z: number, h: number) {
  const r = h / 2;
  const pts: Flat[] = [];
  for (let i = 0; i <= 8; i++) {
    const a = -Math.PI / 2 + (i / 8) * Math.PI;
    pts.push(at([x, y1 - r + r * Math.cos(a), z + r * Math.sin(a)]));
  }
  for (let i = 0; i <= 8; i++) {
    const a = Math.PI / 2 + (i / 8) * Math.PI;
    pts.push(at([x, y0 + r + r * Math.cos(a), z + r * Math.sin(a)]));
  }
  return pathOf(pts, true);
}

/** Cuatro tornillos en las esquinas de una placa. */
function screwsOn(plan: Plan, inset: number, z: number): Flat[] {
  return [
    at([plan.x + inset, plan.y + inset, z]),
    at([plan.x + plan.w - inset, plan.y + inset, z]),
    at([plan.x + inset, plan.y + plan.d - inset, z]),
    at([plan.x + plan.w - inset, plan.y + plan.d - inset, z]),
  ];
}

// ── Banco ──────────────────────────────────────────────────────────────

const FEET: Plane[] = byDepth([
  [BASE.x + 20, BASE.y + 16],
  [BASE.x + BASE.w - 20, BASE.y + 16],
  [BASE.x + 20, BASE.y + BASE.d - 16],
  [BASE.x + BASE.w - 20, BASE.y + BASE.d - 16],
]);
const BASE_SCREWS: Plane[] = [
  [BASE.x + 8, BASE.y + 8],
  [BASE.x + BASE.w - 8, BASE.y + 8],
  [BASE.x + 8, BASE.y + BASE.d - 8],
  [BASE.x + BASE.w - 8, BASE.y + BASE.d - 8],
];
const RULER: Plan = { x: -118, y: 31, w: 140, d: 6, r: 1 };
export const NAMEPLATE: Plan = { x: 60, y: 27, w: 58, d: 12, r: 1.5 };

function rulerTicks() {
  const minor: string[] = [];
  const major: string[] = [];
  const edge = RULER.y + RULER.d;
  for (let x = RULER.x + 5; x <= RULER.x + RULER.w - 5; x += 5) {
    const big = (x - RULER.x) % 25 === 0;
    (big ? major : minor).push(onTop([[x, edge], [x, edge - (big ? 3.4 : 1.8)]], 0.6, P));
  }
  return { minor: join(minor), major: join(major) };
}
const RULE = rulerTicks();

export const BASE_ART = {
  halo: solid(BASE, -BASE_H - FOOT_H, BASE_H).fill,
  feet: FEET.map(([x, y]) => [cyl(x, y, 7.5, -BASE_H - FOOT_H, 1.6), cyl(x, y, 5.8, -BASE_H - FOOT_H + 1.6, FOOT_H - 1.6)]),
  slab: solid(BASE, -BASE_H, BASE_H, 8, 1.6),
  seam: ringSeam(roundedPlan(BASE, 8), -BASE_H + 2.6, P),
  groove: planOutline(insetPlan(BASE, 4.5), 0, P),
  screws: BASE_SCREWS.map(([x, y]) => at([x, y, 0])),
  screwRings: join(BASE_SCREWS.map(([x, y]) => ring(x, y, 2.2, 0, 16))),
  ruler: solid(RULER, 0, 0.6, 3),
  ruleMinor: RULE.minor,
  ruleMajor: RULE.major,
  rulerScrews: [at([RULER.x + 2.4, RULER.y + 2.2, 0.6]), at([RULER.x + RULER.w - 2.4, RULER.y + 2.2, 0.6])],
  plate: solid(NAMEPLATE, 0, 0.8, 4),
  plateLine: planOutline(insetPlan(NAMEPLATE, 1.6), 0.8, P),
  plateScrews: [at([NAMEPLATE.x + 3.2, NAMEPLATE.y + NAMEPLATE.d / 2, 0.8]), at([NAMEPLATE.x + NAMEPLATE.w - 3.2, NAMEPLATE.y + NAMEPLATE.d / 2, 0.8])],
  /** El grabado de la placa: el nombre de la función, centrado. */
  plateText: topMatrix([NAMEPLATE.x + NAMEPLATE.w / 2, NAMEPLATE.y + NAMEPLATE.d / 2 + 1.4], 0.8, P, "x"),
};

// ── Empujador: cilindro neumático, vástago y bloque ─────────────────────

const SADDLES: Plan[] = [CYL_X0 + 2, CYL_X1 - 5].map((x) => ({ x, y: -5, w: 3, d: 10, r: 0.6 }));
export const CYLINDER_ART = {
  saddles: SADDLES.map((plan) => solid(plan, 0, CYL_Z - CYL_R + 1, 3)),
  saddleScrews: SADDLES.map((plan) => at([plan.x + 1.5, plan.y + plan.d - 1.6, CYL_Z - CYL_R + 1])),
  capBack: barrelX(CYL_X0, CYL_X0 + 1.8, 0, CYL_Z, CYL_R + 0.8),
  body: barrelX(CYL_X0 + 1.8, CYL_X1 - 1.8, 0, CYL_Z, CYL_R),
  bodySeams: join([CYL_X0 + 6, CYL_X1 - 6].map((x) => arcX(x, 0, CYL_Z, CYL_R))),
  capFront: barrelX(CYL_X1 - 1.8, CYL_X1, 0, CYL_Z, CYL_R + 0.8),
  capBolts: [0.6, 2.2, 3.8, 5.4].map((a) => at([CYL_X1, (CYL_R - 0.6) * Math.cos(a), CYL_Z + (CYL_R - 0.6) * Math.sin(a)])),
  fitting: cyl(CYL_X0 + 5, 0, 1.5, CYL_Z + CYL_R - 0.4, 3, 16),
  fittingNut: cyl(CYL_X0 + 5, 0, 2.1, CYL_Z + CYL_R + 1, 1.2, 6),
};

/**
 * Arco visible de un anillo en x = cte sobre un cilindro acostado (costuras):
 * la media vuelta que mira al lector, de limbo a limbo, sin saltos.
 */
function arcX(x: number, cy: number, cz: number, r: number) {
  const o = depth([0, 0, 0]);
  const facing = Math.atan2(depth([0, 0, 1]) - o, depth([0, 1, 0]) - o);
  const pts: Flat[] = [];
  for (let i = 0; i <= 24; i++) {
    const a = facing - Math.PI / 2 + (i / 24) * Math.PI;
    pts.push(at([x, cy + r * Math.cos(a), cz + r * Math.sin(a)]));
  }
  return pathOf(pts);
}

/** El bloque empujador, en su casa (cara de empuje en x = 0 local). */
const PUSH_BLOCK: Plan = { x: -PUSHER_LEN, y: -15, w: PUSHER_LEN, d: 30, r: 1 };
export const PUSHER_ART = {
  block: solid(PUSH_BLOCK, RAIL_TOP, 7, 3, 0.6),
  face: pathOf([at([0, -13, RAIL_TOP + 1]), at([0, 13, RAIL_TOP + 1])]),
  screws: [at([-PUSHER_LEN / 2, -11, RAIL_TOP + 7]), at([-PUSHER_LEN / 2, 11, RAIL_TOP + 7])],
  clevis: solid({ x: -PUSHER_LEN - 3, y: -3, w: 3, d: 6, r: 0.8 }, CYL_Z - 3, 6, 3),
};
export const PUSHER_BACK = PUSHER_HOME - PUSHER_LEN - 3;

// ── Riel de entrada ─────────────────────────────────────────────────────

const guides = (plan: Plan) => [
  { x: plan.x, y: plan.y - 3.5, w: plan.w, d: 3.5, r: 0.6 },
  { x: plan.x, y: plan.y + plan.d, w: plan.w, d: 3.5, r: 0.6 },
];
const RAIL_GUIDES = guides(RAIL);
const guideScrews = (plan: Plan, every: number) => {
  const out: Flat[] = [];
  for (let x = plan.x + 6; x < plan.x + plan.w - 3; x += every) out.push(at([x, plan.y + plan.d / 2, GUIDE_H]));
  return out;
};
export const RAIL_ART = {
  bed: solid(RAIL, 0, RAIL_TOP, 4, 0.5),
  lane: planOutline(insetPlan(RAIL, 3), RAIL_TOP, P, 3),
  back: solid(RAIL_GUIDES[0]!, 0, GUIDE_H, 3, 0.4),
  backScrews: guideScrews(RAIL_GUIDES[0]!, 22),
  front: solid(RAIL_GUIDES[1]!, 0, GUIDE_H, 3, 0.4),
  frontScrews: guideScrews(RAIL_GUIDES[1]!, 22),
};

// ── Cargador: cuatro postes, collar y compuerta ─────────────────────────

const POST = 2.6;
const postPlan = (x: number, y: number): Plan => ({ x: x - POST / 2, y: y - POST / 2, w: POST, d: POST, r: 0.5 });
const MX0 = MAG_X - MAG_HALF;
const MX1 = MAG_X + MAG_HALF;
const COLLAR_Z = MAG_TOP;
const COLLAR_H = 3;
const COLLAR_W = 3.2;
export const MAGAZINE_ART = {
  backPosts: [MX0, MX1].map((x) => solid(postPlan(x, -POST_Y), GUIDE_H, MAG_TOP - GUIDE_H, 2)),
  frontPosts: [MX0, MX1].map((x) => solid(postPlan(x, POST_Y), GUIDE_H, MAG_TOP - GUIDE_H, 2)),
  postFeet: [MX0, MX1].flatMap((x) => [-POST_Y, POST_Y].map((y) => solid(insetPlan(postPlan(x, y), -1), GUIDE_H, 1.2, 2))),
  collarBack: solid({ x: MX0 - COLLAR_W / 2, y: -POST_Y - COLLAR_W / 2, w: MAG_HALF * 2 + COLLAR_W, d: COLLAR_W, r: 0.8 }, COLLAR_Z, COLLAR_H, 3, 0.4),
  collarLeft: solid({ x: MX0 - COLLAR_W / 2, y: -POST_Y + COLLAR_W / 2, w: COLLAR_W, d: POST_Y * 2 - COLLAR_W, r: 0.3 }, COLLAR_Z, COLLAR_H, 2),
  collarRight: solid({ x: MX1 - COLLAR_W / 2, y: -POST_Y + COLLAR_W / 2, w: COLLAR_W, d: POST_Y * 2 - COLLAR_W, r: 0.3 }, COLLAR_Z, COLLAR_H, 2),
  collarFront: solid({ x: MX0 - COLLAR_W / 2, y: POST_Y - COLLAR_W / 2, w: MAG_HALF * 2 + COLLAR_W, d: COLLAR_W, r: 0.8 }, COLLAR_Z, COLLAR_H, 3, 0.4),
  collarScrews: [MX0, MX1].flatMap((x) => [-POST_Y, POST_Y].map((y) => at([x, y, COLLAR_Z + COLLAR_H]))),
  /** Marcas de nivel en el poste del frente: una cada 8 de caída. */
  postMarks: join(
    [MX1].flatMap((x) =>
      [18, 26, 34, 42].map((z) => seg([x - POST / 2, POST_Y + POST / 2, z], [x + POST / 2, POST_Y + POST / 2, z])),
    ),
  ),
};
export const DROP_TOP = DROP_FROM;

// ── Prensa ──────────────────────────────────────────────────────────────

const GIBS: Plan[] = [-15, 11].map((x) => ({ x, y: COLUMN.y + COLUMN.d, w: 4, d: 1.4, r: 0.4 }));
const DIE: Plan = { x: -20, y: -18, w: 40, d: 36, r: 1.5 };
const HEAD_SCREWS: Plane[] = [
  [HEAD.x + 4, HEAD.y + 4],
  [HEAD.x + HEAD.w - 4, HEAD.y + 4],
  [HEAD.x + 4, HEAD.y + HEAD.d - 4],
  [HEAD.x + HEAD.w - 4, HEAD.y + HEAD.d - 4],
];
export const PRESS_ART = {
  column: solid(COLUMN, 0, HEAD_Z, 4, 0.8),
  columnSeam: ringSeam(roundedPlan(COLUMN, 4), 14, P),
  columnRibs: join([-12, -4, 4, 12].map((x) => seg([x, COLUMN.y + COLUMN.d, 18], [x, COLUMN.y + COLUMN.d, HEAD_Z]))),
  gibs: GIBS.map((plan) => solid(plan, BOLSTER_TOP, HEAD_Z - BOLSTER_TOP, 2)),
  gibScrews: GIBS.flatMap((plan) => [14, 30, 46].map((z) => at([plan.x + plan.w / 2, plan.y + plan.d, z]))),
  bolster: solid(BOLSTER, 0, BOLSTER_TOP, 4, 0.6),
  bolsterScrews: screwsOn(BOLSTER, 3.4, BOLSTER_TOP),
  die: solid(DIE, BOLSTER_TOP, RAIL_TOP - BOLSTER_TOP, 4),
  dieLine: planOutline(insetPlan(DIE, 2.4), RAIL_TOP, P, 3),
  dieScrews: screwsOn(DIE, 1.4, RAIL_TOP),
  head: solid(HEAD, HEAD_Z, HEAD_TOP - HEAD_Z, 4, 1.2),
  headSeam: ringSeam(roundedPlan(HEAD, 4), HEAD_Z + 6, P),
  headGroove: planOutline(insetPlan(HEAD, 3), HEAD_TOP, P, 3),
  headScrews: HEAD_SCREWS.map(([x, y]) => at([x, y, HEAD_TOP])),
  headScrewRings: join(HEAD_SCREWS.map(([x, y]) => ring(x, y, 1.6, HEAD_TOP, 12))),
  oilCup: cyl(16, -34, 2.2, HEAD_TOP, 3, 18),
  oilCap: cyl(16, -34, 2.8, HEAD_TOP + 3, 1.2, 18),
  gland: cyl(0, 0, GLAND_R, HEAD_TOP, GLAND_TOP - HEAD_TOP, 32),
  glandRing: ring(0, 0, GLAND_R - 1.6, GLAND_TOP, 24),
  glandBolts: [0.3, 2.4, 4.5].map((a) => at([GLAND_R * 0.72 * Math.cos(a), GLAND_R * 0.72 * Math.sin(a), GLAND_TOP])),
};

/** Dirección (ángulo en el plano) hacia el lector, para repartir pernos visibles. */
const AZ_FACE = Math.atan2(Math.sin((58 * Math.PI) / 180), Math.cos((58 * Math.PI) / 180));

// Frente de la cabeza (y = HY): mirilla de carrera con su escala y una tapa
// atornillada. El puntero de la mirilla baja con el ariete (frame.ts).
const HY = HEAD.y + HEAD.d;
export const SIGHT = { x: 18, z0: HEAD_Z + 4, z1: HEAD_TOP - 4, w: 3.2 };
function sightTicks() {
  const minor: string[] = [];
  const major: string[] = [];
  const edge = SIGHT.x - SIGHT.w / 2;
  for (let i = 0, z = SIGHT.z1 - 2; z >= SIGHT.z0 + 1.9; i++, z -= 2) {
    const big = i % 4 === 0;
    (big ? major : minor).push(seg([edge, HY, z], [edge - (big ? 2.6 : 1.5), HY, z]));
  }
  return { minor: join(minor), major: join(major) };
}
const SIGHT_TICKS = sightTicks();
const COVER = { x0: -22, x1: 8, z0: HEAD_Z + 4.5, z1: HEAD_TOP - 4.5 };
export const HEAD_FRONT = {
  sight: slotV(HY, SIGHT.x, SIGHT.z0, SIGHT.z1, SIGHT.w),
  sightMinor: SIGHT_TICKS.minor,
  sightMajor: SIGHT_TICKS.major,
  cover: pathOf(
    [
      at([COVER.x0, HY, COVER.z0]),
      at([COVER.x1, HY, COVER.z0]),
      at([COVER.x1, HY, COVER.z1]),
      at([COVER.x0, HY, COVER.z1]),
    ],
    true,
  ),
  coverScrews: [COVER.x0 + 2, COVER.x1 - 2].flatMap((x) => [COVER.z0 + 2, COVER.z1 - 2].map((z) => at([x, HY, z]))),
  bolts: [HEAD.x + 3, HEAD.x + HEAD.w - 3].flatMap((x) => [HEAD_Z + 3, HEAD_TOP - 3].map((z) => at([x, HY, z]))),
  /** Puntero de la mirilla en reposo (arriba); se mueve con translate en z. */
  pointer: seg([SIGHT.x - 1, HY, SIGHT.z1 - 2], [SIGHT.x + 1, HY, SIGHT.z1 - 2]),
};
/** Cuánto baja el puntero de la mirilla en una carrera completa. */
export const SIGHT_RUN = SIGHT.z1 - SIGHT.z0 - 4;

/** Ariete y troquel superior en reposo (se mueven con translate en z). */
export const RAM_ART = {
  ram: cyl(0, 0, RAM_R, PUNCH_REST + PUNCH_H, HEAD_Z - PUNCH_REST - PUNCH_H + 6, 32),
  ramSeams: join([PUNCH_REST + PUNCH_H + 6, PUNCH_REST + PUNCH_H + 12].map((z) => sideArc(0, 0, RAM_R, z, P, 20))),
  collar: cyl(0, 0, RAM_R + 1.6, PUNCH_REST + PUNCH_H, 2.2, 32),
  collarBolts: [-0.9, 0.2, 1.3].map((a) => {
    const v = AZ_FACE + a;
    return at([(RAM_R + 1.6) * Math.cos(v), (RAM_R + 1.6) * Math.sin(v), PUNCH_REST + PUNCH_H + 1.1]);
  }),
  punch: solid(PUNCH, PUNCH_REST, PUNCH_H, 4, 0.8),
  punchLine: ringSeam(roundedPlan(PUNCH, 4), PUNCH_REST + 2, P),
  /** El grabado de la cara del troquel que mira al lector (y = +15). */
  face: sideMatrix([PUNCH.x, PUNCH.y + PUNCH.d], PUNCH_REST + PUNCH_H, P, "left"),
};

/** La guarda que tapa la garganta mientras el problema no está resuelto. */
const GUARD_TOP = HEAD_Z;
const GY = GUARD.y + GUARD.d;
export const GUARD_ART = {
  panel: solid(GUARD, BOLSTER_TOP, GUARD_TOP - BOLSTER_TOP, 2, 0.3),
  slots: join([0, 1, 2, 3, 4].map((i) => slotY(GY, GUARD.x + 12, GUARD.x + GUARD.w - 12, GUARD_TOP - 7 - i * 3.2, 1.4))),
  screws: [
    at([GUARD.x + 2.6, GY, GUARD_TOP - 2.6]),
    at([GUARD.x + GUARD.w - 2.6, GY, GUARD_TOP - 2.6]),
    at([GUARD.x + 2.6, GY, BOLSTER_TOP + 2.6]),
    at([GUARD.x + GUARD.w - 2.6, GY, BOLSTER_TOP + 2.6]),
  ],
  handlePosts: [-9, 7].map((x) => solid({ x, y: GY, w: 2, d: 2.4, r: 0.4 }, 17, 2, 2)),
  handleBar: solid({ x: -10, y: GY + 2.4, w: 20, d: 1.6, r: 0.6 }, 16.6, 2.8, 3),
  lock: solid({ x: 14, y: GY, w: 6, d: 1, r: 0.8 }, 14, 8, 3),
  lockKey: pathOf([at([17, GY + 1, 19.6]), at([17, GY + 1, 16.4])]),
  side: solid(GUARD_SIDE, EXIT_SLOT, GUARD_TOP - EXIT_SLOT, 2, 0.3),
  sideSlots: join([0, 1, 2].map((i) => slotX(GUARD_SIDE.x + GUARD_SIDE.w, GUARD_SIDE.y + 8, GUARD_SIDE.y + GUARD_SIDE.d - 8, GUARD_TOP - 8 - i * 3.2, 1.4))),
  sideScrews: [GUARD_SIDE.y + 3, GUARD_SIDE.y + GUARD_SIDE.d - 3].flatMap((y) =>
    [EXIT_SLOT + 3, GUARD_TOP - 3].map((z) => at([GUARD_SIDE.x + GUARD_SIDE.w, y, z])),
  ),
};

/** Volante en la cara +x de la cabeza: aro, cubo y su eje. */
const WX = WHEEL.x;
export const WHEEL_ART = {
  boss: barrelX(WX, WX + 1.6, WHEEL.y, WHEEL.z, 4.4),
  rim: barrelX(WX + 2.6, WX + 5, WHEEL.y, WHEEL.z, WHEEL.r),
  rimInner: pathOf(innerX(WX + 5, WHEEL.y, WHEEL.z, WHEEL.r - 2.4), true),
  rimInnerWall: pathOf(innerX(WX + 2.6, WHEEL.y, WHEEL.z, WHEEL.r - 2.4), true),
  hub: barrelX(WX + 1.6, WX + 6.2, WHEEL.y, WHEEL.z, 2.6),
  hubNut: barrelX(WX + 6.2, WX + 7, WHEEL.y, WHEEL.z, 1.6, 6),
};
function innerX(x: number, cy: number, cz: number, r: number): Flat[] {
  return Array.from({ length: 40 }, (_, i) => {
    const a = (i / 40) * Math.PI * 2;
    return at([x, cy + r * Math.cos(a), cz + r * Math.sin(a)]);
  });
}

// ── Salida: canal y bandeja ─────────────────────────────────────────────

const CHUTE_GUIDES = guides(CHUTE);
export const CHUTE_ART = {
  bed: solid(CHUTE, 0, RAIL_TOP, 4, 0.5),
  lane: planOutline(insetPlan(CHUTE, 3), RAIL_TOP, P, 3),
  back: solid(CHUTE_GUIDES[0]!, 0, GUIDE_H, 3, 0.4),
  backScrews: guideScrews(CHUTE_GUIDES[0]!, 24),
  front: solid(CHUTE_GUIDES[1]!, 0, GUIDE_H, 3, 0.4),
  frontScrews: guideScrews(CHUTE_GUIDES[1]!, 24),
};

const WALL = 2.4;
const TRAY_BACK: Plan = { x: TRAY.x, y: TRAY.y - WALL, w: TRAY.w + WALL, d: WALL, r: 0.6 };
const TRAY_FRONT: Plan = { x: TRAY.x, y: TRAY.y + TRAY.d, w: TRAY.w + WALL, d: WALL, r: 0.6 };
const TRAY_RIGHT: Plan = { x: TRAY.x + TRAY.w, y: TRAY.y, w: WALL, d: TRAY.d, r: 0.3 };
export const TRAY_ART = {
  halo: solid(insetPlan(TRAY, -2), 0, 0.2).fill,
  floor: solid(TRAY, 0, TRAY_FLOOR, 4, 0.4),
  /** Estrías del piso: de borde a borde (del canto abierto a la pared del fondo). */
  floorGrid: join(
    Array.from({ length: 4 }, (_, i) => onTop([[TRAY.x, TRAY.y + 8 * (i + 1)], [TRAY.x + TRAY.w, TRAY.y + 8 * (i + 1)]], TRAY_FLOOR, P)),
  ),
  back: solid(TRAY_BACK, 0, TRAY_WALL, 3, 0.4),
  front: solid(TRAY_FRONT, 0, TRAY_WALL, 3, 0.4),
  frontRivets: [62, 78, 94, 110].map((x) => at([x, TRAY_FRONT.y + WALL, TRAY_WALL - 2])),
  right: solid(TRAY_RIGHT, 0, TRAY_WALL, 2, 0.4),
  rightRivets: [-12, 0, 12].map((y) => at([TRAY_RIGHT.x + WALL, y, TRAY_WALL - 2])),
  /** Un tope a la entrada: la ficha cae los 3 de altura del canal a la bandeja. */
  stop: solid({ x: TRAY.x + TRAY.w - 4, y: -10, w: 4, d: 20, r: 0.8 }, TRAY_FLOOR, 2.4, 3),
};

// ── Visor (print) ───────────────────────────────────────────────────────

const VY = VISOR.y + VISOR.d;
export const VISOR_ART = {
  neck: cyl(VISOR.x + VISOR.w / 2, VISOR.y + VISOR.d / 2, 2.6, HEAD_TOP, 3, 18),
  box: solid(VISOR, HEAD_TOP + 3, VISOR_TOP - HEAD_TOP - 3, 3, 0.6),
  boxGroove: planOutline(insetPlan(VISOR, 1.6), VISOR_TOP, P, 3),
  /** Plano de la pantalla: cara del frente (y = VY), origen arriba a la izquierda. */
  face: sideMatrix([VISOR.x, VY], VISOR_TOP, P, "left"),
  screws: [at([VISOR.x + 2, VISOR.y + 2, VISOR_TOP]), at([VISOR.x + VISOR.w - 2, VISOR.y + 2, VISOR_TOP])],
};
/** La ventana de la pantalla en coordenadas de la cara (x a la derecha, y hacia abajo). */
export const SCREEN = { x: 1.8, y: 2, w: VISOR.w - 3.6, h: 8 };

// ── Fichas ──────────────────────────────────────────────────────────────

export interface TileArt {
  w: number;
  size: number;
  body: ReturnType<typeof slabOf>;
  rim: string;
  label: string;
  /** La misma etiqueta sobre el piso (el pedido en la bandeja). */
  floorLabel: string;
  footprint: string;
}

const tiles = new Map<string, TileArt>();
/** Una ficha con su texto, en el origen (centro abajo); se mueve con translate. */
export function tileOf(text: string): TileArt {
  const cached = tiles.get(text);
  if (cached) return cached;
  const w = tileWidth(text);
  const size = textSize(text);
  const plan: Plan = { x: -w / 2, y: -TILE_D / 2, w, d: TILE_D, r: 2 };
  const art: TileArt = {
    w,
    size,
    body: slabOf(plan, 0, TILE_H, P, 4, 0.6),
    rim: planOutline(insetPlan(plan, 1.2), TILE_H, P, 3),
    label: topMatrix([0, size * 0.36], TILE_H, P, "x"),
    floorLabel: topMatrix([0, size * 0.36], 0, P, "x"),
    footprint: planOutline(plan, 0, P, 4),
  };
  tiles.set(text, art);
  return art;
}
