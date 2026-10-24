"use client";

// La parte viva de los casilleros: un solo bucle que lee el paso actual del
// modelo y mueve carro, paleta, aguja y carga escribiendo atributos por ref. React
// solo vuelve a pintar cuando cambia de paso (el contenido de los casilleros).

import * as React from "react";
import { asksForStillness, useInView, useReadout } from "../../iso/react/live";
import { Dots, FaceText, IsoFigure, Line, Solid } from "../../iso/react/draw";
import { translateAlong, type SolidPaths } from "../../iso/iso-kit";
import {
  BASE,
  CABINET_BACK,
  CABINET_FRONT,
  CARRIAGE,
  DIAL_HUB,
  LOCK,
  ORDER_RAIL,
  PADDLE,
  POSTS,
  RAIL,
  SHELVES,
  STATION,
  TICKETS,
  dividerOf,
  shutterOf,
} from "./art";
import {
  HOLDERS,
  ORDER_ART,
  PADDLE_ART,
  QUEUE_CARDS,
  cardAt,
  chipAt,
  chipSeam,
  chipTray,
  needleAt,
  payCard,
  payChip,
  payChipSeam,
  rack,
  stemAt,
} from "./geometry";
import { COLUMNS, SLOTS, restIndexOf, type Step, type Table, type Variant } from "./model";
import {
  CARD_T,
  CHIP_H,
  CHIP_X,
  CHIP_Y,
  DOCK_DY,
  DOCK_X,
  DOCK_Z,
  HEIGHT,
  P,
  PAY_CARD_Y,
  PAY_CHIP_Y,
  RACK_RISE,
  RACK_STEP_D,
  TICKETS as TICKET_SPECS,
  TRAY_H,
  WIDTH,
  fitTicket,
  cardFace,
  cardLift,
  cellOf,
} from "./view";
import "./casilleros.css";

// ── Tiempos de un paso (segundos) ────────────────────────────────────────
const HOME = [0, 0.55] as const;
const SPIN = [0.25, 0.9] as const;
const EJECT = [0.55, 0.85] as const;
const TRAVEL = [0.9, 1.65] as const;
const PUSH = [1.65, 2.1] as const;
const AFTER = [2.1, 2.4] as const;
const LIFT = [2.25, 2.85] as const;
const SLOT_T = 2.9;
/** Después de dejar la carga el brazo sube por encima de la corona: deja ver la placa. */
const PARK_Z = 113;
const SHOW_T = 1.3;
const HOLD = 0.9;
const FIRST = 0.8;
const MANUAL_BACK = 5;
const TURN = Math.PI * 2;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const ease = (t: number) => {
  const u = clamp01(t);
  return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
};
const span = (t: number, [a, b]: readonly [number, number]) => ease((t - a) / (b - a));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const durationOf = (step: Step) => (step.slot === null ? SHOW_T : SLOT_T);

/** El readout antes de llegar: la cabeza de la expresión y puntos suspensivos. */
function headOf(text: string) {
  const cuts = [" → ", " = ", " ← ", " · "].map((sep) => text.indexOf(sep)).filter((i) => i > 0);
  return cuts.length ? `${text.slice(0, Math.min(...cuts))} …` : text;
}

type Mode = "chips" | "cards" | "set";
interface CaseLook {
  mode: Mode;
  pairs: boolean;
}

/** Cómo se ve el interior de los casilleros en cada caso (entre dos «reset»): fichas, tarjetas o nada. */
function looksOf(variant: Variant): CaseLook[] {
  const out: CaseLook[] = [];
  let start = 0;
  for (let i = 0; i <= variant.steps.length; i++) {
    if (i < variant.steps.length && (i === 0 || variant.steps[i]!.kind !== "reset")) continue;
    let mode: Mode = "set";
    let pairs = false;
    for (const step of variant.steps.slice(start, i)) {
      if (step.payload.kind === "chip") {
        mode = "chips";
        if (step.payload.side === 1) pairs = true;
      }
      if (step.payload.kind === "card") mode = "cards";
    }
    for (let k = start; k < i; k++) out[k] = { mode, pairs };
    start = i;
  }
  return out;
}

