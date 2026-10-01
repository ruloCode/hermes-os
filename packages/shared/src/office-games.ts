// Minijuegos de la azotea de la Oficina: la física y el puntaje, PUROS (sin
// three.js ni DOM). La web los dibuja (apps/web/src/lib/oficina/games/*) y los
// tests los corren con entradas sintéticas. Diseños propios: ninguno imita un
// juego conocido. Los puntajes son datos reales de la partida que se juega.

import { mulberry32 } from "./office-ambient.js";

export type GameId = "darts" | "pingpong" | "foosball" | "basket" | "arcade";
export const GAME_IDS: readonly GameId[] = ["darts", "pingpong", "foosball", "basket", "arcade"];

export function isGameId(v: unknown): v is GameId {
  return typeof v === "string" && (GAME_IDS as readonly string[]).includes(v);
}

/** Entrada de un frame: ejes de −1 a 1 (y positivo = arriba/adelante) y la acción. */
export interface GameInput {
  x: number;
  y: number;
  /** La acción sostenida (Espacio/Enter/E, A del control). */
  action: boolean;
  /** La acción recién presionada en este frame. */
  pressed: boolean;
}

export const NO_INPUT: GameInput = { x: 0, y: 0, action: false, pressed: false };

export const GAME_INFO: Record<GameId, { title: string; poi: string | null; keys: string[]; pad: string[] }> = {
  darts: {
    title: "Dardos",
    poi: "dardos",
    keys: ["Flechas o WASD: mover la mira (oscila sola)", "Espacio: lanzar · 9 dardos"],
    pad: ["Stick izquierdo: mover la mira (oscila sola)", "A: lanzar · 9 dardos"],
  },
  pingpong: {
    title: "Ping-pong",
    poi: "pingpong",
    keys: ["←→ o A/D: mover la raqueta", "Se juega hasta que el rival te gane 3 puntos"],
    pad: ["Stick izquierdo (← →): mover la raqueta", "Se juega hasta que el rival te gane 3 puntos"],
  },
  foosball: {
    title: "Futbolín",
    poi: "futbolin",
    keys: ["W/S o ↑↓: subir y bajar tus varillas (rojas)", "Espacio: girar las varillas y patear", "Hasta que el rival te meta 3"],
    pad: ["Stick izquierdo: subir y bajar tus varillas (rojas)", "A: girar y patear", "Hasta que el rival te meta 3"],
  },
  basket: {
    title: "Canasta",
    poi: null,
    keys: ["↑↓ o W/S: ángulo del tiro", "Mantén Espacio para cargar la fuerza y suelta · 10 pelotas"],
    pad: ["Stick izquierdo (↑ ↓): ángulo del tiro", "Mantén A para cargar la fuerza y suelta · 10 pelotas"],
  },
  arcade: {
    title: "Lluvia de tokens",
    poi: "arcade",
    keys: ["←→: mover el cursor", "Atrapa los tokens verdes y esquiva los bugs rojos · 3 vidas"],
    pad: ["Stick izquierdo: mover el cursor", "Atrapa los tokens verdes y esquiva los bugs rojos · 3 vidas"],
  },
};

