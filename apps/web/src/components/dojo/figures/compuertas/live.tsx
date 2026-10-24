"use client";

// La parte viva de la clasificadora: un solo bucle que pide al modelo el estado
// del instante t y lo escribe en el SVG por refs (sin re-render por cuadro).
// React solo vuelve a pintar cuando cambia la ficha en curso: textos de la cola,
// fichas que ya reposan en los cajones y, en f-decidir, las placas del juego.

import * as React from "react";
import { axisVector, type SolidPaths } from "../../iso/iso-kit";
import { IsoFigure, Line, Solid } from "../../iso/react/draw";
import { useInView, useLoop, useReadout } from "../../iso/react/live";
import { artOf, type Art } from "./art";
import { doorsAt, SIGN_CHARS } from "./geometry";
import { durationOf, finalReadout, restsOf, stateAt, type MachineState } from "./model";
import {
  BLADE_LIFT,
  CHUTE_X,
  COIN_BIN_Z,
  COIN_TRACK_Z,
  FLOOR_Z,
  QUEUE_GAP,
  R,
  SLOTS,
  WIDTH,
} from "./view";

const TOUR_FIRST = 1.4; // s en pantalla antes de soltar la primera ficha
const IDLE = 3600; // ms sin tocar antes de que el recorrido siga solo
const HOP_ARC = 4;
const RIGHT_DOOR_SWAP = 0.35; // desde aquí la hoja derecha queda delante de la ficha
const DOT_COUNT = 12;

const tenth = (v: number) => Math.round(v * 100) / 100;
/** Lo que cabe en la tarjeta de un cajón. */
const CARD_CHARS = 12;
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

function translate(art: Art, x: number, y: number, z: number) {
  const [dx, dy] = axisVector(art.L.P, [x, y, z]);
  return `translate(${tenth(dx)} ${tenth(dy)})`;
}

/** Escribe los caminos de un sólido que cambia de forma (las trampillas). */
function paint(g: SVGGElement | null, p: SolidPaths) {
  if (!g) return;
  g.querySelector(".iso-fill")?.setAttribute("d", p.fill);
  g.querySelectorAll<SVGPathElement>(".iso-shade").forEach((node) => node.setAttribute("d", p.shades[Number(node.dataset.shade)] ?? ""));
  g.querySelector(".iso-top")?.setAttribute("d", p.top);
  g.querySelector(".iso-crease")?.setAttribute("d", p.crease);
  g.querySelector(".iso-edge")?.setAttribute("d", p.outline);
}

/** Un sólido con sus cuatro capas siempre presentes, para reescribirlas en vivo. */
const LiveSolid = React.forwardRef<SVGGElement, { paths: SolidPaths; tone?: "hi" | "mid" | "lo"; style?: React.CSSProperties }>(
  function LiveSolid({ paths, tone = "mid", style }, ref) {
    return (
      <g ref={ref} className="iso-solid" style={style}>
        <path className="iso-fill" d={paths.fill} />
        {[0, 1, 2, 3].map((shade) => (
          <path key={shade} className="iso-shade" data-shade={shade} d={paths.shades[shade] ?? ""} />
        ))}
        <path className="iso-top" d={paths.top} />
        <path className="iso-line iso-crease" data-tone="faint" d={paths.crease} />
        <path className="iso-line iso-edge" data-tone={tone} d={paths.outline} />
      </g>
    );
  },
);

/** Puntos del canto grabados en la cara: giran con la ficha y dejan ver que rueda. */
const DOTS = Array.from({ length: DOT_COUNT }, (_, i) => {
  const a = (i / DOT_COUNT) * Math.PI * 2;
  return [tenth(Math.cos(a) * (R - 3.4)), tenth(Math.sin(a) * (R - 3.4))] as const;
});

/** Letra de la cara según el largo del valor (un año de 4 cifras también cabe). */
const coinFont = (label: string) => (label.length <= 2 ? 9 : label.length === 3 ? 7.2 : label.length === 4 ? 5.6 : 4.4);

