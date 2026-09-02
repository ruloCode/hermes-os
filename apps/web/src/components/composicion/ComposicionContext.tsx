"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useComposicionState, type ComposicionState } from "./useComposicionState";

const Ctx = createContext<ComposicionState | null>(null);

export function ComposicionProvider({ children }: { children: ReactNode }) {
  const state = useComposicionState();
  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}

export function useComposicion(): ComposicionState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useComposicion fuera de ComposicionProvider");
  return v;
}
