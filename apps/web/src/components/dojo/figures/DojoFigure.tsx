"use client";

// La máquina que explica una lección, montada con el kit de Anatomy
// (components/dojo/iso, MIT). El kit trae su propia paleta de grises con un tema
// claro y uno oscuro: se le pasa el tema resuelto de Hermes y no se tocan sus
// tonos, que están afinados para el sombreado de cuatro caras.

import { traceRepr } from "@hermes/shared";
import { DOJO_FIGURES } from "./registry";
import type { LiveFrame } from "./types";
import { Mesa } from "./mesa/Mesa";
import { useTheme } from "@/state/ThemeProvider";
import "../iso/iso.css";

export function hasDojoFigure(itemId: string): boolean {
  return itemId in DOJO_FIGURES;
}

export function DojoFigure({
  itemId,
  reveal,
  live,
  theme,
  className = "",
}: {
  itemId: string;
  /** Mostrar el mecanismo (problema pasado o rendido; siempre en un concepto). */
  reveal: boolean;
  /** Ejecución real del alumno: con ella la máquina se mueve con SU código. */
  live?: LiveFrame;
  /** Forzar un tema (QA); si no, el de Hermes. */
  theme?: "light" | "dark";
  className?: string;
}) {
  const hermes = useTheme();
  const resolved = theme ?? hermes.resolved;
  const entry = DOJO_FIGURES[itemId];
  if (live && !entry?.live?.(live)) {
    return (
      <div className={`iso dojo-figure ${className}`} data-theme={resolved}>
        <Mesa
          steps={live.trace.steps}
          step={live.step}
          fn={live.fn}
          title={live.trace.call ?? "Tu programa"}
          readout={mesaReadout(live)}
        />
      </div>
    );
  }
  if (!entry) return null;
  return (
    <div className={`iso dojo-figure ${className}`} data-theme={resolved}>
      {entry.render({ theme: resolved, reveal, live })}
    </div>
  );
}

/** Qué pasa en este paso, en una línea: la variable que cambió o lo que devolvió. */
function mesaReadout({ trace, step, fn }: LiveFrame): string {
  const cur = trace.steps[step];
  if (!cur) return "";
  if (cur.event === "return" && cur.fn === "<module>") return "fin del programa";
  if (cur.event === "return" && (fn == null || cur.fn === fn)) return `devuelve ${traceRepr(cur.ret)}`;
  if (cur.event === "exception") return `línea ${cur.line} · ${cur.exc ?? "error"}`;
  const prev = trace.steps[step - 1];
  const changed = Object.keys(cur.locals).find(
    (k) => cur.locals[k].t !== "fn" && JSON.stringify(prev?.locals[k]) !== JSON.stringify(cur.locals[k]),
  );
  return changed
    ? `línea ${cur.line} · ${changed} = ${traceRepr(cur.locals[changed])}`
    : `línea ${cur.line}`;
}
