"use client";

// La máquina "pines" en movimiento: un solo bucle que lee la línea de tiempo del
// ejemplo (model.ts), mueve el puente, el cabezal y el martillo, hunde los pines,
// hace rodar las ruedas del contador y escribe el readout. Todo por refs: con
// 110 pines en pantalla, React no se re-renderiza por cuadro.

import * as React from "react";
import { useInView, useLoop, useReadout } from "../../iso/react/live";
import { pinIndex } from "./art";
import { HOME, detentOf, lessonOf, readoutAt, spokenOf, trackOf, withN, type Example, type Pose, type Track } from "./model";
import { PIN_COUNT, Rig, ease, lerp } from "./rig";
import { PinesScene } from "./scene";
import { PIN_SUNK, PIN_TOP } from "./view";

const HOLD = 2.2; // segundos quieta al terminar un ejemplo antes de pasar al siguiente
const HOLD_USER = 4.2; // tras tocarla, un poco más
const BLEND = 0.55; // cambio de ejemplo: el cabezal viaja desde donde estaba

const LABEL =
  "Un tablero de pines en un banco de pruebas. Sobre dos rieles corre un puente —el for de afuera— y por su viga corre un cabezal —el for de adentro— con un martillo que hunde un pin por paso. Al frente, un contador de trece ruedas cuenta los pasos, una perilla elige n y un cronómetro da una vuelta por segundo de cómputo.";

export function PinesLive({ id, reveal }: { id: string; reveal: boolean }) {
  const lesson = React.useMemo(() => lessonOf(id, reveal), [id, reveal]);
  const { anchor, say } = useReadout<HTMLDivElement>();
  const visible = useInView(anchor);
  const rig = React.useRef(new Rig());
  const state = React.useRef({
    tour: 0,
    example: lesson.tour[0] as Example,
    track: trackOf(lesson.tour[0]) as Track,
    t: 0,
    since: 0, // segundos desde el cambio de ejemplo (para la mezcla del cabezal)
    from: { ...HOME } as Pose,
    pose: { ...HOME } as Pose,
    hold: HOLD,
  });
  const [paused, setPaused] = React.useState(false);

  // Las referencias a los nodos se toman una vez montado el SVG.
  React.useEffect(() => rig.current.attach(anchor.current), [anchor]);

  const describe = React.useCallback(
    (example: Example) => {
      const node = anchor.current;
      if (!node) return;
      node.setAttribute("aria-valuetext", spokenOf(example));
      node.setAttribute("aria-valuenow", String(detentOf(lesson, example.n)));
    },
    [anchor, lesson],
  );

  const start = React.useCallback(
    (example: Example, tour: number, hold = HOLD) => {
      const s = state.current;
      s.from = { ...s.pose };
      s.example = example;
      s.track = trackOf(example);
      s.tour = tour;
      s.t = 0;
      s.since = 0;
      s.hold = hold;
      rig.current.refresh();
      describe(example);
    },
    [describe],
  );

  // Una lección nueva (o reveal distinto) arranca su recorrido desde el principio.
  React.useEffect(() => {
    start(lesson.tour[0], 0);
  }, [lesson, start]);

  const draw = React.useCallback(
    (dt: number, calm: boolean) => {
      const s = state.current;
      const r = rig.current;
      const track = s.track;
      const t = s.t;

      // Cabezal: la línea de tiempo, mezclada desde donde quedó el ejemplo anterior.
      const target = track.pose(t);
      const w = calm ? 1 : ease(s.since / BLEND);
      const pose: Pose = { a: lerp(s.from.a, target.a, w), b: lerp(s.from.b, target.b, w), tip: lerp(s.from.tip, target.tip, w) };
      s.pose = pose;
      const z = r.pose(pose);

      // Pines: hundidos los que ya pasaron, el que se está golpeando sigue a la punta.
      const pressing = calm ? -1 : track.pressing(t);
      const want = new Float32Array(PIN_COUNT);
      const look = new Uint8Array(PIN_COUNT);
      let exact = -1;
      track.pins.forEach((pin, k) => {
        const index = pinIndex(pin.a, pin.b);
        if (t >= pin.at) {
          // La copia volteada se queda a media altura: dos escalones que encajan.
          want[index] = pin.kind === "B" ? PIN_SUNK * 0.5 : PIN_SUNK;
          look[index] = pin.kind === "B" ? 2 : 1;
        } else if (k === pressing) {
          want[index] = Math.min(PIN_SUNK, Math.max(0, PIN_TOP - z));
          exact = index;
        }
      });
      r.pins(want, look, dt, calm, exact);
      r.counter(track.steps(t), dt, calm);
      r.knob(detentOf(lesson, s.example.n), lesson.detents.length, dt, calm);
      r.watch(track.clock(t), dt, calm);
      say(readoutAt(track, t));
      r.done();
    },
    [lesson, say],
  );

  const running = visible && !paused;
  const kick = useLoop((dt, calm) => {
    const s = state.current;
    if (calm) {
      // Quieto: el estado final del ejemplo, sin recorrido.
      s.t = s.track.duration;
      s.since = BLEND;
      draw(dt, true);
      return false;
    }
    s.t += dt;
    s.since += dt;
    draw(dt, false);
    if (s.t > s.track.duration + s.hold) {
      const next = (s.tour + 1) % lesson.tour.length;
      start(lesson.tour[next], next);
    }
    return true;
  }, running);

  const step = React.useCallback(
    (by: number) => {
      const s = state.current;
      const d = Math.min(lesson.detents.length - 1, Math.max(0, detentOf(lesson, s.example.n) + by));
      const example = withN(s.example, lesson, d);
      const tour = lesson.tour.indexOf(example);
      start(example, tour >= 0 ? tour : s.tour, HOLD_USER);
      kick();
    },
    [lesson, start, kick],
  );

  const next = React.useCallback(() => {
    const s = state.current;
    const tour = (s.tour + 1) % lesson.tour.length;
    start(lesson.tour[tour], tour, HOLD_USER);
    kick();
  }, [lesson, start, kick]);

  const onKey = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      event.stopPropagation();
      step(event.key === "ArrowRight" ? 1 : -1);
    } else if (event.key === " " || event.key === "Spacebar") {
      event.preventDefault();
      event.stopPropagation();
      setPaused((p) => !p);
    }
  };

  const first = lesson.tour[0];
  const firstTrack = React.useMemo(() => trackOf(first), [first]);
  const restReadout = readoutAt(firstTrack, 0);
  React.useEffect(() => say(restReadout), [say, restReadout]);

  return (
    <div
      ref={anchor}
      className="pines-live"
      tabIndex={0}
      role="slider"
      aria-label={`${lesson.title}: ← y → cambian n, espacio pausa, clic pasa al siguiente ejemplo.`}
      aria-valuemin={0}
      aria-valuemax={lesson.detents.length - 1}
      aria-valuenow={0}
      aria-valuetext={spokenOf(first)}
      data-paused={paused ? "" : undefined}
      onKeyDown={onKey}
      onClick={next}
    >
      <PinesScene label={LABEL} detents={lesson.detents.length} />
    </div>
  );
}
