// Arte estático de los casilleros como elementos JSX (con key en cada raíz: el
// componente vivo los intercala en orden de pintor con lo que se mueve).

import * as React from "react";
import { Dots, Line, Solid } from "../../iso/react/draw";
import { BASE_ART, CABINET_ART, CARRIAGE_ART, HOLDERS, LOCK_ART, ORDER_ART, PADDLE_ART, RAIL_ART, SHUTTERS, STATION_ART } from "./geometry";

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
    <Solid paths={BASE_ART.name} tone="lo" crease="none" />
    <Line d={BASE_ART.nameLine} tone="faint" />
    <Line d={BASE_ART.nameRule} tone="lo" free />
    <Dots points={BASE_ART.nameScrews} size={0.45} tone="mid" />
  </g>
);

export const STATION = (
  <g key="station">
    <Solid paths={STATION_ART.plinth} tone="lo" crease="faint" />
    <Solid paths={STATION_ART.body} tone="mid" crease="faint" inner={<Line d={STATION_ART.seam} tone="faint" />} />
    <Line d={STATION_ART.lidLine} tone="faint" />
    <Dots points={STATION_ART.screws} size={0.45} tone="mid" />
    <Line d={STATION_ART.vents} tone="lo" />
    <Line d={STATION_ART.mouth} tone="lo" />
    <Line d={STATION_ART.mouthLip} tone="faint" />
    <Solid paths={STATION_ART.dialBase} tone="lo" crease="faint" />
    <Solid paths={STATION_ART.dial} tone="hi" crease="lo" />
    <Line d={STATION_ART.dialKnurl} tone="faint" />
    <Line d={STATION_ART.dialBezel} tone="lo" />
    <Line d={STATION_ART.dialMinor} tone="lo" />
    <Line d={STATION_ART.dialMajor} tone="hi" />
    <Solid paths={STATION_ART.mag} tone="mid" crease="faint" />
    <Line d={STATION_ART.magSlot} tone="lo" />
    <Dots points={STATION_ART.magScrews} size={0.4} tone="mid" />
  </g>
);

export const DIAL_HUB = <Solid key="hub" paths={STATION_ART.dialHub} tone="mid" crease="none" />;

/** Detrás de todo lo del gabinete: sombra, zócalo, costado izquierdo y fondo. */
export const CABINET_BACK = (
  <g key="cabinet-back">
    <path className="iso-halo" d={CABINET_ART.halo} />
    <Solid paths={CABINET_ART.plinth} tone="lo" crease="faint" />
    <Solid paths={CABINET_ART.sideL} tone="mid" crease="faint" />
    <Solid paths={CABINET_ART.back} tone="lo" crease="faint" />
    <Line d={CABINET_ART.boards[0]!} tone="faint" />
    <Line d={CABINET_ART.boards[1]!} tone="faint" />
  </g>
);

/** El estante que hace de piso de la fila, con sus portaetiquetas. */
export function shelfOf(row: number) {
  const slots = row === 0 ? [3, 4, 5] : [0, 1, 2];
  return (
    <g key={`shelf-${row}`}>
      <Solid paths={CABINET_ART.shelves[row]!} tone="mid" crease="faint" inner={<Line d={CABINET_ART.shelfSeams[row]!} tone="faint" />} />
      {slots.map((slot) => (
        <g key={slot} data-holder={slot}>
          <Solid paths={HOLDERS[slot]!.frame} tone="mid" crease="faint" />
          <Line d={HOLDERS[slot]!.window} tone="lo" />
          <Dots points={HOLDERS[slot]!.screws} size={0.4} tone="mid" />
        </g>
      ))}
    </g>
  );
}

export const SHELVES = [shelfOf(0), shelfOf(1)];

export const dividerOf = (row: number, index: number) => (
  <Solid key={`div-${row}-${index}`} paths={CABINET_ART.dividers[row]![index]!.solid} tone="mid" crease="faint" />
);

export const CABINET_FRONT = (
  <g key="cabinet-front">
    <Solid paths={CABINET_ART.top} tone="mid" crease="faint" />
    <Solid paths={CABINET_ART.sideR} tone="mid" crease="faint" inner={<Line d={CABINET_ART.sideRSeams} tone="faint" />} />
    <Dots points={CABINET_ART.sideRScrews} size={0.42} tone="mid" />
    <Solid paths={CABINET_ART.crown} tone="mid" crease="faint" />
    <Line d={CABINET_ART.topRule.minor} tone="lo" />
    <Line d={CABINET_ART.topRule.major} tone="mid" />
    <Dots points={CABINET_ART.crownScrews} size={0.45} tone="mid" />
  </g>
);

