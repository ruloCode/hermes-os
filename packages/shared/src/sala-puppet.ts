/**
 * MARIONETA de la Sala de Agentes 3D: de los 33 `worldLandmarks` de MediaPipe
 * Pose a los puntos de una figura de esferas y huesos en la escena. Todo puro
 * (sin three.js, sin DOM): se prueba con landmarks sintéticos en el agente.
 *
 * Convención de MediaPipe (world landmarks): metros, origen en el punto medio
 * de las caderas, x hacia la DERECHA de la imagen, y hacia ABAJO (como una
 * imagen), z = profundidad con valores MENORES más cerca de la cámara.
 *
 * Convención de la sala: el avatar está de ESPALDAS a la cámara de three.js
 * mirando al arco de agentes (−z). Por eso el mapeo es la rotación de 180°
 * sobre z — (x, y, z) → (−x, −y, z) — y no un espejo: el brazo que levantas
 * a tu derecha sube en el lado derecho de la pantalla y apunta hacia los
 * agentes de ese lado. Es un movimiento rígido (sin reflejar), así que
 * ángulos y distancias del cuerpo se conservan para el rayo de señalar.
 *
 * Índices de MediaPipe Pose: 0 nariz · 1-6 ojos · 7/8 orejas · 9/10 boca ·
 * 11/12 hombros · 13/14 codos · 15/16 muñecas · 17-22 manos · 23/24 caderas ·
 * 25/26 rodillas · 27/28 tobillos · 29-32 pies. Impar = izquierda del
 * usuario, par = derecha.
 */

import { OneEuroFilter } from "./one-euro.js";

