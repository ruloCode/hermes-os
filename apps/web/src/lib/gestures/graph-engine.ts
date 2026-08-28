/**
 * Lógica PURA de los gestos de mano del grafo 3D (tab MEMORIA): dadas las
 * manos del frame (hasta 2), decide cómo manipular la cámara:
 *  - UNA pinza cerrada     → agarrar: el movimiento de la mano orbita el grafo
 *  - DOS pinzas cerradas   → zoom: separar las manos acerca, juntarlas aleja
 *  - una mano abierta      → cursor de hover (tooltip del nodo apuntado)
 * Sin DOM, sin MediaPipe, sin three — el hook orquesta, esto decide.
 *
 * A diferencia del control del sistema (engine.ts, una mano + robotjs vía
 * agente), esto es 100% local al browser: la cámara three.js es el único
 * efecto. Mismos umbrales de pinza con histéresis que engine.ts.
 */

import { OneEuroFilter } from "./one-euro";
import type { Landmark } from "./engine";

export type { Landmark };

/** Una mano ya reducida: posición ESPEJADA [0,1] + ratio de pinza + tamaño. */
export interface GraphHandInput {
  x: number;
  y: number;
  pinchRatio: number;
  /** Tamaño de la mano en el encuadre (muñeca→nudillo medio, en unidades de
   *  ALTO ya corregidas por aspecto). Más grande = más cerca de la cámara. */
  scale: number;
}

export type GraphGestureMode = "idle" | "cursor" | "orbit" | "zoom";

export interface GraphHandState {
  x: number;
  y: number;
  pinching: boolean;
}

export interface GraphGestureDecision {
  mode: GraphGestureMode;
  /** Manos visibles (suavizadas, espejadas) para el overlay de feedback. */
  hands: GraphHandState[];
  /** Delta de órbita de ESTE frame (unidades de encuadre), solo en modo orbit. */
  orbit: { dx: number; dy: number } | null;
  /** Multiplicador de distancia de cámara de ESTE frame, solo en modo zoom.
   *  <1 acerca (manos separándose) · >1 aleja (manos juntándose). */
  zoom: number | null;
  /** Posición del cursor de hover, solo en modo cursor. */
  cursor: { x: number; y: number } | null;
  /** CLIC por tap de pinza: se cerró y soltó rápido y casi sin moverse.
   *  Posición = donde ARRANCÓ la pinza (la intención, no el drift de cerrar). */
  click: { x: number; y: number } | null;
}

// Histéresis de pinza relativa al tamaño de la mano — mismos valores que el
// control del sistema (engine.ts): cerrar exige más que abrir.
const PINCH_ON = 0.28;
const PINCH_OFF = 0.42;

// Un salto de tracking (mano re-detectada al otro lado del frame) no puede
// teletransportar la cámara: deltas y factor de zoom acotados por frame.
const MAX_ORBIT_STEP = 0.2;
const ZOOM_STEP_MIN = 0.9;
const ZOOM_STEP_MAX = 1.11;

// Tap de pinza = CLIC: cerrar y soltar moviéndose menos de CLICK_MAX_MOVE
// (unidades de encuadre). El discriminador PRINCIPAL es el movimiento (un
// agarre orbita); el tope de tiempo solo descarta pinzas eternas — generoso,
// porque una pinza quieta que se suelta es casi siempre selección intencional
// (y en QA headless cada frame WebGL puede tardar >200ms).
const CLICK_MAX_MOVE = 0.04;
const CLICK_MAX_MS = 1500;

// Varias personas en cámara: manda la mano MÁS GRANDE (la más cercana = el
// usuario); una segunda mano solo cuenta si su tamaño es comparable — misma
// distancia a la cámara ≈ la otra mano del MISMO usuario, no la de alguien
// atrás. Sin esto, la "doble pinza" la puede disparar (o bloquear) un tercero.
const SECOND_HAND_MIN_SCALE = 0.55;

// EMA del ratio de pinza: un spike de UN frame del tracking no debe abrir ni
// cerrar la histéresis (pinza que "suelta sola" con la mano quieta).
const RATIO_ALPHA = 0.55;

// El tracking pierde una mano 1-3 frames con frecuencia: el slot sobrevive
// congelado este lapso en vez de morir (el agarre no se aborta por un pestañeo).
const SLOT_GRACE_MS = 180;

// Al perder UNA de las dos pinzas del zoom, congela el modo un instante en
// vez de caer a órbita: el parpadeo de una mano no debe sacudir la cámara.
const ZOOM_GRACE_MS = 220;

