"use client";

// El componedor vivo: un solo bucle que lleva cada pieza (fichas, tope, carros)
// hacia el paso que toca y escribe los atributos por refs. React solo vuelve a
// pintar al cambiar de escena (otras fichas).
//
// Dos maneras de avanzar:
// - Guion (sin `external`): el recorrido corre solo en bucle; con foco, ← →
//   cambian de ejemplo y Espacio pausa/sigue (solo esas teclas se detienen aquí:
//   el Dojo usa ↑↓, j/k, Enter y Esc a nivel ventana); un clic pasa al siguiente.
// - En vivo (`external` = el paso de la traza del alumno): el paso lo pone el
//   reproductor del Dojo (◀ ▶, barra, ←/→ con SU foco); aquí solo se anima.

import * as React from "react";
import { translateAlong } from "../../iso/iso-kit";
import { IsoFigure } from "../../iso/react/draw";
import { follow, useInView, useLoop, useReadout } from "../../iso/react/live";
import { BASE, BEAM, BED, BOX, CARRIAGE, KNEE_PARTS, POSTS, STICK_BACK, beamTicksOf, rulerOf, stripOf } from "./art";
import { BOX_ART, KNEE_ART, slotArt, windowSize, type SlotArt } from "./geometry";
import type { Lesson, Piece, Step } from "./model";
import { HEIGHT, P, PARK_A, PARK_B, TILE_H, WIDTH } from "./view";

const SLIDE = 0.2;
const LIFT = 0.16;
const FADE = 0.14;
const CARRY = 0.24;
/** En vivo los pasos duran 70-450 ms: las piezas llegan antes del siguiente. */
const QUICK = 0.5;
const DROP_FROM = 18;
const GONE_Z = 30;

interface Live {
  key: string;
  x: number[];
  z: number[];
  alpha: number[];
  was: (number | null)[];
  /** Tope y carros en x de mundo (la regla puede cambiar de juego). */
  knee: number;
  a: number;
  b: number;
  step: number;
  clock: number;
  order: string;
  group: number;
}

const tenth = (value: number) => Math.round(value * 100) / 100;
const parked = (value: number | null, w: number, fallback: number) => (value === null ? fallback : value * w);

/** Juegos de fichas de una lección (con su arte); el primero es el de siempre. */
export function groupArts(lesson: Lesson): SlotArt[] {
  const chars = Math.max(1, ...lesson.scenes.flatMap((scene) => scene.pieces.filter((piece) => !piece.group).map((piece) => piece.label.length)));
  return (lesson.groups ?? [{ cap: lesson.cap, chars }]).map((group) => slotArt(group.cap, group.chars));
}

function liveAt(key: string, step: Step, arts: SlotArt[], drop: boolean): Live {
  const w = arts[step.group ?? 0]!.w;
  return {
    key,
    x: step.slots.map((slot, index) => slot ?? index),
    z: step.slots.map((slot, index) => (slot === null ? GONE_Z : drop ? DROP_FROM + index * 2.5 : step.lift[index] ?? 0)),
    alpha: step.slots.map((slot) => (slot === null ? 0 : 1)),
    was: [...step.slots],
    knee: step.len * w,
    a: parked(step.a, w, PARK_A),
    b: parked(step.b, w, PARK_B),
    step: 0,
    clock: 0,
    order: "",
    group: step.group ?? 0,
  };
}

