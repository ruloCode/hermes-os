// Las piezas fijas de la máquina como JSX, construidas una vez por máquina. Cada
// raíz lleva su key (ver la trampa de las keys en Anatomy: references/react.md).
// Lo que se mueve (carro, tope, cabezal) está en su posición de reposo y
// live.tsx lo traslada; lo que cambia de forma lo pinta live.tsx por cuadro.

import * as React from "react";
import { Dots, FaceText, Line, Solid } from "../../iso/react/draw";
import { MACHINES, type Machine, type RingArt } from "./geometry";
import type { MachineId } from "./model";

function ringParts(parts: RingArt["back"], key: string, tone: "hi" | "mid" = "hi") {
  return (
    <g key={key}>
      {parts.map((paths, index) => (
        <Solid key={index} paths={paths} tone={tone} crease="lo" />
      ))}
    </g>
  );
}

export interface Art {
  bench: React.ReactNode;
  railBack: React.ReactNode;
  rail: React.ReactNode;
  sockets: React.ReactNode[];
  blocks: React.ReactNode[];
  scale: React.ReactNode;
  scaleTicks: React.ReactNode[];
  skirtBack: React.ReactNode;
  car: React.ReactNode;
  lock: React.ReactNode;
  dial: React.ReactNode;
  topeBody: React.ReactNode;
  ringBack: React.ReactNode;
  ringFront: React.ReactNode;
  collarBack: React.ReactNode;
  collarFront: React.ReactNode;
  heads: Record<number, { back: React.ReactNode; front: React.ReactNode }>;
  pad: React.ReactNode;
}

