"use client";

// La máquina "ventana" en vivo: un solo bucle que interpola entre paradas del
// modelo (alzar las sondas → deslizar el carro → bajarlas → bajar el tope) y
// escribe los atributos por ref, sin re-renderizar React por cuadro.

import * as React from "react";
import { IsoFigure } from "../../iso/react/draw";
import { asksForStillness, useInView, useLoop, useReadout } from "../../iso/react/live";
import { translateAlong, type SolidPaths } from "../../iso/iso-kit";
import { ART } from "./art";
import { MACHINES, columnShape, dragOf, needleOf, rodOf } from "./geometry";
import { answerOf, orderStop, passStops, type MachineId, type Stop } from "./model";
import { HEIGHT, SOCKET_H, WIDTH } from "./view";

// ── Poses ──

interface Pose {
  ex: number;
  k: number;
  car: number;
  tips: number[];
  ring: number;
  heights: number[];
  needle: number;
  drag: number | null;
  inside: boolean[];
  result: boolean;
}

interface Step {
  ex: number;
  stop: Stop;
}

export const EMPTY = SOCKET_H - 0.4;

function scriptOf(id: MachineId, reveal: boolean): Step[] {
  const { examples } = MACHINES[id].view;
  return examples.flatMap((example, ex) => (reveal ? passStops(id, example) : [orderStop(id, example)]).map((stop) => ({ ex, stop })));
}

function poseOf(id: MachineId, { ex, stop }: Step): Pose {
  const m = MACHINES[id];
  const v = m.view;
  const example = v.examples[ex]!;
  const u = v.units[ex]!;
  const heights = v.xs.map((_, j) => (j < example.values.length ? v.topOf(example.values[j]!, u) : EMPTY));
  const head = m.heads[example.k]!;
  const car = stop.at === null ? v.home : v.xs[stop.at]! + ((example.k - 1) / 2) * v.spec.pitch;
  const tips = head.offsets.map((_, s) => (stop.down && stop.at !== null ? heights[stop.at + s]! : v.travel));
  const ring = stop.low === null ? ringTravel(id) : Math.max(v.topOf(stop.low, u), v.spec.zero + 5.6);
  const inside = v.xs.map((_, j) => id === "c-ventana" && stop.inside.includes(j));
  return { ex, k: example.k, car, tips, ring, heights, needle: stop.needle, drag: stop.best, inside, result: stop.result };
}

export const ringTravel = (id: MachineId) => {
  const v = MACHINES[id].view;
  return v.spec.zero + v.spec.up + 3.5;
};

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const smooth = (x: number) => x * x * (3 - 2 * x);
const phase = (t: number, a: number, b: number) => smooth(clamp((t - a) / (b - a), 0, 1));
const lerp = (a: number, b: number, s: number) => a + (b - a) * s;

function blend(id: MachineId, A: Pose, B: Pose, t: number): Pose {
  if (t >= 1) return B;
  const v = MACHINES[id].view;
  const moves = A.car !== B.car || A.ex !== B.ex;
  const lift = phase(t, 0, 0.26);
  const slide = phase(t, 0.26, 0.72);
  const drop = phase(t, 0.72, 0.94);
  const settle = phase(t, 0.82, 1);
  const first = t < 0.5;
  const tips = (first ? A : B).tips.map((tip, s) => {
    if (!moves) return lerp(A.tips[s] ?? tip, B.tips[s] ?? tip, phase(t, 0.3, 0.94));
    return first ? lerp(tip, v.travel, lift) : lerp(v.travel, tip, drop);
  });
  const up = ringTravel(id);
  const ring = moves ? (first ? lerp(A.ring, up, lift) : lerp(up, B.ring, settle)) : lerp(A.ring, B.ring, settle);
  const morph = phase(t, 0.3, 0.7);
  return {
    ex: first ? A.ex : B.ex,
    k: first ? A.k : B.k,
    car: lerp(A.car, B.car, slide),
    tips,
    ring,
    heights: B.heights.map((h, j) => lerp(A.heights[j]!, h, morph)),
    needle: lerp(A.needle, B.needle, drop),
    drag: A.drag === null || B.drag === null ? (t < 0.8 ? A.drag : B.drag) : lerp(A.drag, B.drag, settle),
    inside: B.inside.map((inB, j) => (t < 0.26 ? A.inside[j]! : t > 0.9 ? inB : A.inside[j]! && inB)),
    result: t < 0.3 ? A.result : t > 0.85 ? B.result : false,
  };
}

