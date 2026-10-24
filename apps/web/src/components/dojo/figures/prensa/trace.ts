// Modo en vivo, lógica pura: cómo se lee una traza REAL del alumno en la prensa.
//
// Lo que entra = los parámetros (los locals del primer paso de la función). Lo
// que se arma dentro = las variables que no son parámetros: cada línea que
// cambia una es un golpe del troquel y la ficha queda apilada sobre la mesa.
// Lo que sale = el `ret` del paso return; si es None la bandeja queda vacía,
// que es justo el error de print en vez de return.
//
// `canShow` es honesto: si el código hace algo que la prensa no puede pintar
// sin inventar (listas, otra función, más de dos variables de trabajo, un
// bucle sin fin), dice que no y el Dojo usa la mesa de trabajo.

import { traceRepr, type PyTraceStep, type TraceValue } from "@hermes/shared";
import type { LiveFrame } from "../types";

const SCALAR: TraceValue["t"][] = ["int", "float", "str", "bool", "none"];
/** Lo más largo que cabe grabado en una ficha (la bandeja mide 66). */
export const MAX_TEXT = 22;
/** Con más pasos ya no es una prensa: es un bucle largo (mejor la mesa). */
const MAX_STEPS = 160;
/** Variables de trabajo que caben apiladas bajo el troquel. */
export const MAX_WORK = 2;

/** Lo que va grabado en la ficha: los textos sin comillas (las comillas son sintaxis). */
export function tileTextOf(v: TraceValue | undefined): string {
  if (!v) return "";
  if (v.t === "str") return v.v + (v.n > v.v.length ? "…" : "");
  return traceRepr(v);
}

/** Lo mismo desde el repr de Python del pedido (`'Hola, Ana!'` → `Hola, Ana!`). */
export function tileTextOfRepr(repr: string): string {
  const m = repr.match(/^(['"])([\s\S]*)\1$/);
  return m ? m[2]!.replace(/\\(['"\\])/g, "$1") : repr;
}

const scalar = (v: TraceValue | undefined) => !!v && SCALAR.includes(v.t);
const fits = (v: TraceValue) => tileTextOf(v).length <= MAX_TEXT;

export function canShow(frame: LiveFrame): boolean {
  const { trace, fn } = frame;
  const steps = trace.steps;
  if (!fn || trace.truncated || !steps.length || steps.length > MAX_STEPS) return false;
  if (steps.some((s) => s.fn !== fn)) return false;
  const params = Object.keys(steps[0]!.locals);
  if (params.length < 1 || params.length > 2) return false;
  const work = new Set<string>();
  for (const s of steps) {
    for (const [k, v] of Object.entries(s.locals)) {
      if (!scalar(v) || !fits(v)) return false;
      if (!params.includes(k)) work.add(k);
    }
    if (s.ret && (!scalar(s.ret) || !fits(s.ret))) return false;
  }
  return work.size <= MAX_WORK;
}

/** Lo que muestra la prensa al terminar un paso. */
export interface StepState {
  /** Texto grabado de cada variable (parámetros y de trabajo) en este paso. */
  values: Record<string, string>;
  /** Variables de trabajo que ya existen, en orden de aparición (de abajo hacia arriba). */
  work: string[];
  /** Dónde están las fichas de entrada: en el cargador, bajo el troquel o ya consumidas. */
  place: "magazine" | "die" | "out";
  /** La línea que acaba de correr hizo trabajo: golpe del troquel. */
  strike: boolean;
  /** Lo que devolvió (solo en el paso return con un valor). */
  out: { text: string; verdict: "ok" | "bad" | "unknown" } | null;
  /** La última línea impresa hasta aquí (lo que muestra el visor de print). */
  printed: string;
  /** La función se trabó en este paso (nombre de la excepción). */
  jam: string | null;
  readout: string;
}

export interface TracePlan {
  params: string[];
  /** Todas las variables de trabajo de la traza, por primera aparición. */
  workAll: string[];
  states: StepState[];
  /** Si la traza imprimió algo (entonces hay visor). */
  prints: boolean;
}

const lastLine = (text: string) => {
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  return lines[lines.length - 1] ?? "";
};

export function planOf(frame: LiveFrame): TracePlan {
  const { trace, fn, expected } = frame;
  const steps = trace.steps;
  const params = Object.keys(steps[0]?.locals ?? {});
  const workAll: string[] = [];
  for (const s of steps) for (const k of Object.keys(s.locals)) if (!params.includes(k) && !workAll.includes(k)) workAll.push(k);
  let place: StepState["place"] = "magazine";
  const states = steps.map((cur, k): StepState => {
    const prev: PyTraceStep | undefined = steps[k - 1];
    const values: Record<string, string> = {};
    for (const [name, v] of Object.entries(cur.locals)) values[name] = tileTextOf(v);
    const work = workAll.filter((w) => w in cur.locals);
    const changed = prev ? Object.keys(cur.locals).filter((x) => JSON.stringify(prev.locals[x]) !== JSON.stringify(cur.locals[x])) : [];
    const newOut = prev ? trace.stdout.slice(prev.out, cur.out) : "";
    const printed = lastLine(trace.stdout.slice(0, cur.out));
    const ran = prev?.line ?? cur.line;
    let out: StepState["out"] = null;
    let jam: string | null = null;
    let readout: string;
    if (k === 0) {
      readout = `${params.length > 1 ? "entran" : "entra"} ${params.map((p) => `${p}=${traceRepr(cur.locals[p])}`).join(", ")}`;
    } else if (cur.event === "exception") {
      jam = cur.exc ?? "error";
      place = "die";
      readout = `línea ${cur.line} · ${jam}`;
    } else if (cur.event === "return") {
      const ret = cur.ret;
      if (prev?.event === "exception" || trace.error) {
        jam = prev?.exc ?? trace.error?.type ?? "error";
        place = "die";
        readout = `se detuvo: ${jam} · no devuelve nada`;
      } else if (!ret || ret.t === "none") {
        place = "die";
        readout = printed
          ? `devuelve None · solo imprimió ${printed}`
          : "devuelve None · la bandeja queda vacía";
      } else {
        place = "out";
        const repr = traceRepr(ret);
        const verdict = expected === undefined ? "unknown" : repr === expected ? "ok" : "bad";
        out = { text: tileTextOf(ret), verdict };
        readout =
          verdict === "bad" ? `devuelve ${repr} · se esperaba ${expected}` : verdict === "ok" ? `devuelve ${repr} · igual al pedido` : `devuelve ${repr}`;
      }
    } else {
      place = "die";
      const parts = changed.map((x) => `${x} = ${traceRepr(cur.locals[x])}`);
      if (newOut) parts.push(`print → ${lastLine(newOut)}`);
      readout = parts.length ? `línea ${ran} · ${parts.join(", ")}` : `línea ${ran}`;
    }
    const strike = k > 0 && (changed.length > 0 || newOut.length > 0 || cur.event !== "line");
    return { values, work, place, strike, out, printed, jam, readout };
  });
  return { params, workAll, states, prints: trace.stdout.trim().length > 0 };
}
