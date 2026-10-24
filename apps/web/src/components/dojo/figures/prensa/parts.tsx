"use client";

// Piezas de React que comparten el guion y el modo en vivo: un sólido del kit
// con ref (para reescribirlo por cuadro) y el ajuste de un texto a su cara.

import * as React from "react";
import type { Frame } from "./frame";

/** Reescribe los trazos de un sólido del kit ya montado (el orden de <Solid>). */
export function writeSolid(g: SVGGElement | null, paths: Frame["rod"]) {
  if (!g) return;
  const kids = g.children;
  let i = 0;
  const fill = kids[i++];
  fill?.setAttribute("d", paths.fill);
  for (let s = 0; s < 4; s++) {
    const node = kids[i];
    if (node?.classList.contains("iso-shade")) {
      node.setAttribute("d", paths.shades[s] ?? "");
      i++;
    }
  }
  for (; i < kids.length; i++) {
    const node = kids[i]!;
    if (node.classList.contains("iso-top")) node.setAttribute("d", paths.top);
    else if (node.classList.contains("iso-crease")) node.setAttribute("d", paths.crease);
    else if (node.classList.contains("iso-edge")) node.setAttribute("d", paths.outline);
  }
}

/**
 * Un <Solid> del kit con ref en su raíz: las cuatro sombras siempre presentes
 * (para reescribirlo por cuadro) y data-lit escribible desde el loop.
 */
export function RefSolid({
  paths,
  tone = "mid",
  gref,
  crease = "faint",
  inner,
}: {
  paths: Frame["rod"];
  tone?: "hi" | "mid" | "lo";
  gref: (n: SVGGElement | null) => void;
  crease?: "faint" | "lo" | "none";
  inner?: React.ReactNode;
}) {
  return (
    <g ref={gref} className="iso-solid">
      <path className="iso-fill" d={paths.fill} />
      {[0, 1, 2, 3].map((s) => (
        <path key={s} className="iso-shade" data-shade={s} d={paths.shades[s] ?? ""} />
      ))}
      <path className="iso-top" d={paths.top} />
      {crease === "none" ? null : <path className="iso-line iso-crease" data-tone={crease} d={paths.crease} />}
      {crease === "none" || !paths.bevel ? null : <path className="iso-line iso-bevel" data-tone={crease} d={paths.bevel} />}
      {inner}
      <path className="iso-line iso-edge" data-tone={tone} d={paths.outline} />
    </g>
  );
}

export const fitText = (text: string, width: number, most: number) => Math.min(most, width / Math.max(1, text.length * 0.64));

