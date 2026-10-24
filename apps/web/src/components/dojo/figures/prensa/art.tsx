// Las piezas fijas de la prensa como JSX, una constante por grupo del orden de
// pintado (cada raíz con su key: ver el aviso de keys en references/react.md).

import * as React from "react";
import { Dots, Line, Solid } from "../../iso/react/draw";
import {
  BASE_ART,
  CHUTE_ART,
  CYLINDER_ART,
  GUARD_ART,
  HEAD_FRONT,
  MAGAZINE_ART,
  PRESS_ART,
  PUSHER_ART,
  RAIL_ART,
  RAM_ART,
  TRAY_ART,
  VISOR_ART,
  WHEEL_ART,
} from "./geometry";

export const BASE = (
  <g key="base">
    <path className="iso-halo" d={BASE_ART.halo} />
    {BASE_ART.feet.map((parts, i) => (
      <g key={i}>
        {parts.map((paths, part) => (
          <Solid key={part} paths={paths} tone={part ? "mid" : "lo"} />
        ))}
      </g>
    ))}
    <Solid paths={BASE_ART.slab} tone="mid" inner={<Line d={BASE_ART.seam} tone="faint" />} />
    <Line d={BASE_ART.groove} tone="lo" />
    <Line d={BASE_ART.screwRings} tone="lo" />
    <Dots points={BASE_ART.screws} size={0.5} tone="mid" />
    <Solid paths={BASE_ART.ruler} tone="lo" crease="none" />
    <Line d={BASE_ART.ruleMinor} tone="lo" />
    <Line d={BASE_ART.ruleMajor} tone="mid" />
    <Dots points={BASE_ART.rulerScrews} size={0.42} tone="mid" />
    <Solid paths={BASE_ART.plate} tone="lo" crease="none" />
    <Line d={BASE_ART.plateLine} tone="faint" />
    <Dots points={BASE_ART.plateScrews} size={0.45} tone="mid" />
  </g>
);

export const CYLINDER = (
  <g key="cylinder">
    {CYLINDER_ART.saddles.map((paths, i) => (
      <Solid key={i} paths={paths} tone="lo" />
    ))}
    <Dots points={CYLINDER_ART.saddleScrews} size={0.42} tone="mid" />
    <Solid paths={CYLINDER_ART.capBack} tone="mid" crease="none" />
    <Solid paths={CYLINDER_ART.body} tone="mid" crease="none" inner={<Line d={CYLINDER_ART.bodySeams} tone="faint" />} />
    <Solid paths={CYLINDER_ART.capFront} tone="mid" crease="none" />
    <Dots points={CYLINDER_ART.capBolts} size={0.42} tone="mid" />
    <Solid paths={CYLINDER_ART.fitting} tone="mid" crease="none" />
    <Solid paths={CYLINDER_ART.fittingNut} tone="mid" />
  </g>
);

export const RAIL_BACK = (
  <g key="rail-back">
    <Solid paths={RAIL_ART.bed} tone="mid" />
    <Line d={RAIL_ART.lane} tone="faint" />
    <Solid paths={RAIL_ART.back} tone="mid" />
    <Dots points={RAIL_ART.backScrews} size={0.42} tone="mid" />
  </g>
);

export const MAG_BACK = (
  <g key="mag-back">
    {MAGAZINE_ART.postFeet.slice(0, 1).concat(MAGAZINE_ART.postFeet.slice(2, 3)).map((paths, i) => (
      <Solid key={i} paths={paths} tone="lo" />
    ))}
    {MAGAZINE_ART.backPosts.map((paths, i) => (
      <Solid key={i} paths={paths} tone="mid" crease="none" />
    ))}
    <Solid paths={MAGAZINE_ART.collarBack} tone="mid" />
    <Solid paths={MAGAZINE_ART.collarLeft} tone="mid" />
  </g>
);

export const PUSHER = (
  <g key="pusher">
    <Solid paths={PUSHER_ART.clevis} tone="mid" />
    <Solid paths={PUSHER_ART.block} tone="mid" />
    <Dots points={PUSHER_ART.screws} size={0.45} tone="mid" />
  </g>
);

export const PRESS_BACK = (
  <g key="press-back">
    <Solid paths={PRESS_ART.column} tone="mid" inner={<Line d={PRESS_ART.columnSeam} tone="faint" />} />
    <Line d={PRESS_ART.columnRibs} tone="faint" />
    {PRESS_ART.gibs.map((paths, i) => (
      <Solid key={i} paths={paths} tone="mid" crease="none" />
    ))}
    <Dots points={PRESS_ART.gibScrews} size={0.42} tone="mid" />
    <Solid paths={PRESS_ART.bolster} tone="mid" />
    <Dots points={PRESS_ART.bolsterScrews} size={0.45} tone="mid" />
    <Solid paths={PRESS_ART.die} tone="mid" crease="none" />
    <Line d={PRESS_ART.dieLine} tone="faint" />
    <Dots points={PRESS_ART.dieScrews} size={0.4} tone="mid" />
  </g>
);

export const CHUTE_BACK = (
  <g key="chute-back">
    <Solid paths={CHUTE_ART.bed} tone="mid" />
    <Line d={CHUTE_ART.lane} tone="faint" />
    <Solid paths={CHUTE_ART.back} tone="mid" />
    <Dots points={CHUTE_ART.backScrews} size={0.42} tone="mid" />
  </g>
);

