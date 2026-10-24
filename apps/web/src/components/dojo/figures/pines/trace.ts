// La máquina "pines" leyendo el código REAL del alumno (modo en vivo de
// c-suma-gigante). Puro, sin DOM: de la traza (packages/shared/src/dojo.ts) saca
// dónde cae cada paso en el tablero, cuántos pasos lleva el contador y una
// proyección honesta para n = 10¹².
//
// Reglas del tablero en vivo:
// - Cada paso de la traza (una línea que corrió, o el return) hunde UN pin, y el
//   contador marca los pasos reales hasta ahí. Nada se escala ni se inventa.
// - El puente (el for de afuera en la máquina) avanza una columna por VUELTA del
//   bucle del alumno: cada vez que vuelve a correr su `for`/`while`. Lo de antes
//   del bucle queda en la primera columna. Dentro de la vuelta, el cabezal baja
//   por la fila: un pin por línea. Con más de 10 vueltas, el puente vuelve a la
//   primera columna y esa fila se levanta para empezar de nuevo (el contador no).
// - Una fórmula no tiene vueltas: todo cae en la primera columna, 1-2 pines.
//
// La proyección a 10¹² es una ESTIMACIÓN y se dice así: con un solo n medido no
// se puede ajustar una curva, así que se razona por la forma del código (bucles
// y su anidación, recursión, líneas que recorren por dentro).

import { changedVars, traceNum, traceRepr, type PyTraceStep } from "@hermes/shared";
import type { LiveFrame } from "../types";
import { STEPS_PER_SECOND, dots, superscript } from "./model";

export const COLS = 10;
export const ROWS = 11;

/** n = 10¹²: el caso que el problema pide y ningún for alcanza. */
export const TARGET_EXP = 12;

export type Growth =
  | { kind: "constante" }
  | { kind: "bucle"; depth: number }
  | { kind: "recursion" }
  | { kind: "escondido"; line: number };

export interface Shape {
  /** Los pasos que cuentan (los de la función del ejercicio y lo que ella llame). */
  steps: PyTraceStep[];
  /** Índice en `steps` de cada paso de la traza (−1 = no cuenta: el <module>). */
  index: number[];
  /** Dónde cae el pin de cada paso contado. */
  place: { a: number; b: number }[];
  /** El tablero DESPUÉS de cada paso contado: 1 = pin hundido. */
  boards: Uint8Array[];
  n: number;
  nVar: string;
  growth: Growth;
  /** Vueltas del bucle de afuera (veces que su condición dejó entrar). */
  laps: number;
  /** Pasos DENTRO de las vueltas (desde el primer `for` hasta el que sale, sin él). */
  inLaps: number;
  /** Todos los pasos contados, si la traza terminó. */
  total: number;
  complete: boolean;
}

