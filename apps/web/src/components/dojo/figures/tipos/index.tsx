// Máquina "tipos" (Fig 4): un componedor de imprenta con fichas. Explica las
// listas y los textos como lo que son: fichas en orden en casillas numeradas.
// La regla fija da los índices desde 0; la negativa viaja con el tope (len),
// así -1 siempre es la última; dos carros marcan una rebanada o comparan desde
// los extremos. Ver ../registry.ts.
//
// En los problemas, con `live` la máquina se mueve con el CÓDIGO DEL ALUMNO
// (./trace.ts); si su código no tiene forma de componedor, el Dojo usa la mesa.

import { Plate } from "../../iso/react/draw";
import type { FigureEntry, LiveFrame } from "../types";
import { TiposLive } from "./live";
import { lessonOf, LESSON_IDS } from "./model";
import { liveLessonOf } from "./trace";
import "./tipos.css";

const LABEL =
  "Un componedor de imprenta: una cama larga con una pared al fondo, un cabezal fijo a la izquierda y un tope que se corre y cierra la línea. Las fichas, una por elemento o por letra, se paran en casillas numeradas: la regla de la cama cuenta desde 0 y la regla de abajo, que viaja con el tope, cuenta -1, -2 desde el final. Una caja a la derecha muestra en su ventana lo que sale.";

const LIVE_LABEL =
  "El componedor siguiendo tu código paso a paso: las fichas son el texto o la lista con la que trabajas en ese paso, los carros van donde están tus índices o tu for, y la ventana muestra lo que acumulas y lo que devuelves.";

/** Los problemas de esta máquina: los que pueden seguir el código del alumno. */
const PROBLEMS = new Set(["f-vocales", "f-palindromo", "f-invertir-palabras"]);

function TiposFigure({ id, reveal }: { id: string; reveal: boolean }) {
  const lesson = lessonOf(id, reveal);
  const first = lesson.scenes[0]?.steps[0];
  return (
    <div className="tp-fig">
      <Plate fig="Fig 4" title={lesson.title} hint={lesson.hint} readout={first?.say ?? ""} keys={lesson.keys} caption={lesson.caption}>
        <TiposLive key={`${id}-${reveal ? 1 : 0}`} lesson={lesson} label={LABEL} />
      </Plate>
    </div>
  );
}

function TiposTraceFigure({ id, frame }: { id: string; frame: LiveFrame }) {
  const lesson = liveLessonOf(frame, { id, title: lessonOf(id, true).title })!;
  const scene = lesson.scenes[0]!;
  const step = Math.max(0, Math.min(scene.steps.length - 1, frame.step));
  return (
    <div className="tp-fig">
      <Plate fig="Fig 4" title={lesson.title} hint={lesson.hint} readout={scene.steps[0]?.say ?? ""} keys={lesson.keys} caption={lesson.caption}>
        <TiposLive key={scene.key} lesson={lesson} label={LIVE_LABEL} external={step} />
      </Plate>
    </div>
  );
}

export const FIGURES: Record<string, FigureEntry> = Object.fromEntries(
  LESSON_IDS.map((id) => {
    const always = id === "f-listas" || id === "f-textos";
    const entry: FigureEntry = {
      render: ({ reveal, live }) =>
        live && PROBLEMS.has(id) && liveLessonOf(live, { id, title: lessonOf(id, true).title }) ? (
          <TiposTraceFigure id={id} frame={live} />
        ) : (
          <TiposFigure id={id} reveal={always ? true : reveal} />
        ),
    };
    if (PROBLEMS.has(id)) entry.live = (frame) => liveLessonOf(frame, { id, title: lessonOf(id, true).title }) !== null;
    return [id, entry];
  }),
);
