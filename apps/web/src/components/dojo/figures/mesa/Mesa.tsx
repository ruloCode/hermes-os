"use client";

// LA MESA DE TRABAJO (Fig 0): lo que hizo TU código, paso a paso, como piezas
// sobre un banco. Cada variable es una bandeja con su nombre grabado: un número
// o un texto es un bloque, una lista es una fila de celdas, un dict son pares
// clave → valor. La variable que acaba de cambiar se enciende, y al terminar la
// función aparece la bandeja de lo que devolvió.
//
// No inventa nada: pinta los `locals` reales de la traza (packages/shared/src/
// dojo.ts). Es la máquina por defecto del modo en vivo: sirve para CUALQUIER
// código, así que existe aunque la lección todavía no tenga su máquina propia.

import * as React from "react";
import { changedVars, traceRepr, type PyTraceStep, type TraceValue } from "@hermes/shared";
import { Dots, FaceText, IsoFigure, Line, Plate, Solid } from "../../iso/react/draw";
import { BENCH, blockOn, cellsOn, RETURN_SLOT, SLOT_ORDER, TRAYS, WIDTH, HEIGHT, SLOTS, type Piece } from "./geometry";

const LABEL =
  "Una mesa de trabajo vista en perspectiva, con seis bandejas sobre la tabla. Cada bandeja lleva grabado el nombre de una variable de tu código y encima su valor: un bloque para un número o un texto, una fila de celdas para una lista y pares clave-valor para un diccionario. La variable que acaba de cambiar se ilumina.";

function piecesOf(slot: number, v: TraceValue): Piece[] {
  const plan = SLOTS[slot];
  if (v.t === "list" || v.t === "tuple" || v.t === "set") {
    const texts = v.v.map(traceRepr);
    if (v.n > 6) texts.splice(5, texts.length, `+${v.n - 5}`);
    return v.n === 0 ? [blockOn(plan, v.t === "set" ? "set()" : v.t === "list" ? "[ ]" : "( )")] : cellsOn(plan, texts, false);
  }
  if (v.t === "dict") {
    if (v.n === 0) return [blockOn(plan, "{ }")];
    return cellsOn(
      plan,
      v.v.slice(0, 3).flatMap(([k, x]) => [traceRepr(k), traceRepr(x)]),
      true,
    );
  }
  return [blockOn(plan, traceRepr(v))];
}

export interface MesaProps {
  steps: PyTraceStep[];
  step: number;
  /** Nombre de la función del ejercicio (null = programa suelto). */
  fn: string | null;
  title: string;
  readout: string;
  hint?: string;
}

export function Mesa({ steps, step, fn, title, readout, hint = "Tus variables, paso a paso" }: MesaProps) {
  const cur = steps[step];
  const prev = step > 0 ? steps[step - 1] : undefined;

  // Orden estable: por primera aparición en la traza de ese frame, para que
  // una variable no salte de bandeja entre pasos.
  const order = React.useMemo(() => {
    const seen: string[] = [];
    for (const s of steps) {
      if (fn && s.fn !== fn && s.fn !== "<module>") continue;
      for (const k of Object.keys(s.locals)) if (!seen.includes(k) && s.locals[k].t !== "fn") seen.push(k);
    }
    return seen;
  }, [steps, fn]);

  const vars = order.filter((k) => cur?.locals[k] && cur.locals[k].t !== "fn").slice(0, RETURN_SLOT);
  const changed = new Set(cur ? changedVars(prev, cur) : []);
  const ret = cur?.event === "return" && cur.fn === fn ? cur.ret : undefined;

  return (
    <Plate fig="Fig 0" title={title} hint={hint} readout={readout}>
      <IsoFigure width={WIDTH} height={HEIGHT} label={LABEL}>
        <path className="iso-halo" d={BENCH.halo} />
        {BENCH.feet.map((f, i) => (
          <Solid key={`f${i}`} paths={f} tone="lo" crease="faint" />
        ))}
        {BENCH.legs.slice(0, 2).map((l, i) => (
          <Solid key={`lb${i}`} paths={l} tone="mid" crease="faint" />
        ))}
        <Solid paths={BENCH.stretcher} tone="lo" crease="faint" />
        {BENCH.legs.slice(2).map((l, i) => (
          <Solid key={`lf${i}`} paths={l} tone="mid" crease="faint" />
        ))}
        <Solid paths={BENCH.top} tone="mid" crease="faint" />
        <Line d={BENCH.groove} tone="faint" />
        <Line d={BENCH.ruler.minor} tone="lo" />
        <Line d={BENCH.ruler.major} tone="mid" />
        <Dots points={BENCH.screws} size={0.55} tone="mid" />
        <Solid paths={BENCH.plate} tone="lo" crease="none" />

        {SLOT_ORDER.map((i) => {
          const t = TRAYS[i];
          const name = i === RETURN_SLOT ? (ret ? "return" : "") : vars[i];
          const value = i === RETURN_SLOT ? ret : name ? cur?.locals[name] : undefined;
          const lit = i === RETURN_SLOT ? Boolean(ret) : Boolean(name && changed.has(name));
          return (
            <g key={`tray${i}`} data-part="tray">
              <Solid paths={t.base} tone={name ? (lit ? "hi" : "mid") : "lo"} crease="faint" lit={lit} />
              <Line d={t.inlay} tone="faint" />
              {name ? (
                <FaceText transform={t.label} size={6.6} tone={lit ? "hi" : "mid"}>
                  {name}
                </FaceText>
              ) : null}
              {value
                ? piecesOf(i, value).map((p, j) => (
                    <g key={j}>
                      <Solid paths={p.solid} tone={lit ? "hi" : "mid"} crease="faint" lit={lit} />
                      <FaceText transform={p.textAt} size={p.size} tone="hi">
                        {p.text}
                      </FaceText>
                    </g>
                  ))
                : null}
            </g>
          );
        })}
      </IsoFigure>
    </Plate>
  );
}
