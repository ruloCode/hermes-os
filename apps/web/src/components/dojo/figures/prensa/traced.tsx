"use client";

// La prensa en vivo: se mueve con lo que hizo EL CÓDIGO DEL ALUMNO, paso a paso.
// Cada valor y cada posición sale de la traza (trace.ts); aquí solo se anima el
// paso de un estado al siguiente:
//
//   paso 0       las fichas de los parámetros caen al cargador
//   línea        si cambió una variable (o imprimió), el empujador lleva las
//                fichas bajo el troquel y el ariete golpea; la variable de
//                trabajo queda apilada encima
//   return       con valor: la ficha de salida va a la bandeja (encendida si
//                es el pedido, con borde rojo si no); con None: la bandeja
//                queda vacía y, si imprimió, el visor de print se enciende
//   excepción    el troquel se traba (borde rojo) y no sale nada
//
// La geometría fija es la del guion (art.tsx); por cuadro solo se escriben
// transformaciones y los pocos sólidos que cambian de forma (frame.ts). El
// texto de las fichas cambia en el golpe: un re-render por paso, no por cuadro.

import * as React from "react";
import { FaceText, IsoFigure, Line, Plate, Solid } from "../../iso/react/draw";
import { asksForStillness } from "../../iso/react/live";
import type { LiveFrame } from "../types";
import * as ART from "./art";
import { machineAt, outZAt } from "./frame";
import { BASE_ART, HEAD_FRONT, RAM_ART, SCREEN, SIGHT_RUN, VISOR_ART, tileOf } from "./geometry";
import { RefSolid, fitText, writeSolid } from "./parts";
import { planOf, tileTextOfRepr, type StepState } from "./trace";
import {
  DIE_X,
  DROP_FROM,
  HEIGHT,
  MAG_X,
  PUNCH_REST,
  PUSHER_HOME,
  RAIL_TOP,
  TILE_H,
  TRAY_FLOOR,
  TRAY_X,
  WIDTH,
  lanesFor,
  shift,
} from "./view";

// Tiempos de un paso (s). La reproducción del Dojo va de 70 a 450 ms por paso:
// si llega el siguiente antes de terminar, se parte desde el final de éste.
const DROP = 0.32;
const PUSH = 0.28;
const DOWN = 0.12;
const UP = 0.18;
const EJECT = 0.42;
const FLASH = 0.22;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (v: number) => {
  const u = clamp01(v);
  return u * u * (3 - 2 * u);
};
const span = (t: number, a: number, b: number) => (b <= a ? (t >= b ? 1 : 0) : clamp01((t - a) / (b - a)));
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;

/**
 * Alto de la pila bajo el troquel: las fichas de entrada abajo y, si ya hay
 * variables de trabajo, un piso encima con una ficha por variable (cada una en
 * su carril fijo, para que ninguna tape a otra ni cambie de sitio).
 */
const stackTop = (levels: number) => RAIL_TOP + TILE_H * (1 + levels);

interface Nodes {
  inputs: (SVGGElement | null)[];
  work: (SVGGElement | null)[];
  output: SVGGElement | null;
  outSolid: SVGGElement | null;
  pusher: SVGGElement | null;
  pushRod: SVGGElement | null;
  ram: SVGGElement | null;
  pointer: SVGPathElement | null;
  punch: SVGGElement | null;
  rod: SVGGElement | null;
  rodCap: SVGGElement | null;
  spokes: SVGPathElement | null;
  knob: SVGGElement | null;
  screen: SVGTextElement | null;
  glass: SVGRectElement | null;
}

/** El plan de la transición al paso k: cuándo empuja, cuándo golpea, cuándo sale. */
function timingOf(prev: StepState | undefined, cur: StepState) {
  const push = prev?.place === "magazine" && cur.place !== "magazine" ? PUSH : 0;
  const impact = cur.strike ? push + DOWN : push;
  const end = cur.place === "out" ? impact + UP + EJECT : cur.strike ? impact + UP : push;
  return { push, impact, end };
}

