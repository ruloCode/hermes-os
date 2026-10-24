// Lo que cambia de forma en cada cuadro: el vástago del empujador (sale del
// cilindro), la varilla del ariete que asoma sobre la cabeza y los rayos del
// volante, que giran con la carrera. Todo con el kit y las medidas de view.ts.

import { circleRing, extrude, joinPaths, type SolidPaths } from "../../iso/iso-kit";
import {
  CYL_X1,
  CYL_Z,
  DIE_X,
  DROP_FROM,
  GLAND_TOP,
  MAG_X,
  P,
  PUSHER_HOME,
  PUSHER_LEN,
  RAIL_TOP,
  ROD_R,
  ROD_REST_TOP,
  STROKE,
  TRAY_FLOOR,
  TRAY_X,
  CHUTE,
  WHEEL,
  barrelX,
  onFaceX,
  shift,
} from "./view";
import type { Phase } from "./model";

const cyl = (r: number, z: number, h: number, steps = 24) => extrude(circleRing(0, 0, r, steps), z, h, P, { convex: true });

export interface Frame {
  inputs: string[];
  pusher: string;
  pushRod: SolidPaths;
  ram: string;
  pointer: string;
  rod: SolidPaths;
  rodCap: SolidPaths;
  spokes: string;
  knob: SolidPaths;
  output: string;
}

const LIP = CHUTE.x + CHUTE.w;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (v: number) => {
  const u = clamp01(v);
  return u * u * (3 - 2 * u);
};

/** Dónde está cada parte móvil, en unidades del mundo. */
export interface MachinePose {
  /** Centro de las fichas de entrada (x) y su apoyo (z). */
  tileX: number;
  tileZ: number;
  lanes: number[];
  /** Cara de empuje del bloque empujador (x). */
  pusherFront: number;
  /** Cuánto bajó el ariete (unidades) y fracción de la carrera (0..1, para el volante y la mirilla). */
  down: number;
  travel: number;
  /** Centro de la ficha de salida. */
  outX: number;
  outZ: number;
  sightRun: number;
}

/** Las piezas móviles para una pose cualquiera (la usan el guion y el modo en vivo). */
export function machineAt(m: MachinePose): Frame {
  const inputs = m.lanes.map((y) => shift([m.tileX, y, m.tileZ]));
  const pusher = shift([m.pusherFront, 0, 0]);
  const pushRod = barrelX(CYL_X1, m.pusherFront - PUSHER_LEN - 3, 0, CYL_Z, 1.7, 20);

  const ram = shift([0, 0, -m.down]);
  const pointer = shift([0, 0, -m.travel * m.sightRun]);
  const top = ROD_REST_TOP - m.down;
  const rod = cyl(ROD_R, GLAND_TOP, top - GLAND_TOP);
  const rodCap = cyl(ROD_R + 1.1, top, 2.4, 6);

  // El volante da una vuelta y cuarto por carrera completa.
  const turn = m.travel * Math.PI * 2.5;
  const fx = WHEEL.x + 5;
  const inner = WHEEL.r - 2.4;
  const spokes = joinPaths(
    [0, 1, 2].map((i) => {
      const a = turn + (i * Math.PI * 2) / 3;
      return onFaceX(fx, WHEEL.y, WHEEL.z, [2.6 * Math.cos(a), 2.6 * Math.sin(a)], [inner * Math.cos(a), inner * Math.sin(a)]);
    }),
  );
  const ka = turn + Math.PI / 3;
  const kr = WHEEL.r - 1.2;
  const knob = barrelX(fx, fx + 5, WHEEL.y + kr * Math.cos(ka), WHEEL.z + kr * Math.sin(ka), 1.3, 14);

  const output = shift([m.outX, 0, m.outZ]);
  return { inputs, pusher, pushRod, ram, pointer, rod, rodCap, spokes, knob, output };
}

/** Altura de la ficha de salida según dónde va: cae los 3 del canal a la bandeja al pasar el borde. */
export function outZAt(outX: number, outWidth: number) {
  const fall = smooth((outX - LIP) / (outWidth / 2 + 4));
  return RAIL_TOP - (RAIL_TOP - TRAY_FLOOR) * fall;
}

/**
 * Cuadro de la prensa para una fase del guion. `lanes` son las y de cada ficha
 * de entrada y `widest` el ancho de la más ancha (contra ella apoya el empujador).
 */
export function frameOf(phase: Phase, lanes: number[], widest: number, outWidth: number, sightRun: number): Frame {
  const tileX = MAG_X + phase.push * (DIE_X - MAG_X);
  const contact = MAG_X - widest / 2 + phase.pusher.push * (DIE_X - MAG_X);
  const outX = DIE_X + phase.eject * (TRAY_X - DIE_X);
  return machineAt({
    tileX,
    tileZ: DROP_FROM + (RAIL_TOP - DROP_FROM) * phase.drop,
    lanes,
    pusherFront: PUSHER_HOME + phase.pusher.reach * (contact - PUSHER_HOME),
    down: phase.stroke * STROKE,
    travel: phase.stroke,
    outX,
    outZ: outZAt(outX, outWidth),
    sightRun,
  });
}
