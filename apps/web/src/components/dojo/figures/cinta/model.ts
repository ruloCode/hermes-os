// Modelo puro de la cinta: de la lección salen los ejemplos (los mismos del
// catálogo), de cada ejemplo las vueltas del for, y de (ejemplo, tiempo) TODO lo
// que se ve: dónde está cada ficha, si la trampa está abierta, qué marca el
// contador y el texto del readout. Nada de DOM aquí.
import { dojoItem, pyCall, pyRepr, type DojoItem } from "@hermes/shared";
import { BIN, BT, EXIT_X, HOPPER, MOUTH_X, PEDESTAL_X, PITCH, PRESS_X, RACK, RACK_COLS, RACK_H, RACK_PITCH, RACK_ROWS, TRAY, X_END, X_HEAD } from "./view";

/** Qué hace la estación al final de la cinta con cada ficha. */
export type Station = "sum" | "count" | "best" | "stamp";

export interface Example {
  /** La llamada tal como la escribirías en Python. */
  call: string;
  /** Las fichas, en el orden en que el for las recorre. */
  items: number[];
  /** Lo que la función debe devolver (del catálogo). */
  expected: number | string[];
}

export interface Spec {
  id: string;
  station: Station;
  /** Lección de concepto (el mecanismo siempre a la vista). */
  concept: boolean;
  /** Nombre del acumulador en el readout. */
  acc: string;
  examples: Example[];
}

/** Lo que pasa en una vuelta. */
export interface Step {
  value: number;
  /** La ficha entra a la estación (si no, cae a la bandeja de abajo). */
  accept: boolean;
  /** El acumulador después de esta vuelta. */
  acc: number;
  /** FizzBuzz: lo que estampa el sello. */
  word: string;
  /** "El mayor": la ficha que esta vuelta saca del podio (o -1). */
  displaces: number;
}

const STATIONS: Record<string, Station> = {
  "f-repetir": "sum",
  "f-suma-hasta": "sum",
  "f-contar-pares": "count",
  "f-mayor": "best",
  "f-fizzbuzz": "stamp",
};

const ACC: Record<Station, string> = { sum: "total", count: "cuenta", best: "mejor", stamp: "res" };

export const CINTA_IDS = Object.keys(STATIONS);

const range = (a: number, b: number) => Array.from({ length: Math.max(0, b - a) }, (_, i) => a + i);

/**
 * f-repetir: los dos acumuladores de la lección, leídos de su código (el de
 * `range(1, 5)` y la pregunta del `for x in [2, 4, 6]`). Si la respuesta de la
 * pregunta no coincide con la suma, el ejemplo no se muestra: la figura no
 * cuenta algo distinto de lo que dice la lección.
 */
function lessonExamples(item: DojoItem): Example[] {
  const out: Example[] = [];
  for (const block of item.blocks ?? []) {
    const code = block.kind === "code" ? block.code : block.kind === "check" ? (block.code ?? "") : "";
    if (!/total\s*\+=/.test(code)) continue;
    const ranged = code.match(/for (\w+) in range\((-?\d+), (-?\d+)\)/);
    const listed = code.match(/for (\w+) in \[([^\]]*)\]/);
    let items: number[] | null = null;
    let call = "";
    if (ranged) {
      items = range(Number(ranged[2]), Number(ranged[3]));
      call = `for ${ranged[1]} in range(${ranged[2]}, ${ranged[3]})`;
    } else if (listed) {
      items = listed[2]!.split(",").map((part) => Number(part.trim()));
      call = `for ${listed[1]} in ${pyRepr(items)}`;
    }
    if (!items || items.some((value) => !Number.isFinite(value))) continue;
    const total = items.reduce((sum, value) => sum + value, 0);
    if (block.kind === "check" && Number(block.answer) !== total) continue;
    out.push({ call, items, expected: total });
  }
  return out;
}

