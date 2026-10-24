// Modo en vivo de la máquina "ventana": lee la ejecución REAL del código del
// alumno (la traza de packages/shared/src/dojo.ts) y la traduce a la máquina.
// Puro, sin DOM. Nada se inventa:
// - Las barras son la lista que recibió su función (el parámetro de tipo lista).
// - Cada `for` suyo que recorre la lista es un carro, y el carro se para donde
//   SU código lee la lista (`precios[j]`, `numeros[i + j]`…); si recorre los
//   elementos (`for p in precios`) se cuenta en qué vuelta va. Dos `for`
//   anidados = dos carros: el O(n²) se ve.
// - El tope, la carátula y la marca de arrastre son SUS variables (el mínimo
//   que lleva, la suma de su ventana, su mejor), reconocidas por lo que hacen.
// Si la forma del código no encaja (sin lista, sin un for que la recorra, más
// de dos carros), `analyze` devuelve null y el Dojo usa la mesa de trabajo.

import { changedVars, paramsOf, traceNum, traceRepr, type PyTraceStep, type TraceValue } from "@hermes/shared";
import type { LiveFrame } from "../types";
import { answerOf, type MachineId } from "./model";
import { MACHINES } from "./geometry";

interface Loop {
  header: number;
  end: number;
  indent: number;
  depth: number;
  /** Variable índice (range/enumerate) o null si recorre los elementos. */
  index: string | null;
  /** Recorre la lista elemento a elemento: la posición sale de contar vueltas. */
  counts: boolean;
  offset: number;
  /** Expresiones con que el cuerpo (sin los for de adentro) lee la lista. */
  reads: string[];
  parent: Loop | null;
}

export interface LiveRig {
  id: MachineId;
  fn: string;
  listVar: string;
  values: number[];
  k: number;
  /** Ejemplo del catálogo con estos datos (para la escala y la respuesta), o -1. */
  ex: number;
  loops: Loop[];
  low: string | null;
  sum: string | null;
  best: string | null;
  today: string | null;
  /** Una pose por paso, calculada una vez (los carros recuerdan dónde quedaron). */
  states: LiveState[];
}

export interface LiveState {
  /** Estación del carro principal (el for de afuera) o null = en casa. */
  main: number | null;
  /** Ventana: primera estación del bloque que su suma representa. */
  start: number | null;
  /** Estación del segundo carro (el for de adentro) o null si no hay. */
  inner: number | null;
  /** El carro baja las sondas (su for está corriendo en este paso). */
  down: boolean;
  innerDown: boolean;
  low: number | null;
  needle: number;
  drag: number | null;
  /** Devolvió lo esperado: se marca la respuesta como en el pedido. */
  solved: boolean;
  readout: string;
}

const NAME = /^[A-Za-z_]\w*$/;
const LOW = /bajo|min|menor|low|compra|barat/i;
const BEST = /mejor|best|max|mayor|res|ans|top/i;
const SUM = /suma|sum|total|acum|act|vent|cur|^s$/i;

const num = (v: TraceValue | undefined) => traceNum(v);

/** Evalúa `i`, `i + j`, `i - k + 1`… con los locals del paso (solo nombres, enteros, + y -). */
function evalIndex(expr: string, locals: Record<string, TraceValue>): number | null {
  const tokens = expr.replace(/\s+/g, "").match(/[A-Za-z_]\w*|\d+|[+-]/g);
  if (!tokens || tokens.join("") !== expr.replace(/\s+/g, "")) return null;
  let total = 0;
  let sign = 1;
  let expectTerm = true;
  for (const t of tokens) {
    if (t === "+" || t === "-") {
      if (expectTerm && t === "-") sign = -sign;
      else if (!expectTerm) sign = t === "-" ? -1 : 1;
      expectTerm = true;
      continue;
    }
    const value = /^\d+$/.test(t) ? Number(t) : num(locals[t]);
    if (value === null || value === undefined || !Number.isInteger(value)) return null;
    total += sign * value;
    sign = 1;
    expectTerm = false;
  }
  return expectTerm ? null : total;
}