export interface PoseWorldLandmark {
  x: number;
  y: number;
  z: number;
  /** 0..1 — qué tan visible cree el modelo que está el punto. */
  visibility?: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const POSE = {
  NOSE: 0,
  LEFT_EAR: 7,
  RIGHT_EAR: 8,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_PINKY: 17,
  RIGHT_PINKY: 18,
  LEFT_INDEX: 19,
  RIGHT_INDEX: 20,
  LEFT_THUMB: 21,
  RIGHT_THUMB: 22,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
  LEFT_HEEL: 29,
  RIGHT_HEEL: 30,
  LEFT_FOOT: 31,
  RIGHT_FOOT: 32,
} as const;

export const POSE_LANDMARK_COUNT = 33;
/** Punto virtual: centro de la cabeza (media de las orejas, o la nariz). */
export const PUPPET_HEAD = 33;
export const PUPPET_POINT_COUNT = 34;

/** Huesos de la marioneta (pares de índices). Sin los puntos de la cara: la cabeza es UNA esfera. */
export const PUPPET_BONES: readonly [number, number][] = [
  // torso
  [POSE.LEFT_SHOULDER, POSE.RIGHT_SHOULDER],
  [POSE.LEFT_SHOULDER, POSE.LEFT_HIP],
  [POSE.RIGHT_SHOULDER, POSE.RIGHT_HIP],
  [POSE.LEFT_HIP, POSE.RIGHT_HIP],
  // brazos
  [POSE.LEFT_SHOULDER, POSE.LEFT_ELBOW],
  [POSE.LEFT_ELBOW, POSE.LEFT_WRIST],
  [POSE.RIGHT_SHOULDER, POSE.RIGHT_ELBOW],
  [POSE.RIGHT_ELBOW, POSE.RIGHT_WRIST],
  // manos
  [POSE.LEFT_WRIST, POSE.LEFT_INDEX],
  [POSE.LEFT_WRIST, POSE.LEFT_PINKY],
  [POSE.LEFT_WRIST, POSE.LEFT_THUMB],
  [POSE.LEFT_INDEX, POSE.LEFT_PINKY],
  [POSE.RIGHT_WRIST, POSE.RIGHT_INDEX],
  [POSE.RIGHT_WRIST, POSE.RIGHT_PINKY],
  [POSE.RIGHT_WRIST, POSE.RIGHT_THUMB],
  [POSE.RIGHT_INDEX, POSE.RIGHT_PINKY],
  // piernas
  [POSE.LEFT_HIP, POSE.LEFT_KNEE],
  [POSE.LEFT_KNEE, POSE.LEFT_ANKLE],
  [POSE.RIGHT_HIP, POSE.RIGHT_KNEE],
  [POSE.RIGHT_KNEE, POSE.RIGHT_ANKLE],
  [POSE.LEFT_ANKLE, POSE.LEFT_FOOT],
  [POSE.RIGHT_ANKLE, POSE.RIGHT_FOOT],
  // cuello: hombros → cabeza (índice virtual; el origen se calcula aparte)
  [POSE.LEFT_SHOULDER, PUPPET_HEAD],
  [POSE.RIGHT_SHOULDER, PUPPET_HEAD],
];

/** Puntos de la cara que NO se dibujan (la cabeza es una sola esfera). */
export function isFaceLandmark(i: number): boolean {
  return i >= 0 && i <= 10;
}

/** Radio de cada articulación (unidades de escena): cabeza grande, manos chicas. */
export function jointRadius(i: number): number {
  if (i === PUPPET_HEAD) return 0.11;
  if (i >= POSE.LEFT_PINKY && i <= POSE.RIGHT_THUMB) return 0.022;
  if (i >= POSE.LEFT_HEEL) return 0.025;
  if (i === POSE.LEFT_SHOULDER || i === POSE.RIGHT_SHOULDER || i === POSE.LEFT_HIP || i === POSE.RIGHT_HIP) return 0.05;
  return 0.038;
}

export interface PuppetOptions {
  /** Dónde está el avatar en la escena (punto en el piso). */
  origin?: Vec3;
  /** Altura de las caderas sobre el piso (m). Con cámara de escritorio no se ven los pies. */
  hipHeight?: number;
  /** Bajo esto, el punto se oculta (el modelo adivina lo que no ve). */
  minVisibility?: number;
}

export const PUPPET_DEFAULTS = { origin: { x: 0, y: 0, z: 1.0 }, hipHeight: 0.95, minVisibility: 0.5 };

/** Un world landmark → posición en la escena (rotación de 180° sobre z + traslado). */
export function worldToScene(lm: Vec3, opts: PuppetOptions = {}): Vec3 {
  const origin = opts.origin ?? PUPPET_DEFAULTS.origin;
  const hip = opts.hipHeight ?? PUPPET_DEFAULTS.hipHeight;
  return { x: origin.x - lm.x, y: origin.y + hip - lm.y, z: origin.z + lm.z };
}

export interface PuppetFrame {
  /** 34 puntos en escena (33 de MediaPipe + cabeza virtual). */
  points: Vec3[];
  /** 34 flags: dibujar o no (visibilidad del modelo; la cabeza exige una oreja o la nariz). */
  visible: boolean[];
}

/**
 * Landmarks crudos → frame de la marioneta (sin suavizar). El centro de la
 * cabeza es la media de las orejas visibles, o la nariz si no hay orejas.
 */
export function puppetFrame(world: PoseWorldLandmark[], opts: PuppetOptions = {}): PuppetFrame {
  const minVis = opts.minVisibility ?? PUPPET_DEFAULTS.minVisibility;
  const points: Vec3[] = new Array(PUPPET_POINT_COUNT);
  const visible: boolean[] = new Array(PUPPET_POINT_COUNT).fill(false);
  for (let i = 0; i < POSE_LANDMARK_COUNT; i++) {
    const lm = world[i];
    if (!lm) {
      points[i] = { x: 0, y: 0, z: 0 };
      continue;
    }
    points[i] = worldToScene(lm, opts);
    visible[i] = (lm.visibility ?? 1) >= minVis && !isFaceLandmark(i);
  }
  // Cabeza virtual.
  const ears = [POSE.LEFT_EAR, POSE.RIGHT_EAR].filter((i) => world[i] && (world[i].visibility ?? 1) >= minVis);
  if (ears.length) {
    const acc = { x: 0, y: 0, z: 0 };
    for (const i of ears) {
      acc.x += points[i].x;
      acc.y += points[i].y;
      acc.z += points[i].z;
    }
    points[PUPPET_HEAD] = { x: acc.x / ears.length, y: acc.y / ears.length, z: acc.z / ears.length };
    visible[PUPPET_HEAD] = true;
  } else if (world[POSE.NOSE] && (world[POSE.NOSE].visibility ?? 1) >= minVis) {
    // La nariz está al frente de la cabeza: el centro queda ~8 cm atrás (+z en escena = hacia atrás).
    const n = points[POSE.NOSE];
    points[PUPPET_HEAD] = { x: n.x, y: n.y, z: n.z + 0.08 };
    visible[PUPPET_HEAD] = true;
  } else {
    points[PUPPET_HEAD] = { x: 0, y: 0, z: 0 };
  }
  return { points, visible };
}

/**
 * Suavizado One Euro por coordenada (34 × 3 filtros). Los puntos que
 * desaparecen y vuelven reinician su filtro para no "volar" desde la última
 * posición conocida.
 */
export class PuppetSmoother {
  private readonly filters: OneEuroFilter[][] = [];
  private readonly wasVisible: boolean[] = new Array(PUPPET_POINT_COUNT).fill(false);

