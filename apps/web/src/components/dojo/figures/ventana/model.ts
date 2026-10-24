// Modelo puro de la máquina "ventana" (Fig 6): sin DOM ni geometría. De aquí
// salen los ejemplos (los casos visibles del catálogo, nunca números
// inventados), cada parada del recorrido y el texto del readout. La vista solo
// convierte valores en alturas.

import { dojoItem } from "@hermes/shared";

export type MachineId = "c-ganancia" | "c-ventana";

export interface Example {
  values: number[];
  /** Ancho de la ventana (1 en la ganancia: el carro mira un día a la vez). */
  k: number;
  expected: number;
  /** La llamada tal como se escribe en Python: `mejor_ganancia([7, 1, 5])`. */
  call: string;
}

/**
 * Una parada del recorrido. Lo que se ve en ella se deriva de aquí:
 * - `at`: dónde está el carro (índice del día o del inicio de la ventana; null = en casa).
 * - `down`: las sondas tocan las barras.
 * - `low`: nivel del tope (precio más bajo visto); null = tope arriba.
 * - `result`: se marcan la respuesta (compra/venta o el bloque) como en el pedido.
 */
export interface Stop {
  at: number | null;
  down: boolean;
  low: number | null;
  needle: number;
  best: number | null;
  result: boolean;
  /** Barras con la cabeza encendida (las que están dentro de la ventana). */
  inside: number[];
  readout: string;
  /** Lo que dice el lector de pantalla al llegar aquí. */
  spoken: string;
  /** Cuánto se queda quieta antes de seguir (tour). */
  dwell: number;
}

/** La respuesta del problema, para el "pedido" y para el cierre del recorrido. */
export interface Answer {
  value: number;
  /** Ganancia: día de compra y de venta (null si no hay forma de ganar). */
  buy: number | null;
  sell: number | null;
  /** Ventana: primer índice del mejor bloque. */
  start: number | null;
}

const list = (values: number[]) => `[${values.join(", ")}]`;

export const FN: Record<MachineId, string> = { "c-ganancia": "mejor_ganancia", "c-ventana": "mejor_suma_k" };

export function examplesOf(id: MachineId): Example[] {
  const cases = dojoItem(id)?.problem?.cases ?? [];
  return cases
    .filter((c) => !c.hidden && Array.isArray(c.args))
    .map((c) => {
      const args = c.args as unknown[];
      const values = (args[0] as number[]).slice();
      const k = id === "c-ventana" ? (args[1] as number) : 1;
      const call = id === "c-ventana" ? `${FN[id]}(${list(values)}, ${k})` : `${FN[id]}(${list(values)})`;
      return { values, k, expected: c.expected as number, call };
    });
}

// ── Ganancia: una pasada con el precio más bajo visto y la mejor ganancia ──

interface GainDay {
  price: number;
  low: number;
  lowDay: number;
  gain: number;
  best: number;
  buy: number | null;
  sell: number | null;
}

export function gainPass(values: number[]): GainDay[] {
  const days: GainDay[] = [];
  let low = Infinity;
  let lowDay = -1;
  let best = 0;
  let buy: number | null = null;
  let sell: number | null = null;
  values.forEach((price, day) => {
    if (price < low) {
      low = price;
      lowDay = day;
    }
    const gain = price - low;
    if (gain > best) {
      best = gain;
      buy = lowDay;
      sell = day;
    }
    days.push({ price, low, lowDay, gain, best, buy, sell });
  });
  return days;
}

// ── Ventana: la suma de k seguidos, reusando la cuenta anterior ──

interface WindowStep {
  start: number;
  sum: number;
  best: number;
  bestStart: number;
  out: number | null;
  in: number | null;
}

export function windowPass(values: number[], k: number): WindowStep[] {
  const steps: WindowStep[] = [];
  let sum = values.slice(0, k).reduce((a, b) => a + b, 0);
  let best = sum;
  let bestStart = 0;
  steps.push({ start: 0, sum, best, bestStart, out: null, in: null });
  for (let i = k; i < values.length; i++) {
    sum += values[i]! - values[i - k]!;
    if (sum > best) {
      best = sum;
      bestStart = i - k + 1;
    }
    steps.push({ start: i - k + 1, sum, best, bestStart, out: values[i - k]!, in: values[i]! });
  }
  return steps;
}

export function answerOf(id: MachineId, ex: Example): Answer {
  if (id === "c-ganancia") {
    const days = gainPass(ex.values);
    const last = days.at(-1);
    return { value: last?.best ?? 0, buy: last?.buy ?? null, sell: last?.sell ?? null, start: null };
  }
  const steps = windowPass(ex.values, ex.k);
  const last = steps.at(-1)!;
  return { value: last.best, buy: null, sell: null, start: last.bestStart };
}