function loopsOf(code: string, fn: string, listVar: string): Loop[] | null {
  const lines = code.split("\n");
  const def = lines.findIndex((l) => new RegExp(`^\\s*def\\s+${fn}\\s*\\(`).test(l));
  if (def < 0) return null;
  const defIndent = lines[def]!.search(/\S/);
  let fnEnd = lines.length;
  for (let i = def + 1; i < lines.length; i++) {
    const l = lines[i]!;
    if (l.trim() && l.search(/\S/) <= defIndent) {
      fnEnd = i;
      break;
    }
  }
  const loops: Loop[] = [];
  for (let i = def + 1; i < fnEnd; i++) {
    const line = lines[i]!;
    const m = line.match(/^(\s*)for\s+(.+?)\s+in\s+(.+?)\s*:\s*(#.*)?$/);
    if (!m) continue;
    const indent = m[1]!.length;
    let end = i;
    for (let j = i + 1; j < fnEnd; j++) {
      const l = lines[j]!;
      if (!l.trim()) continue;
      if (l.search(/\S/) <= indent) break;
      end = j;
    }
    const targets = m[2]!.split(",").map((t) => t.trim().replace(/[()]/g, ""));
    const iterable = m[3]!.trim();
    let index: string | null = null;
    let counts = false;
    let offset = 0;
    if (/^enumerate\(/.test(iterable) && targets.length === 2 && NAME.test(targets[0]!)) index = targets[0]!;
    else if (/^range\(/.test(iterable) && targets.length === 1 && NAME.test(targets[0]!)) index = targets[0]!;
    else if (targets.length === 1 && iterable === listVar) counts = true;
    else {
      const slice = iterable.match(new RegExp(`^${listVar}\\[(\\d+):\\]$`));
      if (slice && targets.length === 1) {
        counts = true;
        offset = Number(slice[1]);
      }
    }
    const parent = [...loops].reverse().find((p) => p.indent < indent && p.end >= i) ?? null;
    loops.push({ header: i + 1, end: end + 1, indent, depth: parent ? parent.depth + 1 : 0, index, counts, offset, reads: [], parent });
  }
  // Lo que lee cada for: subíndices de la lista en su cuerpo, sin los for de adentro.
  const read = new RegExp(`\\b${listVar}\\[([^\\[\\]:]+)\\]`, "g");
  for (const loop of loops) {
    const inner = loops.filter((l) => l.parent === loop);
    for (let ln = loop.header; ln <= loop.end; ln++) {
      if (inner.some((l) => ln >= l.header && ln <= l.end)) continue;
      const text = lines[ln - 1]!;
      for (const m of text.matchAll(read)) loop.reads.push(m[1]!.trim());
    }
  }
  return loops;
}

/** Dónde está el carro de este for en el paso s (estado ANTES de correr la línea). */
function positionOf(loop: Loop, steps: PyTraceStep[], s: number, n: number): number | null {
  const cur = steps[s]!;
  const var_ = loop.index;
  if (!loop.counts) for (const expr of loop.reads) {
    if (var_ && !new RegExp(`\\b${var_}\\b`).test(expr)) continue;
    const at = evalIndex(expr, cur.locals);
    if (at !== null && at >= 0 && at < n) return at;
  }
  if (var_) {
    const at = num(cur.locals[var_]);
    return at !== null && Number.isInteger(at) && at >= 0 && at < n ? at : null;
  }
  if (loop.counts) {
    // Vueltas = cuántas veces corrió el encabezado desde la última vez que corrió el del padre.
    let laps = 0;
    for (let t = s - 1; t >= 0; t--) {
      const st = steps[t]!;
      if (st.fn !== cur.fn) continue;
      if (loop.parent && st.line === loop.parent.header) break;
      if (st.line === loop.header) laps++;
    }
    const at = laps - 1 + loop.offset;
    return laps > 0 && at >= 0 && at < n ? at : null;
  }
  return null;
}

const insideLoop = (loop: Loop, line: number) => line > loop.header && line <= loop.end;

function blockSum(values: number[], start: number, k: number) {
  let total = 0;
  for (let i = start; i < start + k; i++) total += values[i]!;
  return total;
}

/** Lo que pasa en este paso, en una línea al estilo Python. */
function readoutOf(steps: PyTraceStep[], s: number, fn: string, expected: string | undefined, solved: boolean): string {
  const cur = steps[s]!;
  if (cur.event === "exception") return `línea ${cur.line} · ${cur.exc ?? "error"}`;
  if (cur.event === "return" && cur.fn === fn) {
    const got = traceRepr(cur.ret);
    if (expected === undefined) return `devuelve ${got}`;
    return solved ? `devuelve ${got} · esperado ${expected} ✓` : `devuelve ${got} · esperado ${expected} ✗`;
  }
  const prev = s > 0 ? steps[s - 1] : undefined;
  const changed = changedVars(prev, cur).filter((k) => cur.locals[k]!.t !== "fn" && prev?.fn === cur.fn);
  const parts = changed.slice(0, 2).map((k) => `${k} = ${traceRepr(cur.locals[k])}`);
  return parts.length ? `línea ${cur.line} · ${parts.join(" · ")}` : `línea ${cur.line}`;
}

// Una traza se analiza una vez por máquina (la reproducción pide cada paso).
const memo = new WeakMap<object, Map<string, LiveRig | null>>();

export function analyze(id: MachineId, frame: LiveFrame): LiveRig | null {
  let byId = memo.get(frame.trace);
  if (!byId) memo.set(frame.trace, (byId = new Map()));
  const key = `${id}|${frame.fn}|${frame.expected ?? ""}|${frame.code}`;
  if (!byId.has(key)) byId.set(key, build(id, frame));
  return byId.get(key)!;
}

function build(id: MachineId, frame: LiveFrame): LiveRig | null {
  const m = MACHINES[id];
  const { trace, fn, code, expected } = frame;
  if (!fn) return null;
  const steps = trace.steps;
  const first = steps.find((s) => s.fn === fn);
  if (!first) return null;
  const params = paramsOf(steps, fn);
  const listVar = params.find((p) => first.locals[p]?.t === "list");
  if (!listVar) return null;
  const list = first.locals[listVar] as { v: TraceValue[]; n: number };
  const values = list.v.map((x: TraceValue) => num(x));
  if (list.n !== list.v.length || !values.length || values.length > m.view.xs.length) return null;
  if (values.some((x: number | null) => x === null || !Number.isFinite(x))) return null;
  const vals = values as number[];
  if (id === "c-ganancia" && vals.some((x) => x < 0)) return null;
  let k = 1;
  if (id === "c-ventana") {
    const kVar = params.find((p) => p !== listVar && first.locals[p]?.t === "int");
    const kv = kVar ? num(first.locals[kVar]) : null;
    if (kv === null || kv < 1 || kv > vals.length || !m.heads[kv]) return null;
    k = kv;
  }
  const loops = loopsOf(code, fn, listVar);
  if (!loops) return null;
  // Solo cuentan como carros los for que de verdad recorren la lista.
  const cursors = loops.filter((l) => l.index !== null || l.counts);
  const fnSteps = steps.map((s, i) => [s, i] as const).filter(([s]) => s.fn === fn);
  const active = cursors.filter((l) => fnSteps.some(([, i]) => positionOf(l, steps, i, vals.length) !== null && insideLoop(l, steps[i]!.line)));
  if (!active.length || active.some((l) => l.depth > 1)) return null;

  const ex = m.view.examples.findIndex((e) => e.values.length === vals.length && e.values.every((x, i) => x === vals[i]) && e.k === k);

  // Las variables de la idea, por lo que hacen (y si no, por cómo se llaman).
  const loopVars = new Set<string>();
  for (const l of loops) {
    const header = code.split("\n")[l.header - 1]!.match(/for\s+(.+?)\s+in\s/);
    header?.[1]!.split(",").forEach((t) => loopVars.add(t.trim().replace(/[()]/g, "")));
  }
  const accs: string[] = [];
  for (const [s] of fnSteps)
    for (const [name, v] of Object.entries(s.locals))
      if (!params.includes(name) && !loopVars.has(name) && (v.t === "int" || v.t === "float") && !accs.includes(name)) accs.push(name);
  const ret = num(trace.result ?? undefined);
  const last = (name: string) => {
    for (let i = fnSteps.length - 1; i >= 0; i--) {
      const v = num(fnSteps[i]![0].locals[name]);
      if (v !== null) return v;
    }
    return null;
  };
  const named = (re: RegExp, pool: string[]) => pool.find((a) => re.test(a)) ?? null;
  let best = (ret !== null ? accs.filter((a) => last(a) === ret) : []).sort((a, b) => Number(BEST.test(b)) - Number(BEST.test(a)))[0] ?? named(BEST, accs);
  let low: string | null = null;
  let sum: string | null = null;
  let today: string | null = null;
  const rest = () => accs.filter((a) => a !== best && a !== low && a !== sum);
  if (id === "c-ganancia") {
    low = named(LOW, rest());
    if (!best) best = rest()[0] ?? null;
    today = rest()[0] ?? null;
  } else {
    sum = named(SUM, rest()) ?? rest()[0] ?? null;
  }

  // Ventana: dónde empieza el bloque respecto del carro (0, −(k−1) o −k): el que
  // más veces coincide con SU suma; si no hay suma, se lee del range().
  let offset = 0;
  const outer = active.find((l) => l.depth === 0) ?? active[0]!;
  if (id === "c-ventana") {
    const candidates = [0, -(k - 1), -k];
    const score = candidates.map((o) => {
      if (!sum) return 0;
      let hits = 0;
      for (const [s, i] of fnSteps) {
        const at = positionOf(outer, steps, i, vals.length);
        const total = num(s.locals[sum]);
        const start = at === null ? null : at + o;
        if (start !== null && total !== null && start >= 0 && start + k <= vals.length && blockSum(vals, start, k) === total) hits++;
      }
      return hits;
    });
    const top = Math.max(...score);
    if (top > 0) offset = candidates[score.indexOf(top)]!;
    else if (/range\(\s*\w+\s*,/.test(code.split("\n")[outer.header - 1]!)) offset = -(k - 1);
  }

  const inner = active.find((l) => l.depth === 1) ?? null;
  const solvedAt = (s: PyTraceStep) => s.event === "return" && s.fn === fn && expected !== undefined && traceRepr(s.ret) === expected;
  const states: LiveState[] = [];
  let main: number | null = null;
  let start: number | null = null;
  let innerAt: number | null = null;
  // El segundo carro espera desde el principio donde va a trabajar por primera vez.
  if (inner) for (const [, i] of fnSteps) {
    const at = positionOf(inner, steps, i, vals.length);
    if (at !== null && insideLoop(inner, steps[i]!.line)) {
      innerAt = at;
      break;
    }
  }
  let low_: number | null = null;
  let needle = 0;
  let drag: number | null = null;
  steps.forEach((s, i) => {
    let down = false;
    let innerDown = false;
    if (s.fn === fn) {
      // Dos for seguidos (no anidados) se turnan el carro principal.
      const loop = active.filter((l) => l.depth === 0).find((l) => s.line >= l.header && s.line <= l.end) ?? outer;
      const at = positionOf(loop, steps, i, vals.length);
      if (at !== null && (insideLoop(loop, s.line) || s.line === loop.header)) {
        main = at;
        down = true;
      }
      if (inner) {
        const ai = positionOf(inner, steps, i, vals.length);
        if (ai !== null && (insideLoop(inner, s.line) || s.line === inner.header)) {
          innerAt = ai;
          innerDown = true;
        }
      }
      const total = sum ? num(s.locals[sum]) : null;
      if (id === "c-ventana") {
        // El bloque que SU suma representa: junto al carro si cuadra, si no el que cuadre más cerca.
        const guess = main === null ? null : main + offset;
        const fits = (st: number) => st >= 0 && st + k <= vals.length && total !== null && blockSum(vals, st, k) === total;
        if (guess !== null && fits(guess)) start = guess;
        else if (total !== null) {
          const options = [0, -(k - 1), -k].map((o) => (main ?? 0) + o).filter(fits);
          if (options.length) start = options[0]!;
          else if (guess !== null && guess >= 0 && guess + k <= vals.length) start = guess;
        } else if (guess !== null && guess >= 0 && guess + k <= vals.length) start = guess;
      }
      const lv = low ? num(s.locals[low]) : null;
      low_ = lv !== null && Number.isFinite(lv) ? lv : null;
      if (id === "c-ganancia") {
        const tv = today ? num(s.locals[today]) : null;
        const bv = best ? num(s.locals[best]) : null;
        if (today && tv !== null) {
          needle = tv;
          drag = bv;
        } else {
          needle = bv ?? 0;
          drag = null;
        }
      } else {
        needle = total ?? 0;
        drag = best ? num(s.locals[best]) : null;
      }
    }
    const solved = solvedAt(s);
    states.push({
      main,
      start,
      inner: inner ? innerAt : null,
      down,
      innerDown,
      low: low_,
      needle,
      drag,
      solved,
      readout: readoutOf(steps, i, fn, expected, solved),
    });
  });
  return { id, fn, listVar, values: vals, k, ex, loops: active, low, sum, best, today, states };
}

/** ¿Encaja este código en la máquina? */
export function canShow(id: MachineId, frame: LiveFrame): boolean {
  return analyze(id, frame) !== null;
}

/** La respuesta marcada (solo cuando devolvió lo esperado y los datos son de un ejemplo). */
export function solvedMarks(rig: LiveRig) {
  if (rig.ex < 0) return null;
  return answerOf(rig.id, MACHINES[rig.id].view.examples[rig.ex]!);
}
