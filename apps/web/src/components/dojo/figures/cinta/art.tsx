// Las piezas fijas de la cinta como JSX, agrupadas por capa del orden de
// pintado (de atrás hacia adelante). La parte viva (live.tsx) las acomoda y
// mueve solo lo que se mueve. Cada raíz lleva key (ver react.md del kit).
import type * as React from "react";
import { Dots, Line, Solid } from "../../iso/react/draw";
import type { StationKey } from "./view";
import {
  ARCH_ART,
  BASE_ARTS,
  BELT_ART,
  BIN_ART,
  COUNTER_ART,
  CRANK_ART,
  HINGE_ART,
  HOPPER_ART,
  INLET_COUNTER,
  INLET_PEDESTAL,
  LEG_ART,
  PEDESTAL_ART,
  PRESS_ART,
  RACK_ART,
  RAIL_ART,
  TRAY_ART,
  flapFrame,
  type HoodArt,
} from "./geometry";

function baseJsx(key: StationKey) {
  const BASE_ART = BASE_ARTS[key];
  return (
  <g key="base">
    <path className="iso-halo" d={BASE_ART.halo} />
    {BASE_ART.feet.map((parts, index) => (
      <g key={index}>
        {parts.map((paths, part) => (
          <Solid key={part} paths={paths} tone={part ? "mid" : "lo"} crease="faint" />
        ))}
      </g>
    ))}
    <Solid paths={BASE_ART.slab} tone="mid" crease="faint" />
    <Line d={BASE_ART.groove} tone="lo" />
    <Line d={BASE_ART.screwRings} tone="lo" />
    <Dots points={BASE_ART.screws} size={0.5} tone="mid" />
    <Solid paths={BASE_ART.plate} tone="lo" crease="none" />
    <Line d={BASE_ART.plateLine} tone="faint" />
    <Line d={BASE_ART.plateRule} tone="lo" free />
    <Dots points={BASE_ART.plateScrews} size={0.45} tone="mid" />
    <Solid paths={BASE_ART.strip} tone="lo" crease="none" />
    <Line d={BASE_ART.ticksMinor} tone="lo" />
    <Line d={BASE_ART.ticksMajor} tone="mid" />
    <Line d={BASE_ART.zero} tone="hi" />
    <Dots points={BASE_ART.stripScrews} size={0.42} tone="mid" />
    {LEG_ART.map((leg, index) => (
      <g key={`leg${index}`}>
        {leg.pads.map((paths, pad) => (
          <Solid key={pad} paths={paths} tone="lo" crease="faint" />
        ))}
        <Dots points={leg.padScrews} size={0.4} tone="mid" />
        <Solid paths={leg.posts[0]!} tone="mid" crease="faint" />
        <Solid paths={leg.brace} tone="mid" crease="faint" />
        <Solid paths={leg.posts[1]!} tone="mid" crease="faint" />
      </g>
    ))}
  </g>
);
}

export const BASES = Object.fromEntries((Object.keys(BASE_ARTS) as StationKey[]).map((key) => [key, baseJsx(key)])) as Record<StationKey, React.ReactElement>;

export const BELT_BACK = (
  <g key="belt-back">
    <Solid paths={ARCH_ART.backFoot} tone="lo" crease="faint" />
    <Dots points={ARCH_ART.backFootScrews} size={0.4} tone="mid" />
    <Solid paths={ARCH_ART.backPost} tone="mid" crease="faint" inner={<Line d={ARCH_ART.postSeam} tone="faint" />} />
    <Solid paths={RAIL_ART.back} tone="mid" crease="faint" />
    <Solid paths={BELT_ART.belt} tone="mid" crease="faint" />
  </g>
);

export const FRONT_RAIL = (
  <g key="front-rail">
    <Solid paths={RAIL_ART.front} tone="mid" crease="faint" inner={<Line d={RAIL_ART.frontSeam} tone="faint" />} />
    <Dots points={RAIL_ART.bolts} size={0.5} tone="mid" />
    <Line d={RAIL_ART.axles} tone="lo" />
    <Dots points={RAIL_ART.axleNuts} size={0.55} tone="mid" />
  </g>
);

