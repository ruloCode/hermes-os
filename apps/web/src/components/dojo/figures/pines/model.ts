// Modelo puro de la máquina "pines" (Fig 5): qué ejemplos muestra cada lección,
// en qué orden golpea el cabezal, cuántos pasos cuenta el contador y qué dice el
// readout. Sin DOM: la vista y el movimiento leen todo de aquí, así el número
// del contador y el dibujo no se pueden desacoplar.
//
// Los números salen del catálogo del Dojo (packages/shared/src/dojo-catalog.ts):
// el n del código de c-pasos y el de su nota, la tabla 10 / 1.000 / 100.000 de
// c-crece y los casos de c-suma-gigante (3, 100 y 10**12) con su límite de 1 s.

import { dojoItem, type DojoItem } from "@hermes/shared";

// ── Datos del catálogo ─────────────────────────────────────────────────

const item = (id: string): DojoItem => {
  const found = dojoItem(id);
  if (!found) throw new Error(`pines: no existe la lección ${id} en el catálogo`);
  return found;
};

const textOf = (it: DojoItem) => (it.blocks ?? []).map((b) => ("text" in b ? b.text : "") + ("code" in b ? `\n${b.code}` : "") + ("note" in b ? `\n${b.note ?? ""}` : "")).join("\n");

const toInt = (s: string) => Number(s.replace(/[._]/g, ""));

/** c-pasos: `n = 1000` en el código y «Cambia n a 2000» en la nota. */
function pasosData() {
  const text = textOf(item("c-pasos"));
  const code = Number(/^n = (\d+)/m.exec(text)?.[1] ?? 1000);
  const note = Number(/n a (\d+)/.exec(text)?.[1] ?? 2000);
  return { code, note };
}

/** c-crece: «con n = 10 … con n = 1.000 … con n = 100.000». */
function creceData() {
  const first = item("c-crece").blocks?.[0];
  const text = first && "text" in first ? first.text : "";
  const ns = [...text.matchAll(/con n = ([\d.]+)/g)].map((m) => toInt(m[1]));
  return ns.length ? ns : [10, 1000, 100000];
}

/** c-suma-gigante: los casos con su n, lo esperado y el límite de tiempo. */
function sumaData() {
  const problem = item("c-suma-gigante").problem;
  const cases: { n: number; text: string; expected: string }[] = [];
  for (const c of problem?.cases ?? []) {
    if (c.args && typeof c.args[0] === "number") {
      const n = c.args[0];
      if (n === 3 || n === 100) cases.push({ n, text: dots(n), expected: String(c.expected) });
    } else if (c.argsExpr) {
      const power = /^\[10\*\*(\d+)\]$/.exec(c.argsExpr.replace(/\s/g, ""));
      if (power && c.expectedExpr) {
        const e = Number(power[1]);
        cases.push({ n: 10 ** e, text: `10${superscript(e)}`, expected: c.expectedExpr });
      }
    }
  }
  return { cases, limitMs: problem?.timeLimitMs ?? 1000 };
}

// «Python en el navegador da del orden de diez millones de pasos simples por
// segundo» (c-crece). Es la velocidad con la que el cronómetro convierte pasos
// en tiempo y la que hace que el for de c-suma-gigante se quede corto.
export const STEPS_PER_SECOND = 10_000_000;

// ── Formato ────────────────────────────────────────────────────────────

