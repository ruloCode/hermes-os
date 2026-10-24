// Geometría de la máquina "ventana": todo lo que no cambia se calcula una vez al
// cargar el módulo (por máquina); lo que se mueve se construye en su posición de
// reposo (carro en x = 0, tope y almohadillas en z = 0) y se traslada. Solo las
// barras, las varillas de las sondas y las agujas se rehacen por cuadro.

import {
  circleRing,
  extrude,
  insetPlan,
  lineOnTop,
  onTop,
  pathOf,
  planOutline,
  radialTicks,
  ring,
  sideArc,
  sideSeam,
  slabOf,
  topMatrix,
  knurl,
  type Flat,
  type Plan,
  type Plane,
  type Point3,
  type SolidPaths,
} from "../../iso/iso-kit";
import { SOCKET_H, viewOf, type View } from "./view";
import type { MachineId } from "./model";

const join = (paths: string[]) => paths.filter(Boolean).join("");

export interface RingArt {
  back: SolidPaths[];
  front: SolidPaths[];
}

export interface HeadArt {
  k: number;
  offsets: number[];
  back: SolidPaths;
  left: SolidPaths;
  right: SolidPaths;
  front: SolidPaths;
  spine: SolidPaths;
  housings: SolidPaths[];
  housingSeams: string;
  screws: Flat[];
}

export interface Machine {
  id: MachineId;
  view: View;
  bench: {
    halo: string;
    feet: SolidPaths[][];
    slab: SolidPaths;
    groove: string;
    screws: Flat[];
    screwRings: string;
    plate: SolidPaths;
    plateLine: string;
    plateRule: string;
    plateScrews: Flat[];
    strip: SolidPaths;
    stripMinor: string;
    stripMajor: string;
  };
  rail: {
    feet: SolidPaths[];
    footScrews: Flat[];
    posts: SolidPaths[];
    body: SolidPaths;
    seam: string;
    minor: string;
    major: string;
    stops: SolidPaths[];
    stopScrews: Flat[];
  };
  sockets: { slab: SolidPaths; hole: string; holeEdge: string; screws: Flat[] }[];
  /** Contornos punteados del mejor bloque en la cubierta, por ejemplo (ventana). */
  blocks: (string | null)[];
  scale: {
    foot: SolidPaths;
    post: SolidPaths;
    cap: SolidPaths;
    capLine: string;
    ticks: { minor: string; major: string; zero: string }[];
  };
  car: {
    skirtBack: SolidPaths;
    saddle: SolidPaths;
    saddleScrews: Flat[];
    skirtFront: SolidPaths;
    skirtScrews: Flat[];
    knob: SolidPaths;
    knobKnurl: string;
    tower: SolidPaths;
    towerSlot: string;
    arm: SolidPaths;
    armLine: string;
    armScrews: Flat[];
    lockPin: SolidPaths;
    lockHead: SolidPaths;
    lockRing: string;
  };
  dial: {
    neck: SolidPaths;
    puck: SolidPaths;
    band: string;
    knurl: string;
    bezel: string;
    face: string;
    minor: string;
    major: string;
    zero: string;
    hub: string;
    crown: SolidPaths;
    crownCap: SolidPaths;
    label: string;
    labelText: string;
  };
  tope: {
    slider: SolidPaths;
    sliderScrews: Flat[];
    knob: SolidPaths;
    knobKnurl: string;
    arm: SolidPaths;
    armScrews: Flat[];
    ring: RingArt;
  };
  collar: RingArt;
  heads: Record<number, HeadArt>;
  pad: SolidPaths;
  padRing: string;
}

/** Un rectángulo dibujado en una cara vertical de normal ±y (ranuras, ventanas). */
function slotOnY(x0: number, x1: number, y: number, z0: number, z1: number, at: View["at"]) {
  const r = Math.min((x1 - x0) / 2, (z1 - z0) / 2);
  const points: Flat[] = [];
  const arc = (cx: number, cz: number, from: number) => {
    for (let s = 0; s <= 6; s++) {
      const a = from + (s / 6) * Math.PI;
      points.push(at([cx + r * Math.cos(a), y, cz + r * Math.sin(a)]));
    }
  };
  arc((x0 + x1) / 2, z1 - r, 0);
  arc((x0 + x1) / 2, z0 + r, Math.PI);
  return pathOf(points, true);
}