const range = (from: number, count: number) => Array.from({ length: count }, (_, i) => from + i);

/** El pedido (reveal = false): el problema y la respuesta que debe salir, sin el mecanismo. */
export function orderStop(id: MachineId, ex: Example): Stop {
  const a = answerOf(id, ex);
  if (id === "c-ganancia") {
    const tail =
      a.buy === null || a.sell === null
        ? "nunca sube después"
        : `compra día ${a.buy} a ${ex.values[a.buy]}, vende día ${a.sell} a ${ex.values[a.sell]}`;
    return {
      at: null,
      down: false,
      low: null,
      needle: 0,
      best: a.value,
      result: true,
      inside: [],
      readout: `${ex.call} → ${a.value} · ${tail}`,
      spoken: `Pedido: ${ex.call} debe dar ${a.value}; ${tail}.`,
      dwell: 4.2,
    };
  }
  const block = ex.values.slice(a.start!, a.start! + ex.k);
  return {
    at: null,
    down: false,
    low: null,
    needle: 0,
    best: a.value,
    result: true,
    inside: range(a.start!, ex.k),
    readout: `${ex.call} → ${a.value} · bloque ${block.join(", ")}`,
    spoken: `Pedido: ${ex.call} debe dar ${a.value}, con el bloque ${block.join(", ")}.`,
    dwell: 4.2,
  };
}

/** El recorrido completo (reveal = true): casa → una parada por paso → resultado. */
export function passStops(id: MachineId, ex: Example): Stop[] {
  const stops: Stop[] = [];
  const home: Stop = {
    at: null,
    down: false,
    low: null,
    needle: 0,
    best: null,
    result: false,
    inside: [],
    readout: `${ex.call} · una sola pasada`,
    spoken: `${ex.call}: el carro está en casa, listo para una sola pasada.`,
    dwell: 1.1,
  };
  stops.push(home);
  if (id === "c-ganancia") {
    const days = gainPass(ex.values);
    const n = ex.values.length;
    days.forEach((d, day) => {
      stops.push({
        at: day,
        down: true,
        low: d.low,
        needle: d.gain,
        best: d.best,
        result: false,
        inside: [day],
        readout: `${ex.call} · día ${day}/${n - 1} · mín ${d.low} · hoy ${d.gain} · mejor ${d.best}`,
        spoken: `Día ${day}: precio ${d.price}, el más bajo visto es ${d.low}, vender hoy daría ${d.gain}, la mejor ganancia va en ${d.best}.`,
        dwell: 1.25,
      });
    });
    const a = answerOf(id, ex);
    const tail =
      a.buy === null || a.sell === null
        ? "nunca sube después"
        : `compra día ${a.buy} a ${ex.values[a.buy]}, vende día ${a.sell} a ${ex.values[a.sell]}`;
    stops.push({
      at: null,
      down: false,
      low: null,
      needle: 0,
      best: a.value,
      result: true,
      inside: [],
      readout: `${ex.call} → ${a.value} · ${tail}`,
      spoken: `Resultado: ${a.value}; ${tail}.`,
      dwell: 3.4,
    });
    return stops;
  }
  const steps = windowPass(ex.values, ex.k);
  steps.forEach((s, index) => {
    const swap = s.out === null ? "" : ` · sale ${s.out}, entra ${s.in}`;
    stops.push({
      at: s.start,
      down: true,
      low: null,
      needle: s.sum,
      best: s.best,
      result: false,
      inside: range(s.start, ex.k),
      readout: `${ex.call}${swap} · suma ${s.sum} · mejor ${s.best}`,
      spoken:
        index === 0
          ? `Primera ventana, posiciones 0 a ${ex.k - 1}: suma ${s.sum}.`
          : `La ventana avanza: sale ${s.out}, entra ${s.in}; suma ${s.sum}, la mejor va en ${s.best}.`,
      dwell: 1.3,
    });
  });
  const last = steps.at(-1)!;
  const block = ex.values.slice(last.bestStart, last.bestStart + ex.k);
  stops.push({
    at: last.bestStart,
    down: true,
    low: null,
    needle: last.best,
    best: last.best,
    result: true,
    inside: range(last.bestStart, ex.k),
    readout: `${ex.call} → ${last.best} · bloque ${block.join(", ")}`,
    spoken: `Resultado: ${last.best}, el bloque ${block.join(", ")}.`,
    dwell: 3.4,
  });
  return stops;
}
