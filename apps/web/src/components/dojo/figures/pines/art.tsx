// Piezas estáticas de la máquina "pines" como JSX, en grupos con key estable
// (ver references/react.md: el aviso de keys con props grandes). El componente
// vivo las pone en orden de pintor y mueve solo los <g> que se desplazan.

import * as React from "react";
import { Dots, FaceText, Line, Solid } from "../../iso/react/draw";
import {
  BASE_ART,
  BEAM_ART,
  BED_ART,
  COUNTER_ART,
  HEAD_ART,
  KNOB_ART,
  PIN_ART,
  PIN_CLIP,
  PIN_ORDER,
  RAIL_BACK,
  RAIL_FRONT,
  TRUCK_BACK,
  TRUCK_FRONT,
  WATCH_ART,
} from "./geometry";
import { pinX, pinY, shift } from "./view";

export const BORE_CLIP = "pines-bore";

export const BASE = (
  <g key="base">
    <path className="iso-halo" d={BASE_ART.halo} />
    {BASE_ART.feet.map((parts, index) => (
      <g key={index}>
        {parts.map((paths, part) => (
          <Solid key={part} paths={paths} tone={part ? "mid" : "lo"} crease="faint" />
        ))}
      </g>
    ))}
    <Solid paths={BASE_ART.slab} tone="mid" crease="faint" inner={<Line d={BASE_ART.seam} tone="faint" />} />
    <Line d={BASE_ART.groove} tone="lo" />
    <Line d={BASE_ART.screwRings} tone="lo" />
    <Dots points={BASE_ART.screws} size={0.5} tone="mid" />
    <Solid paths={BASE_ART.label} tone="lo" crease="none" />
    <Line d={BASE_ART.labelLine} tone="faint" />
    <Line d={BASE_ART.labelRule} tone="lo" free />
    <Dots points={BASE_ART.labelScrews} size={0.45} tone="mid" />
  </g>
);

function Rail({ art }: { art: typeof RAIL_BACK }) {
  return (
    <>
      {art.pedestals.map((paths, index) => (
        <Solid key={index} paths={paths} tone="lo" crease="faint" />
      ))}
      <Dots points={art.pedestalScrews} size={0.42} tone="mid" />
      <Solid paths={art.rail} tone="mid" crease="faint" inner={<Line d={art.railSeam} tone="faint" />} />
      <Line d={art.track} tone="faint" />
      <Line d={art.minor} tone="lo" />
      <Line d={art.major} tone="mid" />
      <Dots points={art.railScrews} size={0.45} tone="mid" />
      {art.stops.map((paths, index) => (
        <Solid key={`s${index}`} paths={paths} tone="mid" crease="faint" />
      ))}
    </>
  );
}

export const RAIL_BACK_ART = (
  <g key="rail-back">
    <Rail art={RAIL_BACK} />
  </g>
);

export const RAIL_FRONT_ART = (
  <g key="rail-front">
    <Rail art={RAIL_FRONT} />
  </g>
);

function Truck({ art }: { art: typeof TRUCK_BACK }) {
  return (
    <>
      <Solid paths={art.truck} tone="mid" crease="faint" inner={<Line d={art.truckSeam} tone="faint" />} />
      <Line d={art.index} tone="hi" />
      <Dots points={art.truckScrews} size={0.42} tone="mid" />
      <Solid paths={art.collar} tone="mid" crease="faint" />
      <Solid paths={art.leg} tone="mid" crease="none" inner={<Line d={art.legSeams} tone="faint" />} />
    </>
  );
}

export const TRUCK_BACK_ART = (
  <g key="truck-back">
    <Truck art={TRUCK_BACK} />
  </g>
);

export const TRUCK_FRONT_ART = (
  <g key="truck-front">
    <Truck art={TRUCK_FRONT} />
  </g>
);

export const BED = (
  <g key="bed">
    <Solid paths={BED_ART.slab} tone="mid" crease="faint" inner={<Line d={BED_ART.seam} tone="faint" />} />
    <path className="iso-shade" data-shade="0" d={BED_ART.bores} />
    <Line d={BED_ART.bores} tone="lo" />
    <Line d={BED_ART.bushes} tone="faint" />
    <Solid paths={BED_ART.ruleX} tone="lo" crease="none" />
    <Solid paths={BED_ART.ruleY} tone="lo" crease="none" />
    <Line d={BED_ART.ticksMinor} tone="lo" />
    <Line d={BED_ART.ticksMajor} tone="mid" />
    <Dots points={BED_ART.screws} size={0.45} tone="mid" />
  </g>
);

/** Índice de un pin: columna a (0..9) × 11 + fila b (0..10). */
export const pinIndex = (a: number, b: number) => a * 11 + b;

export const PINS = (
  <g key="pins">
    {PIN_ORDER.map(({ a, b }) => (
      <g key={pinIndex(a, b)} data-pin={pinIndex(a, b)} transform={shift(pinX(a), pinY(b))} clipPath={`url(#${BORE_CLIP})`}>
        <g data-sink="">
          <Solid paths={PIN_ART.shaft} tone="lo" crease="none" />
          <Solid paths={PIN_ART.head} tone="mid" crease="faint" inner={<Line d={PIN_ART.dimple} tone="faint" />} />
        </g>
      </g>
    ))}
  </g>
);

