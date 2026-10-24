// La tarjeta de la Fig 7: placa con título, pista, readout y leyenda; adentro la máquina.

import { Plate } from "../../iso/react/draw";
import { CasillerosLive } from "./live";
import { restIndexOf, variantOf } from "./model";

export function CasillerosFigure({ id, reveal }: { id: string; reveal: boolean }) {
  const variant = variantOf(id, reveal);
  const rest = variant.steps[restIndexOf(variant)]!;
  const keys = variant.locked
    ? [
        { mark: "lit" as const, label: "Candado: se abre al resolverlo o al rendirte" },
        { mark: "raised" as const, label: "Tiques: lo que entra y lo que debe salir" },
      ]
    : [
        { mark: "lit" as const, label: "El casillero que marcó la rueda" },
        { mark: "raised" as const, label: "Placa con la clave · lo guardado adentro" },
        { mark: "flat" as const, label: "Tiques: lo que entra y lo que sale" },
      ];
  return (
    <Plate fig="Fig 7" title={variant.title} hint="← → · espacio" readout={rest.readout} keys={keys} caption={variant.caption}>
      <CasillerosLive key={`${id}:${variant.locked}`} variant={variant} />
    </Plate>
  );
}
