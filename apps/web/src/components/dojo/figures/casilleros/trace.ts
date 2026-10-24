// Modo EN VIVO de los casilleros: convierte la traza real del código del alumno
// (packages/shared/src/dojo.ts) en lo que pinta la máquina en cada paso. Nada se
// inventa: los casilleros son el dict o el set que SU código arma (se llame como
// se llame), con sus claves y valores de ESE paso; la etiqueta que lleva el brazo
// es la variable que su código acaba de calcular (la palabra del for, la firma,
// lo que le falta al objetivo). Si su conteo no suma o su clave está mal, la
// máquina lo muestra tal cual.
//
// La rueda usa el mismo hash propio que el modo guion (model.ts → slotOf), con
// sondeo lineal si dos claves caen en el mismo casillero: así funciona de
// verdad una tabla hash de direccionamiento abierto como la de Python.

import { changedVars, paramsOf, traceRepr, type PyTraceStep, type TraceValue } from "@hermes/shared";
import type { LiveFrame } from "../types";
import { SLOTS, slotOf } from "./model";

/** Máximo de fichas que se apilan en un casillero; más que eso va en tarjeta. */
const MAX_CHIPS = 8;
/** Peldaños de la escalerilla de tarjetas. */
const MAX_CARDS = 3;
/** Lo que cabe en la esquina del readout a 358 px junto a la pista. */
const MAX_READOUT = 38;

export type LiveMode = "chips" | "cards" | "set";

export interface LiveBox {
  /** Texto de la placa (la clave como la escribiría el alumno, sin comillas). */
  key: string;
  chips: [number, number];
  /** Tarjetas de atrás hacia adelante (la última es la del frente). */
  cards: string[];
}

export interface LiveState {
  table: (LiveBox | null)[];
  /** Lo que lleva el brazo en este paso y a qué casillero va (null = en casa). */
  probe: { text: string; slot: number } | null;
  /** Casillero encendido: el que cambió o el que se miró. */
  lit: number | null;
  /** Casillero cuya placa coincide con la etiqueta (la etiqueta se encaja). */
  found: boolean;
  readout: string;
  /** Lo que devolvió la función, si este paso es su return. */
  ret: string | null;
  /** ¿Coincide con lo esperado? (null = no se sabe). */
  ok: boolean | null;
  /** Claves que no caben en los 6 casilleros. */
  overflow: number;
}

export interface LiveScene {
  mode: LiveMode;
  pairs: boolean;
  /** Nombre(s) de la(s) variable(s) que hacen de gabinete. */
  vars: string[];
  states: LiveState[];
  call: string;
}

const keyText = (v: TraceValue) => {
  const t = v.t === "str" ? v.v : traceRepr(v);
  return t.length > 9 ? `${t.slice(0, 8)}…` : t;
};

/** Las variables dict/set que arma la función del ejercicio (no los parámetros), en orden de aparición. */
export function containersOf(steps: PyTraceStep[], fn: string): string[] {
  const params = new Set(paramsOf(steps, fn));
  const out: string[] = [];
  for (const s of steps) {
    if (s.fn !== fn) continue;
    for (const [k, v] of Object.entries(s.locals)) {
      if ((v.t === "dict" || v.t === "set") && !params.has(k) && !out.includes(k)) out.push(k);
    }
  }
  return out;
}

/** Las entradas de un dict o set como pares [clave, valor|null]. */
function entriesOf(v: TraceValue | undefined): [TraceValue, TraceValue | null][] {
  if (!v) return [];
  if (v.t === "dict") return v.v;
  if (v.t === "set") return v.v.map((k) => [k, null]);
  return [];
}

const same = (a: TraceValue | undefined | null, b: TraceValue | undefined | null) => JSON.stringify(a) === JSON.stringify(b);

function modeOf(id: string, steps: PyTraceStep[], vars: string[]): LiveMode {
  let mode: LiveMode = "set";
  for (const s of steps) {
    for (const name of vars) {
      const v = s.locals[name];
      if (v?.t !== "dict") continue;
      for (const [, x] of v.v) {
        if (x.t === "int" && id !== "h-dos-suma" && (x.v ?? 0) >= 0 && (x.v ?? 0) <= MAX_CHIPS) mode = mode === "cards" ? "cards" : "chips";
        else mode = "cards";
      }
    }
  }
  return mode;
}