export const BEAM = (
  <g key="beam">
    <Solid paths={BEAM_ART.beam} tone="mid" crease="faint" inner={<Line d={BEAM_ART.seam} tone="faint" />} />
    <Line d={BEAM_ART.track} tone="faint" />
    <Line d={BEAM_ART.ticksMinor} tone="lo" />
    <Line d={BEAM_ART.ticksMajor} tone="mid" />
    <Dots points={BEAM_ART.endScrews} size={0.45} tone="mid" />
  </g>
);

/** La varilla y la punta del martillo: se mueven juntas hacia abajo. */
export const STRIKER = (
  <g key="striker">
    <Solid paths={HEAD_ART.rod} tone="mid" crease="none" inner={<Line d={HEAD_ART.rodMarks} tone="faint" />} />
    <Solid paths={HEAD_ART.tip} tone="hi" crease="faint" lit />
  </g>
);

export const HEAD = (
  <g key="head">
    <Solid paths={HEAD_ART.collar} tone="mid" crease="faint" />
    <Solid paths={HEAD_ART.block} tone="mid" crease="faint" inner={<Line d={HEAD_ART.blockSeam} tone="faint" />} />
    <Line d={HEAD_ART.slot} tone="lo" />
    <Dots points={HEAD_ART.blockScrews} size={0.42} tone="mid" />
    <Solid paths={HEAD_ART.saddle} tone="mid" crease="faint" />
    <Dots points={HEAD_ART.saddleScrews} size={0.45} tone="mid" />
    <Solid paths={HEAD_ART.knobNeck} tone="mid" crease="none" />
    <Solid paths={HEAD_ART.knob} tone="mid" crease="faint" />
    <Line d={HEAD_ART.knobKnurl} tone="lo" />
  </g>
);

export const COUNTER_BODY = (
  <g key="counter-body">
    {COUNTER_ART.lugs.map((paths, index) => (
      <Solid key={index} paths={paths} tone="lo" crease="faint" />
    ))}
    <Dots points={COUNTER_ART.lugScrews} size={0.45} tone="mid" />
    <Solid
      paths={COUNTER_ART.body}
      tone="mid"
      crease="faint"
      inner={
        <>
          <Line d={COUNTER_ART.seam} tone="faint" />
          <Line d={COUNTER_ART.plinthSeam} tone="faint" />
        </>
      }
    />
    <Dots points={COUNTER_ART.topScrews} size={0.45} tone="mid" />
    <FaceText transform={COUNTER_ART.engrave} size={2.6} tone="lo">
      pasos
    </FaceText>
    <Line d={COUNTER_ART.engraveRule} tone="faint" free />
    {COUNTER_ART.button.map((paths, index) => (
      <Solid key={`b${index}`} paths={paths} tone={index ? "hi" : "mid"} crease="faint" />
    ))}
  </g>
);

export const COUNTER_FRAME = (
  <g key="counter-frame">
    <path className="iso-top" d={COUNTER_ART.windowFloor} />
    <path className="iso-shade" data-shade="1" d={COUNTER_ART.windowWall} />
    <Line d={COUNTER_ART.dividers} tone="faint" />
    <Line d={COUNTER_ART.windowRim} tone="lo" />
    <Dots points={COUNTER_ART.groupDots} size={0.5} tone="hi" />
  </g>
);

export const KNOB_PLATE = (
  <g key="knob-plate">
    <Solid paths={KNOB_ART.plate} tone="lo" crease="faint" />
  </g>
);

export const KNOB_BODY = (
  <g key="knob">
    <Solid paths={KNOB_ART.boss} tone="mid" crease="faint" />
    <Solid paths={KNOB_ART.body} tone="mid" crease="faint" inner={<Line d={KNOB_ART.band} tone="faint" />} />
    <Line d={KNOB_ART.knurl} tone="lo" />
    <Solid paths={KNOB_ART.cap} tone="hi" crease="faint" />
  </g>
);

export const WATCH_BODY = (
  <g key="watch">
    {WATCH_ART.pusher.map((paths, index) => (
      <Solid key={index} paths={paths} tone="mid" crease="faint" />
    ))}
    <Solid paths={WATCH_ART.case} tone="mid" crease="faint" inner={<Line d={WATCH_ART.seam} tone="faint" />} />
    <Solid paths={WATCH_ART.bezel} tone="mid" crease="faint" />
    <Line d={WATCH_ART.bezelKnurl} tone="lo" />
    <Line d={WATCH_ART.face} tone="lo" />
    <Line d={WATCH_ART.minor} tone="lo" />
    <Line d={WATCH_ART.major} tone="mid" />
    <Line d={WATCH_ART.zero} tone="hi" />
    <Line d={WATCH_ART.subRing} tone="faint" />
    <Solid paths={WATCH_ART.stem} tone="mid" crease="none" />
    <Solid paths={WATCH_ART.crown} tone="mid" crease="faint" />
  </g>
);

export { PIN_CLIP };
