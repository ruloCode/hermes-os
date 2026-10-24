// Cada pieza fija de la cinta, calculada una vez al cargar el módulo con el kit
// de Anatomy. Las que cambian de forma (la trampa que gira, la manivela, el
// vástago del sello) tienen aquí su función y la parte viva las reconstruye.
import {
  circleRing,
  extrude,
  insetPlan,
  lineOnTop,
  onTop,
  pathOf,
  planOutline,
  sideArc,
  sideMatrix,
  sideSeam,
  slabOf,
  topMatrix,
  type Flat,
  type Plan,
  type Point3,
  type SolidPaths,
} from "../../iso/iso-kit";
import {
  ARCH_Y,
  BASE,
  BASE_END,
  BASE_H,
  baseFor,
  type StationKey,
  BEAM_Z,
  BELT,
  BIN,
  BIN_H,
  BT,
  COUNTER,
  CRANK_R,
  CRANK_Y,
  EXIT_X,
  FLAP,
  FLAP_HINGE,
  FOOT_H,
  HOPPER,
  HOPPER_TOP,
  LEGS,
  MOUTH,
  P,
  PEDESTAL_X,
  PITCH,
  PRESS_X,
  RACK,
  RACK_COLS,
  RACK_H,
  RACK_PITCH,
  RACK_ROWS,
  RAIL_D,
  RAIL_Z,
  READER_Z,
  ROLLERS,
  TOKEN,
  TOKEN_H,
  TRAY,
  TRAY_H,
  WALL,
  WINDOW,
  X_HEAD,
  at,
} from "./view";

const box = (plan: Plan, z: number, h: number, steps = 4, bevel = 0) => slabOf(plan, z, h, P, steps, bevel);
const cyl = (cx: number, cy: number, r: number, z: number, h: number, steps = 32) =>
  extrude(circleRing(cx, cy, r, steps), z, h, P, { convex: true });