export function TiposLive({ lesson, label, external }: { lesson: Lesson; label: string; external?: number }) {
  const { anchor, say } = useReadout<HTMLDivElement>();
  const visible = useInView(anchor);
  const clipId = React.useId().replace(/:/g, "");
  const arts = React.useMemo(() => groupArts(lesson), [lesson]);
  const wOf = (piece: Piece | undefined) => arts[piece?.group ?? 0]!.w;

  const [scene, setScene] = React.useState(0);
  const current = lesson.scenes[Math.min(scene, lesson.scenes.length - 1)]!;
  const paused = React.useRef(false);
  const [pausedShown, setPausedShown] = React.useState(false);
  const target = React.useRef(external ?? 0);
  target.current = external ?? 0;

  const tiles = React.useRef<(SVGGElement | null)[]>([]);
  const solids = React.useRef<(SVGGElement | null)[]>([]);
  const faces = React.useRef<(SVGTextElement | null)[]>([]);
  const numerals = React.useRef<(SVGTextElement | null)[][]>(arts.map(() => []));
  const negatives = React.useRef<(SVGTextElement | null)[][]>(arts.map(() => []));
  const rulers = React.useRef<(SVGGElement | null)[]>([]);
  const tray = React.useRef<SVGGElement | null>(null);
  const knee = React.useRef<SVGGElement | null>(null);
  const kneeBody = React.useRef<SVGGElement | null>(null);
  const strip = React.useRef<SVGGElement | null>(null);
  const carA = React.useRef<SVGGElement | null>(null);
  const carB = React.useRef<SVGGElement | null>(null);
  const window_ = React.useRef<SVGTextElement | null>(null);

  const live = React.useRef<Live>(liveAt(current.key, current.steps[Math.min(target.current, current.steps.length - 1)]!, arts, false));
  const shownStep = React.useRef(-1);

  /** Lo que cambia por PASO (no por cuadro): acento, caras, ventana, regla, lectura. */
  const stage = React.useCallback(
    (step: Step) => {
      say(step.say);
      if (window_.current && window_.current.textContent !== step.out) {
        window_.current.textContent = step.out;
        window_.current.setAttribute("font-size", `${Math.round(windowSize(step.out) * 100) / 100}`);
      }
      current.pieces.forEach((_, index) => {
        const solid = solids.current[index];
        const face = faces.current[index];
        const lit = step.lit.includes(index);
        if (solid) {
          if (lit) solid.dataset.lit = "";
          else delete solid.dataset.lit;
        }
        if (face) {
          const text = step.faces[index] ?? "";
          if (face.textContent !== text) face.textContent = text;
        }
      });
      if (kneeBody.current) {
        if (step.knee) kneeBody.current.dataset.lit = "";
        else delete kneeBody.current.dataset.lit;
      }
      const group = step.group ?? 0;
      rulers.current.forEach((node, index) => {
        if (!node) return;
        const shown = index % arts.length === group ? "" : "none";
        if (node.style.display !== shown) node.style.display = shown;
      });
      // Los números de las casillas que se leen se encienden en las dos reglas.
      const read = new Set(step.lit.map((index) => step.slots[index]).filter((slot): slot is number => slot !== null));
      numerals.current[group]?.forEach((node, index) => {
        if (node) node.dataset.tone = read.has(index) ? "hi" : index < step.len ? "mid" : "lo";
      });
      negatives.current[group]?.forEach((node, index) => {
        if (node) node.dataset.tone = read.has(step.len - 1 - index) ? "hi" : index < step.len ? "mid" : "lo";
      });
    },
    [current, say, arts],
  );

  const draw = React.useCallback(() => {
    const s = live.current;
    s.x.forEach((x, index) => {
      const node = tiles.current[index];
      if (!node) return;
      node.setAttribute("transform", translateAlong(P, [tenth(x * wOf(current.pieces[index])), 0, tenth(s.z[index]!)]));
      const alpha = `${Math.round(s.alpha[index]! * 100) / 100}`;
      if (node.style.opacity !== alpha) node.style.opacity = alpha === "1" ? "" : alpha;
    });
    // Orden de pintura: lo que va por encima de las fichas (todo el bloque más
    // alto que una ficha) se pinta al final; lo demás, de izquierda a derecha.
    const order = s.x
      .map((x, index) => ({ index, high: s.z[index]! >= TILE_H + 1 ? 1 : 0, z: s.z[index]!, x: x * wOf(current.pieces[index]) }))
      .sort((p, q) => p.high - q.high || (p.high ? p.z - q.z : 0) || p.x - q.x)
      .map((item) => item.index);
    const key = order.join(",");
    if (key !== s.order && tray.current) {
      s.order = key;
      const fragment = document.createDocumentFragment();
      for (const index of order) {
        const node = tiles.current[index];
        if (node) fragment.appendChild(node);
      }
      tray.current.appendChild(fragment);
    }
    const kneeAt = translateAlong(P, [tenth(s.knee), 0, 0]);
    knee.current?.setAttribute("transform", kneeAt);
    strip.current?.setAttribute("transform", kneeAt);
    carA.current?.setAttribute("transform", translateAlong(P, [tenth(s.a), 0, 0]));
    carB.current?.setAttribute("transform", translateAlong(P, [tenth(s.b), 0, 0]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, arts]);

  const kick = useLoop((dt, calm) => {
    const steps = current.steps;
    const driven = external !== undefined;
    if (live.current.key !== current.key) {
      // Escena nueva: las fichas caen en su sitio y el guion empieza de cero.
      live.current = liveAt(current.key, steps[driven ? Math.min(target.current, steps.length - 1) : 0]!, arts, !calm && !driven);
      shownStep.current = -1;
    }
    const s = live.current;
    if (driven) {
      s.step = Math.max(0, Math.min(steps.length - 1, target.current));
    } else if (calm) {
      // Quieto: el último paso del ejemplo, sin recorrido.
      s.step = steps.length - 1;
    } else if (!paused.current) {
      s.clock += dt;
      while (s.clock >= steps[s.step]!.dur) {
        s.clock -= steps[s.step]!.dur;
        if (s.step + 1 >= steps.length) {
          if (lesson.scenes.length > 1) {
            setScene((value) => (value + 1) % lesson.scenes.length);
            return false;
          }
          live.current = liveAt(current.key, steps[0]!, arts, true);
          shownStep.current = -1;
          return true;
        }
        s.step += 1;
      }
    }
    const step = steps[s.step]!;
    if (shownStep.current !== s.step) {
      shownStep.current = s.step;
      stage(step);
    }
    const pace = driven ? QUICK : 1;
    let moving = false;
    step.slots.forEach((slot, index) => {
      if (slot !== null && s.was[index] === null) {
        // Entra una ficha nueva: cae desde arriba en su casilla.
        s.x[index] = slot;
        s.z[index] = calm ? 0 : DROP_FROM + 8;
      }
      s.was[index] = slot;
      const x = slot ?? s.x[index]!;
      const z = slot === null ? GONE_Z : step.lift[index] ?? 0;
      const alpha = slot === null ? 0 : 1;
      const nx = follow(s.x[index]!, x, dt, SLIDE * pace, calm);
      const nz = follow(s.z[index]!, z, dt, LIFT * pace, calm);
      const na = follow(s.alpha[index]!, alpha, dt, FADE * pace, calm);
      moving ||= nx !== x || nz !== z || na !== alpha;
      s.x[index] = nx;
      s.z[index] = nz;
      s.alpha[index] = na;
    });
    const w = arts[step.group ?? 0]!.w;
    const targets: [keyof Pick<Live, "knee" | "a" | "b">, number, number][] = [
      ["knee", step.len * w, SLIDE * pace],
      ["a", parked(step.a, w, PARK_A), CARRY * pace],
      ["b", parked(step.b, w, PARK_B), CARRY * pace],
    ];
    for (const [name, goal, seconds] of targets) {
      const next = follow(s[name], goal, dt, seconds, calm);
      moving ||= Math.abs(next - goal) > 1e-3;
      s[name] = next;
    }
    draw();
    if (driven) return moving;
    return !calm && (!paused.current || moving);
  }, visible);

  // Cambio de escena o de paso externo: el bucle hace el resto.
  React.useEffect(() => {
    tiles.current.length = current.pieces.length;
    solids.current.length = current.pieces.length;
    faces.current.length = current.pieces.length;
    kick();
  }, [current, kick, external]);

  const go = (by: number) => {
    setScene((value) => (value + by + lesson.scenes.length) % lesson.scenes.length);
  };
  const toggle = () => {
    paused.current = !paused.current;
    setPausedShown(paused.current);
    kick();
  };

  const first = current.steps[Math.min(external ?? 0, current.steps.length - 1)]!;
  const firstGroup = first.group ?? 0;
  const w0 = arts[firstGroup]!.w;
  const bind = <T,>(list: React.MutableRefObject<(T | null)[]>, index: number) => (node: T | null) => {
    list.current[index] = node;
  };
  const bindIn = (list: React.MutableRefObject<(SVGTextElement | null)[][]>, group: number) => (index: number) => (node: SVGTextElement | null) => {
    (list.current[group] ??= [])[index] = node;
  };
  const driven = external !== undefined;

  // La parte estática no cambia entre pasos: se arma una vez por escena.
  const pieces = React.useMemo(
    () =>
      current.pieces.map((piece, index) => {
        const slot = first.slots[index];
        const art = arts[piece.group ?? 0]!;
        const lit = first.lit.includes(index);
        return (
          <g
            key={`${current.key}-${index}`}
            ref={bind(tiles, index)}
            transform={translateAlong(P, [(slot ?? index) * art.w, 0, slot === null ? GONE_Z : first.lift[index] ?? 0])}
            style={slot === null ? { opacity: 0 } : undefined}
          >
            <TileArt paths={piece.space ? art.space : art.tile} lit={lit} bind={bind(solids, index)}>
              {piece.space ? (
                <path className="iso-line" data-tone="faint" d={art.spaceNick} />
              ) : (
                <>
                  <path className="iso-line" data-tone="faint" d={art.tilePanel} />
                  <path className="iso-line" data-tone="faint" d={art.tileNick} />
                  <text ref={bind(faces, index)} className="iso-face-text tp-letter" data-tone="hi" transform={art.letter} fontSize={art.letterSize} textAnchor="middle">
                    {first.faces[index]}
                  </text>
                </>
              )}
            </TileArt>
          </g>
        );
      }),
    // Solo al cambiar de escena: los pasos los escribe el bucle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [current, arts],
  );
  const statics = React.useMemo(
    () => ({
      rulers: arts.map((art, group) => (
        <g key={`ruler-${group}`} ref={(node) => void (rulers.current[group] = node)} style={group === firstGroup ? undefined : { display: "none" }}>
          {rulerOf(art, bindIn(numerals, group))}
        </g>
      )),
      strips: arts.map((art, group) => (
        <g key={`strip-${group}`} ref={(node) => void (rulers.current[arts.length + group] = node)} style={group === firstGroup ? undefined : { display: "none" }}>
          {stripOf(art, bindIn(negatives, group))}
        </g>
      )),
      beams: arts.map((art, group) => (
        <g key={`beam-${group}`} ref={(node) => void (rulers.current[arts.length * 2 + group] = node)} style={group === firstGroup ? undefined : { display: "none" }}>
          {beamTicksOf(art.cap)}
        </g>
      )),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [arts],
  );

  return (
    <div
      ref={anchor}
      className="tp-live"
      data-driven={driven ? "" : undefined}
      tabIndex={driven ? undefined : 0}
      role={driven ? undefined : "slider"}
      aria-label={driven ? undefined : `${label} Flechas izquierda y derecha: otro ejemplo. Espacio: pausa.`}
      aria-valuemin={driven ? undefined : 1}
      aria-valuemax={driven ? undefined : lesson.scenes.length}
      aria-valuenow={driven ? undefined : scene + 1}
      aria-valuetext={driven ? undefined : current.spoken}
      data-paused={pausedShown ? "" : undefined}
      onClick={driven ? undefined : () => go(1)}
      onKeyDown={
        driven
          ? undefined
          : (event) => {
              if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                event.preventDefault();
                event.stopPropagation();
                go(event.key === "ArrowRight" ? 1 : -1);
              } else if (event.key === " " || event.key === "Spacebar") {
                event.preventDefault();
                event.stopPropagation();
                if (!event.repeat) toggle();
              }
            }
      }
    >
      <IsoFigure width={WIDTH} height={HEIGHT} label={label}>
        <defs>
          <clipPath id={`${clipId}-strip`}>
            <path d={arts[0]!.stripClip} />
          </clipPath>
          <clipPath id={`${clipId}-window`}>
            <path d={BOX_ART.clip} />
          </clipPath>
        </defs>
        {BASE}
        {lesson.mechanism ? POSTS : null}
        {STICK_BACK}
        {BED}
        {statics.rulers}
        <g clipPath={`url(#${clipId}-strip)`}>
          <g ref={strip} transform={translateAlong(P, [first.len * w0, 0, 0])}>
            {statics.strips}
          </g>
        </g>
        {lesson.mechanism ? BEAM : null}
        {lesson.mechanism ? statics.beams : null}
        <g ref={tray} key={`tray-${current.key}`}>
          {pieces}
        </g>
        <g ref={knee} transform={translateAlong(P, [first.len * w0, 0, 0])}>
          <g ref={kneeBody} className="iso-solid" data-lit={first.knee ? "" : undefined}>
            <SolidPaths paths={KNEE_ART.body} tone="mid" />
          </g>
          <path className="iso-line" data-tone="faint" d={KNEE_ART.bodyLine} />
          <path className="iso-line" data-tone="hi" d={KNEE_ART.index} />
          {KNEE_PARTS}
        </g>
        {BOX}
        <g clipPath={`url(#${clipId}-window)`}>
          <text ref={window_} className="iso-face-text tp-window" data-tone="hi" transform={BOX_ART.text} fontSize={windowSize(first.out)} textAnchor="middle" dominantBaseline="central">
            {first.out}
          </text>
        </g>
        {lesson.mechanism ? (
          <>
            <g ref={carA} transform={translateAlong(P, [parked(first.a, w0, PARK_A), 0, 0])}>
              {CARRIAGE}
            </g>
            <g ref={carB} transform={translateAlong(P, [parked(first.b, w0, PARK_B), 0, 0])}>
              {CARRIAGE}
            </g>
          </>
        ) : null}
      </IsoFigure>
    </div>
  );
}

/** Una ficha: el Solid del kit con el g expuesto (el acento se enciende por ref). */
function TileArt({ paths, lit, bind, children }: { paths: import("../../iso/iso-kit").SolidPaths; lit: boolean; bind: (node: SVGGElement | null) => void; children: React.ReactNode }) {
  return (
    <g ref={bind} className="iso-solid" data-lit={lit ? "" : undefined}>
      <SolidPaths paths={paths} tone="mid" crease="faint">
        {children}
      </SolidPaths>
    </g>
  );
}

/** Los trazos de un Solid sin su g (para poder poner la ref y el acento en el g). */
function SolidPaths({ paths, tone, crease = "faint", children }: { paths: import("../../iso/iso-kit").SolidPaths; tone: "hi" | "mid" | "lo"; crease?: "faint" | "lo"; children?: React.ReactNode }) {
  return (
    <>
      <path className="iso-fill" d={paths.fill} />
      {paths.shades.map((d, shade) => (d ? <path key={shade} className="iso-shade" data-shade={shade} d={d} /> : null))}
      <path className="iso-top" d={paths.top} />
      {paths.crease ? <path className="iso-line iso-crease" data-tone={crease} d={paths.crease} /> : null}
      {paths.bevel ? <path className="iso-line iso-bevel" data-tone={crease} d={paths.bevel} /> : null}
      <path className="iso-line iso-edge" data-tone={tone} d={paths.outline} />
      {children}
    </>
  );
}