/** Lo que va en las tarjetas de un valor (lista = una tarjeta por elemento). */
function cardsOf(x: TraceValue | null): string[] {
  if (!x) return [];
  if (x.t === "list" || x.t === "tuple" || x.t === "set") {
    const items = x.v.map(keyText);
    if (x.n > MAX_CARDS) return [...items.slice(0, MAX_CARDS - 1), `+${x.n - (MAX_CARDS - 1)}`];
    return items;
  }
  return [keyText(x)];
}

/**
 * La etiqueta que lleva el brazo: el valor escalar que el código del alumno
 * acaba de calcular (la variable del for, la firma, lo que le falta). Entre
 * varias que cambiaron a la vez gana la que es (o será) una clave del gabinete.
 */
function probeOf(steps: PyTraceStep[], k: number, fn: string, keysEver: Set<string>, skip: Set<string>): TraceValue | null {
  for (let j = k; j >= 0; j--) {
    const s = steps[j]!;
    if (s.fn !== fn) continue;
    const prev = steps[j - 1];
    const changed = changedVars(prev && prev.fn === fn ? prev : undefined, s).filter((name) => {
      const v = s.locals[name];
      return !skip.has(name) && v && (v.t === "str" || v.t === "int" || v.t === "float" || v.t === "tuple");
    });
    if (!changed.length) continue;
    const pick = changed.find((name) => keysEver.has(JSON.stringify(s.locals[name]))) ?? changed.find((name) => s.locals[name]!.t === "str") ?? changed[changed.length - 1]!;
    return s.locals[pick]!;
  }
  return null;
}

const lineOf = (code: string, line: number) => (code.split("\n")[line - 1] ?? "").trim();

const cache = new WeakMap<object, Map<string, LiveScene | null>>();

/** La escena completa (todos los pasos) de una ejecución; null si no hay gabinete que pintar. */
export function sceneOf(id: string, frame: LiveFrame): LiveScene | null {
  const per = cache.get(frame.trace) ?? new Map<string, LiveScene | null>();
  cache.set(frame.trace, per);
  const memo = `${id}:${frame.fn}:${frame.expected ?? ""}`;
  if (per.has(memo)) return per.get(memo)!;
  const scene = build(id, frame);
  per.set(memo, scene);
  return scene;
}