export const TRAY_BACK = (
  <g key="tray-back">
    <path className="iso-halo" d={TRAY_ART.halo} />
    <Solid paths={TRAY_ART.floor} tone="lo" />
    <Line d={TRAY_ART.floorGrid} tone="faint" />
    <Solid paths={TRAY_ART.back} tone="mid" />
  </g>
);

export const FRONT_GUIDES = (
  <g key="front-guides">
    <Solid paths={RAIL_ART.front} tone="mid" />
    <Dots points={RAIL_ART.frontScrews} size={0.42} tone="mid" />
    <Solid paths={CHUTE_ART.front} tone="mid" />
    <Dots points={CHUTE_ART.frontScrews} size={0.42} tone="mid" />
  </g>
);

export const MAG_FRONT = (
  <g key="mag-front">
    {MAGAZINE_ART.postFeet.slice(1, 2).concat(MAGAZINE_ART.postFeet.slice(3)).map((paths, i) => (
      <Solid key={i} paths={paths} tone="lo" />
    ))}
    {MAGAZINE_ART.frontPosts.map((paths, i) => (
      <Solid key={i} paths={paths} tone="mid" crease="none" />
    ))}
    <Line d={MAGAZINE_ART.postMarks} tone="lo" />
    <Solid paths={MAGAZINE_ART.collarRight} tone="mid" />
    <Solid paths={MAGAZINE_ART.collarFront} tone="mid" />
    <Dots points={MAGAZINE_ART.collarScrews} size={0.45} tone="mid" />
  </g>
);

export const RAM_BODY = (
  <g key="ram-body">
    <Solid paths={RAM_ART.ram} tone="mid" inner={<Line d={RAM_ART.ramSeams} tone="faint" />} />
    <Solid paths={RAM_ART.collar} tone="mid" />
    <Dots points={RAM_ART.collarBolts} size={0.42} tone="mid" />
  </g>
);

export const HEAD = (
  <g key="head">
    <Solid paths={PRESS_ART.head} tone="mid" inner={<Line d={PRESS_ART.headSeam} tone="faint" />} />
    <Line d={HEAD_FRONT.cover} tone="lo" />
    <Dots points={HEAD_FRONT.coverScrews} size={0.42} tone="mid" />
    <Dots points={HEAD_FRONT.bolts} size={0.5} tone="mid" />
    <path className="iso-shade" data-shade={0} d={HEAD_FRONT.sight} />
    <Line d={HEAD_FRONT.sight} tone="lo" />
    <Line d={HEAD_FRONT.sightMinor} tone="lo" />
    <Line d={HEAD_FRONT.sightMajor} tone="mid" />
    <Line d={PRESS_ART.headGroove} tone="faint" />
    <Line d={PRESS_ART.headScrewRings} tone="lo" />
    <Dots points={PRESS_ART.headScrews} size={0.45} tone="mid" />
    <Solid paths={PRESS_ART.oilCup} tone="mid" crease="none" />
    <Solid paths={PRESS_ART.oilCap} tone="mid" />
    <Solid paths={PRESS_ART.gland} tone="mid" />
    <Line d={PRESS_ART.glandRing} tone="lo" />
    <Dots points={PRESS_ART.glandBolts} size={0.4} tone="mid" />
  </g>
);

export const VISOR_BOX = (
  <g key="visor-box">
    <Solid paths={VISOR_ART.neck} tone="mid" crease="none" />
    <Solid paths={VISOR_ART.box} tone="mid" />
    <Line d={VISOR_ART.boxGroove} tone="faint" />
    <Dots points={VISOR_ART.screws} size={0.4} tone="mid" />
  </g>
);

export const GUARD = (
  <g key="guard">
    <Solid paths={GUARD_ART.side} tone="mid" />
    <Line d={GUARD_ART.sideSlots} tone="lo" />
    <Dots points={GUARD_ART.sideScrews} size={0.45} tone="mid" />
    <Solid paths={GUARD_ART.panel} tone="mid" />
    <Line d={GUARD_ART.slots} tone="lo" />
    <Dots points={GUARD_ART.screws} size={0.48} tone="mid" />
    {GUARD_ART.handlePosts.map((paths, i) => (
      <Solid key={i} paths={paths} tone="mid" crease="none" />
    ))}
    <Solid paths={GUARD_ART.handleBar} tone="hi" />
    <Solid paths={GUARD_ART.lock} tone="mid" />
    <Line d={GUARD_ART.lockKey} tone="hi" />
  </g>
);

export const WHEEL_BACK = (
  <g key="wheel-back">
    <Solid paths={WHEEL_ART.boss} tone="mid" crease="none" />
    <Solid paths={WHEEL_ART.rim} tone="mid" crease="none" />
    <path className="iso-shade" data-shade={0} d={WHEEL_ART.rimInner} />
    <Line d={WHEEL_ART.rimInner} tone="lo" />
  </g>
);

export const WHEEL_HUB = (
  <g key="wheel-hub">
    <Solid paths={WHEEL_ART.hub} tone="mid" crease="none" />
    <Solid paths={WHEEL_ART.hubNut} tone="mid" crease="none" />
  </g>
);

export const TRAY_FRONT = (
  <g key="tray-front">
    <Solid paths={TRAY_ART.stop} tone="mid" />
    <Solid paths={TRAY_ART.right} tone="mid" />
    <Dots points={TRAY_ART.rightRivets} size={0.42} tone="mid" />
    <Solid paths={TRAY_ART.front} tone="mid" />
    <Dots points={TRAY_ART.frontRivets} size={0.42} tone="mid" />
  </g>
);
