// La tarjeta de la Fig 2: esquina con el título, la pista de uso, el readout vivo
// y, debajo, la leyenda y un pie de foto que solo dice cosas que el modelo calcula.

import { Plate } from "../../iso/react/draw";
import type { LegendKey } from "../../iso/iso-kit";
import type { LiveFrame } from "../types";
import { artFor } from "./art";
import { CompuertasLive, CompuertasMachine } from "./live";
import { analyze } from "./live-model";
import { evaluate, lessonOf, type Lesson } from "./model";
import "./compuertas.css";

const list = (items: string[]) => (items.length > 1 ? `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}` : items[0] ?? "");

function captionOf(lesson: Lesson, reveal: boolean): string {
  const examples = lesson.examples;
  const said = (i: number) => lesson.groups[examples[i].group][examples[i].bin].card;
  const outcomes = list(examples.map((e, i) => `${e.value} → ${said(i)}`));
  if (lesson.id === "f-decidir") {
    const quiz = examples.find((e) => e.group === 1);
    const quizBranches = lesson.groups[1];
    const truths = quiz ? quizBranches.filter((b) => b.cond !== null && evaluate(b.cond, quiz.value)).map((b) => b.cond as string) : [];
    const winner = quiz ? quizBranches[quiz.bin].card : "";
    return `Una clasificadora: la ficha rueda por el canal y se detiene en cada compuerta, en orden. La primera cuya condición se cumple enciende su lámpara y abre su trampilla; si ninguna se cumple, la ficha llega al final y cae en el cajón del else. Con ${quiz?.call}: ${list(truths)} son ciertas, pero la ficha cae en ${winner} y la segunda compuerta ni la mira.`;
  }
  if (!reveal) {
    return `Qué entra y adónde debe caer: ${outcomes}. Cómo decide la máquina queda bajo la capota hasta que resuelvas el ejercicio.`;
  }
  const gates = lesson.groups[0].filter((b) => b.cond !== null).map((b) => b.cond as string);
  if (lesson.id === "f-es-par") {
    return `Una sola compuerta, ${gates[0]}: si lo que sobra al dividir entre 2 es 0 se abre y la ficha cae en True; si no, sigue hasta el else, False. ${outcomes}. La comparación ya es el booleano.`;
  }
  if (lesson.id === "f-bisiesto") {
    const rules = list(lesson.groups[0].filter((b) => b.cond !== null).map((b) => `${b.cond} → ${b.card}`));
    return `${gates.length} compuertas en orden, de la regla más específica a la más general: ${rules}; lo que no pasa ninguna cae en ${lesson.groups[0][lesson.bins - 1].card}. ${outcomes}. Por eso 1900 no llega a la tercera: la de 100 la atrapa antes.`;
  }
  const last = lesson.groups[0][lesson.bins - 1].card;
  return `${gates.length} compuertas en orden, cada una mira solo su tope: ${list(gates)}; lo que pasa las ${gates.length} cae en ${last}. Como gana la primera que se cumple, los bordes quedan bien: ${outcomes}.`;
}

function keysOf(reveal: boolean): LegendKey[] {
  const keys: LegendKey[] = [{ mark: "raised", label: "La ficha con su valor" }];
  if (reveal) keys.push({ mark: "lit", label: "La compuerta cuya condición se cumple" });
  keys.push({ mark: "flat", label: "Cada cajón = lo que devuelve esa rama" });
  return keys;
}

export function CompuertasFigure({ id, reveal }: { id: string; reveal: boolean }) {
  const lesson = lessonOf(id);
  const first = lesson.examples[0];
  return (
    <Plate
      fig="Fig 2"
      title={lesson.title}
      hint="← → · clic"
      readout={`${first.call} → …`}
      keys={keysOf(reveal)}
      caption={captionOf(lesson, reveal)}
    >
      <CompuertasLive key={`${id}:${reveal}`} id={id} reveal={reveal} />
    </Plate>
  );
}

/**
 * Modo en vivo: la clasificadora armada con LAS compuertas del código del
 * alumno, en el paso que está mirando el reproductor de la traza.
 */
export function CompuertasLiveFigure({ frame }: { frame: LiveFrame }) {
  const machine = analyze(frame);
  if (!machine) return null;
  const step = Math.max(0, Math.min(frame.step, machine.times.length - 1));
  const art = artFor(`live:${machine.key}`, machine.lesson);
  return (
    <Plate
      fig="Fig 2"
      title="Tus compuertas"
      readout={machine.readouts[step]}
      keys={[
        { mark: "raised", label: "La ficha: el valor con que se llamó" },
        { mark: "lit", label: "La compuerta que se cumplió" },
        { mark: "flat", label: "Cada cajón = lo que devuelve esa rama" },
        ...(machine.want !== null ? [{ mark: "dotted" as const, label: "Donde debía caer" }] : []),
      ]}
      caption="Las compuertas son tus if / elif / else en el orden en que los escribiste, con la condición tal cual. La ficha se detiene en cada una; la primera que se cumple abre su trampilla y la ficha cae a ese cajón con lo que tu función devolvió de verdad."
    >
      <CompuertasMachine
        key={machine.key}
        art={art}
        reveal
        live={{
          t: machine.times[step],
          readout: machine.readouts[step],
          coin: machine.coin,
          want: step >= machine.returnStep ? machine.want : null,
        }}
      />
    </Plate>
  );
}
