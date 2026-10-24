// Modelo puro de la prensa: qué ejemplos corre cada lección (salen del catálogo
// real del Dojo, nada inventado), el guion de un golpe de prensa en el tiempo y
// el texto del readout. La vista y el loop leen todo de aquí.

import { dojoItem, type DojoItem } from "@hermes/shared";

/** Un valor de Python tal como viaja en la ficha (número o texto). */
export type Value = number | string;

export interface Example {
  /** Nombre de la función (el que va grabado en la placa). */
  fn: string;
  args: Value[];
  /** Lo que devuelve; null = None (la bandeja queda vacía). */
  out: Value | null;
  /** Lo que la función imprime en el visor (solo el caso de print). */
  printed: Value | null;
  /** Grabado del troquel por dentro (la operación del cuerpo). */
  die: string;
}

export interface Lesson {
  id: string;
  /** true = concepto (el mecanismo siempre a la vista). */
  concept: boolean;
  fn: string;
  examples: Example[];
  /** Cuántos carriles necesita el cargador (el máximo de argumentos). */
  lanes: number;
  /** Si hay visor de print (solo el concepto lo usa). */
  visor: boolean;
}

/** Representación estilo Python: textos con comillas, números tal cual. */
export function py(value: Value | null): string {
  if (value === null) return "None";
  if (typeof value === "string") return `"${value}"`;
  return Number.isInteger(value) ? String(value) : String(value);
}

/** Lo que va grabado en la ficha: el valor sin comillas (las comillas son sintaxis). */
export function tileText(value: Value | null): string {
  if (value === null) return "None";
  return typeof value === "string" ? value : py(value);
}

export const callOf = (ex: Example) => `${ex.fn}(${ex.args.map(py).join(", ")})`;

// ── Datos de cada lección ──────────────────────────────────────────────

/**
 * f-funciones es una lección de concepto: sus ejemplos viven en los bloques de
 * código. Se leen de ahí (las llamadas a area_rectangulo y el `r = f(5)` del
 * check de print vs return) en vez de copiarlos a mano.
 */
function conceptExamples(item: DojoItem): Example[] {
  const out: Example[] = [];
  for (const block of item.blocks ?? []) {
    const code = block.kind === "code" || block.kind === "check" ? block.code ?? "" : "";
    if (/def area_rectangulo\(base, altura\)/.test(code) && /base \* altura/.test(code)) {
      for (const m of code.matchAll(/print\(area_rectangulo\((-?\d+), (-?\d+)\)\)/g)) {
        const base = Number(m[1]);
        const altura = Number(m[2]);
        // El cuerpo de la lección: resultado = base * altura; return resultado.
        out.push({ fn: "area_rectangulo", args: [base, altura], out: base * altura, printed: null, die: "×" });
      }
    }
    if (block.kind === "check" && /def f\(x\):\s*\n\s*print\(x \* 2\)/.test(code) && block.answer === "None") {
      const m = code.match(/r = f\((-?\d+)\)/);
      if (m) {
        const x = Number(m[1]);
        // Imprime x * 2 pero no tiene return: devuelve None.
        out.push({ fn: "f", args: [x], out: null, printed: x * 2, die: "×2" });
      }
    }
  }
  return out;
}

/** El grabado del troquel por dentro de cada problema (solo se ve al resolverlo). */
const DIES: Record<string, string> = {
  doble: "×2",
  saludo: "Hola, _!",
  segundos: "h×3600+m×60",
};

function problemExamples(item: DojoItem): Example[] {
  const p = item.problem;
  if (!p) return [];
  return p.cases
    .filter((c) => !c.hidden && Array.isArray(c.args))
    .map((c) => ({
      fn: p.fn,
      args: (c.args ?? []) as Value[],
      out: (c.expected ?? null) as Value | null,
      printed: null,
      die: DIES[p.fn] ?? "",
    }));
}

