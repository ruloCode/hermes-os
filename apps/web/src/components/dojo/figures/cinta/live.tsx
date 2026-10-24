"use client";

// La cinta viva: un solo reloj por figura. Del modelo sale, para (ejemplo,
// tiempo), dónde está cada ficha, la trampa, el sello y el readout; aquí solo
// se escriben atributos por ref (nada de re-render por cuadro). Recorre los
// ejemplos sola; ← → cambian de ejemplo, Espacio pausa, clic = el siguiente.
//
// En vivo (`live`) el cuadro sale de la traza del alumno (trace.ts) en el paso
// que pida el reproductor del Dojo, y las piezas lo SIGUEN con un suavizado
// exponencial: entre pasos (70–450 ms) la cinta avanza y las fichas viajan.
import * as React from "react";
import { FaceText, IsoFigure } from "../../iso/react/draw";
import { asksForStillness, useInView, useLoop, useReadout } from "../../iso/react/live";
import {
  ARCH_FRONT,
  BASES,
  BELT_BACK,
  BIN_BACK,
  BIN_FRONT,
  BRIDGE,
  COUNTER,
  CRANK_BACK,
  FRONT_RAIL,
  HOPPER,
  INLET_TO_COUNTER,
  INLET_TO_PEDESTAL,
  KNUCKLES,
  PEDESTAL,
  PRESS_BACK,
  PRESS_FRONT,
  RACK,
  RAM,
  TRAY_BACK,
  TRAY_FRONT,
  WINDOW_RECESS,
  hoodArt,
} from "./art";
import { ARCH_ART, BELT_ART, COUNTER_FACE, DRUM_FACE, DRUM_W, HOOD_BEST, HOOD_COUNTER, HOOD_PRESS, TOKEN_ART, crankFrame, flapFrame, tokenFont } from "./geometry";
import { durationOf, momentOf, orderOf, readoutOf, spokenOf, type Spec } from "./model";
import { liveMomentOf, type LiveAnalysis } from "./trace";
import { HEIGHT, PITCH, RAM_DROP, WIDTH, centerFor, offset } from "./view";
import { Solid } from "../../iso/react/draw";
import type { SolidPaths } from "../../iso/iso-kit";

const HOOD_COUNTER_ART = hoodArt(HOOD_COUNTER, "hood-counter");
const HOOD_BEST_ART = hoodArt(HOOD_BEST, "hood-best");
const HOOD_PRESS_ART = hoodArt(HOOD_PRESS, "hood-press");

/** Una pieza cuyo dibujo cambia por cuadro: refs a su relleno, tonos y borde. */
interface LivePaths {
  fill: SVGPathElement | null;
  shades: (SVGPathElement | null)[];
  top: SVGPathElement | null;
  crease: SVGPathElement | null;
  edge: SVGPathElement | null;
}
const emptyPaths = (): LivePaths => ({ fill: null, shades: [null, null, null, null], top: null, crease: null, edge: null });

function LiveSolid({ paths, slot, tone = "mid" }: { paths: SolidPaths; slot: React.MutableRefObject<LivePaths>; tone?: "hi" | "mid" | "lo" }) {
  return (
    <g className="iso-solid">
      <path ref={(n) => void (slot.current.fill = n)} className="iso-fill" d={paths.fill} />
      {[0, 1, 2, 3].map((i) => (
        <path key={i} ref={(n) => void (slot.current.shades[i] = n)} className="iso-shade" data-shade={i} d={paths.shades[i] ?? ""} />
      ))}
      <path ref={(n) => void (slot.current.top = n)} className="iso-top" d={paths.top} />
      <path ref={(n) => void (slot.current.crease = n)} className="iso-line iso-crease" data-tone="faint" d={paths.crease} />
      <path ref={(n) => void (slot.current.edge = n)} className="iso-line iso-edge" data-tone={tone} d={paths.outline} />
    </g>
  );
}

function writePaths(slot: LivePaths, paths: SolidPaths) {
  slot.fill?.setAttribute("d", paths.fill);
  paths.shades.forEach((d, i) => slot.shades[i]?.setAttribute("d", d ?? ""));
  slot.top?.setAttribute("d", paths.top);
  slot.crease?.setAttribute("d", paths.crease);
  slot.edge?.setAttribute("d", paths.outline);
}

