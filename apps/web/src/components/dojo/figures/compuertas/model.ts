// Modelo puro de la clasificadora de fichas (Fig 2 · if / elif / else).
//
// Todo lo que la máquina enseña sale de aquí: las ramas (condición → cajón) se
// leen del catálogo real del Dojo (el código de la lección o la solución del
// problema), los ejemplos son los casos de la lección y el cajón de cada ficha
// se CALCULA evaluando las condiciones en orden, igual que Python. Si el cálculo
// no coincide con lo esperado por el catálogo, se avisa en consola: la figura
// nunca afirma algo que el ejercicio contradiga.
//
// `stateAt(lesson, index, t)` es una función pura del tiempo: la vista no guarda
// física propia, solo pinta lo que este módulo dice para el instante t.

import { dojoItem, type DojoItem } from "@hermes/shared";

/** Una rama de la cadena: la compuerta con su condición y el cajón al que manda. */
export interface Branch {
  /** Condición tal como se escribe en Python (`n > 0`); null = else. */
  cond: string | null;
  /** Lo que va grabado en la placa de la compuerta (`if n > 0`, `elif …`, `else`). */
  plate: string;
  /** La tarjeta del cajón (`positivo`, `True`, `A`). */
  card: string;
  /** Cómo lo dice el readout, en estilo Python (`"positivo"`, `True`, `print("A")`). */
  said: string;
}

export interface Example {
  /** Cómo se llama en el readout: `signo(5)` o `x = 15`. */
  call: string;
  /** El valor grabado en la ficha. */
  value: number;
  /** Juego de ramas al que pertenece (en f-decidir hay dos: signo y el check de x = 15). */
  group: number;
  /** Cajón donde termina (índice de rama). */
  bin: number;
  /** Resultado de cada condición evaluada, en orden, hasta la que gana (incluida). */
  trace: boolean[];
}

export interface Lesson {
  id: string;
  title: string;
  /** Una cadena de ramas por grupo; todas del mismo largo en una lección. */
  groups: Branch[][];
  examples: Example[];
  /** Ramas = cajones = compuertas + else. */
  bins: number;
  /** Es un problema (oculta el mecanismo hasta resolverlo). */
  problem: boolean;
}

// ---------------------------------------------------------------- condiciones

// Nombres con tildes y eñes (`año`): `\w` de JS no los reconoce.
const COND = /^([\p{L}_][\p{L}\p{N}_]*)\s*(?:%\s*(\d+)\s*)?(==|!=|<=|>=|<|>)\s*(-?\d+)$/u;

/** ¿Este texto es una condición que la máquina sabe evaluar? */
export const isSimpleCond = (text: string) => COND.test(text.trim());

/** Evalúa `n > 0`, `edad < 13`, `n % 2 == 0` con la semántica de Python. */
export function evaluate(cond: string, value: number): boolean {
  const m = COND.exec(cond.trim());
  if (!m) throw new Error(`Condición no soportada: ${cond}`);
  const mod = m[2] ? Number(m[2]) : null;
  // En Python el residuo con divisor positivo nunca es negativo (-7 % 2 == 1).
  const left = mod === null ? value : ((value % mod) + mod) % mod;
  const right = Number(m[4]);
  switch (m[3]) {
    case "==":
      return left === right;
    case "!=":
      return left !== right;
    case "<=":
      return left <= right;
    case ">=":
      return left >= right;
    case "<":
      return left < right;
    default:
      return left > right;
  }
}

/** Corre la cadena en orden: gana la PRIMERA rama verdadera (o el else). */
export function decide(branches: Branch[], value: number): { bin: number; trace: boolean[] } {
  const trace: boolean[] = [];
  for (let index = 0; index < branches.length; index++) {
    const cond = branches[index].cond;
    if (cond === null) return { bin: index, trace };
    const hit = evaluate(cond, value);
    trace.push(hit);
    if (hit) return { bin: index, trace };
  }
  return { bin: branches.length - 1, trace };
}

// ---------------------------------------------------------- lectura del catálogo

interface Parsed {
  cond: string | null;
  keyword: "if" | "elif" | "else";
  out: string;
}

