// La cinta en vivo: del CÓDIGO REAL del alumno (su traza, packages/shared/src/
// dojo.ts) sale lo mismo que el modo guion saca del catálogo. Las fichas son lo
// que recorre SU for, la ficha bajo el lector es SU variable de bucle en ese
// paso, y el contador/podio/bandeja es SU acumulador con su valor real. Si el
// contador empieza mal o el range se queda corto, la máquina lo muestra tal
// cual. Si la forma del código no encaja (sin bucle, dos bucles, recursión,
// acumulador irreconocible), `analyzeTrace` devuelve null y el Dojo usa la mesa.
// Puro: sin DOM.
import { paramsOf, traceRepr, type PyTraceStep, type TraceValue } from "@hermes/shared";
import type { LiveFrame } from "../types";
import { binSlot, rackSlot, traySlot, type Station, type TokenPose } from "./model";
import { BT, HOPPER, MOUTH_X, PEDESTAL_X, PITCH, PRESS_X, RACK_COLS, RACK_ROWS, X_HEAD } from "./view";

/** Qué estación se dibuja: la de suma sin trampa, o con trampa si alguna vuelta no suma. */
export type Layout = "sum" | "count" | "best" | "stamp";

const MAX_TOKENS = 40;
const MAX_TEXT = 8;

interface Loop {
  header: number;
  body: Set<number>;
  /** Nombres a la izquierda del `in` (o la variable del while). */
  targets: string[];
  /** La variable que es "la ficha" (el elemento, no el índice). */
  tokenVar: string;
  /** `for i in range(len(L))`: la ficha es L[i]. */
  indexOf: string | null;
  iterable: string | null;
}

export interface LiveAnalysis {
  station: Station;
  layout: Layout;
  fn: string;
  call: string;
  steps: PyTraceStep[];
  /** Por paso global: el índice del último paso DE LA FUNCIÓN (los de funciones auxiliares heredan su estado). */
  own: number[];
  loop: Loop;
  /** Texto de cada ficha, en el orden del for. */
  items: string[];
  /** Paso donde empieza cada vuelta (el primero ya dentro del cuerpo). */
  starts: number[];
  /** Primer paso fuera del bucle (o el último de la traza). */
  exit: number;
  acc: string;
  /** Por vuelta: paso donde cambió el acumulador (−1 = no cambió). */
  changedAt: number[];
  /** FizzBuzz: cada elemento de la lista de salida, en qué paso entró y en qué vuelta. */
  elements: { text: string; at: number; iter: number }[];
  /** "El mayor": cada valor que tuvo el acumulador y desde qué paso. */
  bests: { text: string; at: number }[];
  expected?: string;
  /** Cuántas fichas dibujar (las de la cinta más las de repuesto). */
  slots: number;
}

const indentOf = (line: string) => line.length - line.trimStart().length;
const blank = (line: string) => !line.trim() || line.trimStart().startsWith("#");

/** Líneas (1-indexadas) del cuerpo de lo que abre en `at`, por sangría. */
function blockOf(lines: string[], at: number): number[] {
  const base = indentOf(lines[at - 1]!);
  const out: number[] = [];
  for (let n = at + 1; n <= lines.length; n++) {
    const text = lines[n - 1]!;
    if (blank(text)) continue;
    if (indentOf(text) <= base) break;
    out.push(n);
  }
  return out;
}

