"use client";

// La prensa viva: un solo loop que lee la fase del modelo y escribe atributos
// por refs (nada de re-render por cuadro). Cambiar de ejemplo sí re-renderiza:
// cambia el texto y el ancho de las fichas.
//
// Juego: sola recorre los ejemplos en bucle; con foco, ← → cambian de ejemplo y
// Espacio pausa o sigue (solo esas teclas se detienen aquí: el Dojo usa ↑ ↓ j k
// Enter Esc a nivel de ventana); un clic en la máquina = siguiente ejemplo.

import * as React from "react";
import { FaceText, IsoFigure, Line, Solid } from "../../iso/react/draw";
import { asksForStillness, useInView, useReadout } from "../../iso/react/live";
import { BASE_ART, HEAD_FRONT, RAM_ART, SCREEN, SIGHT_RUN, VISOR_ART, tileOf } from "./geometry";
import { frameOf } from "./frame";
import { RefSolid, fitText, writeSolid } from "./parts";
import { CYCLE, RESTING, T, phaseAt, py, readoutOf, spokenOf, tileText, type Lesson } from "./model";
import { HEIGHT, PUNCH, TRAY_FLOOR, TRAY_X, WIDTH, lanesFor, shift } from "./view";
import * as ART from "./art";

const GUARD_LIFT = 34;
const HOLD_MS = 3200;

interface Nodes {
  inputs: (SVGGElement | null)[];
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
  guard: SVGGElement | null;
  screen: SVGTextElement | null;
  glass: SVGRectElement | null;
}

