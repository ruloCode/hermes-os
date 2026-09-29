/**
 * SEÑAS de mano configurables (control por gestos → sistema operativo).
 *
 * Una seña es una FORMA ESTÁTICA de la mano sostenida ~600ms que dispara una
 * acción. Es una capa aparte del vocabulario dinámico del motor de gestos
 * (pinza = clic, swipe = Spaces, palma empujando = Mission Control): esas
 * siguen intactas; las señas se evalúan solo cuando la mano está en pose de
 * puntero sin pinza, y mientras una seña "carga" el cursor se congela.
 *
 * Dos formas de definir una seña, y ambas conviven:
 *  - por FORMA de dedos (`shape`: qué dedos están extendidos) — así vienen
 *    las de fábrica, que funcionan sin entrenar nada;
 *  - por MUESTRAS (`samples`: vectores de landmarks normalizados) — el
 *    usuario la enseña delante de la cámara y un vecino-más-cercano la
 *    reconoce. Si una seña tiene muestras, las muestras mandan.
 *
 * Todo aquí es puro (sin DOM, sin MediaPipe, sin React, sin Node): lo usan
 * el dashboard (reconocer) y el agente (validar/persistir), y se prueba con
 * manos sintéticas.
 *
 * Mapa de los 21 landmarks de MediaPipe: 0 muñeca · 1-4 pulgar (4 punta) ·
 * 5-8 índice · 9-12 medio · 13-16 anular · 17-20 meñique; 5/9/13/17 = MCP
 * (nudillos), 6/10/14/18 = PIP (articulación media).
 */

export interface SignLandmark {
  x: number;
  y: number;
  z?: number;
}

/** Qué dedos están extendidos. */
export interface FingerShape {
  thumb: boolean;
  index: boolean;
  middle: boolean;
  ring: boolean;
  pinky: boolean;
}

export type SignActionKind = "system" | "browser";

export interface SignActionDef {
  id: string;
  label: string;
  kind: SignActionKind;
  hint?: string;
}

/**
 * Acciones que ejecuta el AGENTE (robotjs / helper de ventanas). Es la
 * allowlist que el agente valida: el WS transporta ids, jamás teclas.
 */
export const SYSTEM_SIGN_ACTIONS: readonly SignActionDef[] = [
  { id: "window_next_display", label: "Ventana → siguiente pantalla", kind: "system", hint: "La ventana bajo el cursor salta al otro monitor" },
  { id: "window_snap_left", label: "Ventana a la mitad izquierda", kind: "system" },
  { id: "window_snap_right", label: "Ventana a la mitad derecha", kind: "system" },
  { id: "window_maximize", label: "Ventana a toda la pantalla", kind: "system", hint: "Ocupa el área visible, sin entrar en fullscreen" },
  { id: "window_center", label: "Centrar ventana", kind: "system" },
  { id: "mission_control", label: "Mission Control", kind: "system" },
  { id: "space_left", label: "Space anterior", kind: "system" },
  { id: "space_right", label: "Space siguiente", kind: "system" },
  { id: "spotlight", label: "Spotlight (⌘ Espacio)", kind: "system" },
  { id: "screenshot_area", label: "Captura de pantalla (⌘⇧4)", kind: "system" },
  { id: "copy", label: "Copiar (⌘C)", kind: "system" },
  { id: "paste", label: "Pegar (⌘V)", kind: "system" },
  { id: "play_pause", label: "Reproducir / pausar", kind: "system" },
  { id: "volume_up", label: "Subir volumen", kind: "system" },
  { id: "volume_down", label: "Bajar volumen", kind: "system" },
  { id: "mute", label: "Silenciar", kind: "system" },
];

/**
 * Acciones que ejecuta el DASHBOARD (no pasan por el agente). Además de
 * estas, `command:<id>` ejecuta cualquier comando del registry ⌘K.
 */
export const BROWSER_SIGN_ACTIONS: readonly SignActionDef[] = [
  { id: "voice_toggle", label: "Hablar con Hermes / colgar", kind: "browser", hint: "Inicia la llamada de voz; si ya está activa, la cuelga" },
  { id: "voice_start", label: "Hablar con Hermes", kind: "browser" },
  { id: "voice_stop", label: "Colgar la voz", kind: "browser" },
  { id: "palette", label: "Abrir ⌘K", kind: "browser" },
];

export const COMMAND_ACTION_PREFIX = "command:";

