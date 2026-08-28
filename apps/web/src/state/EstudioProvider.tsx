"use client";

/**
 * Provider del ESTUDIO (creación de contenido RuloCode): comparte el poll de
 * /content/board entre el pipeline, el workspace y el riel — nunca abras un
 * poll nuevo si este provider ya trae el dato (regla del repo).
 */
import { createContext, useContext, type ReactNode } from "react";
import { useEstudio } from "@/hooks/useEstudio";

type EstudioData = ReturnType<typeof useEstudio>;

const EstudioContext = createContext<EstudioData | null>(null);

export function EstudioProvider({ children }: { children: ReactNode }) {
  const estudio = useEstudio();
  return <EstudioContext.Provider value={estudio}>{children}</EstudioContext.Provider>;
}

export function useEstudioContext(): EstudioData {
  const ctx = useContext(EstudioContext);
  if (!ctx) throw new Error("useEstudioContext requiere <EstudioProvider> en el árbol");
  return ctx;
}