export function PrensaTraced({ frame }: { frame: LiveFrame }) {
  const plan = React.useMemo(() => planOf(frame), [frame.trace, frame.fn, frame.expected]); // eslint-disable-line react-hooks/exhaustive-deps
  const step = Math.min(frame.step, plan.states.length - 1);
  const lanes = React.useMemo(() => lanesFor(plan.params.length), [plan.params.length]);
  // Lo que muestran las fichas: el estado del paso cuyo golpe ya ocurrió.
  const [shown, setShown] = React.useState(step);
  const S = plan.states[shown]!;
  const target = plan.states[step]!;
  const nodes = React.useRef<Nodes>({
    inputs: [],
    work: [],
    output: null,
    outSolid: null,
    pusher: null,
    pushRod: null,
    ram: null,
    pointer: null,
    punch: null,
    rod: null,
    rodCap: null,
    spokes: null,
    knob: null,
    screen: null,
    glass: null,
  });
  const last = React.useRef<number | null>(null);
  // Redibuja tras cada render: las fichas que cambian de texto se montan de
  // nuevo (otro ancho) y nacen sin posición hasta el siguiente cuadro.
  const redraw = React.useRef<(() => void) | null>(null);
  React.useLayoutEffect(() => {
    redraw.current?.();
  });
  const rest = React.useMemo(() => machineAt(restPose(lanes)), [lanes]);

  const inTiles = plan.params.map((p) => tileOf(S.values[p] ?? ""));
  const widest = Math.max(16, ...plan.params.map((p) => tileOf(plan.states[0]!.values[p] ?? "").w));
  const outTile = tileOf(target.out?.text ?? "");
  const ticketText = frame.expected === undefined ? null : tileTextOfRepr(frame.expected);
  const ticket = ticketText === null ? null : tileOf(ticketText);

  // Un paso: anima desde el final del anterior. Saltos hacia atrás o de más de
  // un paso (el alumno movió el deslizador) se pintan quietos en su final.
  React.useEffect(() => {
    const from = last.current;
    last.current = step;
    const cur = plan.states[step]!;
    const prev = step > 0 ? plan.states[step - 1] : undefined;
    const animate = !asksForStillness() && ((from === null && step === 0) || from === step - 1);
    const fromStart = from === null && step === 0;
    const timing = timingOf(prev, cur);
    const before = prev ?? cur;
    const depth = (n: number) => PUNCH_REST - stackTop(n);
    const strikeDepth = depth(before.work.length || cur.work.length ? 1 : 0);
    const workLanes = lanesFor(plan.workAll.length);
    const outW = tileOf(cur.out?.text ?? "").w;

    const draw = (t: number) => {
      const n = nodes.current;
      const hit = t >= timing.impact;
      const state = hit ? cur : before;
      // Fichas de entrada.
      const placeFrom = before.place;
      let x = placeFrom === "magazine" ? MAG_X : DIE_X;
      if (timing.push) x = lerp(MAG_X, DIE_X, smooth(t / timing.push));
      if (cur.place === "magazine") x = MAG_X;
      const drop = fromStart ? span(t, 0, DROP) ** 2 : 1;
      const z = lerp(DROP_FROM, RAIL_TOP, drop);
      const gone = hit && cur.place === "out";
      const inAlpha = gone ? 0 : fromStart ? smooth(t / 0.12) : 1;
      // Empujador: apoya en la ficha mientras empuja y vuelve a casa.
      const contact = x - widest / 2;
      const front = timing.push
        ? t < timing.push
          ? lerp(PUSHER_HOME, contact, smooth(t / 0.08))
          : lerp(DIE_X - widest / 2, PUSHER_HOME, smooth((t - timing.push) / 0.3))
        : PUSHER_HOME;
      // Ariete.
      let travel = 0;
      if (cur.strike) {
        const ts = timing.impact - DOWN;
        travel = t < timing.impact ? span(t, ts, timing.impact) ** 2 : 1 - smooth((t - timing.impact) / UP);
      }
      // Salida.
      const e = cur.place === "out" ? smooth((t - timing.impact - UP * 0.6) / EJECT) : 0;
      const outX = lerp(DIE_X, TRAY_X, e);
      const m = machineAt({
        tileX: x,
        tileZ: z,
        lanes,
        pusherFront: Math.min(front, PUSHER_HOME + 200),
        down: travel * strikeDepth,
        travel,
        outX,
        outZ: outZAt(outX, outW),
        sightRun: SIGHT_RUN,
      });
      m.inputs.forEach((tr, i) => {
        const g = n.inputs[i];
        if (!g) return;
        g.setAttribute("transform", tr);
        g.style.opacity = `${inAlpha}`;
      });
      n.work.forEach((g, j) => {
        if (!g) return;
        const name = plan.workAll[j];
        const present = !!name && state.work.includes(name) && !gone;
        g.style.opacity = present ? "1" : "0";
        g.setAttribute("transform", shift([DIE_X, workLanes[j] ?? 0, stackTop(0)]));
      });
      n.pusher?.setAttribute("transform", m.pusher);
      writeSolid(n.pushRod, m.pushRod);
      n.ram?.setAttribute("transform", m.ram);
      n.pointer?.setAttribute("transform", m.pointer);
      writeSolid(n.rod, m.rod);
      writeSolid(n.rodCap, m.rodCap);
      n.spokes?.setAttribute("d", m.spokes);
      writeSolid(n.knob, m.knob);
      if (n.punch) {
        const edge = n.punch.querySelector(".iso-edge");
        if (hit && cur.strike && t - timing.impact < FLASH) n.punch.dataset.lit = "";
        else delete n.punch.dataset.lit;
        edge?.setAttribute("data-tone", hit && cur.jam ? "red" : "hi");
      }
      if (n.output) {
        n.output.setAttribute("transform", m.output);
        n.output.style.opacity = hit && cur.out ? "1" : "0";
      }
      if (n.outSolid) {
        const landed = e >= 1;
        const edge = n.outSolid.querySelector(".iso-edge");
        if (landed && cur.out?.verdict !== "bad") n.outSolid.dataset.lit = "";
        else delete n.outSolid.dataset.lit;
        edge?.setAttribute("data-tone", landed && cur.out?.verdict === "bad" ? "red" : "hi");
      }
      if (n.screen && n.glass) {
        const on = state.printed !== "";
        n.screen.style.opacity = on ? "1" : "0";
        n.glass.style.opacity = on ? "1" : "0.35";
      }
    };

    let now = 0;
    redraw.current = () => draw(now);
    if (!animate) {
      now = timing.end + 1;
      setShown(step);
      draw(now);
      return;
    }
    if (timing.impact === 0) setShown(step);
    let raf = 0;
    let t0 = 0;
    let swapped = timing.impact === 0;
    const tick = (stamp: number) => {
      if (!t0) t0 = stamp;
      const t = (stamp - t0) / 1000;
      now = t;
      if (!swapped && t >= timing.impact) {
        swapped = true;
        setShown(step);
      }
      draw(t);
      const total = Math.max(timing.end, fromStart ? DROP : 0) + FLASH;
      raf = t < total ? requestAnimationFrame(tick) : 0;
    };
    draw(0);
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      // Si llega otro paso antes de terminar, éste queda en su final.
      if (!swapped) setShown(step);
    };
  }, [step, plan, lanes, widest]);

  const bind =
    <K extends keyof Nodes>(key: K) =>
    (node: Nodes[K]) => {
      nodes.current[key] = node;
    };

  const fn = frame.fn ?? "";
  const plateSize = fitText(fn, 46, 4.2);
  const printed = S.printed.length > 9 ? `${S.printed.slice(0, 8)}…` : S.printed;
  const screenSize = Math.max(2.6, fitText(printed, SCREEN.w - 1.6, 6));
  const label = `Prensa en vivo con tu código de ${fn}: ${target.readout}.`;

  return (
    <div className="prensa-wrap">
      <Plate
        fig="Fig 1"
        title={`${fn}: tu código`}
        hint="paso a paso"
        readout={S.readout}
        keys={[
          { mark: "raised", label: plan.params.length > 1 ? "Entran tus parámetros" : "Entra tu parámetro" },
          ...(plan.workAll.length ? [{ mark: "flat" as const, label: "Lo que armas dentro (encima)" }] : []),
          { mark: "lit", label: "Lo que devuelves" },
          ...(ticket ? [{ mark: "dotted" as const, label: "El pedido del ejemplo" }] : []),
          ...(plan.prints ? [{ mark: "dim" as const, label: "El visor: lo que imprime print" }] : []),
        ]}
        caption="Tu código corriendo en la prensa: los parámetros caen por el cargador, cada línea que cambia una variable es un golpe del troquel y solo lo que devuelves con return llega a la bandeja."
      >
        <div className="prensa prensa-traced" role="img" aria-label={label}>
          <IsoFigure width={WIDTH} height={HEIGHT} label={label}>
            {ART.BASE}
            <FaceText transform={BASE_ART.plateText} size={plateSize} tone="mid" anchor="middle">
              {fn}
            </FaceText>
            {ART.CYLINDER}
            <RefSolid paths={rest.pushRod} gref={bind("pushRod")} crease="none" />
            {ART.RAIL_BACK}
            {ART.MAG_BACK}
            <g ref={bind("pusher")} transform={shift([PUSHER_HOME, 0, 0])}>
              {ART.PUSHER}
            </g>
            {ART.PRESS_BACK}
            {ART.CHUTE_BACK}
            {ART.TRAY_BACK}
            {ticket ? (
              <g key={`ticket-${ticketText}`} transform={shift([TRAY_X, 0, TRAY_FLOOR])}>
                <Line d={ticket.footprint} tone="mid" dotted />
                <FaceText transform={ticket.floorLabel} size={ticket.size} tone="faint" anchor="middle">
                  {ticketText}
                </FaceText>
              </g>
            ) : null}
            {inTiles.map((tile, i) => (
              <g
                key={`in-${i}-${S.values[plan.params[i]!]}`}
                ref={(node) => {
                  nodes.current.inputs[i] = node;
                }}
                style={{ opacity: 0 }}
              >
                <Solid paths={tile.body} tone="hi" crease="lo" />
                <Line d={tile.rim} tone="faint" />
                <FaceText transform={tile.label} size={tile.size} tone="hi" anchor="middle">
                  {S.values[plan.params[i]!]}
                </FaceText>
              </g>
            ))}
            {plan.workAll.map((name, j) => {
              const text = S.values[name] ?? "";
              const tile = tileOf(text);
              return (
                <g
                  key={`work-${name}-${text}`}
                  ref={(node) => {
                    nodes.current.work[j] = node;
                  }}
                  style={{ opacity: 0 }}
                >
                  <Solid paths={tile.body} tone="hi" crease="lo" />
                  <Line d={tile.rim} tone="faint" />
                  <FaceText transform={tile.label} size={tile.size} tone="hi" anchor="middle">
                    {text}
                  </FaceText>
                </g>
              );
            })}
            <g key={`out-${target.out?.text ?? ""}`} ref={bind("output")} style={{ opacity: 0 }}>
              <RefSolid paths={outTile.body} tone="hi" crease="lo" gref={bind("outSolid")} />
              <Line d={outTile.rim} tone="faint" />
              <FaceText transform={outTile.label} size={outTile.size} tone="hi" anchor="middle">
                {target.out?.text ?? ""}
              </FaceText>
            </g>
            {ART.FRONT_GUIDES}
            {ART.MAG_FRONT}
            <g ref={bind("ram")}>
              {ART.RAM_BODY}
              <RefSolid paths={RAM_ART.punch} tone="hi" gref={bind("punch")} inner={<Line d={RAM_ART.punchLine} tone="faint" />} />
            </g>
            {ART.HEAD}
            <path ref={bind("pointer")} className="iso-line prensa-pointer" data-tone="lit" d={HEAD_FRONT.pointer} />
            <RefSolid paths={rest.rod} gref={bind("rod")} crease="none" />
            <RefSolid paths={rest.rodCap} gref={bind("rodCap")} />
            {plan.prints ? (
              <g key="visor">
                {ART.VISOR_BOX}
                <g transform={VISOR_ART.face}>
                  <rect ref={bind("glass")} className="prensa-glass" x={SCREEN.x} y={SCREEN.y} width={SCREEN.w} height={SCREEN.h} rx={0.8} />
                  <rect className="iso-line" data-tone="lo" x={SCREEN.x} y={SCREEN.y} width={SCREEN.w} height={SCREEN.h} rx={0.8} />
                  <text
                    ref={bind("screen")}
                    className="iso-face-text prensa-screen"
                    x={SCREEN.x + SCREEN.w / 2}
                    y={SCREEN.y + SCREEN.h / 2 + screenSize * 0.36}
                    fontSize={screenSize}
                    textAnchor="middle"
                    style={{ opacity: 0 }}
                  >
                    {printed}
                  </text>
                </g>
              </g>
            ) : null}
            {ART.WHEEL_BACK}
            <path ref={bind("spokes")} className="iso-line" data-tone="mid" d={rest.spokes} />
            {ART.WHEEL_HUB}
            <RefSolid paths={rest.knob} gref={bind("knob")} />
            {ART.TRAY_FRONT}
          </IsoFigure>
        </div>
      </Plate>
    </div>
  );
}

/** La prensa quieta (para el primer render, antes de que el efecto la ponga en su paso). */
const restCache = new Map<number, Parameters<typeof machineAt>[0]>();
function restPose(lanes: number[]) {
  const hit = restCache.get(lanes.length);
  if (hit) return hit;
  const pose = { tileX: MAG_X, tileZ: RAIL_TOP, lanes, pusherFront: PUSHER_HOME, down: 0, travel: 0, outX: DIE_X, outZ: RAIL_TOP, sightRun: SIGHT_RUN };
  restCache.set(lanes.length, pose);
  return pose;
}
