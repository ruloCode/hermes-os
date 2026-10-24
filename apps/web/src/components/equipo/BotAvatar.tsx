"use client";

// EL PERSONAJE DE UN AGENTE (/equipo): forma + color + cara. Puerto en SVG de
// `BotAvatar.kt` de Hermes Phone (mismas formas en una caja de 100×100, mismos
// 10 colores), así el mismo agente se ve igual en el teléfono y en el PC.
//
// Los colores del personaje son ILUSTRACIÓN (como el compañero del teléfono),
// no tokens de estado: por eso van en hex. El 0 (índigo) es de Hermes. El punto
// de estado sí usa los tokens: verde trabaja · ámbar te necesita · rojo problema.

import { useEffect, useRef, useState } from "react";
import type { Look, Status } from "@/lib/team";

const PALETTE = [
  "#7C7FF5",
  "#6AA6EE",
  "#4FB5AD",
  "#5CC58B",
  "#E3AD55",
  "#EE7B7B",
  "#D57DB3",
  "#B08968",
  "#ECEEF1",
  "#8A8E97",
];
const FACE = "#131417";
const CHEEK = "rgb(255 255 255 / 0.22)";

const P = {
  blob: "M52 8c22 0 40 15 41 38 2 26-15 46-42 46S7 76 8 52C9 27 28 8 52 8z",
  drop: "M50 6c14 18 38 34 38 56a38 38 0 0 1-76 0C12 40 36 24 50 6z",
  spark: "M50 8c5 20 22 37 42 42-20 5-37 22-42 42-5-20-22-37-42-42 20-5 37-22 42-42z",
  triangle: "M50 16L88 82L12 82Z",
  smile: "M45 63q5 5 10 0",
  sleepEyes: "M33 49q7 5 14 0M53 49q7 5 14 0",
  sleepMouth: "M47 62h6",
};

/** Clases literales (Tailwind solo ve lo que está escrito entero). */
const DOT: Partial<Record<Status, string>> = {
  WORKING: "fill-green",
  NEEDS_YOU: "fill-amber",
  PROBLEM: "fill-red",
};

export const isAsleep = (s: Status) => s === "ASLEEP" || s === "PAUSED";

function Shape({ look }: { look: Look }) {
  const c = PALETTE[((look.color % PALETTE.length) + PALETTE.length) % PALETTE.length];
  switch (look.shape) {
    case "blob":
      return <path d={P.blob} fill={c} />;
    case "drop":
      return <path d={P.drop} fill={c} />;
    case "cloud":
      return (
        <g fill={c}>
          <circle cx={30} cy={58} r={22} />
          <circle cx={50} cy={40} r={27} />
          <circle cx={72} cy={56} r={22} />
          <circle cx={50} cy={66} r={26} />
        </g>
      );
    case "flower":
      return (
        <g fill={c}>
          <circle cx={50} cy={50} r={30} />
          {[
            [80, 50],
            [65, 76],
            [35, 76],
            [20, 50],
            [35, 24],
            [65, 24],
          ].map(([x, y]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r={17} />
          ))}
        </g>
      );
    case "pill":
      return <rect x={6} y={22} width={88} height={56} rx={28} fill={c} />;
    case "squircle":
      return <rect x={10} y={10} width={80} height={80} rx={28} fill={c} />;
    case "triangle":
      return <path d={P.triangle} fill={c} stroke={c} strokeWidth={16} strokeLinejoin="round" />;
    case "spark":
      return <path d={P.spark} fill={c} stroke={c} strokeWidth={10} strokeLinejoin="round" />;
  }
}

function Face({ sleepy, closedMouth }: { sleepy: boolean; closedMouth: boolean }) {
  if (sleepy)
    return (
      <g strokeLinecap="round" fill="none">
        <circle cx={29} cy={60} r={5.5} fill={CHEEK} />
        <circle cx={71} cy={60} r={5.5} fill={CHEEK} />
        <path d={P.sleepEyes} stroke={FACE} strokeWidth={3.4} />
        <path d={closedMouth ? P.sleepMouth : P.smile} stroke={FACE} strokeWidth={3} />
      </g>
    );
  return (
    <g>
      <circle cx={29} cy={61} r={5.5} fill={CHEEK} />
      <circle cx={71} cy={61} r={5.5} fill={CHEEK} />
      <ellipse cx={40} cy={48} rx={7.5} ry={9.5} fill="#fff" />
      <ellipse cx={60} cy={48} rx={7.5} ry={9.5} fill="#fff" />
      <circle cx={42} cy={50} r={4.3} fill={FACE} />
      <circle cx={62} cy={50} r={4.3} fill={FACE} />
      <circle cx={43.6} cy={48.2} r={1.5} fill="#fff" />
      <circle cx={63.6} cy={48.2} r={1.5} fill="#fff" />
      <path d={P.smile} stroke={FACE} strokeWidth={3} strokeLinecap="round" fill="none" />
    </g>
  );
}

function reducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/**
 * Parpadea de vez en cuando y, si trabaja, respira; con "reducir movimiento"
 * del sistema queda quieto. `ring` = clase de relleno del anillo que separa el
 * punto de estado del personaje (el fondo sobre el que se dibuja).
 */
export function BotAvatar({
  look,
  status,
  size,
  label,
  ring = "fill-bg",
}: {
  look: Look;
  status: Status;
  size: number;
  /** Texto para lectores de pantalla; sin él, el dibujo es decorativo. */
  label?: string;
  ring?: string;
}) {
  const asleep = isAsleep(status);
  const [blink, setBlink] = useState(false);
  const svg = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (asleep || reducedMotion()) return;
    let t: number;
    const next = () => {
      t = window.setTimeout(
        () => {
          setBlink(true);
          t = window.setTimeout(() => {
            setBlink(false);
            next();
          }, 120);
        },
        3500 + Math.random() * 2500,
      );
    };
    next();
    return () => window.clearTimeout(t);
  }, [asleep]);

  const breathe = status === "WORKING";
  useEffect(() => {
    const el = svg.current;
    if (!breathe || !el || reducedMotion() || typeof el.animate !== "function") return;
    const a = el.animate([{ transform: "scale(1)" }, { transform: "scale(1.03)" }], {
      duration: 1200,
      direction: "alternate",
      iterations: Infinity,
      easing: "cubic-bezier(0.4, 0, 0.2, 1)",
    });
    return () => a.cancel();
  }, [breathe]);

  const dot = DOT[status];
  // 2px reales de anillo, en unidades de la caja.
  const ringU = (2 * 100) / size;

  return (
    <svg
      ref={svg}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      overflow="visible"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className="shrink-0"
    >
      <Shape look={look} />
      <Face sleepy={asleep || blink} closedMouth={asleep} />
      {dot && (
        <>
          <circle cx={87} cy={85} r={13 + ringU} className={ring} />
          <circle cx={87} cy={85} r={13} className={dot} />
        </>
      )}
    </svg>
  );
}
