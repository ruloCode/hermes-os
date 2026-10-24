// Modo en vivo del componedor: la traza REAL del código del alumno convertida en
// una escena de un paso por paso de la traza. Puro (sin DOM): lo que la máquina
// muestra sale de los locals de cada paso, no de lo que "debería" pasar; si el
// alumno tiene un bug, las fichas, los carros y la ventana lo muestran tal cual.
//
// Qué se lee de la traza y cómo:
// - Las FICHAS son el texto con el que trabaja el alumno: el parámetro, o un
//   local que es ese mismo texto limpio o al revés (`limpio`), o la lista de
//   sus palabras (`palabras`, fichas anchas). Al cambiar de uno a otro, las
//   fichas que siguen se corren a su sitio y las que sobran (espacios) se van.
// - Los CARROS son los índices: una variable que se usa como `texto[i]` (dos
//   carros si hay dos: los dos punteros), o la posición del `for letra in …`,
//   que se cuenta por las veces que corrió la línea del for.
// - La VENTANA es lo que va acumulando (el último local que cambió y no es
//   ficha ni índice) y, al final, lo que devolvió.
// Si el código no tiene esa forma (el parámetro no es un texto corto, hay
// recursión, la lista no son las palabras), no hay escena: el Dojo usa la mesa.

import { traceRepr, type PyTraceStep, type TraceValue } from "@hermes/shared";
import type { LiveFrame } from "../types";
import type { Lesson, Piece, Step } from "./model";
import { TILE_H } from "./view";

const MAX_LETTERS = 24;
const MAX_WORDS = 10;
const MAX_WORD = 12;
const MARK = 4;
const LIT = 3;
const OVER = TILE_H + 4;

type Seq = { kind: "letters"; items: string[] } | { kind: "words"; items: string[] };

const norm = (text: string) => text.toLowerCase().replace(/\s+/g, "");
const clip = (text: string, most: number) => (text.length > most ? `${text.slice(0, most - 1)}…` : text);

/** Un local de texto completo (la traza recorta los muy largos). */
function strOf(v: TraceValue | undefined): string | null {
  return v && v.t === "str" && v.n === v.v.length ? v.v : null;
}

/** Una lista de textos completa. */
function wordsOf(v: TraceValue | undefined): string[] | null {
  if (!v || v.t !== "list" || v.n !== v.v.length) return null;
  const out: string[] = [];
  for (const item of v.v) {
    const s = strOf(item);
    if (s === null) return null;
    out.push(s);
  }
  return out;
}

const sameWords = (a: string[], b: string[]) => {
  const x = a.map((w) => w.toLowerCase()).sort();
  const y = b.map((w) => w.toLowerCase()).sort();
  return x.length === y.length && x.every((w, i) => w === y[i]);
};

interface Shape {
  /** Líneas del for: variable de la letra, qué recorre y si va al revés. */
  loops: { line: number; item: string | null; over: string; reversed: boolean; index: string | null }[];
  /** Variables que se usan como índice de algo (`x[i]`). */
  indices: string[];
}