function ringArt(view: View, inner: number, outer: number, h: number): RingArt {
  const { P } = view;
  const t = outer - inner;
  const r = 0.6;
  const solid = (plan: Plan) => slabOf(plan, -h, h, P, 3, 0.4);
  return {
    back: [solid({ x: -outer, y: -outer, w: outer * 2, d: t, r }), solid({ x: -outer, y: -inner, w: t, d: inner * 2, r: 0.3 })],
    front: [solid({ x: inner, y: -inner, w: t, d: inner * 2, r: 0.3 }), solid({ x: -outer, y: inner, w: outer * 2, d: t, r })],
  };
}

function headArt(view: View, k: number): HeadArt {
  const { P, col, armZ, spec } = view;
  const fx = (k * spec.pitch) / 2 - 2;
  const fy = col / 2 + 5;
  const bar = 2.5;
  const h = 3;
  const solid = (plan: Plan, z = armZ, height = h) => slabOf(plan, z, height, P, 3, 0.5);
  const offsets = Array.from({ length: k }, (_, s) => (s - (k - 1) / 2) * spec.pitch);
  return {
    k,
    offsets,
    back: solid({ x: -fx, y: -fy, w: fx * 2, d: bar, r: 1 }),
    left: solid({ x: -fx, y: -fy + bar, w: bar, d: fy * 2 - bar * 2, r: 0.3 }),
    right: solid({ x: fx - bar, y: -fy + bar, w: bar, d: fy * 2 - bar * 2, r: 0.3 }),
    front: solid({ x: -fx, y: fy - bar, w: fx * 2, d: bar, r: 1 }),
    spine: solid({ x: -fx + bar, y: -1.7, w: fx * 2 - bar * 2, d: 3.4, r: 0.6 }, armZ + 0.4, h - 0.4),
    housings: offsets.map((ox) => extrude(circleRing(ox, 0, 2.7, 28), armZ - 6, 6.4, P)),
    housingSeams: join(offsets.flatMap((ox) => [sideArc(ox, 0, 2.7, armZ - 4.2, P, 16), sideArc(ox, 0, 2.7, armZ - 2.4, P, 16)])),
    screws: [
      [-fx + bar / 2, -fy + bar / 2],
      [fx - bar / 2, -fy + bar / 2],
      [-fx + bar / 2, fy - bar / 2],
      [fx - bar / 2, fy - bar / 2],
    ].map(([x, y]) => view.at([x!, y!, armZ + h])),
  };
}