/** 1000000 → "1.000.000" (separador de miles en español). */
export function dots(value: number | bigint | string): string {
  const raw = typeof value === "string" ? value : typeof value === "bigint" ? value.toString() : Math.round(value).toString();
  return raw.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

const SUP = "⁰¹²³⁴⁵⁶⁷⁸⁹";
export const superscript = (n: number) => String(n).split("").map((d) => SUP[Number(d)]).join("");

const seconds = (s: number) => (s >= 1 ? `${dots(Math.floor(s))} s` : `${s.toFixed(1).replace(".", ",")} s`);

// ── Ejemplos ───────────────────────────────────────────────────────────

/**
 * Qué hace la máquina en un ejemplo:
 * - "for": un for de n vueltas → una fila de n pines (O(n)).
 * - "for-for": un for dentro de otro → la rejilla n × n (O(n²)).
 * - "suma": el for de «Suma hasta n»: cada vuelta i hunde i pines (la escalera).
 * - "fuga": el mismo for con n = 10¹² y un segundo de reloj: se queda corto.
 * - "formula": la escalera y su copia al revés encajan en n × (n + 1): 3 pasos.
 */
export type Loop = "for" | "for-for" | "suma" | "fuga" | "formula";

export interface Example {
  n: number;
  /** n como se escribe en la lección ("1.000", "10¹²"). */
  nText: string;
  loop: Loop;
  /** Lo esperado según el catálogo (solo suma). */
  expected?: string;
}

export const BOARD = 10; // pines por lado que caben en el tablero (más una fila para la suma)
export const ROWS = BOARD + 1;

export interface Lesson {
  id: string;
  title: string;
  /** Las posiciones de la perilla: los n que se pueden elegir. */
  detents: { n: number; nText: string }[];
  /** El recorrido en bucle. */
  tour: Example[];
}

const ex = (n: number, loop: Loop, extra: Partial<Example> = {}): Example => ({ n, nText: dots(n), loop, ...extra });

export function lessonOf(id: string, reveal: boolean): Lesson {
  if (id === "c-pasos") {
    const { code, note } = pasosData();
    const small = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    return {
      id,
      title: "Contar pasos",
      detents: [...small, code, note].map((n) => ({ n, nText: dots(n) })),
      tour: [ex(4, "for"), ex(4, "for-for"), ex(10, "for"), ex(10, "for-for"), ex(code, "for"), ex(code, "for-for")],
    };
  }
  if (id === "c-crece") {
    const ns = creceData();
    return {
      id,
      title: "Cuando n crece",
      detents: ns.map((n) => ({ n, nText: dots(n) })),
      tour: ns.flatMap((n) => [ex(n, "for"), ex(n, "for-for")]),
    };
  }
  const { cases } = sumaData();
  const huge = cases.find((c) => c.n > 1e9);
  return {
    id,
    title: "Suma gigante",
    detents: cases.map((c) => ({ n: c.n, nText: c.text })),
    tour: cases.map((c) =>
      reveal
        ? { n: c.n, nText: c.text, loop: "formula" as Loop, expected: c.expected }
        : { n: c.n, nText: c.text, loop: (c === huge ? "fuga" : "suma") as Loop, expected: c.expected },
    ),
  };
}

/** El mismo bucle con otro n (las flechas mueven la perilla y conservan el bucle). */
export function withN(example: Example, lesson: Lesson, detent: number): Example {
  const d = lesson.detents[detent];
  const twin = lesson.tour.find((t) => t.n === d.n && t.loop === example.loop) ?? lesson.tour.find((t) => t.n === d.n);
  if (twin) return twin;
  return { ...example, n: d.n, nText: d.nText };
}

export const detentOf = (lesson: Lesson, n: number) => Math.max(0, lesson.detents.findIndex((d) => d.n === n));

// ── Escala del tablero ─────────────────────────────────────────────────

/**
 * El tablero tiene 10 × 11 pines. Con n ≤ 10 cada pin es un paso; con n mayor,
 * cada pin es un bloque de b × b pasos (b = n / 10) y el contador lleva la
 * cuenta exacta: avanza b (o b²) por golpe, así que las ruedas de abajo no se
 * mueven y se ve la escala. No se dibujan 10¹⁰ pines: se dice.
 */
export function scaleOf(example: Example) {
  const side = Math.min(example.n, BOARD);
  const block = example.n / side; // n ≤ 10 → 1
  return { side, block };
}

// ── Línea de tiempo ────────────────────────────────────────────────────

export interface Pose {
  /** Columna del puente (a, sobre x) y fila del cabezal (b, sobre y), en índices de pin. */
  a: number;
  b: number;
  /** Altura de la punta del martillo: 0 arriba, 1 tocando el pin de pie, PRESS_DEPTH abajo del todo. */
  tip: number;
}

export interface PinEvent {
  a: number;
  b: number;
  /** Cuándo queda hundido del todo. */
  at: number;
  /** "tap": golpe del martillo · "A": escalera · "B": la copia al revés. */
  kind: "tap" | "A" | "B";
}

export interface Track {
  example: Example;
  duration: number;
  pins: PinEvent[];
  pose: (t: number) => Pose;
  /** Pasos contados en el instante t (enteros, salvo la fuga, que corre continua). */
  steps: (t: number) => number;
  /** Segundos de reloj simulado (pasos / STEPS_PER_SECOND). */
  clock: (t: number) => number;
  /** Para "suma": vueltas del bucle completas en t. */
  laps: (t: number) => number;
  /** Índice en `pins` del pin que el martillo está hundiendo en t (o -1). */
  pressing: (t: number) => number;
}

export const HOME: Pose = { a: -1.15, b: 0, tip: 0 };
/** Cuánto baja la punta, en "alturas de pin" (1 = toca la cabeza de un pin de pie). */
export const PRESS_DEPTH = 2;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const smooth = (u: number) => {
  const x = clamp(u, 0, 1);
  return x * x * x * (x * (x * 6 - 15) + 10);
};

interface Seg {
  t0: number;
  travel: number;
  strike: number;
  from: { a: number; b: number };
  to: { a: number; b: number };
  pin: number; // índice en pins, -1 = no hunde
  adds: number; // pasos que suma al hundir
}

/** Golpes uno por uno, cada vez más rápido (el bucle "agarra vuelo"). */
function tapTrack(example: Example, taps: { a: number; b: number; adds: number; quick?: boolean; lap?: boolean }[]): Track {
  const segs: Seg[] = [];
  const pins: PinEvent[] = [];
  let t = 0.35;
  let at = { a: HOME.a, b: HOME.b };
  taps.forEach((tap, k) => {
    const pace = tap.quick ? 0.12 : Math.max(0.075, 0.46 * Math.pow(0.88, k));
    const dist = Math.hypot(tap.a - at.a, tap.b - at.b);
    const travel = pace * 0.5 + (dist > 1.5 ? 0.12 + dist * 0.035 : 0) + (tap.lap ? 0.12 : 0);
    const strike = pace * 0.55;
    const pin = pins.length;
    pins.push({ a: tap.a, b: tap.b, at: t + travel + strike * 0.42, kind: example.loop === "suma" ? "A" : "tap" });
    segs.push({ t0: t, travel, strike, from: at, to: { a: tap.a, b: tap.b }, pin, adds: tap.adds });
    t += travel + strike;
    at = { a: tap.a, b: tap.b };
  });
  const end = t;
  const back = 0.6;
  const find = (time: number) => {
    let lo = 0;
    let hi = segs.length - 1;
    if (hi < 0 || time < segs[0].t0) return -1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (segs[mid].t0 <= time) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const counted = (time: number) => {
    let sum = 0;
    let laps = 0;
    for (const s of segs) {
      if (time >= pins[s.pin].at) {
        sum += s.adds;
        if (s.adds) laps++;
      } else break;
    }
    return { sum, laps };
  };
  return {
    example,
    duration: end + back,
    pins,
    pose(time) {
      const k = find(time);
      if (k < 0) return { ...HOME };
      const s = segs[k];
      const u = time - s.t0;
      if (k === segs.length - 1 && u > s.travel + s.strike) {
        // De vuelta a casa, martillo arriba.
        const w = smooth((time - end) / back);
        return { a: s.to.a + (HOME.a - s.to.a) * w, b: s.to.b + (HOME.b - s.to.b) * w, tip: 0 };
      }
      if (u < s.travel) {
        const w = smooth(u / s.travel);
        return { a: s.from.a + (s.to.a - s.from.a) * w, b: s.from.b + (s.to.b - s.from.b) * w, tip: 0 };
      }
      const v = (u - s.travel) / s.strike;
      const down = v < 0.42 ? smooth(v / 0.42) : 1 - smooth((v - 0.42) / 0.58);
      return { ...s.to, tip: down * PRESS_DEPTH };
    },
    steps: (time) => counted(time).sum,
    clock: (time) => counted(time).sum / STEPS_PER_SECOND,
    laps: (time) => counted(time).laps,
    pressing(time) {
      const k = find(time);
      if (k < 0) return -1;
      const s = segs[k];
      return time >= s.t0 + s.travel && time <= s.t0 + s.travel + s.strike ? s.pin : -1;
    },
  };
}

/** n = 10¹²: el martillo golpetea en el primer pin y el reloj se acaba al segundo. */
function fugaTrack(example: Example, limitMs: number): Track {
  const start = 0.6;
  const run = 3.6; // 1 s de reloj en 3,6 s de animación
  const limit = limitMs / 1000;
  const total = STEPS_PER_SECOND * limit;
  const part = (t: number) => clamp((t - start) / run, 0, 1);
  return {
    example,
    duration: start + run + 0.8,
    pins: [],
    pose(t) {
      if (t < start) {
        const w = smooth(t / start);
        return { a: HOME.a + (0 - HOME.a) * w, b: HOME.b, tip: 0 };
      }
      if (t < start + run) {
        // Golpetea sin poder hundir nada: con este n, un pin son 10¹¹ vueltas.
        const v = ((t - start) * 7) % 1;
        return { a: 0, b: 0, tip: 0.45 + 0.55 * Math.sin(v * Math.PI) };
      }
      const w = smooth((t - start - run) / 0.6);
      return { a: 0, b: 0, tip: (1 - w) * 0.45 };
    },
    steps: (t) => Math.floor(total * part(t)),
    clock: (t) => limit * part(t),
    laps: (t) => Math.floor(total * part(t)),
    pressing: () => -1,
  };
}

/** La escalera y su copia al revés: encajan en un rectángulo de side × (side + 1). */
function formulaTrack(example: Example): Track {
  const { side } = scaleOf(example);
  const pins: PinEvent[] = [];
  let t = 0.35;
  const gap = Math.min(0.06, 2.2 / (side * (side + 1)));
  for (let i = 1; i <= side; i++) for (let b = 0; b < i; b++) pins.push({ a: i - 1, b, at: (t += gap), kind: "A" });
  t += 0.7;
  // La copia volteada entra desde la esquina opuesta: primero la vuelta n.
  for (let i = side; i >= 1; i--) for (let b = side; b >= i; b--) pins.push({ a: i - 1, b, at: (t += gap), kind: "B" });
  const ops = [t + 0.35, t + 0.6, t + 0.85]; // ×, +, /: tres operaciones, sea n 3 o un billón
  return {
    example,
    duration: t + 1.2,
    pins,
    pose: () => ({ ...HOME }),
    steps: (time) => ops.filter((o) => time >= o).length,
    clock: () => 0,
    laps: () => 0,
    pressing: () => -1,
  };
}

export function trackOf(example: Example, limitMs = sumaData().limitMs): Track {
  const { side, block } = scaleOf(example);
  if (example.loop === "fuga") return fugaTrack(example, limitMs);
  if (example.loop === "formula") return formulaTrack(example);
  if (example.loop === "suma") {
    // Vuelta i: total += i → hunde i pines de la columna a = i − 1. A escala, cada
    // columna son `block` vueltas.
    const taps: { a: number; b: number; adds: number; quick?: boolean; lap?: boolean }[] = [];
    for (let i = 1; i <= side; i++) for (let b = 0; b < i; b++) taps.push({ a: i - 1, b, adds: b === i - 1 ? block : 0, quick: true, lap: b === 0 });
    return tapTrack(example, taps);
  }
  if (example.loop === "for") {
    return tapTrack(
      example,
      Array.from({ length: side }, (_, b) => ({ a: 0, b, adds: block })),
    );
  }
  const taps: { a: number; b: number; adds: number }[] = [];
  for (let a = 0; a < side; a++) for (let b = 0; b < side; b++) taps.push({ a, b, adds: block * block });
  return tapTrack(example, taps);
}

// ── Readout ────────────────────────────────────────────────────────────

const orderOf = (loop: Loop) => (loop === "for" ? "O(n)" : "O(n²)");

/** Lo que dice la esquina de la tarjeta en el instante t. */
export function readoutAt(track: Track, t: number): string {
  const { example } = track;
  const done = t >= track.duration - 0.05;
  const steps = track.steps(t);
  if (example.loop === "for" || example.loop === "for-for") {
    const total = example.loop === "for" ? example.n : example.n * example.n;
    return done || steps >= total
      ? `n = ${example.nText} · ${orderOf(example.loop)} = ${dots(total)} pasos`
      : `n = ${example.nText} · ${orderOf(example.loop)} · ${dots(steps)} pasos`;
  }
  if (example.loop === "suma") {
    const v = track.laps(t) === 0 ? 0 : steps;
    const sum = (v * (v + 1)) / 2;
    return `n = ${example.nText} · total = ${dots(sum)} · ${dots(v)} pasos`;
  }
  if (example.loop === "fuga") {
    const clock = track.clock(t);
    return clock >= 1 - 1e-9
      ? `n = ${example.nText} · 1 s: ${dots(steps)} de ${example.nText} pasos`
      : `n = ${example.nText} · ${seconds(clock)} · ${dots(steps)} pasos`;
  }
  // formula
  const big = example.n > 1e6;
  const value = big ? "" : ` = ${dots(BigInt(example.n) * BigInt(example.n + 1) / 2n)}`;
  const expr = big ? "n × (n + 1) / 2" : `${example.nText} × ${dots(example.n + 1)} / 2`;
  const ops = steps;
  return ops ? `n = ${example.nText} · ${expr}${value} · ${ops} paso${ops === 1 ? "" : "s"}` : `n = ${example.nText} · la escalera y su copia`;
}

/** Texto para lectores de pantalla (se escribe al cambiar de ejemplo, no por cuadro). */
export function spokenOf(example: Example): string {
  const { side, block } = scaleOf(example);
  const scale = block > 1 ? ` A escala: cada pin del tablero vale ${dots(example.loop === "for-for" ? block * block : block)} pasos.` : "";
  switch (example.loop) {
    case "for":
      return `Un for con n = ${example.nText}: el martillo golpea una fila de ${side} pines y el contador llega a ${dots(example.n)} pasos.${scale}`;
    case "for-for":
      return `Un for dentro de otro con n = ${example.nText}: el martillo recorre la rejilla de ${side} × ${side} pines y el contador llega a ${dots(example.n * example.n)} pasos.${scale}`;
    case "suma":
      return `Suma de 1 a ${example.nText} con un for: cada vuelta hunde una columna más larga, una escalera de ${example.nText} vueltas.`;
    case "fuga":
      return `Con n = ${example.nText} el for da diez millones de vueltas en un segundo y se acaba el tiempo sin terminar la primera columna.`;
    default:
      return `La escalera 1 + 2 + … + ${example.nText} y la misma escalera al revés llenan un rectángulo de ${example.nText} por ${example.nText === "10¹²" ? "n + 1" : dots(example.n + 1)}: la suma es la mitad, en tres operaciones.`;
  }
}

/** El valor exacto de 1 + … + n (para la leyenda), en BigInt. */
export const triangle = (n: number) => (BigInt(n) * BigInt(n + 1)) / 2n;

export const SUMA = sumaData;
