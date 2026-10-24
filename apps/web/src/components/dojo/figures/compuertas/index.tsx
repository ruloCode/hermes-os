// Máquina "compuertas" del Dojo (Fig 2): una clasificadora de fichas para
// if / elif / else. Exporta, por id de lección, la figura que la explica (ver
// ../registry.ts). En los problemas también tiene modo en vivo: la misma
// máquina armada con las compuertas del código del alumno (live-model.ts).
import type { FigureEntry } from "../types";
import { CompuertasFigure, CompuertasLiveFigure } from "./figure";
import { analyze } from "./live-model";
import { LESSON_IDS, lessonOf } from "./model";

export const FIGURES: Record<string, FigureEntry> = Object.fromEntries(
  LESSON_IDS.map((id) => {
    const problem = lessonOf(id).problem;
    const entry: FigureEntry = {
      // En un concepto el mecanismo siempre se ve; en un problema, solo al resolverlo.
      // En vivo `reveal` no aplica: lo que se ve es el código del propio alumno.
      render: ({ reveal, live }) =>
        live ? <CompuertasLiveFigure frame={live} /> : <CompuertasFigure id={id} reveal={problem ? reveal : true} />,
    };
    // Solo si el código tiene forma de clasificadora (una cadena plana de decisiones).
    if (problem) entry.live = (frame) => analyze(frame) !== null;
    return [id, entry];
  }),
);