function build(id: MachineId): Machine {
  const view = viewOf(id);
  const { P, at, xs, col, railY, armZ, towerTop, dialY, dialR, bench, spec, scaleX, scaleTop } = view;
  const { zero, pitch } = spec;
  const solid = (plan: Plan, z: number, h: number, steps = 4, bevel = 0) => slabOf(plan, z, h, P, steps, bevel);
  const cyl = (cx: number, cy: number, r: number, z: number, h: number, steps = 24) => extrude(circleRing(cx, cy, r, steps), z, h, P);

  // ── Banco ──
  const feetAt: Plane[] = [
    [bench.x + 16, bench.y + 12],
    [bench.x + bench.w - 16, bench.y + 12],
    [bench.x + 16, bench.y + bench.d - 12],
    [bench.x + bench.w - 16, bench.y + bench.d - 12],
  ];
  const benchScrews: Plane[] = [
    [bench.x + 7, bench.y + 7],
    [bench.x + bench.w - 7, bench.y + 7],
    [bench.x + 7, bench.y + bench.d - 7],
    [bench.x + bench.w - 7, bench.y + bench.d - 7],
  ];
  const plate: Plan = { x: bench.x + 12, y: col / 2 + 6.5, w: 44, d: 8.5, r: 1.5 };
  const strip: Plan = { x: xs[0]! - pitch / 2, y: col / 2 + 6, w: xs.at(-1)! - xs[0]! + pitch, d: 6, r: 1 };
  const stripMinor: string[] = [];
  const stripMajor: string[] = [];
  for (let t = 0; t <= (xs.length - 1) * 4 + 2; t++) {
    const x = strip.x + t * (pitch / 4);
    if (x > strip.x + strip.w - 0.5) break;
    if (x < strip.x + 0.5) continue;
    const big = (t - 2) % 4 === 0;
    (big ? stripMajor : stripMinor).push(lineOnTop([x, strip.y + 0.6], [x, strip.y + (big ? 3.6 : 2)], 0.7, P));
  }
  const benchArt: Machine["bench"] = {
    halo: solid(bench, -14, 14).fill,
    feet: feetAt
      .slice()
      .sort((a, b) => a[0] * 0.5 + a[1] * 0.866 - (b[0] * 0.5 + b[1] * 0.866))
      .map(([x, y]) => [cyl(x, y, 6.5, -14, 1.6, 28), cyl(x, y, 5, -12.4, 3.4, 28)]),
    slab: solid(bench, -9, 9, 8, 1.4),
    groove: planOutline(insetPlan(bench, 4.5), 0, P),
    screws: benchScrews.map(([x, y]) => at([x, y, 0])),
    screwRings: join(benchScrews.map(([x, y]) => ring(x, y, 2.1, 0, P, 16))),
    plate: solid(plate, 0, 0.8, 4),
    plateLine: planOutline(insetPlan(plate, 1.5), 0.8, P),
    plateRule: join([0, 1, 2].map((row) => onTop([[plate.x + 7, plate.y + 2.6 + row * 1.7], [plate.x + (row === 1 ? 26 : 34), plate.y + 2.6 + row * 1.7]], 0.8, P))),
    plateScrews: [at([plate.x + 3.2, plate.y + plate.d / 2, 0.8]), at([plate.x + plate.w - 3.2, plate.y + plate.d / 2, 0.8])],
    strip: solid(strip, 0, 0.7, 3),
    stripMinor: join(stripMinor),
    stripMajor: join(stripMajor),
  };

  // ── Riel (su cara de arriba es la línea del cero) ──
  const railPlan: Plan = { x: bench.x + 4, y: railY - 3.5, w: xs.at(-1)! + pitch / 2 + 6 - (bench.x + 4), d: 7, r: 1.4 };
  const railFace = railY + 3.5;
  const postXs: number[] = [];
  for (let x = railPlan.x + 9; x < railPlan.x + railPlan.w - 6; x += pitch * 2.5) postXs.push(x);
  postXs.push(railPlan.x + railPlan.w - 7);
  const postH = zero - 4;
  const railMinor: string[] = [];
  const railMajor: string[] = [];
  for (let t = 0; t <= (xs.length - 1) * 2; t++) {
    const x = xs[0]! + t * (pitch / 2);
    const big = t % 2 === 0;
    (big ? railMajor : railMinor).push(pathOf([at([x, railFace, zero]), at([x, railFace, zero - (big ? 2.6 : 1.4)])]));
  }
  const stopPlans: Plan[] = [
    { x: railPlan.x + 1, y: railY - 4.5, w: 3.2, d: 9, r: 0.8 },
    { x: railPlan.x + railPlan.w - 4.2, y: railY - 4.5, w: 3.2, d: 9, r: 0.8 },
  ];
  const railArt: Machine["rail"] = {
    feet: postXs.map((x) => solid({ x: x - 5.5, y: railY - 5.5, w: 11, d: 11, r: 1.5 }, 0, 1.2, 3)),
    footScrews: postXs.flatMap((x) => [at([x - 4, railY + 4, 1.2]), at([x + 4, railY - 4, 1.2])]),
    posts: postXs.map((x) => solid({ x: x - 3, y: railY - 3, w: 6, d: 6, r: 0.8 }, 1.2, postH - 1.2, 3)),
    body: solid(railPlan, zero - 4, 4, 4, 0.6),
    seam: sideSeam(railPlan, zero - 1.4, P, 4),
    minor: join(railMinor),
    major: join(railMajor),
    stops: stopPlans.map((plan) => solid(plan, zero, 3, 3, 0.4)),
    stopScrews: stopPlans.map((plan) => at([plan.x + plan.w / 2, railY, zero + 3])),
  };

  // ── Zócalos ──
  const sh = col / 2 + 2.5;
  const sockets = xs.map((x) => {
    const holePlan: Plan = { x: x - col / 2 - 0.3, y: -col / 2 - 0.3, w: col + 0.6, d: col + 0.6, r: 1.4 };
    return {
      slab: solid({ x: x - sh, y: -sh, w: sh * 2, d: sh * 2, r: 1.8 }, 0, SOCKET_H, 4, 0.5),
      hole: planOutline(holePlan, SOCKET_H, P, 4),
      holeEdge: planOutline(holePlan, SOCKET_H, P, 4),
      screws: [at([x - sh + 1.6, sh - 1.6, SOCKET_H]), at([x + sh - 1.6, -sh + 1.6, SOCKET_H])],
    };
  });

  const blocks = view.examples.map((ex) => {
    if (id !== "c-ventana") return null;
    let sum = ex.values.slice(0, ex.k).reduce((a, b) => a + b, 0);
    let best = sum;
    let start = 0;
    for (let i = ex.k; i < ex.values.length; i++) {
      sum += ex.values[i]! - ex.values[i - ex.k]!;
      if (sum > best) {
        best = sum;
        start = i - ex.k + 1;
      }
    }
    const x0 = xs[start]! - pitch / 2 + 1.2;
    const x1 = xs[start + ex.k - 1]! + pitch / 2 - 1.2;
    return planOutline({ x: x0, y: -sh - 2.4, w: x1 - x0, d: (sh + 2.4) * 2, r: 2 }, 0, P, 4);
  });

  // ── Patrón de medida (la regla vertical, a la derecha) ──
  const face = 3.5;
  const scaleTicks = view.units.map((u) => {
    const minor: string[] = [];
    const major: string[] = [];
    let zeroTick = "";
    const vFrom = Math.ceil((SOCKET_H + 1.5 - zero) / u);
    const vTo = Math.floor((scaleTop - 1.5 - zero) / u);
    for (let v = vFrom; v <= vTo; v++) {
      const z = zero + v * u;
      const x0 = scaleX - 3.5;
      if (v === 0) {
        zeroTick = pathOf([at([x0, face, z]), at([x0 + 7, face, z]), at([x0 + 7, -3.5, z])]);
        continue;
      }
      const big = v % 5 === 0;
      (big ? major : minor).push(pathOf([at([x0, face, z]), at([x0 + (big ? 3.6 : 2), face, z])]));
    }
    return { minor: join(minor), major: join(major), zero: zeroTick };
  });
  const capPlan: Plan = { x: scaleX - 4.5, y: -4.5, w: 9, d: 9, r: 1.4 };
  const scale: Machine["scale"] = {
    foot: solid({ x: scaleX - 6.5, y: -6.5, w: 13, d: 13, r: 2 }, 0, 1.5, 4, 0.4),
    post: solid({ x: scaleX - 3.5, y: -3.5, w: 7, d: 7, r: 0.6 }, 1.5, scaleTop - 1.5, 3),
    cap: solid(capPlan, scaleTop, 2, 3, 0.5),
    capLine: planOutline(insetPlan(capPlan, 1.6), scaleTop + 2, P, 3),
    ticks: scaleTicks,
  };

  // ── Carro (local: x = 0) ──
  const towerPlan: Plan = { x: -4.5, y: railY - 4, w: 9, d: 7.5, r: 1.2 };
  const towerFront = towerPlan.y + towerPlan.d;
  const fy = col / 2 + 5;
  const armPlan: Plan = { x: -3, y: towerFront - 0.5, w: 6, d: -fy - (towerFront - 0.5) + 0.6, r: 1 };
  const car: Machine["car"] = {
    skirtBack: solid({ x: -12, y: railY - 5.6, w: 24, d: 2.1, r: 0.6 }, zero - 3.2, 3.2, 2),
    saddle: solid({ x: -12, y: railY - 5.6, w: 24, d: 11.2, r: 1.6 }, zero, 3, 4, 0.6),
    saddleScrews: [
      [-9.4, railY - 3.2],
      [9.4, railY - 3.2],
      [-9.4, railY + 3.2],
      [9.4, railY + 3.2],
    ].map(([x, y]) => at([x!, y!, zero + 3])),
    skirtFront: solid({ x: -12, y: railY + 3.5, w: 24, d: 2.1, r: 0.6 }, zero - 3.2, 3.2, 2),
    skirtScrews: [at([-8, railY + 5.6, zero - 1.6]), at([8, railY + 5.6, zero - 1.6])],
    knob: cyl(8.6, railY + 2.4, 2.1, zero + 3, 2.6, 20),
    knobKnurl: knurl(8.6, railY + 2.4, 2.1, zero + 3, zero + 5.6, 18, P),
    tower: solid(towerPlan, zero + 3, towerTop - zero - 3, 3, 0.6),
    towerSlot: slotOnY(-1.1, 1.1, towerFront, zero + 7, armZ - 6, at),
    arm: solid(armPlan, armZ, 3.4, 3, 0.5),
    armLine: onTop([[0, towerFront + 2], [0, -fy - 1]], armZ + 3.4, P),
    armScrews: [at([0, towerFront + 1.2, armZ + 3.4]), at([0, -fy - 0.4, armZ + 3.4])],
    lockPin: cyl(-8.6, railY, 1.2, zero - 1, 9.5, 16),
    lockHead: cyl(-8.6, railY, 2.3, zero + 8.5, 1.8, 20),
    lockRing: ring(-8.6, railY, 1.2, zero + 10.3, P, 14),
  };

  // ── Carátula (cara arriba, sobre la torre) ──
  const top = towerTop + 5;
  const dialTicks = radialTicks(0, dialY, dialR - 2.6, spec.span, 5, top, [1.2, 2.6], P);
  const dial: Machine["dial"] = {
    neck: cyl(0, dialY, 4.2, towerTop, 1.2, 24),
    puck: cyl(0, dialY, dialR, towerTop + 1.2, 3.8, 64),
    band: sideArc(0, dialY, dialR, top - 1.6, P, 40),
    knurl: knurl(0, dialY, dialR, top - 1.6, top, 64, P),
    bezel: ring(0, dialY, dialR - 1.1, top, P, 64),
    face: ring(0, dialY, dialR - 2.6, top, P, 64),
    minor: dialTicks.minor,
    major: dialTicks.major,
    zero: lineOnTop([0, dialY - (dialR - 2.6)], [0, dialY - (dialR - 6.4)], top, P),
    hub: ring(0, dialY, 1.3, top + 0.2, P, 16),
    crown: solid({ x: dialR - 0.6, y: dialY - 2.2, w: 4, d: 4.4, r: 1 }, towerTop + 1.6, 3, 3),
    crownCap: solid({ x: dialR + 3.2, y: dialY - 3, w: 2.4, d: 6, r: 1.1 }, towerTop + 1, 4.2, 3),
    label: topMatrix([0, dialY + 6.4], top, P, "x"),
    labelText: id === "c-ganancia" ? "$" : "Σ",
  };

  // ── Tope del mínimo (local: su cara de arriba en z = 0) ──
  const ringIn = col / 2 + 1;
  const ringOut = col / 2 + 3.6;
  const tope: Machine["tope"] = {
    slider: solid({ x: -5.2, y: towerFront, w: 10.4, d: 3, r: 0.8 }, -2.6, 9, 3, 0.4),
    sliderScrews: [at([-3.4, towerFront + 3, 4.6]), at([3.4, towerFront + 3, 4.6])],
    knob: cyl(0, towerFront + 1.5, 1.9, 6.4, 2.6, 20),
    knobKnurl: knurl(0, towerFront + 1.5, 1.9, 6.4, 9, 16, P),
    arm: solid({ x: -1.7, y: towerFront + 3, w: 3.4, d: -ringOut - (towerFront + 3) + 0.4, r: 0.6 }, -2.6, 2.6, 2, 0.3),
    armScrews: [at([0, towerFront + 4.6, 0]), at([0, -ringOut - 1.4, 0])],
    ring: ringArt(view, ringIn, ringOut, 2.6),
  };

  const heads: Record<number, HeadArt> = {};
  for (const k of [1, ...view.examples.map((e) => e.k)]) if (!heads[k]) heads[k] = headArt(view, k);

  return {
    id,
    view,
    bench: benchArt,
    rail: railArt,
    sockets,
    blocks,
    scale,
    car,
    dial,
    tope,
    collar: ringArt(view, ringIn, ringOut - 0.6, 1.6),
    heads,
    pad: cyl(0, 0, 2.3, 0, 1.6, 24),
    padRing: ring(0, 0, 1.2, 1.6, P, 14),
  };
}