export function isSystemSignAction(id: string): boolean {
  return SYSTEM_SIGN_ACTIONS.some((a) => a.id === id);
}

export function isBrowserSignAction(id: string): boolean {
  return BROWSER_SIGN_ACTIONS.some((a) => a.id === id) || isCommandSignAction(id);
}

/** `command:<id>` — un comando del registry ⌘K (el id se valida en la web). */
export function isCommandSignAction(id: string): boolean {
  return id.startsWith(COMMAND_ACTION_PREFIX) && /^[a-z0-9-]{1,60}$/.test(id.slice(COMMAND_ACTION_PREFIX.length));
}

export function isSignAction(id: string): boolean {
  return isSystemSignAction(id) || isBrowserSignAction(id);
}

export interface SignDef {
  /** Slug estable (`shaka`, `mi-sena-3`). */
  id: string;
  name: string;
  emoji?: string;
  /** Forma de dedos (señas de fábrica o definidas a mano). */
  shape?: FingerShape;
  /** Muestras entrenadas (vectores de `normalizeLandmarks`, 42 floats). */
  samples: number[][];
  /** Acción asignada (id del catálogo o `command:<id>`); null = sin asignar. */
  action: string | null;
  /** Cuánto sostener la seña para disparar. */
  holdMs: number;
  enabled: boolean;
  /** De fábrica: se puede reasignar, re-entrenar o apagar, no borrar. */
  builtin: boolean;
}

export interface SignsConfig {
  version: 1;
  signs: SignDef[];
}

export const SIGN_HOLD_DEFAULT_MS = 650;
export const SIGN_HOLD_MIN_MS = 300;
export const SIGN_HOLD_MAX_MS = 3000;
export const SIGN_MAX_SAMPLES = 60;
export const SIGN_MAX_COUNT = 40;
/** Cuánto puede moverse la palma (fracción del encuadre) mientras una seña carga. */
export const SIGN_STILL_MAX = 0.12;
export const SIGN_VECTOR_LENGTH = 42;

/**
 * Señas de fábrica. Criterio de elección: el pulgar va SIEMPRE extendido —
 * un pulgar plegado sobre los dedos (🤘, "tres") queda a <0.28 de la punta
 * del anular/meñique y el motor lo lee como la pinza de copiar/pegar. Y
 * ninguna coincide con las formas reservadas del cursor (ver abajo).
 */
export function defaultSignsConfig(): SignsConfig {
  return {
    version: 1,
    signs: [
      {
        id: "shaka",
        name: "Shaka",
        emoji: "🤙",
        shape: { thumb: true, index: false, middle: false, ring: false, pinky: true },
        samples: [],
        action: "voice_toggle",
        holdMs: SIGN_HOLD_DEFAULT_MS,
        enabled: true,
        builtin: true,
      },
      {
        id: "ily",
        name: "Pulgar + índice + meñique",
        emoji: "🤟",
        shape: { thumb: true, index: true, middle: false, ring: false, pinky: true },
        samples: [],
        action: "window_next_display",
        holdMs: SIGN_HOLD_DEFAULT_MS,
        enabled: true,
        builtin: true,
      },
      {
        id: "shh",
        name: "Silencio",
        emoji: "🤫",
        shape: { thumb: false, index: true, middle: false, ring: false, pinky: false },
        samples: [],
        action: "mute",
        holdMs: SIGN_HOLD_DEFAULT_MS,
        enabled: true,
        builtin: true,
      },
      {
        id: "tres-pulgar",
        name: "Pulgar + índice + medio",
        shape: { thumb: true, index: true, middle: true, ring: false, pinky: false },
        samples: [],
        action: "window_maximize",
        holdMs: SIGN_HOLD_DEFAULT_MS,
        enabled: true,
        builtin: true,
      },
    ],
  };
}

// ── Geometría ────────────────────────────────────────────────────────────

function dist(a: SignLandmark, b: SignLandmark, aspect: number): number {
  return Math.hypot((a.x - b.x) * aspect, a.y - b.y);
}

/** Dedo extendido = punta más lejos de la muñeca que su PIP (robusto a rotación). */
function fingerUp(lm: SignLandmark[], tip: number, pip: number, aspect: number): boolean {
  return dist(lm[tip], lm[0], aspect) > dist(lm[pip], lm[0], aspect) * 1.1;
}

