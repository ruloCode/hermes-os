/**
 * Sincronización del índice: fuentes → fragmentos → vectores, re-embebiendo
 * SOLO lo que cambió.
 *
 * La huella de cada fragmento es la del texto que se le pasa al motor (título +
 * fragmento). Si la huella ya está en el índice con vector del mismo modelo, se
 * reusa — aunque el fragmento haya cambiado de posición (un párrafo nuevo al
 * principio de una nota no obliga a re-embeber la nota entera). Si nada cambió,
 * no se calcula ningún vector.
 *
 * El modelo del índice no se cambia en una sincronización incremental: si su
 * motor está caído un rato, lo nuevo queda sin vector (sale por léxico) y se
 * completa cuando vuelve. Cambiar de motor es una reconstrucción completa
 * (`pnpm memoria:build`), que elige el primero disponible de la cadena.
 */
import {
  chunkText,
  contentHash,
  docKey,
  type IndexDoc,
} from "@hermes/shared";
import type { EmbedChain, EmbedEngine } from "./embedder.js";
import type { SourceCollector, SourceDoc } from "./sources.js";
import type { MemoryIndex } from "./store.js";

export const CHUNK = { maxChars: 1200, overlap: 150 };
/** Fragmentos por llamada al motor desde la sincronización (el motor los parte en lotes propios). */
const EMBED_BATCH = 256;

/** El texto que se le pasa al motor: el título da el contexto que un fragmento suelto no tiene. */
export function embedInput(doc: { title: string; text: string }): string {
  return `${doc.title}\n${doc.text}`;
}

/** Documento → fragmentos del índice (sin vector). */
export function toIndexDocs(d: SourceDoc): IndexDoc[] {
  const pieces = chunkText(d.text, CHUNK);
  return pieces.map((text, chunk) => ({
    id: `${d.source}:${d.ref}#${chunk}`,
    source: d.source,
    ref: d.ref,
    chunk,
    title: d.title,
    text,
    project: d.project,
    createdAt: d.createdAt,
    hash: contentHash(embedInput({ title: d.title, text })),
    ...(d.importance !== undefined ? { importance: d.importance } : {}),
    ...(d.kind !== undefined ? { kind: d.kind } : {}),
  }));
}

export interface SyncProgress {
  phase: "sources" | "embed" | "write";
  done: number;
  total: number;
  detail?: string;
}

export interface SyncResult {
  kind: "full" | "incremental";
  docs: number;
  chunks: number;
  /** Vectores calculados en esta corrida. */
  embedded: number;
  /** Fragmentos que reusaron su vector. */
  reused: number;
  /** Fragmentos que quedaron sin vector (motor caído o fallo). */
  withoutVector: number;
  /** Fragmentos que ya no están en las fuentes. */
  removed: number;
  model: string | null;
  ms: number;
  sourceErrors: Record<string, string>;
  /** Motivo por el que no hubo vectores en esta corrida, si no los hubo. */
  engineError: string | null;
}

export interface SyncOptions {
  /** Reconstrucción completa: no reusa ningún vector y elige el motor preferido. */
  full?: boolean;
  now?: () => number;
  onProgress?: (p: SyncProgress) => void;
}

/** ¿Con qué motor se embebe esta corrida? (ver la nota del encabezado). */
export function pickEngine(index: MemoryIndex, chain: EmbedChain, full: boolean): { engine: EmbedEngine | null; why: string | null } {
  if (full || !index.model || index.vectorCount === 0) {
    const e = chain.preferred();
    return e ? { engine: e, why: null } : { engine: null, why: chain.status().map((s) => `${s.id}: ${s.reason}`).join(" · ") || "sin motores" };
  }
  const own = chain.byId(index.model);
  if (!own) return { engine: null, why: `El motor del índice (${index.model}) no existe en esta máquina.` };
  const why = own.unavailable();
  return why ? { engine: null, why } : { engine: own, why: null };
}

