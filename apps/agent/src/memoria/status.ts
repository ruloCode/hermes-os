/**
 * `GET /memoria/status`: la salud de la memoria en una respuesta. Todo número
 * sale del índice cargado o del estado de los motores en este proceso.
 */
import { memoryHealth, type MemoryHealth } from "@hermes/shared";
import { activeBackend, memoryBackend, type MemoryBackend } from "../knowledge.js";
import { embedChain, type EngineNotice, type EngineStatus } from "./embedder.js";
import { readProposals, type DreamRun } from "./dream.js";
import { getIndex, lastSearchInfo, type LastSearch } from "./service.js";
import type { SourceCount } from "./store.js";

export interface MemoriaStatus {
  ok: true;
  health: MemoryHealth;
  /** Qué camino responde `searchKnowledge` ahora y qué pidió el entorno. */
  backend: { configured: MemoryBackend; active: "v2" | "supabase" };
  index: {
    dir: string;
    docs: number;
    chunks: number;
    vectors: number;
    model: string | null;
    dims: number;
    bySource: Record<string, SourceCount>;
    diskBytes: number;
    builtAt: string | null;
    lastSync: string | null;
    lastSyncMs: number | null;
    lastSyncEmbedded: number;
    lastSyncKind: "full" | "incremental" | null;
    sourceErrors: Record<string, string>;
    superseded: number;
  };
  /** El motor que usa el índice (o el que usaría) y el estado de cada uno. */
  engine: { active: string | null; ready: boolean; reason: string | null };
  engines: EngineStatus[];
  notices: EngineNotice[];
  lastSearch: LastSearch | null;
  proposals: { pending: number };
  lastDream: string | null;
  lastDreamRun: DreamRun | null;
}

let lastDreamRun: DreamRun | null = null;
export function noteDreamRun(r: DreamRun): void {
  lastDreamRun = r;
}

export async function memoriaStatus(): Promise<MemoriaStatus> {
  const idx = await getIndex();
  const chain = embedChain();
  const engines = chain.status();
  const own = idx.model ? engines.find((e) => e.id === idx.model) : null;
  const preferred = chain.preferred();
  const engineId = own?.id ?? preferred?.id ?? null;
  const engineStatus = engines.find((e) => e.id === engineId);
  const ready = !!engineStatus && engineStatus.state !== "down";
  const docs = Object.values(idx.meta.bySource).reduce((n, s) => n + s.docs, 0);
  const proposals = await readProposals(idx);
  return {
    ok: true,
    health: memoryHealth({ chunks: idx.size, vectors: idx.vectorCount, engineReady: ready && (!idx.model || idx.model === engineId) }),
    backend: { configured: memoryBackend(), active: await activeBackend() },
    index: {
      dir: idx.dir,
      docs,
      chunks: idx.size,
      vectors: idx.vectorCount,
      model: idx.model,
      dims: idx.meta.dims,
      bySource: idx.meta.bySource,
      diskBytes: await idx.diskBytes(),
      builtAt: idx.meta.builtAt,
      lastSync: idx.meta.lastSync,
      lastSyncMs: idx.meta.lastSyncMs,
      lastSyncEmbedded: idx.meta.lastSyncEmbedded,
      lastSyncKind: idx.meta.lastSyncKind,
      sourceErrors: idx.meta.sourceErrors,
      superseded: Object.keys(idx.state.superseded).length,
    },
    engine: {
      active: engineId,
      ready,
      reason: engineStatus?.reason ?? (engineId ? null : engines.map((e) => `${e.id}: ${e.reason}`).join(" · ")),
    },
    engines,
    notices: chain.notices.slice(-10),
    lastSearch: lastSearchInfo(),
    proposals: { pending: proposals.filter((p) => p.status === "pending").length },
    lastDream: idx.state.lastDream,
    lastDreamRun,
  };
}
