"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useComposicionState, type ComposicionState } from "./useComposicionState";

const Ctx = createContext<ComposicionState | null>(null);

/** `offline`: solo el mock en memoria, sin hablarle al agente (página de QA). */
export function ComposicionProvider({ children, offline }: { children: ReactNode; offline?: boolean }) {
  const state = useComposicionState({ offline });
  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}

export function useComposicion(): ComposicionState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useComposicion fuera de ComposicionProvider");
  return v;
}
