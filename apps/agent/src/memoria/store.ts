/**
 * El índice local en disco (`~/.hermes-os/memoria/v2/`) y en memoria.
 *
 *   docs.jsonl   una línea por fragmento (IndexDoc + `v`: 1 si tiene vector)
 *   vectors.f32  Float32, una fila de `dims` por fragmento, en el orden de docs.jsonl
 *                (fila en ceros si el fragmento aún no tiene vector)
 *   meta.json    modelo, dimensiones, conteos por fuente, última sincronización
 *   state.json   hechos reemplazados (clave → por cuál y desde cuándo), pares ya decididos
 *
 * Es un DERIVADO: Supabase y los archivos de `~/.hermes-os` son la verdad y
 * `pnpm memoria:build` lo rehace entero. Por eso no hay migración.
 *
 * Escritura atómica (tmp + rename) archivo por archivo. Si un corte deja
 * docs.jsonl y vectors.f32 desparejos, al cargar se descartan los vectores
 * (la búsqueda sigue léxica) y la siguiente sincronización los recalcula.
 */
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  addToLexicalIndex,
  buildLexicalIndex,
  docKey,
  docTokens,
  searchIndex,
  type IndexDoc,
  type LexicalIndex,
  type SearchMode,
  type SearchOutput,
  type VectorMatrix,
} from "@hermes/shared";
import { HERMES_HOME } from "../home.js";

export const INDEX_VERSION = 1;

export function memoriaDir(): string {
  return process.env.HERMES_MEMORIA_DIR || join(process.env.HERMES_MEMORIA_HOME || join(HERMES_HOME, "memoria"), "v2");
}

export interface SourceCount {
  docs: number;
  chunks: number;
  vectors: number;
}

export interface IndexMeta {
  version: number;
  /** Motor con que se hicieron los vectores (`local:bge-m3-Q8_0`…); null = ninguno. */
  model: string | null;
  dims: number;
  chunks: number;
  vectors: number;
  bySource: Record<string, SourceCount>;
  builtAt: string | null;
  lastSync: string | null;
  lastSyncMs: number | null;
  /** Vectores calculados en la última sincronización (0 = nada cambió). */
  lastSyncEmbedded: number;
  lastSyncKind: "full" | "incremental" | null;
  /** Fuentes que fallaron en la última sincronización (sus fragmentos anteriores se conservaron). */
  sourceErrors: Record<string, string>;
}

export interface Superseded {
  /** Clave del documento que lo reemplaza. */
  by: string;
  since: string;
  reason?: string;
}

export interface IndexState {
  superseded: Record<string, Superseded>;
  /** Pares de memorias que la consolidación ya miró (no se vuelven a proponer). */
  decidedPairs: string[];
  lastDream: string | null;
}

const emptyMeta = (): IndexMeta => ({
  version: INDEX_VERSION,
  model: null,
  dims: 0,
  chunks: 0,
  vectors: 0,
  bySource: {},
  builtAt: null,
  lastSync: null,
  lastSyncMs: null,
  lastSyncEmbedded: 0,
  lastSyncKind: null,
  sourceErrors: {},
});

const emptyState = (): IndexState => ({ superseded: {}, decidedPairs: [], lastDream: null });

async function writeAtomic(path: string, data: string | Uint8Array): Promise<void> {
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, path);
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}

export class MemoryIndex {
  docs: IndexDoc[] = [];
  /** Vector normalizado de cada fragmento (null = sin vector todavía). */
  vecs: (Float32Array | null)[] = [];
  meta: IndexMeta = emptyMeta();
  state: IndexState = emptyState();
  private lexical: LexicalIndex = buildLexicalIndex([]);
  private matrix: VectorMatrix | null = null;
  private byId = new Map<string, number>();

  constructor(readonly dir: string = memoriaDir()) {}

