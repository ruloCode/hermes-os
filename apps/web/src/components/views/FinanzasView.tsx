"use client";

// Vista FINANZAS (antes mitad de /vida): el mes en un vistazo, movimientos por
// día, y a la derecha billeteras, presupuestos y el asesor. Los datos también
// entran por voz ("gasté 45 mil en un almuerzo") — este es el tablero visual de
// ese mismo estado. La voz y el header viven en el AppShell.
//
// Rediseño v4 — la gramática única (contexto → lista → pieza):
//
// Esta vista era el caso extremo del problema: SEIS <Panel> con título, borde y
// fondo, todos con el mismo peso, en una rejilla 7/5. Seis cajas iguales no son
// una jerarquía — son seis cosas diciendo "mírame" a la vez, y la pregunta que
// de verdad traes ("¿cuánto llevo gastado?") tardaba lo mismo en encontrarse
// que la que no traes nunca.
//
// Ahora hay tres alturas y se distinguen a un metro:
//  - CABECERA (ViewHeader): dónde estás y el control que manda sobre toda la
//    vista (la moneda). El título de una página no es una tarjeta.
//  - CENTRO: el resumen del mes y el ritmo van SIN caja —son la cabecera
//    extendida, no objetos aparte— y la única caja real es la lista de
//    movimientos, porque ahí sí hay algo que se opera.
//  - RIEL: billeteras, presupuestos y asesor, con la misma piel que el riel del
//    home. El contexto se ve igual en las diez rutas.

import { useMemo } from "react";
import { useVidaContext } from "@/state/VidaProvider";
import { ViewHeader } from "@/components/ui/ViewHeader";
import { ScrollArea } from "@/components/ui/ScrollArea";
import { RailSection } from "@/components/ui/Rail";
import {
  buildVidaSlices,
  CurrencyToggle,
  FinanceSummaryPanel,
} from "@/components/vida/FinanceSummary";
import { WalletsPanel } from "@/components/vida/WalletsPanel";
import { BudgetsPanel } from "@/components/vida/BudgetsPanel";
import { MonthPulse } from "@/components/vida/MonthPulse";
import { TransactionList } from "@/components/vida/TransactionList";
import { AdvisorChat } from "@/components/vida/AdvisorChat";

export function FinanzasView() {
  const vida = useVidaContext();
  // Mismo mapa categoría→color de los donuts, para pintar los movimientos.
  const { colorFor } = useMemo(() => buildVidaSlices(vida.summary), [vida.summary]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <ViewHeader
        title="Finanzas"
        meta={vida.summary?.month}
        actions={<CurrencyToggle currency={vida.currency} onCurrency={vida.setCurrency} />}
      />

      {/* lg: la fila mide el alto disponible, así las columnas scrollean
          adentro en vez de crecer con los movimientos. */}
      <div className="grid min-h-0 flex-1 grid-cols-12 gap-x-6 gap-y-3 overflow-hidden max-lg:auto-rows-min max-lg:overflow-y-auto lg:grid-rows-[minmax(0,1fr)]">
        {/* ── Centro: el mes, su ritmo, y la lista ───────────────────── */}
        <div className="col-span-12 flex min-h-0 flex-col lg:col-span-7">
          <ScrollArea rail fade="y" className="min-h-0 flex-1 pr-1">
            <div className="flex flex-col gap-7">
              {/* Sin caja: esto ES el encabezado del mes, no un objeto más. */}
              <FinanceSummaryPanel summary={vida.summary} currency={vida.currency} />

              {/* La dimensión TIEMPO que los donuts no dan: barras por día. */}
              <section className="flex flex-col gap-2.5">
                <span className="text-2xs text-text-faint">Ritmo del mes</span>
                <MonthPulse
                  transactions={vida.transactions}
                  summary={vida.summary}
                  prevSummary={vida.prevSummary}
                  currency={vida.currency}
                  fx={vida.fx}
                />
              </section>

              {/* La ÚNICA caja del centro: aquí sí hay un objeto que se opera
                  (registrar, filtrar, abrir el detalle de un movimiento). */}
              <section className="overflow-hidden rounded-md border border-line bg-panel">
                <h3 className="border-b border-line px-3 py-2.5 text-xs font-medium text-text-dim">
                  Movimientos por día
                </h3>
                <div className="p-3">
                  <TransactionList
                    transactions={vida.transactions}
                    wallets={vida.wallets}
                    categoryColor={colorFor}
                    onAdd={vida.addTransaction}
                    onEdit={vida.editTransaction}
                    onVoid={vida.removeTransaction}
                  />
                </div>
              </section>
            </div>
          </ScrollArea>
        </div>

        {/* ── Riel: saldo, presupuestos y asesor ─────────────────────── */}
        <aside
          aria-label="Contexto"
          className="col-span-12 flex min-h-0 flex-col border-line lg:col-span-5 lg:border-l lg:pl-6"
        >
          <ScrollArea rail fade="y" className="min-h-0 flex-1 pr-1">
            <div className="flex min-h-full flex-col gap-7">
              <RailSection label="Saldo · billeteras">
                <WalletsPanel wallets={vida.wallets} fx={vida.fx} onSave={vida.saveWallet} />
              </RailSection>
              <RailSection label="Presupuestos">
                <BudgetsPanel
                  summary={vida.summary}
                  budgets={vida.budgets}
                  currency={vida.currency}
                  onSave={vida.saveBudget}
                />
              </RailSection>
              <RailSection label="Asesor financiero" grow>
                <AdvisorChat online={vida.online} onDataChanged={() => void vida.refresh()} />
              </RailSection>
            </div>
          </ScrollArea>
        </aside>
      </div>
    </div>
  );
}
