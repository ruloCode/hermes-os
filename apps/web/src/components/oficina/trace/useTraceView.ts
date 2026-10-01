"use client";

// Una traza lista para pintar: los eventos del store, el reductor (pasos,
// errores, correcciones), el inventario de tools y el resumen. El mismo hook
// sirve en vivo y en la repetición: solo cambia de dónde llegaron los eventos.

import { useMemo } from "react";
import { buildInventory, redactInventory, reduceTrace, traceSummary, type PublicViewContext, type ReducedTrace, type ToolCard } from "@hermes/shared";
import { useTrace, type TraceData } from "@/lib/oficina/trace-store";

export interface TraceView {
  data: TraceData;
  reduced: ReducedTrace;
  cards: ToolCard[];
  /** Al cerrar: "4 vueltas · 11 tools · 2 errores…". En curso: lo mismo con "en curso". */
  summary: string;
}

/** `pv`: con la vista pública prendida, las descripciones de skills personales no llegan a las fichas. */
export function useTraceView(id: string | null, pv?: { on: boolean; ctx: PublicViewContext }): TraceView {
  const data = useTrace(id);
  const reduced = useMemo(() => reduceTrace(data.events), [data.events]);
  const cards = useMemo(
    () =>
      buildInventory({
        source: data.meta?.source ?? (reduced.init?.source ?? "sdk"),
        init: reduced.init,
        capture: pv?.on ? redactInventory(data.inventory, pv.ctx) : data.inventory,
        sdk: data.config?.sdk,
        hermesTools: data.config?.sdk?.hermesTools,
        cliDenyRules: data.config?.cliDenyRules,
        reduced,
      }),
    [data.meta, data.inventory, data.config, reduced, pv?.on, pv?.ctx],
  );
  const summary = useMemo(() => {
    if (!data.events.length) return "";
    const s = traceSummary(reduced);
    return reduced.done ? s : `en curso · ${s}`;
  }, [reduced, data.events.length]);
  return { data, reduced, cards, summary };
}
