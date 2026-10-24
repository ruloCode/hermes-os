// Partes estáticas del componedor como JSX, en el orden en que se pintan
// (atrás → adelante, abajo → arriba). Cada raíz lleva su key: se pasan como
// elementos al componente vivo (ver references/react.md, la trampa de keys).

import * as React from "react";
import { Dots, Line, Solid } from "../../iso/react/draw";
import { BASE_ART, BOX_ART, CARRIAGE_ART, KNEE_ART, RAIL_ART, STICK_ART, railTicks, type SlotArt } from "./geometry";

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
    <Solid paths={BASE_ART.slab} tone="lo" crease="faint" inner={<Line d={BASE_ART.seam} tone="faint" />} />
    <Line d={BASE_ART.groove} tone="faint" />
    <Line d={BASE_ART.screwRings} tone="lo" />
    <Dots points={BASE_ART.screws} size={0.5} tone="mid" />
    <Solid paths={BASE_ART.label} tone="lo" crease="none" />
    <Line d={BASE_ART.labelLine} tone="faint" />
    <Line d={BASE_ART.labelRule} tone="lo" free />
    <Dots points={BASE_ART.labelScrews} size={0.45} tone="mid" />
  </g>
);

export const POSTS = (
  <g key="posts">
    {RAIL_ART.feet.map((paths, index) => (
      <Solid key={index} paths={paths} tone="lo" crease="faint" />
    ))}
    <Dots points={RAIL_ART.footScrews} size={0.45} tone="mid" />
    {RAIL_ART.posts.map((paths, index) => (
      <Solid key={index} paths={paths} tone="mid" crease="faint" inner={<Line d={RAIL_ART.postSeams[index]!} tone="faint" />} />
    ))}
  </g>
);

export const STICK_BACK = (
  <g key="stick-back">
    {STICK_ART.cradles.map((paths, index) => (
      <Solid key={index} paths={paths} tone="lo" crease="faint" />
    ))}
    <Dots points={STICK_ART.cradleScrews} size={0.45} tone="mid" />
    <Solid paths={STICK_ART.head} tone="mid" crease="faint" inner={<Line d={STICK_ART.headSeam} tone="faint" />} />
    <Line d={STICK_ART.headSlot} tone="lo" />
    <Line d={STICK_ART.headRings} tone="lo" />
    <Dots points={STICK_ART.headScrews} size={0.45} tone="mid" />
    <Solid paths={STICK_ART.wall} tone="mid" crease="faint" />
    <Dots points={STICK_ART.wallScrews} size={0.4} tone="mid" />
  </g>
);

export const BED = (
  <g key="bed">
    <Solid paths={STICK_ART.bed} tone="mid" crease="faint" inner={<Line d={STICK_ART.bedChannel} tone="faint" />} />
    <Line d={STICK_ART.bedSeat} tone="faint" />
  </g>
);

/** La regla fija de la cama: rayas en cada borde de casilla y el número de cada casilla. */
export function rulerOf(slots: SlotArt, bindNumeral: (index: number) => (node: SVGTextElement | null) => void, key = "ruler") {
  return (
    <g key={key}>
      <Line d={slots.ticks} tone="lo" />
      {slots.numerals.map((numeral, index) => (
        <text key={index} ref={bindNumeral(index)} className="iso-face-text" data-tone="lo" transform={numeral.transform} fontSize={slots.numeralSize} textAnchor="middle">
          {numeral.text}
        </text>
      ))}
    </g>
  );
}

/** La regla negativa: se dibuja en x ≤ 0 y viaja con el tope. */
export function stripOf(slots: SlotArt, bindNumeral: (index: number) => (node: SVGTextElement | null) => void, key = "strip") {
  return (
    <g key={key}>
      <Solid paths={slots.strip} tone="lo" crease="none" />
      <Line d={slots.stripTicks} tone="lo" />
      {slots.stripNumerals.map((numeral, index) => (
        <text key={index} ref={bindNumeral(index)} className="iso-face-text" data-tone="lo" transform={numeral.transform} fontSize={slots.negativeSize} textAnchor="middle">
          {numeral.text}
        </text>
      ))}
    </g>
  );
}

export const BEAM = (
  <g key="beam">
    <Solid paths={RAIL_ART.beam} tone="mid" crease="faint" />
    <Line d={RAIL_ART.ends} tone="faint" />
    <Dots points={RAIL_ART.beamScrews} size={0.45} tone="mid" />
  </g>
);

/** La graduación del riel para un juego de fichas (una raya por borde de casilla). */
export function beamTicksOf(cap: number, key = "beam-ticks") {
  const ticks = railTicks(cap);
  return (
    <g key={key}>
      <Line d={ticks.minor} tone="lo" />
      <Line d={ticks.major} tone="mid" />
    </g>
  );
}

export const KNEE_PARTS = (
  <g key="knee-parts">
    <Solid paths={KNEE_ART.hook} tone="mid" crease="faint" />
    <Solid paths={KNEE_ART.screw} tone="mid" crease="faint" />
    <Line d={KNEE_ART.screwKnurl} tone="lo" />
    <Line d={KNEE_ART.screwTop} tone="lo" />
    <Solid paths={KNEE_ART.bracket} tone="mid" crease="faint" />
    <Dots points={KNEE_ART.rivets} size={0.45} tone="mid" />
  </g>
);

export const BOX = (
  <g key="box">
    <path className="iso-halo" d={BOX_ART.body.fill} />
    <Solid paths={BOX_ART.body} tone="mid" crease="faint" inner={<Line d={BOX_ART.baseSeam} tone="faint" />} />
    <Line d={BOX_ART.lid} tone="faint" />
    <Dots points={BOX_ART.lidScrews} size={0.45} tone="mid" />
    <path className="tp-glass" d={BOX_ART.glass} />
    <path className="iso-shade" data-shade="0" d={BOX_ART.recessFloor} />
    <path className="iso-shade" data-shade="1" d={BOX_ART.recessSide} />
    <Line d={BOX_ART.glass} tone="faint" />
    <Line d={BOX_ART.bezel} tone="lo" />
    <Dots points={BOX_ART.windowScrews} size={0.45} tone="mid" />
  </g>
);

export const CARRIAGE = (
  <g key="carriage">
    <Solid paths={CARRIAGE_ART.cheek} tone="mid" crease="faint" />
    <Dots points={CARRIAGE_ART.cheekScrews} size={0.4} tone="mid" />
    <Solid paths={CARRIAGE_ART.block} tone="mid" crease="faint" />
    <Dots points={CARRIAGE_ART.blockScrews} size={0.4} tone="mid" />
    <Solid paths={CARRIAGE_ART.arm} tone="mid" crease="faint" />
    <Solid paths={CARRIAGE_ART.stem} tone="mid" crease="none" inner={<Line d={CARRIAGE_ART.collarSeam} tone="faint" />} />
    <Solid paths={CARRIAGE_ART.collar} tone="mid" crease="faint" />
    <Line d={CARRIAGE_ART.collarKnurl} tone="lo" />
    <Solid paths={CARRIAGE_ART.tip} tone="hi" crease="none" />
  </g>
);