export const MACHINES: Record<MachineId, Machine> = {
  "c-ganancia": build("c-ganancia"),
  "c-ventana": build("c-ventana"),
};

// ── Lo que se rehace por cuadro ──

/** Una barra en tres tramos: tallo (bajo el cero), valor y, encima del corte, la parte encendida. */
export interface ColumnShape {
  stem: SolidPaths | null;
  value: SolidPaths | null;
  gain: SolidPaths | null;
  cap: string;
}

/** Alto del bloque de un valor que no sube: el 0 (una placa en el cero) y los negativos. */
export const CAP_H = 3;
const STEM_HALF = 2.6;

/**
 * Una barra: un tallo delgado desde el zócalo y, encima, el bloque del valor.
 * Positivo: el bloque va del cero a la cima (la altura sobre el riel ES el
 * valor). Cero: una placa con la cara de arriba en el cero. Negativo: un bloque
 * corto con la cima bajo el cero, en su tallo. Lo que queda sobre `cut` se
 * enciende (la ganancia de hoy, o la de la respuesta).
 */
export function columnShape(m: Machine, station: number, top: number, cut: number): ColumnShape {
  const { P, xs, col, spec } = m.view;
  const x = xs[station]!;
  const plan: Plan = { x: x - col / 2, y: -col / 2, w: col, d: col, r: 1.2 };
  const stemPlan: Plan = { x: x - STEM_HALF, y: -STEM_HALF, w: STEM_HALF * 2, d: STEM_HALF * 2, r: 0.8 };
  const z0 = SOCKET_H - 0.4;
  const zero = spec.zero;
  const seg = (on: Plan, a: number, b: number) => (b - a > 0.05 ? slabOf(on, a, b - a, P, 3, on === plan ? 0.5 : 0) : null);
  const base = top > zero + 0.05 ? zero : top - CAP_H;
  const split = Math.min(Math.max(cut, base), top);
  return {
    stem: seg(stemPlan, z0, base),
    value: seg(plan, base, split),
    gain: seg(plan, split, top),
    cap: planOutline(insetPlan(plan, 1.8), top, P, 3),
  };
}

