/**
 * Lógica PURA del control por gestos: dado el frame de landmarks de
 * MediaPipe, decide pose (puntero / scroll / puño), estado de pinza y
 * acciones discretas (copiar/pegar/Spaces/Mission Control).
 * Sin DOM, sin WS, sin React — el provider orquesta, esto decide.
 *
 * Mapa de los 21 landmarks (topología estable de MediaPipe Hands):
 * 0 muñeca · 4 punta pulgar · 8 punta índice · 12 punta medio ·
 * 16 punta anular · 20 punta meñique · 5/9/13/17 nudillos (MCP) ·
 * 6/10/14/18 articulación media (PIP).
 *
 * Vocabulario completo:
 *  - mano abierta          → mover cursor (punto medio pulgar-índice)
 *  - pinza pulgar+índice   → click / drag (histéresis)
 *  - pinza pulgar+MEÑIQUE  → copiar (⌘C, edge-trigger)
 *  - pinza pulgar+ANULAR   → pegar (⌘V, edge-trigger)
 *  - índice+medio          → scroll vertical · swipe horizontal = Spaces
 *  - palma empujando (z)   → Mission Control (crece la escala de la mano)
 *  - puño sostenido        → kill switch (lo temporiza el provider)
 */

export interface Landmark {
  x: number;
  y: number;
  z: number;
}

export type HandPose = "pointer" | "scroll" | "fist";

export type GestureAction =
  | "copy"
  | "paste"
  | "space_left"
  | "space_right"
  | "mission_control";

export interface FrameDecision {
  pose: HandPose;
  /** Pinza índice cerrada (tras histéresis) — down/up del botón izquierdo. */
  pinching: boolean;
  /** Posición del cursor en coords normalizadas de PANTALLA (ya espejada y
   *  mapeada por la zona activa), o null si la pose no mueve el cursor. */
  cursor: { x: number; y: number } | null;
  /** Distancia de pinza índice normalizada (debug de /dev/gestos). */
  pinchRatio: number;
  /** Acción discreta disparada ESTE frame (edge-trigger), o null. */
  action: GestureAction | null;
}

// Las pinzas se miden relativas al tamaño de la mano (muñeca→nudillo medio)
// para no depender de la distancia a la cámara. Histéresis: cerrar exige
// acercar más de lo que abrir exige alejar — sin ella el click "metralla".
const PINCH_ON = 0.28;
const PINCH_OFF = 0.42;

// Swipe de Spaces: velocidad horizontal (unidades de frame/s, espejadas) en
// pose scroll. 2.0 ≈ cruzar medio encuadre en 250ms — deliberado, no pasa
// por accidente al hacer scroll.
const SWIPE_VELOCITY = 2.0;
const SWIPE_COOLDOWN_MS = 900;

// Push de palma (Mission Control): crecimiento RELATIVO de la escala de la
// mano por segundo (acercarse a la cámara). 1.8/s ≈ acercar la mano con
// intención; mover el cursor normal no cruza el umbral.
const PUSH_VELOCITY = 1.8;
const PUSH_COOLDOWN_MS = 1500;

// Zona activa: el centro del encuadre mapea a TODA la pantalla. Los bordes
// del frame quedan fuera a propósito — ahí MediaPipe pierde la mano y el
// brazo trabaja incómodo. Márgenes asimétricos en Y: la mano suele entrar
// desde abajo.
const ZONE = { left: 0.22, right: 0.78, top: 0.25, bottom: 0.75 };