/** Clave del récord en localStorage (todos los juegos: más es mejor). */
export function bestKey(id: GameId): string {
  return `hermes-oficina-record-${id}`;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// ── Dardos ─────────────────────────────────────────────────────────────────

/** Sectores de la diana en sentido horario desde arriba (la disposición clásica de 20). */
export const DART_SECTORS = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
/**
 * Anillos en radio normalizado (1 = borde exterior del doble), con las medidas
 * de la diana pintada en la sala (room.ts, dartboardCanvas: 6·12·58–65·98–106 px).
 */
export const DART_RINGS = { bull: 6 / 106, outerBull: 12 / 106, tripleIn: 58 / 106, tripleOut: 65 / 106, doubleIn: 98 / 106 };
export const DARTS_PER_GAME = 9;

/** Puntaje de un dardo en (x, y) normalizados (y hacia arriba). */
export function dartScore(x: number, y: number): { points: number; label: string } {
  const r = Math.hypot(x, y);
  if (r > 1) return { points: 0, label: "Fuera" };
  if (r <= DART_RINGS.bull) return { points: 50, label: "¡Diana! 50" };
  if (r <= DART_RINGS.outerBull) return { points: 25, label: "Anillo de la diana · 25" };
  // Ángulo desde arriba en sentido horario.
  const a = (Math.atan2(x, y) + Math.PI * 2) % (Math.PI * 2);
  const sector = DART_SECTORS[Math.floor(((a + Math.PI / 20) % (Math.PI * 2)) / (Math.PI / 10)) % 20];
  if (r >= DART_RINGS.tripleIn && r <= DART_RINGS.tripleOut) return { points: sector * 3, label: `Triple ${sector} · ${sector * 3}` };
  if (r >= DART_RINGS.doubleIn) return { points: sector * 2, label: `Doble ${sector} · ${sector * 2}` };
  return { points: sector, label: `${sector}` };
}

/** La mira oscila sola (pulso de la mano): donde está en el instante `t` alrededor de `base`. */
export function dartAim(t: number, base: { x: number; y: number }, wobble = 0.32): { x: number; y: number } {
  return { x: base.x + Math.sin(t * 2.3) * wobble * 0.8 + Math.sin(t * 5.1) * wobble * 0.2, y: base.y + Math.sin(t * 1.7 + 1) * wobble * 0.8 + Math.cos(t * 4.3) * wobble * 0.2 };
}

// ── Canasta (lanzar pelotas a la cesta) ────────────────────────────────────

export const BASKET = { distance: 2.6, releaseH: 1.35, rimH: 0.34, rimR: 0.17, ballR: 0.035, balls: 10, g: 9.81 } as const;

/** Rango de la fuerza: 0..1 → velocidad de salida en m/s. */
export function basketSpeed(power: number): number {
  return 3.5 + clamp(power, 0, 1) * 3;
}

/** La fuerza mientras se carga: sube y baja (0..1) en un ciclo de 2,4 s. */
export function basketCharge(heldSeconds: number): number {
  const p = (heldSeconds / 1.2) % 2;
  return p <= 1 ? p : 2 - p;
}

export interface BallFlight {
  x: number;
  y: number;
  vx: number;
  vy: number;
  done: boolean;
  made: boolean;
  /** Golpeó el borde de la cesta. */
  rim: boolean;
}

export function basketThrow(angleDeg: number, power: number): BallFlight {
  const v = basketSpeed(power);
  const a = (clamp(angleDeg, 15, 80) * Math.PI) / 180;
  return { x: 0, y: BASKET.releaseH, vx: v * Math.cos(a), vy: v * Math.sin(a), done: false, made: false, rim: false };
}

/**
 * Un paso de la pelota (x = distancia hacia la cesta, y = altura). Entra si cruza
 * el plano del borde BAJANDO dentro del aro; si lo toca, rebota y se pierde.
 */
export function stepBall(b: BallFlight, dt: number): BallFlight {
  if (b.done) return b;
  const n = { ...b };
  const prevY = n.y;
  n.vy -= BASKET.g * dt;
  n.x += n.vx * dt;
  n.y += n.vy * dt;
  const dx = n.x - BASKET.distance;
  // Después de tocar el borde ya no se evalúa el aro: rebotaba contra él para siempre.
  if (!n.rim && prevY >= BASKET.rimH && n.y < BASKET.rimH && n.vy < 0) {
    const inner = BASKET.rimR - BASKET.ballR;
    if (Math.abs(dx) <= inner) {
      n.made = true;
      n.done = true;
      n.y = BASKET.rimH;
      return n;
    }
    if (Math.abs(dx) <= BASKET.rimR + BASKET.ballR) {
      // Borde: rebota hacia afuera y ya no entra.
      n.rim = true;
      n.vx = Math.sign(dx || 1) * Math.abs(n.vx) * 0.4;
      n.vy = Math.abs(n.vy) * 0.35;
    }
  }
  if (n.y <= BASKET.ballR) {
    n.y = BASKET.ballR;
    n.done = true;
  }
  if (n.x > BASKET.distance + 3 || n.x < -1) n.done = true;
  return n;
}

/** Simula un tiro completo (tests y la vista previa). */
export function simulateBasket(angleDeg: number, power: number, dt = 1 / 240): BallFlight {
  let b = basketThrow(angleDeg, power);
  for (let i = 0; i < 2400 && !b.done; i++) b = stepBall(b, dt);
  return b;
}

// ── Ping-pong (vista desde arriba: x a lo largo de la mesa, z a lo ancho) ──

export const PONG = { L: 2.5, W: 1.4, paddleW: 0.32, paddleSpeed: 1.9, cpuSpeed: 1.05, ballSpeed: 1.6, speedUp: 1.06, maxSpeed: 4.2, lose: 3 } as const;

export interface PongState {
  ball: { x: number; z: number; vx: number; vz: number };
  /** z de cada raqueta (la tuya en −x, la del rival en +x). */
  you: number;
  cpu: number;
  scoreYou: number;
  scoreCpu: number;
  rally: number;
  /** Segundos de pausa antes del saque. */
  serve: number;
  over: boolean;
  /** Qué pasó en este paso (para el sonido y el HUD). */
  event: "" | "hit" | "wall" | "point-you" | "point-cpu";
  seed: number;
}

export function newPong(seed = 1): PongState {
  return { ball: { x: 0, z: 0, vx: -PONG.ballSpeed, vz: 0.4 }, you: 0, cpu: 0, scoreYou: 0, scoreCpu: 0, rally: 0, serve: 1, over: false, event: "", seed };
}

function serve(s: PongState, towardYou: boolean) {
  const r = mulberry32(s.seed + s.scoreYou * 31 + s.scoreCpu * 7)();
  s.ball = { x: 0, z: 0, vx: towardYou ? -PONG.ballSpeed : PONG.ballSpeed, vz: (r - 0.5) * 1.4 };
  s.rally = 0;
  s.serve = 0.9;
}

export function stepPong(prev: PongState, dt: number, input: GameInput): PongState {
  const s: PongState = { ...prev, ball: { ...prev.ball }, event: "" };
  if (s.over) return s;
  const half = PONG.W / 2 - PONG.paddleW / 2;
  s.you = clamp(s.you - input.y * PONG.paddleSpeed * dt, -half, half);
  // El rival sigue la pelota solo cuando viene hacia él, con su velocidad tope.
  const goal = s.ball.vx > 0 ? s.ball.z : 0;
  s.cpu = clamp(s.cpu + clamp(goal - s.cpu, -PONG.cpuSpeed * dt, PONG.cpuSpeed * dt), -half, half);
  if (s.serve > 0) {
    s.serve = Math.max(0, s.serve - dt);
    return s;
  }
  const b = s.ball;
  b.x += b.vx * dt;
  b.z += b.vz * dt;
  if (Math.abs(b.z) > PONG.W / 2) {
    b.z = Math.sign(b.z) * PONG.W / 2;
    b.vz = -b.vz;
    s.event = "wall";
  }
  const edge = PONG.L / 2;
  const hit = (paddle: number, dir: 1 | -1) => {
    const off = (b.z - paddle) / (PONG.paddleW / 2);
    const speed = Math.min(PONG.maxSpeed, Math.hypot(b.vx, b.vz) * PONG.speedUp);
    const ang = clamp(off, -1, 1) * 0.9;
    b.vx = dir * speed * Math.cos(ang);
    b.vz = speed * Math.sin(ang);
    s.rally += 1;
    s.event = "hit";
  };
  if (b.vx < 0 && b.x <= -edge) {
    if (Math.abs(b.z - s.you) <= PONG.paddleW / 2 + 0.02) {
      b.x = -edge;
      hit(s.you, 1);
    } else {
      s.scoreCpu += 1;
      s.event = "point-cpu";
      s.over = s.scoreCpu >= PONG.lose;
      serve(s, false);
    }
  } else if (b.vx > 0 && b.x >= edge) {
    if (Math.abs(b.z - s.cpu) <= PONG.paddleW / 2 + 0.02) {
      b.x = edge;
      hit(s.cpu, -1);
    } else {
      s.scoreYou += 1;
      s.event = "point-you";
      serve(s, true);
    }
  }
  return s;
}

// ── Futbolín (vista desde arriba: x a lo largo, z a lo ancho; tú atacas hacia +x) ──

export const FOOS = { L: 1.2, W: 0.7, goal: 0.13, ballR: 0.018, rodSpeed: 1.1, cpuSpeed: 0.55, kickSpeed: 2.4, friction: 0.45, lose: 3 } as const;
/** Tus varillas (x) y las del rival; cada una con sus muñecos (offsets en z). */
export const FOOS_RODS = {
  you: [
    { x: -0.42, men: [-0.15, 0.15] },
    { x: 0.18, men: [-0.22, 0, 0.22] },
  ],
  cpu: [
    { x: 0.42, men: [-0.15, 0.15] },
    { x: -0.18, men: [-0.22, 0, 0.22] },
  ],
} as const;

export interface FoosState {
  ball: { x: number; z: number; vx: number; vz: number };
  /** Desplazamiento en z de tus varillas y de las del rival (todas juntas). */
  you: number;
  cpu: number;
  /** Giro de tus varillas (0 quietas, 1 pateando) y su temporizador. */
  kick: number;
  cpuKick: number;
  scoreYou: number;
  scoreCpu: number;
  serve: number;
  still: number;
  over: boolean;
  event: "" | "kick" | "wall" | "goal-you" | "goal-cpu";
  seed: number;
}

const FOOS_SLIDE = 0.12;

export function newFoos(seed = 1): FoosState {
  return { ball: { x: 0, z: 0, vx: 0, vz: 0 }, you: 0, cpu: 0, kick: 0, cpuKick: 0, scoreYou: 0, scoreCpu: 0, serve: 0.8, still: 0, over: false, event: "", seed };
}

function foosServe(s: FoosState) {
  const r = mulberry32(s.seed + s.scoreYou * 13 + s.scoreCpu * 29);
  s.ball = { x: 0, z: (r() - 0.5) * 0.3, vx: (r() - 0.5) * 0.6, vz: (r() - 0.5) * 0.8 };
  s.serve = 0.8;
  s.still = 0;
}

/** ¿Algún muñeco de esta varilla toca la pelota? Devuelve el desplazamiento relativo o null. */
function manAt(rodX: number, men: readonly number[], slide: number, b: { x: number; z: number }): number | null {
  if (Math.abs(b.x - rodX) > 0.035) return null;
  for (const m of men) {
    const dz = b.z - (m + slide);
    if (Math.abs(dz) <= 0.045) return dz;
  }
  return null;
}

export function stepFoos(prev: FoosState, dt: number, input: GameInput): FoosState {
  const s: FoosState = { ...prev, ball: { ...prev.ball }, event: "" };
  if (s.over) return s;
  s.you = clamp(s.you - input.y * FOOS.rodSpeed * dt, -FOOS_SLIDE, FOOS_SLIDE);
  if (input.pressed && s.kick <= 0) s.kick = 0.25;
  s.kick = Math.max(0, s.kick - dt);
  // El rival alinea su muñeco más cercano con la pelota.
  const want = clamp(s.ball.z - nearestMan(FOOS_RODS.cpu, s.ball), -FOOS_SLIDE, FOOS_SLIDE);
  s.cpu = clamp(s.cpu + clamp(want - s.cpu, -FOOS.cpuSpeed * dt, FOOS.cpuSpeed * dt), -FOOS_SLIDE, FOOS_SLIDE);
  s.cpuKick = Math.max(0, s.cpuKick - dt);
  if (s.serve > 0) {
    s.serve = Math.max(0, s.serve - dt);
    return s;
  }
  const b = s.ball;
  // Patadas: tus varillas mandan la pelota a +x, las del rival a −x.
  if (s.kick > 0.1) {
    for (const rod of FOOS_RODS.you) {
      const dz = manAt(rod.x, rod.men, s.you, b);
      if (dz !== null) {
        b.vx = FOOS.kickSpeed;
        b.vz = dz * 18;
        b.x = rod.x + 0.04;
        s.event = "kick";
      }
    }
  } else {
    for (const rod of FOOS_RODS.you) {
      // Varilla quieta: la pelota rebota en el muñeco.
      const dz = manAt(rod.x, rod.men, s.you, b);
      if (dz !== null && Math.sign(b.vx) === Math.sign(rod.x - b.x + 1e-6)) b.vx = -b.vx * 0.6;
    }
  }
  for (const rod of FOOS_RODS.cpu) {
    const dz = manAt(rod.x, rod.men, s.cpu, b);
    if (dz !== null && s.cpuKick <= 0) {
      b.vx = -FOOS.kickSpeed * 0.8;
      b.vz = dz * 14;
      b.x = rod.x - 0.04;
      s.cpuKick = 0.5;
      s.event = "kick";
    }
  }
  b.x += b.vx * dt;
  b.z += b.vz * dt;
  const f = Math.max(0, 1 - FOOS.friction * dt);
  b.vx *= f;
  b.vz *= f;
  const halfW = FOOS.W / 2 - FOOS.ballR;
  if (Math.abs(b.z) > halfW) {
    b.z = Math.sign(b.z) * halfW;
    b.vz = -b.vz * 0.8;
    s.event = s.event || "wall";
  }
  const halfL = FOOS.L / 2 - FOOS.ballR;
  if (Math.abs(b.x) > halfL) {
    if (Math.abs(b.z) <= FOOS.goal) {
      if (b.x > 0) {
        s.scoreYou += 1;
        s.event = "goal-you";
      } else {
        s.scoreCpu += 1;
        s.event = "goal-cpu";
        s.over = s.scoreCpu >= FOOS.lose;
      }
      foosServe(s);
      return s;
    }
    b.x = Math.sign(b.x) * halfL;
    b.vx = -b.vx * 0.8;
    s.event = s.event || "wall";
  }
  // Pelota muerta (quieta lejos de todos): se vuelve a sacar.
  s.still = Math.hypot(b.vx, b.vz) < 0.05 ? s.still + dt : 0;
  if (s.still > 4) foosServe(s);
  return s;
}

function nearestMan(rods: readonly { x: number; men: readonly number[] }[], b: { x: number; z: number }): number {
  const rod = rods.reduce((a, r) => (Math.abs(r.x - b.x) < Math.abs(a.x - b.x) ? r : a));
  return rod.men.reduce((a, m) => (Math.abs(m - b.z) < Math.abs(a - b.z) ? m : a));
}

// ── Arcade: "Lluvia de tokens" (diseño propio) ─────────────────────────────
// Un cursor de terminal abajo; del cielo caen tokens verdes (+1) y bugs rojos
// (−1 vida). Cada 10 tokens la lluvia acelera. Tres vidas.

export const RAIN = { cursorW: 0.12, speed: 1.4, lives: 3, spawnEvery: 0.7 } as const;

export interface RainItem {
  x: number;
  y: number;
  bug: boolean;
  v: number;
}

export interface RainState {
  cursor: number;
  items: RainItem[];
  score: number;
  lives: number;
  t: number;
  nextSpawn: number;
  over: boolean;
  event: "" | "catch" | "bug";
  rng: number;
}

export function newRain(seed = 1): RainState {
  return { cursor: 0.5, items: [], score: 0, lives: RAIN.lives, t: 0, nextSpawn: 0.4, over: false, event: "", rng: seed >>> 0 };
}

/** RNG reproducible guardado en el estado (los tests y el QA fijan la semilla). */
function nextRand(s: RainState): number {
  s.rng = (s.rng + 0x6d2b79f5) >>> 0;
  let t = s.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Coordenadas 0..1: x a lo ancho, y de arriba (0) a abajo (1); el cursor vive en y = 0.92. */
export function stepRain(prev: RainState, dt: number, input: GameInput): RainState {
  const s: RainState = { ...prev, items: prev.items.map((i) => ({ ...i })), event: "" };
  if (s.over) return s;
  s.t += dt;
  s.cursor = clamp(s.cursor + input.x * RAIN.speed * dt, RAIN.cursorW / 2, 1 - RAIN.cursorW / 2);
  const level = Math.floor(s.score / 10);
  s.nextSpawn -= dt;
  if (s.nextSpawn <= 0) {
    s.nextSpawn = Math.max(0.25, RAIN.spawnEvery - level * 0.06);
    const bug = nextRand(s) < 0.3 + Math.min(0.2, level * 0.03);
    s.items.push({ x: 0.06 + nextRand(s) * 0.88, y: -0.05, bug, v: 0.32 + level * 0.05 + nextRand(s) * 0.1 });
  }
  const keep: RainItem[] = [];
  for (const it of s.items) {
    it.y += it.v * dt;
    if (it.y >= 0.88 && it.y <= 0.96 && Math.abs(it.x - s.cursor) <= RAIN.cursorW / 2 + 0.02) {
      if (it.bug) {
        s.lives -= 1;
        s.event = "bug";
      } else {
        s.score += 1;
        s.event = s.event || "catch";
      }
      continue;
    }
    if (it.y < 1.05) keep.push(it);
  }
  s.items = keep;
  if (s.lives <= 0) {
    s.lives = 0;
    s.over = true;
  }
  return s;
}
