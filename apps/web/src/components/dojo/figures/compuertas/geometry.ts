// Geometría estática de la clasificadora, calculada una vez por layout (número
// de ramas). Solo se reconstruyen por cuadro las trampillas (giran); la ficha y
// las hojas se mueven con un translate.

import {
  circleRing,
  extrude,
  insetPlan,
  onTop,
  pathOf,
  planOutline,
  segment,
  sideMatrix,
  slabOf,
  topTicks,
  type Flat,
  type Plan,
  type Point3,
  type SolidPaths,
} from "../../iso/iso-kit";
import { circle, hingedBox, prismX, prismY } from "./solid";
import {
  AZIMUTH,
  BASE_H,
  BIN_BACK,
  BIN_BACK_H,
  BIN_FLOOR_TOP,
  BIN_FRONT,
  BIN_FRONT_H,
  BIN_HALF,
  BIN_WALL,
  BLADE_H,
  BLADE_W,
  BLADE_X,
  CHANNEL,
  CHUTE_TOP,
  CHUTE_X,
  COIN_T,
  DOOR_HALF,
  DOOR_T,
  FLOOR_TOP,
  FLOOR_Z,
  FOOT_H,
  LIP_IN,
  LIP_TOP,
  PANEL_TOP,
  PANEL_Y0,
  PANEL_Y1,
  PITCH,
  PORTAL_TOP,
  R,
  SIGN_Z0,
  SIGN_Z1,
  type Layout,
} from "./view";

const join = (paths: string[]) => paths.filter(Boolean).join("");

/** Medida de la placa de cada compuerta: lámpara + texto más largo que va a mostrar. */
export const SIGN_FONT = 6;
const MONO = 0.6;
/** Lo más largo que cabe en una placa (el resto se corta con «…»). */
export const SIGN_CHARS = 19;
/** Letra de una placa: 6 hasta que el texto no cabe en el paso; luego baja hasta 4,6. */
export const signFont = (chars: number) => Math.min(SIGN_FONT, Math.max(4.6, (PITCH - 6 - 14) / (Math.max(1, chars) * MONO)));
/** Ancho de una placa: lámpara a la izquierda, texto y un margen. */
export const signWidth = (chars: number) => 14 + chars * signFont(chars) * MONO;

export interface SignArt {
  cx: number;
  plate: SolidPaths;
  /** Tapa ciega (problema sin resolver): la placa con la condición, tapada. */
  cover: SolidPaths;
  coverScrews: Flat[];
  screws: Flat[];
  lamp: SolidPaths;
  lampRing: string;
  /** Transform del texto en el plano de la placa. */
  text: string;
  /** Tamaño de letra del texto (más chica si la condición es larga). */
  font: number;
}

export interface GateArt {
  backPost: SolidPaths;
  frontPost: SolidPaths;
  lintel: SolidPaths;
  knob: SolidPaths;
  knurl: string;
  blade: SolidPaths;
  bladeGrip: SolidPaths;
  /** Pernos de las bisagras de las trampillas (sobre el labio delantero). */
  hinges: Flat[];
}

export interface BinArt {
  floor: SolidPaths;
  back: SolidPaths;
  backSeam: string;
  left: SolidPaths;
  right: SolidPaths;
  front: SolidPaths;
  holder: SolidPaths;
  holderLine: string;
  rivets: Flat[];
  /** Marco punteado del frente entero: "aquí debía caer" (modo en vivo). */
  want: string;
  /** Transform de la tarjeta (texto) en el frente. */
  card: string;
}

