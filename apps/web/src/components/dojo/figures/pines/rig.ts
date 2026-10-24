// Los mandos de la máquina "pines" ya montada: toma los nodos del SVG una vez
// (por sus data-*) y escribe atributos con lo que le pidan — dónde está el
// cabezal, qué pines están hundidos, qué marca el contador, la perilla y el
// cronómetro. Lo comparten el guion (live.tsx) y el modo en vivo con el código
// del alumno (trace-live.tsx): los dos mueven la MISMA máquina, sin re-render.

import { follow } from "../../iso/react/live";
import { knobAngle, knobPointer, subHand, watchHand } from "./geometry";
import type { Pose } from "./model";
import { BRIDGE_BACK, DIGITS, PIN_SUNK, PIN_TOP, TIP_REST, pinX, pinY, shift } from "./view";
import { DRUM_H } from "./geometry";

export const PIN_COUNT = 110;

/** Altura de la punta del martillo para una pose (0 arriba · 1 toca la cabeza · 2 al fondo). */
export const tipZ = (tip: number) => (tip <= 1 ? TIP_REST - tip * (TIP_REST - PIN_TOP) : PIN_TOP - (tip - 1) * PIN_SUNK);

interface Nodes {
  bridge: SVGGElement[];
  head: SVGGElement | null;
  striker: SVGGElement | null;
  pins: (SVGGElement | null)[]; // por índice de pin: el <g data-sink>
  heads: (Element | null)[]; // el .iso-solid de la cabeza (para data-lit)
  wheels: { roll: SVGGElement; a: SVGTextElement; b: SVGTextElement }[];
  pointer: SVGPathElement | null;
  hand: SVGPathElement | null;
  sub: SVGPathElement | null;
}

/** Cómo luce un pin hundido: 0 de pie · 1 encendido · 2 la copia (media altura, tapa en sombra). */
export type PinLook = 0 | 1 | 2;

export class Rig {
  private n: Nodes = { bridge: [], head: null, striker: null, pins: [], heads: [], wheels: [], pointer: null, hand: null, sub: null };
  private sinks = new Float32Array(PIN_COUNT);
  private looks = new Uint8Array(PIN_COUNT);
  private wheels = new Float64Array(DIGITS);
  private lead = new Uint8Array(DIGITS);
  private knobAt = 0;
  private clockAt = 0;
  /** Al tomar los nodos (o pedirlo) se escribe todo una vez, cambie o no. */
  private fresh = true;

  attach(root: Element | null) {
    if (!root) return;
    const n = this.n;
    n.bridge = Array.from(root.querySelectorAll<SVGGElement>("[data-bridge]"));
    n.head = root.querySelector<SVGGElement>("[data-head]");
    n.striker = root.querySelector<SVGGElement>("[data-striker]");
    n.pins = [];
    n.heads = [];
    root.querySelectorAll<SVGGElement>("[data-pin]").forEach((g) => {
      const index = Number(g.dataset.pin);
      const sink = g.querySelector<SVGGElement>("[data-sink]");
      n.pins[index] = sink;
      n.heads[index] = sink?.querySelectorAll(".iso-solid")[1] ?? null;
    });
    n.wheels = Array.from(root.querySelectorAll<SVGGElement>("[data-wheel]")).map((roll) => {
      const texts = roll.querySelectorAll<SVGTextElement>("text");
      return { roll, a: texts[0], b: texts[1] };
    });
    n.pointer = root.querySelector<SVGPathElement>("[data-pointer]");
    n.hand = root.querySelector<SVGPathElement>("[data-hand]");
    n.sub = root.querySelector<SVGPathElement>("[data-sub]");
    this.fresh = true;
  }

  /** Pide reescribir todo en el próximo cuadro (cambio de ejemplo). */
  refresh() {
    this.fresh = true;
  }

  /** Puente, cabezal y martillo. Devuelve la altura de la punta. */
  pose(pose: Pose) {
    const n = this.n;
    const bridge = shift(pinX(pose.a) - BRIDGE_BACK);
    for (const g of n.bridge) g.setAttribute("transform", bridge);
    n.head?.setAttribute("transform", shift(pinX(pose.a) - BRIDGE_BACK, pinY(pose.b)));
    const z = tipZ(pose.tip);
    n.striker?.setAttribute("transform", shift(0, 0, z - TIP_REST));
    return z;
  }

