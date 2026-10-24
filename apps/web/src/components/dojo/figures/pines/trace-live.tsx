"use client";

// La máquina "pines" con el código del alumno (modo en vivo). El panel de abajo
// del editor avanza el paso de la traza; aquí cada paso nuevo hace viajar al
// puente y al cabezal hasta su pin y lo golpea, el contador suma el paso real y
// la perilla marca el n del ejemplo. El movimiento dura lo que dura el paso
// (70-450 ms, medido entre cambios) y todo se escribe por refs con Rig.

import * as React from "react";
import { asksForStillness, useInView, useLoop } from "../../iso/react/live";
import type { LiveFrame } from "../types";
import { pinIndex } from "./art";
import { HOME, PRESS_DEPTH, STEPS_PER_SECOND, SUMA, smooth, type Pose } from "./model";
import { PIN_COUNT, Rig, lerp } from "./rig";
import { PinesScene } from "./scene";
import { shapeOf, upTo } from "./trace";
import { PIN_SUNK, PIN_TOP } from "./view";

const LABEL =
  "El tablero de pines contando los pasos de tu código. Cada línea que corre tu función hunde un pin: el puente avanza una columna por cada vuelta de tu bucle y el cabezal baja por la fila, un pin por línea. El contador del frente marca los pasos reales que lleva la traza; la perilla, el n del ejemplo.";

const STRIKE = 0.55; // fracción del paso que dura el golpe (el resto es el viaje)
const PEAK = 0.42; // dentro del golpe, cuándo llega al fondo

/** Las posiciones de la perilla en vivo: los n de los ejemplos del problema y el de este ejemplo. */
function detentsWith(n: number) {
  return [...new Set([...SUMA().cases.map((c) => c.n), n])].sort((a, b) => a - b);
}

export function PinesTraceLive({ frame }: { frame: LiveFrame }) {
  const shape = shapeOf(frame)!;
  const anchor = React.useRef<HTMLDivElement | null>(null);
  const visible = useInView(anchor);
  const rig = React.useRef(new Rig());
  const detents = React.useMemo(() => detentsWith(shape.n), [shape.n]);

  // Lo que el bucle de dibujo necesita, escrito al cambiar de paso.
  const motion = React.useRef({
    from: { ...HOME } as Pose,
    to: { ...HOME } as Pose,
    pose: { ...HOME } as Pose,
    t: 0,
    dur: 0.3,
    strike: false, // ¿este paso golpea? (no al saltar hacia atrás o varios pasos)
    park: false, // el return final: tras el golpe el cabezal vuelve a casa y deja ver el tablero
    counted: -1, // índice del paso contado (−1 = ninguno aún)
    last: 0, // performance.now() del cambio anterior
    prevStep: -1,
  });

  React.useEffect(() => rig.current.attach(anchor.current), []);

  // Un paso nuevo: de dónde sale el cabezal, a dónde va y cuánto tiene para llegar.
  React.useEffect(() => {
    const m = motion.current;
    const now = performance.now();
    const gap = m.last ? (now - m.last) / 1000 : 0.3;
    m.last = now;
    const counted = upTo(shape, frame.step) - 1;
    const forward = counted === m.counted + 1 && frame.step === m.prevStep + 1;
    m.prevStep = frame.step;
    m.from = { ...m.pose };
    m.counted = counted;
    const at = counted >= 0 ? shape.place[counted] : null;
    m.to = at ? { a: at.a, b: at.b, tip: 0 } : { ...HOME };
    m.dur = Math.min(0.45, Math.max(0.07, gap)) * 0.92;
    m.strike = forward && counted >= 0;
    const cur = frame.trace.steps[frame.step];
    m.park = frame.step === frame.trace.steps.length - 1 && cur?.event === "return" && cur.fn === frame.fn;
    m.t = 0;
    rig.current.refresh();
    kick();
    // kick es estable (useLoop); la forma cambia con la traza.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame.step, shape]);

  const kick = useLoop((dt, calm) => {
    const m = motion.current;
    const r = rig.current;
    m.t += dt;
    const u = calm ? 1 : m.t / m.dur;
    const travel = m.strike ? 1 - STRIKE : 1;
    // Viaje con el martillo arriba, después el golpe (si toca).
    const w = smooth(u / travel);
    let tip = 0;
    if (m.strike && u > travel) {
      const v = Math.min(1, (u - travel) / STRIKE);
      tip = (v < PEAK ? smooth(v / PEAK) : 1 - smooth((v - PEAK) / (1 - PEAK))) * PRESS_DEPTH;
    }
    let pose: Pose = { a: lerp(m.from.a, m.to.a, w), b: lerp(m.from.b, m.to.b, w), tip: calm ? 0 : tip };
    const parked = m.park ? (calm ? 1 : smooth((m.t - m.dur - 0.15) / 0.6)) : 0;
    if (parked > 0) pose = { a: lerp(m.to.a, HOME.a, parked), b: lerp(m.to.b, HOME.b, parked), tip: 0 };
    m.pose = pose;
    const z = r.pose(pose);

    // Pines: el tablero después de este paso; el pin de este paso sigue a la
    // punta mientras baja y queda hundido cuando ella sube.
    const want = new Float32Array(PIN_COUNT);
    const look = new Uint8Array(PIN_COUNT);
    let exact = -1;
    if (m.counted >= 0) {
      const board = shape.boards[m.counted];
      for (let a = 0; a < 10; a++)
        for (let b = 0; b < 11; b++)
          if (board[a * 11 + b]) {
            want[pinIndex(a, b)] = PIN_SUNK;
            look[pinIndex(a, b)] = 1;
          }
      const here = shape.place[m.counted];
      const index = pinIndex(here.a, here.b);
      const reached = !m.strike || calm || u >= travel + STRIKE * PEAK;
      if (!reached) {
        want[index] = Math.min(PIN_SUNK, Math.max(0, PIN_TOP - z));
        look[index] = want[index] > 0.2 ? 1 : 0;
        exact = index;
      }
    }
    r.pins(want, look, dt, calm, exact);
    const steps = m.counted + 1;
    const rolling = r.counter(steps, dt, calm);
    const turning = r.knob(Math.max(0, detents.indexOf(shape.n)), detents.length, dt, calm);
    const ticking = r.watch(steps / STEPS_PER_SECOND, dt, calm);
    r.done();
    return calm ? false : u < 1 || (m.park && parked < 1) || rolling || turning || ticking || !r.pinsSettled(want);
  }, visible);

  // Sin movimiento (reduce motion), cada paso se pinta quieto.
  React.useEffect(() => {
    if (asksForStillness()) kick();
  }, [frame.step, kick]);

  return (
    <div ref={anchor} className="pines-trace">
      <PinesScene label={LABEL} detents={detents.length} />
    </div>
  );
}