export async function syncIndex(
  index: MemoryIndex,
  collectors: SourceCollector[],
  chain: EmbedChain,
  opts: SyncOptions = {},
): Promise<SyncResult> {
  const now = opts.now ?? Date.now;
  const started = now();
  const full = !!opts.full;
  const progress = opts.onProgress ?? (() => {});

  // 1. Fuentes (cada una falla sola).
  const sourceErrors: Record<string, string> = {};
  const fresh: SourceDoc[] = [];
  const failedSources = new Set<string>();
  let done = 0;
  await Promise.all(
    collectors.map(async (c) => {
      try {
        fresh.push(...(await c.collect()));
      } catch (err) {
        sourceErrors[`${c.origin}:${c.id}`] = ((err as Error).message || String(err)).slice(0, 200);
        failedSources.add(c.id);
      } finally {
        progress({ phase: "sources", done: ++done, total: collectors.length, detail: c.id });
      }
    }),
  );

  // 2. Fragmentos nuevos, en orden estable (fuente, ref, fragmento).
  fresh.sort((a, b) => a.source.localeCompare(b.source) || a.ref.localeCompare(b.ref));
  const docs: IndexDoc[] = [];
  const seenIds = new Set<string>();
  for (const d of fresh) {
    for (const chunk of toIndexDocs(d)) {
      if (seenIds.has(chunk.id)) continue;
      seenIds.add(chunk.id);
      docs.push(chunk);
    }
  }
  // Lo que tenía una fuente que falló se conserva tal cual.
  const freshKeys = new Set(docs.map(docKey));
  const carried: { doc: IndexDoc; vec: Float32Array | null }[] = [];
  index.docs.forEach((d, i) => {
    if (failedSources.has(d.source) && !freshKeys.has(docKey(d)) && !seenIds.has(d.id)) carried.push({ doc: d, vec: index.vecs[i] });
  });

  // 3. Vectores: se reusa por huella si el modelo es el mismo.
  const { engine, why } = pickEngine(index, chain, full);
  const sameModel = !!engine && engine.id === index.model;
  const reuse = new Map<string, Float32Array>();
  if (!full && (sameModel || !engine)) {
    index.docs.forEach((d, i) => {
      const v = index.vecs[i];
      if (v) reuse.set(d.hash, v);
    });
  }
  const vecs: (Float32Array | null)[] = docs.map((d) => reuse.get(d.hash) ?? null);
  const reused = vecs.filter(Boolean).length;
  const pending = docs.map((_, i) => i).filter((i) => !vecs[i]);

  let embedded = 0;
  let engineError: string | null = engine ? null : why;
  if (engine && pending.length) {
    for (let k = 0; k < pending.length; k += EMBED_BATCH) {
      const slice = pending.slice(k, k + EMBED_BATCH);
      const out = await chain.embedWith(engine.id, slice.map((i) => embedInput(docs[i])));
      if (!out) {
        engineError = chain.status().find((s) => s.id === engine.id)?.reason ?? "el motor falló";
        break;
      }
      slice.forEach((i, j) => (vecs[i] = out[j]));
      embedded += slice.length;
      progress({ phase: "embed", done: Math.min(k + EMBED_BATCH, pending.length), total: pending.length });
    }
  }

  // 4. Modelo resultante: el del motor si se usó (o si el índice estaba vacío),
  //    si no el que ya tenía (los vectores reusados son de ese).
  const model = engine && (embedded > 0 || sameModel || !index.model) ? engine.id : index.model;
  const allDocs = [...docs, ...carried.map((c) => c.doc)];
  const allVecs = [...vecs, ...carried.map((c) => (model === index.model ? c.vec : null))];
  const oldIds = new Set(index.docs.map((d) => d.id));
  const newIds = new Set(allDocs.map((d) => d.id));
  const removed = [...oldIds].filter((id) => !newIds.has(id)).length;

  // Si nada cambió (mismos fragmentos, mismas huellas y fechas, mismos vectores)
  // solo se actualiza meta.json: reescribir 20 MB cada 15 min para nada no.
  const signature = (d: IndexDoc) => `${d.id}|${d.hash}|${d.createdAt}|${d.project ?? ""}|${d.importance ?? ""}|${d.kind ?? ""}`;
  const unchanged =
    !full &&
    model === index.model &&
    allDocs.length === index.docs.length &&
    allDocs.every((d, i) => signature(d) === signature(index.docs[i]) && !!allVecs[i] === !!index.vecs[i]);

  progress({ phase: "write", done: 0, total: 1 });
  if (!unchanged) index.setAll(allDocs, allVecs, model);
  const ms = now() - started;
  index.meta.lastSync = new Date(now()).toISOString();
  index.meta.lastSyncMs = ms;
  index.meta.lastSyncEmbedded = embedded;
  index.meta.lastSyncKind = full ? "full" : "incremental";
  index.meta.sourceErrors = sourceErrors;
  if (full || !index.meta.builtAt) index.meta.builtAt = index.meta.lastSync;
  if (unchanged) await index.persistMeta();
  else await index.persist();
  progress({ phase: "write", done: 1, total: 1 });

  return {
    kind: full ? "full" : "incremental",
    docs: new Set(allDocs.map(docKey)).size,
    chunks: allDocs.length,
    embedded,
    reused,
    withoutVector: allVecs.filter((v) => !v).length,
    removed,
    model,
    ms,
    sourceErrors,
    engineError: engineError && embedded === 0 && pending.length ? engineError : null,
  };
}