/** La varilla de una sonda: del alojamiento hasta la almohadilla. */
export function rodOf(m: Machine, x: number, tip: number): SolidPaths {
  const { P, armZ } = m.view;
  const from = tip + 1.6;
  return extrude(circleRing(x, 0, 1.05, 14), from, Math.max(0.1, armZ - 6 - from), P);
}

/** Aguja de la carátula (local del carro). `value` en unidades del ejercicio. */
export function needleOf(m: Machine, value: number) {
  const { P, dialY, dialR, towerTop, spec } = m.view;
  const a = (value / spec.span) * Math.PI * 2;
  const sx = Math.sin(a);
  const sy = -Math.cos(a);
  const top = towerTop + 5 + 0.25;
  const tip: Plane = [sx * (dialR - 3.4), dialY + sy * (dialR - 3.4)];
  const tail: Plane = [-sx * 3.2, dialY - sy * 3.2];
  return lineOnTop(tail, tip, top, P);
}

/** Marca de arrastre (el mejor hasta ahora): una cuña junto al borde. */
export function dragOf(m: Machine, value: number) {
  const { P, dialY, dialR, towerTop, spec, at } = m.view;
  const a = (value / spec.span) * Math.PI * 2;
  const top = towerTop + 5 + 0.2;
  const point = (r: number, da: number): Point3 => [Math.sin(a + da) * r, dialY - Math.cos(a + da) * r, top];
  void P;
  return pathOf([at(point(dialR - 2.8, 0)), at(point(dialR - 7.6, 0.16)), at(point(dialR - 7.6, -0.16))], true);
}
