// Máquina "prensa" del Dojo (Fig 1 · funciones): una prensa de banco donde los
// argumentos caen por el cargador, el empujador los lleva al troquel y lo que la
// función DEVUELVE sale a la bandeja. En un problema sin resolver la guarda tapa
// el troquel: se ve qué entra y qué debe salir (el pedido), no cómo se hace.
import type { LegendKey } from "../../iso/iso-kit";
import { Plate } from "../../iso/react/draw";
import type { FigureEntry } from "../types";
import { PrensaLive } from "./live";
import { PrensaTraced } from "./traced";
import { canShow } from "./trace";
import { callOf, lessonOf, phaseAt, py, readoutOf, RESTING, type Lesson } from "./model";
import "./prensa.css";

const IDS = ["f-funciones", "f-doble", "f-saludo", "f-segundos"];

function captionOf(lesson: Lesson, reveal: boolean): string {
  const pairs = lesson.examples
    .filter((e) => e.out !== null)
    .map((e) => `${callOf(e)} → ${py(e.out)}`)
    .join(", ");
  if (lesson.concept) {
    const print = lesson.examples.find((e) => e.printed !== null);
    const tail = print
      ? ` En cambio ${callOf(print)} solo imprime: el ${py(print.printed)} se enciende en el visor y a la bandeja no llega nada, así que devuelve None.`
      : "";
    return `Una prensa de banco: los argumentos caen por el cargador, el empujador los lleva al troquel y lo que la función devuelve con return sale a la bandeja. ${pairs}.${tail}`;
  }
  const inside: Record<string, string> = {
    saludo: " Por dentro, el troquel trae el molde «Hola, _!» y el nombre entra en el hueco.",
    doble: " Por dentro, el troquel lleva grabado ×2: la misma cuenta para cualquier número.",
    segundos: " Por dentro, el troquel convierte las dos fichas en una: horas × 3600 más minutos × 60.",
  };
  const open = reveal ? inside[lesson.fn] ?? "" : " La guarda sigue cerrada: cómo se arma la salida es tu parte.";
  return `La prensa de ${lesson.fn}: cada ficha que entra debe salir convertida en su pedido. ${pairs}.${open}`;
}

function keysOf(lesson: Lesson): LegendKey[] {
  const keys: LegendKey[] = [
    { mark: "raised", label: lesson.examples.some((e) => e.args.length > 1) ? "Lo que entra: los argumentos" : "Lo que entra: el argumento" },
    { mark: "lit", label: "Lo que sale: el return" },
    { mark: "dotted", label: lesson.concept ? "Dónde cae lo devuelto" : "El pedido: lo que debe salir" },
  ];
  if (lesson.visor) keys.push({ mark: "dim", label: "El visor: lo que muestra print (no sale)" });
  return keys;
}

function PrensaFigure({ id, reveal }: { id: string; reveal: boolean }) {
  const lesson = lessonOf(id);
  if (!lesson) return null;
  const shown = lesson.concept || reveal;
  const first = lesson.examples[0]!;
  const label = `Prensa de banco para ${lesson.fn}: ${lesson.examples
    .map((e) => `${callOf(e)} ${e.out === null ? "devuelve None" : `devuelve ${py(e.out)}`}`)
    .join("; ")}.`;
  return (
    <div className="prensa-wrap">
      <Plate
        fig="Fig 1"
        title={lesson.concept ? "Entra → sale" : `${lesson.fn}: entra → sale`}
        hint="← → ejemplo · espacio pausa"
        readout={readoutOf(first, 0, lesson.examples.length, phaseAt(RESTING))}
        keys={keysOf(lesson)}
        caption={captionOf(lesson, shown)}
      >
        <PrensaLive lesson={lesson} reveal={shown} label={label} />
      </Plate>
    </div>
  );
}

export const FIGURES: Record<string, FigureEntry> = Object.fromEntries(
  IDS.map((id): [string, FigureEntry] => [
    id,
    {
      // En vivo la prensa pinta lo que hizo el código del alumno (traced.tsx);
      // sin traza, el guion con los ejemplos del catálogo.
      render: ({ reveal, live }) => (live ? <PrensaTraced frame={live} /> : <PrensaFigure id={id} reveal={reveal} />),
      // El concepto no tiene función que trazar: solo los problemas van en vivo.
      live: id === "f-funciones" ? undefined : canShow,
    },
  ]),
);