  // beta alto a propósito: aquí las velocidades van en m/s (un brazo que sube
  // recorre ~1 m en medio segundo) y con la beta del cursor (0.02) el filtro
  // tardaba ~300 ms en alcanzar el brazo extendido — latencia que se sumaba al
  // dwell. En reposo el corte sigue bajo (sin temblor).
  constructor(minCutoff = 1.5, beta = 0.6) {
    for (let i = 0; i < PUPPET_POINT_COUNT; i++) {
      this.filters.push([
        new OneEuroFilter(minCutoff, beta),
        new OneEuroFilter(minCutoff, beta),
        new OneEuroFilter(minCutoff, beta),
      ]);
    }
  }

  update(frame: PuppetFrame, tMs: number): PuppetFrame {
    const points: Vec3[] = new Array(PUPPET_POINT_COUNT);
    for (let i = 0; i < PUPPET_POINT_COUNT; i++) {
      const p = frame.points[i];
      const f = this.filters[i];
      if (!frame.visible[i]) {
        if (this.wasVisible[i]) f.forEach((k) => k.reset());
        this.wasVisible[i] = false;
        points[i] = p;
        continue;
      }
      this.wasVisible[i] = true;
      points[i] = { x: f[0].filter(p.x, tMs), y: f[1].filter(p.y, tMs), z: f[2].filter(p.z, tMs) };
    }
    return { points, visible: frame.visible };
  }

