"use client";

// Poll ÚNICO del snapshot GET /dashboard para el strip inferior (y quien lo
// necesite). Mismo patrón que HermesDataProvider: vive en el shell y todos
// beben de aquí — nada de polls duplicados por componente. Si el fetch falla
// (agente viejo sin /dashboard o agente caído) snapshot queda en null y el
// strip entero se oculta sin dejar hueco.

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { DashboardSnapshot } from "@hermes/shared";
import { getDashboard } from "@/lib/hermes";

export interface DashboardData {
  snapshot: DashboardSnapshot | null;
}

const DashboardContext = createContext<DashboardData | null>(null);

export function DashboardProvider({ children }: { children: React.ReactNode }) {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const snap = await getDashboard();
        if (alive) setSnapshot(snap);
      } catch {
        // Sin endpoint /dashboard (agente viejo) o agente offline → null.
        if (alive) setSnapshot(null);
      }
    };
    void load();
    const interval = setInterval(load, 15_000);
    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, []);

  const value = useMemo(() => ({ snapshot }), [snapshot]);

  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>;
}

export function useDashboard(): DashboardData {
  const ctx = useContext(DashboardContext);
  if (!ctx) throw new Error("useDashboard requiere <DashboardProvider> en el árbol");
  return ctx;
}