function dist2d(a: Landmark, b: Landmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Dedo extendido = punta más lejos de la muñeca que su PIP (robusto a rotación). */
function extended(lm: Landmark[], tip: number, pip: number): boolean {
  return dist2d(lm[tip], lm[0]) > dist2d(lm[pip], lm[0]) * 1.1;
}

function mapZone(v: number, lo: number, hi: number): number {
  return Math.min(Math.max((v - lo) / (hi - lo), 0), 1);
}

export class GestureEngine {
  private pinchDown = false;
  private copyDown = false;
  private pasteDown = false;
  private swipeReadyAt = 0;
  private pushReadyAt = 0;
  private lastSwipe: { mx: number; t: number } | null = null;
  private lastScale: { s: number; t: number } | null = null;

  /** Decide pose/pinza/cursor/acción para un frame. `lm` = 21 landmarks; `tMs` = performance.now(). */
  decide(lm: Landmark[], tMs: number): FrameDecision {
    const handScale = dist2d(lm[0], lm[9]); // muñeca → nudillo del medio
    const safeScale = handScale > 0 ? handScale : 1;
    const rIndex = dist2d(lm[4], lm[8]) / safeScale;
    const rRing = dist2d(lm[4], lm[16]) / safeScale;
    const rPinky = dist2d(lm[4], lm[20]) / safeScale;

    const indexUp = extended(lm, 8, 6);
    const middleUp = extended(lm, 12, 10);
    const ringUp = extended(lm, 16, 14);
    const pinkyUp = extended(lm, 20, 18);

    let action: GestureAction | null = null;

    // ── Pinza índice: prioridad absoluta (un drag en curso no se interrumpe).
    if (this.pinchDown) {
      if (rIndex > PINCH_OFF) this.pinchDown = false;
    } else if (rIndex < PINCH_ON && rIndex <= rRing && rIndex <= rPinky) {
      // "<= rRing/rPinky": la pinza es del dedo MÁS CERCANO al pulgar — evita
      // que un agarre general dispare click+copy a la vez.
      this.pinchDown = true;
    }

    // ── Pinzas de acción (solo sin pinza índice y con el índice extendido,
    // que es lo que las distingue de un puño a medio cerrar).
    if (!this.pinchDown && indexUp) {
      if (this.copyDown) {
        if (rPinky > PINCH_OFF) this.copyDown = false;
      } else if (rPinky < PINCH_ON && rPinky < rRing) {
        this.copyDown = true;
        action = "copy";
      }
      if (!this.copyDown) {
        if (this.pasteDown) {
          if (rRing > PINCH_OFF) this.pasteDown = false;
        } else if (rRing < PINCH_ON && rRing < rPinky) {
          this.pasteDown = true;
          action = "paste";
        }
      }
    } else {
      this.copyDown = false;
      this.pasteDown = false;
    }

    // Puño: todo plegado y sin pinza en curso (soltar un drag cerrando la
    // mano es un gesto natural — no lo confundas con el kill switch).
    if (!indexUp && !middleUp && !ringUp && !pinkyUp && !this.pinchDown) {
      this.resetTemporal();
      return { pose: "fist", pinching: false, cursor: null, pinchRatio: rIndex, action: null };
    }

    // ── Scroll (índice+medio, resto plegado): vertical lo maneja el
    // provider; aquí solo el swipe horizontal → Spaces (convención trackpad:
    // mano a la izquierda = space siguiente).
    if (indexUp && middleUp && !ringUp && !pinkyUp && !this.pinchDown && !this.copyDown && !this.pasteDown) {
      const mx = 1 - lm[8].x; // espejado, como el cursor
      if (this.lastSwipe) {
        const dt = (tMs - this.lastSwipe.t) / 1000;
        if (dt > 0) {
          const vx = (mx - this.lastSwipe.mx) / dt;
          if (tMs >= this.swipeReadyAt && Math.abs(vx) > SWIPE_VELOCITY) {
            action = vx > 0 ? "space_left" : "space_right";
            this.swipeReadyAt = tMs + SWIPE_COOLDOWN_MS;
          }
        }
      }
      this.lastSwipe = { mx, t: tMs };
      this.lastScale = null;
      return { pose: "scroll", pinching: false, cursor: null, pinchRatio: rIndex, action };
    }
    this.lastSwipe = null;

    // ── Push de palma (Mission Control): palma completa acercándose rápido.
    if (indexUp && middleUp && ringUp && pinkyUp && !this.pinchDown) {
      if (this.lastScale) {
        const dt = (tMs - this.lastScale.t) / 1000;
        if (dt > 0 && dt < 0.5) {
          const rel = (handScale - this.lastScale.s) / this.lastScale.s / dt;
          if (tMs >= this.pushReadyAt && rel > PUSH_VELOCITY && !action) {
            action = "mission_control";
            this.pushReadyAt = tMs + PUSH_COOLDOWN_MS;
          }
        }
      }
      this.lastScale = { s: handScale, t: tMs };
    } else {
      this.lastScale = null;
    }

    // ── Puntero: cursor en el punto MEDIO pulgar-índice (la punta del índice
    // se desplaza al pellizcar; el punto medio casi no — sin esto, cada click
    // arrastra el cursor unos píxeles). Congelado durante copiar/pegar.
    const mid = {
      x: (lm[4].x + lm[8].x) / 2,
      y: (lm[4].y + lm[8].y) / 2,
    };
    const cursor =
      this.copyDown || this.pasteDown
        ? null
        : {
            // Espejo horizontal: mover la mano a TU derecha mueve el cursor a
            // la derecha (el frame crudo de la cámara viene sin espejar).
            x: mapZone(1 - mid.x, ZONE.left, ZONE.right),
            y: mapZone(mid.y, ZONE.top, ZONE.bottom),
          };
    return { pose: "pointer", pinching: this.pinchDown, cursor, pinchRatio: rIndex, action };
  }

  private resetTemporal(): void {
    this.lastSwipe = null;
    this.lastScale = null;
    this.copyDown = false;
    this.pasteDown = false;
  }

  /** La mano se perdió: suelta cualquier estado retenido. */
  reset(): void {
    this.pinchDown = false;
    this.resetTemporal();
  }
}