function problemExamples(item: DojoItem, station: Station): Example[] {
  const problem = item.problem;
  if (!problem) return [];
  return problem.cases
    .filter((c) => !c.hidden && c.args)
    .map((c) => {
      const args = c.args!;
      const first = args[0];
      const items = Array.isArray(first) ? (first as number[]) : range(1, Number(first) + 1);
      return { call: pyCall(problem.fn, args), items, expected: c.expected as number | string[] };
    })
    .filter((example) => example.items.length <= RACK_COLS * RACK_ROWS || station !== "stamp");
}

export function specOf(id: string): Spec | null {
  const station = STATIONS[id];
  const item = dojoItem(id);
  if (!station || !item) return null;
  const concept = item.kind === "concepto";
  const examples = concept ? lessonExamples(item) : problemExamples(item, station);
  if (!examples.length) return null;
  return { id, station, concept, acc: ACC[station], examples };
}

const wordOf = (i: number) => (i % 15 === 0 ? "FizzBuzz" : i % 3 === 0 ? "Fizz" : i % 5 === 0 ? "Buzz" : String(i));

export function stepsOf(station: Station, items: number[]): Step[] {
  const steps: Step[] = [];
  let acc = 0;
  let best = 0;
  let holder = -1;
  items.forEach((value, index) => {
    if (station === "sum") {
      acc += value;
      steps.push({ value, accept: true, acc, word: "", displaces: -1 });
    } else if (station === "count") {
      const even = value % 2 === 0;
      if (even) acc += 1;
      steps.push({ value, accept: even, acc, word: "", displaces: -1 });
    } else if (station === "best") {
      // mejor = numeros[0] antes del for: la primera ficha va directo al podio.
      const better = index === 0 || value > best;
      const displaces = better && index > 0 ? holder : -1;
      if (better) {
        best = value;
        holder = index;
      }
      steps.push({ value, accept: better, acc: best, word: "", displaces });
    } else {
      steps.push({ value, accept: true, acc: index + 1, word: wordOf(value), displaces: -1 });
    }
  });
  return steps;
}

// ── El reloj de un ejemplo ──────────────────────────────────────────────

/** La cinta trae la lista desde la tolva. */
export const LEAD = 1.4;
/** El resultado se queda a la vista antes de pasar al siguiente ejemplo. */
export const TAIL = 2.8;
/** Momento de la vuelta en que el contador registra la ficha. */
const REGISTER = 0.8;

export const stepLength = (station: Station, count: number) => (station === "stamp" && count > 6 ? 1.2 : 1.8);
export const durationOf = (station: Station, count: number) => LEAD + count * stepLength(station, count) + TAIL;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
/** smoothstep de a a b. */
export const ease = (a: number, b: number, x: number) => {
  const u = clamp01((x - a) / (b - a));
  return u * u * (3 - 2 * u);
};
const lerp = (a: number, b: number, s: number) => a + (b - a) * s;
/** Caída con gravedad: arranca lenta y llega rápida. */
const fall = (a: number, b: number, s: number) => a + (b - a) * clamp01(s) * clamp01(s);

export interface TokenPose {
  x: number;
  y: number;
  z: number;
  alpha: number;
  text: string;
  lit: boolean;
}

export interface Moment {
  /** Vuelta en curso (0…n-1); -1 mientras la lista entra; n al terminar. */
  k: number;
  /** Fracción de la vuelta (o de la entrada). */
  u: number;
  /** Posición de la banda, en pasos. */
  belt: number;
  tokens: TokenPose[];
  /** Trampa: 0 cerrada, 1 abierta. */
  flap: number;
  /** Sello: 0 arriba, 1 abajo. */
  ram: number;
  /** El lector está leyendo la ficha de esta vuelta. */
  lamp: boolean;
  /** Lo que marca el acumulador ahora (null: aún no hay "mejor"). */
  acc: number | null;
  /** Vueltas ya registradas. */
  registered: number;
  done: boolean;
}

export const binSlot = (m: number): [number, number, number] => {
  const spots: [number, number][] = [
    [BIN.x + 13, -8.6],
    [BIN.x + 15, 8.6],
    [BIN.x + 14, 7.6],
    [BIN.x + 12.5, -7.8],
  ];
  const [x, y] = spots[m % spots.length]!;
  return [x, y, 1.2 + Math.floor(m / 2) * 4];
};

