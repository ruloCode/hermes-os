// Máquina "pines" del Dojo (Fig 5): complejidad, n contra n², la fórmula contra
// el bucle. Un tablero de pines con un puente (el for de afuera), un cabezal (el
// de adentro) que hunde un pin por paso, un contador de pasos, una perilla de n
// y un cronómetro. Exporta, por id de lección, su figura (ver ../registry.ts).
import type { FigureEntry } from "../types";
import { PinesFigure, PinesTraceFigure } from "./figure";
import { canShow } from "./trace";

const entry = (id: string): FigureEntry => ({ render: ({ reveal }) => <PinesFigure id={id} reveal={reveal} /> });

// En el problema, la máquina también cuenta los pasos del código del alumno:
// cada línea que corre hunde un pin (ver trace.ts). Si la ejecución no tiene un
// n entero que contar, el modo en vivo cae a la mesa de trabajo.
const suma: FigureEntry = {
  render: ({ reveal, live }) => (live && canShow(live) ? <PinesTraceFigure frame={live} /> : <PinesFigure id="c-suma-gigante" reveal={reveal} />),
  live: canShow,
};

export const FIGURES: Record<string, FigureEntry> = {
  "c-pasos": entry("c-pasos"),
  "c-crece": entry("c-crece"),
  "c-suma-gigante": suma,
};