interface TokenNodes {
  group: SVGGElement | null;
  solid: SVGGElement | null;
  text: SVGTextElement | null;
  shown: { transform: string; alpha: string; text: string; lit: boolean };
}

const DRUM_TEXT = 8;
const NEXT = ["ArrowRight", "ArrowLeft", " "];

/** Lo que tarda una pieza en llegar a su lugar en vivo (constante de tiempo). */
const FOLLOW = 0.085;

interface Shown {
  x: number;
  y: number;
  z: number;
  alpha: number;
}

export function CintaLive({
  spec,
  reveal,
  label,
  live,
  step = 0,
}: {
  spec: Spec;
  reveal: boolean;
  label: string;
  /** Traza del alumno ya analizada: la máquina pinta SU ejecución. */
  live?: LiveAnalysis | null;
  /** Paso de la traza que se está mirando. */
  step?: number;
}) {
  const { anchor, say } = useReadout<HTMLDivElement>();
  const root = React.useRef<HTMLDivElement | null>(null);
  const clipId = React.useId().replace(/:/g, "");
  const station = live ? live.layout : spec.station;
  const counts = spec.examples.map((example) => example.items.length);
  const slots = live ? live.slots : Math.max(1, ...counts);
  const showCounter = (reveal || Boolean(live)) && (station === "sum" || station === "count");
  const liveRef = React.useRef(live ?? null);
  liveRef.current = live ?? null;
  const stepRef = React.useRef(step);
  stepRef.current = step;
  const shown = React.useRef<(Shown | null)[]>([]);
  const shownBelt = React.useRef<number | null>(null);
  const shownFlap = React.useRef(0);
  const shownRam = React.useRef(0);

  const tokens = React.useRef<TokenNodes[]>([]);
  const flap = React.useRef<LivePaths>(emptyPaths());
  const handle = React.useRef<LivePaths>(emptyPaths());
  const spokes = React.useRef<SVGPathElement | null>(null);
  const cleats = React.useRef<SVGGElement | null>(null);
  const ram = React.useRef<SVGGElement | null>(null);
  const lens = React.useRef<SVGGElement | null>(null);
  const drums = React.useRef<(SVGTextElement | null)[]>([]);
  const drumPos = React.useRef<number[]>([0, 0, 0]);
  const announce = React.useRef<HTMLSpanElement | null>(null);

  const example = React.useRef(0);
  const clock = React.useRef(0);
  const paused = React.useRef(false);
  const [shownExample, setShownExample] = React.useState(0);
  const lastFlap = React.useRef(-1);
  const lastBelt = React.useRef(Number.NaN);

  const visible = useInView(root);

  const draw = React.useCallback(
    (dt: number, calm: boolean) => {
      const ex = spec.examples[example.current]!;
      const traced = liveRef.current;
      const m = traced ? liveMomentOf(traced, stepRef.current) : momentOf(station, ex, clock.current);
      // En vivo las piezas siguen al paso; en el guion el modelo ya es continuo.
      let moving = false;
      const ease = traced && !calm ? 1 - Math.exp(-dt / FOLLOW) : 1;
      const follow = (from: number, to: number) => {
        if (ease >= 1 || Math.abs(to - from) < 0.02) return to;
        moving = true;
        return from + (to - from) * ease;
      };
      const tokenPoses = m.tokens.map((target, i) => {
        const was = shown.current[i];
        const next = was
          ? { x: follow(was.x, target.x), y: follow(was.y, target.y), z: follow(was.z, target.z), alpha: follow(was.alpha, target.alpha) }
          : { x: target.x, y: target.y, z: target.z, alpha: target.alpha };
        shown.current[i] = next;
        return { ...target, ...next };
      });
      const belt = (shownBelt.current = shownBelt.current === null ? m.belt : follow(shownBelt.current, m.belt));
      const flapNow = (shownFlap.current = follow(shownFlap.current, m.flap));
      const ramNow = (shownRam.current = follow(shownRam.current, m.ram));
      // Fichas.
      tokens.current.forEach((node, i) => {
        if (!node.group) return;
        const pose = tokenPoses[i];
        const alpha = pose ? `${Math.round(pose.alpha * 100) / 100}` : "0";
        if (alpha !== node.shown.alpha) {
          node.group.style.opacity = alpha;
          node.shown.alpha = alpha;
        }
        if (!pose) return;
        const transform = offset(pose.x, pose.y, pose.z);
        if (transform !== node.shown.transform) {
          node.group.setAttribute("transform", transform);
          node.shown.transform = transform;
        }
        if (pose.text !== node.shown.text && node.text) {
          node.text.textContent = pose.text;
          const size = tokenFont(pose.text);
          node.text.setAttribute("font-size", `${Math.round(size * 100) / 100}`);
          node.text.setAttribute("y", `${Math.round(size * 36) / 100}`);
          node.shown.text = pose.text;
        }
        if (pose.lit !== node.shown.lit && node.solid) {
          if (pose.lit) node.solid.dataset.lit = "";
          else delete node.solid.dataset.lit;
          node.text?.setAttribute("data-tone", pose.lit ? "hi" : "mid");
          node.shown.lit = pose.lit;
        }
      });
      // Banda, manivela, trampa, sello y lector.
      if (belt !== lastBelt.current) {
        lastBelt.current = belt;
        const travel = belt * PITCH;
        const step = PITCH / 2;
        const phase = (((travel % step) + step) % step) / step;
        cleats.current?.setAttribute("transform", `translate(${(BELT_ART.step[0] * phase).toFixed(2)} ${(BELT_ART.step[1] * phase).toFixed(2)})`);
        const crank = crankFrame(-belt * Math.PI * 2);
        spokes.current?.setAttribute("d", crank.spokes);
        writePaths(handle.current, crank.handle);
      }
      if (flapNow !== lastFlap.current && flap.current.fill) {
        lastFlap.current = flapNow;
        writePaths(flap.current, flapFrame(flapNow));
      }
      ram.current?.setAttribute("transform", offset(0, 0, -RAM_DROP * ramNow));
      const glass = lens.current?.firstElementChild as SVGGElement | null | undefined;
      if (glass) {
        if (m.lamp) glass.dataset.lit = "";
        else delete glass.dataset.lit;
      }
      // Tambores del contador: ruedan siempre hacia adelante, como un odómetro.
      if (showCounter) {
        const value = Math.abs(m.acc ?? 0) % 1000;
        const digits = [Math.floor(value / 100) % 10, Math.floor(value / 10) % 10, value % 10];
        digits.forEach((digit, i) => {
          const at = drumPos.current[i]!;
          const ahead = (((digit - at) % 10) + 10) % 10;
          let next = at;
          if (ahead > 0.002) {
            next = calm ? digit : at + ahead * (1 - Math.exp(-dt / 0.1)) + Math.min(ahead, dt * 1.2);
            if ((((digit - next) % 10) + 10) % 10 > 9.5 || ahead < 0.01) next = digit;
            moving = true;
          }
          next = ((next % 10) + 10) % 10;
          drumPos.current[i] = next;
          const base = Math.floor(next + 1e-6);
          const frac = next - base;
          const a = drums.current[i * 2];
          const b = drums.current[i * 2 + 1];
          const center = DRUM_FACE.v0 + DRUM_FACE.h / 2 + DRUM_TEXT * 0.36;
          if (a) {
            a.textContent = String(base % 10);
            a.setAttribute("y", (center - frac * DRUM_FACE.h).toFixed(2));
          }
          if (b) {
            b.textContent = String((base + 1) % 10);
            b.setAttribute("y", (center + (1 - frac) * DRUM_FACE.h).toFixed(2));
          }
        });
      }
      say("readout" in m ? m.readout : readoutOf(spec, ex, m, reveal) + (paused.current && !calm ? " · pausa" : ""));
      return moving;
    },
    [reveal, say, showCounter, spec, station],
  );

  const goTo = React.useCallback(
    (index: number) => {
      const count = spec.examples.length;
      example.current = ((index % count) + count) % count;
      clock.current = asksForStillness() ? durationOf(station, spec.examples[example.current]!.items.length) : 0;
      setShownExample(example.current);
      if (announce.current) announce.current.textContent = spokenOf(spec, example.current);
    },
    [spec, station],
  );

  const kick = useLoop((dt, calm) => {
    if (liveRef.current) return draw(dt, calm);
    const ex = spec.examples[example.current]!;
    const length = durationOf(station, ex.items.length);
    if (calm) {
      clock.current = length;
      draw(dt, true);
      return false;
    }
    if (!paused.current) {
      clock.current += dt;
      if (clock.current >= length) {
        goTo(example.current + 1);
      }
    }
    const moving = draw(dt, false);
    return !paused.current || moving;
  }, visible);

  // Primer cuadro (y el cuadro quieto con movimiento reducido).
  React.useLayoutEffect(() => {
    if (liveRef.current) return;
    if (asksForStillness()) clock.current = durationOf(station, spec.examples[example.current]!.items.length);
    draw(1, true);
  }, [draw, spec, station]);

  // En vivo: el primer paso se pinta en su lugar; cada paso nuevo despierta el bucle.
  React.useLayoutEffect(() => {
    if (!live) return;
    shown.current = [];
    shownBelt.current = null;
    draw(1, true);
  }, [live, draw]);
  React.useEffect(() => {
    if (!live) return;
    if (asksForStillness()) draw(1, true);
    else kick();
  }, [live, step, draw, kick]);

  const go = (by: number) => {
    goTo(example.current + by);
    if (asksForStillness()) draw(1, true);
    kick();
  };

  const order = orderOf(spec.examples[shownExample]!);
  /** En vivo no hay tapa: es tu código, el mecanismo eres tú. */
  const open = reveal || Boolean(live);

  return (
    <div
      ref={(node) => {
        root.current = node;
        anchor.current = node;
      }}
      className="cinta-live"
      data-mode={live ? "live" : undefined}
      role="group"
      tabIndex={live ? undefined : 0}
      aria-roledescription="figura interactiva"
      aria-label={live ? label : `${label} Flechas izquierda y derecha: otro ejemplo. Espacio: pausa. Clic: el siguiente ejemplo.`}
      onClick={live ? undefined : () => go(1)}
      onKeyDown={(event) => {
        if (live || !NEXT.includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.key === " ") {
          if (event.repeat) return;
          paused.current = !paused.current;
          if (asksForStillness()) return;
          kick();
          if (paused.current) draw(0, false);
          return;
        }
        go(event.key === "ArrowRight" ? 1 : -1);
      }}
    >
      <span ref={announce} className="cinta-sr" aria-live="polite" />
      <IsoFigure width={WIDTH} height={HEIGHT} label={label}>
        <defs>
          <clipPath id={`${clipId}-belt`}>
            <path d={BELT_ART.clip} />
          </clipPath>
          <clipPath id={`${clipId}-drums`}>
            <rect x={DRUM_FACE.u0} y={DRUM_FACE.v0} width={DRUM_FACE.w} height={DRUM_FACE.h} />
          </clipPath>
        </defs>
        <g transform={centerFor(station)}>
        {BASES[station]}
        {BELT_BACK}
        <g clipPath={`url(#${clipId}-belt)`}>
          <g ref={cleats}>
            <path className="iso-line" data-tone="lo" d={BELT_ART.cleats} />
          </g>
        </g>
        {FRONT_RAIL}
        {station === "sum" ? (
          <g key="sum-station">
            {BRIDGE}
            {open ? INLET_TO_COUNTER.back : null}
            {open ? COUNTER : null}
          </g>
        ) : null}
        {station === "count" || station === "best" ? (
          <g key="trap-station">
            {BIN_BACK}
            <LiveSolid paths={flapFrame(0)} slot={flap} />
            {KNUCKLES}
            {station === "count" && open ? INLET_TO_COUNTER.back : null}
            {station === "count" && open ? COUNTER : null}
            {station === "best" && open ? INLET_TO_PEDESTAL.back : null}
            {station === "best" && open ? PEDESTAL : null}
            {station === "best" && open ? TRAY_BACK : null}
          </g>
        ) : null}
        {station === "stamp" ? (
          <g key="stamp-station">
            {open ? PRESS_BACK : null}
            {RACK}
          </g>
        ) : null}
        {showCounter ? (
          <g key="drums" transform={COUNTER_FACE}>
            <g clipPath={`url(#${clipId}-drums)`}>
              {[0, 1, 2].map((i) => (
                <g key={i}>
                  <rect className="cinta-drum" x={DRUM_FACE.u0 + DRUM_W * i + 0.3} y={DRUM_FACE.v0} width={DRUM_W - 0.6} height={DRUM_FACE.h} />
                  <rect className="iso-shade" data-shade="0" x={DRUM_FACE.u0 + DRUM_W * i + 0.3} y={DRUM_FACE.v0} width={DRUM_W - 0.6} height={1.6} />
                  <rect className="iso-shade" data-shade="1" x={DRUM_FACE.u0 + DRUM_W * i + 0.3} y={DRUM_FACE.v0 + 1.6} width={DRUM_W - 0.6} height={1.4} />
                  <rect className="iso-shade" data-shade="1" x={DRUM_FACE.u0 + DRUM_W * i + 0.3} y={DRUM_FACE.v0 + DRUM_FACE.h - 2} width={DRUM_W - 0.6} height={2} />
                  {[0, 1].map((k) => (
                    <text
                      key={k}
                      ref={(n) => void (drums.current[i * 2 + k] = n)}
                      className="iso-face-text cinta-digit"
                      data-tone="hi"
                      x={DRUM_FACE.u0 + DRUM_W * (i + 0.5)}
                      y={DRUM_FACE.v0 + DRUM_FACE.h / 2 + DRUM_TEXT * 0.36 + k * DRUM_FACE.h}
                      fontSize={DRUM_TEXT}
                      textAnchor="middle"
                    >
                      {k ? "1" : "0"}
                    </text>
                  ))}
                </g>
              ))}
            </g>
          </g>
        ) : null}
        {showCounter ? WINDOW_RECESS : null}
        <g key="tokens">
          {Array.from({ length: slots }, (_, i) => (
            <g
              key={i}
              ref={(n) => {
                const node = (tokens.current[i] ??= { group: null, solid: null, text: null, shown: { transform: "", alpha: "", text: "", lit: false } });
                if (node.group !== n) node.shown = { transform: "", alpha: "", text: "", lit: false };
                node.group = n;
                node.solid = (n?.querySelector(".iso-solid") as SVGGElement | null) ?? null;
                node.text = (n?.querySelector("text") as SVGTextElement | null) ?? null;
              }}
              style={{ opacity: 0 }}
            >
              <Solid paths={TOKEN_ART.solid} tone="mid" crease="faint" inner={<path className="iso-line" data-tone="faint" d={TOKEN_ART.groove} />} />
              <text className="iso-face-text cinta-token-text" data-tone="mid" transform={TOKEN_ART.face} fontSize={7} y={2.5} textAnchor="middle" />
            </g>
          ))}
        </g>
        {station === "count" || station === "best" ? BIN_FRONT : null}
        {(station === "sum" || station === "count") && open ? INLET_TO_COUNTER.front : null}
        {station === "best" && open ? INLET_TO_PEDESTAL.front : null}
        {station === "best" && open ? TRAY_FRONT : null}
        {ARCH_FRONT}
        <g ref={lens} className="cinta-lens">
          <Solid paths={ARCH_ART.lens} tone="hi" crease="faint" />
        </g>
        {station === "stamp" && open ? (
          <g key="press">
            <g ref={ram}>{RAM}</g>
            {PRESS_FRONT}
          </g>
        ) : null}
        {HOPPER}
        {CRANK_BACK}
        <path ref={spokes} className="iso-line" data-tone="mid" d="" />
        <LiveSolid paths={crankFrame(0).handle} slot={handle} />
        {!open && station !== "stamp" ? (
          <g key="hood">
            {station === "best" ? HOOD_BEST_ART : HOOD_COUNTER_ART}
            {order ? (
              <g transform={HOOD_COUNTER.cardFace}>
                <FaceText transform={`translate(${HOOD_COUNTER.cardAt[0]} ${-HOOD_COUNTER.cardAt[1] + 3.6})`} size={10} tone="hi" anchor="middle">
                  {order}
                </FaceText>
              </g>
            ) : null}
          </g>
        ) : null}
        {!open && station === "stamp" ? HOOD_PRESS_ART : null}
        </g>
      </IsoFigure>
    </div>
  );
}