export const traySlot = (m: number): [number, number, number] => {
  const spots: [number, number][] = [
    [TRAY.x + 10.5, -8],
    [TRAY.x + 25.5, 8],
    [TRAY.x + 10.5, 8],
    [TRAY.x + 25.5, -8],
  ];
  const [x, y] = spots[m % spots.length]!;
  return [x, y, 1.2 + Math.floor(m / 4) * 4];
};

export const rackSlot = (j: number): [number, number, number] => [
  RACK.x + 1 + RACK_PITCH / 2 + (j % RACK_COLS) * RACK_PITCH,
  RACK.y + 1 + RACK_PITCH / 2 + Math.floor(j / RACK_COLS) * RACK_PITCH,
  RACK_H,
];

export function momentOf(station: Station, example: Example, t: number): Moment {
  const steps = stepsOf(station, example.items);
  const n = steps.length;
  const length = stepLength(station, n);
  let k: number;
  let u: number;
  if (t < LEAD) {
    k = -1;
    u = t / LEAD;
  } else {
    const s = (t - LEAD) / length;
    k = Math.min(Math.floor(s), n);
    u = k >= n ? 0 : s - k;
  }
  const done = k >= n;
  const belt = k < 0 ? -3 + 3 * ease(0.1, 0.85, u) : done ? n : k + ease(0.12, 0.5, u);
  const registered = k < 0 ? 0 : done ? n : k + (u >= REGISTER ? 1 : 0);
  const acc = registered > 0 ? steps[registered - 1]!.acc : station === "best" ? null : 0;
  const live = k >= 0 && !done;
  const now = live ? steps[k]! : null;
  const after = (u - 0.5) / 0.5;

  // Contadores para saber dónde quedó cada ficha que ya pasó.
  let bin = 0;
  let tray = 0;
  const binOf: number[] = [];
  const trayOf: number[] = [];
  const displacedAt: number[] = steps.map(() => -1);
  steps.forEach((step, index) => {
    if (!step.accept && (station === "count" || station === "best")) binOf[index] = bin++;
    if (step.displaces >= 0) {
      displacedAt[step.displaces] = index;
      trayOf[step.displaces] = tray++;
    }
  });

  const tokens = steps.map((step, j): TokenPose => {
    const label = station === "stamp" && (j < k || (j === k && after >= 0.3)) ? step.word : String(step.value);
    const lit = live && j === k && u < 0.97;
    const pose = (x: number, y: number, z: number, alpha = 1): TokenPose => ({ x, y, z, alpha, text: label, lit });
    // En la cinta: la vuelta k espera bajo el lector, las demás detrás.
    const onBelt = () => {
      const s = X_HEAD + (belt - j) * PITCH;
      // Más allá de la tolva no se ve: ahí esperan las que faltan.
      return pose(s, 0, BT, s < HOPPER.x + 10 ? 0 : 1);
    };
    const resting = (): TokenPose => {
      if (station === "stamp") return pose(...rackSlot(j));
      if (!step.accept) return pose(...binSlot(binOf[j]!));
      if (station === "best") {
        const out = displacedAt[j]!;
        if (out >= 0 && (out < k || done)) return pose(...traySlot(trayOf[j]!));
        if (out >= 0 && out === k) {
          // La ficha nueva la empuja fuera del podio y cae a la bandeja.
          const [tx, ty, tz] = traySlot(trayOf[j]!);
          const push = ease(0.38, 0.62, after);
          const drop = clamp01((after - 0.62) / 0.26);
          return pose(lerp(lerp(PEDESTAL_X, PEDESTAL_X + 16, push), tx, ease(0.62, 0.86, after)), lerp(0, ty, drop), fall(BT, tz, drop));
        }
        return pose(PEDESTAL_X, 0, BT);
      }
      return pose(MOUTH_X, 0, BT - 5, 0);
    };
    if (j > k || (j === k && u < 0.5) || k < 0) return onBelt();
    if (j < k || done) return resting();
    // La ficha de esta vuelta sale de la banda hacia su destino.
    if (station === "stamp") {
      const [rx, ry, rz] = rackSlot(j);
      if (after < 0.5) return pose(lerp(X_END, PRESS_X, ease(0, 0.18, after)), 0, BT);
      // Sale por la ranura de la prensa y cae en su casilla de la bandeja.
      if (after < 0.64) return pose(lerp(PRESS_X, EXIT_X, ease(0.5, 0.64, after)), 0, BT);
      const s = ease(0.64, 0.96, after);
      return pose(lerp(EXIT_X, rx, s), lerp(0, ry, s), lerp(BT, rz, s) + 7 * Math.sin(Math.PI * s));
    }
    if (!step.accept) {
      const [bx, by, bz] = binSlot(binOf[j]!);
      const drop = clamp01((after - 0.04) / 0.5);
      return pose(lerp(X_END, bx, ease(0, 0.5, after)), lerp(0, by, drop), fall(BT, bz, drop));
    }
    if (station === "best") return pose(lerp(X_END, PEDESTAL_X, ease(0, 0.6, after)), 0, BT);
    // Al contador: cruza la bandeja de entrada y cae por la boca.
    const sink = clamp01((after - 0.5) / 0.12);
    return pose(lerp(X_END, MOUTH_X, ease(0, 0.5, after)), 0, BT - 5 * sink, 1 - sink);
  });

  const trap = live && !now!.accept && (station === "count" || station === "best");
  const flap = trap ? ease(0.36, 0.48, u) - ease(0.84, 0.96, u) : 0;
  const ram = live && station === "stamp" ? ease(0.2, 0.3, after) - ease(0.34, 0.46, after) : 0;
  return { k, u, belt, tokens, flap, ram, lamp: live && u < 0.45, acc, registered, done };
}