export interface MachineArt {
  base: {
    halo: string;
    feet: SolidPaths[][];
    slab: SolidPaths;
    groove: string;
    screws: Flat[];
    screwRings: string;
    ruler: SolidPaths;
    ticksMinor: string;
    ticksMajor: string;
    plate: SolidPaths;
    plateLine: string;
    plateRule: string;
    plateScrews: Flat[];
  };
  panel: {
    slab: SolidPaths;
    seam: string;
    stiles: SolidPaths[];
    stileScrews: Flat[];
    cap: SolidPaths;
    shoes: SolidPaths[];
    shoeScrews: Flat[];
  };
  arms: { arm: SolidPaths; gusset: SolidPaths; screws: Flat[] }[];
  signs: SignArt[];
  chute: {
    standoffs: SolidPaths[];
    back: SolidPaths;
    backLine: string;
    left: SolidPaths;
    right: SolidPaths;
    bars: SolidPaths[];
    cap: SolidPaths;
    slot: string;
    capScrews: Flat[];
    stop: SolidPaths;
  };
  track: {
    backLip: SolidPaths;
    floors: SolidPaths[];
    frontLip: SolidPaths;
    lipScrews: Flat[];
    endFace: string;
  };
  gates: GateArt[];
  bins: BinArt[];
  hood: {
    box: SolidPaths;
    seams: string;
    rivets: Flat[];
    hasp: SolidPaths;
    lock: SolidPaths;
    shackle: string;
    keyhole: string;
  };
  coin: {
    body: SolidPaths;
    rim: string;
    /** Transform del plano de la cara (relativo al centro de la ficha). */
    face: string;
  };
}

const cache = new Map<string, MachineArt>();

