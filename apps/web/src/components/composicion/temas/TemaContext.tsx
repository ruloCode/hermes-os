"use client";

/**
 * Contrato entre la cáscara de un Tema (TemaView: cabecera, stepper,
 * transporte, carga y guardado) y sus etapas (Intención, Pista, Grabar,
 * Análisis, Letra, Montaje). Las etapas no saben de fetch ni de debounce:
 * leen el tema de aquí y piden cambios con `patch`.
 */
import { createContext, useContext } from "react";
import type { ComposeSession, TakeMeta, Tema, TemaDetail, TemaSection, TemaStage } from "@hermes/shared";
import type { TrackEngine } from "@/lib/track-engine";

export type TemaPatch = Partial<Pick<Tema, "title" | "stage" | "intent" | "track" | "montage" | "songId">>;

export interface TemaCtxValue {
  tema: Tema;
  detail: TemaDetail;
  /** Sección activa (la que suena en el transporte y a la que van las tomas). */
  section: TemaSection;
  setSectionId(id: string): void;
  /** Cambio optimista + PATCH con debounce (~600 ms). */
  patch(p: TemaPatch): void;
  /** Relee el detalle (tomas nuevas, análisis que terminaron). */
  reload(): Promise<void>;
  /** Etapa que se ve (no es la del tema: mirar otra etapa no la "avanza"). */
  stage: TemaStage;
  setStage(s: TemaStage): void;
  engine: TrackEngine;
  /** Sube una toma (WAV) grabada sobre la pista; el agente asigna el número. */
  uploadTake(input: { wav: Blob; meta: Omit<TakeMeta, "n"> }): Promise<ComposeSession>;
  patchTake(sessionId: string, p: { favorite?: boolean; latencyMs?: number; hint?: string }): Promise<void>;
  /** ¿La vista de Composición está a la vista? (los atajos solo si sí). */
  active: boolean;
}

export const TemaCtx = createContext<TemaCtxValue | null>(null);

export function useTemaCtx(): TemaCtxValue {
  const v = useContext(TemaCtx);
  if (!v) throw new Error("useTemaCtx fuera de TemaCtx");
  return v;
}
