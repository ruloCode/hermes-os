"use client";

// Poll ÚNICO de finanzas + hábitos + metas (useVida) compartido por las vistas
// Finanzas y Hábitos (y la racha de Inglés). Antes VidaView era la única
// consumidora; al separar las páginas, este provider evita que cada vista
// abra su propio poll de 10s contra el agente.

import { createContext, useContext, type ReactNode } from "react";
import { useVida } from "@/hooks/useVida";

type VidaData = ReturnType<typeof useVida>;

const VidaContext = createContext<VidaData | null>(null);

export function VidaProvider({ children }: { children: ReactNode }) {
  const vida = useVida();
  return <VidaContext.Provider value={vida}>{children}</VidaContext.Provider>;
}

export function useVidaContext(): VidaData {
  const ctx = useContext(VidaContext);
  if (!ctx) throw new Error("useVidaContext requiere <VidaProvider> en el árbol");
  return ctx;
}
