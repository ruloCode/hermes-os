// El dibujo completo de la máquina "pines" en orden de pintor, con las piezas
// que se mueven marcadas por data-* (las toma Rig). Lo usan el guion y el modo en
// vivo: la máquina es una sola.

import * as React from "react";
import { IsoFigure, Line } from "../../iso/react/draw";
import {
  BASE,
  BEAM,
  BED,
  BORE_CLIP,
  COUNTER_BODY,
  COUNTER_FRAME,
  HEAD,
  KNOB_BODY,
  KNOB_PLATE,
  PINS,
  PIN_CLIP,
  RAIL_BACK_ART,
  RAIL_FRONT_ART,
  STRIKER,
  TRUCK_BACK_ART,
  TRUCK_FRONT_ART,
  WATCH_BODY,
} from "./art";
import { COUNTER_ART, DRUM_H, DRUM_W, SUB_HUB, WATCH_HUB, knobAngle, knobPointer, knobScale, subHand, watchHand } from "./geometry";
import { HOME } from "./model";
import { BRIDGE_BACK, DIGITS, HEIGHT, WIDTH, pinX, pinY, shift } from "./view";

export const PinesScene = React.memo(function PinesScene({ label, detents }: { label: string; detents: number }) {
  const clipId = React.useId().replace(/:/g, "");
  const scale = React.useMemo(() => knobScale(detents), [detents]);
  const rest = shift(pinX(HOME.a) - BRIDGE_BACK);
  const drumW = DIGITS * DRUM_W;
  return (
    <IsoFigure width={WIDTH} height={HEIGHT} label={label}>
      <defs>
        <clipPath id={BORE_CLIP}>
          <path d={PIN_CLIP} />
        </clipPath>
        <clipPath id={`${clipId}-win`}>
          <rect x={0} y={0} width={drumW} height={DRUM_H} />
        </clipPath>
      </defs>
      {BASE}
      {RAIL_BACK_ART}
      <g data-bridge="" transform={rest}>
        {TRUCK_BACK_ART}
      </g>
      {BED}
      {PINS}
      {RAIL_FRONT_ART}
      <g data-bridge="" transform={rest}>
        {TRUCK_FRONT_ART}
      </g>
      <g data-bridge="" transform={rest}>
        {BEAM}
      </g>
      <g data-head="" transform={shift(pinX(HOME.a) - BRIDGE_BACK, pinY(HOME.b))}>
        <g data-striker="">{STRIKER}</g>
        {HEAD}
      </g>
      {WATCH_BODY}
      {KNOB_PLATE}
      <Line d={scale} tone="mid" />
      {KNOB_BODY}
      <path data-pointer="" className="iso-line pines-pointer" data-tone="lit" d={knobPointer(knobAngle(0, detents))} />
      {COUNTER_BODY}
      <g transform={COUNTER_ART.drums}>
        <rect className="pines-drum" x={0} y={0} width={drumW} height={DRUM_H} />
        <g clipPath={`url(#${clipId}-win)`}>
          {Array.from({ length: DIGITS }, (_, i) => (
            <g key={i} transform={`translate(${(i + 0.5) * DRUM_W} 0)`}>
              <g data-wheel="" data-lead={i < DIGITS - 1 ? "" : "off"}>
                <text className="pines-digit" x={0} y={DRUM_H / 2} textAnchor="middle" dominantBaseline="central">
                  0
                </text>
                <text className="pines-digit" x={0} y={DRUM_H * 1.5} textAnchor="middle" dominantBaseline="central">
                  1
                </text>
              </g>
            </g>
          ))}
        </g>
        <rect className="pines-drum-shade" x={0} y={0} width={drumW} height={1.1} />
        <rect className="pines-drum-shade" x={0} y={DRUM_H - 1.1} width={drumW} height={1.1} />
      </g>
      {COUNTER_FRAME}
      <path data-hand="" className="iso-line pines-hand" data-tone="lit" d={watchHand(0)} />
      <path data-sub="" className="iso-line" data-tone="hi" d={subHand(0)} />
      <circle className="pines-hub" cx={WATCH_HUB[0]} cy={WATCH_HUB[1]} r={0.9} />
      <circle className="pines-hub" cx={SUB_HUB[0]} cy={SUB_HUB[1]} r={0.5} />
    </IsoFigure>
  );
});