/** Bandeja bajo la trampa: lo que queda detrás de las fichas. */
export const BIN_BACK = (
  <g key="bin-back">
    <Solid paths={BIN_ART.floor} tone="lo" crease="none" />
    <Line d={BIN_ART.floorGrid} tone="faint" />
    <Solid paths={BIN_ART.back} tone="mid" crease="faint" />
    <Solid paths={BIN_ART.left} tone="mid" crease="faint" />
    <Solid paths={HINGE_ART.backPost} tone="mid" crease="faint" />
    <Solid paths={HINGE_ART.axle} tone="mid" crease="none" />
  </g>
);

export const BIN_FRONT = (
  <g key="bin-front">
    <Solid paths={BIN_ART.right} tone="mid" crease="faint" />
    <Solid paths={BIN_ART.front} tone="mid" crease="faint" />
    <Solid paths={HINGE_ART.frontPost} tone="mid" crease="faint" />
  </g>
);

export const KNUCKLES = (
  <g key="knuckles">
    {HINGE_ART.knuckles.map((paths, index) => (
      <Solid key={index} paths={paths} tone="mid" crease="faint" />
    ))}
  </g>
);

/** El puente cerrado (la suma no descarta nada: la trampa nunca se abre). */
export const BRIDGE = <Solid key="bridge" paths={flapFrame(0)} tone="mid" crease="faint" />;

const inletArt = (inlet: typeof INLET_COUNTER, key: string) => ({
  back: (
    <g key={`${key}-back`}>
      <Solid paths={inlet.tray} tone="mid" crease="faint" />
      <Line d={inlet.rule} tone="faint" />
      <Solid paths={inlet.backLip} tone="mid" crease="none" />
    </g>
  ),
  front: <Solid key={`${key}-front`} paths={inlet.frontLip} tone="mid" crease="none" />,
});

export const INLET_TO_COUNTER = inletArt(INLET_COUNTER, "inlet-c");
export const INLET_TO_PEDESTAL = inletArt(INLET_PEDESTAL, "inlet-p");

export const COUNTER = (
  <g key="counter">
    <Solid paths={COUNTER_ART.flange} tone="lo" crease="faint" />
    <Dots points={COUNTER_ART.flangeScrews} size={0.45} tone="mid" />
    <Solid paths={COUNTER_ART.body} tone="hi" crease="faint" inner={<Line d={COUNTER_ART.seam} tone="faint" />} />
    <Line d={COUNTER_ART.deck} tone="faint" />
    <Dots points={COUNTER_ART.deckScrews} size={0.45} tone="mid" />
    <Line d={COUNTER_ART.mouthRim} tone="lo" />
    <path className="iso-shade cinta-void" data-shade="0" d={COUNTER_ART.mouth} />
    <path className="iso-shade" data-shade="1" d={COUNTER_ART.mouthBack} />
    <path className="iso-shade" data-shade="2" d={COUNTER_ART.mouthSide} />
    <Line d={COUNTER_ART.mouth} tone="mid" />
    <path className="iso-shade" data-shade="1" d={COUNTER_ART.bezel} />
    <Line d={COUNTER_ART.bezel} tone="lo" />
    <Dots points={COUNTER_ART.bezelScrews} size={0.42} tone="mid" />
    <Solid paths={COUNTER_ART.boss} tone="mid" crease="faint" />
    <Solid paths={COUNTER_ART.knob} tone="mid" crease="lo" />
    <Line d={COUNTER_ART.knobKnurl} tone="faint" />
    <Line d={COUNTER_ART.knobMark} tone="hi" />
    <path className="iso-shade" data-shade="2" d={COUNTER_ART.endPlate} />
    <Line d={COUNTER_ART.endPlate} tone="lo" />
    <Line d={COUNTER_ART.endRule} tone="faint" />
    <path className="iso-top" d={COUNTER_ART.label} />
    <Line d={COUNTER_ART.label} tone="lo" />
    <Line d={COUNTER_ART.labelRule} tone="lo" free />
    <Dots points={COUNTER_ART.labelRivets} size={0.4} tone="mid" />
  </g>
);