/** Reduce 21 landmarks a la entrada del motor: punto MEDIO pulgar-índice
 *  (estable al pellizcar, igual que engine.ts) espejado + ratio de pinza.
 *  `aspect` = ancho/alto del video: los landmarks vienen normalizados por eje
 *  (x/640, y/360) y sin corregirlo la MISMA distancia física entre dedos mide
 *  distinto según la orientación de la mano — la pinza quedaba inconsistente. */
export function handFromLandmarks(lm: Landmark[], aspect = 16 / 9): GraphHandInput {
  const dist = (a: Landmark, b: Landmark) => Math.hypot((a.x - b.x) * aspect, a.y - b.y);
  const scale = dist(lm[0], lm[9]) || 1e-6;
  return {
    x: 1 - (lm[4].x + lm[8].x) / 2, // espejo: mover la mano a TU derecha = derecha
    y: (lm[4].y + lm[8].y) / 2,
    pinchRatio: dist(lm[4], lm[8]) / scale,
    scale,
  };
}

interface Slot {
  x: number;
  y: number;
  pinching: boolean;
  /** Ratio de pinza SUAVIZADO (EMA) sobre el que corre la histéresis. */
  ratio: number;
  /** Último frame en que el tracking realmente vio esta mano. */
  lastSeen: number;
  fx: OneEuroFilter;
  fy: OneEuroFilter;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

export class GraphGestureEngine {
  private slots: (Slot | null)[] = [null, null];
  private lastOrbit: { x: number; y: number } | null = null;
  private lastZoomDist: number | null = null;
  /** Último frame con las DOS pinzas cerradas (gracia anti-parpadeo del zoom). */
  private lastZoomAt = -Infinity;
  /** Candidato a clic: dónde/cuándo arrancó la pinza y cuánto se ha movido. */
  private pinchStart: { x: number; y: number; t: number; moved: number } | null = null;

