"use client";

// La máquina "ventana" movida por el código del alumno: cada paso de su traza
// fija una pose (trace.ts) y un solo bucle lleva las piezas hasta ella con
// seguimiento exponencial: el carro se desliza, las sondas se alzan mientras
// viaja y bajan al llegar, el tope baja al mínimo que ÉL lleva, la aguja marca
// su suma o su mejor. El SVG se arma una vez; por cuadro solo se escriben
// atributos por ref.

import * as React from "react";
import { IsoFigure, Plate } from "../../iso/react/draw";
import { useInView, useLoop, useReadout } from "../../iso/react/live";
import { translateAlong } from "../../iso/iso-kit";
import type { LiveFrame } from "../types";
import { ART } from "./art";
import { MACHINES, columnShape, dragOf, needleOf, rodOf } from "./geometry";
import { EMPTY, LiveSolid, blankSolid, paint, ringTravel, show, type ColumnNodes, type PlungerNodes } from "./live";
import type { MachineId } from "./model";
import { analyze, solvedMarks, type LiveRig } from "./trace";
import { HEIGHT, WIDTH, unitFor } from "./view";

interface Target {
  car1: number;
  car2: number | null;
  tips1: number[];
  tip2: number;
  ring: number;
  needle: number;
  drag: number | null;
  heights: number[];
}

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const lerp = (a: number, b: number, s: number) => a + (b - a) * s;
const follow = (x: number, to: number, dt: number, tau: number, calm: boolean) => {
  if (calm) return to;
  const next = x + (to - x) * (1 - Math.exp(-dt / tau));
  return Math.abs(to - next) < 0.01 ? to : next;
};

function unitOf(rig: LiveRig) {
  const v = MACHINES[rig.id].view;
  return rig.ex >= 0 ? v.units[rig.ex]! : unitFor(v.spec, rig.values);
}

function targetOf(rig: LiveRig, step: number): Target {
  const m = MACHINES[rig.id];
  const v = m.view;
  const st = rig.states[Math.min(step, rig.states.length - 1)]!;
  const u = unitOf(rig);
  const heights = v.xs.map((_, j) => (j < rig.values.length ? v.topOf(rig.values[j]!, u) : EMPTY));
  const head = m.heads[rig.k]!;
  const half = ((rig.k - 1) / 2) * v.spec.pitch;
  const base = rig.id === "c-ventana" ? (st.start ?? (st.main === null ? null : clamp(st.main, 0, rig.values.length - rig.k))) : st.main;
  const car1 = base === null ? v.home : v.xs[base]! + half;
  const tips1 = head.offsets.map((_, s) => (st.down && base !== null ? heights[base + s]! : v.travel));
  const car2 = st.inner === null ? null : v.xs[st.inner]!;
  const tip2 = st.inner !== null && st.innerDown ? heights[st.inner]! : v.travel;
  const ring = st.low !== null && st.main !== null ? Math.max(v.topOf(st.low, u), v.spec.zero + 5.6) : ringTravel(rig.id);
  return { car1, car2, tips1, tip2, ring, needle: st.needle, drag: st.drag, heights };
}

export function liveFits(id: MachineId, frame: LiveFrame) {
  return analyze(id, frame) !== null;
}

