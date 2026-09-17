/**
 * SEÑALAR en la Sala de Agentes 3D: del frame de la marioneta (ya en
 * coordenadas de escena) al agente al que apunta el brazo, con dwell.
 * Puro: sin three.js ni DOM; se prueba con cuerpos sintéticos.
 *
 * Regla del brazo: EXTENDIDO hacia el frente — codo casi recto (>150°), la
 * muñeca no cuelga (no está muy por debajo del hombro) y alcanza hacia
 * adelante. No se exige "en alto": los agentes están a la altura del pecho y
 * a 6 m, así que un brazo horizontal ya apunta bien. El rayo sale del hombro
 * hacia la muñeca y se lanza contra una esfera por agente.
 *
 * Máquina de estados del dwell: el mismo agente bajo el rayo POINT_DWELL_MS
 * seguidos → seleccionado. Perderlo menos de POINT_GRACE_MS (temblor entre
 * dos figuras) no reinicia la carga. Seleccionado, se puede bajar el brazo:
 * se suelta al pasar POINT_RELEASE_MS con el brazo abajo, o con release()
 * (Esc). Señalar a OTRO agente estando seleccionado cambia la selección tras
 * su propio dwell (así se cambia de voz en la misma llamada).
 */

import { POSE, type PuppetFrame, type Vec3 } from "./sala-puppet.js";

export const POINT_DWELL_MS = 700;
export const POINT_RELEASE_MS = 1500;
export const POINT_GRACE_MS = 150;
export const POINT_ELBOW_MIN_DEG = 150;
/** Cuánto puede colgar la muñeca bajo el hombro y seguir "apuntando" (m). */
export const POINT_WRIST_DROP_MAX = 0.18;
/** Alcance mínimo hacia adelante/lados del hombro a la muñeca (m). */
export const POINT_REACH_MIN = 0.32;
/** Radio de la esfera de acierto alrededor del pecho de cada agente (m) — solo para raySphereHit. */
export const POINT_HIT_RADIUS = 0.75;
/**
 * Zona angular máxima por agente (grados). Apuntar con el brazo a 6 m tiene
 * ±10° de ruido fácil (la profundidad de la muñeca es lo peor que estima el
 * modelo), así que se elige al MÁS CERCANO en ángulo dentro de su zona; la
 * zona se achica sola cuando hay vecinos cerca (mitad de la separación).
 */
export const POINT_ZONE_MAX_DEG = 22;

export type Side = "left" | "right";

export interface PointingRay {
  origin: Vec3;
  /** Unitario. */
  dir: Vec3;
  side: Side;
}

const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const len = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
const norm = (a: Vec3): Vec3 => {
  const l = len(a) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};

