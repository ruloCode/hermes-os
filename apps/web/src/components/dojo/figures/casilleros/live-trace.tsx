"use client";

// Casilleros EN VIVO: la misma máquina, movida por la traza del código del
// alumno. React pinta el gabinete del paso (cambia entre pasos, 70-450 ms) y un
// bucle de rAF lleva carro, paleta, aguja y lo recién guardado a su sitio con
// un seguimiento exponencial, así el movimiento es continuo aunque la traza
// salte. La geometría es la misma, precalculada, del modo guion.

import * as React from "react";
import { asksForStillness, follow } from "../../iso/react/live";
import { FaceText, IsoFigure, Line, Plate, Solid } from "../../iso/react/draw";
import { translateAlong } from "../../iso/iso-kit";
import { BASE, CABINET_BACK, CABINET_FRONT, CARRIAGE, DIAL_HUB, ORDER_RAIL, PADDLE, POSTS, RAIL, SHELVES, STATION, dividerOf } from "./art";
import { HOLDERS, ORDER_ART, PADDLE_ART, cardAt, chipAt, chipSeam, chipTray, needleAt, rack, stemAt } from "./geometry";
import { COLUMNS, SLOTS } from "./model";
import type { LiveBox, LiveMode, LiveScene, LiveState } from "./trace";
import { CHIP_X, DOCK_DY, DOCK_X, DOCK_Z, HEIGHT, P, RACK_RISE, RACK_STEP_D, TICKETS as TICKET_SPECS, WIDTH, cellOf, fitTicket } from "./view";
import "./casilleros.css";

/** Constante de tiempo del seguimiento: llega en ~3τ, a tiempo para pasos de 450 ms y fluido a 70 ms. */
const TAU = 0.09;
const TURN = Math.PI * 2;
/** De dónde entra lo recién guardado: la boca del casillero, frente a la placa. */
const MOUTH_DY = 26;