function artOf(m: Machine): Art {
  const { bench, rail, sockets, scale, car, dial, tope } = m;
  return {
    bench: (
      <g key="bench">
        <path className="iso-halo" d={bench.halo} />
        {bench.feet.map((parts, index) => (
          <g key={index}>
            {parts.map((paths, part) => (
              <Solid key={part} paths={paths} tone={part ? "mid" : "lo"} crease="faint" />
            ))}
          </g>
        ))}
        <Solid paths={bench.slab} tone="mid" crease="faint" />
        <Line d={bench.groove} tone="lo" />
        <Line d={bench.screwRings} tone="lo" />
        <Dots points={bench.screws} size={0.5} tone="mid" />
        <Solid paths={bench.plate} tone="lo" crease="none" />
        <Line d={bench.plateLine} tone="faint" />
        <Line d={bench.plateRule} tone="lo" free />
        <Dots points={bench.plateScrews} size={0.45} tone="mid" />
        <Solid paths={bench.strip} tone="lo" crease="none" />
        <Line d={bench.stripMinor} tone="lo" />
        <Line d={bench.stripMajor} tone="mid" />
      </g>
    ),
    railBack: (
      <g key="rail-back">
        {rail.feet.map((paths, index) => (
          <Solid key={index} paths={paths} tone="lo" crease="faint" />
        ))}
        <Dots points={rail.footScrews} size={0.45} tone="mid" />
        {rail.posts.map((paths, index) => (
          <Solid key={index} paths={paths} tone="mid" crease="faint" />
        ))}
      </g>
    ),
    rail: (
      <g key="rail">
        <Solid paths={rail.body} tone="mid" crease="faint" inner={<Line d={rail.seam} tone="faint" />} />
        <Line d={rail.minor} tone="lo" />
        <Line d={rail.major} tone="mid" />
        {rail.stops.map((paths, index) => (
          <Solid key={index} paths={paths} tone="mid" crease="faint" />
        ))}
        <Dots points={rail.stopScrews} size={0.45} tone="mid" />
      </g>
    ),
    sockets: sockets.map((socket, index) => (
      <g key={`socket-${index}`}>
        <Solid paths={socket.slab} tone="lo" crease="faint" />
        <path className="vt-hole" d={socket.hole} />
        <Line d={socket.holeEdge} tone="lo" />
        <Dots points={socket.screws} size={0.42} tone="mid" />
      </g>
    )),
    blocks: m.blocks.map((d, index) => (d ? <Line key={`block-${index}`} d={d} tone="hi" dotted /> : <g key={`block-${index}`} />)),
    scale: (
      <g key="scale">
        <Solid paths={scale.foot} tone="lo" crease="faint" />
        <Solid paths={scale.post} tone="mid" crease="faint" />
        <Solid paths={scale.cap} tone="mid" crease="faint" />
        <Line d={scale.capLine} tone="faint" />
      </g>
    ),
    scaleTicks: scale.ticks.map((t, index) => (
      <g key={`ticks-${index}`}>
        <Line d={t.minor} tone="lo" />
        <Line d={t.major} tone="mid" />
        <Line d={t.zero} tone="hi" />
      </g>
    )),
    skirtBack: <Solid key="skirt-back" paths={car.skirtBack} tone="mid" crease="faint" />,
    car: (
      <g key="car">
        <Solid paths={car.saddle} tone="mid" crease="faint" />
        <Dots points={car.saddleScrews} size={0.45} tone="mid" />
        <Solid paths={car.skirtFront} tone="mid" crease="faint" />
        <Dots points={car.skirtScrews} size={0.42} tone="mid" />
        <Solid paths={car.knob} tone="mid" crease="faint" />
        <Line d={car.knobKnurl} tone="lo" />
        <Solid paths={car.tower} tone="mid" crease="faint" />
        <Line d={car.towerSlot} tone="lo" />
        <Solid paths={car.arm} tone="mid" crease="faint" />
        <Line d={car.armLine} tone="faint" />
        <Dots points={car.armScrews} size={0.45} tone="mid" />
      </g>
    ),
    lock: (
      <g key="lock">
        <Solid paths={car.lockPin} tone="hi" crease="lo" lit />
        <Solid paths={car.lockHead} tone="hi" crease="lo" lit />
        <Line d={car.lockRing} tone="lo" />
      </g>
    ),
    dial: (
      <g key="dial">
        <Solid paths={dial.neck} tone="mid" crease="faint" />
        <Solid paths={dial.crown} tone="mid" crease="faint" />
        <Solid paths={dial.crownCap} tone="mid" crease="faint" />
        <Solid paths={dial.puck} tone="mid" crease="faint" inner={<Line d={dial.band} tone="faint" />} />
        <Line d={dial.knurl} tone="faint" />
        <Line d={dial.bezel} tone="lo" />
        <Line d={dial.face} tone="faint" />
        <Line d={dial.minor} tone="lo" />
        <Line d={dial.major} tone="mid" />
        <Line d={dial.zero} tone="hi" />
        <FaceText transform={dial.label} size={3.6} tone="lo" anchor="middle">
          {dial.labelText}
        </FaceText>
      </g>
    ),
    topeBody: (
      <g key="tope">
        <Solid paths={tope.slider} tone="mid" crease="faint" />
        <Dots points={tope.sliderScrews} size={0.42} tone="mid" />
        <Solid paths={tope.knob} tone="mid" crease="faint" />
        <Line d={tope.knobKnurl} tone="lo" />
        <Solid paths={tope.arm} tone="mid" crease="faint" />
        <Dots points={tope.armScrews} size={0.4} tone="mid" />
      </g>
    ),
    ringBack: ringParts(tope.ring.back, "ring-back"),
    ringFront: ringParts(tope.ring.front, "ring-front"),
    collarBack: ringParts(m.collar.back, "collar-back", "mid"),
    collarFront: ringParts(m.collar.front, "collar-front", "mid"),
    heads: Object.fromEntries(
      Object.values(m.heads).map((h) => [
        h.k,
        {
          back: (
            <g key={`head-back-${h.k}`}>
              <Solid paths={h.back} tone="mid" crease="faint" />
            </g>
          ),
          front: (
            <g key={`head-front-${h.k}`}>
              {h.housings.map((paths, index) => (
                <Solid key={index} paths={paths} tone="mid" crease="faint" />
              ))}
              <Line d={h.housingSeams} tone="faint" />
              <Solid paths={h.left} tone="mid" crease="faint" />
              <Solid paths={h.spine} tone="mid" crease="faint" />
              <Solid paths={h.right} tone="mid" crease="faint" />
              <Solid paths={h.front} tone="mid" crease="faint" />
              <Dots points={h.screws} size={0.45} tone="mid" />
            </g>
          ),
        },
      ]),
    ),
    pad: (
      <g key="pad">
        <Solid paths={m.pad} tone="hi" crease="lo" />
        <Line d={m.padRing} tone="lo" />
      </g>
    ),
  };
}

export const ART: Record<MachineId, Art> = {
  "c-ganancia": artOf(MACHINES["c-ganancia"]),
  "c-ventana": artOf(MACHINES["c-ventana"]),
};
