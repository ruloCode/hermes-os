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
// Las ocho varillas de la mesa de la sala (rojo = tú, azul = la CPU), en el mismo
// orden: portero, defensa, ataque rival, medio, medio rival, ataque, defensa
// rival, portero rival. Con cuatro varillas quedaba una franja muerta de 36 cm
// al centro donde la pelota se dormía y nadie la alcanzaba.

/** La CPU reacciona cada `cpuThink` s (no ve el futuro) y mueve sus varillas a `cpuSpeed`: se le puede ganar. */
export const FOOS = { L: 1.2, W: 0.7, goal: 0.13, ballR: 0.018, rodSpeed: 1.1, cpuSpeed: 0.32, cpuThink: 0.3, kickSpeed: 2.4, friction: 0.3, lose: 3, slide: 0.12 } as const;

function men(n: number): number[] {
  if (n === 1) return [0];
  const span = n === 2 ? 0.3 : n === 3 ? 0.44 : 0.56;
  return Array.from({ length: n }, (_, i) => -span / 2 + (span * i) / (n - 1));
}

const TABLE = [
  { team: "you", n: 1 },
  { team: "you", n: 2 },
  { team: "cpu", n: 3 },
  { team: "you", n: 5 },
  { team: "cpu", n: 5 },
  { team: "you", n: 3 },
  { team: "cpu", n: 2 },
  { team: "cpu", n: 1 },
] as const;

const ALL_RODS = TABLE.map((r, i) => ({ team: r.team, x: -0.525 + i * 0.15, men: men(r.n) }));
export const FOOS_RODS = {
  you: ALL_RODS.filter((r) => r.team === "you").map(({ x, men }) => ({ x, men })),
  cpu: ALL_RODS.filter((r) => r.team === "cpu").map(({ x, men }) => ({ x, men })),
};

export interface FoosState {
  ball: { x: number; z: number; vx: number; vz: number };
  /** Desplazamiento en z de tus varillas y de las del rival (cada equipo, todas juntas). */
  you: number;
  cpu: number;
  /** Giro de tus varillas (0 quietas; >0 pateando) y el enfriamiento de las del rival. */
  kick: number;
  cpuKick: number;
  /** A dónde quiere llevar sus varillas la CPU y cuándo vuelve a decidir. */
  cpuWant: number;
  cpuThinkIn: number;
  scoreYou: number;
  scoreCpu: number;
  serve: number;
  still: number;
  over: boolean;
  event: "" | "kick" | "wall" | "goal-you" | "goal-cpu";
  seed: number;
}

export function newFoos(seed = 1): FoosState {
  const s: FoosState = { ball: { x: 0, z: 0, vx: 0, vz: 0 }, you: 0, cpu: 0, kick: 0, cpuKick: 0, cpuWant: 0, cpuThinkIn: 0, scoreYou: 0, scoreCpu: 0, serve: 0.8, still: 0, over: false, event: "", seed };
  foosServe(s);
  return s;
}

function foosServe(s: FoosState) {
  const r = mulberry32(s.seed + s.scoreYou * 13 + s.scoreCpu * 29);
  // Saque por el centro, con algo de velocidad hacia un lado al azar.
  s.ball = { x: 0, z: (r() - 0.5) * 0.3, vx: (r() < 0.5 ? -1 : 1) * (0.3 + r() * 0.3), vz: (r() - 0.5) * 0.6 };
  s.serve = 0.8;
  s.still = 0;
}

/** ¿Algún muñeco de esta varilla toca la pelota? Devuelve el desplazamiento relativo o null. */
function manAt(rodX: number, rodMen: readonly number[], slide: number, b: { x: number; z: number }): number | null {
  if (Math.abs(b.x - rodX) > 0.04) return null;
  for (const m of rodMen) {
    const dz = b.z - (m + slide);
    if (Math.abs(dz) <= 0.045) return dz;
  }
  return null;
}