export function lessonOf(id: string): Lesson | null {
  const item = dojoItem(id);
  if (!item) return null;
  const concept = item.kind === "concepto";
  const examples = concept ? conceptExamples(item) : problemExamples(item);
  if (!examples.length) return null;
  return {
    id,
    concept,
    fn: examples[0]!.fn,
    examples,
    lanes: Math.max(...examples.map((e) => e.args.length)),
    visor: examples.some((e) => e.printed !== null),
  };
}

// ── El golpe de prensa en el tiempo ────────────────────────────────────

/** Un ciclo completo: cae la ficha, la empujan, golpe, sale, se queda. */
export const CYCLE = 5.6;

export const T = {
  dropEnd: 0.55,
  approach: 0.6,
  contact: 0.85,
  pushEnd: 1.75,
  retractEnd: 2.4,
  down: 1.95,
  impact: 2.3,
  up: 2.8,
  ejectEnd: 3.7,
  fadeFrom: 5.2,
} as const;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
export const smooth = (v: number) => {
  const u = clamp01(v);
  return u * u * (3 - 2 * u);
};
const span = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));

export interface Phase {
  /** 0 arriba del cargador → 1 asentada en el riel. */
  drop: number;
  /** Opacidad de las fichas de entrada. */
  inAlpha: number;
  /** 0 en el cargador → 1 bajo el troquel. */
  push: number;
  /** Empujador: 0 en casa → 1 tocando la ficha → (1 + push) mientras empuja. */
  pusher: { reach: number; push: number };
  /** Carrera del ariete: 0 arriba → 1 abajo (golpe). */
  stroke: number;
  /** Ya golpeó: lo que hay bajo el troquel es la salida. */
  struck: boolean;
  /** 0 bajo el troquel → 1 en la bandeja. */
  eject: number;
  /** Opacidad de la ficha de salida. */
  outAlpha: number;
  /** La salida ya está en la bandeja (o, sin return, ya se vio que no llega). */
  landed: boolean;
  /** Brillo del golpe (0..1, decae). */
  flash: number;
}

export function phaseAt(t: number): Phase {
  const drop = span(t, 0, T.dropEnd);
  const reach = smooth(span(t, T.approach, T.contact)) * (1 - smooth(span(t, T.pushEnd, T.retractEnd)));
  const push = smooth(span(t, T.contact, T.pushEnd));
  // Baja acelerando (como un volante que suelta) y sube con calma.
  const down = span(t, T.down, T.impact);
  const stroke = t < T.impact ? down * down : 1 - smooth(span(t, T.impact, T.up));
  const struck = t >= T.impact;
  const fade = 1 - smooth(span(t, T.fadeFrom, CYCLE));
  return {
    drop: drop * drop,
    inAlpha: smooth(span(t, 0, 0.18)),
    push,
    pusher: { reach, push: t < T.pushEnd ? push : 1 },
    stroke,
    struck,
    eject: smooth(span(t, T.up - 0.05, T.ejectEnd)),
    outAlpha: fade,
    landed: t >= T.ejectEnd,
    flash: struck ? Math.exp(-(t - T.impact) / 0.35) : 0,
  };
}

/** El final quieto de un ejemplo (movimiento reducido o pausa en el final). */
export const RESTING = T.ejectEnd + 0.5;

// ── Readout ────────────────────────────────────────────────────────────

export function readoutOf(ex: Example, index: number, count: number, phase: Phase): string {
  const at = `${index + 1}/${count}`;
  if (ex.out === null) {
    if (!phase.struck) return `${callOf(ex)} → … · ${at}`;
    return `${callOf(ex)} → None · imprimió ${py(ex.printed)}`;
  }
  return `${callOf(ex)} → ${phase.landed ? py(ex.out) : "…"} · ${at}`;
}

/** Para lectores de pantalla: se escribe al cambiar de ejemplo, no en cada cuadro. */
export function spokenOf(ex: Example, index: number, count: number): string {
  const ret = ex.out === null ? `no devuelve nada (None); solo imprime ${py(ex.printed)}` : `devuelve ${py(ex.out)}`;
  return `Ejemplo ${index + 1} de ${count}: ${callOf(ex)} ${ret}`;
}
