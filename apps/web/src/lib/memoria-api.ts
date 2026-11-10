// Cliente de las rutas /memoria/* del agente (memoria v2: índice local híbrido).
// Las rutas responden `{ ok, … | error }` con 200: aquí hay TRES resultados y el
// panel los distingue — dato, motivo dicho por el agente y agente que no contesta.

import type { KnowledgeSource } from "@hermes/shared";
import { hermesFetch } from "./hermes";

export type MemoryHealth = "hibrida" | "lexica" | "caida";

export interface MemoriaEngine {
  id: string;
  kind: "local" | "openai";
  dims: number;
  state: "ok" | "idle" | "down";
  reason: string | null;
  since: string | null;
}

export interface MemoriaStatus {
  health: MemoryHealth;
  backend: { configured: "auto" | "v2" | "supabase"; active: "v2" | "supabase" };
  index: {
    docs: number;
    chunks: number;
    vectors: number;
    model: string | null;
    bySource: Partial<Record<KnowledgeSource, { docs: number; chunks: number; vectors: number }>>;
    diskBytes: number;
    lastSync: string | null;
    lastSyncEmbedded: number;
    sourceErrors: Record<string, string>;
    superseded: number;
  };
  engine: { active: string | null; ready: boolean; reason: string | null };
  engines: MemoriaEngine[];
  proposals: { pending: number };
  lastSearch: { at: string; mode: string; ms: number; why?: string } | null;
}

export interface DreamProposal {
  id: string;
  createdAt: string;
  status: "pending" | "applied" | "discarded";
  action: "duplicado" | "reemplaza";
  keep: string;
  superseded: string[];
  reason: string;
  similarity: number;
  items: { key: string; title: string; text: string; createdAt: string }[];
}

export type MemoriaResult<T> = { ok: true; data: T } | { ok: false; error: string; offline: boolean };

async function call<T>(path: string, init?: RequestInit): Promise<MemoriaResult<T>> {
  let res: Response;
  try {
    res = await hermesFetch(path, { ...init, signal: AbortSignal.timeout(12_000) });
  } catch {
    return { ok: false, error: "El agente no contesta.", offline: true };
  }
  // Un agente anterior a v6 no tiene /memoria/*: no es "memoria caída".
  if (res.status === 404) return { ok: false, error: "Este agente es anterior a la memoria v2.", offline: false };
  if (!res.ok) return { ok: false, error: `El agente respondió ${res.status}.`, offline: res.status >= 500 };
  try {
    const body = (await res.json()) as { ok?: boolean; error?: string } & T;
    if (body.ok === false) return { ok: false, error: body.error ?? "Error sin motivo.", offline: false };
    return { ok: true, data: body };
  } catch {
    return { ok: false, error: "Respuesta que no es JSON.", offline: true };
  }
}

export const getMemoriaStatus = () => call<MemoriaStatus>("/memoria/status");

export async function getMemoriaProposals(): Promise<MemoriaResult<DreamProposal[]>> {
  const r = await call<{ proposals: DreamProposal[] }>("/memoria/proposals");
  return r.ok ? { ok: true, data: r.data.proposals } : r;
}

export const decideMemoriaProposal = (id: string, action: "approve" | "discard") =>
  call<{ proposal: DreamProposal }>(`/memoria/proposals/${encodeURIComponent(id)}/${action}`, { method: "POST" });
