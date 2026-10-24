"use client";

// La tarjeta de la cinta: Fig 3, título, pista, readout y, debajo, la leyenda y
// un pie de foto que dice solo cosas verdaderas (sus números salen del modelo).
import { Plate } from "../../iso/react/draw";
import type { LegendKey } from "../../iso/iso-kit";
import { CintaLive } from "./live";
import { momentOf, readoutOf, stepsOf, type Example, type Spec } from "./model";
import { analysisOf, liveMomentOf, type LiveAnalysis } from "./trace";
import type { LiveFrame } from "../types";
import "./cinta.css";

const TITLES: Record<string, string> = {
  "f-repetir": "Repetir: la cinta",
  "f-suma-hasta": "Suma hasta n",
  "f-contar-pares": "Contar pares",
  "f-mayor": "El mayor",
  "f-fizzbuzz": "FizzBuzz",
};

const join = (parts: string[]) => (parts.length < 2 ? parts.join("") : `${parts.slice(0, -1).join(", ")} y ${parts[parts.length - 1]}`);

const result = (example: Example) => (Array.isArray(example.expected) ? `${example.expected.length} textos` : String(example.expected));

function keysOf(spec: Spec, reveal: boolean): LegendKey[] {
  const now: LegendKey = { mark: "lit", label: spec.station === "stamp" || spec.concept ? "La ficha de esta vuelta" : "La ficha de esta vuelta (x)" };
  if (!reveal) {
    return [
      now,
      { mark: "raised", label: "La tapa: lo que tu función tiene que hacer" },
      spec.station === "stamp" ? { mark: "flat", label: "La bandeja: lo que tiene que salir, en orden" } : { mark: "flat", label: "La tarjeta: el resultado que te piden" },
    ];
  }
  if (spec.station === "sum") return [now, { mark: "raised", label: "El contador: el acumulador total" }, { mark: "flat", label: "La tolva: lo que falta por recorrer" }];
  if (spec.station === "count") return [now, { mark: "raised", label: "El contador: cuenta" }, { mark: "flat", label: "La trampa: se abre con los impares" }];
  if (spec.station === "best") return [now, { mark: "raised", label: "El podio: el mejor hasta ahora" }, { mark: "flat", label: "Bandejas: los que no ganaron" }];
  return [now, { mark: "raised", label: "La prensa: estampa el texto" }, { mark: "flat", label: "La bandeja: la lista que devuelves" }];
}

function captionOf(spec: Spec, reveal: boolean): string {
  const calls = spec.examples.map((example) => `${example.call} → ${result(example)}`);
  if (spec.concept) {
    const [first, ...rest] = spec.examples;
    const totals = first ? stepsOf("sum", first.items).map((step) => String(step.acc)) : [];
    const others = rest.map((example) => `con ${example.call.replace(/^for \w+ in /, "")} termina en ${example.expected}`);
    return `Cada vuelta del for, la cinta avanza una ficha, el lector la toma y el contador se la suma al total. ${first ? `${first.call.replace(/^for \w+ in /, "")} da ${join(first.items.map(String))}, y el total pasa por ${join(totals)}` : ""}${others.length ? `; ${others.join("; ")}` : ""}.`;
  }
  if (!reveal) {
    return `La lista entra a la máquina ficha por ficha, una por vuelta del for; lo que pasa bajo la tapa lo escribes tú. Tiene que salir: ${calls.join(" · ")}.`;
  }
  if (spec.station === "sum") return `Cada vuelta, la cinta avanza una ficha y el contador le suma su valor; sin fichas, el total se queda en 0. ${calls.join(" · ")}.`;
  if (spec.station === "count") return `Cada vuelta, la ficha par cruza al contador y suma 1; con una impar la trampa se abre y cae a la bandeja. ${calls.join(" · ")}.`;
  if (spec.station === "best")
    return `La primera ficha sube al podio; cada ficha mayor que la del podio la empuja a la bandeja de atrás y se queda; las demás caen por la trampa. ${calls.join(" · ")}.`;
  return `Cada vuelta, la prensa estampa la ficha (múltiplo de 3: Fizz · de 5: Buzz · de los dos: FizzBuzz · si no, el número) y la deja en su casilla, en orden. ${calls.join(" · ")}.`;
}