function Cell({ slot, box, before, mode, pairs }: { slot: number; box: LiveBox | null; before: LiveBox | null; mode: LiveMode; pairs: boolean }) {
  const { cx, floor } = cellOf(slot);
  if (mode === "chips") {
    const sides: (0 | 1)[] = pairs ? [0, 1] : [0];
    return (
      <g>
        {sides.map((side) => {
          const x = cx + (pairs ? (side ? CHIP_X.b : CHIP_X.a) : CHIP_X.single);
          const count = box?.chips[side] ?? 0;
          const had = before && box && before.key === box.key ? before.chips[side] : 0;
          return (
            <g key={side}>
              <Solid paths={chipTray(x, floor)} tone="lo" crease="faint" />
              {Array.from({ length: count }, (_, n) => (
                <g key={n} data-fresh={n >= had ? "" : undefined}>
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
    const old = before && box && before.key === box.key ? before.cards : [];
    const grew = cards.length > old.length || cards.join("\u0000") !== old.join("\u0000");
    return (
      <g>
        {rack(cx, floor).map((paths, i) => (
          <Solid key={i} paths={paths} tone="lo" crease="faint" />
        ))}
        {cards
          .map((text, index) => ({ text, k: cards.length - 1 - index }))
          .filter(({ k }) => k < 3)
          .sort((a, b) => b.k - a.k)
          .map(({ text, k }) => {
            const card = cardAt(cx, floor, k);
            return (
              <g key={`${k}-${text}`} data-fresh={grew && k === 0 ? "" : undefined} data-shift={grew && k > 0 && cards.length > old.length ? "" : undefined}>
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

function Row({ row, state, before, mode, pairs }: { row: number; state: LiveState; before: LiveState | undefined; mode: LiveMode; pairs: boolean }) {
  const slots = Array.from({ length: COLUMNS }, (_, col) => (row === 1 ? col : COLUMNS + col));
  return (
    <g>
      {SHELVES[row]}
      {slots.map((slot) =>
        state.table[slot] ? (
          <FaceText key={`label-${slot}`} transform={HOLDERS[slot]!.text} size={5.2} tone="hi" anchor="middle">
            {state.table[slot]!.key}
          </FaceText>
        ) : null,
      )}
      {slots.map((slot, col) => (
        <React.Fragment key={slot}>
          <Cell slot={slot} box={state.table[slot] ?? null} before={before?.table[slot] ?? null} mode={mode} pairs={pairs} />
          {col < COLUMNS - 1 ? dividerOf(row, col) : null}
        </React.Fragment>
      ))}
    </g>
  );
}

interface Motion {
  x: number;
  z: number;
  angle: number;
  tagDy: number;
  /** 1 = lo recién guardado aún en la boca, 0 = en su sitio. */
  fresh: number;
}

export function CasillerosTrace({ title, scene, step }: { title: string; scene: LiveScene; step: number }) {
  const at = Math.max(0, Math.min(step, scene.states.length - 1));
  const state = scene.states[at]!;
  const before = at > 0 ? scene.states[at - 1] : undefined;
  const root = React.useRef<HTMLDivElement | null>(null);
  const nodes = React.useRef({
    needle: null as SVGPathElement | null,
    armX: null as SVGGElement | null,
    paddle: null as SVGGElement | null,
    tag: null as SVGGElement | null,
    stem: { fill: null as SVGPathElement | null, shades: [null, null, null, null] as (SVGPathElement | null)[], top: null as SVGPathElement | null, outline: null as SVGPathElement | null },
  });
  const motion = React.useRef<Motion>({ x: DOCK_X, z: DOCK_Z, angle: 0, tagDy: 0, fresh: 0 });
  const frame = React.useRef(0);

  const target = React.useMemo(() => {
    const probe = state.probe;
    const cell = probe ? cellOf(probe.slot) : null;
    return {
      x: cell ? cell.cx : DOCK_X,
      z: cell ? cell.floor : DOCK_Z,
      angle: probe ? (probe.slot / SLOTS) * TURN : 0,
      tagDy: state.found ? DOCK_DY : 0,
    };
  }, [state]);

  const draw = React.useCallback(() => {
    const m = motion.current;
    const n = nodes.current;
    n.armX?.setAttribute("transform", translateAlong(P, [m.x, 0, 0]));
    n.paddle?.setAttribute("transform", translateAlong(P, [0, 0, m.z]));
    const stem = stemAt(m.z);
    n.stem.fill?.setAttribute("d", stem.fill);
    stem.shades.forEach((d, i) => n.stem.shades[i]?.setAttribute("d", d ?? ""));
    n.stem.top?.setAttribute("d", stem.top);
    n.stem.outline?.setAttribute("d", stem.outline);
    n.needle?.setAttribute("d", needleAt(m.angle));
    n.tag?.setAttribute("transform", translateAlong(P, [0, m.tagDy, 0]));
    const el = root.current;
    if (!el) return;
    const off = m.fresh;
    el.querySelectorAll("[data-fresh]").forEach((node) => node.setAttribute("transform", off > 0.002 ? translateAlong(P, [0, MOUTH_DY * off, 0]) : ""));
    el.querySelectorAll("[data-shift]").forEach((node) => node.setAttribute("transform", off > 0.002 ? translateAlong(P, [0, RACK_STEP_D * off, -RACK_RISE * off]) : ""));
  }, []);

  // Cada paso nuevo: lo recién guardado arranca en la boca y la placa del casillero se enciende.
  React.useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const calm = asksForStillness();
    motion.current.fresh = calm || !el.querySelector("[data-fresh]") ? 0 : 1;
    for (let slot = 0; slot < SLOTS; slot++) {
      const holder = el.querySelector<SVGGElement>(`[data-holder="${slot}"] > .iso-solid`);
      if (!holder) continue;
      if (state.lit === slot) holder.dataset.lit = "";
      else delete holder.dataset.lit;
    }
    const m = motion.current;
    // La aguja siempre gira hacia adelante (es una rueda, no un péndulo).
    const delta = (((target.angle - m.angle) % TURN) + TURN) % TURN;
    const goal = { ...target, angle: m.angle + delta };
    if (calm) {
      Object.assign(m, goal, { fresh: 0 });
      draw();
      return;
    }
    cancelAnimationFrame(frame.current);
    let last = 0;
    const tick = (now: number) => {
      const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
      last = now;
      m.x = follow(m.x, goal.x, dt, TAU);
      m.z = follow(m.z, goal.z, dt, TAU);
      m.angle = follow(m.angle, goal.angle, dt, TAU);
      m.tagDy = follow(m.tagDy, goal.tagDy, dt, TAU * 0.7);
      m.fresh = follow(m.fresh, 0, dt, TAU);
      draw();
      const done = m.x === goal.x && m.z === goal.z && m.angle === goal.angle && m.tagDy === goal.tagDy && m.fresh === 0;
      frame.current = done ? 0 : requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }, [state, target, draw]);

  React.useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const stem0 = stemAt(DOCK_Z);
  const tickets = ORDER_ART.tickets;
  const inFit = fitTicket(scene.call, TICKET_SPECS[0]!.w);
  const ret = scene.states.slice(0, at + 1).reverse().find((s) => s.ret !== null);
  const outFit = fitTicket(ret?.ret ?? "", TICKET_SPECS[1]!.w);
  const what = scene.vars.join(" y ");
  const caption =
    `Los casilleros son ${scene.vars.length > 1 ? "tus" : "tu"} ${scene.mode === "set" ? "set" : "dict"} ${what}, con las claves y valores que tu código tiene en este paso. ` +
    `La etiqueta del brazo es lo que tu código acaba de calcular; se enciende el casillero que cambió o que se miró.` +
    (state.overflow ? ` Hay ${state.overflow} claves más de las que caben en los seis casilleros.` : "");

  return (
    <Plate
      fig="Fig 7"
      title={title}
      hint="En vivo"
      readout={state.readout}
      keys={[
        { mark: "lit", label: "La clave que cambió o se miró" },
        { mark: "raised", label: `${what}: placa = clave, adentro = valor` },
      ]}
      caption={caption}
    >
      <div ref={root} className="cas cas-live">
        <IsoFigure width={WIDTH} height={HEIGHT} label={`Gabinete de seis casilleros que muestra ${what} en el paso ${at + 1} de tu código.`}>
          {BASE}
          {STATION}
          <path
            ref={(node) => {
              nodes.current.needle = node;
            }}
            className="iso-line cas-needle"
            data-tone="lit"
            d={needleAt(0)}
          />
          {DIAL_HUB}
          {CABINET_BACK}
          <Row row={0} state={state} before={before} mode={scene.mode} pairs={scene.pairs} />
          <Row row={1} state={state} before={before} mode={scene.mode} pairs={scene.pairs} />
          {CABINET_FRONT}
          {POSTS}
          {RAIL}
          <g
            ref={(node) => {
              nodes.current.armX = node;
            }}
            transform={translateAlong(P, [DOCK_X, 0, 0])}
          >
            {CARRIAGE}
            <g className="iso-solid">
              <path ref={(node) => void (nodes.current.stem.fill = node)} className="iso-fill" d={stem0.fill} />
              {[0, 1, 2, 3].map((i) => (
                <path key={i} ref={(node) => void (nodes.current.stem.shades[i] = node)} className="iso-shade" data-shade={i} d={stem0.shades[i] ?? ""} />
              ))}
              <path ref={(node) => void (nodes.current.stem.top = node)} className="iso-top" d={stem0.top} />
              <path ref={(node) => void (nodes.current.stem.outline = node)} className="iso-line iso-edge" data-tone="mid" d={stem0.outline} />
            </g>
            <g
              ref={(node) => {
                nodes.current.paddle = node;
              }}
              transform={translateAlong(P, [0, 0, DOCK_Z])}
            >
              {PADDLE}
              {state.probe ? (
                <g
                  ref={(node) => {
                    nodes.current.tag = node;
                  }}
                >
                  <Solid paths={PADDLE_ART.tag} tone="hi" crease="lo" lit />
                  <FaceText transform={PADDLE_ART.tagText} size={5.2} tone="hi" anchor="middle">
                    {state.probe.text}
                  </FaceText>
                </g>
              ) : null}
            </g>
          </g>
          {ORDER_RAIL}
          {tickets.map((ticket, i) => (
            <React.Fragment key={`ticket-${i}`}>
              <Solid paths={ticket.solid} tone="mid" crease="faint" lit={i === 1 && ret?.ok === true} inner={<Line d={ticket.perf} tone="faint" dotted />} />
              <Solid paths={ticket.clip} tone="mid" crease="faint" />
              {(i === 0 ? inFit : outFit).lines.map((line, j) =>
                line ? (
                  <FaceText key={j} transform={ticket.lines[j]!} size={(i === 0 ? inFit : outFit).size} tone="hi" anchor="middle">
                    {line}
                  </FaceText>
                ) : null,
              )}
            </React.Fragment>
          ))}
        </IsoFigure>
      </div>
    </Plate>
  );
}