  get size(): number {
    return this.docs.length;
  }
  get model(): string | null {
    return this.meta.model;
  }
  get vectorCount(): number {
    return this.vecs.reduce((n, v) => n + (v ? 1 : 0), 0);
  }

  /** ¿Hay índice en disco con algo adentro? (sin cargarlo). */
  static async exists(dir: string = memoriaDir()): Promise<boolean> {
    const meta = await readJson<IndexMeta>(join(dir, "meta.json"));
    return !!meta && meta.chunks > 0;
  }

  static async load(dir: string = memoriaDir()): Promise<MemoryIndex> {
    const idx = new MemoryIndex(dir);
    idx.meta = { ...emptyMeta(), ...((await readJson<IndexMeta>(join(dir, "meta.json"))) ?? {}) };
    idx.state = { ...emptyState(), ...((await readJson<IndexState>(join(dir, "state.json"))) ?? {}) };
    let raw = "";
    try {
      raw = await readFile(join(dir, "docs.jsonl"), "utf8");
    } catch {
      return idx;
    }
    const docs: IndexDoc[] = [];
    const flags: boolean[] = [];
    for (const line of raw.split("\n")) {
      if (!line) continue;
      try {
        const { v, ...doc } = JSON.parse(line) as IndexDoc & { v?: number };
        docs.push(doc);
        flags.push(v === 1);
      } catch {
        /* línea a medias: se salta */
      }
    }
    let vecs: (Float32Array | null)[] = docs.map(() => null);
    const dims = idx.meta.dims;
    if (dims > 0 && idx.meta.model) {
      try {
        const buf = await readFile(join(dir, "vectors.f32"));
        if (buf.byteLength === docs.length * dims * 4) {
          // Copia alineada: un Buffer de Node puede empezar a mitad de un bloque.
          const all = new Float32Array(buf.byteLength / 4);
          new Uint8Array(all.buffer).set(buf);
          vecs = docs.map((_, i) => (flags[i] ? all.subarray(i * dims, (i + 1) * dims) : null));
          idx.matrix = { data: all, dims, has: Uint8Array.from(flags.map((f) => (f ? 1 : 0))) };
        } else {
          console.warn(`[memoria] vectors.f32 no corresponde a docs.jsonl (${buf.byteLength} bytes): se recalcularán`);
        }
      } catch {
        /* sin vectores: búsqueda léxica hasta la siguiente sincronización */
      }
    }
    idx.setAll(docs, vecs, idx.meta.model, idx.matrix);
    return idx;
  }

  /** Reemplaza el contenido entero (la sincronización arma la lista nueva y la pone de una vez). */
  setAll(docs: IndexDoc[], vecs: (Float32Array | null)[], model: string | null, matrix: VectorMatrix | null = null): void {
    this.docs = docs;
    this.vecs = vecs;
    this.meta.model = model;
    const dims = vecs.find((v) => v)?.length ?? (model ? this.meta.dims : 0);
    this.meta.dims = dims;
    this.lexical = buildLexicalIndex(docs.map(docTokens));
    this.matrix = matrix;
    this.byId = new Map(docs.map((d, i) => [d.id, i]));
    this.recount();
  }

  /**
   * Agrega o reemplaza los fragmentos de UN documento (guardar una memoria).
   * Si el documento es nuevo, se agrega al final sin reconstruir nada; si ya
   * estaba, se reconstruye el índice léxico (cientos de ms en el peor caso).
   */
  upsertDocument(chunks: IndexDoc[], vecs: (Float32Array | null)[]): void {
    if (!chunks.length) return;
    const key = docKey(chunks[0]);
    const exists = this.docs.some((d) => docKey(d) === key);
    if (exists) {
      const keepDocs: IndexDoc[] = [];
      const keepVecs: (Float32Array | null)[] = [];
      this.docs.forEach((d, i) => {
        if (docKey(d) === key) return;
        keepDocs.push(d);
        keepVecs.push(this.vecs[i]);
      });
      this.setAll([...keepDocs, ...chunks], [...keepVecs, ...vecs], this.meta.model);
      return;
    }
    chunks.forEach((d, j) => {
      this.byId.set(d.id, this.docs.length);
      this.docs.push(d);
      this.vecs.push(vecs[j] ?? null);
      addToLexicalIndex(this.lexical, docTokens(d));
    });
    if (!this.meta.dims) this.meta.dims = vecs.find((v) => v)?.length ?? 0;
    this.matrix = null;
    this.recount();
  }