/** El fondo y los costados del hueco de la ventana, encima de los tambores. */
export const WINDOW_RECESS = (
  <g key="recess">
    <path className="iso-shade" data-shade="0" d={COUNTER_ART.jamb} />
    <path className="iso-shade" data-shade="3" d={COUNTER_ART.sill} />
    <Line d={COUNTER_ART.window} tone="mid" />
  </g>
);

export const PEDESTAL = (
  <g key="pedestal">
    <Solid paths={PEDESTAL_ART.plinth} tone="mid" crease="faint" />
    <Dots points={PEDESTAL_ART.plinthScrews} size={0.45} tone="mid" />
    <Solid paths={PEDESTAL_ART.column} tone="hi" crease="faint" inner={<Line d={PEDESTAL_ART.columnRings} tone="faint" />} />
    <Solid paths={PEDESTAL_ART.capital} tone="mid" crease="faint" />
    <Solid paths={PEDESTAL_ART.seat} tone="hi" crease="faint" />
    <Line d={PEDESTAL_ART.seatRing} tone="lo" />
  </g>
);

export const TRAY_BACK = (
  <g key="tray-back">
    <Solid paths={TRAY_ART.floor} tone="lo" crease="none" />
    <Line d={TRAY_ART.floorGrid} tone="faint" />
    <Solid paths={TRAY_ART.back} tone="mid" crease="faint" />
    <Solid paths={TRAY_ART.left} tone="mid" crease="faint" />
  </g>
);

export const TRAY_FRONT = (
  <g key="tray-front">
    <Solid paths={TRAY_ART.right} tone="mid" crease="faint" />
    <Solid paths={TRAY_ART.front} tone="mid" crease="faint" />
  </g>
);

export const RACK = (
  <g key="rack">
    <Solid paths={RACK_ART.board} tone="mid" crease="faint" />
    <Line d={RACK_ART.pockets} tone="lo" />
    <Line d={RACK_ART.first} tone="mid" />
  </g>
);

export const PRESS_BACK = (
  <g key="press-back">
    <Solid paths={PRESS_ART.pillar} tone="mid" crease="faint" inner={<Line d={PRESS_ART.pillarSeam} tone="faint" />} />
    <Solid paths={PRESS_ART.anvil} tone="hi" crease="faint" />
    <Line d={PRESS_ART.anvilRing} tone="lo" />
    <Solid paths={PRESS_ART.backFoot} tone="lo" crease="faint" />
    <Dots points={PRESS_ART.feetScrews} size={0.4} tone="mid" />
    <Solid paths={PRESS_ART.backPost} tone="mid" crease="faint" inner={<Line d={PRESS_ART.postSeam} tone="faint" />} />
  </g>
);

/** Lo que baja con el sello: vástago, collar y troquel. */
export const RAM = (
  <g key="ram">
    <Solid paths={PRESS_ART.rod} tone="mid" crease="none" />
    <Solid paths={PRESS_ART.collar} tone="mid" crease="faint" />
    <Solid paths={PRESS_ART.die} tone="hi" crease="faint" inner={<Line d={PRESS_ART.dieRing} tone="faint" />} />
  </g>
);

export const PRESS_FRONT = (
  <g key="press-front">
    <Solid paths={PRESS_ART.gusset} tone="mid" crease="faint" />
    <Solid paths={PRESS_ART.arm} tone="mid" crease="faint" />
    <Dots points={PRESS_ART.armScrews} size={0.5} tone="mid" />
    <Solid paths={PRESS_ART.cylinder} tone="mid" crease="faint" inner={<Line d={PRESS_ART.cylinderSeam} tone="faint" />} />
    <Solid paths={PRESS_ART.port} tone="mid" crease="none" />
    <Solid paths={PRESS_ART.cylinderCap} tone="mid" crease="faint" />
    <Dots points={PRESS_ART.capBolts} size={0.42} tone="mid" />
  </g>
);

