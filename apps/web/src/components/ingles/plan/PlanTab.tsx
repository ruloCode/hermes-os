"use client";

// Pestaña PLAN de /ingles: la ruta al centro (lo que se elige) y el riel de
// progreso a la derecha (lo que se lee). Misma gramática que el resto de
// vistas v5: sin cajas alrededor de las columnas, una hairline las separa.

import { useEffect, useState } from "react";
import type { EnglishPlanPayload } from "@hermes/shared";
import { ScrollArea } from "@/components/ui/ScrollArea";
import { PanelState } from "@/components/ui/PanelState";
import { PlanPath } from "./PlanPath";
import { PlanRail } from "./PlanRail";

export function PlanTab({
  plan,
  error,
  onStart,
}: {
  plan: EnglishPlanPayload | null;
  error: string | null;
  onStart: (lessonId: string) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  // Sin elección, el detalle abierto es el de la lección que toca.
  useEffect(() => {
    if (selected == null && plan?.current) setSelected(plan.current);
  }, [plan?.current, selected]);

  if (!plan)
    return error ? (
      <PanelState kind="error" title="No pude cargar el plan" hint={error} />
    ) : (
      <PanelState kind="loading" title="Cargando tu plan…" />
    );

  return (
    <div className="grid min-h-0 flex-1 grid-cols-12 gap-3 max-lg:auto-rows-min max-lg:overflow-y-auto lg:grid-rows-[minmax(0,1fr)] lg:gap-0">
      <ScrollArea fade="y" className="col-span-12 -mt-3 min-h-0 pt-3 lg:col-span-8 lg:pr-8">
        <div className="mx-auto w-full max-w-xl">
          <PlanPath
            plan={plan}
            selectedId={selected}
            onSelect={(id) => setSelected((cur) => (cur === id ? null : id))}
            onStart={onStart}
          />
        </div>
      </ScrollArea>
      <aside
        aria-label="Progreso"
        className="col-span-12 flex min-h-0 flex-col border-line lg:col-span-4 lg:border-l lg:pl-5"
      >
        <ScrollArea rail fade="y" className="-mt-3 min-h-0 flex-1 pt-3 pr-1">
          <PlanRail plan={plan} onContinue={onStart} />
        </ScrollArea>
      </aside>
    </div>
  );
}
