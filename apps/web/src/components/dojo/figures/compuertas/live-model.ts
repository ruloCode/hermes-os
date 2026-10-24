// Modo en vivo de la clasificadora: lee el CÓDIGO del alumno y su traza real y
// arma la misma máquina con SUS compuertas.
//
// - Las compuertas son sus `if` / `elif` (y `if` seguidos que devuelven), en el
//   orden en que los escribió, con la condición grabada tal cual.
// - Un `return <comparación>` final (o el de un else) es una compuerta más que
//   decide entre True y False: así `return n % 2 == 0` también es una máquina.
// - La ficha lleva el valor del parámetro; la traza dice qué condiciones se
//   miraron y a qué cuerpo entró (la línea que corrió después) → esa compuerta
//   se abre y la ficha cae a su cajón con el `ret` real.
//
// Si el código no tiene esa forma (bucles, ifs anidados, una cadena que la
// traza no recorre en orden) `analyze` devuelve null y el Dojo usa la mesa:
// mejor la mesa que una máquina que pinta algo que el código no hizo.

import { traceRepr, type PyTraceStep, type TraceValue } from "@hermes/shared";
import type { LiveFrame } from "../types";
import { marksOf, type Branch, type Example, type Lesson } from "./model";

/** Una compuerta del código del alumno (o el cajón final). */
interface Gate {
  /** Línea de la condición (1-based); en el else, la del `else:` o la del return final. */
  line: number;
  /** Líneas de su cuerpo. */
  body: Set<number>;
  /** `if x: return y` en una sola línea. */
  inline: boolean;
  /** `return <comparación>`: la decide el valor devuelto, no la línea siguiente. */
  byReturn: boolean;
  branch: Branch;
}

export interface LiveMachine {
  lesson: Lesson;
  example: Example;
  /** Instante del guion que corresponde a cada paso de la traza. */
  times: number[];
  /** Readout de cada paso. */
  readouts: string[];
  /** Llave estable de la máquina (cambia si cambia la forma del código). */
  key: string;
  /** Lo que lleva grabado la ficha. */
  coin: string;
  /**
   * Si devolvió otra cosa que lo esperado y hay un cajón con lo esperado: ese
   * cajón, para marcarlo en cuanto la ficha cae en el equivocado.
   */
  want: number | null;
  /** Desde qué paso ya se sabe lo devuelto (el `return` de la función). */
  returnStep: number;
}

const indentOf = (line: string) => line.length - line.trimStart().length;
const blank = (line: string) => !line.trim() || line.trimStart().startsWith("#");
/** Quita un comentario final (sin entrar en textos). */
const stripComment = (line: string) => {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote && line[i - 1] !== "\\") quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "#") return line.slice(0, i).trimEnd();
  }
  return line.trimEnd();
};

/** ¿Parece una condición (algo que da True/False)? */
const looksBoolean = (expr: string) => /(==|!=|<=|>=|<|>|\bnot\b|\band\b|\bor\b|\bin\b|\bis\b)/.test(expr) || /^(True|False)$/.test(expr.trim());