export const shutterOf = (slot: number) => (
  <g key={`shutter-${slot}`}>
    <Solid paths={SHUTTERS[slot]!.solid} tone="mid" crease="faint" inner={<Line d={SHUTTERS[slot]!.slats} tone="faint" />} />
    <Solid paths={SHUTTERS[slot]!.handle} tone="mid" crease="faint" />
  </g>
);

export const LOCK = (
  <g key="lock">
    {LOCK_ART.staples.map((paths, index) => (
      <Solid key={index} paths={paths} tone="mid" crease="faint" />
    ))}
    <Solid paths={LOCK_ART.bar} tone="mid" crease="none" />
    <Solid paths={LOCK_ART.hasp} tone="mid" crease="faint" />
    <path className="iso-line cas-shackle" data-tone="hi" d={LOCK_ART.shackle} />
    <Solid paths={LOCK_ART.body} tone="hi" crease="lo" lit />
    <Line d={LOCK_ART.keyhole} tone="mid" />
  </g>
);

export const POSTS = (
  <g key="posts">
    {RAIL_ART.feet.map((paths, index) => (
      <Solid key={index} paths={paths} tone="lo" crease="faint" />
    ))}
    <Dots points={RAIL_ART.footScrews} size={0.42} tone="mid" />
    {RAIL_ART.posts.map((paths, index) => (
      <Solid key={index} paths={paths} tone="mid" crease="faint" inner={<Line d={RAIL_ART.postSeams[index]!} tone="faint" />} />
    ))}
  </g>
);

export const RAIL = (
  <g key="rail">
    <Solid paths={RAIL_ART.rail} tone="mid" crease="faint" />
    <Line d={RAIL_ART.ticks.minor} tone="lo" />
    <Line d={RAIL_ART.ticks.major} tone="mid" />
    <Dots points={RAIL_ART.railScrews} size={0.5} tone="mid" />
    <Dots points={RAIL_ART.detents} size={0.55} tone="hi" />
    {RAIL_ART.stops.map((paths, index) => (
      <Solid key={index} paths={paths} tone="mid" crease="faint" />
    ))}
  </g>
);

export const CARRIAGE = (
  <g key="carriage">
    {CARRIAGE_ART.rollers.map((paths, index) => (
      <Solid key={index} paths={paths} tone="mid" crease="faint" />
    ))}
    <Dots points={CARRIAGE_ART.rollerHubs} size={0.5} tone="mid" />
    <Solid paths={CARRIAGE_ART.body} tone="mid" crease="faint" />
    <Solid paths={CARRIAGE_ART.collar} tone="mid" crease="none" inner={<Line d={CARRIAGE_ART.collarSeam} tone="faint" />} />
    <Solid paths={CARRIAGE_ART.cheek} tone="mid" crease="faint" />
    <Dots points={CARRIAGE_ART.cheekScrews} size={0.45} tone="mid" />
  </g>
);

export const PADDLE = (
  <g key="paddle">
    <Solid paths={PADDLE_ART.plate} tone="mid" crease="faint" />
    {PADDLE_ART.lips.map((paths, index) => (
      <Solid key={index} paths={paths} tone="mid" crease="faint" />
    ))}
    <Solid paths={PADDLE_ART.block} tone="mid" crease="faint" />
    <Dots points={[PADDLE_ART.blockScrew]} size={0.45} tone="mid" />
  </g>
);

export const ORDER_RAIL = (
  <g key="order-rail">
    {ORDER_ART.feet.map((paths, index) => (
      <Solid key={index} paths={paths} tone="lo" crease="faint" />
    ))}
    {ORDER_ART.posts.map((paths, index) => (
      <Solid key={index} paths={paths} tone="mid" crease="faint" />
    ))}
    <Solid paths={ORDER_ART.bar} tone="mid" crease="faint" />
  </g>
);

export const TICKETS = ORDER_ART.tickets.map((ticket, index) => (
  <React.Fragment key={`ticket-${index}`}>
    <Solid paths={ticket.solid} tone="mid" crease="faint" inner={<Line d={ticket.perf} tone="faint" dotted />} />
    <Solid paths={ticket.clip} tone="mid" crease="faint" />
  </React.Fragment>
));
