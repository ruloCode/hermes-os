/**
 * La memoria v2 dentro del proceso del agente: UN índice cargado, sus
 * mutaciones en fila (sincronización, memoria nueva, consolidación) y la
 * búsqueda que usa `searchKnowledge`.
 *
 * Si otro proceso reescribe el índice (`pnpm memoria:build`), la siguiente
 * búsqueda lo nota por la fecha de meta.json y lo recarga.
 */
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { cosine, type KnowledgeHit, type KnowledgeSource, type SearchMode } from "@hermes/shared";
import { embedChain } from "./embedder.js";
import { memoryToSourceDoc, type MemoryRow } from "./sources.js";
import { MemoryIndex, memoriaDir } from "./store.js";
import { embedInput, toIndexDocs } from "./sync.js";

/** Lo más que una búsqueda espera al vector de la pregunta (motor frío incluido); después, léxica. */
const QUERY_VECTOR_TIMEOUT_MS = Number(process.env.HERMES_MEMORY_QUERY_TIMEOUT_MS || 8000);

let current: MemoryIndex | null = null;
let currentDir = "";
let loadedMtime = 0;
let loading: Promise<MemoryIndex> | null = null;
let queue: Promise<unknown> = Promise.resolve();
let persistTimer: NodeJS.Timeout | null = null;

export interface LastSearch {
  at: string;
  mode: SearchMode | "supabase";
  ms: number;
  /** Por qué no hubo vectores en esa búsqueda, si no los hubo. */
  why?: string;
}
let lastSearch: LastSearch | null = null;

export function noteSearch(s: LastSearch): void {
  lastSearch = s;
}
export function lastSearchInfo(): LastSearch | null {
  return lastSearch;
}

async function metaMtime(dir: string): Promise<number> {
  try {
    return (await stat(join(dir, "meta.json"))).mtimeMs;
  } catch {
    return 0;
  }
}

/** El índice cargado (lo carga la primera vez y lo recarga si otro proceso lo reescribió). */
export async function getIndex(): Promise<MemoryIndex> {
  const dir = memoriaDir();
  if (current && currentDir === dir) {
    const m = await metaMtime(dir);
    if (m <= loadedMtime || persistTimer) return current;
  }
  if (!loading) {
    loading = (async () => {
      const t = Date.now();
      const idx = await MemoryIndex.load(dir);
      current = idx;
      currentDir = dir;
      loadedMtime = await metaMtime(dir);
      if (idx.size) console.log(`[memoria] índice cargado: ${idx.size} fragmentos, ${idx.vectorCount} con vector (${Date.now() - t} ms)`);
      return idx;
    })().finally(() => {
      loading = null;
    });
  }
  return loading;
}

/** Corre una mutación del índice en fila (dos sincronizaciones no se pisan). */
export function withIndex<T>(fn: (idx: MemoryIndex) => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const idx = await getIndex();
    const out = await fn(idx);
    loadedMtime = await metaMtime(idx.dir);
    return out;
  });
  queue = run.catch(() => {});
  return run;
}

/** Guarda en disco dentro de un rato (varias memorias seguidas = una escritura). */
function schedulePersist(idx: MemoryIndex): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void withIndex(async (i) => (i === idx ? i.persist() : undefined)).catch((err) =>
      console.error("[memoria] no pude guardar el índice:", (err as Error).message),
    );
  }, 1500);
  persistTimer.unref();
}

export async function flushIndex(): Promise<void> {
  if (!persistTimer || !current) return;
  clearTimeout(persistTimer);
  persistTimer = null;
  await withIndex((i) => i.persist());
}

/** ¿Hay índice con documentos? (sin cargarlo si no hace falta). */
export async function indexReady(): Promise<boolean> {
  if (current && currentDir === memoriaDir() && current.size > 0) return true;
  return MemoryIndex.exists();
}

/** Vector de un texto con el motor DEL ÍNDICE (o el preferido si el índice aún no tiene modelo). */
async function vectorFor(idx: MemoryIndex, text: string, timeoutMs: number): Promise<{ vec: Float32Array | null; why?: string }> {
  const chain = embedChain();
  const engine = idx.model ? chain.byId(idx.model) : chain.preferred();
  if (!engine) return { vec: null, why: idx.model ? `el motor del índice (${idx.model}) no existe aquí` : "ningún motor de vectores disponible" };
  const why = engine.unavailable();
  if (why) {
    await chain.embedWith(engine.id, [text]); // deja el aviso (una vez)
    return { vec: null, why };
  }
  const ac = new AbortController();
  let timer: NodeJS.Timeout | null = null;
  const timeout = new Promise<null>((r) => {
    timer = setTimeout(() => {
      ac.abort();
      r(null);
    }, timeoutMs);
  });
  const out = await Promise.race([chain.embedWith(engine.id, [text], ac.signal), timeout]);
  if (timer) clearTimeout(timer);
  if (!out?.[0]) return { vec: null, why: out === null ? `el motor ${engine.id} no respondió a tiempo o falló` : undefined };
  return { vec: out[0] };
}