  update(inputs: GraphHandInput[], tMs: number): GraphGestureDecision {
    // ── UNA sola persona: manda la mano más grande (la más cercana a la
    // cámara); la segunda solo si es de tamaño comparable. Las manos de
    // alguien más atrás quedan fuera del juego.
    const sorted = [...inputs].sort((a, b) => b.scale - a.scale);
    const hands: GraphHandInput[] = [];
    if (sorted.length > 0) hands.push(sorted[0]);
    for (let i = 1; i < sorted.length && hands.length < 2; i++) {
      if (sorted[i].scale >= sorted[0].scale * SECOND_HAND_MIN_SCALE) hands.push(sorted[i]);
    }

    // ── Matching mano→slot por cercanía (≤2 manos: fuerza bruta trivial).
    // Sin esto, MediaPipe reordena el array entre frames y una pinza "salta"
    // de una mano a la otra.
    const assigned: (GraphHandInput | null)[] = [null, null];
    if (hands.length === 2 && this.slots[0] && this.slots[1]) {
      const d = (s: Slot, h: GraphHandInput) => Math.hypot(s.x - h.x, s.y - h.y);
      const straight = d(this.slots[0], hands[0]) + d(this.slots[1], hands[1]);
      const crossed = d(this.slots[0], hands[1]) + d(this.slots[1], hands[0]);
      if (straight <= crossed) {
        assigned[0] = hands[0];
        assigned[1] = hands[1];
      } else {
        assigned[0] = hands[1];
        assigned[1] = hands[0];
      }
    } else {
      for (const h of hands) {
        let best = -1;
        let bestDist = Infinity;
        this.slots.forEach((s, i) => {
          if (!s || assigned[i]) return;
          const dist = Math.hypot(s.x - h.x, s.y - h.y);
          if (dist < bestDist) {
            best = i;
            bestDist = dist;
          }
        });
        if (best === -1) best = assigned[0] === null ? 0 : 1;
        if (assigned[best] === null) assigned[best] = h;
      }
    }

    // ── Actualiza slots: filtro One Euro + EMA del ratio + histéresis.
    const states: (GraphHandState | null)[] = [null, null];
    for (let i = 0; i < 2; i++) {
      const input = assigned[i];
      if (!input) {
        // Pérdida BREVE del tracking (1-3 frames es normal): el slot
        // sobrevive congelado — un pestañeo no aborta un agarre ni un zoom.
        const ghost = this.slots[i];
        if (ghost && tMs - ghost.lastSeen < SLOT_GRACE_MS) {
          states[i] = { x: ghost.x, y: ghost.y, pinching: ghost.pinching };
        } else {
          this.slots[i] = null;
        }
        continue;
      }
      let slot = this.slots[i];
      if (!slot) {
        slot = {
          x: input.x,
          y: input.y,
          pinching: false,
          ratio: input.pinchRatio,
          lastSeen: tMs,
          fx: new OneEuroFilter(),
          fy: new OneEuroFilter(),
        };
        this.slots[i] = slot;
      }
      slot.x = slot.fx.filter(input.x, tMs);
      slot.y = slot.fy.filter(input.y, tMs);
      slot.ratio += (input.pinchRatio - slot.ratio) * RATIO_ALPHA;
      slot.lastSeen = tMs;
      if (slot.pinching) {
        if (slot.ratio > PINCH_OFF) slot.pinching = false;
      } else if (slot.ratio < PINCH_ON) {
        slot.pinching = true;
      }
      states[i] = { x: slot.x, y: slot.y, pinching: slot.pinching };
    }

    const visible = states.filter((s): s is GraphHandState => s !== null);
    const pinched = visible.filter((s) => s.pinching);

    // ── DOS pinzas → zoom por separación de las manos.
    if (pinched.length >= 2) {
      const dist = Math.hypot(pinched[0].x - pinched[1].x, pinched[0].y - pinched[1].y);
      const zoom =
        this.lastZoomDist === null || dist <= 0
          ? null // frame ancla: aún sin delta
          : clamp(this.lastZoomDist / dist, ZOOM_STEP_MIN, ZOOM_STEP_MAX);
      this.lastZoomDist = dist;
      this.lastZoomAt = tMs;
      this.lastOrbit = null;
      this.pinchStart = null; // entró la segunda pinza: es zoom, no un tap
      return { mode: "zoom", hands: visible, orbit: null, zoom, cursor: null, click: null };
    }
    this.lastZoomDist = null;

    // ── UNA pinza → agarrar y orbitar (y candidato a tap mientras no se mueva).
    if (pinched.length === 1) {
      // Gracia del zoom SOLO si la otra mano DESAPARECIÓ (parpadeo del
      // tracking): congela en zoom sin delta en vez de sacudir la cámara con
      // una órbita fantasma. Si la otra mano sigue visible y ABRIÓ los dedos,
      // es intención del usuario → órbita inmediata.
      if (visible.length < 2 && tMs - this.lastZoomAt < ZOOM_GRACE_MS) {
        this.lastOrbit = null;
        return { mode: "zoom", hands: visible, orbit: null, zoom: null, cursor: null, click: null };
      }
      const p = pinched[0];
      if (this.lastOrbit === null) {
        this.pinchStart = { x: p.x, y: p.y, t: tMs, moved: 0 };
      } else if (this.pinchStart) {
        this.pinchStart.moved = Math.max(
          this.pinchStart.moved,
          Math.hypot(p.x - this.pinchStart.x, p.y - this.pinchStart.y),
        );
      }
      const orbit = this.lastOrbit
        ? {
            dx: clamp(p.x - this.lastOrbit.x, -MAX_ORBIT_STEP, MAX_ORBIT_STEP),
            dy: clamp(p.y - this.lastOrbit.y, -MAX_ORBIT_STEP, MAX_ORBIT_STEP),
          }
        : null; // frame ancla
      this.lastOrbit = { x: p.x, y: p.y };
      return { mode: "orbit", hands: visible, orbit, zoom: null, cursor: null, click: null };
    }
    this.lastOrbit = null;

    // ── Pinza recién soltada: ¿fue un tap? Exige la mano aún visible — una
    // mano PERDIDA por tracking a media pinza no debe fabricar un clic.
    let click: { x: number; y: number } | null = null;
    if (this.pinchStart) {
      if (
        visible.length > 0 &&
        this.pinchStart.moved < CLICK_MAX_MOVE &&
        tMs - this.pinchStart.t < CLICK_MAX_MS
      ) {
        click = { x: this.pinchStart.x, y: this.pinchStart.y };
      }
      this.pinchStart = null;
    }

    // ── Mano abierta (una sola) → cursor de hover.
    if (visible.length === 1) {
      return {
        mode: "cursor",
        hands: visible,
        orbit: null,
        zoom: null,
        cursor: { x: visible[0].x, y: visible[0].y },
        click,
      };
    }
    return { mode: "idle", hands: visible, orbit: null, zoom: null, cursor: null, click };
  }

  /** Las manos se perdieron (o se apagó el tracking): suelta todo estado. */
  reset(): void {
    this.slots = [null, null];
    this.lastOrbit = null;
    this.lastZoomDist = null;
    this.lastZoomAt = -Infinity;
    this.pinchStart = null;
  }
}