// ── Un sólido que cambia de forma cada cuadro (el vástago) ───────────────

interface SolidNodes {
  fill: SVGPathElement | null;
  shades: (SVGPathElement | null)[];
  top: SVGPathElement | null;
  outline: SVGPathElement | null;
}

function writeSolid(nodes: SolidNodes, paths: SolidPaths) {
  nodes.fill?.setAttribute("d", paths.fill);
  paths.shades.forEach((d, i) => nodes.shades[i]?.setAttribute("d", d ?? ""));
  nodes.top?.setAttribute("d", paths.top);
  nodes.outline?.setAttribute("d", paths.outline);
}

// ── Contenido de un casillero según la tabla ─────────────────────────────

function Cell({ slot, table, step, mode, pairs }: { slot: number; table: Table; step: Step; mode: Mode; pairs: boolean }) {
  const { cx, floor } = cellOf(slot);
  const box = table[slot];
  const here = step.slot === slot && step.delivered;
  if (mode === "chips") {
    const sides: (0 | 1)[] = pairs ? [0, 1] : [0];
    return (
      <g>
        {sides.map((side) => {
          const x = cx + (pairs ? (side ? CHIP_X.b : CHIP_X.a) : CHIP_X.single);
          const count = box?.chips[side] ?? 0;
          const fresh = here && step.payload.kind === "chip" && step.payload.side === side;
          return (
            <g key={side}>
              <Solid paths={chipTray(x, floor)} tone="lo" crease="faint" />
              {Array.from({ length: count }, (_, n) => (
                <g key={n} data-arrive={fresh && n === count - 1 ? "" : undefined}>
                  <Solid paths={chipAt(x, floor, n)} tone="hi" crease="lo" inner={<Line d={chipSeam(x, floor, n)} tone="faint" />} />
                </g>
              ))}
            </g>
          );
        })}
      </g>
    );
  }
  if (mode === "cards") {
    const cards = box?.cards ?? [];
    const fresh = here && step.payload.kind === "card";
    return (
      <g>
        {rack(cx, floor).map((paths, i) => (
          <Solid key={i} paths={paths} tone="lo" crease="faint" />
        ))}
        {cards
          .map((text, index) => ({ text, k: cards.length - 1 - index }))
          .sort((a, b) => b.k - a.k)
          .map(({ text, k }) => {
            const card = cardAt(cx, floor, k);
            return (
              <g key={`${text}-${k}`} data-arrive={fresh && k === 0 ? "" : undefined} data-shift={fresh && k > 0 ? "" : undefined}>
                <Solid paths={card.solid} tone="hi" crease="lo" />
                <Line d={card.rule} tone="faint" free />
                <FaceText transform={card.text} size={4.6} tone="hi" anchor="middle">
                  {text}
                </FaceText>
              </g>
            );
          })}
      </g>
    );
  }
  return null;
}

/** La placa con la clave, escrita en la ventana del portaetiquetas. */
function Label({ slot, table, step }: { slot: number; table: Table; step: Step }) {
  const box = table[slot];
  if (!box) return null;
  const fresh = step.slot === slot && step.dock;
  return (
    <g data-arrive={fresh ? "" : undefined}>
      <FaceText transform={HOLDERS[slot]!.text} size={5.2} tone="hi" anchor="middle">
        {box.key}
      </FaceText>
    </g>
  );
}

function Row({ row, step, mode, pairs, locked }: { row: number; step: Step; mode: Mode; pairs: boolean; locked: boolean }) {
  const slots = Array.from({ length: COLUMNS }, (_, col) => (row === 1 ? col : COLUMNS + col));
  return (
    <g>
      {SHELVES[row]}
      {slots.map((slot) => (
        <Label key={`label-${slot}`} slot={slot} table={step.table} step={step} />
      ))}
      {slots.map((slot, col) => (
        <React.Fragment key={slot}>
          {locked ? shutterOf(slot) : <Cell slot={slot} table={step.table} step={step} mode={mode} pairs={pairs} />}
          {col < COLUMNS - 1 ? dividerOf(row, col) : null}
        </React.Fragment>
      ))}
    </g>
  );
}