function build(id: string, frame: LiveFrame): LiveScene | null {
  const { steps } = frame.trace;
  const fn = frame.fn;
  if (!fn) return null;
  const vars = containersOf(steps, fn).slice(0, 2);
  if (!vars.length) return null;
  const pairs = vars.length === 2;
  const mode = modeOf(id, steps, vars);

  // Toda clave que alguna vez entra al gabinete, para saber qué escalar es "la que entra".
  const keysEver = new Set<string>();
  for (const s of steps) for (const name of vars) for (const [key] of entriesOf(s.locals[name])) keysEver.add(JSON.stringify(key));
  const params = new Set(paramsOf(steps, fn));

  // Casillero de cada clave: hash propio + sondeo lineal, fijo para toda la traza.
  const slotOfKey = new Map<string, number>();
  const taken = new Set<number>();
  let overflow = 0;
  const place = (key: TraceValue, commit: boolean): number | null => {
    const id2 = JSON.stringify(key);
    const had = slotOfKey.get(id2);
    if (had !== undefined) return had;
    const start = slotOf(key.t === "str" ? key.v : traceRepr(key));
    for (let i = 0; i < SLOTS; i++) {
      const slot = (start + i) % SLOTS;
      if (!taken.has(slot)) {
        if (commit) {
          slotOfKey.set(id2, slot);
          taken.add(slot);
        }
        return slot;
      }
    }
    if (commit) overflow++;
    return null;
  };

  const states: LiveState[] = [];
  for (let k = 0; k < steps.length; k++) {
    const s = steps[k]!;
    const inFn = s.fn === fn;
    const prev = steps[k - 1];

    // El gabinete en este paso: las claves que tiene, en sus casilleros.
    const table: (LiveBox | null)[] = Array.from({ length: SLOTS }, () => null);
    vars.forEach((name, side) => {
      for (const [key, x] of entriesOf(s.locals[name])) {
        const slot = place(key, true);
        if (slot === null) continue;
        const box = (table[slot] ??= { key: keyText(key), chips: [0, 0], cards: [] });
        if (mode === "chips") box.chips[side as 0 | 1] = x && x.t === "int" ? (x.v ?? 0) : 0;
        if (mode === "cards") box.cards = cardsOf(x);
      }
    });

    // Lo que cambió en el gabinete al llegar a este paso.
    let changedKey: TraceValue | null = null;
    let changedVar: string | null = null;
    let removed = false;
    if (inFn && prev && prev.fn === fn) {
      for (const name of vars) {
        const before = entriesOf(prev.locals[name]);
        const after = entriesOf(s.locals[name]);
        for (const [key, x] of after) {
          const old = before.find(([b]) => same(b, key));
          if (!old || !same(old[1], x)) {
            changedKey = key;
            changedVar = name;
          }
        }
        for (const [key] of before) {
          if (!after.some(([a]) => same(a, key))) {
            changedKey = key;
            changedVar = name;
            removed = true;
          }
        }
      }
    }

    const probeV = inFn ? probeOf(steps, k, fn, keysEver, new Set([...vars, ...params])) : null;
    const probeKey = changedKey ?? probeV;
    const probeSlot = probeKey ? place(probeKey, false) : null;
    const isReturn = s.event === "return" && s.fn === fn;
    const probe = !isReturn && probeKey && probeSlot !== null ? { text: keyText(probeKey), slot: probeSlot } : null;
    const found = Boolean(probe && table[probe.slot] && table[probe.slot]!.key === probe.text);

    // Readout: lo que pasó en ESTE paso, como lo escribiría Python.
    let readout = `línea ${s.line}`;
    let ret: string | null = null;
    let ok: boolean | null = null;
    if (isReturn) {
      ret = traceRepr(s.ret);
      ok = frame.expected !== undefined ? matches(id, s.ret, frame.expected) : null;
      const tail = ok === true ? " ✓" : ok === false ? " ≠ esperado" : "";
      const room = MAX_READOUT - "devuelve ".length - tail.length;
      readout = `devuelve ${ret.length > room ? `${ret.slice(0, room - 1)}…` : ret}${tail}`;
    } else if (s.event === "exception") {
      readout = `línea ${s.line} · ${s.exc ?? "error"}`;
    } else if (changedKey && changedVar) {
      const v = s.locals[changedVar];
      const k2 = traceRepr(changedKey);
      if (removed) readout = `del ${changedVar}[${k2}]`;
      else if (v?.t === "set") readout = `${changedVar}.add(${k2})`;
      else {
        const x = entriesOf(v).find(([key]) => same(key, changedKey))?.[1];
        readout = `${changedVar}[${k2}] = ${traceRepr(x ?? undefined)}`;
      }
    } else if (inFn) {
      // ¿La línea que va a correr (o la que acaba de correr) pregunta por una clave? (x in gabinete)
      const inTest = (st: PyTraceStep | undefined) => {
        if (!st || st.fn !== fn) return null;
        const text = lineOf(frame.code, st.line);
        for (const name of vars) {
          const m = text.match(new RegExp(`([A-Za-z_][\\w]*)\\s+(not\\s+)?in\\s+${name}\\b`));
          const asked = m ? st.locals[m[1]!] : undefined;
          if (m && asked) {
            const has = entriesOf(st.locals[name]).some(([key]) => same(key, asked));
            return `${traceRepr(asked)} ${m[2] ? "not in" : "in"} ${name} → ${has !== Boolean(m[2]) ? "True" : "False"}`;
          }
        }
        return null;
      };
      // ¿Lee una clave del gabinete? (conteo[letra] sin asignarle)
      const reads = (st: PyTraceStep | undefined) => {
        if (!st || st.fn !== fn) return null;
        const text = lineOf(frame.code, st.line);
        for (const name of vars) {
          const m = text.match(new RegExp(`\\b${name}\\[([A-Za-z_][\\w]*)\\](?!\\s*[+\\-*/]?=(?!=))`));
          const key = m ? st.locals[m[1]!] : undefined;
          if (m && key) {
            const hit = entriesOf(st.locals[name]).find(([k3]) => same(k3, key));
            return `${name}[${traceRepr(key)}] → ${hit ? traceRepr(hit[1] ?? undefined) : "KeyError"}`;
          }
        }
        return null;
      };
      const ch = changedVars(prev && prev.fn === fn ? prev : undefined, s).filter((name) => s.locals[name]!.t !== "fn" && !vars.includes(name));
      const asked = inTest(s) ?? reads(s) ?? (ch.length ? null : inTest(prev) ?? reads(prev));
      const one = ch.length === 1 ? `${ch[0]} = ${traceRepr(s.locals[ch[0]!])}` : "";
      if (asked) readout = one && one.length + asked.length + 3 <= MAX_READOUT ? `${one} · ${asked}` : asked;
      else if (ch.length > 1) readout = `${ch.join(", ")} = ${ch.map((name) => traceRepr(s.locals[name])).join(", ")}`;
      else if (ch.length) readout = `${ch[0]} = ${traceRepr(s.locals[ch[0]!])}`;
      else readout = `línea ${s.line} · ${lineOf(frame.code, s.line)}`;
    }
    if (readout.length > MAX_READOUT) readout = `${readout.slice(0, MAX_READOUT - 1)}…`;

    const lit = isReturn ? null : changedKey ? (place(changedKey, false) ?? null) : probe ? probe.slot : null;
    states.push({ table, probe, lit, found, readout, ret, ok, overflow });
  }
  return { mode, pairs, vars, states, call: frame.trace.call ?? fn };
}