function CoinArt({ art, label, spin, dim = false }: { art: Art; label: string; spin?: React.Ref<SVGGElement>; dim?: boolean }) {
  return (
    <g className="cp-coin" data-dim={dim ? "" : undefined}>
      <Solid paths={art.M.coin.body} tone="hi" crease="lo" />
      <Line d={art.M.coin.rim} tone="lo" />
      <g transform={art.M.coin.face}>
        <g ref={spin}>
          {DOTS.map(([x, y], i) => (
            <circle key={i} className="cp-coin-dot" cx={x} cy={y} r={0.5} />
          ))}
          <text className="iso-face-text cp-coin-value" data-tone="hi" fontSize={coinFont(label)} textAnchor="middle" dy={coinFont(label) * 0.34}>
            {label}
          </text>
        </g>
      </g>
    </g>
  );
}

interface Sim {
  index: number;
  t: number;
  /** Segundos de espera antes de soltar la primera ficha. */
  wait: number;
  paused: boolean;
  lastInput: number;
  doors: number[];
  slot: number; // -1 = canal, i = cajón i
  /** En vivo: tramo animado entre el instante del paso anterior y el del actual. */
  from: number;
  to: number;
  dur: number;
  elapsed: number;
}

/** Lo que manda el modo en vivo: el instante del guion de ESTE paso y su readout. */
export interface LiveTarget {
  t: number;
  readout: string;
  coin: string;
  /** Cajón donde DEBÍA caer (se marca punteado cuando cayó en otro). */
  want: number | null;
}

const smoothstep = (v: number) => {
  const u = Math.min(1, Math.max(0, v));
  return u * u * (3 - 2 * u);
};

export function CompuertasLive({ id, reveal }: { id: string; reveal: boolean }) {
  return <CompuertasMachine art={artOf(id)} reveal={reveal} />;
}

/**
 * La máquina. Con `live`, el padre (el reproductor de la traza) decide en qué
 * instante está: aquí solo se anima suave hasta él (70–450 ms) y se escribe el
 * readout del paso. Sin `live`, es el recorrido guionado por los ejemplos.
 */