/** Lo que lleva la paleta: la ficha o la tarjeta del paso (en coordenadas de la paleta). */
function Payload({ step, pairs }: { step: Step; pairs: boolean }) {
  const pay = step.payload;
  if (pay.kind === "chip") {
    const dx = pairs ? (pay.side ? CHIP_X.b : CHIP_X.a) : CHIP_X.single;
    return <Solid paths={payChip(dx)} tone="hi" crease="lo" inner={<Line d={payChipSeam(dx)} tone="faint" />} />;
  }
  if (pay.kind === "card") {
    const card = payCard();
    return (
      <g>
        <Solid paths={card.solid} tone="hi" crease="lo" />
        <Line d={card.rule} tone="faint" free />
        <FaceText transform={card.text} size={4.6} tone="hi" anchor="middle">
          {pay.text}
        </FaceText>
      </g>
    );
  }
  return null;
}

/** Cuánto se desplaza la carga de la paleta para quedar en su sitio dentro del casillero. */
function payloadTravel(step: Step): [number, number, number] {
  const pay = step.payload;
  const box = step.slot === null ? null : step.table[step.slot];
  if (pay.kind === "chip") {
    const n = (box?.chips[pay.side] ?? 1) - 1;
    return [0, CHIP_Y - PAY_CHIP_Y, TRAY_H + n * CHIP_H];
  }
  if (pay.kind === "card") return [0, cardFace(0) - (PAY_CARD_Y + CARD_T), cardLift(0)];
  return [0, 0, 0];
}

interface Live {
  index: number;
  clock: number;
  x: number;
  z: number;
  angle: number;
  fromX: number;
  fromZ: number;
  fromAngle: number;
  paused: boolean;
  manualAt: number;
  started: boolean;
}