/** Lee una cadena if/elif/else de código Python: condición y lo que hace cada rama. */
function parseChain(code: string): Parsed[] {
  const out: Parsed[] = [];
  for (const line of code.split("\n")) {
    const head = /^\s*(if|elif)\s+(.+):\s*$/.exec(line);
    if (head) {
      out.push({ cond: head[2].trim(), keyword: head[1] as "if" | "elif", out: "" });
      continue;
    }
    if (/^\s*else:\s*$/.test(line)) {
      out.push({ cond: null, keyword: "else", out: "" });
      continue;
    }
    const last = out[out.length - 1];
    if (!last || last.out) continue;
    const ret = /^\s*return\s+(.+?)\s*$/.exec(line);
    const say = /^\s*print\((.+)\)\s*$/.exec(line);
    if (ret) last.out = ret[1];
    else if (say) last.out = `print(${say[1]})`;
  }
  return out;
}

/** `"positivo"` → positivo · `print("A")` → A · `True` → True. */
function cardOf(out: string): string {
  const inner = /^print\((.+)\)$/.exec(out)?.[1] ?? out;
  return inner.replace(/^"(.*)"$/, "$1");
}

const branchesOf = (parsed: Parsed[], plates: boolean): Branch[] =>
  parsed.map((p) => ({
    cond: p.cond,
    plate: p.cond === null ? "else" : plates ? `${p.keyword} ${p.cond}` : p.cond,
    card: cardOf(p.out),
    said: p.out,
  }));

const python = (value: unknown) =>
  typeof value === "boolean" ? (value ? "True" : "False") : typeof value === "string" ? `"${value}"` : String(value);

function codeBlocks(item: DojoItem) {
  const blocks = item.blocks ?? [];
  return blocks.flatMap((b) => ("code" in b && b.code ? [b.code] : []));
}

function check(lesson: string, call: string, got: string, want: string) {
  if (got !== want && typeof console !== "undefined") {
    console.warn(`[compuertas] ${lesson}: ${call} da ${got} y el catálogo espera ${want}`);
  }
}