/**
 * Forma de dedos del frame. El pulgar no se pliega "hacia la muñeca" sino
 * a través de la palma, así que su regla es distinta: extendido si la punta
 * queda claramente más lejos del nudillo del meñique que su propio MCP.
 * `aspect` = ancho/alto del video (los landmarks vienen normalizados por
 * eje y sin corregirlo la geometría depende de la orientación de la mano).
 */
export function fingerShape(lm: SignLandmark[], aspect = 16 / 9): FingerShape {
  return {
    thumb: dist(lm[4], lm[17], aspect) > dist(lm[2], lm[17], aspect) * 1.25,
    index: fingerUp(lm, 8, 6, aspect),
    middle: fingerUp(lm, 12, 10, aspect),
    ring: fingerUp(lm, 16, 14, aspect),
    pinky: fingerUp(lm, 20, 18, aspect),
  };
}

export function sameShape(a: FingerShape, b: FingerShape): boolean {
  return (
    a.thumb === b.thumb &&
    a.index === b.index &&
    a.middle === b.middle &&
    a.ring === b.ring &&
    a.pinky === b.pinky
  );
}

/**
 * Formas RESERVADAS por el motor de gestos: nunca son señas, ni de fábrica
 * ni entrenadas — reconocerlas robaría el cursor o el clic:
 *  - puño (cuatro dedos plegados)           → kill switch / agarrar ventana
 *  - pulgar+índice ("L")                    → la mano lista para pellizcar
 *  - índice+medio                           → scroll / swipe de Spaces
 *  - los cuatro dedos arriba                → cursor / palma de Mission Control
 * El índice SOLO con el pulgar plegado (🤫) NO está reservado: es la seña de
 * silencio. El precio es que apuntar con un solo dedo y quedarse quieto
 * ~650ms la dispara — por eso el provider exige la mano QUIETA para cargar.
 */
export function isReservedShape(s: FingerShape): boolean {
  const fingersUp = [s.index, s.middle, s.ring, s.pinky].filter(Boolean).length;
  if (fingersUp === 0 || fingersUp === 4) return true;
  if (s.thumb && s.index && !s.middle && !s.ring && !s.pinky) return true;
  if (s.index && s.middle && !s.ring && !s.pinky) return true;
  return false;
}

/**
 * Vector canónico de la mano (42 floats): trasladado a la muñeca, escalado
 * por muñeca→nudillo medio, rotado para que ese vector apunte "arriba" y
 * espejado para que el índice quede siempre del mismo lado que el meñique
 * — así una seña vale para las dos manos y a cualquier distancia/ángulo.
 * Se descarta z (ruidoso en MediaPipe) y se redondea a 3 decimales para
 * que las muestras persistidas sean pequeñas.
 */
export function normalizeLandmarks(lm: SignLandmark[], aspect = 16 / 9): number[] {
  const w = lm[0];
  const mx = (lm[9].x - w.x) * aspect;
  const my = lm[9].y - w.y;
  const scale = Math.hypot(mx, my) || 1e-6;
  const rot = -Math.PI / 2 - Math.atan2(my, mx);
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const pts = lm.map((p) => {
    const dx = ((p.x - w.x) * aspect) / scale;
    const dy = (p.y - w.y) / scale;
    return { x: dx * c - dy * s, y: dx * s + dy * c };
  });
  const flip = pts[5].x > pts[17].x ? -1 : 1;
  const out: number[] = [];
  for (const p of pts) out.push(Math.round(p.x * flip * 1000) / 1000, Math.round(p.y * 1000) / 1000);
  return out;
}

/**
 * Distancia entre dos vectores canónicos (unidades de palma): media por
 * punto + la mitad del PEOR punto. La media sola diluye la diferencia de un
 * solo dedo (🤙 vs 🤟 son 3 puntos de 21 → media ~0.12, indistinguibles del
 * ruido); el término de máximo hace que un dedo distinto pese.
 */
export function vectorDistance(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length) / 2;
  if (n === 0) return Infinity;
  let sum = 0;
  let worst = 0;
  for (let i = 0; i < n; i++) {
    const d = Math.hypot(a[2 * i] - b[2 * i], a[2 * i + 1] - b[2 * i + 1]);
    sum += d;
    if (d > worst) worst = d;
  }
  return sum / n + worst / 2;
}

// ── Clasificador ─────────────────────────────────────────────────────────

/** Hasta qué distancia una muestra "es" la seña (ver vectorDistance). */
export const SIGN_MATCH_MAX = 0.3;
/** Ventaja mínima sobre la segunda seña más parecida — si no, es ambigua. */
export const SIGN_MATCH_MARGIN = 0.05;

