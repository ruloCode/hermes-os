// La tarjeta de la máquina "pines": Fig 5, título, pista, readout, leyenda y una
// leyenda verdadera, con los números calculados del mismo modelo que la mueve.
import { Plate } from "../../iso/react/draw";
import type { LegendKey } from "../../iso/iso-kit";
import { traceRepr } from "@hermes/shared";
import type { LiveFrame } from "../types";
import { PinesLive } from "./live";
import { PinesTraceLive } from "./trace-live";
import { projection, readoutOf, shapeOf } from "./trace";
import { STEPS_PER_SECOND, SUMA, dots, lessonOf, readoutAt, trackOf, triangle } from "./model";
import "./pines.css";

function captionOf(id: string, reveal: boolean): { keys: LegendKey[]; caption: string } {
  const lesson = lessonOf(id, reveal);
  if (id === "c-pasos") {
    const big = lesson.detents[lesson.detents.length - 2].n;
    return {
      keys: [
        { mark: "lit", label: "Pin hundido: un paso" },
        { mark: "raised", label: "Pin de pie: aún no se cuenta" },
      ],
      caption: `El puente es el for de afuera y el cabezal el de adentro: un for hunde una fila de n pines, O(n); un for dentro de otro, la rejilla n × n, O(n²). El tablero tiene 10 × 10: con n = ${dots(big)}, como en el código de la lección, cada pin vale un bloque y el contador lleva la cuenta exacta (${dots(big)} y ${dots(big * big)} pasos). El cronómetro da una vuelta por segundo a unos ${dots(STEPS_PER_SECOND)} de pasos por segundo.`,
    };
  }
  if (id === "c-crece") {
    const ns = lesson.detents.map((d) => d.n);
    const last = ns[ns.length - 1];
    const secs = (last * last) / STEPS_PER_SECOND;
    return {
      keys: [
        { mark: "lit", label: "Pin hundido: un bloque de pasos" },
        { mark: "raised", label: "Pin de pie" },
      ],
      caption: `La perilla salta por los n de la lección: ${ns.map(dots).join(", ")}. O(n²) da ${ns.map((n) => dots(n * n)).join(", ")} pasos; O(n), ${ns.map(dots).join(", ")}. No caben ${dots(last * last)} pines: el tablero dibuja 10 × 10 y cada pin vale (n / 10)² pasos, por eso las ruedas de abajo del contador se quedan quietas. A unos ${dots(STEPS_PER_SECOND)} de pasos por segundo, el cronómetro marca ${dots(secs)} s (${Math.floor(secs / 60)} min ${Math.round(secs % 60)} s) para n = ${dots(last)}.`,
    };
  }
  const { cases, limitMs } = SUMA();
  const small = cases.filter((c) => c.n < 1e6);
  const huge = cases.find((c) => c.n >= 1e6);
  const reached = (STEPS_PER_SECOND * limitMs) / 1000;
  if (!reveal) {
    return {
      keys: [
        { mark: "lit", label: "La escalera 1 + 2 + … + n" },
        { mark: "raised", label: "Pines que el for aún no toca" },
      ],
      caption: `Cada vuelta del for suma i y hunde una columna de i pines: ${small.map((c) => `suma_gigante(${c.text}) = ${dots(c.expected)}`).join(" y ")}. Con n = ${huge?.text ?? "10¹²"} el reloj de ${limitMs / 1000} s se acaba a las ${dots(reached)} vueltas: una cienmilésima del camino. Con n mayor que 10, el tablero dibuja la escalera a escala.`,
    };
  }
  return {
    keys: [
      { mark: "lit", label: "La escalera 1 + 2 + … + n" },
      { mark: "raised", label: "La misma escalera, volteada (a media altura)" },
    ],
    caption: `Las dos escaleras encajan en un rectángulo de n × (n + 1) pines, y la escalera es la mitad: n × (n + 1) / 2. Son tres operaciones (×, +, /) sea n 3 o un billón: suma_gigante(${huge?.text ?? "10¹²"}) = ${dots(huge ? triangle(huge.n) : 0n)}.`,
  };
}

export function PinesFigure({ id, reveal }: { id: string; reveal: boolean }) {
  const lesson = lessonOf(id, reveal);
  const { keys, caption } = captionOf(id, reveal);
  return (
    <Plate fig="Fig 5" title={lesson.title} hint="← → cambia n" readout={readoutAt(trackOf(lesson.tour[0]), 0)} keys={keys} caption={caption}>
      <PinesLive id={id} reveal={reveal} />
    </Plate>
  );
}

/** La misma tarjeta, contando los pasos del código del alumno (modo en vivo). */
export function PinesTraceFigure({ frame }: { frame: LiveFrame }) {
  const shape = shapeOf(frame)!;
  const result = frame.trace.result ? traceRepr(frame.trace.result) : null;
  const verdict =
    result == null || frame.trace.error || frame.trace.truncated
      ? frame.trace.truncated
        ? `Tu código no terminó: la traza se cortó a los ${dots(frame.trace.steps.length)} pasos.`
        : ""
      : frame.expected != null
        ? `Devolvió ${result}; se esperaba ${frame.expected}${result === frame.expected ? " ✓" : ": no coincide"}.`
        : `Devolvió ${result}.`;
  const measured = shape.complete
    ? `Medido: ${dots(shape.total)} pasos con n = ${dots(shape.n)}${shape.laps ? ` (${dots(shape.laps)} vuelta${shape.laps === 1 ? "" : "s"} del bucle)` : ""}.`
    : "";
  return (
    <Plate
      fig="Fig 5"
      title="Tus pasos"
      hint="tu código, paso a paso"
      readout={readoutOf(frame, shape)}
      keys={[
        { mark: "lit", label: "Un paso de tu código: una línea que corrió (o el return)" },
        { mark: "raised", label: "Columna = una vuelta de tu bucle (las últimas 10)" },
      ]}
      caption={[verdict, measured, projection(shape).text].filter(Boolean).join(" ")}
    >
      <PinesTraceLive frame={frame} />
    </Plate>
  );
}