  reset(): void {
    for (const f of this.filters) f.forEach((k) => k.reset());
    this.wasVisible.fill(false);
  }
}

/** Frame vacío (sin cuerpo detectado): todo oculto. */
export function emptyPuppetFrame(): PuppetFrame {
  return {
    points: Array.from({ length: PUPPET_POINT_COUNT }, () => ({ x: 0, y: 0, z: 0 })),
    visible: new Array(PUPPET_POINT_COUNT).fill(false),
  };
}

/**
 * Cuerpo sintético de pie, brazos abajo, de frente a la cámara web (para
 * tests y para el seam de QA `window.__hermesSalaSim`). Coordenadas de
 * MediaPipe (y hacia abajo, origen en las caderas). `raise` levanta un brazo
 * apuntando al frente-arriba.
 */
export function syntheticBody(opts: { raise?: "left" | "right" | null; aimX?: number; aimY?: number } = {}): PoseWorldLandmark[] {
  const lm: PoseWorldLandmark[] = Array.from({ length: POSE_LANDMARK_COUNT }, () => ({ x: 0, y: 0, z: 0, visibility: 0.99 }));
  const set = (i: number, x: number, y: number, z: number, v = 0.99) => {
    lm[i] = { x, y, z, visibility: v };
  };
  // Cabeza (y negativo = arriba)
  set(POSE.NOSE, 0, -0.62, -0.08);
  set(POSE.LEFT_EAR, 0.08, -0.6, 0.0);
  set(POSE.RIGHT_EAR, -0.08, -0.6, 0.0);
  for (let i = 1; i <= 6; i++) set(i, (i % 2 ? 0.03 : -0.03), -0.63, -0.05);
  set(9, 0.02, -0.56, -0.06);
  set(10, -0.02, -0.56, -0.06);
  // Hombros / caderas (izquierda del usuario = x positivo en la imagen)
  set(POSE.LEFT_SHOULDER, 0.19, -0.45, 0);
  set(POSE.RIGHT_SHOULDER, -0.19, -0.45, 0);
  set(POSE.LEFT_HIP, 0.1, 0, 0);
  set(POSE.RIGHT_HIP, -0.1, 0, 0);
  // Brazos abajo
  set(POSE.LEFT_ELBOW, 0.24, -0.18, 0.02);
  set(POSE.LEFT_WRIST, 0.26, 0.08, 0.04);
  set(POSE.RIGHT_ELBOW, -0.24, -0.18, 0.02);
  set(POSE.RIGHT_WRIST, -0.26, 0.08, 0.04);
  // Manos
  for (const [w, k] of [
    [POSE.LEFT_WRIST, [POSE.LEFT_PINKY, POSE.LEFT_INDEX, POSE.LEFT_THUMB]],
    [POSE.RIGHT_WRIST, [POSE.RIGHT_PINKY, POSE.RIGHT_INDEX, POSE.RIGHT_THUMB]],
  ] as const) {
    const wr = lm[w];
    k.forEach((idx, j) => set(idx, wr.x + (j - 1) * 0.02, wr.y + 0.07, wr.z - 0.01));
  }
  // Piernas (poco visibles: cámara de escritorio)
  set(POSE.LEFT_KNEE, 0.1, 0.45, 0, 0.2);
  set(POSE.RIGHT_KNEE, -0.1, 0.45, 0, 0.2);
  set(POSE.LEFT_ANKLE, 0.1, 0.9, 0, 0.1);
  set(POSE.RIGHT_ANKLE, -0.1, 0.9, 0, 0.1);
  for (let i = POSE.LEFT_HEEL; i <= POSE.RIGHT_FOOT; i++) set(i, i % 2 ? 0.1 : -0.1, 0.95, 0, 0.1);

  if (opts.raise) {
    const side = opts.raise;
    const sh = side === "left" ? POSE.LEFT_SHOULDER : POSE.RIGHT_SHOULDER;
    const el = side === "left" ? POSE.LEFT_ELBOW : POSE.RIGHT_ELBOW;
    const wr = side === "left" ? POSE.LEFT_WRIST : POSE.RIGHT_WRIST;
    const s = lm[sh];
    // Dirección de apuntar en coords de imagen: aimX (+ = izquierda del
    // usuario), aimY (+ = arriba), y hacia la cámara (z negativo). Brazo
    // extendido (~0.55 m del hombro a la muñeca).
    const ax = opts.aimX ?? (side === "left" ? 0.3 : -0.3);
    const ay = opts.aimY ?? 0.35;
    const az = -0.8;
    const len = Math.hypot(ax, ay, az);
    const d = { x: ax / len, y: -ay / len, z: az / len };
    set(el, s.x + d.x * 0.28, s.y + d.y * 0.28, s.z + d.z * 0.28);
    set(wr, s.x + d.x * 0.56, s.y + d.y * 0.56, s.z + d.z * 0.56);
    const hand = side === "left" ? [POSE.LEFT_PINKY, POSE.LEFT_INDEX, POSE.LEFT_THUMB] : [POSE.RIGHT_PINKY, POSE.RIGHT_INDEX, POSE.RIGHT_THUMB];
    const w = lm[wr];
    hand.forEach((idx, j) => set(idx, w.x + d.x * 0.08 + (j - 1) * 0.015, w.y + d.y * 0.08, w.z + d.z * 0.08));
  }
  return lm;
}
