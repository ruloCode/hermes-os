"use client";

// Vista FINANZAS (antes mitad de /vida): el mes en un vistazo (hero con
// donuts + neto), movimientos por día, y a la derecha saldo por billetera,
// presupuestos y el asesor financiero con scope "vida". Los datos también
// entran por voz ("gasté 45 mil en un almuerzo") — este es el tablero visual
// de ese mismo estado. La voz y el header viven en el AppShell.

import { useMemo } from "react";
import { useVidaContext } from "@/state/VidaProvider";
import { Panel } from "@/components/ui/Panel";
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
    // lg: fila = alto disponible (ver InglesView) — así las columnas scrollean
    // adentro en vez de crecer con los movimientos.
    <div className="grid min-h-0 flex-1 grid-cols-12 gap-3 overflow-hidden max-lg:auto-rows-min max-lg:overflow-y-auto lg:grid-rows-[minmax(0,1fr)]">
      {/* Izquierda (scrollea): hero del mes y movimientos a toda la altura. */}
      <div className="col-span-12 flex min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain lg:col-span-7">
        <Panel
          title={`Finanzas · ${vida.summary?.month ?? ""}`}
          variant="hero"
          delay={40}
          className="shrink-0"
          right={<CurrencyToggle currency={vida.currency} onCurrency={vida.setCurrency} />}
        >
          <FinanceSummaryPanel summary={vida.summary} currency={vida.currency} />
        </Panel>
        {/* La dimensión TIEMPO que los donuts no dan: barras por día + ritmo. */}
        <Panel title="Ritmo del mes" delay={80} className="shrink-0">
          <MonthPulse
            transactions={vida.transactions}
            summary={vida.summary}
            prevSummary={vida.prevSummary}
            currency={vida.currency}
            fx={vida.fx}
          />
        </Panel>
        <Panel title="Movimientos por día" delay={110} className="min-h-[380px] flex-1">
          <TransactionList
            transactions={vida.transactions}
            wallets={vida.wallets}
            categoryColor={colorFor}
            onAdd={vida.addTransaction}
            onEdit={vida.editTransaction}
            onVoid={vida.removeTransaction}
          />
        </Panel>
      </div>

      {/* Derecha: saldo + presupuestos + asesor (scrollea si no cabe). */}
      <div className="col-span-12 flex min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain lg:col-span-5">
        <Panel title="Saldo · billeteras" delay={60} className="shrink-0">
          <WalletsPanel wallets={vida.wallets} fx={vida.fx} onSave={vida.saveWallet} />
        </Panel>
        <Panel title="Presupuestos" delay={90} className="max-h-[300px] shrink-0">
          <BudgetsPanel
            summary={vida.summary}
            budgets={vida.budgets}
            currency={vida.currency}
            onSave={vida.saveBudget}
          />
        </Panel>
        <Panel title="Asesor financiero" delay={120} className="min-h-[320px] flex-1">
          <AdvisorChat online={vida.online} onDataChanged={() => void vida.refresh()} />
        </Panel>
      </div>
    </div>
  );
}