// ── Nodos que se pintan por cuadro ──

export interface SolidNodes {
  g: SVGGElement | null;
  fill: SVGPathElement | null;
  shades: (SVGPathElement | null)[];
  top: SVGPathElement | null;
  crease: SVGPathElement | null;
  bevel: SVGPathElement | null;
  edge: SVGPathElement | null;
}

export const blankSolid = (): SolidNodes => ({ g: null, fill: null, shades: [null, null, null, null], top: null, crease: null, bevel: null, edge: null });

export function paint(nodes: SolidNodes, paths: SolidPaths | null, lit: boolean) {
  const g = nodes.g;
  if (!g) return;
  if (!paths) {
    if (g.style.display !== "none") g.style.display = "none";
    return;
  }
  if (g.style.display) g.style.display = "";
  if (lit) g.dataset.lit = "";
  else delete g.dataset.lit;
  nodes.fill?.setAttribute("d", paths.fill);
  paths.shades.forEach((d, i) => nodes.shades[i]?.setAttribute("d", d ?? ""));
  nodes.top?.setAttribute("d", paths.top);
  nodes.crease?.setAttribute("d", paths.crease);
  nodes.bevel?.setAttribute("d", paths.bevel ?? "");
  nodes.edge?.setAttribute("d", paths.outline);
}

export function LiveSolid({ nodes, tone, crease = "faint", className }: { nodes: SolidNodes; tone: "hi" | "mid" | "lo"; crease?: "faint" | "lo"; className?: string }) {
  return (
    <g
      ref={(n) => {
        nodes.g = n;
      }}
      className={className ? `iso-solid ${className}` : "iso-solid"}
      style={{ display: "none" }}
    >
      <path ref={(n) => void (nodes.fill = n)} className="iso-fill" />
      {[0, 1, 2, 3].map((i) => (
        <path
          key={i}
          ref={(n) => {
            nodes.shades[i] = n;
          }}
          className="iso-shade"
          data-shade={i}
        />
      ))}
      <path ref={(n) => void (nodes.top = n)} className="iso-top" />
      <path ref={(n) => void (nodes.crease = n)} className="iso-line iso-crease" data-tone={crease} />
      <path ref={(n) => void (nodes.bevel = n)} className="iso-line iso-bevel" data-tone={crease} />
      <path ref={(n) => void (nodes.edge = n)} className="iso-line iso-edge" data-tone={tone} />
    </g>
  );
}

export interface ColumnNodes {
  stem: SolidNodes;
  value: SolidNodes;
  gain: SolidNodes;
  cap: SVGPathElement | null;
  ringBack: SVGGElement | null;
  ringFront: SVGGElement | null;
  collarBack: SVGGElement | null;
  collarFront: SVGGElement | null;
  key: string;
}

export interface PlungerNodes {
  rod: SolidNodes;
  pad: SVGGElement | null;
  key: string;
}

export const show = (node: Element | null, on: boolean) => {
  if (!node) return;
  const el = node as SVGElement;
  const want = on ? "" : "none";
  if (el.style.display !== want) el.style.display = want;
};

// ── Componente ──

const STEP_TIME = 1.55;
const EXAMPLE_TIME = 1.9;
const HOLD_AFTER_INPUT = 6000;