/** El lector, menos su lente (que se enciende en vivo). */
export const ARCH_FRONT = (
  <g key="arch-front">
    <Solid paths={ARCH_ART.gusset} tone="mid" crease="faint" />
    <Solid paths={ARCH_ART.housing} tone="mid" crease="faint" inner={<Line d={ARCH_ART.housingSeams} tone="faint" />} />
    <Solid paths={ARCH_ART.collar} tone="mid" crease="faint" />
    <Solid paths={ARCH_ART.arm} tone="mid" crease="faint" />
    <Line d={ARCH_ART.armRule} tone="faint" />
    <Dots points={ARCH_ART.armScrews} size={0.5} tone="mid" />
  </g>
);

export const HOPPER = (
  <g key="hopper">
    <Solid paths={HOPPER_ART.body} tone="mid" crease="faint" inner={<Line d={HOPPER_ART.seam} tone="faint" />} />
    <path className="iso-shade cinta-void" data-shade="0" d={HOPPER_ART.mouth} />
    <Line d={HOPPER_ART.mouth} tone="lo" />
    <path className="iso-top" d={HOPPER_ART.plate} />
    <Line d={HOPPER_ART.plate} tone="lo" />
    <Line d={HOPPER_ART.plateRule} tone="lo" free />
    <Dots points={HOPPER_ART.plateRivets} size={0.38} tone="mid" />
    <Dots points={HOPPER_ART.rivets} size={0.42} tone="mid" />
    <Solid paths={HOPPER_ART.lid} tone="mid" crease="faint" />
    <Dots points={HOPPER_ART.lidScrews} size={0.45} tone="mid" />
    {HOPPER_ART.knobs.map((paths, index) => (
      <Solid key={index} paths={paths} tone="mid" crease="none" />
    ))}
    <Solid paths={HOPPER_ART.handle} tone="mid" crease="faint" />
  </g>
);

export const CRANK_BACK = (
  <g key="crank-back">
    <Solid paths={CRANK_ART.axle} tone="mid" crease="none" />
    <Solid paths={CRANK_ART.wheel} tone="mid" crease="faint" />
    <Line d={CRANK_ART.rim} tone="lo" />
    <Line d={CRANK_ART.hub} tone="mid" />
  </g>
);

export function hoodArt(hood: HoodArt, key: string) {
  return (
    <g key={key}>
      <Solid paths={hood.body} tone="mid" crease="faint" inner={<Line d={`${hood.skirt}${hood.seam}`} tone="faint" />} />
      <path className="iso-shade cinta-void" data-shade="0" d={hood.vents} />
      <Line d={hood.vents} tone="lo" />
      <Dots points={hood.screws} size={0.48} tone="mid" />
      {hood.slot ? <path className="iso-shade cinta-void" data-shade="0" d={hood.slot} /> : null}
      {hood.slot ? <Line d={hood.slot} tone="lo" /> : null}
      {hood.handlePosts.map((paths, index) => (
        <Solid key={index} paths={paths} tone="mid" crease="none" />
      ))}
      <Solid paths={hood.handleBar} tone="mid" crease="faint" />
      <Solid paths={hood.hasp} tone="mid" crease="none" />
      <Line d={hood.shackle} tone="mid" />
      {hood.holder ? <path className="iso-shade" data-shade="1" d={hood.holder} /> : null}
      {hood.holder ? <Line d={hood.holder} tone="lo" /> : null}
      {hood.card ? <path className="cinta-card" d={hood.card} /> : null}
      {hood.card ? <Line d={hood.card} tone="mid" /> : null}
    </g>
  );
}