export function CasillerosLive({ variant }: { variant: Variant }) {
  const { anchor, say } = useReadout<HTMLDivElement>();
  const root = React.useRef<HTMLDivElement | null>(null);
  const visible = useInView(root);
  const looks = React.useMemo(() => looksOf(variant), [variant]);
  const rest = React.useMemo(() => restIndexOf(variant), [variant]);
  const [index, setIndex] = React.useState(rest);
  const [paused, setPaused] = React.useState(false);
  const step = variant.steps[index]!;
  const { mode, pairs } = looks[index]!;
  const prev = variant.steps[(index - 1 + variant.steps.length) % variant.steps.length]!;
  const live = React.useRef<Live>({
    index: rest,
    clock: 99,
    x: DOCK_X,
    z: DOCK_Z,
    angle: 0,
    fromX: DOCK_X,
    fromZ: DOCK_Z,
    fromAngle: 0,
    paused: false,
    manualAt: -Infinity,
    started: false,
  });
  const nodes = React.useRef({
    needle: null as SVGPathElement | null,
    armX: null as SVGGElement | null,
    paddle: null as SVGGElement | null,
    payload: null as SVGGElement | null,
    tag: null as SVGGElement | null,
    tagSolid: null as SVGGElement | null,
    ticketPrev: null as SVGGElement | null,
    ticketNext: null as SVGGElement | null,
    stem: { fill: null, shades: [null, null, null, null], top: null, outline: null } as SolidNodes,
    arrive: [] as SVGGElement[],
    shift: [] as SVGGElement[],
    holders: [] as Element[],
    forIndex: -1,
  });
  const frame = React.useRef(0);
  const last = React.useRef(0);
  const announce = React.useRef<HTMLSpanElement | null>(null);

  // Al pintar un paso nuevo, guarda las piezas que el bucle anima.
  React.useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    nodes.current.arrive = Array.from(el.querySelectorAll<SVGGElement>("[data-arrive]"));
    nodes.current.shift = Array.from(el.querySelectorAll<SVGGElement>("[data-shift]"));
    nodes.current.holders = Array.from({ length: SLOTS }, (_, slot) => el.querySelector(`[data-holder="${slot}"] > .iso-solid`)!);
    nodes.current.tagSolid = el.querySelector<SVGGElement>(".cas-tag > .iso-solid");
    nodes.current.forIndex = index;
  }, [index, variant]);

  /** Escribe la pose del instante `clock` del paso `s`. */
  const draw = React.useCallback(() => {
    const L = live.current;
    const s = variant.steps[L.index]!;
    const t = L.clock;
    const n = nodes.current;
    const travel = s.slot !== null;
    const target = travel ? cellOf(s.slot!) : null;
    const goesHome = travel || s.kind === "reset";

    // Carro y paleta: a la estación, y de ahí directo al casillero.
    const home = goesHome ? span(t, HOME) : 0;
    let x = lerp(L.fromX, DOCK_X, home);
    let z = lerp(L.fromZ, DOCK_Z, home);
    if (target) {
      const go = span(t, TRAVEL);
      x = lerp(x, target.cx, go);
      z = lerp(z, target.floor, go);
      z = lerp(z, PARK_Z, span(t, LIFT));
    }
    L.x = x;
    L.z = z;
    n.armX?.setAttribute("transform", translateAlong(P, [x, 0, 0]));
    n.paddle?.setAttribute("transform", translateAlong(P, [0, 0, z]));
    writeSolid(n.stem, stemAt(z));

    // La rueda: una vuelta completa y cae en el número del casillero.
    let angle = L.fromAngle;
    if (target) {
      const to = (s.slot! / SLOTS) * TURN;
      const delta = ((((to - L.fromAngle) % TURN) + TURN) % TURN) + TURN;
      angle = L.fromAngle + delta * span(t, SPIN);
    } else if (s.kind === "reset") angle = L.fromAngle * (1 - span(t, HOME));
    L.angle = angle;
    n.needle?.setAttribute("d", needleAt(angle));

    // La carga: sale de la boca, viaja, entra.
    const shown = travel ? clamp01((t - EJECT[0]) / (EJECT[1] - EJECT[0])) : 0;
    // La carga aparece en la boca de la estación (sin atravesar la caja).
    const eject = 0;
    const push = travel ? span(t, PUSH) : 0;
    const arrived = !travel || t >= PUSH[1];
    const [, py, pz] = payloadTravel(s);
    const deliver = s.delivered && push > 0;
    let payOpacity = shown;
    if (travel && s.delivered && arrived) payOpacity = 0;
    if (n.payload) {
      n.payload.setAttribute("transform", translateAlong(P, [0, eject + (deliver ? py * push : 0), deliver ? pz * push : 0]));
      n.payload.style.opacity = `${payOpacity}`;
    }
    const docks = travel && (s.dock || s.found || s.kind === "look");
    let tagDy = docks ? DOCK_DY * push : 0;
    let tagOpacity = shown;
    if (travel && arrived) {
      if (s.dock) tagOpacity = 0;
      else if (s.found) tagOpacity = 1 - span(t, AFTER);
      else tagDy = DOCK_DY * (1 - span(t, AFTER));
    }
    if (n.tag) {
      n.tag.setAttribute("transform", translateAlong(P, [0, eject + tagDy, 0]));
      n.tag.style.opacity = `${tagOpacity}`;
    }
    if (n.tagSolid) {
      if (travel && !arrived) n.tagSolid.dataset.lit = "";
      else delete n.tagSolid.dataset.lit;
    }

    // Hasta que React pinte el paso nuevo, los nodos son los del anterior: no se tocan.
    if (n.forIndex !== L.index) return;

    // Lo que ya estaba en el casillero de destino se corre un peldaño atrás.
    const back = 1 - push;
    for (const node of n.shift) node.setAttribute("transform", back > 0 ? translateAlong(P, [0, RACK_STEP_D * back, -RACK_RISE * back]) : "");
    for (const node of n.arrive) node.style.opacity = arrived ? "1" : "0";

    // La placa encendida: la del casillero al que llegó el brazo.
    n.holders.forEach((holder, slot) => {
      if (!holder) return;
      const on = arrived && s.lit === slot;
      if (on) (holder as SVGGElement).dataset.lit = "";
      else delete (holder as SVGGElement).dataset.lit;
    });

    if (n.ticketPrev) n.ticketPrev.style.opacity = arrived ? "0" : "1";
    if (n.ticketNext) n.ticketNext.style.opacity = arrived ? "1" : "0";
    say(arrived ? s.readout : headOf(s.readout));
  }, [variant, say]);

  const begin = React.useCallback(
    (next: number, calm: boolean) => {
      const L = live.current;
      L.fromX = L.x;
      L.fromZ = L.z;
      L.fromAngle = L.angle % TURN;
      L.index = ((next % variant.steps.length) + variant.steps.length) % variant.steps.length;
      L.clock = calm ? 99 : 0;
      setIndex(L.index);
    },
    [variant],
  );

  const stop = React.useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = 0;
  }, []);

  const run = React.useCallback(() => {
    if (frame.current) return;
    last.current = 0;
    const tick = (now: number) => {
      const dt = last.current ? Math.min((now - last.current) / 1000, 1 / 30) : 1 / 60;
      last.current = now;
      const L = live.current;
      const calm = asksForStillness();
      const s = variant.steps[L.index]!;
      const T = durationOf(s);
      L.clock = calm ? Math.max(L.clock, T) : L.clock + dt;
      const manual = now / 1000 - L.manualAt < MANUAL_BACK;
      if (!calm && !L.paused && !manual && L.clock >= T + HOLD) begin(L.index + 1, false);
      draw();
      const settled = L.clock >= T && (calm || L.paused || manual);
      frame.current = settled && !manual ? 0 : requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }, [variant, begin, draw]);

  // Pinta la pose después de cada render (los nodos nuevos llegan con su atributo de reposo).
  React.useLayoutEffect(() => {
    draw();
  }, [index, draw]);

  // El recorrido arranca solo al entrar en pantalla y se detiene fuera de ella.
  React.useEffect(() => {
    if (!visible) {
      stop();
      return;
    }
    const L = live.current;
    if (asksForStillness() || L.started) {
      run();
      return;
    }
    const timer = window.setTimeout(() => {
      L.started = true;
      L.x = DOCK_X;
      L.z = DOCK_Z;
      L.angle = 0;
      begin(0, false);
      run();
    }, FIRST * 1000);
    return () => window.clearTimeout(timer);
  }, [visible, run, stop, begin]);

  React.useEffect(() => stop, [stop]);

  // Gancho de QA (sin efecto en uso normal): congela la máquina en un paso y un instante.
  React.useEffect(() => {
    const el = root.current as (HTMLDivElement & { __casilleros?: unknown }) | null;
    if (!el) return;
    el.__casilleros = {
      seek(next: number, clock: number) {
        const L = live.current;
        L.paused = true;
        L.started = true;
        L.x = DOCK_X;
        L.z = DOCK_Z;
        L.angle = 0;
        begin(next, false);
        L.clock = clock;
        stop();
        setPaused(true);
        requestAnimationFrame(() => requestAnimationFrame(() => draw()));
      },
    };
  }, [begin, stop, draw]);

  const go = (delta: number) => {
    const L = live.current;
    L.started = true;
    L.manualAt = performance.now() / 1000;
    begin(L.index + delta, asksForStillness());
    stop();
    run();
    const next = variant.steps[L.index]!;
    if (announce.current) announce.current.textContent = `Paso ${L.index + 1} de ${variant.steps.length}: ${next.readout}`;
  };

  const togglePause = () => {
    const L = live.current;
    L.started = true;
    L.paused = !L.paused;
    L.manualAt = -Infinity;
    setPaused(L.paused);
    if (announce.current) announce.current.textContent = L.paused ? "En pausa" : "Sigue";
    stop();
    run();
  };

  const bind = <K extends "needle" | "armX" | "paddle" | "payload" | "tag" | "ticketPrev" | "ticketNext">(key: K) => (node: SVGPathElement | SVGGElement | null) => {
    (nodes.current as Record<K, unknown>)[key] = node;
  };
  const stemRef = (key: "fill" | "top" | "outline") => (node: SVGPathElement | null) => {
    nodes.current.stem[key] = node;
  };

  const zStem = stemAt(DOCK_Z);
  const ticketIn = fitTicket(step.ticketIn, TICKET_SPECS[0]!.w);
  const ticketPrev = fitTicket(step.kind === "reset" ? "" : prev.ticketOut, TICKET_SPECS[1]!.w);
  const ticketNext = fitTicket(step.ticketOut, TICKET_SPECS[1]!.w);
  const tickets = ORDER_ART.tickets;
  const queue = QUEUE_CARDS.slice(QUEUE_CARDS.length - Math.min(step.queue, QUEUE_CARDS.length));

  return (
    <div
      ref={(node) => {
        root.current = node;
        anchor.current = node;
      }}
      className="cas"
      tabIndex={0}
      role="group"
      aria-roledescription="figura interactiva"
      aria-label={`${variant.label} Flechas izquierda y derecha: paso anterior o siguiente. Espacio: pausa.`}
      data-paused={paused ? "" : undefined}
      data-step={index}
      onClick={() => go(1)}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
          event.preventDefault();
          event.stopPropagation();
          go(event.key === "ArrowRight" ? 1 : -1);
        } else if (event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          if (!event.repeat) togglePause();
        }
      }}
    >
      <IsoFigure width={WIDTH} height={HEIGHT} label={variant.label}>
        {BASE}
        {STATION}
        <g>
          {queue.map((paths, i) => (
            <Solid key={i} paths={paths} tone="mid" crease="faint" />
          ))}
        </g>
        <path ref={bind("needle")} className="iso-line cas-needle" data-tone="lit" d={needleAt(0)} />
        {DIAL_HUB}
        {CABINET_BACK}
        <Row row={0} step={step} mode={mode} pairs={pairs} locked={variant.locked} />
        <Row row={1} step={step} mode={mode} pairs={pairs} locked={variant.locked} />
        {CABINET_FRONT}
        {variant.locked ? LOCK : null}
        {POSTS}
        {RAIL}
        <g ref={bind("armX")} transform={translateAlong(P, [DOCK_X, 0, 0])}>
          {CARRIAGE}
          <g className="iso-solid">
            <path ref={stemRef("fill")} className="iso-fill" d={zStem.fill} />
            {[0, 1, 2, 3].map((i) => (
              <path
                key={i}
                ref={(node) => {
                  nodes.current.stem.shades[i] = node;
                }}
                className="iso-shade"
                data-shade={i}
                d={zStem.shades[i] ?? ""}
              />
            ))}
            <path ref={stemRef("top")} className="iso-top" d={zStem.top} />
            <path ref={stemRef("outline")} className="iso-line iso-edge" data-tone="mid" d={zStem.outline} />
          </g>
          <g ref={bind("paddle")} transform={translateAlong(P, [0, 0, DOCK_Z])}>
            {PADDLE}
            <g ref={bind("payload")} style={{ opacity: 0 }}>
              <Payload step={step} pairs={pairs} />
            </g>
            <Dots points={PADDLE_ART.clips} size={0.5} tone="mid" />
            <g ref={bind("tag")} style={{ opacity: 0 }}>
              <g className="cas-tag">
                <Solid paths={PADDLE_ART.tag} tone="hi" crease="lo" />
              </g>
              <FaceText transform={PADDLE_ART.tagText} size={5.2} tone="hi" anchor="middle">
                {step.key ?? ""}
              </FaceText>
            </g>
          </g>
        </g>
        {ORDER_RAIL}
        {TICKETS}
        <g className="cas-ticket-text">
          {ticketIn.lines.map((line, i) =>
            line ? (
              <FaceText key={`in-${i}`} transform={tickets[0]!.lines[i]!} size={ticketIn.size} tone="hi" anchor="middle">
                {line}
              </FaceText>
            ) : null,
          )}
          <g ref={bind("ticketPrev")}>
            {ticketPrev.lines.map((line, i) =>
              line ? (
                <FaceText key={`p-${i}`} transform={tickets[1]!.lines[i]!} size={ticketPrev.size} tone="hi" anchor="middle">
                  {line}
                </FaceText>
              ) : null,
            )}
          </g>
          <g ref={bind("ticketNext")} style={{ opacity: 0 }}>
            {ticketNext.lines.map((line, i) =>
              line ? (
                <FaceText key={`n-${i}`} transform={tickets[1]!.lines[i]!} size={ticketNext.size} tone="hi" anchor="middle">
                  {line}
                </FaceText>
              ) : null,
            )}
          </g>
        </g>
      </IsoFigure>
      <span ref={announce} className="cas-sr" aria-live="polite" />
    </div>
  );
}