  /**
   * Pines: `want` es cuánto debe estar hundido cada uno y `look` cómo se ve.
   * `exact` marca el pin que el martillo está empujando (sigue la punta sin
   * suavizar); los demás bajan rápido y suben con un resorte corto.
   */
  pins(want: Float32Array, look: Uint8Array, dt: number, calm: boolean, exact = -1) {
    const n = this.n;
    for (let index = 0; index < PIN_COUNT; index++) {
      const goal = want[index];
      const before = this.sinks[index];
      const now = calm || index === exact ? goal : goal >= before ? follow(before, goal, dt, 0.04) : follow(before, goal, dt, 0.09);
      if (Math.abs(now - before) > 0.005 || this.fresh) {
        this.sinks[index] = now;
        n.pins[index]?.setAttribute("transform", now > 0.005 ? shift(0, 0, -now) : "");
      }
      if (look[index] !== this.looks[index] || this.fresh) {
        this.looks[index] = look[index];
        const head = n.heads[index];
        if (head) {
          if (look[index] === 1) head.setAttribute("data-lit", "");
          else head.removeAttribute("data-lit");
          if (look[index] === 2) head.setAttribute("data-copy", "");
          else head.removeAttribute("data-copy");
        }
      }
    }
  }

  /** ¿Algún pin sigue en camino? (para saber si el bucle puede dormir) */
  pinsSettled(want: Float32Array) {
    for (let index = 0; index < PIN_COUNT; index++) if (Math.abs(this.sinks[index] - want[index]) > 0.005) return false;
    return true;
  }

  /**
   * Contador: cada rueda gira sola, hacia adelante, hasta su dígito (las de
   * abajo no se mueven si el golpe suma un bloque entero: ahí se ve la escala).
   * Devuelve true mientras alguna rueda siga girando.
   */
  counter(value: number, dt: number, calm: boolean) {
    const n = this.n;
    let moving = false;
    for (let k = 0; k < DIGITS; k++) {
      const digit = Math.floor(value / Math.pow(10, k)) % 10;
      const pos = this.wheels[k];
      const settled = Math.abs(pos - Math.round(pos)) < 1e-3;
      const from = settled ? Math.round(pos) : Math.ceil(pos);
      const goal = from + ((digit - (from % 10) + 10) % 10);
      const next = calm ? goal : follow(pos, goal, dt, 0.07);
      if (next !== goal) moving = true;
      const wheel = n.wheels[DIGITS - 1 - k];
      if (next !== pos || this.fresh) {
        this.wheels[k] = next;
        if (wheel) {
          const base = Math.floor(next + 1e-6);
          const frac = next - base;
          const d0 = ((base % 10) + 10) % 10;
          if (wheel.a.textContent !== String(d0)) wheel.a.textContent = String(d0);
          const d1 = String((d0 + 1) % 10);
          if (wheel.b.textContent !== d1) wheel.b.textContent = d1;
          wheel.roll.setAttribute("transform", frac > 1e-3 ? `translate(0 ${-(frac * DRUM_H).toFixed(2)})` : "");
        }
      }
      const lead = k > 0 && value < Math.pow(10, k) ? 1 : 0;
      if (lead !== this.lead[k] || this.fresh) {
        this.lead[k] = lead;
        wheel?.roll.setAttribute("data-lead", lead ? "" : "off");
      }
    }
    return moving;
  }

  /** Perilla de n: la aguja va a la posición `index` de `count`. */
  knob(index: number, count: number, dt: number, calm: boolean) {
    this.knobAt = calm ? index : follow(this.knobAt, index, dt, 0.16);
    this.n.pointer?.setAttribute("d", knobPointer(knobAngle(this.knobAt, count)));
    return Math.abs(this.knobAt - index) > 1e-3;
  }

  /** Cronómetro: una vuelta = 1 s de cómputo; el pequeño, 30 min. */
  watch(clock: number, dt: number, calm: boolean) {
    this.clockAt = calm ? clock : follow(this.clockAt, clock, dt, 0.14);
    this.n.hand?.setAttribute("d", watchHand((this.clockAt % 1) * Math.PI * 2));
    this.n.sub?.setAttribute("d", subHand((this.clockAt / 1800) * Math.PI * 2));
    return Math.abs(this.clockAt - clock) > 1e-4;
  }

  /** Cierra el cuadro: lo siguiente solo se escribe si cambia. */
  done() {
    this.fresh = false;
  }
}

export const lerp = (a: number, b: number, w: number) => a + (b - a) * w;
export const ease = (u: number) => {
  const x = Math.min(1, Math.max(0, u));
  return x * x * (3 - 2 * x);
};