function findLoop(code: string, fn: string): Loop | null {
  const lines = code.split("\n");
  const def = lines.findIndex((line) => new RegExp(`^\\s*def\\s+${fn}\\s*\\(`).test(line));
  if (def < 0) return null;
  const body = blockOf(lines, def + 1);
  // Recursión: la función se llama a sí misma.
  if (body.some((n) => new RegExp(`\\b${fn}\\s*\\(`).test(lines[n - 1]!.replace(/#.*/, "")))) return null;
  const loops = body.filter((n) => /^\s*(for|while)\b/.test(lines[n - 1]!));
  if (loops.length !== 1) return null;
  const header = loops[0]!;
  const text = lines[header - 1]!.replace(/#.*/, "").trimEnd();
  if (!text.endsWith(":")) return null; // cuerpo en la misma línea: no se distinguen las vueltas
  const inner = blockOf(lines, header);
  if (!inner.length) return null;
  const forMatch = text.match(/^\s*for\s+\(?\s*([A-Za-z_]\w*)(?:\s*,\s*([A-Za-z_]\w*))?\s*\)?\s+in\s+(.+):$/);
  if (forMatch) {
    const [, a, b, iterable] = forMatch;
    const it = iterable!.trim();
    const lenIndex = it.match(/^range\(\s*len\(\s*([A-Za-z_]\w*)\s*\)\s*\)$/);
    return {
      header,
      body: new Set(inner),
      targets: b ? [a!, b] : [a!],
      tokenVar: b ?? a!,
      indexOf: lenIndex ? lenIndex[1]! : null,
      iterable: it,
    };
  }
  const whileMatch = text.match(/^\s*while\s+\(?\s*([A-Za-z_]\w*)\b/);
  if (whileMatch) {
    return { header, body: new Set(inner), targets: [whileMatch[1]!], tokenVar: whileMatch[1]!, indexOf: null, iterable: null };
  }
  return null;
}

/** El texto que se graba en una ficha: números y textos, cortos. */
function tokenText(v: TraceValue | undefined): string | null {
  if (!v) return null;
  if (v.t === "int" || v.t === "float") return v.r.length <= MAX_TEXT ? v.r : null;
  if (v.t === "str") return v.v.length <= MAX_TEXT && v.n === v.v.length ? v.v : null;
  if (v.t === "bool") return v.v ? "True" : "False";
  return null;
}

/** Evalúa un argumento de range: literal, variable o variable ± literal. */
function evalArg(expr: string, locals: Record<string, TraceValue>): number | null {
  const m = expr.trim().match(/^(-?\d+|[A-Za-z_]\w*)(?:\s*([+-])\s*(\d+))?$/);
  if (!m) return null;
  const head = /^-?\d+$/.test(m[1]!) ? Number(m[1]) : (() => {
    const v = locals[m[1]!];
    return v && v.t === "int" ? v.v : null;
  })();
  if (head === null) return null;
  return m[2] ? head + (m[2] === "+" ? 1 : -1) * Number(m[3]) : head;
}

function itemsOf(loop: Loop, locals: Record<string, TraceValue>): string[] | null {
  const it = loop.iterable;
  if (!it) return null;
  const listOf = (name: string) => {
    const v = locals[name];
    if (!v || (v.t !== "list" && v.t !== "tuple") || v.n !== v.v.length) return null;
    const texts = v.v.map(tokenText);
    return texts.every((t): t is string => t !== null) ? texts : null;
  };
  if (loop.indexOf) return listOf(loop.indexOf);
  const plain = it.match(/^([A-Za-z_]\w*)$/) ?? it.match(/^enumerate\(\s*([A-Za-z_]\w*)\s*\)$/);
  if (plain) return listOf(plain[1]!);
  const range = it.match(/^range\((.+)\)$/);
  if (range) {
    const args = range[1]!.split(",").map((a) => evalArg(a, locals));
    if (args.some((a) => a === null) || args.length > 3) return null;
    const [a, b, s] = args.length === 1 ? [0, args[0]!, 1] : [args[0]!, args[1]!, args[2] ?? 1];
    if (!s) return null;
    const out: string[] = [];
    for (let x = a!; s > 0 ? x < b! : x > b!; x += s) {
      out.push(String(x));
      if (out.length > MAX_TOKENS) return null;
    }
    return out;
  }
  return null;
}

const same = (a: TraceValue | undefined, b: TraceValue | undefined) => JSON.stringify(a) === JSON.stringify(b);

const cache = new WeakMap<object, Map<string, LiveAnalysis | null>>();

/** Lo mismo que `analyzeTrace`, una sola vez por traza (el reproductor la pide en cada paso). */
export function analysisOf(station: Station, frame: LiveFrame): LiveAnalysis | null {
  const key = `${station}\u0000${frame.fn}\u0000${frame.expected ?? ""}\u0000${frame.code}`;
  let byKey = cache.get(frame.trace);
  if (!byKey) cache.set(frame.trace, (byKey = new Map()));
  if (!byKey.has(key)) byKey.set(key, analyzeTrace(station, frame));
  return byKey.get(key)!;
}

export function analyzeTrace(station: Station, frame: LiveFrame): LiveAnalysis | null {
  const { trace, fn, code } = frame;
  if (!fn || trace.truncated) return null;
  const steps = trace.steps;
  const loop = findLoop(code, fn);
  if (!loop) return null;
  // Una sola llamada a la función del ejercicio.
  if (steps.filter((s) => s.fn === fn && s.event === "return").length > 1) return null;
  const own: number[] = [];
  let last = -1;
  steps.forEach((s, i) => {
    if (s.fn === fn) last = i;
    own.push(last);
  });
  const mine = steps.map((s, i) => ({ s, i })).filter(({ s }) => s.fn === fn);
  if (!mine.length) return null;

  // Vueltas: el paso de la cabecera seguido de uno del cuerpo.
  const starts: number[] = [];
  for (let j = 1; j < mine.length; j++) {
    if (mine[j - 1]!.s.line === loop.header && mine[j]!.s.event === "line" && loop.body.has(mine[j]!.s.line)) starts.push(mine[j]!.i);
  }
  const inLoop = (line: number) => line === loop.header || loop.body.has(line);
  let exit = steps.length - 1;
  if (starts.length) {
    const after = mine.find(({ s, i }) => i > starts[starts.length - 1]! && (!inLoop(s.line) || s.event === "return"));
    exit = after ? after.i : steps.length - 1;
  } else {
    const after = mine.find(({ s }, j) => j > 0 && mine[j - 1]!.s.line === loop.header && !inLoop(s.line));
    exit = after ? after.i : steps.length - 1;
  }
  const n = starts.length;
  if (n > MAX_TOKENS) return null;

  // Las fichas: el iterable entero si se puede leer; si no, lo que tomó la variable.
  const before = mine.find(({ s }) => s.line === loop.header)?.s ?? mine[0]!.s;
  const observed = starts.map((at) => {
    const locals = steps[at]!.locals;
    if (loop.indexOf) {
      const list = locals[loop.indexOf];
      const index = locals[loop.tokenVar];
      if (list && (list.t === "list" || list.t === "tuple") && index?.t === "int" && index.v !== null) return tokenText(list.v[index.v]);
      return null;
    }
    return tokenText(locals[loop.tokenVar]);
  });
  let items = itemsOf(loop, before.locals);
  if (!items || items.length < n) {
    if (observed.some((t) => t === null)) return null;
    items = observed as string[];
  }
  if (items.length > MAX_TOKENS) return null;

  // El acumulador: el local (no parámetro, no del for) que cambia dentro del bucle.
  const params = new Set(paramsOf(steps, fn));
  const ret = [...steps].reverse().find((s) => s.fn === fn && s.event === "return")?.ret;
  const wanted: TraceValue["t"][] = station === "stamp" ? ["list"] : ["int"];
  const candidates: string[] = [];
  for (const { s } of mine) {
    for (const [k, v] of Object.entries(s.locals)) {
      if (params.has(k) || loop.targets.includes(k) || candidates.includes(k)) continue;
      if (wanted.includes(v.t)) candidates.push(k);
    }
  }
  const changesInLoop = (k: string) =>
    starts.length > 0 && mine.some(({ s, i }, j) => j > 0 && i > starts[0]! && i <= exit && !same(mine[j - 1]!.s.locals[k], s.locals[k]));
  const finalOf = (k: string) => [...mine].reverse().find(({ s }) => s.locals[k])?.s.locals[k];
  const acc =
    candidates.find((k) => ret && same(finalOf(k), ret) && changesInLoop(k)) ??
    candidates.find((k) => changesInLoop(k)) ??
    candidates.find((k) => ret && same(finalOf(k), ret)) ??
    null;
  if (!acc) return null;

  const valueAt = (i: number) => steps[own[i]!]?.locals[acc];
  const ends = starts.map((_, k) => (k + 1 < n ? starts[k + 1]! : exit));
  const changedAt = starts.map((start, k) => {
    for (let i = start; i <= ends[k]!; i++) if (own[i] === i && i > 0 && !same(valueAt(i), valueAt(i - 1))) return i;
    return -1;
  });

  const elements: LiveAnalysis["elements"] = [];
  const bests: LiveAnalysis["bests"] = [];
  if (station === "stamp") {
    // Cada elemento que aparece en la lista de salida, con su paso y su vuelta.
    let seen = 0;
    steps.forEach((_, i) => {
      if (own[i] !== i) return;
      const v = valueAt(i);
      if (!v || v.t !== "list") return;
      while (seen < v.v.length) {
        const text = tokenText(v.v[seen]) ?? traceRepr(v.v[seen]);
        const iter = starts.filter((s) => s <= i).length - 1;
        elements.push({ text: text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text, at: i, iter });
        seen++;
      }
    });
    if (elements.length > RACK_COLS * RACK_ROWS) return null;
  }
  if (station === "best") {
    let prev: TraceValue | undefined;
    steps.forEach((_, i) => {
      if (own[i] !== i) return;
      const v = valueAt(i);
      if (v && !same(v, prev)) bests.push({ text: tokenText(v) ?? traceRepr(v), at: i });
      prev = v;
    });
  }

  const layout: Layout =
    station === "sum" ? (changedAt.some((c) => c < 0) ? "count" : "sum") : station === "count" ? "count" : station;
  const spares = station === "best" ? bests.length : station === "stamp" ? elements.length : 0;
  return {
    station,
    layout,
    fn,
    call: trace.call ?? `${fn}(…)`,
    steps,
    own,
    loop,
    items,
    starts,
    exit,
    acc,
    changedAt,
    elements,
    bests,
    expected: frame.expected,
    slots: Math.max(1, items.length + spares),
  };
}

export interface LiveMoment {
  belt: number;
  tokens: TokenPose[];
  flap: number;
  ram: number;
  lamp: boolean;
  acc: number | null;
  done: boolean;
  readout: string;
}

/** Una ficha que aún no existe: invisible justo donde va a aparecer. */
const hidden = (text: string, x: number, z: number): TokenPose => ({ x, y: 0, z, alpha: 0, text, lit: false });

/** El cuadro del paso `step`: dónde está cada ficha y qué marca la estación. */
export function liveMomentOf(a: LiveAnalysis, step: number): LiveMoment {
  const i = Math.max(0, Math.min(step, a.steps.length - 1));
  const n = a.starts.length;
  const looping = n > 0 && i >= a.starts[0]! && i < a.exit;
  const done = n > 0 ? i >= a.exit : i >= a.exit && a.exit > 0;
  const k = done ? n : a.starts.filter((s) => s <= i).length - 1;
  // Cada vuelta cierra en su último paso por la cabecera (antes de la siguiente o de salir).
  const ends = a.starts.map((start, j) => {
    const limit = j + 1 < n ? a.starts[j + 1]! : a.exit;
    for (let h = limit - 1; h > start; h--) if (a.steps[h]!.line === a.loop.header && a.own[h] === h) return h;
    return limit;
  });
  const belt = k < 0 ? -1 : Math.min(k, n);
  // La vuelta k termina en su último paso: ahí la ficha que no cambió nada cae.
  const closing = (j: number) => i >= ends[j]!;

  const tokens: TokenPose[] = a.items.map((text, j): TokenPose => {
    const pose = (x: number, y: number, z: number, alpha = 1, lit = false, label = text): TokenPose => ({ x, y, z, alpha, text: label, lit });
    const onBelt = () => {
      const s = X_HEAD + (belt - j) * PITCH;
      return pose(s, 0, BT, s < HOPPER.x + 10 ? 0 : 1);
    };
    if (j >= n || j > k) return onBelt(); // no la alcanzó (todavía, o nunca)
    const changed = a.changedAt[j]!;
    const accepted = changed >= 0 && i >= changed;
    if (!accepted) {
      if (j === k && !closing(j) && !done) return pose(X_HEAD, 0, BT, 1, true);
      if (a.layout === "stamp") return pose(PRESS_X, 0, BT, 0);
      if (a.layout === "sum") return pose(MOUTH_X, 0, BT - 5, 0);
      const m = a.changedAt.slice(0, j).filter((c) => c < 0).length;
      return pose(...binSlot(m));
    }
    if (a.layout === "sum" || a.layout === "count") return pose(MOUTH_X, 0, BT - 5, 0);
    if (a.layout === "best") return pose(PEDESTAL_X, 0, BT, 0); // se funde con el valor del podio
    // FizzBuzz: bajo la prensa en el paso del sello, luego a su casilla.
    const first = a.elements.findIndex((e) => e.iter === j);
    if (first < 0) return pose(PRESS_X, 0, BT, 0);
    const el = a.elements[first]!;
    if (i === el.at) return pose(PRESS_X, 0, BT, 1, true, el.text);
    return pose(...rackSlot(first), 1, false, el.text);
  });

  // Fichas de repuesto: los valores del podio, o elementos de la salida sin ficha propia.
  const spares: TokenPose[] = [];
  if (a.station === "best") {
    a.bests.forEach((b, m) => {
      if (i < b.at) return spares.push(hidden(b.text, PEDESTAL_X, BT + 10));
      const next = a.bests[m + 1];
      if (next && i >= next.at) return spares.push({ ...pose3(traySlot(m)), alpha: 1, text: b.text, lit: false });
      spares.push({ x: PEDESTAL_X, y: 0, z: BT, alpha: 1, text: b.text, lit: false });
    });
  }
  if (a.station === "stamp") {
    a.elements.forEach((e, m) => {
      const owned = a.elements.findIndex((x) => x.iter === e.iter) === m && e.iter >= 0;
      if (owned || i < e.at) return spares.push(hidden(e.text, PRESS_X, BT));
      spares.push({ ...pose3(i === e.at ? [PRESS_X, 0, BT] : rackSlot(m)), alpha: 1, text: e.text, lit: i === e.at });
    });
  }

  const cur = a.steps[i]!;
  const accValue = a.steps[a.own[i]!]?.locals[a.acc];
  const acc = accValue && accValue.t === "int" ? accValue.v : null;
  const current = k >= 0 && k < n && !done ? k : -1;
  const lamp = current >= 0 && !(a.changedAt[current]! >= 0 && i >= a.changedAt[current]!) && !closing(current);
  const rejectNow = current >= 0 && a.changedAt[current]! < 0 && closing(current);
  const ram = a.station === "stamp" && a.elements.some((e) => e.at === i) ? 1 : 0;
  return {
    belt,
    tokens: [...tokens, ...spares],
    flap: (a.layout === "count" || a.layout === "best") && rejectNow ? 1 : 0,
    ram,
    lamp,
    acc,
    done: cur.event === "return" && cur.fn === a.fn,
    readout: readoutAt(a, i, k, looping),
  };
}

const pose3 = (p: [number, number, number]) => ({ x: p[0], y: p[1], z: p[2] });

function readoutAt(a: LiveAnalysis, i: number, k: number, looping: boolean): string {
  const cur = a.steps[i]!;
  const n = a.starts.length;
  if (cur.event === "return" && cur.fn === a.fn) return returnText(a, cur.ret);
  if (cur.event === "exception") return `línea ${cur.line} · ${cur.exc ?? "error"}`;
  const now = a.steps[a.own[i]!];
  const prev = i > 0 ? a.steps[a.own[i - 1]!] : undefined;
  const turn = looping && k >= 0 ? ` · vuelta ${k + 1}/${n}` : "";
  if (!now) return `línea ${cur.line}`;
  const order = [a.acc, ...a.loop.targets, ...Object.keys(now.locals)];
  const changed = order.find((name) => now.locals[name] && now.locals[name]!.t !== "fn" && (!prev || !same(prev.locals[name], now.locals[name])));
  const after = n > 0 && i >= a.exit ? " · terminó el for" : "";
  // La lista de salida: lo que se le agregó en este paso, como append.
  const was = prev?.locals[a.acc];
  const is = now.locals[a.acc];
  if (a.station === "stamp" && was && is && was.t === "list" && is.t === "list" && is.n === was.n + 1 && is.v.length === is.n) {
    return `${a.acc}.append(${short(traceRepr(is.v[is.n - 1]))})${turn}`;
  }
  if (changed && prev) return `${changed} = ${short(traceRepr(now.locals[changed]))}${turn}${after}`;
  return `línea ${cur.line}${turn}${after}`;
}

/** Elementos de primer nivel de un repr de lista (los textos del Dojo no llevan comas). */
const partsOf = (repr: string) => (repr.startsWith("[") && repr.endsWith("]") ? (repr.length > 2 ? repr.slice(1, -1).split(", ") : []) : null);

/** Lo que devolvió, corto: una lista larga se resume y se señala la primera diferencia. */
function returnText(a: LiveAnalysis, ret: TraceValue | undefined): string {
  const got = traceRepr(ret);
  const ok = a.expected === undefined || a.expected === got;
  if (got.length <= 40) return `${a.call} → ${got}${ok ? "" : ` · esperaba ${short(a.expected!)}`}`;
  const mine = partsOf(got);
  const want = a.expected ? partsOf(a.expected) : null;
  const head = mine ? `[${mine.length} elementos]` : short(got);
  if (ok) return `${a.call} → ${head}`;
  if (mine && want) {
    const at = mine.findIndex((x, k) => x !== want[k]);
    if (at >= 0) return `${a.call} → ${head} · [${at}] es ${mine[at]}, esperaba ${want[at]}`;
    return `${a.call} → ${head} · esperaba ${want.length} elementos`;
  }
  return `${a.call} → ${head} · no es lo esperado`;
}

const short = (text: string) => (text.length > 28 ? `${text.slice(0, 27)}…` : text);