// ── ¿Devolvió lo esperado? Con la misma regla que el corrector del problema ──

type Js = null | boolean | number | string | Js[] | { [k: string]: Js };

function toJs(v: TraceValue | undefined): Js {
  if (!v) return null;
  switch (v.t) {
    case "none":
      return null;
    case "bool":
      return v.v;
    case "int":
    case "float":
      return v.v;
    case "str":
      return v.v;
    case "list":
    case "tuple":
    case "set":
      return v.v.map(toJs);
    case "dict":
      return Object.fromEntries(v.v.map(([k, x]) => [String(toJs(k)), toJs(x)]));
    default:
      return v.r;
  }
}

/** El esperado llega como repr de Python de un valor JSON: se vuelve a JSON. */
function parseExpected(text: string): Js | undefined {
  try {
    const json = text
      .replace(/'((?:[^'\\]|\\.)*)'/g, (_, body: string) => JSON.stringify(body.replace(/\\'/g, "'")))
      .replace(/\bTrue\b/g, "true")
      .replace(/\bFalse\b/g, "false")
      .replace(/\bNone\b/g, "null");
    return JSON.parse(json) as Js;
  } catch {
    return undefined;
  }
}

const canon = (v: Js): string => {
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k]!)}`).join(",")}}`;
  return JSON.stringify(v);
};

/** dos_suma acepta las posiciones en cualquier orden; agrupar, los grupos en cualquier orden. */
function matches(id: string, got: TraceValue | undefined, expectedText: string): boolean | null {
  const want = parseExpected(expectedText);
  if (want === undefined) return null;
  let a = toJs(got);
  let b = want;
  const sorted = (x: Js) => (Array.isArray(x) ? [...x].sort((p, q) => (canon(p) < canon(q) ? -1 : 1)) : x);
  if (id === "h-dos-suma") {
    a = sorted(a);
    b = sorted(b);
  }
  if (id === "h-agrupar") {
    a = Array.isArray(a) ? sorted(a.map(sorted)) : a;
    b = Array.isArray(b) ? sorted(b.map(sorted)) : b;
  }
  return canon(a) === canon(b);
}

/** ¿Esta ejecución arma un dict o un set en la función del ejercicio? */
export function canShow(frame: LiveFrame): boolean {
  return Boolean(frame.fn && containersOf(frame.trace.steps, frame.fn).length);
}