const seg = (a: Point3, b: Point3) => pathOf([at(a), at(b)]);
const join = (paths: string[]) => paths.filter(Boolean).join("");
const RAD = Math.PI / 180;
const A = (P.azimuth ?? 45) * RAD;
const E = (P.elevation ?? 30) * RAD;
/** Hacia el espectador, en el mundo. */
const VIEW: Point3 = [Math.cos(A) * Math.cos(E), Math.sin(A) * Math.cos(E), Math.sin(E)];
const dot = (a: Point3, b: Point3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function hull(points: Flat[]): Flat[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (sorted.length < 3) return sorted;
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

/** Tono de una cara por su normal: la misma luz del kit (de frente-izquierda y de arriba). */
function shadeOf([nx, ny, nz]: Point3) {
  const lit = (nx * -Math.sin(A) + ny * Math.cos(A)) * 0.5 + nz * 0.55 + 0.45;
  return Math.min(3, Math.max(0, Math.floor(lit * 4)));
}

/**
 * Una barra redonda acostada (eje, tambor, perilla) a lo largo de x o de y:
 * caras del costado sombreadas por su normal y la tapa que mira al
 * espectador como `top`.
 */
export function roundBar(axis: "x" | "y", a0: number, a1: number, center: [number, number], r: number, steps = 28): SolidPaths {
  const [c1, c2] = center;
  const ring = (a: number) =>
    Array.from({ length: steps }, (_, i) => {
      const t = (i / steps) * Math.PI * 2;
      const u = r * Math.cos(t);
      const v = r * Math.sin(t);
      return (axis === "x" ? [a, c1 + u, c2 + v] : [c1 + u, a, c2 + v]) as Point3;
    });
  const r0 = ring(a0);
  const r1 = ring(a1);
  const buckets: string[][] = [[], [], [], []];
  for (let i = 0; i < steps; i++) {
    const t = ((i + 0.5) / steps) * Math.PI * 2;
    const normal: Point3 = axis === "x" ? [0, Math.cos(t), Math.sin(t)] : [Math.cos(t), 0, Math.sin(t)];
    if (dot(normal, VIEW) <= 0) continue;
    const j = (i + 1) % steps;
    buckets[shadeOf(normal)]!.push(pathOf([at(r0[i]!), at(r0[j]!), at(r1[j]!), at(r1[i]!)], true));
  }
  const capAxis: Point3 = axis === "x" ? [1, 0, 0] : [0, 1, 0];
  const cap = dot(capAxis, VIEW) > 0 === a1 > a0 ? r1 : r0;
  const capPath = pathOf(cap.map(at), true);
  const outline = pathOf(hull([...r0, ...r1].map(at)), true);
  return { fill: outline, outline, crease: capPath, top: capPath, shades: buckets.map((b) => b.join("")) };
}

/** Una caja girada (la trampa): esquinas en el mundo → caras visibles sombreadas. */
export function orientedBox(center: Point3, axes: [Point3, Point3, Point3], half: Point3): SolidPaths {
  const corner = (su: number, sv: number, sw: number): Point3 => [
    center[0] + axes[0][0] * half[0] * su + axes[1][0] * half[1] * sv + axes[2][0] * half[2] * sw,
    center[1] + axes[0][1] * half[0] * su + axes[1][1] * half[1] * sv + axes[2][1] * half[2] * sw,
    center[2] + axes[0][2] * half[0] * su + axes[1][2] * half[1] * sv + axes[2][2] * half[2] * sw,
  ];
  const faces: { n: Point3; quad: Point3[] }[] = [];
  for (const [a, b, c] of [
    [0, 1, 2],
    [1, 2, 0],
    [2, 0, 1],
  ] as const) {
    for (const s of [-1, 1]) {
      const pick = (p: number, q: number) => {
        const sign: [number, number, number] = [0, 0, 0];
        sign[a] = s;
        sign[b] = p;
        sign[c] = q;
        return corner(sign[0], sign[1], sign[2]);
      };
      const n = axes[a].map((value) => value * s) as Point3;
      faces.push({ n, quad: [pick(-1, -1), pick(1, -1), pick(1, 1), pick(-1, 1)] });
    }
  }
  const visible = faces.filter((face) => dot(face.n, VIEW) > 1e-6);
  const top = visible.reduce((best, face) => (face.n[2] > best.n[2] ? face : best), visible[0]!);
  const buckets: string[][] = [[], [], [], []];
  for (const face of visible) if (face !== top) buckets[shadeOf(face.n)]!.push(pathOf(face.quad.map(at), true));
  const all = faces.flatMap((face) => face.quad).map(at);
  const outline = pathOf(hull(all), true);
  return { fill: outline, outline, crease: pathOf(top.quad.map(at), true), top: pathOf(top.quad.map(at), true), shades: buckets.map((b) => b.join("")) };
}

/** Un rectángulo en el plano de una cara vertical (y constante). */
const faceRect = (y: number, x0: number, x1: number, z0: number, z1: number) =>
  pathOf([at([x0, y, z0]), at([x1, y, z0]), at([x1, y, z1]), at([x0, y, z1])], true);
/** Un rectángulo en una cara de x constante. */
const endRect = (x: number, y0: number, y1: number, z0: number, z1: number) =>
  pathOf([at([x, y0, z0]), at([x, y1, z0]), at([x, y1, z1]), at([x, y0, z1])], true);
/** Ranura cerrada (redondeada) en una cara de y constante. */
function faceSlot(y: number, cx: number, z0: number, z1: number, w: number) {
  const r = w / 2;
  const points: Flat[] = [];
  for (let i = 0; i <= 8; i++) {
    const t = Math.PI + (i / 8) * Math.PI;
    points.push(at([cx + r * Math.cos(t), y, z1 - r + r * -Math.sin(t)]));
  }
  for (let i = 0; i <= 8; i++) {
    const t = (i / 8) * Math.PI;
    points.push(at([cx + r * Math.cos(t), y, z0 + r - r * Math.sin(t)]));
  }
  return pathOf(points, true);
}
/** Una tuerca vista de frente: anillo en una cara de y constante. */
const faceRing = (x: number, y: number, z: number, r: number, steps = 18) =>
  pathOf(
    Array.from({ length: steps }, (_, i) => {
      const t = (i / steps) * Math.PI * 2;
      return at([x + r * Math.cos(t), y, z + r * Math.sin(t)]);
    }),
    true,
  );

// ── Banco ───────────────────────────────────────────────────────────────
const corners = ({ x, y, w, d }: Plan, ix: number, iy: number): Flat[] => [
  [x + ix, y + iy],
  [x + w - ix, y + iy],
  [x + ix, y + d - iy],
  [x + w - ix, y + d - iy],
];
const PLATE: Plan = { x: BASE.x + 12, y: BASE.y + BASE.d - 14, w: 34, d: 9, r: 1.6 };
/** Regla de vueltas: una marca grande por paso de la cinta, la del lector resaltada. */
const STRIP: Plan = { x: PLATE.x + PLATE.w + 6, y: BASE.y + BASE.d - 11, w: X_HEAD + PITCH + 6 - (PLATE.x + PLATE.w + 6), d: 5.5, r: 1 };

function slotTicks() {
  const minor: string[] = [];
  const major: string[] = [];
  const edge = STRIP.y + 0.8;
  for (let m = -23; m <= 4; m++) {
    const x = X_HEAD + m * (PITCH / 4);
    if (x < STRIP.x + 2 || x > STRIP.x + STRIP.w - 2 || m === 0) continue;
    const big = m % 4 === 0;
    (big ? major : minor).push(lineOnTop([x, edge], [x, edge + (big ? 3.6 : 2)], 0.6, P));
  }
  return { minor: join(minor), major: join(major), zero: lineOnTop([X_HEAD, edge], [X_HEAD, STRIP.y + STRIP.d - 0.8], 0.6, P) };
}
const TICKS = slotTicks();

function baseArt(BASE: Plan) {
  const FEET = corners(BASE, 20, 15);
  const SCREWS = corners(BASE, 8, 8);
  return {
  halo: box(BASE, -BASE_H - FOOT_H, BASE_H).fill,
  feet: FEET.map(([x, y]) => [cyl(x, y, 7, -BASE_H - FOOT_H, 1.6), cyl(x, y, 5.4, -BASE_H - FOOT_H + 1.6, FOOT_H - 1.6)]),
  slab: box(BASE, -BASE_H, BASE_H, 8, 1.6),
  groove: planOutline(insetPlan(BASE, 4.5), 0, P),
  screws: SCREWS.map(([x, y]) => at([x, y, 0])),
  screwRings: join(SCREWS.map(([x, y]) => onTop(circleRing(x, y, 2.2, 16), 0, P, true))),
  plate: box(PLATE, 0, 0.8, 4),
  plateLine: planOutline(insetPlan(PLATE, 1.4), 0.8, P),
  plateRule: join([0, 1, 2].map((row) => onTop([[PLATE.x + 6, PLATE.y + 3 + row * 2], [PLATE.x + (row === 1 ? 24 : 32), PLATE.y + 3 + row * 2]], 0.8, P))),
  plateScrews: [at([PLATE.x + 3, PLATE.y + PLATE.d / 2, 0.8]), at([PLATE.x + PLATE.w - 3, PLATE.y + PLATE.d / 2, 0.8])],
  strip: box(STRIP, 0, 0.6, 3),
  ticksMinor: TICKS.minor,
  ticksMajor: TICKS.major,
  zero: TICKS.zero,
  stripScrews: [at([STRIP.x + 2.2, STRIP.y + STRIP.d / 2, 0.6]), at([STRIP.x + STRIP.w - 2.2, STRIP.y + STRIP.d / 2, 0.6])],
  };
}

export const BASE_ARTS = Object.fromEntries((Object.keys(BASE_END) as StationKey[]).map((key) => [key, baseArt(baseFor(key))])) as Record<StationKey, ReturnType<typeof baseArt>>;


// ── Patas, rieles y banda ───────────────────────────────────────────────
const LEG_Y = [-(12 + RAIL_D / 2), 12 + RAIL_D / 2];
export const LEG_ART = LEGS.map((x) => ({
  pads: LEG_Y.map((y) => box({ x: x - 4, y: y - 4, w: 8, d: 8, r: 1.5 }, 0, 1.5, 3)),
  padScrews: LEG_Y.flatMap((y) => [at([x - 2.6, y + 2.6, 1.5]), at([x + 2.6, y - 2.6, 1.5])]),
  posts: LEG_Y.map((y) => box({ x: x - 2, y: y - 2, w: 4, d: 4, r: 0.6 }, 1.5, RAIL_Z - 1.5, 2)),
  brace: box({ x: x - 1.5, y: LEG_Y[0]! + 2, w: 3, d: LEG_Y[1]! - LEG_Y[0]! - 4, r: 0.5 }, 5, 3, 2),
}));

const RAIL = (y: number): Plan => ({ x: BELT.x - 2, y, w: BELT.w + 4, d: RAIL_D, r: 1.5 });
const FRONT_FACE = BELT.y + BELT.d + RAIL_D;
export const RAIL_ART = {
  back: box(RAIL(BELT.y - RAIL_D), RAIL_Z, BT - RAIL_Z, 4, 0.5),
  front: box(RAIL(BELT.y + BELT.d), RAIL_Z, BT - RAIL_Z, 4, 0.5),
  frontSeam: sideSeam(RAIL(BELT.y + BELT.d), RAIL_Z + 3, P, 4),
  bolts: [-84, -56, -12, 6].map((x) => at([x, FRONT_FACE, RAIL_Z + 6])),
  axles: join(ROLLERS.map((x) => faceRing(x, FRONT_FACE, BT - 4.5, 2.6))),
  axleNuts: ROLLERS.map((x) => at([x, FRONT_FACE, BT - 4.5])),
};

const BELT_TOP = BELT;
export const BELT_ART = {
  belt: box(BELT_TOP, BT - 4, 4, 6),
  clip: planOutline(BELT_TOP, BT, P, 6),
  /** Listones de la banda cada medio paso, dibujados de sobra a ambos lados. */
  cleats: join(
    Array.from({ length: Math.ceil(BELT.w / (PITCH / 2)) + 4 }, (_, i) => {
      const x = BELT.x - PITCH + i * (PITCH / 2);
      return lineOnTop([x, BELT.y], [x, BELT.y + BELT.d], BT, P);
    }),
  ),
  /** Un paso de banda en pantalla (para moverla). */
  step: (() => {
    const a = at([0, 0, BT]);
    const b = at([PITCH / 2, 0, BT]);
    return [b[0] - a[0], b[1] - a[1]] as Flat;
  })(),
};

// ── Tolva y manivela ────────────────────────────────────────────────────
const HOPPER_FACE = HOPPER.y + HOPPER.d;
const HOPPER_END = HOPPER.x + HOPPER.w;
const HOP_PLATE = { x0: HOPPER.x + 6, x1: HOPPER.x + 22, z0: 42, z1: 50 };
export const HOPPER_ART = {
  body: box(HOPPER, BT, HOPPER_TOP - BT, 4, 0.6),
  seam: sideSeam(HOPPER, 36, P, 4),
  lid: box(insetPlan(HOPPER, -1.2), HOPPER_TOP, 2.2, 4, 0.5),
  lidScrews: [
    [HOPPER.x + 2.5, HOPPER.y + 2.5],
    [HOPPER.x + HOPPER.w - 2.5, HOPPER.y + 2.5],
    [HOPPER.x + 2.5, HOPPER.y + HOPPER.d - 2.5],
    [HOPPER.x + HOPPER.w - 2.5, HOPPER.y + HOPPER.d - 2.5],
  ].map(([x, y]) => at([x!, y!, HOPPER_TOP + 2.2])),
  knobs: [-8, 8].map((y) => cyl(HOPPER.x + HOPPER.w / 2, y, 1.4, HOPPER_TOP + 2.2, 3, 14)),
  handle: box({ x: HOPPER.x + HOPPER.w / 2 - 1.4, y: -9.4, w: 2.8, d: 18.8, r: 1.2 }, HOPPER_TOP + 5.2, 1.8, 3),
  /** Boca por donde sale cada ficha: un arco en la cara que mira a la estación. */
  mouth: pathOf(
    [
      at([HOPPER_END, -10.5, BT]),
      ...Array.from({ length: 13 }, (_, i) => {
        const t = Math.PI - (i / 12) * Math.PI;
        return at([HOPPER_END, 10.5 * Math.cos(t), BT + 4.5 + 2.2 * Math.sin(t)]);
      }),
      at([HOPPER_END, 10.5, BT]),
    ],
    true,
  ),
  plate: faceRect(HOPPER_FACE, HOP_PLATE.x0, HOP_PLATE.x1, HOP_PLATE.z0, HOP_PLATE.z1),
  plateRule: join([0, 1, 2].map((row) => seg([HOP_PLATE.x0 + 2.4, HOPPER_FACE, HOP_PLATE.z1 - 2.2 - row * 1.9], [HOP_PLATE.x0 + (row === 1 ? 10 : 13), HOPPER_FACE, HOP_PLATE.z1 - 2.2 - row * 1.9]))),
  plateRivets: [at([HOP_PLATE.x0 + 1.2, HOPPER_FACE, (HOP_PLATE.z0 + HOP_PLATE.z1) / 2]), at([HOP_PLATE.x1 - 1.2, HOPPER_FACE, (HOP_PLATE.z0 + HOP_PLATE.z1) / 2])],
  rivets: [6, 14, 22, 28].map((dx) => at([HOPPER.x + dx, HOPPER_FACE, BT + 3])),
};

const CRANK_X = ROLLERS[0]!;
const CRANK_Z = BT - 4.5;
export const CRANK_ART = {
  axle: roundBar("y", FRONT_FACE, CRANK_Y - 1.2, [CRANK_X, CRANK_Z], 1.8, 18),
  wheel: roundBar("y", CRANK_Y - 1.2, CRANK_Y + 0.8, [CRANK_X, CRANK_Z], CRANK_R, 44),
  rim: faceRing(CRANK_X, CRANK_Y + 0.8, CRANK_Z, CRANK_R - 1.6, 36),
  hub: faceRing(CRANK_X, CRANK_Y + 0.8, CRANK_Z, 1.8, 14),
};

/** Los rayos y el mango de la manivela, girados `angle` radianes. */
export function crankFrame(angle: number) {
  const y = CRANK_Y + 0.8;
  const spokes = join(
    [0, 1, 2].map((i) => {
      const t = angle + (i * Math.PI * 2) / 3;
      return seg([CRANK_X + 1.8 * Math.cos(t), y, CRANK_Z + 1.8 * Math.sin(t)], [CRANK_X + (CRANK_R - 1.6) * Math.cos(t), y, CRANK_Z + (CRANK_R - 1.6) * Math.sin(t)]);
    }),
  );
  const hx = CRANK_X + (CRANK_R - 2.2) * Math.cos(angle + Math.PI / 3);
  const hz = CRANK_Z + (CRANK_R - 2.2) * Math.sin(angle + Math.PI / 3);
  return { spokes, handle: roundBar("y", y, y + 5.5, [hx, hz], 1.25, 14) };
}

// ── Lector ──────────────────────────────────────────────────────────────
// Un brazo en C desde una columna de atrás: nada tapa la ficha que se lee.
const POST = (y: number): Plan => ({ x: X_HEAD - 3, y: y - 3, w: 6, d: 6, r: 1 });
const ARCH_FOOT = (y: number): Plan => ({ x: X_HEAD - 6, y: y - 4.5, w: 12, d: 9, r: 1.5 });
const ARM_Y1 = 7.5;
export const ARCH_ART = {
  backFoot: box(ARCH_FOOT(-ARCH_Y), 0, 1.5, 3),
  backFootScrews: [at([X_HEAD - 4, -ARCH_Y, 1.5]), at([X_HEAD + 4, -ARCH_Y, 1.5])],
  backPost: box(POST(-ARCH_Y), 1.5, BEAM_Z - 1.5, 3, 0.4),
  postSeam: sideSeam(POST(-ARCH_Y), 8, P, 3),
  gusset: box({ x: X_HEAD - 2, y: -ARCH_Y + 3, w: 4, d: 7, r: 0.5 }, BEAM_Z - 7, 7, 2, 0.3),
  arm: box({ x: X_HEAD - 5, y: -ARCH_Y - 5, w: 10, d: ARM_Y1 + ARCH_Y + 5, r: 2.5 }, BEAM_Z, 6, 6, 0.6),
  armScrews: [-ARCH_Y, -ARCH_Y + 6].map((y) => at([X_HEAD, y, BEAM_Z + 6])),
  armRule: lineOnTop([X_HEAD - 2.6, -ARCH_Y + 10], [X_HEAD - 2.6, -6], BEAM_Z + 6, P),
  collar: cyl(X_HEAD, 0, 6.2, BEAM_Z - 2.2, 2.2, 36),
  housing: cyl(X_HEAD, 0, 4.8, READER_Z, BEAM_Z - 2.2 - READER_Z, 32),
  housingSeams: join([READER_Z + 3.4, READER_Z + 7].map((z) => sideArc(X_HEAD, 0, 4.8, z, P, 20))),
  lens: cyl(X_HEAD, 0, 3, READER_Z - 2.4, 2.4, 28),
};

// ── Trampa, bandeja de abajo y entrada ──────────────────────────────────
const W = WALL;
export const BIN_ART = {
  floor: box(BIN, 0, 1.2, 4),
  back: box({ x: BIN.x, y: BIN.y, w: BIN.w, d: W, r: 0.5 }, 0, BIN_H, 2, 0.3),
  left: box({ x: BIN.x, y: BIN.y, w: W, d: BIN.d, r: 0.5 }, 0, BIN_H, 2, 0.3),
  right: box({ x: BIN.x + BIN.w - W, y: BIN.y, w: W, d: BIN.d, r: 0.5 }, 0, BIN_H, 2, 0.3),
  front: box({ x: BIN.x, y: BIN.y + BIN.d - W, w: BIN.w, d: W, r: 0.5 }, 0, BIN_H, 2, 0.3),
  floorGrid: join([BIN.x + 8, BIN.x + 14, BIN.x + 20].map((x) => lineOnTop([x, BIN.y + W], [x, BIN.y + BIN.d - W], 1.2, P))),
};

const HINGE_Z = BT - 1;
const HINGE_POST = (y: number): Plan => ({ x: FLAP_HINGE - 2, y: y - 1.4, w: 4, d: 2.8, r: 0.6 });
const HINGE_YS = [BIN.y + 2.8, BIN.y + BIN.d - 2.8];
export const HINGE_ART = {
  backPost: box(HINGE_POST(HINGE_YS[0]!), BIN_H, HINGE_Z - BIN_H + 1.6, 2, 0.3),
  frontPost: box(HINGE_POST(HINGE_YS[1]!), BIN_H, HINGE_Z - BIN_H + 1.6, 2, 0.3),
  axle: roundBar("y", HINGE_YS[0]! + 1.4, HINGE_YS[1]! - 1.4, [FLAP_HINGE, HINGE_Z], 1.1, 16),
  knuckles: [-7, 7].map((y) => roundBar("y", y - 2.4, y + 2.4, [FLAP_HINGE, HINGE_Z], 1.7, 18)),
};

/** La trampa, girada hacia abajo `open` (0–1) alrededor de su bisagra. */
export function flapFrame(open: number): SolidPaths {
  const t = open * 72 * RAD;
  const u: Point3 = [Math.cos(t), 0, Math.sin(t)];
  const w: Point3 = [-Math.sin(t), 0, Math.cos(t)];
  const len = FLAP.w;
  // Centro: desde la bisagra, media trampa hacia atrás por u y medio grosor hacia abajo.
  const cx = FLAP_HINGE - (len / 2) * u[0] - 1 * w[0];
  const cz = HINGE_Z - (len / 2) * u[2] - 1 * w[2] + 0.4;
  return orientedBox([cx, 0, cz], [u, [0, 1, 0], w], [len / 2, FLAP.d / 2, 1]);
}

/** Bandeja de entrada de la estación (de la bisagra a la boca o al podio). */
function inlet(to: number) {
  const plan: Plan = { x: FLAP_HINGE + 1.6, y: -11, w: to - FLAP_HINGE - 1.6, d: 22, r: 0.6 };
  return {
    tray: box(plan, BT - 2, 2, 2, 0.3),
    backLip: box({ x: plan.x, y: -12.4, w: plan.w, d: 1.4, r: 0.4 }, BT, 2.2, 2, 0.2),
    frontLip: box({ x: plan.x, y: 11, w: plan.w, d: 1.4, r: 0.4 }, BT, 2.2, 2, 0.2),
    rule: join([0.3, 0.6].map((s) => lineOnTop([plan.x + plan.w * s, -11], [plan.x + plan.w * s, 11], BT, P))),
  };
}

// ── Contador (el acumulador) ────────────────────────────────────────────
const C = COUNTER;
const C_FACE = C.y + C.d;
const C_END = C.x + C.w;
const LABEL = { x0: C.x + 4, x1: C.x + 15, z0: 9, z1: 18 };
/** Matriz del plano de la cara de enfrente del contador: (u, v) → (u, C_FACE, −v). */
export const COUNTER_FACE = sideMatrix([0, C_FACE], 0, P, "left");
const KNOB_Z = 13;
function knurlX(x0: number, x1: number, r: number, count: number) {
  const lines: string[] = [];
  for (let i = 0; i < count; i++) {
    const t = (i / count) * Math.PI * 2;
    const n: Point3 = [0, Math.cos(t), Math.sin(t)];
    if (dot(n, VIEW) < 0.12) continue;
    lines.push(seg([x0, r * Math.cos(t), KNOB_Z + r * Math.sin(t)], [x1, r * Math.cos(t), KNOB_Z + r * Math.sin(t)]));
  }
  return join(lines);
}
export const COUNTER_ART = {
  flange: box(insetPlan(C, -2), 0, 2, 4, 0.4),
  flangeScrews: [
    [C.x - 0.6, C.y + 2],
    [C_END + 0.6, C.y + 2],
    [C.x + 2, C_FACE + 1.2],
    [C_END - 2, C_FACE + 1.2],
  ].map(([x, y]) => at([x!, y!, 2])),
  body: box(C, 2, BT - 2, 4, 0.8),
  seam: sideSeam(C, 21.5, P, 4),
  deck: planOutline(insetPlan(C, 2.4), BT, P, 4),
  deckScrews: [
    [C.x + 4.4, C.y + 4.4],
    [C_END - 4.4, C.y + 4.4],
    [C.x + 4.4, C_FACE - 4.4],
    [C_END - 4.4, C_FACE - 4.4],
  ].map(([x, y]) => at([x!, y!, BT])),
  mouth: planOutline(MOUTH, BT, P, 4),
  mouthBack: pathOf([at([MOUTH.x + 1, MOUTH.y, BT]), at([MOUTH.x + MOUTH.w - 1, MOUTH.y, BT]), at([MOUTH.x + MOUTH.w - 1, MOUTH.y, BT - 5]), at([MOUTH.x + 1, MOUTH.y, BT - 5])], true),
  mouthSide: pathOf([at([MOUTH.x, MOUTH.y + 1, BT]), at([MOUTH.x, MOUTH.y + MOUTH.d - 1, BT]), at([MOUTH.x, MOUTH.y + MOUTH.d - 1, BT - 5]), at([MOUTH.x, MOUTH.y + 1, BT - 5])], true),
  mouthRim: planOutline(insetPlan(MOUTH, -1.6), BT, P, 4),
  /** Ventana: marco en la cara, y su piso y pared izquierda (el hueco tiene fondo). */
  bezel: faceRect(C_FACE, WINDOW.u0 - 1.6, WINDOW.u1 + 1.6, WINDOW.z0 - 1.6, WINDOW.z1 + 1.6),
  window: faceRect(C_FACE, WINDOW.u0, WINDOW.u1, WINDOW.z0, WINDOW.z1),
  sill: pathOf([at([WINDOW.u0, C_FACE, WINDOW.z0]), at([WINDOW.u1, C_FACE, WINDOW.z0]), at([WINDOW.u1, C_FACE - 1.5, WINDOW.z0]), at([WINDOW.u0, C_FACE - 1.5, WINDOW.z0])], true),
  jamb: pathOf([at([WINDOW.u0, C_FACE, WINDOW.z0]), at([WINDOW.u0, C_FACE - 1.5, WINDOW.z0]), at([WINDOW.u0, C_FACE - 1.5, WINDOW.z1]), at([WINDOW.u0, C_FACE, WINDOW.z1])], true),
  bezelScrews: [at([WINDOW.u0 - 3.2, C_FACE, WINDOW.z1 + 1]), at([WINDOW.u1 + 3.2, C_FACE, WINDOW.z1 + 1]), at([WINDOW.u0 - 3.2, C_FACE, WINDOW.z0 - 1]), at([WINDOW.u1 + 3.2, C_FACE, WINDOW.z0 - 1])],
  label: faceRect(C_FACE, LABEL.x0, LABEL.x1, LABEL.z0, LABEL.z1),
  labelRule: join([0, 1, 2].map((row) => seg([LABEL.x0 + 2, C_FACE, LABEL.z1 - 2.4 - row * 2], [LABEL.x0 + (row === 1 ? 7 : 9), C_FACE, LABEL.z1 - 2.4 - row * 2]))),
  labelRivets: [at([LABEL.x0 + 1.2, C_FACE, LABEL.z0 + 1.2]), at([LABEL.x1 - 1.2, C_FACE, LABEL.z0 + 1.2])],
  boss: roundBar("x", C_END, C_END + 1.4, [0, KNOB_Z], 5.4, 32),
  knob: roundBar("x", C_END + 1.4, C_END + 6, [0, KNOB_Z], 4.2, 32),
  knobKnurl: knurlX(C_END + 1.8, C_END + 5.6, 4.2, 30),
  knobMark: seg([C_END + 6, 0, KNOB_Z], [C_END + 6, 0, KNOB_Z + 3.2]),
  endPlate: endRect(C_END, C.y + 4, C.y + 9, 4, 22),
  endRule: join([0, 1].map((i) => seg([C_END, C.y + 5.4 + i * 2.2, 6], [C_END, C.y + 5.4 + i * 2.2, 20]))),
};

/** Tambores: posición de cada uno en el plano de la cara (u a lo largo de x, v = −z). */
export const DRUM_W = (WINDOW.u1 - WINDOW.u0) / 3;
export const DRUM_FACE = {
  u0: WINDOW.u0,
  v0: -WINDOW.z1,
  w: WINDOW.u1 - WINDOW.u0,
  h: WINDOW.z1 - WINDOW.z0,
};

// ── Podio (el mejor hasta ahora) ────────────────────────────────────────
const PX = PEDESTAL_X;
export const PEDESTAL_ART = {
  plinth: box({ x: PX - 12, y: -12, w: 24, d: 24, r: 3 }, 0, 4, 4, 0.6),
  plinthScrews: [
    [PX - 9, -9],
    [PX + 9, -9],
    [PX - 9, 9],
    [PX + 9, 9],
  ].map(([x, y]) => at([x!, y!, 4])),
  column: cyl(PX, 0, 6, 4, 16, 40),
  columnRings: join([9, 15].map((z) => sideArc(PX, 0, 6, z, P, 20))),
  capital: box({ x: PX - 10, y: -10, w: 20, d: 20, r: 2.5 }, 20, 4, 4, 0.6),
  seat: box({ x: PX - 9, y: -9, w: 18, d: 18, r: 2.5 }, 24, BT - 24, 4, 0.3),
  seatRing: planOutline({ x: PX - 7.4, y: -7.4, w: 14.8, d: 14.8, r: 1.8 }, BT, P, 4),
};

export const TRAY_ART = {
  floor: box(TRAY, 0, 1.2, 4),
  back: box({ x: TRAY.x, y: TRAY.y, w: TRAY.w, d: W, r: 0.5 }, 0, TRAY_H, 2, 0.3),
  left: box({ x: TRAY.x, y: TRAY.y, w: W, d: TRAY.d, r: 0.5 }, 0, TRAY_H, 2, 0.3),
  right: box({ x: TRAY.x + TRAY.w - W, y: TRAY.y, w: W, d: TRAY.d, r: 0.5 }, 0, TRAY_H, 2, 0.3),
  front: box({ x: TRAY.x, y: TRAY.y + TRAY.d - W, w: TRAY.w, d: W, r: 0.5 }, 0, TRAY_H, 2, 0.3),
  floorGrid: join([TRAY.x + 12, TRAY.x + 24].map((x) => lineOnTop([x, TRAY.y + W], [x, TRAY.y + TRAY.d - W], 1.2, P))),
};

// ── Prensa de sello y bandeja de salida (FizzBuzz) ──────────────────────
// Prensa de cuello de cisne: columna atrás y brazo por encima del yunque.
const PRESS_Y = 23;
const PRESS_TOP = 54;
const PPOST = (y: number): Plan => ({ x: PRESS_X - 3.5, y: y - 3.5, w: 7, d: 7, r: 1 });
const PFOOT = (y: number): Plan => ({ x: PRESS_X - 7, y: y - 5, w: 14, d: 10, r: 1.5 });
const ANVIL: Plan = { x: 45, y: -11, w: EXIT_X - 45 - 4, d: 22, r: 2 };
const DIE_Z = BT + TOKEN_H + 0.5 + 6.6;
export const PRESS_ART = {
  pillar: box({ x: 48, y: -8, w: 16, d: 16, r: 2 }, 0, BT - 4, 4, 0.5),
  pillarSeam: sideSeam({ x: 48, y: -8, w: 16, d: 16, r: 2 }, 6, P, 4),
  anvil: box(ANVIL, BT - 4, 4, 4, 0.6),
  anvilRing: planOutline({ x: PRESS_X - 9, y: -9, w: 18, d: 18, r: 2 }, BT, P, 4),
  backFoot: box(PFOOT(-PRESS_Y), 0, 1.5, 3),
  feetScrews: [at([PRESS_X - 5, -PRESS_Y, 1.5]), at([PRESS_X + 5, -PRESS_Y, 1.5])],
  backPost: box(PPOST(-PRESS_Y), 1.5, PRESS_TOP - 1.5, 3, 0.4),
  postSeam: sideSeam(PPOST(-PRESS_Y), 10, P, 3),
  gusset: box({ x: PRESS_X - 2, y: -PRESS_Y + 3.5, w: 4, d: 7, r: 0.5 }, PRESS_TOP - 7, 7, 2, 0.3),
  arm: box({ x: PRESS_X - 6, y: -PRESS_Y - 5, w: 12, d: PRESS_Y + 5 + 9, r: 3 }, PRESS_TOP, 7, 6, 0.6),
  armScrews: [-PRESS_Y, -PRESS_Y + 6].map((y) => at([PRESS_X, y, PRESS_TOP + 7])),
  cylinder: cyl(PRESS_X, 0, 5.6, PRESS_TOP + 7, 8, 36),
  cylinderSeam: sideArc(PRESS_X, 0, 5.6, PRESS_TOP + 11, P, 20),
  cylinderCap: cyl(PRESS_X, 0, 6.2, PRESS_TOP + 15, 2, 36),
  capBolts: [0, 1, 2, 3].map((i) => {
    const t = Math.PI / 4 + (i * Math.PI) / 2;
    return at([PRESS_X + 4.6 * Math.cos(t), 4.6 * Math.sin(t), PRESS_TOP + 17]);
  }),
  port: roundBar("y", 5.4, 8.6, [PRESS_X, PRESS_TOP + 11.5], 1.3, 14),
  /** Lo que baja: vástago (su parte de arriba se esconde en el brazo), collar y troquel. */
  rod: cyl(PRESS_X, 0, 1.8, DIE_Z + 6.4, PRESS_TOP + 9 - DIE_Z - 6.4, 20),
  collar: cyl(PRESS_X, 0, 3.4, DIE_Z + 4.4, 2, 24),
  die: cyl(PRESS_X, 0, 6.4, DIE_Z, 4.4, 36),
  dieRing: sideArc(PRESS_X, 0, 6.4, DIE_Z + 1.6, P, 20),
};

const POCKET = (j: number): Plan => {
  const cx = RACK.x + 1 + RACK_PITCH / 2 + (j % RACK_COLS) * RACK_PITCH;
  const cy = RACK.y + 1 + RACK_PITCH / 2 + Math.floor(j / RACK_COLS) * RACK_PITCH;
  return { x: cx - 8.4, y: cy - 8.4, w: 16.8, d: 16.8, r: 3.6 };
};
export const RACK_ART = {
  board: box(RACK, 0, RACK_H, 4, 0.6),
  pockets: join(Array.from({ length: RACK_COLS * RACK_ROWS }, (_, j) => planOutline(POCKET(j), RACK_H, P, 4))),
  /** La primera casilla: por aquí empieza la lista que devuelves. */
  first: planOutline(insetPlan(POCKET(0), 1.4), RACK_H, P, 4),
  feet: [
    [RACK.x + 6, RACK.y + 6],
    [RACK.x + RACK.w - 6, RACK.y + RACK.d - 6],
  ],
};

// ── Tapa (cuando el mecanismo está tapado) ──────────────────────────────
export interface HoodArt {
  body: SolidPaths;
  skirt: string;
  seam: string;
  vents: string;
  screws: Flat[];
  handlePosts: SolidPaths[];
  handleBar: SolidPaths;
  /** Portatarjeta del pedido (marco y tarjeta) en la cara de enfrente. */
  holder: string;
  card: string;
  /** Plano de la tarjeta, para escribir el pedido en él. */
  cardFace: string;
  cardAt: Flat;
  hasp: SolidPaths;
  shackle: string;
  slot: string;
}

function hoodOf(plan: Plan, height: number, cardX: number | null, slot: boolean): HoodArt {
  const face = plan.y + plan.d;
  const end = plan.x + plan.w;
  const ventX0 = plan.x + 8;
  const vents = join(Array.from({ length: 5 }, (_, i) => faceSlot(face, ventX0 + i * 5, height - 20, height - 8, 2.4)));
  const cx = plan.x + plan.w / 2;
  const cardW = 26;
  const card = cardX ?? 0;
  return {
    body: box(plan, 0, height, 4, 1),
    skirt: sideSeam(plan, 4, P, 4),
    seam: sideSeam(plan, height - 5, P, 4),
    vents,
    screws: [
      at([plan.x + 3, face, height - 2.6]),
      at([end - 3, face, height - 2.6]),
      at([plan.x + 3, face, 2]),
      at([end - 3, face, 2]),
    ],
    handlePosts: [-6, 6].map((dx) => box({ x: cx + dx - 1.4, y: -1.4, w: 2.8, d: 2.8, r: 0.6 }, height, 4, 2)),
    handleBar: box({ x: cx - 8.4, y: -1.6, w: 16.8, d: 3.2, r: 1.4 }, height + 4, 2, 3, 0.3),
    holder: cardX === null ? "" : faceRect(face, card - 1.8, card + cardW + 1.8, 9, 29),
    card: cardX === null ? "" : faceRect(face, card, card + cardW, 11, 27),
    cardFace: sideMatrix([0, face], 0, P, "left"),
    cardAt: [card + cardW / 2, 19],
    hasp: box({ x: end, y: -3, w: 1.8, d: 6, r: 0.6 }, height - 16, 8, 2, 0.2),
    shackle: pathOf(
      Array.from({ length: 11 }, (_, i) => {
        const t = (i / 10) * Math.PI;
        return at([end + 1.8, 2.2 * Math.cos(t), height - 8 + 2.6 * Math.sin(t)]);
      }),
    ),
    slot: slot ? endRect(end, -10, 10, BT - 0.5, BT + 6) : "",
  };
}

/** La tapa cubre la estación entera; termina antes del borde de su banco. */
export const HOOD_COUNTER = hoodOf({ x: 38, y: -24, w: BASE_END.sum - 4 - 38, d: 48, r: 4 }, 40, 100, false);
export const HOOD_BEST = hoodOf({ x: 38, y: -24, w: BASE_END.best - 4 - 38, d: 48, r: 4 }, 40, 100, false);
export const HOOD_PRESS = hoodOf({ x: 36, y: -30, w: 34, d: 46, r: 3 }, 74, null, true);

// ── Fichas ──────────────────────────────────────────────────────────────
export const TOKEN_ART = {
  solid: box(TOKEN, 0, TOKEN_H, 6, 0.6),
  groove: planOutline(insetPlan(TOKEN, 1.5), TOKEN_H, P, 6),
  face: topMatrix([0, 0], TOKEN_H, P, "x"),
};

export const INLET_COUNTER = inlet(C.x);
export const INLET_PEDESTAL = inlet(PX - 10);

/** Tamaño de letra que cabe en la cara de una ficha. */
export const tokenFont = (text: string) => Math.min(7.2, 13 / (0.62 * Math.max(1, text.length)));
