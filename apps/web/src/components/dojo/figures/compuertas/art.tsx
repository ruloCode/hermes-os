// Piezas estáticas de la clasificadora como JSX, armadas una vez por lección.
// La parte viva (live.tsx) las acomoda en orden de pintor y mueve el resto.

import * as React from "react";
import { Dots, Line, Solid } from "../../iso/react/draw";
import { machineArt, type MachineArt } from "./geometry";
import { lessonOf, type Lesson } from "./model";
import { layoutOf, type Layout } from "./view";

export interface Art {
  lesson: Lesson;
  L: Layout;
  M: MachineArt;
  base: React.ReactElement;
  panel: React.ReactElement;
  arms: React.ReactElement;
  chuteBack: React.ReactElement;
  chuteFront: React.ReactElement;
  trackBack: React.ReactElement;
  floors: React.ReactElement;
  gatesFront: React.ReactElement;
  frontLip: React.ReactElement;
  hood: React.ReactElement;
  binBack: React.ReactElement[];
  binRight: React.ReactElement[];
  binFront: React.ReactElement[];
}

const cache = new Map<string, Art>();

export const artOf = (id: string): Art => artFor(id, lessonOf(id));

/** La máquina de una lección cualquiera (también la que arma el modo en vivo). */
export function artFor(id: string, lesson: Lesson): Art {
  const hit = cache.get(id);
  if (hit) return hit;
  // En vivo cada forma de código es una máquina: el caché no crece sin fin.
  if (cache.size > 40) cache.clear();
  const L = layoutOf(lesson.bins);
  // Cada placa se mide con el texto más largo que llega a mostrar (f-decidir cambia de juego).
  const chars = Array.from({ length: lesson.bins }, (_, i) => Math.max(...lesson.groups.map((g) => g[i].plate.length)));
  const M = machineArt(L, chars);

  const base = (
    <g key="base">
      <path className="iso-halo" d={M.base.halo} />
      {M.base.feet.map((parts, i) => (
        <g key={i}>
          {parts.map((paths, part) => (
            <Solid key={part} paths={paths} tone={part ? "mid" : "lo"} />
          ))}
        </g>
      ))}
      <Solid paths={M.base.slab} tone="mid" />
      <Line d={M.base.groove} tone="lo" />
      <Line d={M.base.screwRings} tone="lo" />
      <Dots points={M.base.screws} size={0.5} tone="mid" />
      <Solid paths={M.base.ruler} tone="lo" crease="none" />
      <Line d={M.base.ticksMinor} tone="lo" />
      <Line d={M.base.ticksMajor} tone="mid" />
      <Solid paths={M.base.plate} tone="lo" crease="none" />
      <Line d={M.base.plateLine} tone="faint" />
      <Line d={M.base.plateRule} tone="lo" free />
      <Dots points={M.base.plateScrews} size={0.45} tone="mid" />
    </g>
  );

  const panel = (
    <g key="panel">
      <Solid paths={M.panel.slab} tone="mid" inner={<Line d={M.panel.seam} tone="faint" />} />
      {M.panel.stiles.map((paths, i) => (
        <Solid key={i} paths={paths} tone="mid" />
      ))}
      <Dots points={M.panel.stileScrews} size={0.45} tone="mid" />
      <Solid paths={M.panel.cap} tone="mid" />
      {M.panel.shoes.map((paths, i) => (
        <Solid key={i} paths={paths} tone="mid" />
      ))}
      <Dots points={M.panel.shoeScrews} size={0.45} tone="mid" />
    </g>
  );

  const arms = (
    <g key="arms">
      {M.arms.map((a, i) => (
        <g key={i}>
          <Solid paths={a.gusset} tone="mid" />
          <Solid paths={a.arm} tone="mid" />
        </g>
      ))}
    </g>
  );

  const chuteBack = (
    <g key="chute-back">
      {M.chute.standoffs.map((paths, i) => (
        <Solid key={i} paths={paths} tone="mid" />
      ))}
      <Solid paths={M.chute.back} tone="mid" inner={<Line d={M.chute.backLine} tone="faint" />} />
      <Solid paths={M.chute.left} tone="mid" />
    </g>
  );

  const chuteFront = (
    <g key="chute-front">
      <Solid paths={M.chute.right} tone="mid" />
      {M.chute.bars.map((paths, i) => (
        <Solid key={i} paths={paths} tone="mid" crease="none" />
      ))}
      <Solid paths={M.chute.cap} tone="mid" />
      <Line d={M.chute.slot} tone="lo" />
      <Dots points={M.chute.capScrews} size={0.45} tone="mid" />
    </g>
  );

  const trackBack = (
    <g key="track-back">
      <Solid paths={M.track.backLip} tone="mid" />
      {M.gates.map((g, i) => (
        <Solid key={i} paths={g.backPost} tone="mid" />
      ))}
    </g>
  );

  const floors = (
    <g key="floors">
      {M.track.floors.map((paths, i) => (
        <Solid key={i} paths={paths} tone="mid" />
      ))}
      <Solid paths={M.chute.stop} tone="mid" />
      {M.arms.map((a, i) => (
        <Dots key={i} points={a.screws} size={0.4} tone="lo" />
      ))}
    </g>
  );

  const gatesFront = (
    <g key="gates-front">
      {M.gates.map((g, i) => (
        <g key={i}>
          <Solid paths={g.frontPost} tone="mid" />
          <Solid paths={g.lintel} tone="mid" />
          <Solid paths={g.knob} tone="mid" />
          <Line d={g.knurl} tone="lo" />
        </g>
      ))}
    </g>
  );

  const frontLip = (
    <g key="front-lip">
      <Solid paths={M.track.frontLip} tone="mid" />
      <Dots points={M.track.lipScrews} size={0.45} tone="mid" />
      {M.gates.map((g, i) => (
        <Dots key={i} points={g.hinges} size={0.55} tone="mid" />
      ))}
    </g>
  );

  const hood = (
    <g key="hood" className="cp-hood">
      <path className="iso-halo cp-soft" d={M.hood.box.fill} />
      <Solid paths={M.hood.box} tone="hi" inner={<Line d={M.hood.seams} tone="faint" />} />
      <Dots points={M.hood.rivets} size={0.45} tone="mid" />
      <Solid paths={M.hood.hasp} tone="mid" crease="none" />
      <Line d={M.hood.shackle} tone="hi" />
      <Solid paths={M.hood.lock} tone="hi" />
      <Line d={M.hood.keyhole} tone="mid" free />
    </g>
  );

  const binBack = M.bins.map((b, i) => (
    <g key={`bin-back-${i}`}>
      <Solid paths={b.floor} tone="lo" />
      <Solid paths={b.back} tone="mid" inner={<Line d={b.backSeam} tone="faint" />} />
      <Solid paths={b.left} tone="mid" />
    </g>
  ));
  const binRight = M.bins.map((b, i) => (
    <g key={`bin-right-${i}`}>
      <Solid paths={b.right} tone="mid" />
    </g>
  ));
  const binFront = M.bins.map((b, i) => (
    <g key={`bin-front-${i}`}>
      <Solid paths={b.front} tone="mid" />
      <Solid paths={b.holder} tone="lo" crease="none" />
      <Line d={b.holderLine} tone="faint" />
      <Dots points={b.rivets} size={0.45} tone="mid" />
    </g>
  ));

  const art: Art = { lesson, L, M, base, panel, arms, chuteBack, chuteFront, trackBack, floors, gatesFront, frontLip, hood, binBack, binRight, binFront };
  cache.set(id, art);
  return art;
}
