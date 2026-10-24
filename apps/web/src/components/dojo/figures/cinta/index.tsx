// Máquina "cinta" del Dojo (Fig 3 · repetir): una cinta transportadora lleva las
// fichas de la lista, una por vuelta del for, bajo un lector hasta la estación
// que hace de cuerpo del bucle (contador, trampa + contador, podio o prensa).
// Exporta, por id de lección, la figura que la explica (ver ../registry.ts).
// En los problemas también se mueve con el código real del alumno (`live`):
// trace.ts decide si su ejecución cabe en la cinta; si no, el Dojo usa la mesa.
import type { FigureEntry } from "../types";
import { CintaFigure } from "./figure";
import { CINTA_IDS, specOf } from "./model";
import { analysisOf } from "./trace";

export const FIGURES: Record<string, FigureEntry> = Object.fromEntries(
  CINTA_IDS.flatMap((id) => {
    const spec = specOf(id);
    if (!spec) return [];
    const entry: FigureEntry = {
      render: ({ reveal, live }) => <CintaFigure spec={spec} reveal={spec.concept || reveal} live={live} />,
    };
    if (!spec.concept) entry.live = (frame) => analysisOf(spec.station, frame) !== null;
    return [[id, entry]];
  }),
);