export function VentanaLive({ id, reveal, label }: { id: MachineId; reveal: boolean; label: string }) {
  const m = MACHINES[id];
  const v = m.view;
  const art = ART[id];
  const script = React.useMemo(() => scriptOf(id, reveal), [id, reveal]);
  const poses = React.useMemo(() => script.map((step) => poseOf(id, step)), [id, script]);
  const { anchor, say } = useReadout<HTMLDivElement>();
  const root = React.useRef<HTMLDivElement | null>(null);
  const visible = useInView(root);
  const live = React.useRef<HTMLSpanElement | null>(null);

  const columns = React.useRef<ColumnNodes[]>(
    v.xs.map(() => ({ stem: blankSolid(), value: blankSolid(), gain: blankSolid(), cap: null, ringBack: null, ringFront: null, collarBack: null, collarFront: null, key: "" })),
  );
  const plungers = React.useRef<PlungerNodes[]>(Array.from({ length: v.kMax }, () => ({ rod: blankSolid(), pad: null, key: "" })));
  const carNodes = React.useRef<(SVGGElement | null)[]>([]);
  const topeNode = React.useRef<SVGGElement | null>(null);
  const needle = React.useRef<SVGPathElement | null>(null);
  const drag = React.useRef<SVGPathElement | null>(null);
  const heads = React.useRef<Record<number, (SVGGElement | null)[]>>({});
  const blocks = React.useRef<(SVGGElement | null)[]>([]);
  const ticks = React.useRef<(SVGGElement | null)[]>([]);

  // Estado del recorrido (mutable, fuera de React).
  const run = React.useRef({ index: 0, from: poses[0]!, to: poses[0]!, t: 1, span: STEP_TIME, wait: 0, paused: false, heldUntil: 0, shown: -1 });
  const [paused, setPaused] = React.useState(false);

  // Si cambian las paradas (otro reveal), arranca de nuevo en la primera.
  React.useEffect(() => {
    const r = run.current;
    r.index = 0;
    r.from = poses[0]!;
    r.to = poses[0]!;
    r.t = 1;
    r.wait = 0;
    r.shown = -1;
  }, [poses]);

  const draw = React.useCallback(
    (pose: Pose, readStep: number) => {
      const r = run.current;
      const example = v.examples[pose.ex]!;
      const carMove = translateAlong(v.P, [pose.car, 0, 0]);
      for (const node of carNodes.current) node?.setAttribute("transform", carMove);
      topeNode.current?.setAttribute("transform", translateAlong(v.P, [0, 0, pose.ring]));
      needle.current?.setAttribute("d", needleOf(m, pose.needle));
      if (drag.current) {
        show(drag.current, pose.drag !== null);
        if (pose.drag !== null) drag.current.setAttribute("d", dragOf(m, pose.drag));
      }
      for (const [k, nodes] of Object.entries(heads.current)) for (const n of nodes) show(n, Number(k) === pose.k);
      blocks.current.forEach((n, ex) => show(n, pose.result && ex === pose.ex));
      ticks.current.forEach((n, ex) => show(n, ex === pose.ex));

      // Respuesta marcada (ganancia): collar de compra en la cima del día de compra,
      // collar de venta a esa misma altura en el día de venta; lo de encima, encendido.
      const answer = id === "c-ganancia" && pose.result ? answerOf(id, example) : null;
      const level = answer && answer.buy !== null ? v.topOf(example.values[answer.buy]!, v.units[pose.ex]!) : null;
      const ringSlot = clamp(Math.round((pose.car - v.xs[0]!) / v.spec.pitch), 0, v.xs.length - 1);
      const ringOn = reveal && v.spec.tope;
      const engaged = ringOn && Math.abs(pose.car - v.xs[ringSlot]!) < 0.5;

      columns.current.forEach((c, j) => {
        const top = pose.heights[j]!;
        let cut = Infinity;
        if (engaged && j === ringSlot && pose.ring < top) cut = pose.ring;
        if (answer && level !== null && j === answer.sell) cut = level;
        const lit = pose.inside[j]!;
        const key = `${top.toFixed(2)}|${cut === Infinity ? "-" : cut.toFixed(2)}|${lit ? 1 : 0}`;
        if (key !== c.key) {
          c.key = key;
          const empty = top <= EMPTY + 0.05;
          const shape = empty ? null : columnShape(m, j, top, cut);
          paint(c.stem, shape?.stem ?? null, false);
          paint(c.value, shape?.value ?? null, lit);
          paint(c.gain, shape?.gain ?? null, true);
          if (c.cap) {
            c.cap.setAttribute("d", shape?.cap ?? "");
          }
        }
        const ringHere = ringOn && j === ringSlot;
        show(c.ringBack, ringHere);
        show(c.ringFront, ringHere);
        if (ringHere) {
          const move = translateAlong(v.P, [pose.car, 0, pose.ring]);
          c.ringBack?.setAttribute("transform", move);
          c.ringFront?.setAttribute("transform", move);
        }
        const collarHere = answer !== null && level !== null && (j === answer.buy || j === answer.sell);
        show(c.collarBack, collarHere);
        show(c.collarFront, collarHere);
        if (collarHere && level !== null) {
          const move = translateAlong(v.P, [v.xs[j]!, 0, level]);
          c.collarBack?.setAttribute("transform", move);
          c.collarFront?.setAttribute("transform", move);
        }
      });

      const head = m.heads[pose.k]!;
      plungers.current.forEach((p, s) => {
        const tip = pose.tips[s];
        if (tip === undefined || s >= head.offsets.length) {
          paint(p.rod, null, false);
          show(p.pad, false);
          p.key = "";
          return;
        }
        const x = pose.car + head.offsets[s]!;
        const key = `${x.toFixed(2)}|${tip.toFixed(2)}`;
        if (key === p.key) return;
        p.key = key;
        paint(p.rod, rodOf(m, x, tip), false);
        show(p.pad, true);
        p.pad?.setAttribute("transform", translateAlong(v.P, [x, 0, tip]));
      });

      if (readStep !== r.shown) {
        r.shown = readStep;
        const stop = script[readStep]!.stop;
        say(stop.readout);
        const node = root.current;
        if (node && live.current && document.activeElement === node) live.current.textContent = stop.spoken;
      }
    },
    [id, m, reveal, say, script, v],
  );

  const go = React.useCallback(
    (index: number, span?: number) => {
      const r = run.current;
      const n = script.length;
      const next = ((index % n) + n) % n;
      const current = blend(id, r.from, r.to, r.t);
      r.from = current;
      r.to = poses[next]!;
      r.index = next;
      r.t = 0;
      r.span = span ?? (current.ex !== r.to.ex ? EXAMPLE_TIME : reveal ? STEP_TIME : 1.2);
      r.wait = 0;
    },
    [id, poses, reveal, script.length],
  );

  const kick = useLoop((dt, calm) => {
    const r = run.current;
    if (r.t < 1) {
      r.t = calm ? 1 : Math.min(1, r.t + dt / r.span);
    } else if (!r.paused && performance.now() > r.heldUntil && !calm) {
      r.wait += dt;
      if (r.wait >= script[r.index]!.stop.dwell) go(r.index + 1);
    }
    const pose = blend(id, r.from, r.to, r.t);
    draw(pose, r.t >= 0.3 ? r.index : r.shown >= 0 ? r.shown : r.index);
    // Quieto bajo reduce-motion o en pausa, el bucle se detiene hasta la próxima tecla.
    return r.t < 1 || (!r.paused && !calm);
  }, visible);

  // Primer cuadro pintado aunque no corra el bucle (fuera de pantalla, reduce-motion).
  React.useLayoutEffect(() => {
    const r = run.current;
    draw(blend(id, r.from, r.to, r.t), r.index);
  }, [draw, id]);

  const userStep = (delta: number) => {
    const r = run.current;
    r.heldUntil = performance.now() + HOLD_AFTER_INPUT;
    go(r.index + delta);
    kick();
  };

  const nextExample = () => {
    const r = run.current;
    r.heldUntil = performance.now() + HOLD_AFTER_INPUT;
    const ex = script[r.index]!.ex;
    let target = script.findIndex((step) => step.ex === (ex + 1) % v.examples.length);
    if (target < 0) target = 0;
    go(target);
    kick();
  };

  const togglePause = () => {
    const r = run.current;
    r.paused = !r.paused;
    r.wait = 0;
    setPaused(r.paused);
    kick();
  };

  const controls = reveal ? "flechas izquierda y derecha: paso anterior o siguiente" : "flechas izquierda y derecha: otro ejemplo";

  return (
    <div
      ref={(node) => {
        root.current = node;
        anchor.current = node;
      }}
      className="vt"
      role="group"
      tabIndex={0}
      aria-label={`${label} ${controls}; espacio pausa o sigue; clic, siguiente ejemplo.`}
      aria-roledescription="máquina interactiva"
      data-paused={paused ? "" : undefined}
      onClick={nextExample}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
          event.preventDefault();
          event.stopPropagation();
          userStep(event.key === "ArrowRight" ? 1 : -1);
        } else if (event.key === " " || event.code === "Space") {
          event.preventDefault();
          event.stopPropagation();
          if (!event.repeat) togglePause();
        }
      }}
      onFocus={() => {
        const r = run.current;
        if (live.current) live.current.textContent = script[r.index]!.stop.spoken;
      }}
    >
      <span ref={live} className="vt-live" aria-live="polite" />
      <IsoFigure width={WIDTH} height={HEIGHT} label={label}>
        {art.bench}
        <g>{art.blocks.map((block, ex) => <g key={ex} ref={(n) => void (blocks.current[ex] = n)} style={{ display: "none" }}>{block}</g>)}</g>
        {art.railBack}
        <g ref={(n) => void (carNodes.current[0] = n)}>{art.skirtBack}</g>
        {art.rail}
        <g ref={(n) => void (carNodes.current[1] = n)}>
          {art.car}
          {reveal ? null : art.lock}
          {reveal && v.spec.tope ? (
            <g ref={topeNode} className="vt-tope">
              {art.topeBody}
            </g>
          ) : null}
          {art.dial}
          <path ref={drag} className="vt-drag" style={{ display: "none" }} />
          <path ref={needle} className="iso-line vt-needle" data-tone="lit" />
          <circle className="vt-hub" cx={v.at([0, v.dialY, v.towerTop + 5.3])[0]} cy={v.at([0, v.dialY, v.towerTop + 5.3])[1]} r={0.9} />
        </g>
        {v.xs.map((_, j) => {
          const c = columns.current[j]!;
          return (
            <g key={j}>
              {art.sockets[j]}
              <g ref={(n) => void (c.ringBack = n)} style={{ display: "none" }}>
                {art.ringBack}
              </g>
              <g ref={(n) => void (c.collarBack = n)} className="vt-tag" style={{ display: "none" }}>
                {art.collarBack}
              </g>
              <g className="vt-col">
                <LiveSolid nodes={c.stem} tone="mid" />
                <LiveSolid nodes={c.value} tone="mid" />
                <LiveSolid nodes={c.gain} tone="hi" crease="lo" className="vt-gain" />
                <path ref={(n) => void (c.cap = n)} className="iso-line" data-tone="faint" />
              </g>
              <g ref={(n) => void (c.collarFront = n)} className="vt-tag" style={{ display: "none" }}>
                {art.collarFront}
              </g>
              <g ref={(n) => void (c.ringFront = n)} style={{ display: "none" }}>
                {art.ringFront}
              </g>
            </g>
          );
        })}
        <g ref={(n) => void (carNodes.current[2] = n)}>
          {Object.entries(art.heads).map(([k, h]) => (
            <g
              key={k}
              ref={(n) => {
                (heads.current[Number(k)] ??= [])[0] = n;
              }}
            >
              {h.back}
            </g>
          ))}
        </g>
        {plungers.current.map((p, s) => (
          <g key={s}>
            <LiveSolid nodes={p.rod} tone="mid" />
            <g ref={(n) => void (p.pad = n)} style={{ display: "none" }}>
              {art.pad}
            </g>
          </g>
        ))}
        <g ref={(n) => void (carNodes.current[3] = n)}>
          {Object.entries(art.heads).map(([k, h]) => (
            <g
              key={k}
              ref={(n) => {
                (heads.current[Number(k)] ??= [])[1] = n;
              }}
            >
              {h.front}
            </g>
          ))}
        </g>
        {art.scale}
        <g>{art.scaleTicks.map((t, ex) => <g key={ex} ref={(n) => void (ticks.current[ex] = n)} style={{ display: "none" }}>{t}</g>)}</g>
      </IsoFigure>
    </div>
  );
}
