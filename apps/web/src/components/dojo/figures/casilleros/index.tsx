// Máquina "casilleros" del Dojo (Fig 7 · hash map: dict y set): un gabinete de
// seis casilleros con una rueda que calcula a cuál va cada clave. Una sola
// máquina con variantes por datos para las ocho lecciones de la unidad (el
// capítulo «La bodega»). En los problemas también se mueve EN VIVO con el
// código del alumno: los casilleros son el dict o set que SU código arma; si no
// arma ninguno (un doble for con listas), el modo en vivo usa la mesa.
import { dojoItem } from "@hermes/shared";
import type { FigureEntry } from "../types";
import { CasillerosFigure } from "./figure";
import { CasillerosTrace } from "./live-trace";
import { FIGURE_IDS, titleOf } from "./model";
import { canShow, sceneOf } from "./trace";

export const FIGURES: Record<string, FigureEntry> = Object.fromEntries(
  FIGURE_IDS.map((id) => {
    const isProblem = Boolean(dojoItem(id)?.problem);
    const entry: FigureEntry = {
      render: ({ reveal, live }) => {
        const scene = live && isProblem ? sceneOf(id, live) : null;
        if (live && scene) return <CasillerosTrace title={titleOf(id)} scene={scene} step={live.step} />;
        return <CasillerosFigure id={id} reveal={reveal} />;
      },
    };
    if (isProblem) entry.live = (frame) => canShow(frame);
    return [id, entry];
  }),
);