export function CompuertasMachine({ art, reveal, live }: { art: Art; reveal: boolean; live?: LiveTarget }) {
  const { lesson, L, M } = art;
  const count = lesson.examples.length;
  const [index, setIndex] = React.useState(0);
  const [paused, setPaused] = React.useState(false);
  const { anchor, say } = useReadout<HTMLDivElement>();
  const visible = useInView(anchor);
  const sim = React.useRef<Sim>({
    index: 0,
    t: live ? live.t : 0,
    wait: live ? 0 : TOUR_FIRST,
    paused: false,
    lastInput: -Infinity,
    doors: [],
    slot: -1,
    from: live ? live.t : 0,
    to: live ? live.t : 0,
    dur: 0,
    elapsed: 0,
  });
  const liveRef = React.useRef(live);
  liveRef.current = live;

  const coinSlots = React.useRef<(SVGGElement | null)[]>([]);
  const spins = React.useRef<(SVGGElement | null)[]>([]);
  const queue = React.useRef<(SVGGElement | null)[]>([]);
  const doorLeft = React.useRef<(SVGGElement | null)[]>([]);
  const doorRightBack = React.useRef<(SVGGElement | null)[]>([]);
  const doorRightFront = React.useRef<(SVGGElement | null)[]>([]);
  const blades = React.useRef<(SVGGElement | null)[]>([]);
  const lamps = React.useRef<(SVGGElement | null)[]>([]);

  const example = lesson.examples[index];
  const branches = lesson.groups[example.group];
  const rests = React.useMemo(() => restsOf(lesson, index), [lesson, index]);
  const next = (k: number) => lesson.examples[(index + k) % count];

  const draw = React.useCallback(
    (state: MachineState) => {
      const s = sim.current;
      const ex = lesson.examples[s.index];
      const target = restsOf(lesson, s.index).current;
      const binX = L.binX[ex.bin];
      // Posición de la ficha: a lo largo del canal, cayendo y acomodándose.
      let x = state.along * (L.binX[1] - L.binX[0]);
      let y = 0;
      let z = COIN_TRACK_Z + QUEUE_GAP * (1 - state.drop);
      if (state.fall > 0) z = COIN_TRACK_Z - (COIN_TRACK_Z - COIN_BIN_Z) * state.fall * state.fall;
      const spin = ((x - CHUTE_X) / R) * (180 / Math.PI);
      if (state.hop > 0) {
        const [sx, sy] = SLOTS[target.slot];
        x = binX + sx * state.hop;
        y = sy * state.hop;
        z = COIN_BIN_Z + HOP_ARC * Math.sin(Math.PI * state.hop);
      }
      // Capa de pintor: en el canal hasta que la ficha queda bajo el piso o pasa el borde.
      const inBin = state.hop > 0 || (state.fall > 0 && (z + R < FLOOR_Z || x - R > L.edgeX + 6));
      const slot = inBin ? ex.bin : -1;
      coinSlots.current.forEach((node, i) => {
        if (!node) return;
        const mine = i - 1 === slot;
        node.style.display = mine ? "" : "none";
      });
      const active = coinSlots.current[slot + 1];
      active?.setAttribute("transform", translate(art, x, y, z));
      spins.current[slot + 1]?.setAttribute("transform", `rotate(${tenth(spin % 360)})`);
      // La cola del tubo baja un lugar al soltar cada ficha; la de arriba aparece por la boca.
      queue.current.forEach((node, k) => {
        if (!node) return;
        node.setAttribute("transform", translate(art, CHUTE_X, 0, COIN_TRACK_Z + QUEUE_GAP * (k + 2 - state.drop)));
        if (k === 1) node.style.opacity = `${tenth(state.drop)}`;
      });
      // Trampillas (solo se reconstruyen si cambian).
      state.doors.forEach((open, g) => {
        if (s.doors[g] === open) return;
        s.doors[g] = open;
        const [left, right] = doorsAt(L, L.binX[g], open);
        paint(doorLeft.current[g], left);
        paint(doorRightBack.current[g], right);
        paint(doorRightFront.current[g], right);
        const front = open > RIGHT_DOOR_SWAP;
        const back = doorRightBack.current[g];
        const fore = doorRightFront.current[g];
        if (back) back.style.display = front ? "none" : "";
        if (fore) fore.style.display = front ? "" : "none";
      });
      state.blades.forEach((lift, g) => {
        blades.current[g]?.setAttribute("transform", translate(art, 0, 0, BLADE_LIFT * lift));
      });
      state.lamps.forEach((lamp, i) => {
        const node = lamps.current[i];
        if (node && node.dataset.state !== lamp) node.dataset.state = lamp;
      });
      say(liveRef.current ? liveRef.current.readout : state.readout);
    },
    [art, lesson, L, say],
  );

  const tick = React.useCallback(
    (dt: number, calm: boolean) => {
      const s = sim.current;
      const ex = lesson.examples[s.index];
      const dur = durationOf(lesson, ex);
      if (liveRef.current) {
        // En vivo: se anima hacia el instante del paso; el reproductor manda.
        s.elapsed += dt;
        s.t = calm || s.dur === 0 ? s.to : s.from + (s.to - s.from) * smoothstep(s.elapsed / s.dur);
        draw(stateAt(lesson, s.index, s.t, true));
        return !calm && s.elapsed < s.dur;
      }
      if (calm) {
        // Movimiento reducido: cada ficha se ve ya en su cajón; las teclas siguen funcionando.
        s.t = dur;
        draw(stateAt(lesson, s.index, s.t, reveal));
        return false;
      }
      if (s.paused) {
        draw(stateAt(lesson, s.index, s.t, reveal));
        return false;
      }
      if (s.wait > 0) s.wait = Math.max(0, s.wait - dt);
      else s.t = Math.min(dur, s.t + dt);
      draw(stateAt(lesson, s.index, s.t, reveal));
      if (s.t >= dur && performance.now() - s.lastInput > IDLE) {
        // Siguiente ficha del recorrido.
        s.index = (s.index + 1) % count;
        s.t = 0;
        setIndex(s.index);
      }
      return true;
    },
    [count, draw, lesson, reveal],
  );

  const kick = useLoop(tick, visible);

  // Paso nuevo en vivo: tramo de 70 a 450 ms según cuánto avanza el guion.
  const liveT = live?.t;
  React.useEffect(() => {
    if (liveT === undefined) return;
    const s = sim.current;
    s.from = s.t;
    s.to = liveT;
    s.elapsed = 0;
    s.dur = Math.min(0.45, Math.max(0.07, Math.abs(liveT - s.t) * 0.3));
    kick();
  }, [liveT, kick]);

  // Costura de QA (solo lectura del modelo): congela la máquina en una ficha y un
  // instante exactos para las capturas. No cambia nada que el lector vea por sí solo.
  React.useEffect(() => {
    const node = anchor.current as (HTMLDivElement & { __cpSeek?: (i: number, t: number) => void }) | null;
    if (!node) return;
    node.__cpSeek = (i: number, t: number) => {
      const s = sim.current;
      s.index = ((i % count) + count) % count;
      s.t = t;
      s.wait = 0;
      s.paused = true;
      setPaused(true);
      setIndex(s.index);
      draw(stateAt(lesson, s.index, s.t, reveal));
    };
    return () => {
      delete node.__cpSeek;
    };
  }, [anchor, count, draw, lesson, reveal]);

  // Al cambiar de ficha (recorrido, teclas, clic) se repinta con el estado nuevo.
  React.useLayoutEffect(() => {
    draw(stateAt(lesson, sim.current.index, sim.current.t, reveal));
  }, [index, draw, lesson, reveal]);

  const go = (to: number) => {
    const s = sim.current;
    s.index = ((to % count) + count) % count;
    s.t = 0;
    s.wait = 0;
    s.paused = false;
    s.lastInput = performance.now();
    setPaused(false);
    setIndex(s.index);
    kick();
  };

  const toggle = () => {
    const s = sim.current;
    s.paused = !s.paused;
    s.lastInput = performance.now();
    setPaused(s.paused);
    kick();
  };

  const spoken = `${finalReadout(lesson, index)}${paused ? " · en pausa" : ""}`;
  // En vivo el reproductor de la traza tiene las teclas y los botones: la máquina solo muestra.
  const interactive = !live;

  return (
    <div
      ref={anchor}
      className="cp"
      data-live={live ? "" : undefined}
      role={interactive ? "slider" : "img"}
      tabIndex={interactive ? 0 : undefined}
      aria-label={
        interactive
          ? "Clasificadora de fichas: cada ficha rueda por un canal y la primera compuerta cuya condición se cumple la deja caer en su cajón. Flechas izquierda y derecha cambian de ficha, espacio pausa o sigue, clic pasa a la siguiente."
          : `Tu código como clasificadora: ${live?.readout ?? ""}`
      }
      aria-valuemin={interactive ? 1 : undefined}
      aria-valuemax={interactive ? count : undefined}
      aria-valuenow={interactive ? index + 1 : undefined}
      aria-valuetext={interactive ? spoken : undefined}
      data-paused={paused ? "" : undefined}
      onClick={interactive ? () => go(sim.current.index + 1) : undefined}
      onKeyDown={(event) => {
        if (!interactive) return;
        if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
          event.preventDefault();
          event.stopPropagation();
          go(sim.current.index + (event.key === "ArrowRight" ? 1 : -1));
        } else if (event.key === " " || event.key === "Spacebar") {
          event.preventDefault();
          event.stopPropagation();
          if (!event.repeat) toggle();
        }
      }}
    >
      <IsoFigure width={WIDTH} height={L.height} label={labelOf(art, reveal)}>
        {art.base}
        {art.panel}
        <g key="signs">
          {M.signs.map((sign, i) =>
            reveal ? (
              <g key={i}>
                <Solid paths={sign.plate} tone="mid" />
                <g
                  ref={(node) => {
                    lamps.current[i] = node;
                  }}
                  className="cp-lamp"
                  data-state="off"
                >
                  <path className="cp-glow" d={sign.lampRing} />
                  <Line d={sign.lampRing} tone="faint" />
                  <Solid paths={sign.lamp} tone="lo" crease="none" />
                </g>
                <text className="iso-face-text cp-plate" data-tone="hi" transform={sign.text} fontSize={sign.font}>
                  {clip(branches[i].plate, SIGN_CHARS)}
                </text>
              </g>
            ) : (
              <g key={i}>
                <Solid paths={sign.cover} tone="mid" />
                <Dotted points={sign.coverScrews} />
              </g>
            ),
          )}
        </g>
        {art.arms}
        {art.chuteBack}
        {art.trackBack}
        <g key="doors-back">
          {M.gates.map((_, g) => {
            const [left, right] = doorsAt(L, L.binX[g], 0);
            return (
              <g key={g}>
                <LiveSolid
                  ref={(node) => {
                    doorLeft.current[g] = node;
                  }}
                  paths={left}
                />
                <LiveSolid
                  ref={(node) => {
                    doorRightBack.current[g] = node;
                  }}
                  paths={right}
                />
              </g>
            );
          })}
        </g>
        {L.binX.map((bx, b) => (
          <g key={`bin-${b}`}>
            {art.binBack[b]}
            {rests.before
              .filter((r) => r.bin === b && r.slot === 1)
              .map((r) => (
                <g key={r.example} transform={translate(art, bx + SLOTS[1][0], SLOTS[1][1], COIN_BIN_Z)}>
                  <CoinArt art={art} label={String(lesson.examples[r.example].value)} />
                </g>
              ))}
            <g
              ref={(node) => {
                coinSlots.current[b + 1] = node;
              }}
              style={{ display: "none" }}
            >
              <CoinArt
                art={art}
                label={live ? live.coin : String(example.value)}
                spin={(node) => {
                  spins.current[b + 1] = node;
                }}
              />
            </g>
            {rests.before
              .filter((r) => r.bin === b && r.slot !== 1)
              .map((r) => (
                <g key={r.example} transform={translate(art, bx + SLOTS[r.slot][0], SLOTS[r.slot][1], COIN_BIN_Z)}>
                  <CoinArt art={art} label={String(lesson.examples[r.example].value)} />
                </g>
              ))}
            {art.binRight[b]}
            {art.binFront[b]}
            {live?.want === b ? <Line d={M.bins[b].want} tone="hi" dotted className="cp-want" /> : null}
            <text className="iso-face-text cp-card" data-tone="hi" transform={M.bins[b].card} fontSize={6} textAnchor="middle">
              {clip(branches[b].card, CARD_CHARS)}
            </text>
          </g>
        ))}
        {art.floors}
        <g key="queue" style={live ? { display: "none" } : undefined}>
          {[1, 2].map((k) => (
            <g
              key={k}
              ref={(node) => {
                queue.current[k - 1] = node;
              }}
              transform={translate(art, CHUTE_X, 0, COIN_TRACK_Z + QUEUE_GAP * (k + 1))}
            >
              <CoinArt art={art} label={String(next(k).value)} dim />
            </g>
          ))}
        </g>
        <g
          ref={(node) => {
            coinSlots.current[0] = node;
          }}
          transform={translate(art, CHUTE_X, 0, COIN_TRACK_Z + QUEUE_GAP)}
        >
          <CoinArt
            art={art}
            label={live ? live.coin : String(example.value)}
            spin={(node) => {
              spins.current[0] = node;
            }}
          />
        </g>
        <g key="doors-front">
          {M.gates.map((_, g) => (
            <LiveSolid
              key={g}
              ref={(node) => {
                doorRightFront.current[g] = node;
              }}
              paths={doorsAt(L, L.binX[g], 0)[1]}
              style={{ display: "none" }}
            />
          ))}
        </g>
        <g key="blades">
          {M.gates.map((gate, g) => (
            <g
              key={g}
              ref={(node) => {
                blades.current[g] = node;
              }}
            >
              <Solid paths={gate.blade} tone="hi" />
              <Solid paths={gate.bladeGrip} tone="mid" />
            </g>
          ))}
        </g>
        {art.gatesFront}
        {art.frontLip}
        {reveal ? null : art.hood}
        {art.chuteFront}
      </IsoFigure>
    </div>
  );
}

function Dotted({ points }: { points: [number, number][] }) {
  return (
    <g className="iso-dots" data-tone="mid">
      {points.map(([x, y], i) => (
        <circle key={i} cx={tenth(x)} cy={tenth(y)} r={0.5} />
      ))}
    </g>
  );
}

function labelOf(art: Art, reveal: boolean) {
  const { lesson } = art;
  const cards = lesson.groups[0].map((b) => b.card).join(", ");
  if (!reveal) {
    return `Clasificadora de fichas con ${lesson.bins} cajones (${cards}). Una ficha con su número rueda por un canal tapado por una capota con candado y cae en el cajón que le corresponde; las condiciones de las compuertas están tapadas hasta que resuelvas el ejercicio.`;
  }
  const plates = lesson.groups[0].map((b) => b.plate).join(", luego ");
  return `Clasificadora de fichas: la ficha rueda por un canal y se detiene en cada compuerta, en orden (${plates}). La primera cuya condición se cumple enciende su lámpara y abre su trampilla, y la ficha cae a ese cajón (${cards}); si es falsa, la compuerta se levanta y la ficha sigue.`;
}