export interface MemoriaSearchOptions {
  sources?: KnowledgeSource[];
  project?: string;
  limit?: number;
  mode?: SearchMode;
  includeSuperseded?: boolean;
}

/** La búsqueda de la memoria v2, ya en el formato de `searchKnowledge`. */
export async function searchMemoria(query: string, opts: MemoriaSearchOptions = {}): Promise<{ hits: KnowledgeHit[]; mode: SearchMode; why?: string }> {
  const t = Date.now();
  const idx = await getIndex();
  let qv: Float32Array | null = null;
  let why: string | undefined;
  if (opts.mode !== "lexical" && idx.vectorCount > 0) {
    ({ vec: qv, why } = await vectorFor(idx, query, QUERY_VECTOR_TIMEOUT_MS));
  } else if (opts.mode !== "lexical") {
    why = "el índice no tiene vectores";
  }
  const out = idx.search({
    query,
    queryVector: qv,
    now: Date.now(),
    limit: opts.limit ?? 12,
    sources: opts.sources,
    project: opts.project,
    mode: opts.mode,
    includeSuperseded: opts.includeSuperseded,
  });
  const hits: KnowledgeHit[] = out.hits.map((h) => ({
    source: h.doc.source as KnowledgeSource,
    ref: h.doc.ref,
    title: h.doc.title,
    content: h.doc.text,
    project_slug: h.doc.project,
    created_at: h.doc.createdAt,
    similarity: h.similarity,
    score: Math.round(h.score * 1e5) / 1e5,
  }));
  noteSearch({ at: new Date().toISOString(), mode: out.mode, ms: Date.now() - t, ...(out.mode !== "hybrid" && why ? { why } : {}) });
  return { hits, mode: out.mode, why };
}

/**
 * Una memoria recién guardada entra al índice YA, sin esperar a la
 * sincronización: con vector si el motor responde, sin él si no (sale por léxico).
 * La huella es la misma que calculará la sincronización, así que esta luego la reusa.
 */
export async function indexMemory(row: MemoryRow, precomputed?: Float32Array | null): Promise<{ chunks: number; withVector: boolean }> {
  return withIndex(async (idx) => {
    const docs = toIndexDocs(memoryToSourceDoc(row));
    if (!docs.length) return { chunks: 0, withVector: false };
    let vecs: (Float32Array | null)[] = docs.map(() => null);
    const chain = embedChain();
    const engine = idx.model ? chain.byId(idx.model) : chain.preferred();
    if (engine && !engine.unavailable()) {
      // El vector de la dedup sirve si la memoria es de un solo fragmento (mismo texto embebido).
      if (precomputed && docs.length === 1 && precomputed.length === engine.dims) vecs = [precomputed];
      else vecs = (await chain.embedWith(engine.id, docs.map(embedInput))) ?? vecs;
      if (!idx.model && vecs.some(Boolean)) idx.meta.model = engine.id;
    }
    idx.upsertDocument(docs, vecs);
    schedulePersist(idx);
    return { chunks: docs.length, withVector: vecs.every(Boolean) };
  });
}

/**
 * Dedup de `saveMemory` con el índice local: la memoria más parecida del MISMO
 * tipo (coseno sobre el texto que se guardaría). null si no hay vectores.
 */
export async function similarMemory(
  content: string,
  type: string,
  summary?: string | null,
): Promise<{ ref: string; similarity: number; vector: Float32Array } | null> {
  const idx = await getIndex();
  if (!idx.vectorCount) return null;
  // El mismo texto que se embebería al indexarla: así el vector sirve también para guardarla.
  const [first] = toIndexDocs(
    memoryToSourceDoc({ id: "nueva", type, content, summary: summary ?? null, project_slug: null, importance: 3, created_at: new Date().toISOString() }),
  );
  if (!first) return null;
  const { vec } = await vectorFor(idx, embedInput(first), QUERY_VECTOR_TIMEOUT_MS);
  if (!vec) return null;
  let best: { ref: string; similarity: number } | null = null;
  idx.docs.forEach((d, i) => {
    const v = idx.vecs[i];
    if (d.source !== "memory" || d.chunk !== 0 || d.kind !== type || !v) return;
    const s = cosine(v, vec);
    if (!best || s > best.similarity) best = { ref: d.ref, similarity: s };
  });
  return best ? { ...(best as { ref: string; similarity: number }), vector: vec } : null;
}

/** Tests: olvidar el índice cargado. */
export function resetMemoriaService(): void {
  current = null;
  currentDir = "";
  loadedMtime = 0;
  lastSearch = null;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = null;
}

export { memoriaDir };