const LOOP = /^(\s*)(for|while)\b/;
// Líneas que recorren algo por dentro aunque la traza las vea como UN paso.
const HIDDEN = /\bsum\s*\(|\brange\s*\(|\bsorted\s*\(|\.count\s*\(|[[({][^\])}]*\bfor\b/;

/** El parámetro numérico de la función (el n del ejercicio, se llame como se llame). */
function paramN(steps: PyTraceStep[], fn: string): { name: string; value: number } | null {
  const first = steps.find((s) => s.fn === fn);
  if (!first) return null;
  for (const [name, v] of Object.entries(first.locals)) {
    if (v.t === "int" && v.v !== null) return { name, value: v.v };
  }
  return null;
}

const cache = new WeakMap<object, Shape | null>();

/** La forma de una ejecución (se calcula una vez por traza). */
export function shapeOf(frame: LiveFrame): Shape | null {
  const hit = cache.get(frame.trace);
  if (hit !== undefined) return hit;
  const shape = build(frame);
  cache.set(frame.trace, shape);
  return shape;
}

function build(frame: LiveFrame): Shape | null {
  const { trace, fn, code } = frame;
  if (!fn || trace.phase !== "done") return null;
  const all = trace.steps;
  const nv = paramN(all, fn);
  if (!nv) return null;
  const counted: PyTraceStep[] = [];
  const index: number[] = [];
  for (const s of all) {
    if (s.fn === "<module>") {
      index.push(-1);
      continue;
    }
    index.push(counted.length);
    counted.push(s);
  }
  if (!counted.length) return null;

  // Forma del código: qué líneas son bucles y cuáles corrieron.
  const lines = code.split("\n");
  const ran = new Set(counted.filter((s) => s.event === "line").map((s) => s.line));
  const loops: { line: number; indent: number }[] = [];
  lines.forEach((text, i) => {
    const m = LOOP.exec(text);
    if (m && ran.has(i + 1)) loops.push({ line: i + 1, indent: m[1].length });
  });
  const returns = counted.filter((s) => s.event === "return" && s.fn === fn).length;
  const hidden = [...ran].find((l) => !loops.some((x) => x.line === l) && HIDDEN.test(lines[l - 1] ?? ""));

  let growth: Growth;
  if (loops.length) growth = { kind: "bucle", depth: new Set(loops.map((x) => x.indent)).size };
  else if (returns > 1) growth = { kind: "recursion" };
  else if (hidden) growth = { kind: "escondido", line: hidden };
  else growth = { kind: "constante" };

  // Tablero: una columna por vuelta del bucle de afuera.
  const outer = loops.length ? loops.reduce((p, q) => (q.indent < p.indent ? q : p)).line : null;
  const place: { a: number; b: number }[] = [];
  const boards: Uint8Array[] = [];
  const board = new Uint8Array(COLS * ROWS);
  let col = 0;
  let row = 0;
  let used = false; // ¿la columna actual ya tiene algo?
  let laps = 0;
  let seenOuter = false;
  const enter = (c: number) => {
    col = c % COLS;
    row = 0;
    for (let b = 0; b < ROWS; b++) board[col * ROWS + b] = 0; // la fila se levanta para la vuelta nueva
    used = false;
  };
  counted.forEach((s) => {
    if (outer !== null && s.event === "line" && s.fn === fn && s.line === outer) {
      if (seenOuter || used) enter(col + 1);
      seenOuter = true;
    } else if (row >= ROWS) {
      enter(col + 1);
    }
    place.push({ a: col, b: row });
    board[col * ROWS + row] = 1;
    boards.push(board.slice());
    row++;
    used = true;
  });
  // La última vez que corre el `for`/`while` es la que SALE: no es una vuelta.
  let inLaps = 0;
  if (outer !== null) {
    const heads = counted.flatMap((s, i) => (s.event === "line" && s.fn === fn && s.line === outer ? [i] : []));
    laps = Math.max(0, heads.length - 1);
    if (heads.length > 1) inLaps = heads[heads.length - 1] - heads[0];
  }

  const complete = !trace.truncated && !trace.error;
  return { steps: counted, index, place, boards, n: nv.value, nVar: nv.name, growth, laps, inLaps, total: counted.length, complete };
}

/** ¿La máquina puede contar ESTA ejecución? Una función con un n entero y pasos propios. */
export function canShow(frame: LiveFrame): boolean {
  const shape = shapeOf(frame);
  return !!shape && shape.n >= 0 && shape.steps.some((s) => s.fn === frame.fn);
}

// ── Lo que dice la máquina ─────────────────────────────────────────────

/** 2,1·10¹² — una cifra grande como se lee, no como la escribe JS. */
export function big(value: number): string {
  if (value < 1e6) return dots(Math.round(value));
  const exp = Math.floor(Math.log10(value));
  const mant = value / Math.pow(10, exp);
  const m = mant.toFixed(1).replace(".", ",").replace(/,0$/, "");
  return `${m === "1" ? "" : `${m}·`}10${superscript(exp)}`;
}

function duration(seconds: number): string {
  if (seconds < 1) return "menos de un segundo";
  if (seconds < 120) return `${Math.round(seconds)} s`;
  if (seconds < 2 * 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 3 * 86400) return `${Math.round(seconds / 3600)} horas`;
  if (seconds < 2 * 365 * 86400) return `${Math.round(seconds / 86400)} días`;
  return `${big(seconds / (365 * 86400))} años`;
}

/** Cuántos pasos serían con n = 10¹², o null si con este ejemplo no se puede saber. */
export function projection(shape: Shape): { steps: number | null; text: string } {
  const target = Math.pow(10, TARGET_EXP);
  const nText = `10${superscript(TARGET_EXP)}`;
  if (!shape.complete) return { steps: null, text: "La traza no terminó: sin el total no se puede proyectar." };
  const s = shape.total;
  switch (shape.growth.kind) {
    case "constante":
      return { steps: s, text: `Estimación para n = ${nText}: los mismos ${dots(s)} pasos. Ninguna línea depende de cuántos números hay, así que n no cambia la cuenta.` };
    case "escondido":
      return {
        steps: null,
        text: `Ojo: la línea ${shape.growth.line} cuenta como UN paso en la traza, pero recorre los n números por dentro. Estimación para n = ${nText}: del orden de ${nText} pasos escondidos, ${duration(target / STEPS_PER_SECOND)} a unos ${dots(STEPS_PER_SECOND)} por segundo.`,
      };
    case "recursion":
    case "bucle": {
      const depth = shape.growth.kind === "bucle" ? shape.growth.depth : 1;
      if (shape.n === 0) return { steps: null, text: `Con n = 0 el ${shape.growth.kind === "bucle" ? "bucle no da vueltas" : "código no se llama a sí mismo"}: prueba otro ejemplo para proyectar a n = ${nText}.` };
      // Lo de dentro de las vueltas escala con n^depth; lo de fuera (preparar,
      // la última comprobación, el return) queda igual.
      const scaling = shape.growth.kind === "bucle" && shape.inLaps > 0 ? shape.inLaps : s;
      const est = (s - scaling) + (scaling / Math.pow(shape.n, depth)) * Math.pow(target, depth);
      const how = depth === 1 ? "crecen con n (lineal)" : `crecen con n${superscript(depth)}`;
      return {
        steps: est,
        text: `Estimación para n = ${nText}: si los pasos ${how}, ${dots(s)} pasos con n = ${dots(shape.n)} serían unos ${big(est)} pasos, ${duration(est / STEPS_PER_SECOND)} a unos ${dots(STEPS_PER_SECOND)} por segundo. El límite es 1 s.`,
      };
    }
  }
}

/** La línea de la esquina en el paso k de la traza. */
export function readoutOf(frame: LiveFrame, shape: Shape): string {
  const k = frame.step;
  const cur = frame.trace.steps[k];
  const counted = upTo(shape, k);
  const pasos = `${dots(counted)} paso${counted === 1 ? "" : "s"}`;
  if (!cur) return pasos;
  if (cur.event === "exception") return `línea ${cur.line} · error · ${pasos}`;
  if (cur.event === "return" && cur.fn === frame.fn) {
    const got = traceRepr(cur.ret);
    const ok = frame.expected != null ? (got === frame.expected ? " ✓" : ` ≠ ${frame.expected}`) : "";
    return `devuelve ${got}${ok} · ${pasos}`;
  }
  const prev = frame.trace.steps[k - 1];
  const changed = changedVars(prev, cur).find((v) => cur.locals[v].t !== "fn" && v !== shape.nVar);
  const value = changed ? cur.locals[changed] : undefined;
  const shown = changed && value ? ` · ${changed} = ${traceNum(value) !== null ? dots(traceNum(value)!) : traceRepr(value)}` : "";
  return `línea ${cur.line}${shown} · ${pasos}`;
}

/** Pasos contados hasta el paso k de la traza (inclusive). */
export function upTo(shape: Shape, k: number): number {
  for (let i = Math.min(k, shape.index.length - 1); i >= 0; i--) if (shape.index[i] >= 0) return shape.index[i] + 1;
  return 0;
}