/** `chars[i]` = largo del texto más largo que va a mostrar la placa i (para medirla). */
export function machineArt(L: Layout, chars: number[]): MachineArt {
  const key = `${L.bins}:${chars.join(",")}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const { P, at, binX, edgeX } = L;
  const slab = (plan: Plan, z: number, h: number, steps = 4, bevel = 0) => slabOf(plan, z, h, P, steps, bevel);
  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, r = 0.6, bevel = 0) =>
    slab({ x: x0, y: y0, w: x1 - x0, d: y1 - y0, r }, z0, z1 - z0, 3, bevel);
  const cylinder = (cx: number, cy: number, r: number, z: number, h: number, steps = 28) =>
    extrude(circleRing(cx, cy, r, steps), z, h, P, { convex: true });
  const ring = (cx: number, cy: number, r: number, z: number, steps = 24) => onTop(circleRing(cx, cy, r, steps), z, P, true);
  const knurlOf = (cx: number, cy: number, r: number, z0: number, z1: number, count: number) => {
    const lines: string[] = [];
    const a = (AZIMUTH * Math.PI) / 180;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const nx = Math.cos(angle);
      const ny = Math.sin(angle);
      if (nx * Math.cos(a) + ny * Math.sin(a) < 0.2) continue;
      lines.push(segment([cx + r * nx, cy + r * ny, z0 + 0.4], [cx + r * nx, cy + r * ny, z1 - 0.4], P));
    }
    return join(lines);
  };

  // ---------------------------------------------------------------- base
  const BASE: Plan = { x: L.baseX0, y: PANEL_Y0 - 5, w: L.baseX1 - L.baseX0, d: BIN_FRONT + 9 - (PANEL_Y0 - 5), r: 6 };
  const feetAt: [number, number][] = [
    [BASE.x + 16, BASE.y + 10],
    [BASE.x + BASE.w - 16, BASE.y + 10],
    [BASE.x + 16, BASE.y + BASE.d - 10],
    [BASE.x + BASE.w - 16, BASE.y + BASE.d - 10],
  ];
  // Tornillos al frente (los de atrás quedan bajo el tablero).
  const screwsAt: [number, number][] = [
    [BASE.x + 6.5, BASE.y + BASE.d - 6.5],
    [BASE.x + BASE.w - 6.5, BASE.y + BASE.d - 6.5],
  ];
  // Regla al frente: un tick mayor en el centro de cada cajón (paso 70 = 14 ticks de 5).
  const RULER: Plan = { x: binX[0] - BIN_HALF, y: BIN_FRONT + 2.5, w: binX[L.bins - 1] - binX[0] + 2 * BIN_HALF, d: 4.5, r: 0.8 };
  const ticks = topTicks(RULER.x + 0.01, RULER.x + RULER.w, 5, PITCH / 5, RULER.y, 0.6, [1.4, 2.8], P);
  const PLATE: Plan = { x: L.baseX0 + 10, y: BIN_FRONT + 1.5, w: 40, d: 6.5, r: 1 };
  const base = {
    halo: slab(BASE, -BASE_H - FOOT_H, BASE_H + FOOT_H).fill,
    feet: feetAt.map(([x, y]) => [cylinder(x, y, 6, -BASE_H - FOOT_H, 1.4), cylinder(x, y, 4.6, -BASE_H - FOOT_H + 1.4, FOOT_H - 1.4)]),
    slab: slab(BASE, -BASE_H, BASE_H, 6, 1.4),
    groove: planOutline(insetPlan(BASE, 3.5), 0, P),
    screws: screwsAt.map(([x, y]) => at([x, y, 0])),
    screwRings: join(screwsAt.map(([x, y]) => ring(x, y, 1.9, 0, 16))),
    ruler: slab(RULER, 0, 0.6, 3),
    ticksMinor: ticks.minor,
    ticksMajor: ticks.major,
    plate: slab(PLATE, 0, 0.7, 3),
    plateLine: planOutline(insetPlan(PLATE, 1.2), 0.7, P),
    plateRule: join(
      [0, 1].map((row) => onTop([[PLATE.x + 6, PLATE.y + 2.6 + row * 1.6], [PLATE.x + (row ? 24 : 32), PLATE.y + 2.6 + row * 1.6]], 0.7, P)),
    ),
    plateScrews: [at([PLATE.x + 2.8, PLATE.y + PLATE.d / 2, 0.7]), at([PLATE.x + PLATE.w - 2.8, PLATE.y + PLATE.d / 2, 0.7])],
  };

  // --------------------------------------------------------------- tablero
  const panelPlan: Plan = { x: L.panelX0, y: PANEL_Y0, w: L.panelX1 - L.panelX0, d: PANEL_Y1 - PANEL_Y0, r: 0.8 };
  const face = PANEL_Y1;
  const panel = {
    slab: slab(panelPlan, 0, PANEL_TOP, 3, 0.8),
    // Tablas del tablero: juntas de canto a canto, entre los dos montantes.
    seam: join([33, 66].map((z) => segment([L.panelX0 + 6, face, z], [L.panelX1 - 6, face, z], P))),
    stiles: [L.panelX0, L.panelX1 - 6].map((x) => box(x, x + 6, PANEL_Y1, PANEL_Y1 + 1.6, 0, PANEL_TOP, 0.3)),
    stileScrews: [L.panelX0 + 3, L.panelX1 - 3].flatMap((x) => [12, 50, 88, PANEL_TOP - 8].map((z) => at([x, PANEL_Y1 + 1.6, z]))),
    cap: box(L.panelX0 - 1.5, L.panelX1 + 1.5, PANEL_Y0 - 1.5, PANEL_Y1 + 1.5, PANEL_TOP, PANEL_TOP + 4, 1, 0.6),

    shoes: [L.panelX0 + 6, L.panelX1 - 20].map((x) => box(x, x + 14, PANEL_Y1, PANEL_Y1 + 4, 0, 5, 0.5)),
    shoeScrews: [L.panelX0 + 6, L.panelX1 - 20].flatMap((x) => [at([x + 3.5, PANEL_Y1 + 2, 5]), at([x + 10.5, PANEL_Y1 + 2, 5])]),
  };

  // ------------------------------------------------- brazos que sostienen el canal
  const armXs = [CHUTE_X - 6, ...binX.slice(0, -1).map((x) => x + PITCH / 2), binX[0] - PITCH / 2];
  const arms = armXs
    .sort((a, b) => a - b)
    .map((x) => ({
      arm: box(x - 3, x + 3, PANEL_Y1, CHANNEL, FLOOR_Z - 6, FLOOR_Z, 0.5, 0.4),
      gusset: prismX(
        P,
        [
          [PANEL_Y1, FLOOR_Z - 6],
          [PANEL_Y1 + 13, FLOOR_Z - 6],
          [PANEL_Y1, FLOOR_Z - 22],
        ],
        x - 1,
        x + 1,
      ),
      screws: [at([x - 1.5, CHANNEL - 1.5, FLOOR_Z]), at([x + 1.5, CHANNEL - 1.5, FLOOR_Z])],
    }));

  // ---------------------------------------------------------------- placas
  const signCenters = binX.map((x, i) => (i < L.gates ? x + BLADE_X + BLADE_W / 2 : x - 6));
  const signs: SignArt[] = signCenters.map((cx, i) => {
    const chars_ = Math.min(SIGN_CHARS, chars[i]);
    const font = signFont(chars_);
    const signWide = signWidth(chars_);
    const x0 = cx - signWide / 2;
    const plan: Plan = { x: x0, y: face, w: signWide, d: 1, r: 0.6 };
    const zMid = (SIGN_Z0 + SIGN_Z1) / 2;
    const lampX = x0 + 5.6;
    return {
      cx,
      plate: slab(plan, SIGN_Z0, SIGN_Z1 - SIGN_Z0, 3),
      cover: slab({ ...plan, x: x0 - 0.6, w: signWide + 1.2, d: 2.2 }, SIGN_Z0 - 0.6, SIGN_Z1 - SIGN_Z0 + 1.2, 3, 0.4),
      coverScrews: [
        [x0 + 2.4, SIGN_Z0 + 2.4],
        [x0 + signWide - 2.4, SIGN_Z0 + 2.4],
        [x0 + 2.4, SIGN_Z1 - 2.4],
        [x0 + signWide - 2.4, SIGN_Z1 - 2.4],
      ].map(([x, z]) => at([x, face + 2.2, z])),
      screws: [at([x0 + signWide - 2.4, face + 1, zMid])],
      lamp: prismY(P, circle(lampX, zMid, 2.7, 24), face + 1, face + 2.6, { caps: [1] }),
      lampRing: pathOf(
        circle(lampX, zMid, 3.6, 28).map(([x, z]) => at([x, face + 1, z])),
        true,
      ),
      text: `${sideMatrix([lampX + 5, face + 1], zMid - font * 0.34, P, "left")}`,
      font,
    };
  });

  // ----------------------------------------------------------------- tubo
  const cx = CHUTE_X;
  const chute = {
    standoffs: [72, 104].map((z) => box(cx - 4, cx + 4, PANEL_Y1, -9, z, z + 6, 0.5, 0.4)),
    back: box(cx - R - 3.5, cx + R + 3.5, -9, -6.5, FLOOR_Z, CHUTE_TOP, 0.6, 0.4),
    backLine: segment([cx - R - 3.5, -6.5, 96], [cx + R + 3.5, -6.5, 96], P),
    left: box(cx - R - 3.5, cx - R - 0.4, -6.5, CHANNEL, LIP_TOP, CHUTE_TOP, 0.5),
    right: box(cx + R + 0.4, cx + R + 3.5, -6.5, CHANNEL, FLOOR_TOP + 2 * R + 3, CHUTE_TOP, 0.5),
    bars: [-1, 1].map((side) => box(cx + side * 9.5 - 1, cx + side * 9.5 + 1, LIP_IN + 0.5, CHANNEL, LIP_TOP, CHUTE_TOP, 0.3)),
    cap: box(cx - R - 5, cx + R + 5, -10, CHANNEL + 2, CHUTE_TOP, CHUTE_TOP + 4, 1, 0.6),
    slot: planOutline({ x: cx - R + 1, y: -2.6, w: 2 * R - 2, d: 5.2, r: 2.4 }, CHUTE_TOP + 4, P),
    capScrews: [at([cx - R - 2.5, 1, CHUTE_TOP + 4]), at([cx + R + 2.5, 1, CHUTE_TOP + 4])],
    stop: box(cx - R - 3.5, cx - R - 0.4, -CHANNEL, CHANNEL, FLOOR_TOP, LIP_TOP, 0.3),
  };

  // ----------------------------------------------------------------- canal
  const start = cx - R - 6;
  const floorRuns: [number, number][] = [];
  let from = start;
  for (let g = 0; g < L.gates; g++) {
    floorRuns.push([from, binX[g] - DOOR_HALF]);
    from = binX[g] + DOOR_HALF;
  }
  floorRuns.push([from, edgeX]);
  const track = {
    backLip: box(start, edgeX, -CHANNEL, -LIP_IN, FLOOR_TOP, LIP_TOP, 0.4),
    floors: floorRuns.map(([a, b]) => box(a, b, -CHANNEL, CHANNEL, FLOOR_Z, FLOOR_TOP, 0.6, 0.4)),
    frontLip: box(start, edgeX, LIP_IN, CHANNEL, FLOOR_TOP, LIP_TOP, 0.4),
    lipScrews: armXs.filter((x) => x > start && x < edgeX).map((x) => at([x, (LIP_IN + CHANNEL) / 2, LIP_TOP])),
    endFace: "",
  };

  // -------------------------------------------------------------- compuertas
  const gates: GateArt[] = binX.slice(0, L.gates).map((x) => {
    const b0 = x + BLADE_X;
    const b1 = b0 + BLADE_W;
    const mid = (b0 + b1) / 2;
    return {
      backPost: box(b0 - 0.6, b1 + 0.6, -CHANNEL, -LIP_IN, LIP_TOP, PORTAL_TOP, 0.3),
      frontPost: box(b0 - 0.6, b1 + 0.6, LIP_IN, CHANNEL, LIP_TOP, PORTAL_TOP, 0.3),
      lintel: box(b0 - 2, b1 + 2, -CHANNEL - 1.5, CHANNEL + 1.5, PORTAL_TOP, PORTAL_TOP + 4, 0.6, 0.4),
      knob: cylinder(mid, 0, 3, PORTAL_TOP + 4, 3.2),
      knurl: knurlOf(mid, 0, 3, PORTAL_TOP + 4, PORTAL_TOP + 7.2, 22),
      blade: box(b0, b1, -LIP_IN, LIP_IN, FLOOR_TOP + 0.5, FLOOR_TOP + 0.5 + BLADE_H, 0.2),
      bladeGrip: box(b1, b1 + 1.4, -1.6, 1.6, FLOOR_TOP + BLADE_H - 7, FLOOR_TOP + BLADE_H - 2, 0.3),
      hinges: [at([x - DOOR_HALF, CHANNEL, FLOOR_TOP - DOOR_T / 2]), at([x + DOOR_HALF, CHANNEL, FLOOR_TOP - DOOR_T / 2])],
    };
  });

  // ---------------------------------------------------------------- cajones
  const frontTop = BIN_FLOOR_TOP + BIN_FRONT_H;
  const bins: BinArt[] = binX.map((x) => {
    const wall: [number, number][] = [
      [BIN_BACK, BIN_FLOOR_TOP],
      [BIN_FRONT, BIN_FLOOR_TOP],
      [BIN_FRONT, frontTop],
      [BIN_BACK, BIN_BACK_H],
    ];
    const holder: Plan = { x: x - 22, y: BIN_FRONT, w: 44, d: 0.8, r: 0.4 };
    return {
      floor: box(x - BIN_HALF, x + BIN_HALF, BIN_BACK, BIN_FRONT, 0, BIN_FLOOR_TOP, 1.2, 0.4),
      back: box(x - BIN_HALF, x + BIN_HALF, BIN_BACK, BIN_BACK + BIN_WALL, BIN_FLOOR_TOP, BIN_BACK_H, 0.4),
      backSeam: segment([x - BIN_HALF + BIN_WALL, BIN_BACK + BIN_WALL, BIN_BACK_H - 3], [x + BIN_HALF - BIN_WALL, BIN_BACK + BIN_WALL, BIN_BACK_H - 3], P),
      left: prismX(P, wall, x - BIN_HALF, x - BIN_HALF + BIN_WALL),
      right: prismX(P, wall, x + BIN_HALF - BIN_WALL, x + BIN_HALF),
      front: box(x - BIN_HALF + BIN_WALL, x + BIN_HALF - BIN_WALL, BIN_FRONT - BIN_WALL, BIN_FRONT, BIN_FLOOR_TOP, frontTop, 0.3),
      holder: slab(holder, BIN_FLOOR_TOP + 1.6, BIN_FRONT_H - 3.2, 3),
      holderLine: pathOf(
        [
          [x - 20.6, BIN_FLOOR_TOP + 3],
          [x + 20.6, BIN_FLOOR_TOP + 3],
          [x + 20.6, frontTop - 3],
          [x - 20.6, frontTop - 3],
        ].map(([px, pz]) => at([px, BIN_FRONT + 0.8, pz])),
        true,
      ),
      rivets: [
        [x - 25.5, BIN_FLOOR_TOP + 3],
        [x + 25.5, BIN_FLOOR_TOP + 3],
        [x - 25.5, frontTop - 3],
        [x + 25.5, frontTop - 3],
      ].map(([px, pz]) => at([px, BIN_FRONT, pz])),
      want: pathOf(
        [
          [x - BIN_HALF + 0.8, 0.4],
          [x + BIN_HALF - 0.8, 0.4],
          [x + BIN_HALF - 0.8, frontTop + 1.2],
          [x - BIN_HALF + 0.8, frontTop + 1.2],
        ].map(([px, pz]) => at([px, BIN_FRONT + 0.2, pz])),
        true,
      ),
      card: sideMatrix([x, BIN_FRONT + 0.8], (BIN_FLOOR_TOP + frontTop) / 2 - 2.2, P, "left"),
    };
  });

  // -------------------------------------------------- capota (problema sin resolver)
  const hx0 = binX[0] - DOOR_HALF - 4;
  const hx1 = edgeX + 2;
  const hood = PORTAL_TOP + 9;
  const lockX = (hx0 + hx1) / 2;
  const seamXs = binX.slice(0, -1).map((x) => x + PITCH / 2).filter((x) => x > hx0 + 4 && x < hx1 - 4);
  const hoodFront = CHANNEL + 3;
  const hoodLift = (p: Point3): Flat => at(p);
  const hoodArt = {
    box: box(hx0, hx1, -CHANNEL - 3, hoodFront, FLOOR_Z - 1, hood, 2, 0.8),
    seams: join(seamXs.map((x) => segment([x, hoodFront, FLOOR_Z - 1], [x, hoodFront, hood], P))),
    rivets: [
      ...[hx0 + 4, ...seamXs.flatMap((x) => [x - 3, x + 3]), hx1 - 4].map((x) => hoodLift([x, hoodFront, FLOOR_Z + 3])),
      ...[hx0 + 4, ...seamXs.flatMap((x) => [x - 3, x + 3]), hx1 - 4].map((x) => hoodLift([x, hoodFront, hood - 4])),
    ],
    hasp: box(lockX - 6, lockX + 6, hoodFront, hoodFront + 0.8, 80, 96, 0.6),
    lock: box(lockX - 4.5, lockX + 4.5, hoodFront + 0.8, hoodFront + 3.6, 70, 80, 1.2, 0.4),
    shackle: pathOf(
      [
        [lockX - 2.6, 80],
        [lockX - 2.6, 85],
        [lockX - 1.8, 86.8],
        [lockX, 87.5],
        [lockX + 1.8, 86.8],
        [lockX + 2.6, 85],
        [lockX + 2.6, 80],
      ].map(([px, pz]) => at([px, hoodFront + 2.2, pz])),
    ),
    keyhole: pathOf(
      [
        [lockX, 76.6],
        [lockX, 73.4],
      ].map(([px, pz]) => at([px, hoodFront + 3.6, pz])),
    ),
  };

  // ----------------------------------------------------------------- ficha
  const coin = {
    body: prismY(P, circle(0, 0, R, 40), -COIN_T / 2, COIN_T / 2, { caps: [1] }),
    rim: pathOf(
      circle(0, 0, R - 1.7, 40).map(([x, z]) => at([x, COIN_T / 2, z])),
      true,
    ),
    face: sideMatrix([0, COIN_T / 2], 0, P, "left"),
  };

  const art: MachineArt = { base, panel, arms, signs, chute, track, gates, bins, hood: hoodArt, coin };
  cache.set(key, art);
  return art;
}

/** Las dos hojas de la trampilla de la compuerta `x` abiertas un ángulo (0 → cerrada). */
export function doorsAt(L: Layout, x: number, open: number): [SolidPaths, SolidPaths] {
  const angle = (open * Math.PI) / 2;
  const hz = FLOOR_TOP - DOOR_T;
  return [
    hingedBox(L.P, [x - DOOR_HALF, hz], DOOR_HALF, DOOR_T, -LIP_IN, LIP_IN, angle),
    hingedBox(L.P, [x + DOOR_HALF, hz], -DOOR_HALF, DOOR_T, -LIP_IN, LIP_IN, angle),
  ];
}