/** Ángulo interno del codo en grados (180 = brazo recto). */
export function elbowAngleDeg(shoulder: Vec3, elbow: Vec3, wrist: Vec3): number {
  const a = sub(shoulder, elbow);
  const b = sub(wrist, elbow);
  const c = dot(a, b) / ((len(a) || 1e-9) * (len(b) || 1e-9));
  return (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI;
}

const JOINTS: Record<Side, { shoulder: number; elbow: number; wrist: number }> = {
  left: { shoulder: POSE.LEFT_SHOULDER, elbow: POSE.LEFT_ELBOW, wrist: POSE.LEFT_WRIST },
  right: { shoulder: POSE.RIGHT_SHOULDER, elbow: POSE.RIGHT_ELBOW, wrist: POSE.RIGHT_WRIST },
};

/** ¿Está este brazo extendido señalando? */
export function armExtended(frame: PuppetFrame, side: Side): boolean {
  const j = JOINTS[side];
  if (!frame.visible[j.shoulder] || !frame.visible[j.elbow] || !frame.visible[j.wrist]) return false;
  const s = frame.points[j.shoulder];
  const e = frame.points[j.elbow];
  const w = frame.points[j.wrist];
  if (elbowAngleDeg(s, e, w) < POINT_ELBOW_MIN_DEG) return false;
  if (w.y < s.y - POINT_WRIST_DROP_MAX) return false;
  const reach = Math.hypot(w.x - s.x, w.z - s.z);
  return reach >= POINT_REACH_MIN;
}

/**
 * Rayo de señalar: hombro → muñeca del brazo extendido. Con los dos
 * extendidos manda el de la muñeca más alta.
 */
export function pointingRay(frame: PuppetFrame): PointingRay | null {
  const sides: Side[] = (["left", "right"] as Side[]).filter((s) => armExtended(frame, s));
  if (sides.length === 0) return null;
  const side =
    sides.length === 1
      ? sides[0]
      : frame.points[POSE.LEFT_WRIST].y >= frame.points[POSE.RIGHT_WRIST].y
        ? "left"
        : "right";
  const j = JOINTS[side];
  const origin = frame.points[j.shoulder];
  return { origin, dir: norm(sub(frame.points[j.wrist], origin)), side };
}

/** Distancia a lo largo del rayo hasta la esfera, o null si no la toca (ni hacia atrás). */
export function raySphereHit(origin: Vec3, dir: Vec3, center: Vec3, radius: number): number | null {
  const oc = sub(origin, center);
  const b = dot(oc, dir);
  const c = dot(oc, oc) - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  if (t >= 0) return t;
  const t2 = -b + Math.sqrt(disc);
  return t2 >= 0 ? t2 : null;
}

export interface PointTarget {
  key: string;
  center: Vec3;
  radius: number;
}

/** Ángulo (grados) entre dos direcciones. */
function angleDeg(a: Vec3, b: Vec3): number {
  const c = dot(a, b) / ((len(a) || 1e-9) * (len(b) || 1e-9));
  return (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI;
}

/**
 * El agente al que apunta el rayo: el más cercano EN ÁNGULO desde el origen
 * del rayo, si cae dentro de su zona. La zona de cada agente es
 * min(POINT_ZONE_MAX_DEG, mitad del ángulo a su vecino más próximo − 1°):
 * con dos figuras separadas 96° cada una tiene 22°; con cinco a ~15°, unos 6°
 * (equivalente a la esfera de antes). Entre dos vecinos exactamente a la
 * mitad no se elige a nadie.
 */
export function pickTarget(ray: PointingRay | null, targets: PointTarget[], maxZoneDeg = POINT_ZONE_MAX_DEG): string | null {
  if (!ray || targets.length === 0) return null;
  const dirs = targets.map((tg) => sub(tg.center, ray.origin));
  let best: { i: number; ang: number } | null = null;
  for (let i = 0; i < targets.length; i++) {
    const ang = angleDeg(ray.dir, dirs[i]);
    if (best === null || ang < best.ang) best = { i, ang };
  }
  if (!best) return null;
  let zone = maxZoneDeg;
  for (let j = 0; j < targets.length; j++) {
    if (j === best.i) continue;
    zone = Math.min(zone, angleDeg(dirs[best.i], dirs[j]) / 2 - 1);
  }
  return best.ang <= zone ? targets[best.i].key : null;
}

/**
 * Altura de la muñeca respecto al hombro para contar como "mano levantada"
 * (m). NEGATIVO a propósito: basta con la mano a la altura del pecho — subirla
 * por encima de la cabeza se siente forzado. El brazo colgando queda ~0,5 m
 * por debajo, así que no hay falsos positivos.
 */
export const HAND_RAISE_MIN = -0.12;

/** ¿Está esta mano levantada (muñeca claramente por encima del hombro)? Sin exigir codo recto. */
export function handRaised(frame: PuppetFrame, side: Side): boolean {
  const j = JOINTS[side];
  if (!frame.visible[j.shoulder] || !frame.visible[j.wrist]) return false;
  return frame.points[j.wrist].y > frame.points[j.shoulder].y + HAND_RAISE_MIN;
}

/**
 * Selección por MANO, sin rayo: la mano izquierda levantada elige al agente
 * de la izquierda de la pantalla, la derecha al de la derecha (con las dos,
 * manda la muñeca más alta). Pensado para DOS agentes: con más, izquierda y
 * derecha son los extremos del arco. Devuelve también si hay alguna mano
 * arriba (para el release de la máquina de dwell).
 */
export function raisedHandTarget(
  frame: PuppetFrame,
  targets: PointTarget[],
): { target: string | null; handUp: boolean; side: Side | null } {
  const left = handRaised(frame, "left");
  const right = handRaised(frame, "right");
  if ((!left && !right) || targets.length === 0) return { target: null, handUp: left || right, side: null };
  const side: Side =
    left && right
      ? frame.points[POSE.LEFT_WRIST].y >= frame.points[POSE.RIGHT_WRIST].y
        ? "left"
        : "right"
      : left
        ? "left"
        : "right";
  // Izquierda del usuario = x negativo en escena (está de espaldas): el agente con menor x.
  const sorted = [...targets].sort((a, b) => a.center.x - b.center.x);
  const pick = side === "left" ? sorted[0] : sorted[sorted.length - 1];
  return { target: pick.key, handUp: true, side };
}

export interface PointingState {
  /** Agente bajo el rayo ahora (cargando dwell), o null. */
  aiming: string | null;
  /** 0..1 del dwell del agente en `aiming`. */
  progress: number;
  /** Agente seleccionado (con voz), o null. */
  selected: string | null;
  /** Evento de ESTE update: se seleccionó `selected` o se soltó el anterior. */
  event: { kind: "select"; key: string } | { kind: "release"; key: string } | null;
}

export class PointingMachine {
  private selected: string | null = null;
  private aiming: string | null = null;
  private aimSince = 0;
  private lastSeenAim = 0;
  private armDownSince: number | null = null;

  constructor(
    private readonly dwellMs = POINT_DWELL_MS,
    private readonly releaseMs = POINT_RELEASE_MS,
    private readonly graceMs = POINT_GRACE_MS,
  ) {}

  /** @param target agente bajo el rayo (null = ninguno) · @param armUp hay brazo extendido */
  update(target: string | null, armUp: boolean, tMs: number): PointingState {
    let event: PointingState["event"] = null;

    // Brazo abajo el tiempo suficiente → soltar la selección.
    if (!armUp) {
      if (this.armDownSince === null) this.armDownSince = tMs;
      if (this.selected !== null && tMs - this.armDownSince >= this.releaseMs) {
        event = { kind: "release", key: this.selected };
        this.selected = null;
      }
    } else {
      this.armDownSince = null;
    }

    // Dwell sobre el objetivo (con gracia ante parpadeos).
    if (target !== null) {
      if (target !== this.aiming) {
        this.aiming = target;
        this.aimSince = tMs;
      }
      this.lastSeenAim = tMs;
    } else if (this.aiming !== null && tMs - this.lastSeenAim > this.graceMs) {
      this.aiming = null;
    }

    let progress = 0;
    if (this.aiming !== null) {
      if (this.aiming === this.selected) {
        progress = 1;
      } else {
        progress = Math.min(1, (tMs - this.aimSince) / this.dwellMs);
        if (progress >= 1) {
          if (this.selected !== null && this.selected !== this.aiming) {
            // Cambio de agente: el anterior se suelta en el mismo tick.
            event = { kind: "release", key: this.selected };
          }
          this.selected = this.aiming;
          event = { kind: "select", key: this.selected };
        }
      }
    }

    return { aiming: this.aiming, progress, selected: this.selected, event };
  }

  /** Suelta la selección ya (Esc). */
  release(tMs: number): PointingState {
    const prev = this.selected;
    this.selected = null;
    this.aiming = null;
    this.armDownSince = tMs;
    return { aiming: null, progress: 0, selected: null, event: prev ? { kind: "release", key: prev } : null };
  }

  reset(): void {
    this.selected = null;
    this.aiming = null;
    this.armDownSince = null;
  }

  get current(): string | null {
    return this.selected;
  }
}