  docAt(id: string): IndexDoc | null {
    const i = this.byId.get(id);
    return i === undefined ? null : this.docs[i];
  }

  /** Fragmentos de un documento con su vector. */
  chunksOf(key: string): { doc: IndexDoc; vec: Float32Array | null }[] {
    const out: { doc: IndexDoc; vec: Float32Array | null }[] = [];
    this.docs.forEach((d, i) => {
      if (docKey(d) === key) out.push({ doc: d, vec: this.vecs[i] });
    });
    return out;
  }

  private recount(): void {
    const by: Record<string, SourceCount> = {};
    const seen = new Set<string>();
    this.docs.forEach((d, i) => {
      const s = (by[d.source] ??= { docs: 0, chunks: 0, vectors: 0 });
      s.chunks++;
      if (this.vecs[i]) s.vectors++;
      const k = docKey(d);
      if (!seen.has(k)) {
        seen.add(k);
        s.docs++;
      }
    });
    this.meta.bySource = by;
    this.meta.chunks = this.docs.length;
    this.meta.vectors = this.vectorCount;
  }

  private ensureMatrix(): VectorMatrix | null {
    if (this.matrix) return this.matrix;
    const dims = this.meta.dims;
    if (!dims || !this.meta.model) return null;
    const data = new Float32Array(this.docs.length * dims);
    const has = new Uint8Array(this.docs.length);
    this.vecs.forEach((v, i) => {
      if (!v || v.length !== dims) return;
      data.set(v, i * dims);
      has[i] = 1;
    });
    this.matrix = { data, dims, has };
    return this.matrix;
  }

  search(opts: {
    query: string;
    queryVector?: Float32Array | null;
    now: number;
    limit?: number;
    sources?: readonly string[];
    project?: string;
    mode?: SearchMode;
    includeSuperseded?: boolean;
  }): SearchOutput {
    return searchIndex({
      docs: this.docs,
      lexical: this.lexical,
      vectors: this.ensureMatrix(),
      superseded: new Set(Object.keys(this.state.superseded)),
      ...opts,
    });
  }

  async persist(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const dims = this.meta.dims;
    const docsLines = this.docs.map((d, i) => JSON.stringify({ ...d, v: this.vecs[i] ? 1 : 0 })).join("\n");
    if (dims > 0) {
      const all = new Float32Array(this.docs.length * dims);
      this.vecs.forEach((v, i) => v && v.length === dims && all.set(v, i * dims));
      // Vectores primero: si el corte cae entre los dos, el tamaño no cuadra y se descartan (nunca se desalinean en silencio).
      await writeAtomic(join(this.dir, "vectors.f32"), new Uint8Array(all.buffer));
    }
    await writeAtomic(join(this.dir, "docs.jsonl"), docsLines ? `${docsLines}\n` : "");
    await this.persistMeta();
    await this.persistState();
  }

  async persistMeta(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeAtomic(join(this.dir, "meta.json"), JSON.stringify(this.meta, null, 2));
  }

  async persistState(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeAtomic(join(this.dir, "state.json"), JSON.stringify(this.state, null, 2));
  }

  /** Bytes en disco del índice (los cuatro archivos). */
  async diskBytes(): Promise<number> {
    let total = 0;
    for (const f of ["docs.jsonl", "vectors.f32", "meta.json", "state.json"]) {
      try {
        total += (await stat(join(this.dir, f))).size;
      } catch {
        /* no existe aún */
      }
    }
    return total;
  }
}