/** El muñeco (offset) de la varilla rival a la que se acerca la pelota que mejor la alcanza. */
function cpuTarget(b: { x: number; z: number; vx: number }): number {
  const ahead = FOOS_RODS.cpu.filter((r) => (b.vx <= 0 ? r.x <= b.x + 0.05 : r.x >= b.x - 0.05));
  const rods = ahead.length ? ahead : FOOS_RODS.cpu;
  const rod = rods.reduce((a, r) => (Math.abs(r.x - b.x) < Math.abs(a.x - b.x) ? r : a));
  return rod.men.reduce((a, m) => (Math.abs(m - b.z) < Math.abs(a - b.z) ? m : a));
}

export function stepFoos(prev: FoosState, dt: number, input: GameInput): FoosState {
  const s: FoosState = { ...prev, ball: { ...prev.ball }, event: "" };
  if (s.over) return s;
  s.you = clamp(s.you - input.y * FOOS.rodSpeed * dt, -FOOS.slide, FOOS.slide);
  if (input.pressed && s.kick <= 0) s.kick = 0.25;
  s.kick = Math.max(0, s.kick - dt);
  // El rival decide cada cpuThink s qué muñeco alinear con la pelota y va, a su velocidad tope.
  s.cpuThinkIn -= dt;
  if (s.cpuThinkIn <= 0) {
    s.cpuThinkIn = FOOS.cpuThink;
    s.cpuWant = clamp(s.ball.z - cpuTarget(s.ball), -FOOS.slide, FOOS.slide);
  }
  s.cpu = clamp(s.cpu + clamp(s.cpuWant - s.cpu, -FOOS.cpuSpeed * dt, FOOS.cpuSpeed * dt), -FOOS.slide, FOOS.slide);
  s.cpuKick = Math.max(0, s.cpuKick - dt);
  if (s.serve > 0) {
    s.serve = Math.max(0, s.serve - dt);
    return s;
  }
  const b = s.ball;
  for (const rod of FOOS_RODS.you) {
    const dz = manAt(rod.x, rod.men, s.you, b);
    if (dz === null) continue;
    if (s.kick > 0.1) {
      // Tus varillas giran: la pelota sale hacia el arco rival (+x).
      b.vx = FOOS.kickSpeed;
      b.vz = dz * 18;
      b.x = rod.x + 0.045;
      s.event = "kick";
    } else if (Math.sign(b.vx) === Math.sign(rod.x - b.x + 1e-6)) {
      // Quieta: la pelota rebota en el muñeco.
      b.vx = -b.vx * 0.6;
      b.x = rod.x - Math.sign(rod.x - b.x + 1e-6) * 0.045;
    }
  }
  for (const rod of FOOS_RODS.cpu) {
    const dz = manAt(rod.x, rod.men, s.cpu, b);
    if (dz === null) continue;
    if (s.cpuKick <= 0) {
      b.vx = -FOOS.kickSpeed * 0.8;
      b.vz = dz * 14;
      b.x = rod.x - 0.045;
      s.cpuKick = 0.6;
      s.event = "kick";
    } else if (Math.sign(b.vx) === Math.sign(rod.x - b.x + 1e-6)) {
      b.vx = -b.vx * 0.6;
      b.x = rod.x - Math.sign(rod.x - b.x + 1e-6) * 0.045;
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
  // La mesa tiene una leve pendiente: una pelota casi quieta rueda hacia la varilla más cercana.
  s.still = Math.hypot(b.vx, b.vz) < 0.12 ? s.still + dt : 0;
  if (s.still > 1.2) {
    const nearest = ALL_RODS.reduce((a, r) => (Math.abs(r.x - b.x) < Math.abs(a.x - b.x) ? r : a));
    b.vx += Math.sign(nearest.x - b.x || 1) * 0.25;
    b.vz += (mulberry32(s.seed + Math.round(b.x * 1000))() - 0.5) * 0.2;
    s.still = 0;
  }
  return s;
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