/** Lo que el código dice de sí mismo: sus for y sus índices. */
function shapeOf(code: string): Shape {
  const loops: Shape["loops"] = [];
  const indices = new Set<string>();
  code.split("\n").forEach((text, at) => {
    const line = at + 1;
    const head = /^\s*for\s+(.+?)\s+in\s+(.+?)\s*:\s*(#.*)?$/.exec(text);
    if (head) {
      const target = head[1]!.replace(/[()\s]/g, "");
      const over = head[2]!.trim();
      let m: RegExpExecArray | null;
      if ((m = /^range\(\s*len\(\s*(\w+)\s*\)\s*\)$/.exec(over))) loops.push({ line, item: null, over: m[1]!, reversed: false, index: target });
      else if ((m = /^enumerate\(\s*(\w+)\s*\)$/.exec(over))) {
        const [index, item] = target.split(",");
        loops.push({ line, item: item ?? null, over: m[1]!, reversed: false, index: index ?? null });
      } else if ((m = /^reversed\(\s*(\w+)\s*\)$/.exec(over)) || (m = /^(\w+)\[\s*::\s*-1\s*\]$/.exec(over)))
        loops.push({ line, item: target, over: m[1]!, reversed: true, index: null });
      else if ((m = /^(\w+)$/.exec(over))) loops.push({ line, item: target, over: m[1]!, reversed: false, index: null });
    }
    for (const m of text.matchAll(/\w+\[\s*([A-Za-z_]\w*)\s*(?:[-+]\s*\d+\s*)?\]/g)) indices.add(m[1]!);
  });
  for (const loop of loops) if (loop.index) indices.add(loop.index);
  return { loops, indices: [...indices] };
}

/**
 * Empareja la secuencia nueva con las fichas que ya están (en orden, o en orden
 * inverso si es el texto al revés): las que coinciden se corren, las demás son
 * fichas nuevas, y las viejas sin pareja se van.
 */
function align(old: { piece: number; text: string }[], next: string[], words: boolean): (number | null)[] {
  const key = (s: string) => (words ? s.toLowerCase() : s.toLowerCase());
  const reversedOld = [...old].reverse();
  const forward = old.map((o) => key(o.text)).join("\u0000");
  const backward = reversedOld.map((o) => key(o.text)).join("\u0000");
  const target = next.filter((s) => s.trim()).map(key).join("\u0000");
  const pool = forward !== backward && target === backward ? reversedOld : old;
  const out: (number | null)[] = [];
  let from = 0;
  for (const item of next) {
    let found = -1;
    for (let j = from; j < pool.length; j++) {
      if (key(pool[j]!.text) === key(item)) {
        found = j;
        break;
      }
    }
    if (found >= 0) {
      out.push(pool[found]!.piece);
      from = found + 1;
    } else out.push(null);
  }
  return out;
}

/** La escena en vivo de una ejecución, o null si el componedor no la puede mostrar. */
export function liveLesson(frame: LiveFrame, base: Pick<Lesson, "id" | "title">): Lesson | null {
  const { trace, fn, code } = frame;
  if (!fn || trace.phase !== "done") return null;
  const steps = trace.steps;
  const own = steps.filter((s) => s.fn === fn);
  if (!own.length) return null;
  // Recursión: cada llamada tiene sus locals y el componedor no tiene pila.
  if ((code.match(new RegExp(`\\b${fn}\\s*\\(`, "g")) ?? []).length > 1) return null;
  const param = Object.keys(own[0]!.locals)[0];
  const text = param ? strOf(own[0]!.locals[param]) : null;
  if (!param || text === null || [...text].length > MAX_LETTERS) return null;
  const shape = shapeOf(code);
  const lines = code.split("\n");

  const pieces: Piece[] = [];
  let tiles: { piece: number; text: string }[] = [];
  let tilesVar = param;
  let kind: Seq["kind"] = "letters";
  const marked = new Set<number>();
  let out = "";
  let maxLetters = 1;
  let maxWords = 1;
  let wordChars = 1;
  let previous: PyTraceStep | undefined;
  let lastOwn: Step | null = null;
  const loopRuns = new Map<number, number>();
  const raw: Omit<Step, "slots" | "lift" | "faces">[] = [];
  const layouts: { order: number[]; faces: Map<number, string>; lift: Map<number, number>; reversedView: boolean }[] = [];

  const place = (seq: Seq) => {
    if (seq.kind !== kind) {
      // Cambio de fichas (partir en palabras): todo lo de antes se va.
      tiles = [];
      kind = seq.kind;
    }
    const match = align(tiles, seq.items, seq.kind === "words");
    tiles = seq.items.map((item, at) => {
      let piece = match[at];
      if (piece === null || piece === undefined) {
        piece = pieces.length;
        pieces.push(seq.kind === "words" ? { label: item, group: 1 } : { label: item, space: item.trim() === "" });
      }
      return { piece, text: item };
    });
    if (seq.kind === "letters") maxLetters = Math.max(maxLetters, tiles.length);
    else {
      maxWords = Math.max(maxWords, tiles.length);
      wordChars = Math.max(wordChars, ...tiles.map((t) => t.text.length));
    }
    for (const m of [...marked]) if (!tiles.some((t) => t.piece === m)) marked.delete(m);
  };

  /** Qué local es "el texto" en este paso: el que acaba de cambiar manda. */
  const pickTiles = (cur: PyTraceStep): Seq | null => {
    const changed = new Set(Object.keys(cur.locals).filter((k) => JSON.stringify(previous?.locals[k]) !== JSON.stringify(cur.locals[k])));
    const valid: { name: string; seq: Seq }[] = [];
    for (const [name, v] of Object.entries(cur.locals)) {
      const words = wordsOf(v);
      if (words && words.length && sameWords(words, text.split(/\s+/).filter(Boolean))) {
        if (words.length > MAX_WORDS || words.some((w) => w.length > MAX_WORD)) return null;
        valid.push({ name, seq: { kind: "words", items: words } });
        continue;
      }
      const s = strOf(v);
      if (s === null || [...s].length > MAX_LETTERS || [...s].length < 2 && name !== param) continue;
      if (shape.loops.some((l) => l.item === name)) continue;
      const n = norm(s);
      if (name === param || (n === norm(text) || n === [...norm(text)].reverse().join("")) && n.length > 0)
        valid.push({ name, seq: { kind: "letters", items: [...s] } });
    }
    const fresh = valid.find((c) => changed.has(c.name) && c.name !== param);
    const keep = valid.find((c) => c.name === tilesVar);
    const chosen = fresh ?? keep ?? valid.find((c) => c.name === param) ?? valid[0];
    if (!chosen) return null;
    tilesVar = chosen.name;
    return chosen.seq;
  };

  let failed = false;
  steps.forEach((cur, k) => {
    if (failed) return;
    const mine = cur.fn === fn;
    if (!mine) {
      // Una función auxiliar del alumno: el componedor queda como estaba.
      if (lastOwn) {
        raw.push({ ...lastOwn, say: clip(`en ${cur.fn}() · línea ${cur.line}`, 44), lit: [] });
        layouts.push(layouts[layouts.length - 1]!);
      }
      return;
    }
    const seq = pickTiles(cur);
    if (!seq) {
      failed = true;
      return;
    }
    const before = tiles.map((t) => t.piece).join(",");
    place(seq);
    const tilesMoved = before !== tiles.map((t) => t.piece).join(",");
    const source = lines[cur.line - 1] ?? "";
    const len = tiles.length;

    // Carros: primero los índices que el código usa como x[i]; si no, el for.
    const marks: number[] = [];
    for (const name of shape.indices) {
      const v = cur.locals[name];
      if (v && v.t === "int" && v.v !== null) marks.push(v.v < 0 ? len + v.v : v.v);
      if (marks.length === 2) break;
    }
    let loopAt: number | null = null;
    if (cur.event === "line") {
      for (const loop of shape.loops) {
        if (loop.item === null || !(loop.over === tilesVar || loop.over === param)) continue;
        const runs = loopRuns.get(loop.line) ?? 0;
        const idx = runs - 1;
        if (idx >= 0 && idx < len) {
          const item = strOf(cur.locals[loop.item]);
          const at = loop.reversed ? len - 1 - idx : idx;
          if (item !== null && tiles[at]?.text === item) loopAt = at;
        }
      }
    }
    if (cur.event === "line") loopRuns.set(cur.line, (loopRuns.get(cur.line) ?? 0) + 1);
    if (!marks.length && loopAt !== null) marks.push(loopAt);

    // Ventana: lo último que cambió y no es ficha, índice ni la letra del for.
    const skip = new Set<string>([param, tilesVar, ...shape.indices, ...shape.loops.map((l) => l.item ?? "")]);
    const changed = Object.keys(cur.locals).filter(
      (name) => cur.locals[name]!.t !== "fn" && JSON.stringify(previous?.locals[name]) !== JSON.stringify(cur.locals[name]),
    );
    const accumulated = changed.filter((name) => !skip.has(name) && !(wordsOf(cur.locals[name]) && kind === "words" && name === tilesVar));
    if (accumulated.length) {
      const name = accumulated[accumulated.length - 1]!;
      out = clip(traceRepr(cur.locals[name]), 16);
      // Un acumulador que cambia con el carro puesto en una ficha: esa ficha cuenta.
      if (loopAt !== null && tiles[loopAt] && previous && marks.length === 1) marked.add(tiles[loopAt]!.piece);
    }
    const isReturn = cur.event === "return";
    if (isReturn) out = clip(traceRepr(cur.ret), 16);

    // Lectura: qué hizo este paso.
    let say: string;
    if (k === 0 || (previous && previous.fn !== fn)) say = trace.call ?? `${fn}(…)`;
    else if (isReturn) {
      const got = traceRepr(cur.ret);
      say = frame.expected !== undefined && got !== frame.expected ? `return ${got} · esperado ${frame.expected}` : `return ${got}`;
    } else if (cur.event === "exception") say = `línea ${cur.line} · ${cur.exc ?? "error"}`;
    else {
      const shown = changed.filter((name) => cur.locals[name]!.t !== "fn");
      say = shown.length ? shown.map((name) => `${name} = ${traceRepr(cur.locals[name])}`).join(" · ") : source.trim();
    }
    if (tilesMoved && k > 0 && !isReturn) say = `${tilesVar} = ${traceRepr(cur.locals[tilesVar])}`;

    // Vista al revés: la línea que va a correr hace `x[::-1]` o `reversed(x)` (no un for).
    const reversedView =
      !isReturn &&
      !/^\s*for\b/.test(source) &&
      new RegExp(`(\\b${tilesVar}\\s*\\[\\s*::\\s*-1\\s*\\]|reversed\\(\\s*${tilesVar}\\s*\\))`).test(source);

    const lit = marks.filter((m) => m >= 0 && m < len).map((m) => tiles[m]!.piece);
    const faces = new Map<number, string>();
    const lift = new Map<number, number>();
    for (const t of tiles) {
      faces.set(t.piece, t.text);
      lift.set(t.piece, marked.has(t.piece) ? MARK : lit.includes(t.piece) ? LIT : 0);
    }
    layouts.push({ order: tiles.map((t) => t.piece), faces, lift, reversedView });
    const step: Omit<Step, "slots" | "lift" | "faces"> = {
      dur: 0.3,
      lit,
      len,
      a: marks[0] !== undefined ? Math.max(-0.5, Math.min(MAX_LETTERS, marks[0])) + 0.5 : null,
      b: marks[1] !== undefined ? Math.max(-0.5, Math.min(MAX_LETTERS, marks[1])) + 0.5 : null,
      knee: new RegExp(`\\blen\\(\\s*${tilesVar}\\s*\\)`).test(source),
      out,
      say: clip(reversedView ? `${tilesVar}[::-1] → ${traceRepr(reversedOf(cur.locals[tilesVar]))}` : say, 46),
      group: kind === "words" ? 1 : 0,
    };
    raw.push(step);
    lastOwn = { ...step, slots: [], lift: [], faces: [] };
    previous = cur;
  });
  if (failed || !raw.length) return null;

  // Con todas las fichas conocidas, cada paso dice dónde va cada una.
  const full: Step[] = raw.map((step, k) => {
    const layout = layouts[k]!;
    const n = layout.order.length;
    const slots: (number | null)[] = pieces.map(() => null);
    const lift: number[] = pieces.map(() => 0);
    const faces: string[] = pieces.map((p) => p.label);
    layout.order.forEach((piece, at) => {
      slots[piece] = layout.reversedView ? n - 1 - at : at;
      lift[piece] = layout.reversedView ? OVER : layout.lift.get(piece) ?? 0;
      faces[piece] = layout.faces.get(piece) ?? pieces[piece]!.label;
    });
    return { ...step, slots, lift, faces };
  });

  const letterCap = Math.max(6, maxLetters);
  return {
    id: base.id,
    cap: letterCap,
    groups: [
      { cap: letterCap, chars: 1 },
      { cap: Math.max(3, maxWords), chars: Math.max(4, wordChars) },
    ],
    mechanism: true,
    scenes: [{ key: `vivo-${steps.length}-${trace.call ?? ""}`, pieces, steps: full, spoken: trace.call ?? fn }],
    title: base.title,
    hint: "en vivo · tu código",
    keys: [
      { mark: "raised", label: `Las fichas: ${(kind as Seq["kind"]) === "words" ? "la lista de palabras" : "el texto"} de tu código` },
      { mark: "lit", label: "Donde está tu índice o tu for" },
      { mark: "edge", label: "La ventana: lo que acumulas y lo que devuelves" },
    ],
    caption:
      "Tu código, paso a paso: las fichas son el texto con el que trabajas en ese paso (o sus palabras, si las partes), los carros van donde están tus índices o tu for, y la ventana muestra lo que acumulas y, al final, lo que devolviste.",
  };
}

function reversedOf(v: TraceValue | undefined): TraceValue | undefined {
  if (!v) return v;
  if (v.t === "str") return { ...v, v: [...v.v].reverse().join("") };
  if (v.t === "list") return { ...v, v: [...v.v].reverse() };
  return v;
}

const cache = new WeakMap<object, Map<string, Lesson | null>>();

/** Memoizado por traza: el reproductor pide la misma escena en cada paso. */
export function liveLessonOf(frame: LiveFrame, base: Pick<Lesson, "id" | "title">): Lesson | null {
  let byCode = cache.get(frame.trace);
  if (!byCode) cache.set(frame.trace, (byCode = new Map()));
  const key = `${base.id}\u0000${frame.code}\u0000${frame.expected ?? ""}`;
  if (!byCode.has(key)) byCode.set(key, liveLesson(frame, base));
  return byCode.get(key)!;
}