export interface SignMatch {
  id: string;
  /** Distancia a la muestra más cercana (0 para las señas por forma). */
  score: number;
  via: "samples" | "shape";
}

export class SignClassifier {
  private readonly trained: { id: string; samples: number[][] }[];
  private readonly shaped: { id: string; shape: FingerShape }[];

  constructor(signs: SignDef[]) {
    const on = signs.filter((s) => s.enabled);
    this.trained = on
      .filter((s) => s.samples.length > 0)
      .map((s) => ({ id: s.id, samples: s.samples }));
    // Las muestras mandan: una seña de fábrica re-entrenada deja de usar su forma.
    this.shaped = on
      .filter((s) => s.samples.length === 0 && s.shape)
      .map((s) => ({ id: s.id, shape: s.shape as FingerShape }));
  }

  get size(): number {
    return this.trained.length + this.shaped.length;
  }

  classify(lm: SignLandmark[], aspect = 16 / 9): SignMatch | null {
    const shape = fingerShape(lm, aspect);
    if (isReservedShape(shape)) return null;

    if (this.trained.length > 0) {
      const v = normalizeLandmarks(lm, aspect);
      let best: { id: string; d: number } | null = null;
      let second = Infinity;
      for (const t of this.trained) {
        let d = Infinity;
        for (const s of t.samples) d = Math.min(d, vectorDistance(v, s));
        if (!best || d < best.d) {
          if (best) second = best.d;
          best = { id: t.id, d };
        } else if (d < second) {
          second = d;
        }
      }
      if (best && best.d <= SIGN_MATCH_MAX && second - best.d >= SIGN_MATCH_MARGIN) {
        return { id: best.id, score: best.d, via: "samples" };
      }
    }
    for (const s of this.shaped) {
      if (sameShape(s.shape, shape)) return { id: s.id, score: 0, via: "shape" };
    }
    return null;
  }
}

// ── Detector de sostén ───────────────────────────────────────────────────

/** Frames sin seña que se toleran antes de soltar la candidata (parpadeo del tracking). */
export const SIGN_GRACE_MS = 120;
/** Tras disparar, cuánto esperar antes de que la MISMA u otra seña pueda cargar. */
export const SIGN_COOLDOWN_MS = 900;

export interface SignProgress {
  candidate: string | null;
  /** 0..1 de la carga (anillo del HUD). 1 = ya disparó y se sostiene. */
  progress: number;
  /** Seña disparada ESTE frame, o null. */
  fired: string | null;
}

/**
 * Sostener → disparar UNA vez → seguir sosteniendo no repite → soltar
 * (o cambiar de seña) rearma. Cooldown global tras cada disparo. Lo alimenta
 * el provider frame a frame con la seña reconocida (o null).
 */
export class SignDetector {
  private candidate: string | null = null;
  private since = 0;
  private lastSeen = 0;
  private latched = false;
  private readyAt = 0;

  update(id: string | null, holdMs: number, tMs: number): SignProgress {
    if (id !== null) {
      if (id !== this.candidate) {
        this.candidate = id;
        this.since = tMs;
        this.latched = false;
      }
      this.lastSeen = tMs;
    } else if (this.candidate !== null && tMs - this.lastSeen > SIGN_GRACE_MS) {
      this.candidate = null;
      this.latched = false;
    }
    if (this.candidate === null) return { candidate: null, progress: 0, fired: null };
    if (this.latched) return { candidate: this.candidate, progress: 1, fired: null };
    const start = Math.max(this.since, this.readyAt);
    const progress = Math.min(Math.max((tMs - start) / holdMs, 0), 1);
    if (progress >= 1) {
      this.latched = true;
      this.readyAt = tMs + SIGN_COOLDOWN_MS;
      return { candidate: this.candidate, progress: 1, fired: this.candidate };
    }
    return { candidate: this.candidate, progress, fired: null };
  }

  reset(): void {
    this.candidate = null;
    this.latched = false;
    this.since = 0;
    this.lastSeen = 0;
  }
}

/** Glifo de una forma para la UI: pulgar·índice·medio·anular·meñique (● arriba, ○ plegado). */
export function shapeGlyph(s: FingerShape): string {
  return [s.thumb, s.index, s.middle, s.ring, s.pinky].map((v) => (v ? "●" : "○")).join("");
}