// ── Texto ───────────────────────────────────────────────────────────────

function listShort(list: string[]) {
  if (list.length <= 5) return pyRepr(list);
  return `[${pyRepr(list[0])}, ${pyRepr(list[1])}, …, ${pyRepr(list[list.length - 1])}]`;
}

const resultOf = (spec: Spec, example: Example) =>
  Array.isArray(example.expected) ? listShort(example.expected) : spec.concept ? `${spec.acc} = ${example.expected}` : String(example.expected);

/** El readout de la tarjeta, en Python. */
export function readoutOf(spec: Spec, example: Example, moment: Moment, reveal: boolean): string {
  const n = example.items.length;
  if (!n) return `${example.call} → ${resultOf(spec, example)} · cero vueltas`;
  if (moment.done) return `${example.call} → ${resultOf(spec, example)}`;
  const turn = `vuelta ${Math.max(0, moment.k + 1)}/${n}`;
  if (spec.station === "stamp") {
    if (moment.k < 0) return `${example.call} · ${turn}`;
    const step = stepsOf(spec.station, example.items)[moment.k]!;
    const stamped = (moment.u - 0.5) / 0.5 >= 0.3;
    return `${example.call} · ${stamped ? `${step.value} → ${pyRepr(step.word)}` : `i = ${step.value}`} · ${turn}`;
  }
  if (!reveal) return `${example.call} → ${resultOf(spec, example)} · ${turn}`;
  return `${example.call} · ${spec.acc} = ${moment.acc ?? "—"} · ${turn}`;
}

/** Lo que dice el lector de pantalla al cambiar de ejemplo. */
export function spokenOf(spec: Spec, index: number): string {
  const example = spec.examples[index]!;
  const fichas = example.items.length ? `fichas ${example.items.join(", ")}` : "sin fichas";
  return `Ejemplo ${index + 1} de ${spec.examples.length}: ${example.call}, ${fichas}; resultado ${resultOf(spec, example)}.`;
}

/** El "pedido" que se lee en la tapa cuando el mecanismo está tapado. */
export const orderOf = (example: Example) => (Array.isArray(example.expected) ? "" : String(example.expected));
