"use client";

/**
 * Costuras de QA de un tema: /dev/temas inyecta aquí una grabadora sintética
 * (sin micrófono) para ejercitar Grabar de punta a punta. En la vista real el
 * contexto va vacío y cada etapa usa lo de verdad.
 */
import { createContext, useContext } from "react";
import type { startLoopRecorder } from "@/lib/loop-recorder";

export interface TemaSeams {
  startRecorder?: typeof startLoopRecorder;
}

export const TemaSeamsCtx = createContext<TemaSeams>({});

export function useTemaSeams(): TemaSeams {
  return useContext(TemaSeamsCtx);
}