function labelOf(spec: Spec, reveal: boolean) {
  const what =
    spec.station === "stamp"
      ? "una prensa que estampa cada ficha y una bandeja de salida"
      : spec.station === "best"
        ? "una trampa y un podio para el mayor"
        : spec.station === "count"
          ? "una trampa y un contador de rodillos"
          : "un contador de rodillos";
  return `Una cinta transportadora lleva fichas numeradas, una por vuelta del for, bajo un lector hasta ${what}${reveal ? "" : ", tapado por ahora"}.`;
}

/** La leyenda en vivo nombra TUS variables. */
function liveKeysOf(a: LiveAnalysis): LegendKey[] {
  const token: LegendKey = { mark: "lit", label: `La ficha bajo el lector: ${a.loop.tokenVar}` };
  if (a.layout === "stamp") return [token, { mark: "raised", label: `La bandeja: ${a.acc}, la lista que armas` }];
  if (a.layout === "best") return [token, { mark: "raised", label: `El podio: ${a.acc}` }, { mark: "flat", label: "La trampa: las vueltas que no lo cambian" }];
  const keys: LegendKey[] = [token, { mark: "raised", label: `El contador: ${a.acc}` }];
  if (a.layout === "count") keys.push({ mark: "flat", label: `La trampa: las vueltas en que ${a.acc} no cambia` });
  return keys;
}

function liveCaptionOf(a: LiveAnalysis): string {
  const source = a.loop.iterable ? `lo que recorre tu for (${a.loop.iterable})` : `los valores que toma ${a.loop.tokenVar} en tu while`;
  const fichas = a.items.length ? `${a.items.length} ${a.items.length === 1 ? "ficha" : "fichas"}: ${a.items.slice(0, 8).join(", ")}${a.items.length > 8 ? ", …" : ""}` : "ninguna ficha";
  const vueltas = a.starts.length === a.items.length ? "" : ` Tu bucle dio ${a.starts.length} ${a.starts.length === 1 ? "vuelta" : "vueltas"}.`;
  const where = a.layout === "stamp" ? "la bandeja" : a.layout === "best" ? "el podio" : "el contador";
  return `En vivo con tu código, ${a.call}. Las fichas son ${source}: ${fichas}.${vueltas} ${where[0]!.toUpperCase()}${where.slice(1)} muestra ${a.acc} tal como lo tiene tu código en cada paso.`;
}

function LiveCinta({ spec, frame, analysis }: { spec: Spec; frame: LiveFrame; analysis: LiveAnalysis }) {
  return (
    <div className="cinta">
      <Plate
        fig="Fig 3"
        title={`En vivo · ${analysis.fn}`}
        hint="Tu código, paso a paso"
        readout={liveMomentOf(analysis, frame.step).readout}
        keys={liveKeysOf(analysis)}
        caption={liveCaptionOf(analysis)}
      >
        <CintaLive spec={spec} reveal label={`${labelOf(spec, true)} En vivo: ${liveCaptionOf(analysis)}`} live={analysis} step={frame.step} />
      </Plate>
    </div>
  );
}

export function CintaFigure({ spec, reveal, live }: { spec: Spec; reveal: boolean; live?: LiveFrame }) {
  const analysis = live ? analysisOf(spec.station, live) : null;
  if (live && analysis) return <LiveCinta spec={spec} frame={live} analysis={analysis} />;
  const first = spec.examples[0]!;
  return (
    <div className="cinta">
      <Plate
        fig="Fig 3"
        title={TITLES[spec.id] ?? "La cinta"}
        hint="← → ejemplo · espacio pausa"
        readout={readoutOf(spec, first, momentOf(spec.station, first, 0), reveal)}
        keys={keysOf(spec, reveal)}
        caption={captionOf(spec, reveal)}
      >
        <CintaLive spec={spec} reveal={reveal} label={labelOf(spec, reveal)} />
      </Plate>
    </div>
  );
}