export function PrensaLive({ lesson, reveal, label }: { lesson: Lesson; reveal: boolean; label: string }) {
  const { anchor, say } = useReadout<HTMLDivElement>();
  const root = React.useRef<HTMLDivElement | null>(null);
  const inView = useInView(root);
  const [index, setIndex] = React.useState(0);
  const [paused, setPaused] = React.useState(false);
  const nodes = React.useRef<Nodes>({
    inputs: [],
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
    guard: null,
    screen: null,
    glass: null,
  });
  const clock = React.useRef({ t: 0, hold: 0, guard: reveal ? 1 : 0, still: false });

  const count = lesson.examples.length;
  const ex = lesson.examples[index % count]!;
  const laneCount = ex.args.length;
  const lanes = React.useMemo(() => lanesFor(laneCount), [laneCount]);
  const inTiles = ex.args.map((a) => tileOf(tileText(a)));
  const widest = Math.max(...inTiles.map((tile) => tile.w));
  const outText = tileText(ex.out);
  const outTile = tileOf(outText);
  const rest = React.useMemo(() => frameOf(phaseAt(RESTING), lanes, widest, outTile.w, SIGHT_RUN), [lanes, widest, outTile.w]);

  const draw = React.useCallback(() => {
    const n = nodes.current;
    const c = clock.current;
    const t = c.still ? RESTING : c.t;
    const phase = phaseAt(t);
    const f = frameOf(phase, lanes, widest, outTile.w, SIGHT_RUN);
    f.inputs.forEach((tr, i) => {
      const g = n.inputs[i];
      if (!g) return;
      g.setAttribute("transform", tr);
      g.style.opacity = phase.struck ? "0" : `${phase.inAlpha}`;
    });
    n.pusher?.setAttribute("transform", f.pusher);
    writeSolid(n.pushRod, f.pushRod);
    n.ram?.setAttribute("transform", f.ram);
    n.pointer?.setAttribute("transform", f.pointer);
    writeSolid(n.rod, f.rod);
    writeSolid(n.rodCap, f.rodCap);
    n.spokes?.setAttribute("d", f.spokes);
    writeSolid(n.knob, f.knob);
    if (n.punch) {
      if (reveal && phase.flash > 0.25) n.punch.dataset.lit = "";
      else delete n.punch.dataset.lit;
    }
    if (n.output) {
      const shown = ex.out !== null && phase.struck;
      n.output.setAttribute("transform", f.output);
      n.output.style.opacity = shown ? `${phase.outAlpha}` : "0";
    }
    if (n.outSolid) {
      if (phase.landed) n.outSolid.dataset.lit = "";
      else delete n.outSolid.dataset.lit;
    }
    if (n.screen && n.glass) {
      const on = ex.printed !== null && phase.struck;
      const alpha = on ? phase.outAlpha : 0;
      n.screen.style.opacity = `${alpha}`;
      n.glass.style.opacity = `${0.35 + 0.65 * alpha}`;
    }
    if (n.guard) {
      const g = c.guard;
      n.guard.setAttribute("transform", shift([0, 0, GUARD_LIFT * g]));
      n.guard.style.opacity = `${1 - g}`;
      n.guard.style.display = g >= 0.999 ? "none" : "";
    }
    say(readoutOf(ex, index % count, count, phase) + (paused && !c.still ? " · pausa" : ""));
  }, [ex, index, count, lanes, widest, outTile.w, reveal, paused, say]);

  const drawRef = React.useRef(draw);
  drawRef.current = draw;

  // Un solo loop: corre mientras se ve, no está en pausa y hay movimiento.
  React.useEffect(() => {
    const c = clock.current;
    c.still = asksForStillness();
    let frame = 0;
    let last = 0;
    const tick = (now: number) => {
      const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
      last = now;
      const goal = reveal ? 1 : 0;
      c.guard = c.still ? goal : c.guard + (goal - c.guard) * (1 - Math.exp(-dt / 0.28));
      if (Math.abs(goal - c.guard) < 1e-3) c.guard = goal;
      if (!paused && !c.still) {
        const limit = performance.now() < c.hold ? T.fadeFrom : Infinity;
        c.t = Math.min(c.t + dt, limit);
        if (c.t >= CYCLE) {
          c.t = 0;
          draw();
          setIndex((i) => (i + 1) % count);
          frame = 0;
          return;
        }
      }
      draw();
      const moving = (!paused && !c.still) || c.guard !== goal;
      frame = moving ? requestAnimationFrame(tick) : 0;
    };
    draw();
    if (inView) frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [inView, paused, draw, reveal, count]);

  // QA sin cronómetro: window.__hermesPrensa.at(t, ejemplo) congela todas las
  // prensas de la página en ese instante del ciclo (lo usan las capturas).
  React.useEffect(() => {
    const w = window as unknown as { __hermesPrensa?: { list: Set<(t: number, i?: number) => void>; at: (t: number, i?: number) => void } };
    const qa = (w.__hermesPrensa ??= {
      list: new Set(),
      at(t, i) {
        this.list.forEach((fn) => fn(t, i));
      },
    });
    const fn = (t: number, i?: number) => {
      clock.current.t = t;
      clock.current.still = false;
      setPaused(true);
      if (i !== undefined) setIndex(i % count);
      requestAnimationFrame(() => drawRef.current());
    };
    qa.list.add(fn);
    return () => {
      qa.list.delete(fn);
    };
  }, [count]);

  const pausedRef = React.useRef(paused);
  pausedRef.current = paused;

  const jump = React.useCallback(
    (by: number) => {
      const c = clock.current;
      // En pausa se salta al final del ejemplo (la ficha ya en la bandeja):
      // congelado al principio no se vería nada.
      c.t = pausedRef.current ? RESTING : 0;
      c.hold = performance.now() + CYCLE * 1000 + HOLD_MS;
      setIndex((i) => (i + by + count) % count);
    },
    [count],
  );

  const bind =
    <K extends keyof Nodes>(key: K) =>
    (node: Nodes[K]) => {
      nodes.current[key] = node;
    };

  const dieText = reveal ? ex.die : "";
  const dieSize = fitText(dieText, PUNCH.w - 9, 6.5);
  const plateSize = fitText(ex.fn, 46, 4.2);

  return (
    <div
      ref={(node) => {
        root.current = node;
        anchor.current = node;
      }}
      className="prensa"
      role="slider"
      tabIndex={0}
      aria-label={`Prensa de ${lesson.fn}: ← y → cambian de ejemplo, Espacio pausa`}
      aria-valuemin={1}
      aria-valuemax={count}
      aria-valuenow={(index % count) + 1}
      aria-valuetext={spokenOf(ex, index % count, count)}
      onClick={() => jump(1)}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
          event.preventDefault();
          event.stopPropagation();
          jump(event.key === "ArrowRight" ? 1 : -1);
        } else if (event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          if (!event.repeat) setPaused((p) => !p);
        }
      }}
    >
      <IsoFigure width={WIDTH} height={HEIGHT} label={label}>
        {ART.BASE}
        <FaceText transform={BASE_ART.plateText} size={plateSize} tone="mid" anchor="middle">
          {ex.fn}
        </FaceText>
        {ART.CYLINDER}
        <RefSolid paths={rest.pushRod} gref={bind("pushRod")} crease="none" />
        {ART.RAIL_BACK}
        {ART.MAG_BACK}
        <g ref={bind("pusher")} transform={rest.pusher}>
          {ART.PUSHER}
        </g>
        {ART.PRESS_BACK}
        {ART.CHUTE_BACK}
        {ART.TRAY_BACK}
        <g key={`ticket-${index}`} transform={shift([TRAY_X, 0, TRAY_FLOOR])}>
          <Line d={outTile.footprint} tone="mid" dotted />
          <FaceText transform={outTile.floorLabel} size={outTile.size} tone="faint" anchor="middle">
            {outText}
          </FaceText>
        </g>
        {inTiles.map((tile, i) => (
          <g
            key={`in-${index}-${i}`}
            ref={(node) => {
              nodes.current.inputs[i] = node;
            }}
            transform={rest.inputs[i]}
            style={{ opacity: 0 }}
          >
            <Solid paths={tile.body} tone="hi" crease="lo" />
            <Line d={tile.rim} tone="faint" />
            <FaceText transform={tile.label} size={tile.size} tone="hi" anchor="middle">
              {tileText(ex.args[i]!)}
            </FaceText>
          </g>
        ))}
        <g key={`out-${index}`} ref={bind("output")} transform={rest.output} style={{ opacity: 0 }}>
          <RefSolid paths={outTile.body} tone="hi" crease="lo" gref={bind("outSolid")} />
          <Line d={outTile.rim} tone="faint" />
          <FaceText transform={outTile.label} size={outTile.size} tone="hi" anchor="middle">
            {outText}
          </FaceText>
        </g>
        {ART.FRONT_GUIDES}
        {ART.MAG_FRONT}
        <g ref={bind("ram")} transform={rest.ram}>
          {ART.RAM_BODY}
          <RefSolid paths={RAM_ART.punch} tone="hi" gref={bind("punch")} inner={<Line d={RAM_ART.punchLine} tone="faint" />} />
          <FaceText transform={RAM_ART.face} size={dieSize} tone="hi" anchor="middle">
            <tspan x={PUNCH.w / 2} y={6.1}>
              {dieText}
            </tspan>
          </FaceText>
        </g>
        {ART.HEAD}
        <path ref={bind("pointer")} className="iso-line prensa-pointer" data-tone="lit" d={HEAD_FRONT.pointer} transform={rest.pointer} />
        <RefSolid paths={rest.rod} gref={bind("rod")} crease="none" />
        <RefSolid paths={rest.rodCap} gref={bind("rodCap")} />
        {lesson.visor ? (
          <g key="visor">
            {ART.VISOR_BOX}
            <g transform={VISOR_ART.face}>
              <rect ref={bind("glass")} className="prensa-glass" x={SCREEN.x} y={SCREEN.y} width={SCREEN.w} height={SCREEN.h} rx={0.8} />
              <rect className="iso-line" data-tone="lo" x={SCREEN.x} y={SCREEN.y} width={SCREEN.w} height={SCREEN.h} rx={0.8} />
              <text
                ref={bind("screen")}
                className="iso-face-text prensa-screen"
                x={SCREEN.x + SCREEN.w / 2}
                y={SCREEN.y + SCREEN.h / 2 + 2.2}
                fontSize={6}
                textAnchor="middle"
                style={{ opacity: 0 }}
              >
                {ex.printed === null ? "" : py(ex.printed)}
              </text>
            </g>
          </g>
        ) : null}
        <g ref={bind("guard")} style={{ display: clock.current.guard >= 0.999 ? "none" : undefined }}>
          {ART.GUARD}
        </g>
        {ART.WHEEL_BACK}
        <path ref={bind("spokes")} className="iso-line" data-tone="mid" d={rest.spokes} />
        {ART.WHEEL_HUB}
        <RefSolid paths={rest.knob} gref={bind("knob")} />
        {ART.TRAY_FRONT}
      </IsoFigure>
    </div>
  );
}