export function VentanaTrace({ id, frame, title }: { id: MachineId; frame: LiveFrame; title: string }) {
  const rig = analyze(id, frame)!;
  const m = MACHINES[id];
  const v = m.view;
  const art = ART[id];
  const step = Math.min(frame.step, rig.states.length - 1);
  const state = rig.states[step]!;
  const marks = state.solved ? solvedMarks(rig) : null;
  const { anchor, say } = useReadout<HTMLDivElement>();
  const root = React.useRef<HTMLDivElement | null>(null);
  const visible = useInView(root);

  const columns = React.useRef<ColumnNodes[]>(
    v.xs.map(() => ({ stem: blankSolid(), value: blankSolid(), gain: blankSolid(), cap: null, ringBack: null, ringFront: null, collarBack: null, collarFront: null, key: "" })),
  );
  const plungers = React.useRef<PlungerNodes[]>(Array.from({ length: v.kMax + 1 }, () => ({ rod: blankSolid(), pad: null, key: "" })));
  const car1 = React.useRef<(SVGGElement | null)[]>([]);
  const car2 = React.useRef<(SVGGElement | null)[]>([]);
  const tope = React.useRef<SVGGElement | null>(null);
  const needle = React.useRef<SVGPathElement | null>(null);
  const drag = React.useRef<SVGPathElement | null>(null);
  const block = React.useRef<SVGGElement | null>(null);

  const target = React.useRef<Target>(targetOf(rig, step));
  const shown = React.useRef<Target>(targetOf(rig, step));
  const flags = React.useRef({ state, marks, rig });
  flags.current = { state, marks, rig };

  const draw = React.useCallback(() => {
    const cur = shown.current;
    const goal = target.current;
    const { state: st, marks: mk, rig: r } = flags.current;
    const u = unitOf(r);
    const lift1 = clamp(Math.abs(cur.car1 - goal.car1) / (v.spec.pitch * 0.3), 0, 1);
    const move1 = translateAlong(v.P, [cur.car1, 0, 0]);
    for (const n of car1.current) n?.setAttribute("transform", move1);
    const two = cur.car2 !== null;
    for (const n of car2.current) {
      show(n, two);
      if (two) n?.setAttribute("transform", translateAlong(v.P, [cur.car2!, 0, 0]));
    }
    // Al acertar, el tope se alza: queda encendida solo la ganancia de la respuesta.
    const ringZ = mk ? ringTravel(id) : lerp(cur.ring, ringTravel(id), lift1);
    tope.current?.setAttribute("transform", translateAlong(v.P, [0, 0, ringZ]));
    needle.current?.setAttribute("d", needleOf(m, cur.needle));
    if (drag.current) {
      show(drag.current, cur.drag !== null);
      if (cur.drag !== null) drag.current.setAttribute("d", dragOf(m, cur.drag));
    }

    // Lo que se marca al acertar: collares de compra/venta o el bloque punteado.
    const example = r.ex >= 0 ? v.examples[r.ex]! : null;
    const level = mk && example && mk.buy !== null ? v.topOf(example.values[mk.buy]!, u) : null;
    show(block.current, mk !== null && id === "c-ventana");
    const slot = clamp(Math.round((cur.car1 - v.xs[0]!) / v.spec.pitch), 0, v.xs.length - 1);
    const ringOn = id === "c-ganancia" && r.low !== null;
    const engaged = ringOn && !mk && Math.abs(cur.car1 - v.xs[slot]!) < 0.6 && st.low !== null;
    const winStart = id === "c-ventana" ? (mk?.start ?? st.start) : null;

    columns.current.forEach((c, j) => {
      const top = cur.heights[j]!;
      let cut = Infinity;
      if (engaged && j === slot && ringZ < top) cut = ringZ;
      if (mk && level !== null && j === mk.sell) cut = level;
      const lit = winStart !== null && j >= winStart && j < winStart + r.k;
      const key = `${top.toFixed(2)}|${cut === Infinity ? "-" : cut.toFixed(2)}|${lit ? 1 : 0}`;
      if (key !== c.key) {
        c.key = key;
        const shape = top <= EMPTY + 0.05 ? null : columnShape(m, j, top, cut);
        paint(c.stem, shape?.stem ?? null, false);
        paint(c.value, shape?.value ?? null, lit);
        paint(c.gain, shape?.gain ?? null, true);
        c.cap?.setAttribute("d", shape?.cap ?? "");
      }
      const ringHere = ringOn && j === slot;
      show(c.ringBack, ringHere);
      show(c.ringFront, ringHere);
      if (ringHere) {
        const move = translateAlong(v.P, [cur.car1, 0, ringZ]);
        c.ringBack?.setAttribute("transform", move);
        c.ringFront?.setAttribute("transform", move);
      }
      const collar = mk !== null && level !== null && (j === mk.buy || j === mk.sell);
      show(c.collarBack, collar);
      show(c.collarFront, collar);
      if (collar && level !== null) {
        const move = translateAlong(v.P, [v.xs[j]!, 0, level]);
        c.collarBack?.setAttribute("transform", move);
        c.collarFront?.setAttribute("transform", move);
      }
    });

    // Sondas: las k del carro principal y la del segundo carro; se alzan mientras su carro viaja.
    const head = m.heads[r.k]!;
    const probes: { x: number; tip: number }[] = head.offsets.map((o, s) => ({
      x: cur.car1 + o,
      tip: lerp(cur.tips1[s] ?? v.travel, v.travel, lift1),
    }));
    if (two) {
      const lift2 = clamp(Math.abs(cur.car2! - (goal.car2 ?? cur.car2!)) / (v.spec.pitch * 0.3), 0, 1);
      probes.push({ x: cur.car2!, tip: lerp(cur.tip2, v.travel, lift2) });
    }
    plungers.current.forEach((p, s) => {
      const probe = probes[s];
      if (!probe) {
        paint(p.rod, null, false);
        show(p.pad, false);
        p.key = "";
        return;
      }
      const key = `${probe.x.toFixed(2)}|${probe.tip.toFixed(2)}`;
      if (key === p.key) return;
      p.key = key;
      paint(p.rod, rodOf(m, probe.x, probe.tip), false);
      show(p.pad, true);
      p.pad?.setAttribute("transform", translateAlong(v.P, [probe.x, 0, probe.tip]));
    });
  }, [id, m, v]);

  const kick = useLoop((dt, calm) => {
    const cur = shown.current;
    const goal = target.current;
    cur.car1 = follow(cur.car1, goal.car1, dt, 0.08, calm);
    if (goal.car2 === null) cur.car2 = null;
    else cur.car2 = cur.car2 === null ? goal.car2 : follow(cur.car2, goal.car2, dt, 0.06, calm);
    cur.tips1 = goal.tips1.map((t, s) => follow(cur.tips1[s] ?? t, t, dt, 0.06, calm));
    cur.tip2 = follow(cur.tip2, goal.tip2, dt, 0.05, calm);
    cur.ring = follow(cur.ring, goal.ring, dt, 0.08, calm);
    cur.needle = follow(cur.needle, goal.needle, dt, 0.1, calm);
    cur.drag = goal.drag === null ? null : cur.drag === null ? goal.drag : follow(cur.drag, goal.drag, dt, 0.1, calm);
    cur.heights = goal.heights.map((h, j) => follow(cur.heights[j] ?? h, h, dt, 0.12, calm));
    draw();
    const done =
      cur.car1 === goal.car1 &&
      cur.car2 === goal.car2 &&
      cur.tip2 === goal.tip2 &&
      cur.ring === goal.ring &&
      cur.needle === goal.needle &&
      cur.drag === goal.drag &&
      cur.tips1.every((t, s) => t === goal.tips1[s]) &&
      cur.heights.every((h, j) => h === goal.heights[j]);
    return !done;
  }, visible);

  // Cada paso nuevo: nueva meta, readout de ese paso, y el bucle la persigue.
  React.useEffect(() => {
    target.current = targetOf(rig, step);
    say(state.readout);
    kick();
  }, [rig, step, state, say, kick]);

  React.useLayoutEffect(() => {
    draw();
  }, [draw]);

  const svg = React.useMemo(
    () => (
      <IsoFigure width={WIDTH} height={HEIGHT} label={labelOf(rig)}>
        {art.bench}
        {rig.ex >= 0 ? (
          <g ref={block} style={{ display: "none" }}>
            {art.blocks[rig.ex]}
          </g>
        ) : null}
        {art.railBack}
        <g ref={(n) => void (car1.current[0] = n)}>{art.skirtBack}</g>
        <g ref={(n) => void (car2.current[0] = n)} style={{ display: "none" }}>
          {art.skirtBack}
        </g>
        {art.rail}
        <g ref={(n) => void (car1.current[1] = n)}>
          {art.car}
          {rig.low !== null && id === "c-ganancia" ? (
            <g ref={tope} className="vt-tope">
              {art.topeBody}
            </g>
          ) : null}
          {art.dial}
          <path ref={drag} className="vt-drag" style={{ display: "none" }} />
          <path ref={needle} className="iso-line vt-needle" data-tone="lit" />
          <circle className="vt-hub" cx={v.at([0, v.dialY, v.towerTop + 5.3])[0]} cy={v.at([0, v.dialY, v.towerTop + 5.3])[1]} r={0.9} />
        </g>
        <g ref={(n) => void (car2.current[1] = n)} style={{ display: "none" }}>
          {art.car}
        </g>
        {v.xs.map((_, j) => {
          const c = columns.current[j]!;
          return (
            <g key={j}>
              {art.sockets[j]}
              <g ref={(n) => void (c.ringBack = n)} style={{ display: "none" }}>
                {art.ringBack}
              </g>
              <g ref={(n) => void (c.collarBack = n)} style={{ display: "none" }}>
                {art.collarBack}
              </g>
              <g className="vt-col">
                <LiveSolid nodes={c.stem} tone="mid" />
                <LiveSolid nodes={c.value} tone="mid" />
                <LiveSolid nodes={c.gain} tone="hi" crease="lo" className="vt-gain" />
                <path ref={(n) => void (c.cap = n)} className="iso-line" data-tone="faint" />
              </g>
              <g ref={(n) => void (c.collarFront = n)} style={{ display: "none" }}>
                {art.collarFront}
              </g>
              <g ref={(n) => void (c.ringFront = n)} style={{ display: "none" }}>
                {art.ringFront}
              </g>
            </g>
          );
        })}
        <g ref={(n) => void (car1.current[2] = n)}>{art.heads[rig.k]!.back}</g>
        <g ref={(n) => void (car2.current[2] = n)} style={{ display: "none" }}>
          {art.heads[1]!.back}
        </g>
        {plungers.current.map((p, s) => (
          <g key={s}>
            <LiveSolid nodes={p.rod} tone="mid" />
            <g ref={(n) => void (p.pad = n)} style={{ display: "none" }}>
              {art.pad}
            </g>
          </g>
        ))}
        <g ref={(n) => void (car1.current[3] = n)}>{art.heads[rig.k]!.front}</g>
        <g ref={(n) => void (car2.current[3] = n)} style={{ display: "none" }}>
          {art.heads[1]!.front}
        </g>
        {art.scale}
        {rig.ex >= 0 ? art.scaleTicks[rig.ex] : null}
      </IsoFigure>
    ),
    [art, id, rig, v],
  );

  const carts = rig.loops.some((l) => l.depth === 1) ? " · dos carros" : "";
  return (
    <div className="vt-wrap">
      <Plate fig="Fig 6" title={title} hint={`paso ${step + 1}/${rig.states.length}${carts}`} readout={state.readout}>
        <div
          ref={(node) => {
            root.current = node;
            anchor.current = node;
          }}
          className="vt vt-trace"
        >
          {svg}
        </div>
      </Plate>
    </div>
  );
}

function labelOf(rig: LiveRig) {
  const list = `[${rig.values.join(", ")}]`;
  const carts = rig.loops.some((l) => l.depth === 1)
    ? "Dos carros, uno por cada for anidado de tu código: el de adentro recorre el riel otra vez por cada paso del de afuera."
    : "Un carro recorre el riel donde tu código lee la lista.";
  const extra =
    rig.id === "c-ganancia"
      ? rig.low
        ? ` El tope anillado está a la altura de tu variable ${rig.low}.`
        : ""
      : rig.sum
        ? ` Las barras encendidas son el bloque de ${rig.k} que suma lo que tu variable ${rig.sum}.`
        : "";
  return `Tu código en la máquina del riel: una barra por cada número de ${list}. ${carts}${extra} La carátula marca ${rig.id === "c-ventana" ? rig.sum ?? "tu suma" : rig.today ?? rig.best ?? "tu resultado"}${rig.best && rig.id === "c-ventana" ? ` y la marca de arrastre ${rig.best}` : ""}.`;
}