/** `"niño"` → niño · `True` → True · otra expresión tal cual. */
const cardOf = (expr: string) => expr.trim().replace(/^(["'])(.*)\1$/, "$2");

/** Divide `if cond: resto` en la condición y lo que va en la misma línea. */
function splitHead(text: string): { cond: string; rest: string } | null {
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) depth--;
    else if (ch === ":" && depth === 0) return { cond: text.slice(0, i).trim(), rest: text.slice(i + 1).trim() };
  }
  return null;
}

/**
 * Las compuertas del código: null si la forma no es una cadena de decisiones
 * plana (lo que la máquina sabe dibujar).
 */
function gatesOf(code: string, fn: string): Gate[] | null {
  const lines = code.split("\n");
  const defAt = lines.findIndex((l) => new RegExp(`^\\s*def\\s+${fn}\\s*\\(`).test(l));
  if (defAt < 0) return null;
  const defIndent = indentOf(lines[defAt]);
  // El cuerpo de la función: hasta la primera línea con sangría <= la del def.
  const body: number[] = [];
  for (let i = defAt + 1; i < lines.length; i++) {
    if (blank(lines[i])) continue;
    if (indentOf(lines[i]) <= defIndent) break;
    body.push(i);
  }
  if (!body.length) return null;
  // Nada de bucles, funciones internas ni manejo de errores: eso no es una clasificadora.
  if (body.some((i) => /^\s*(for|while|def|try|with|match|class)\b/.test(lines[i]))) return null;
  const top = indentOf(lines[body[0]]);
  const gates: Gate[] = [];
  let chainOpen = false; // hay una cadena cuyo último cuerpo devuelve (sigue siendo "si no, …")
  let hasElse = false;
  let k = 0;
  while (k < body.length) {
    const i = body[k];
    const text = stripComment(lines[i]).trim();
    const ind = indentOf(lines[i]);
    if (ind !== top) return null;
    // El cuerpo de esta sentencia: las líneas siguientes con más sangría.
    const inner: number[] = [];
    let j = k + 1;
    while (j < body.length && indentOf(lines[body[j]]) > top) inner.push(body[j++]);
    // Un if dentro de una rama ya no es una cadena plana.
    if (inner.some((n) => /^\s*(if|elif|else)\b/.test(lines[n]))) return null;
    const head = /^(if|elif)\s+(.*)$/.exec(text);
    if (head || text === "else:" || /^else\s*:/.test(text)) {
      const kw = head ? head[1] : "else";
      if (kw === "if" && gates.length && !chainOpen) return null; // un if suelto después de algo que no devolvió
      if (kw !== "if" && !gates.length) return null;
      if (hasElse) return null;
      const split = head ? splitHead(head[2]) : splitHead(text.slice(4));
      if (!split) return null;
      const inline = !!split.rest;
      const bodyLines = inline ? [i] : inner;
      const bodyText = inline ? [split.rest] : inner.map((n) => stripComment(lines[n]).trim());
      const ret = bodyText.map((t) => /^return\b\s*(.*)$/.exec(t)).find(Boolean);
      const assigned = bodyText.map((t) => /^[\p{L}_][\p{L}\p{N}_]*\s*=\s*(.+)$/u.exec(t)).find(Boolean);
      const out = ret ? ret[1] || "None" : assigned ? assigned[1] : "…";
      if (kw === "else") {
        hasElse = true;
        gates.push({ line: i + 1, body: new Set(bodyLines.map((n) => n + 1)), inline, byReturn: false, branch: { cond: null, plate: "else", card: cardOf(out), said: out } });
      } else {
        gates.push({
          line: i + 1,
          body: new Set(bodyLines.map((n) => n + 1)),
          inline,
          byReturn: false,
          branch: { cond: split.cond, plate: `${kw} ${split.cond}`, card: cardOf(out), said: out },
        });
      }
      // La cadena sigue abierta a un `if` nuevo solo si esta rama devuelve siempre.
      chainOpen = !!ret;
      k = j;
      continue;
    }
    const ret = /^return\b\s*(.*)$/.exec(text);
    if (ret) {
      if (inner.length) return null;
      const expr = ret[1] || "None";
      if (!hasElse) {
        // Return final: es el "si ninguna se cumplió" (o la única decisión, como en es_par).
        gates.push({ line: i + 1, body: new Set([i + 1]), inline: true, byReturn: false, branch: { cond: null, plate: gates.length ? "si no" : "return", card: cardOf(expr), said: expr } });
        hasElse = true;
      }
      k = j;
      continue;
    }
    // Una asignación o un print antes de decidir: no es compuerta, la ficha espera en la boca.
    if (gates.length && !hasElse && !chainOpen) return null;
    if (inner.length) return null;
    k = j;
  }
  if (!gates.length) return null;
  // Sin else ni return final, la función sigue de largo y devuelve None.
  if (!hasElse) gates.push({ line: -1, body: new Set(), inline: false, byReturn: false, branch: { cond: null, plate: "si no", card: "None", said: "None" } });
  // El último cajón que devuelve una comparación es una compuerta más (True / False).
  const last = gates[gates.length - 1];
  if (last.branch.cond === null && last.line > 0 && looksBoolean(last.branch.said) && !/^(True|False|None)$/.test(last.branch.said.trim())) {
    const expr = last.branch.said.trim();
    const retLine = [...last.body].find((n) => /^\s*return\b/.test(lines[n - 1]) || n === last.line) ?? last.line;
    gates[gates.length - 1] = { line: retLine, body: new Set(), inline: false, byReturn: true, branch: { cond: expr, plate: expr, card: "True", said: "True" } };
    gates.push({ line: -1, body: new Set(), inline: false, byReturn: false, branch: { cond: null, plate: "else", card: "False", said: "False" } });
  }
  if (gates.length < 2 || gates.length > 5) return null;
  return gates;
}

const truthy = (v: TraceValue | undefined) => {
  if (!v) return false;
  switch (v.t) {
    case "none":
      return false;
    case "bool":
      return v.v;
    case "int":
    case "float":
      return v.v !== 0;
    case "str":
    case "list":
    case "tuple":
    case "set":
    case "dict":
      return v.n > 0;
    default:
      return true;
  }
};

const shortRepr = (v: TraceValue | undefined, max = 22) => {
  const r = traceRepr(v);
  return r.length > max ? `${r.slice(0, max - 1)}…` : r;
};

const cache = new Map<string, LiveMachine | null>();

/** La máquina para esta ejecución, o null si el código no tiene forma de clasificadora. */
export function analyze(frame: LiveFrame): LiveMachine | null {
  const { trace, fn, code, expected } = frame;
  if (!fn) return null;
  const cacheKey = `${fn}\u0000${code}\u0000${trace.call}\u0000${trace.steps.length}\u0000${expected ?? ""}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey)!;
  const result = build(frame);
  if (cache.size > 40) cache.clear();
  cache.set(cacheKey, result);
  return result;
}

function build({ trace, fn, code, expected }: LiveFrame): LiveMachine | null {
  if (!fn) return null;
  const gates = gatesOf(code, fn);
  if (!gates) return null;
  const steps = trace.steps;
  const own = steps.map((s, i) => ({ s, i })).filter(({ s }) => s.fn === fn);
  if (!own.length) return null;
  const param = Object.keys(own[0].s.locals)[0];
  const coinValue = param ? own[0].s.locals[param] : undefined;
  const conds = gates.filter((g) => g.branch.cond !== null);

  // ¿Qué miró y adónde entró? Recorre los pasos de la función en orden.
  const results: boolean[] = [];
  let bin: number | null = null;
  const binOfStep = (s: PyTraceStep, next: PyTraceStep | undefined): void => {
    if (bin !== null) return;
    const g = gates.findIndex((x) => x.branch.cond !== null && x.line === s.line);
    if (g >= 0 && s.event === "line") {
      if (g !== results.length) throw new Error("orden");
      let hit: boolean;
      if (gates[g].byReturn) hit = next?.event === "return" ? truthy(next.ret) : false;
      else if (gates[g].inline) hit = next?.event === "return" && next.line === s.line;
      else hit = !!next && next.event === "line" && gates[g].body.has(next.line);
      results.push(hit);
      if (hit) bin = g;
      return;
    }
    // Entró al cuerpo del else (o al return final).
    const e = gates.findIndex((x) => x.branch.cond === null && x.body.has(s.line));
    if (e >= 0 && s.event === "line" && results.length === e) bin = e;
  };
  try {
    own.forEach(({ s }, n) => binOfStep(s, own[n + 1]?.s));
  } catch {
    return null;
  }
  // Ninguna se cumplió y la función devolvió (sin else ni return final): cajón None.
  const ret = own.find(({ s }) => s.event === "return")?.s.ret;
  if (bin === null && results.length === conds.length && own.some(({ s }) => s.event === "return")) bin = gates.length - 1;

  const branches = gates.map((g) => g.branch);
  const call = trace.call ?? `${fn}(${shortRepr(coinValue, 10)})`;
  const value = coinValue && (coinValue.t === "int" || coinValue.t === "float") && coinValue.v !== null ? coinValue.v : 0;
  const example: Example = { call, value, group: 0, bin: bin ?? gates.length - 1, trace: results };
  const lesson: Lesson = { id: "live", title: `${fn}: tus compuertas`, groups: [branches], examples: [example], bins: gates.length, problem: false };
  const marks = marksOf(lesson, example);
  const DROP = 0.45;

  // Un instante y un readout por paso de la traza.
  const times: number[] = [];
  const readouts: string[] = [];
  let t = DROP;
  let say = `${call} → …`;
  let decided = false;
  const got = ret !== undefined ? traceRepr(ret) : null;
  const verdict = got === null ? "" : expected === undefined ? "" : got === expected ? " ✓" : ` ≠ ${expected}`;
  steps.forEach((s, k) => {
    if (s.fn === fn) {
      const g = gates.findIndex((x) => x.branch.cond !== null && x.line === s.line);
      if (s.event === "exception") {
        say = `${call} · error: ${(s.exc ?? "excepción").slice(0, 28)}`;
      } else if (s.event === "return") {
        t = marks.settled;
        say = `${call} → ${shortRepr(s.ret, 18)}${verdict}`;
      } else if (g >= 0 && g < results.length && !decided) {
        const gate = gates[g];
        t = marks.ask[g] ?? t;
        say = `${clipCond(gate.branch.cond!)} ?`;
      } else if (bin !== null && gates[bin].body.has(s.line) && !decided) {
        decided = true;
        t = marks.landed;
        const asked = results.length ? gates[results.length - 1] : null;
        say =
          gates[bin].branch.cond === null
            ? results.length
              ? `ninguna se cumplió → ${gates[bin].branch.plate}`
              : `${call} · ${gates[bin].branch.plate}`
            : `${clipCond(asked!.branch.cond!)} → True`;
      }
    }
    times.push(t);
    readouts.push(say);
  });
  // Entre la pregunta y la siguiente: muestra el "no" de la anterior.
  for (let k = 1; k < steps.length; k++) {
    const s = steps[k];
    const g = gates.findIndex((x) => x.branch.cond !== null && x.line === s.line);
    if (s.fn === fn && s.event === "line" && g > 0 && !gates[g - 1].byReturn) {
      readouts[k] = `${clipCond(gates[g - 1].branch.cond!)} → False · ${readouts[k]}`.slice(0, 46);
    }
  }
  const shape = gates.map((g) => `${g.line}:${g.branch.plate}:${g.branch.card}`).join("|");
  const coin = coinValue ? shortRepr(coinValue, 6) : "?";
  const bare = (text: string) => text.trim().replace(/^(["'])(.*)\1$/, "$2");
  const wrong = got !== null && expected !== undefined && got !== expected;
  const wantAt = wrong ? branches.findIndex((b, i) => i !== bin && bare(b.said) === bare(expected!)) : -1;
  const returnStep = steps.findIndex((s) => s.fn === fn && s.event === "return");
  return { lesson, example, times, readouts, key: `${shape}\u0000${call}`, coin, want: wantAt >= 0 ? wantAt : null, returnStep: returnStep < 0 ? steps.length : returnStep };
}

function clipCond(cond: string) {
  return cond.length > 22 ? `${cond.slice(0, 21)}…` : cond;
}
