// Disposición en el mundo de la máquina "ventana": un banco con una hilera de
// zócalos (un día o un número por zócalo), un riel detrás cuya cara superior es
// la línea del cero, y un carro con torre, cabezal de sondas, tope y carátula.
// Unidades ≈ 1 px; x a lo largo del riel, y hacia el frente, z arriba.

import { boxCorners, fitProjection, iso, type Flat, type Plan, type Point3, type Projection } from "../../iso/iso-kit";
import { examplesOf, type Example, type MachineId } from "./model";

export const WIDTH = 600;
export const HEIGHT = 325;
const AZIMUTH = 60;

export interface Spec {
  id: MachineId;
  /** Zócalos del banco: el ejemplo más largo del ejercicio. */
  stations: number;
  pitch: number;
  /** Altura de la línea del cero (la cara de arriba del riel). */
  zero: number;
  /** Lo más alto que sube una barra sobre el cero. */
  up: number;
  /** Lo más hondo que baja bajo el cero (solo la ventana tiene negativos). */
  down: number;
  /** Unidades de la carátula por vuelta. */
  span: number;
  /** El carro lleva el tope del mínimo (solo la ganancia). */
  tope: boolean;
}

export const SOCKET_H = 3;
export const UNIT_MOST = 7;

export interface View {
  spec: Spec;
  P: Projection;
  examples: Example[];
  /** Escala de cada ejemplo: unidades de mundo por unidad de valor. */
  units: number[];
  kMax: number;
  col: number;
  xs: number[];
  home: number;
  railY: number;
  armZ: number;
  towerTop: number;
  travel: number;
  dialY: number;
  dialR: number;
  bench: Plan;
  scaleX: number;
  scaleTop: number;
  at: (point: Point3) => Flat;
  /** El z de la cima de una barra con este valor. */
  topOf: (value: number, unit: number) => number;
}

/** Unidades de mundo por unidad de valor: la barra más alta llega a `up`, la más honda a `down`. */
export function unitFor({ up, down }: Pick<Spec, "up" | "down">, values: number[]) {
  const top = Math.max(0, ...values);
  const bottom = Math.min(0, ...values);
  return Math.min(UNIT_MOST, top > 0 ? up / top : UNIT_MOST, bottom < 0 ? (down > 0 ? down / -bottom : 0) : UNIT_MOST);
}

function specOf(id: MachineId, examples: Example[]): Spec {
  const stations = Math.max(...examples.map((e) => e.values.length));
  return id === "c-ganancia"
    ? { id, stations, pitch: 26, zero: 10, up: 42, down: 0, span: 10, tope: true }
    : { id, stations, pitch: 22, zero: 17, up: 52, down: 10, span: 30, tope: false };
}

export function viewOf(id: MachineId): View {
  const examples = examplesOf(id);
  const spec = specOf(id, examples);
  const { stations, pitch, zero, up, down } = spec;
  const col = Math.round(pitch * 0.5);
  const kMax = Math.max(...examples.map((e) => e.k));
  const units = examples.map((e) => unitFor(spec, e.values));
  const xs = Array.from({ length: stations }, (_, j) => (j - (stations - 1) / 2) * pitch);
  // Casa: a la izquierda, con lugar para el cabezal más ancho sin pisar el zócalo 0.
  const home = xs[0]! - ((kMax * pitch) / 2 + col / 2 + 9);
  const railY = -(col / 2 + 19);
  const armZ = zero + up + 16;
  const towerTop = armZ + 9;
  const dialR = 15;
  const dialY = railY - 6;
  const frameHalf = (kMax * pitch) / 2;
  const bench: Plan = {
    x: home - frameHalf - 4,
    y: railY - 14,
    w: xs.at(-1)! + 44 - (home - frameHalf - 4),
    d: col / 2 + 18 - (railY - 14),
    r: 8,
  };
  const scaleX = xs.at(-1)! + pitch / 2 + 15;
  const scaleTop = zero + up + 4;
  const extremes: Point3[] = [
    ...boxCorners(bench, -14, 0),
    ...boxCorners({ x: home - frameHalf, y: dialY - dialR, w: 1, d: col + 10 - (dialY - dialR), r: 0 }, 0, towerTop + 6),
    ...boxCorners({ x: xs.at(-1)! - frameHalf, y: dialY - dialR, w: frameHalf * 2, d: dialR * 2, r: 0 }, towerTop, towerTop + 6),
    [scaleX, 0, scaleTop + 3],
  ];
  const P = fitProjection(extremes, WIDTH, HEIGHT, { pad: 10, azimuth: AZIMUTH });
  return {
    spec,
    P,
    examples,
    units,
    kMax,
    col,
    xs,
    home,
    railY,
    armZ,
    towerTop,
    travel: armZ - 9,
    dialY,
    dialR,
    bench,
    scaleX,
    scaleTop,
    at: (point) => iso(point, P),
    topOf: (value, unit) => zero + value * unit,
  };
}
