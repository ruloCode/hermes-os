// Máquina "ventana" del Dojo (Fig 6): una sola pasada y la ventana deslizante.
// Un riel con una hilera de barras (la altura es cada valor; la cara de arriba
// del riel es el cero) y un carro que lo recorre una vez. En c-ganancia el carro
// lleva un tope que baja al precio más bajo visto; en c-ventana, un cabezal de k
// sondas que suma lo que tiene debajo. Con reveal=false solo se ve el pedido
// (las barras y la respuesta marcada) y el carro queda trabado en casa.
import { Plate } from "../../iso/react/draw";
import type { FigureEntry } from "../types";
import { VentanaLive } from "./live";
import { VentanaTrace, liveFits } from "./trace-live";
import type { LiveFrame } from "../types";
import { answerOf, orderStop, passStops, type MachineId } from "./model";
import { MACHINES } from "./geometry";
import "./ventana.css";

const TITLE: Record<MachineId, string> = { "c-ganancia": "Una sola pasada", "c-ventana": "Ventana deslizante" };

function labelOf(id: MachineId, reveal: boolean) {
  if (id === "c-ganancia") {
    return reveal
      ? "Banco con una barra por día; su altura es el precio. Un carro recorre el riel de izquierda a derecha una sola vez: su sonda toca la barra de hoy, un tope anillado baja al precio más bajo visto hasta hoy y la parte de la barra por encima del tope, encendida, es lo que ganarías vendiendo hoy. La carátula del carro marca esa ganancia con la aguja y la mejor con la marca de arrastre."
      : "Banco con una barra por día; su altura es el precio. Pedido: el collar de la barra de compra y el de la de venta están a la misma altura, y lo que la barra de venta sobresale, encendido, es la ganancia que debe salir. El carro está trabado en casa hasta resolverlo.";
  }
  return reveal
    ? "Banco con una barra por número; su altura es el valor y la cara de arriba del riel es el cero, los negativos quedan por debajo. Un carro con un cabezal de k sondas recorre el riel una vez: al avanzar un paso, la barra de la izquierda sale de la ventana y la de la derecha entra. La carátula marca la suma de la ventana y, con la marca de arrastre, la mejor."
    : "Banco con una barra por número; su altura es el valor y la cara de arriba del riel es el cero. Pedido: el bloque de k barras seguidas que más suma está encendido y marcado en la cubierta. El carro está trabado en casa hasta resolverlo.";
}

function captionOf(id: MachineId, reveal: boolean) {
  const { examples } = MACHINES[id].view;
  const ex = examples[0]!;
  const a = answerOf(id, ex);
  if (id === "c-ganancia") {
    const pair = a.buy !== null && a.sell !== null ? `comprar a ${ex.values[a.buy]} (día ${a.buy}) y vender a ${ex.values[a.sell]} (día ${a.sell})` : "no comprar";
    return reveal
      ? `Seis barras, una por día. El carro pasa una sola vez: el tope solo baja (al precio más bajo visto) y la carátula guarda la mejor diferencia con un día posterior. En ${ex.call} lo mejor es ${pair}: ${a.value}.`
      : `El pedido: en ${ex.call} lo mejor es ${pair}, ganancia ${a.value}. Vender va siempre después de comprar. Cuando lo resuelvas se suelta el carro y verás cómo lo encuentra en una sola pasada.`;
  }
  const block = ex.values.slice(a.start!, a.start! + ex.k).join(", ");
  return reveal
    ? `Nueve barras sobre el riel del cero. El cabezal cubre k = ${ex.k} barras; en cada paso sale una por la izquierda y entra otra por la derecha, y la suma cambia solo en esas dos. En ${ex.call} el mejor bloque es ${block}: ${a.value}.`
    : `El pedido: en ${ex.call} el bloque de ${ex.k} seguidos que más suma es ${block}, y suma ${a.value}. Los negativos bajan del riel. Cuando lo resuelvas se suelta el carro.`;
}

function render(id: MachineId, reveal: boolean) {
  const { examples } = MACHINES[id].view;
  const first = reveal ? passStops(id, examples[0]!)[0]! : orderStop(id, examples[0]!);
  const keys =
    id === "c-ganancia"
      ? reveal
        ? [
            { mark: "lit" as const, label: "Lo que ganarías vendiendo hoy" },
            { mark: "raised" as const, label: "El tope: el precio más bajo visto" },
          ]
        : [
            { mark: "lit" as const, label: "La ganancia que debe salir" },
            { mark: "raised" as const, label: "Collares: compra y venta, a la misma altura" },
          ]
      : reveal
        ? [
            { mark: "lit" as const, label: "Las barras dentro de la ventana" },
            { mark: "dotted" as const, label: "El mejor bloque, al final" },
          ]
        : [
            { mark: "lit" as const, label: "El bloque que debe salir" },
            { mark: "dotted" as const, label: "Su lugar en la cubierta" },
          ];
  return (
    <div className="vt-wrap">
      <Plate
        fig="Fig 6"
        title={TITLE[id]}
        hint={reveal ? "← → paso · espacio pausa" : "← → ejemplo · resuélvelo"}
        readout={first.readout}
        keys={keys}
        caption={captionOf(id, reveal)}
      >
        <VentanaLive key={`${id}-${reveal ? 1 : 0}`} id={id} reveal={reveal} label={labelOf(id, reveal)} />
      </Plate>
    </div>
  );
}

// En vivo (el código del alumno corriendo) `reveal` no aplica: mostrar SU
// ejecución no regala la idea. Si su código no encaja, liveFits dice que no y
// el Dojo usa la mesa de trabajo.
function renderLive(id: MachineId, frame: LiveFrame) {
  return <VentanaTrace id={id} frame={frame} title="Tu código en el riel" />;
}

export const FIGURES: Record<string, FigureEntry> = {
  "c-ganancia": {
    render: ({ reveal, live }) => (live ? renderLive("c-ganancia", live) : render("c-ganancia", reveal)),
    live: (frame) => liveFits("c-ganancia", frame),
  },
  "c-ventana": {
    render: ({ reveal, live }) => (live ? renderLive("c-ventana", live) : render("c-ventana", reveal)),
    live: (frame) => liveFits("c-ventana", frame),
  },
};
