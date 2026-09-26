"use client";

/**
 * La API de TEMAS como interfaz inyectable (mismo patrón que PlaygroundApiCtx):
 * la vista real le habla al agente (`lib/hermes.ts`); /dev/temas monta encima
 * una implementación en memoria con datos SINTÉTICOS para revisar la UI sin
 * agente y sin exponer jamás material real (el repo es público).
 */
import { createContext, useContext } from "react";
import type { ComposeSession, MemoRef, PrivacyInfo, TakeMeta, Tema, TemaDetail, TemaListItem } from "@hermes/shared";
import {
  createTema,
  deleteTema,
  getComposicionPrivacy,
  getTema,
  listTemas,
  patchTake,
  patchTema,
  uploadTake,
  type TemaPatchBody,
} from "@/lib/hermes";

export type { TemaPatchBody };

export interface TemasApi {
  list(): Promise<TemaListItem[]>;
  create(input: { title?: string; fromPassage?: MemoRef }): Promise<Tema>;
  get(id: string): Promise<TemaDetail>;
  patch(id: string, patch: TemaPatchBody): Promise<Tema>;
  remove(id: string): Promise<unknown>;
  uploadTake(temaId: string, wav: Blob, meta: Omit<TakeMeta, "n">): Promise<ComposeSession>;
  patchTake(temaId: string, sid: string, p: { favorite?: boolean; latencyMs?: number; hint?: string }): Promise<ComposeSession>;
  privacy(): Promise<PrivacyInfo>;
}

export const realTemasApi: TemasApi = {
  list: listTemas,
  create: createTema,
  get: getTema,
  patch: patchTema,
  remove: deleteTema,
  uploadTake,
  patchTake,
  privacy: getComposicionPrivacy,
};

export const TemasApiCtx = createContext<TemasApi>(realTemasApi);

export function useTemasApi(): TemasApi {
  return useContext(TemasApiCtx);
}