function decidirLesson(item: DojoItem): Lesson {
  const codes = codeBlocks(item);
  // Grupo 0: la función signo y sus tres llamadas reales del print.
  const signo = codes.find((c) => /def signo/.test(c)) ?? "";
  const signoBranches = branchesOf(parseChain(signo), true);
  const fn = /def (\w+)\(/.exec(signo)?.[1] ?? "signo";
  const printLine = signo.split("\n").find((l) => l.includes("print(")) ?? "";
  const calls = [...printLine.matchAll(new RegExp(`${fn}\\((-?\\d+)\\)`, "g"))].map((m) => Number(m[1]));
  // Grupo 1: la pregunta de x = 15, que cumple dos condiciones y solo imprime una.
  const quiz = codes.find((c) => /^\s*x\s*=\s*-?\d+/m.test(c) && /elif/.test(c)) ?? "";
  const quizBranches = branchesOf(parseChain(quiz), true);
  const x = Number(/^\s*x\s*=\s*(-?\d+)/m.exec(quiz)?.[1] ?? 0);
  const examples: Example[] = [
    ...calls.map((value) => ({ call: `${fn}(${value})`, value, group: 0, ...decide(signoBranches, value) })),
    { call: `x = ${x}`, value: x, group: 1, ...decide(quizBranches, x) },
  ];
  return { id: item.id, title: "if · elif · else", groups: [signoBranches, quizBranches], examples, bins: signoBranches.length, problem: false };
}

function esParLesson(item: DojoItem): Lesson {
  const p = item.problem!;
  // La solución es una sola comparación: esa es la compuerta; el else es False.
  const cond = /return\s+(.+?)\s*$/m.exec(p.solution)?.[1] ?? "n % 2 == 0";
  const branches: Branch[] = [
    { cond, plate: cond, card: "True", said: "True" },
    { cond: null, plate: "else", card: "False", said: "False" },
  ];
  const examples = p.cases
    .filter((c) => !c.hidden && c.args?.length === 1)
    .map((c) => {
      const value = Number(c.args![0]);
      const run = decide(branches, value);
      check(item.id, `${p.fn}(${value})`, branches[run.bin].said, python(c.expected));
      return { call: `${p.fn}(${value})`, value, group: 0, ...run };
    });
  return { id: item.id, title: "¿Es par?", groups: [branches], examples, bins: 2, problem: true };
}

function etapaLesson(item: DojoItem): Lesson {
  const p = item.problem!;
  const branches = branchesOf(parseChain(p.solution), true);
  // Los ejemplos son los BORDES del catálogo: pares de edades seguidas (12 y 13…)
  // que caen en cajones distintos. Ahí es donde se equivoca un if mal ordenado.
  const cases = p.cases
    .filter((c) => c.args?.length === 1)
    .map((c) => ({ value: Number(c.args![0]), expected: c.expected }))
    .sort((a, b) => a.value - b.value);
  const borders = new Set<number>();
  for (const a of cases) {
    const b = cases.find((c) => c.value === a.value + 1);
    if (b && b.expected !== a.expected) {
      borders.add(a.value);
      borders.add(b.value);
    }
  }
  const examples = cases
    .filter((c) => borders.has(c.value))
    .map((c) => {
      const run = decide(branches, c.value);
      check(item.id, `${p.fn}(${c.value})`, branches[run.bin].said, python(c.expected));
      return { call: `${p.fn}(${c.value})`, value: c.value, group: 0, ...run };
    });
  return { id: item.id, title: "Etapa de la vida", groups: [branches], examples, bins: branches.length, problem: true };
}

/**
 * Una cadena cuyo else devuelve una COMPARACIÓN (`else: return año % 4 == 0`) es,
 * para la máquina, una compuerta más: esa comparación decide entre True y False.
 * Así cada cajón guarda un valor y no una expresión.
 */
function expandTail(branches: Branch[]): Branch[] {
  const last = branches[branches.length - 1];
  const expr = last?.cond === null ? last.said : "";
  if (!last || !isSimpleCond(expr)) return branches;
  return [
    ...branches.slice(0, -1),
    { cond: expr, plate: expr, card: "True", said: "True" },
    { cond: null, plate: "else", card: "False", said: "False" },
  ];
}

function bisiestoLesson(item: DojoItem): Lesson {
  const p = item.problem!;
  const branches = expandTail(branchesOf(parseChain(p.solution), true));
  const examples = p.cases
    .filter((c) => !c.hidden && c.args?.length === 1)
    .map((c) => {
      const value = Number(c.args![0]);
      const run = decide(branches, value);
      check(item.id, `${p.fn}(${value})`, branches[run.bin].said, python(c.expected));
      return { call: `${p.fn}(${value})`, value, group: 0, ...run };
    });
  return { id: item.id, title: "¿Año bisiesto?", groups: [branches], examples, bins: branches.length, problem: true };
}

const BUILDERS: Record<string, (item: DojoItem) => Lesson> = {
  "f-decidir": decidirLesson,
  "f-es-par": esParLesson,
  "f-etapa": etapaLesson,
  "f-bisiesto": bisiestoLesson,
};

export const LESSON_IDS = Object.keys(BUILDERS);

const cache = new Map<string, Lesson>();

export function lessonOf(id: string): Lesson {
  const hit = cache.get(id);
  if (hit) return hit;
  const item = dojoItem(id);
  if (!item) throw new Error(`Lección ${id} no está en el catálogo`);
  const lesson = BUILDERS[id](item);
  cache.set(id, lesson);
  return lesson;
}

// ------------------------------------------------------------------- ritmo

/** Segundos de cada tramo del recorrido de una ficha. */
export const TIMING = {
  drop: 0.45, // la cola baja un lugar y la ficha queda en la boca del canal
  roll: 0.95, // de una compuerta a la siguiente (una vuelta exacta de la ficha)
  ask: 0.55, // la compuerta mira la ficha
  answer: 0.45, // la lámpara dice sí o no
  lift: 0.3, // la compuerta se levanta (no)
  open: 0.16, // las trampillas se abren (sí)
  fall: 0.42, // la ficha cae al cajón
  edge: 0.62, // del último stop al borde del canal (camino del else)
  hop: 0.32, // se acomoda en su lugar dentro del cajón
  hold: 1.7, // queda a la vista con el readout final
} as const;

export type LampState = "off" | "ask" | "no" | "yes";

/**
 * El estado de la máquina en un instante, en términos del recorrido: la vista lo
 * convierte a mundo con su propio layout (pasos, alturas).
 */
export interface MachineState {
  /** Avance de la ficha medido en compuertas: -1 = boca del canal, k = parada de la compuerta k. */
  along: number;
  /** Cuánto ha caído, 0 (en el canal) → 1 (en el piso del cajón). */
  fall: number;
  /** Acomodo final en el cajón, 0 → 1. */
  hop: number;
  /** La cola del tubo bajando, 0 → 1 (1 = ya en su sitio). */
  drop: number;
  /** Apertura de las trampillas de cada compuerta, 0..1. */
  doors: number[];
  /** Subida de la hoja de cada compuerta, 0..1. */
  blades: number[];
  lamps: LampState[];
  /** El cajón de destino. */
  bin: number;
  /** Ya terminó: la ficha reposa en su cajón. */
  done: boolean;
  /** Texto del readout (estilo Python). */
  readout: string;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (v: number) => {
  const u = clamp01(v);
  return u * u * (3 - 2 * u);
};
/** Arranca con calma y llega a velocidad: para rodar hacia un borde y seguir de largo. */
const easeIn = (v: number) => {
  const u = clamp01(v);
  return u * u;
};

interface Step {
  kind: "drop" | "roll" | "ask" | "answer" | "lift" | "open" | "fall" | "edge" | "hop" | "hold";
  gate: number;
  dur: number;
}

/** Guion de una ficha: la lista de tramos que recorre hasta su cajón. */
export function scriptOf(lesson: Lesson, example: Example): Step[] {
  const last = lesson.bins - 1;
  const steps: Step[] = [{ kind: "drop", gate: -1, dur: TIMING.drop }];
  for (let gate = 0; gate <= example.bin; gate++) {
    if (gate === last) {
      // El else no tiene compuerta: la ficha sale rodando por el borde del canal.
      steps.push({ kind: "edge", gate, dur: TIMING.edge }, { kind: "fall", gate, dur: TIMING.fall });
      break;
    }
    steps.push({ kind: "roll", gate, dur: TIMING.roll }, { kind: "ask", gate, dur: TIMING.ask }, { kind: "answer", gate, dur: TIMING.answer });
    if (gate === example.bin) {
      steps.push({ kind: "open", gate, dur: TIMING.open }, { kind: "fall", gate, dur: TIMING.fall });
      break;
    }
    steps.push({ kind: "lift", gate, dur: TIMING.lift });
  }
  steps.push({ kind: "hop", gate: example.bin, dur: TIMING.hop }, { kind: "hold", gate: example.bin, dur: TIMING.hold });
  return steps;
}

export const durationOf = (lesson: Lesson, example: Example) => scriptOf(lesson, example).reduce((s, step) => s + step.dur, 0);

/** El readout final de una ficha (y el de reposo en el servidor). */
export function finalReadout(lesson: Lesson, index: number): string {
  const example = lesson.examples[index];
  const branch = lesson.groups[example.group][example.bin];
  const count = `${index + 1}/${lesson.examples.length}`;
  return `${example.call} → ${branch.said} · ${count}`;
}

/**
 * Estado de la máquina a t segundos de soltar la ficha `index`. Con reveal=false
 * el readout no nombra condiciones: solo qué entra y adónde va.
 */
export function stateAt(lesson: Lesson, index: number, t: number, reveal: boolean): MachineState {
  const example = lesson.examples[index];
  const branches = lesson.groups[example.group];
  const gates = lesson.bins - 1;
  const steps = scriptOf(lesson, example);
  const state: MachineState = {
    along: -1,
    fall: 0,
    hop: 0,
    drop: 0,
    doors: Array.from({ length: gates }, () => 0),
    blades: Array.from({ length: gates }, () => 0),
    lamps: Array.from({ length: lesson.bins }, (): LampState => "off"),
    bin: example.bin,
    done: false,
    readout: `${example.call} → …`,
  };
  let clock = 0;
  for (const step of steps) {
    const u = clamp01((t - clock) / step.dur);
    const started = t >= clock;
    clock += step.dur;
    if (!started) break;
    const cond = step.gate >= 0 && step.gate < branches.length ? branches[step.gate].cond : null;
    switch (step.kind) {
      case "drop":
        state.drop = smooth(u);
        break;
      case "roll":
        state.along = step.gate - 1 + smooth(u);
        break;
      case "ask":
        state.lamps[step.gate] = "ask";
        if (reveal) state.readout = `${example.call} · ${cond} ?`;
        break;
      case "answer": {
        const hit = example.trace[step.gate];
        state.lamps[step.gate] = hit ? "yes" : "no";
        if (reveal) state.readout = `${example.call} · ${cond} → ${hit ? "True" : "False"}`;
        break;
      }
      case "lift":
        state.blades[step.gate] = smooth(u);
        break;
      case "open":
        state.doors[step.gate] = smooth(u);
        break;
      case "edge":
        // Del último stop (o de la boca) hasta el borde, ganando velocidad.
        state.along = step.gate - 1 + EDGE_SHARE * easeIn(u);
        state.lamps[step.gate] = "yes";
        if (reveal) state.readout = `${example.call} · else`;
        break;
      case "fall":
        state.fall = u;
        if (step.gate === gates) {
          // Camino del else: sigue de largo mientras cae, hasta el centro del cajón.
          state.along = step.gate - 1 + EDGE_SHARE + (1 - EDGE_SHARE) * u;
        }
        // La trampilla sigue abierta mientras la ficha cae.
        break;
      case "hop":
        state.hop = smooth(u);
        state.readout = finalReadout(lesson, index);
        break;
      case "hold":
        state.done = u >= 1;
        break;
    }
  }
  if (t >= clock) state.done = true;
  return state;
}

/**
 * Qué parte del último tramo del else rueda sobre el canal (el resto es caída):
 * el canal termina 24 unidades antes del centro del cajón del else, con paso 70.
 */
export const EDGE_SHARE = 46 / 70;

/** Dónde reposa cada ficha de un cajón: por orden de llegada dentro de su grupo. */
export interface Rest {
  example: number;
  bin: number;
  /** 0 = centro (única), 1 = atrás, 2 = adelante. */
  slot: 0 | 1 | 2;
}

export function restsOf(lesson: Lesson, index: number): { before: Rest[]; current: Rest } {
  const group = lesson.examples[index].group;
  const same = lesson.examples.map((e, i) => ({ e, i })).filter(({ e }) => e.group === group);
  const totals = new Map<number, number>();
  for (const { e } of same) totals.set(e.bin, (totals.get(e.bin) ?? 0) + 1);
  const seen = new Map<number, number>();
  const rests: Rest[] = [];
  for (const { e, i } of same) {
    const order = seen.get(e.bin) ?? 0;
    seen.set(e.bin, order + 1);
    const slot: Rest["slot"] = (totals.get(e.bin) ?? 1) === 1 ? 0 : order === 0 ? 1 : 2;
    rests.push({ example: i, bin: e.bin, slot });
  }
  return {
    before: rests.filter((r) => r.example < index),
    current: rests.find((r) => r.example === index)!,
  };
}

/** Instantes clave del guion de una ficha (para el modo en vivo: un paso = un instante). */
export interface Marks {
  /** Fin del "mirar" de cada compuerta visitada. */
  ask: number[];
  /** Fin de la respuesta (lámpara encendida) de cada compuerta visitada. */
  answer: number[];
  /** Cuando la ficha ya cayó al cajón. */
  landed: number;
  /** Cuando ya se acomodó (antes de la espera final). */
  settled: number;
}

export function marksOf(lesson: Lesson, example: Example): Marks {
  const marks: Marks = { ask: [], answer: [], landed: 0, settled: 0 };
  let clock = 0;
  for (const step of scriptOf(lesson, example)) {
    clock += step.dur;
    if (step.kind === "ask") marks.ask[step.gate] = clock;
    if (step.kind === "answer") marks.answer[step.gate] = clock;
    if (step.kind === "fall") marks.landed = clock;
    if (step.kind === "hop") marks.settled = clock;
  }
  return marks;
}
