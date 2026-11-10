/**
 * Memoria v2: la lógica PURA del índice local (openspec/changes/v6-nucleo, §4).
 *
 * Nada de aquí toca disco, red ni reloj: recibe textos, vectores y el instante
 * «ahora» y devuelve un orden. Así el ranking se prueba con vectores a mano y
 * el mismo código corre en el agente, en la evaluación y en los tests.
 *
 * Por qué híbrido: la búsqueda léxica (BM25) encuentra el nombre propio, la
 * cifra y la sigla exactos; los vectores encuentran la misma idea dicha con
 * otras palabras o en otro idioma. La fusión por rango recíproco (RRF) las
 * junta sin tener que calibrar dos escalas de puntaje que no se parecen.
 */

// ── Texto ───────────────────────────────────────────────────────────────

/** Minúsculas y sin tildes («reunión» y «reunion» son la misma palabra al buscar). */
export function foldAccents(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}+/gu, "");
}

/**
 * Palabras vacías de los dos idiomas, ya plegadas (sin tildes). Son las que
 * aparecen en casi todo documento y solo le suman ruido al puntaje.
 */
const STOPWORDS = new Set(
  (
    // Español
    "a al algo algun alguna algunas alguno algunos ante antes aqui asi aun aunque cada como con contra cual cuales " +
    "cuando cuanto de del desde donde dos el ella ellas ello ellos en entre era eran eres es esa esas ese eso esos " +
    "esta estaba estaban estan estar estas este esto estos estoy fue fueron ha habia han hasta hay he la las le les lo " +
    "los mas me mi mis mucho muy nada ni no nos nosotros o os otra otras otro otros para pero poco por porque pues que " +
    "quien quienes se sea sean segun ser si sido sin sobre solo son soy su sus tal tambien tan tanto te tengo ti tiene " +
    "tienen todo toda todas todos tu tus un una unas uno unos usted va vamos van ver vez y ya yo " +
    // Inglés
    "about after all also am an and any are as at be been before being both but by can could did do does doing down " +
    "each for from had has have having he her here hers him his how i if in into is it its just me more most my of " +
    "off on once only or other our out over own same she should so some such than that the their them then there " +
    "these they this those through to too under until up very was we were what when where which while who whom why " +
    "will with would you your yours"
  ).split(" "),
);

/** ¿Es una palabra vacía? (para quien arma consultas a mano). */
export function isStopword(token: string): boolean {
  return STOPWORDS.has(foldAccents(token));
}

/**
 * Plegado de plurales, a propósito tosco y SIMÉTRICO: quita la cola de «s»/«e»
 * («reuniones»→«reunion», «clases»/«clase»→«clas», «agents»/«agentes»→«agent»).
 * No es un lematizador: lo único que importa es que el singular y el plural
 * caigan en la misma forma al indexar y al buscar. Las palabras de tres letras
 * o menos no se tocan («mes», «api»).
 */
function foldPlural(t: string): string {
  let end = t.length;
  while (end > 3 && (t[end - 1] === "s" || t[end - 1] === "e")) end--;
  return end === t.length ? t : t.slice(0, end);
}

const WORD = /[\p{L}\p{N}]+/gu;
const ONLY_DIGITS = /^\p{N}+$/u;
const HAS_DIGIT = /\p{N}/u;

/**
 * Texto → términos del índice, igual en español que en inglés.
 * - minúsculas y sin tildes;
 * - sin palabras vacías de ningún idioma;
 * - los NÚMEROS se conservan todos («8650», «v2», «3»): en una memoria personal
 *   un puerto o una cifra suele ser justo lo que se busca;
 * - las SIGLAS se conservan: una palabra en mayúsculas de 2 a 6 letras («IA»,
 *   «IT», «MCP») no se descarta aunque coincida con una palabra vacía ni se le
 *   pliega el plural («CORS» no es el plural de nada). Si termina en «s» se
 *   indexa además plegada, para que la encuentre quien la escribe en minúsculas.
 */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(WORD)) {
    const raw = m[0];
    const t = foldAccents(raw);
    if (ONLY_DIGITS.test(t)) {
      out.push(t);
      continue;
    }
    if (t.length < 2) continue;
    if (HAS_DIGIT.test(t)) {
      out.push(t);
      continue;
    }
    const acronym = raw.length <= 6 && raw === raw.toUpperCase() && raw !== raw.toLowerCase();
    if (acronym) {
      out.push(t);
      const folded = foldPlural(t);
      if (folded !== t) out.push(folded);
      continue;
    }
    if (STOPWORDS.has(t)) continue;
    out.push(foldPlural(t));
  }
  return out;
}

/**
 * Huella corta y determinista del contenido (cyrb53 con dos semillas, 27 hex).
 * No es criptográfica: solo decide «¿este texto cambió?» sin depender de
 * `node:crypto`, que el paquete compartido no puede importar (lo usa la web).
 */
export function contentHash(text: string): string {
  const one = (seed: number): string => {
    let h1 = 0xdeadbeef ^ seed;
    let h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < text.length; i++) {
      const ch = text.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
  };
  return one(0) + one(0x9e3779b9).slice(1);
}

// ── Fragmentación ───────────────────────────────────────────────────────

export interface ChunkOptions {
  /** Tope de caracteres por fragmento. */
  maxChars?: number;
  /** Caracteres del final del fragmento anterior que se repiten al empezar el siguiente. */
  overlap?: number;
}

/** Corta una pieza larga por frases; si una sola frase no cabe, por tamaño. */
function splitLong(piece: string, maxChars: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const sentence of piece.split(/(?<=[.!?…:;])\s+|\n/)) {
    const s = sentence.trim();
    if (!s) continue;
    if (cur && cur.length + 1 + s.length > maxChars) {
      out.push(cur);
      cur = "";
    }
    if (s.length > maxChars) {
      if (cur) out.push(cur);
      cur = "";
      for (let i = 0; i < s.length; i += maxChars) out.push(s.slice(i, i + maxChars));
      continue;
    }
    cur = cur ? `${cur} ${s}` : s;
  }
  if (cur) out.push(cur);
  return out;
}

/** La cola de un fragmento que abre el siguiente: desde un inicio de frase o de palabra, nunca media palabra. */
function tailFor(chunk: string, overlap: number): string {
  if (overlap <= 0 || chunk.length <= overlap) return "";
  const tail = chunk.slice(-overlap);
  const sentence = tail.search(/(?<=[.!?…\n])\s+\S/);
  if (sentence >= 0) return tail.slice(sentence).trim();
  const word = tail.indexOf(" ");
  return word >= 0 ? tail.slice(word + 1).trim() : "";
}

/**
 * Parte un texto largo (un acta, una nota del vault) en fragmentos que caben en
 * el motor de vectores y que, al salir en una búsqueda, se leen solos.
 *
 * Respeta párrafos: empaqueta párrafos enteros hasta el tope y solo corta uno
 * por dentro (por frases) si él solo no cabe. Cada fragmento arranca con la
 * cola del anterior (`overlap`) para que una idea que cae en la frontera no
 * quede partida en dos mitades que no se encuentran.
 */
export function chunkText(text: string, opts: ChunkOptions = {}): string[] {
  const maxChars = Math.max(200, opts.maxChars ?? 1200);
  const overlap = Math.max(0, Math.min(opts.overlap ?? 150, Math.floor(maxChars / 3)));
  const clean = text.replace(/\r\n?/g, "\n").trim();
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];

  const pieces: string[] = [];
  for (const para of clean.split(/\n\s*\n+/)) {
    const p = para.trim();
    if (!p) continue;
    if (p.length <= maxChars - overlap) pieces.push(p);
    else pieces.push(...splitLong(p, maxChars - overlap));
  }

  const chunks: string[] = [];
  let cur = "";
  for (const piece of pieces) {
    if (cur && cur.length + 2 + piece.length > maxChars) {
      chunks.push(cur);
      const tail = tailFor(cur, overlap);
      cur = tail ? `${tail}\n\n${piece}` : piece;
    } else {
      cur = cur ? `${cur}\n\n${piece}` : piece;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

// ── Léxico (BM25) ───────────────────────────────────────────────────────

interface Postings {
  docs: number[];
  tfs: number[];
}

export interface LexicalIndex {
  /** Documentos indexados (su posición es la del arreglo de fragmentos). */
  count: number;
  totalLen: number;
  lens: number[];
  postings: Map<string, Postings>;
}

export function createLexicalIndex(): LexicalIndex {
  return { count: 0, totalLen: 0, lens: [], postings: new Map() };
}

/** Agrega un documento (ya tokenizado) al final y devuelve su posición. */
export function addToLexicalIndex(index: LexicalIndex, tokens: readonly string[]): number {
  const i = index.count++;
  index.lens.push(tokens.length);
  index.totalLen += tokens.length;
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  for (const [t, n] of tf) {
    let p = index.postings.get(t);
    if (!p) index.postings.set(t, (p = { docs: [], tfs: [] }));
    p.docs.push(i);
    p.tfs.push(n);
  }
  return i;
}

export function buildLexicalIndex(tokenLists: readonly (readonly string[])[]): LexicalIndex {
  const index = createLexicalIndex();
  for (const tokens of tokenLists) addToLexicalIndex(index, tokens);
  return index;
}

/** Un candidato de una lista ordenada: posición del fragmento y su puntaje en ESA lista. */
export interface Ranked {
  index: number;
  score: number;
}

export interface RankOptions {
  limit?: number;
  /** Devuelve false para dejar fuera un fragmento (otra fuente, otro proyecto, reemplazado). */
  filter?: (index: number) => boolean;
}

/** Los `limit` mejores de un arreglo de puntajes, de mayor a menor; a igual puntaje, el de menor posición. */
function topOf(scores: ArrayLike<number>, candidates: Iterable<number>, opts: RankOptions, floor: number): Ranked[] {
  const out: Ranked[] = [];
  for (const i of candidates) {
    const score = scores[i];
    if (!(score > floor)) continue;
    if (opts.filter && !opts.filter(i)) continue;
    out.push({ index: i, score });
  }
  out.sort((a, b) => b.score - a.score || a.index - b.index);
  return opts.limit !== undefined ? out.slice(0, opts.limit) : out;
}

/**
 * BM25 clásico (k1 = 1,2 · b = 0,75) sobre los términos de la pregunta.
 * Un término repetido en la pregunta cuenta una vez.
 */
export function bm25Search(
  index: LexicalIndex,
  queryTokens: readonly string[],
  opts: RankOptions & { k1?: number; b?: number } = {},
): Ranked[] {
  if (!index.count) return [];
  const k1 = opts.k1 ?? 1.2;
  const b = opts.b ?? 0.75;
  const avgLen = index.totalLen / index.count || 1;
  const scores = new Float64Array(index.count);
  const touched = new Set<number>();
  for (const term of new Set(queryTokens)) {
    const p = index.postings.get(term);
    if (!p) continue;
    const df = p.docs.length;
    const idf = Math.log(1 + (index.count - df + 0.5) / (df + 0.5));
    for (let j = 0; j < df; j++) {
      const d = p.docs[j];
      const tf = p.tfs[j];
      scores[d] += (idf * (tf * (k1 + 1))) / (tf + k1 * (1 - b + (b * index.lens[d]) / avgLen));
      touched.add(d);
    }
  }
  return topOf(scores, touched, opts, 0);
}

// ── Vectores ────────────────────────────────────────────────────────────

/** Deja el vector con norma 1 (en sitio). Con vectores normalizados, el coseno es un producto punto. */
export function normalizeVector(v: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
  const norm = Math.sqrt(sum);
  if (norm > 0) for (let i = 0; i < v.length; i++) v[i] /= norm;
  return v;
}

/** Coseno entre dos vectores cualesquiera (0 si alguno es nulo o no miden lo mismo). */
export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || !a.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na > 0 && nb > 0 ? dot / Math.sqrt(na * nb) : 0;
}

/** Vectores de todo el índice en un solo bloque: fila i = fragmento i. */
export interface VectorMatrix {
  data: Float32Array;
  dims: number;
  /** 1 si el fragmento i tiene vector (un fragmento sin vector sigue saliendo por léxico). */
  has: Uint8Array;
}

/**
 * Búsqueda por fuerza bruta: producto punto de la pregunta contra cada fila.
 * Las filas y la pregunta van NORMALIZADAS. Para un corpus personal (decenas de
 * miles de filas de 1.024) esto toma milisegundos y no necesita un índice ANN.
 */
export function vectorSearch(
  matrix: VectorMatrix,
  query: Float32Array,
  opts: RankOptions & { minSimilarity?: number } = {},
): Ranked[] {
  const { data, dims, has } = matrix;
  if (!dims || query.length !== dims) return [];
  const count = has.length;
  const sims = new Float32Array(count);
  const candidates: number[] = [];
  for (let i = 0; i < count; i++) {
    if (!has[i]) continue;
    const off = i * dims;
    let dot = 0;
    for (let j = 0; j < dims; j++) dot += data[off + j] * query[j];
    sims[i] = dot;
    candidates.push(i);
  }
  return topOf(sims, candidates, opts, opts.minSimilarity ?? -Infinity);
}

// ── Fusión y orden final ────────────────────────────────────────────────

/** Constante de RRF: la del artículo original. Con 60, lo que importa es estar arriba en VARIAS listas. */
export const RRF_K = 60;

export interface Fused {
  index: number;
  score: number;
  /** Rango (1 = primero) en cada lista de entrada; null si no apareció. */
  ranks: (number | null)[];
}

/** Fusión por rango recíproco: puntaje = Σ 1 / (k + rango) sobre las listas donde aparece. */
export function rrfFuse(lists: readonly (readonly Ranked[])[], k = RRF_K): Fused[] {
  const map = new Map<number, Fused>();
  lists.forEach((list, li) => {
    list.forEach((item, pos) => {
      let f = map.get(item.index);
      if (!f) map.set(item.index, (f = { index: item.index, score: 0, ranks: lists.map(() => null) }));
      if (f.ranks[li] !== null) return;
      f.ranks[li] = pos + 1;
      f.score += 1 / (k + pos + 1);
    });
  });
  return [...map.values()].sort((a, b) => b.score - a.score || a.index - b.index);
}

/** Lo que vale subir un puesto en la punta de UNA lista: la unidad en la que se mide el impulso. */
export const RANK_UNIT = 1 / (RRF_K + 1) - 1 / (RRF_K + 2);

/** 1 = recién creado; se parte a la mitad cada `halfLifeDays`. Fechas inválidas o futuras = 0 de antigüedad. */
export function recencyFactor(createdAtMs: number, nowMs: number, halfLifeDays = 60): number {
  if (!Number.isFinite(createdAtMs)) return 0;
  const days = Math.max(0, (nowMs - createdAtMs) / 86_400_000);
  return Math.pow(0.5, days / halfLifeDays);
}

/** Importancia 1-5 → −1…+1 (3 = neutra). Sin importancia declarada no suma ni resta. */
export function importanceFactor(importance: number | null | undefined): number {
  if (typeof importance !== "number" || !Number.isFinite(importance)) return 0;
  return Math.max(-1, Math.min(1, (importance - 3) / 2));
}

export interface BoostWeights {
  /** Puestos (en la punta de una lista) que puede valer ser de hoy. */
  recencyUnits: number;
  /** Puestos que puede valer ser de importancia 5 (y restar ser de importancia 1). */
  importanceUnits: number;
  halfLifeDays: number;
}

/**
 * El impulso es SUAVE a propósito: recencia + importancia juntas valen como
 * mucho ~2 puestos en la punta de una lista. Sirve para desempatar entre dos
 * fragmentos igual de pertinentes (gana el de ayer, gana el marcado como
 * crítico) y NO para que lo reciente tape lo correcto: el hecho de hace un año
 * que es LA respuesta va primero en las dos listas y eso pesa ~4 puestos sobre
 * el tercero. (El RPC anterior daba 15-25 % del puntaje a la recencia y los
 * chats del día tapaban actas y memorias.)
 */
export const DEFAULT_BOOST: BoostWeights = { recencyUnits: 1, importanceUnits: 1, halfLifeDays: 60 };

export function boostOf(
  doc: { createdAt: string; importance?: number | null },
  nowMs: number,
  w: BoostWeights = DEFAULT_BOOST,
): number {
  const recency = recencyFactor(Date.parse(doc.createdAt), nowMs, w.halfLifeDays);
  return RANK_UNIT * (w.recencyUnits * recency + w.importanceUnits * importanceFactor(doc.importance));
}

// ── Diversidad ──────────────────────────────────────────────────────────

/** Clave de «es casi el mismo texto»: el arranque normalizado (los resúmenes de junta se espejan como memoria). */
export function nearDuplicateKey(content: string): string {
  return foldAccents(content).replace(/\s+/g, " ").trim().slice(0, 160);
}

export interface Diversifiable {
  source: string;
  ref: string;
  content: string;
}

/**
 * Diversidad sobre una lista YA ordenada:
 * - ninguna fuente ocupa más de la mitad del resultado (mínimo 2 puestos), para
 *   que cientos de turnos de chat no tapen la única acta que responde;
 * - un mismo documento sale una vez (su mejor fragmento);
 * - contenidos casi idénticos cuentan una vez, aunque vengan de fuentes distintas.
 * Con `cap: false` (quien pidió UNA sola fuente) no se aplica el tope por fuente.
 */
export function diversify<T extends Diversifiable>(hits: readonly T[], limit: number, opts: { cap?: boolean } = {}): T[] {
  const cap = opts.cap === false ? Infinity : Math.max(2, Math.floor(limit / 2));
  const seenText = new Set<string>();
  const seenDoc = new Set<string>();
  const perSource = new Map<string, number>();
  const out: T[] = [];
  for (const h of hits) {
    if (out.length >= limit) break;
    const doc = `${h.source}:${h.ref}`;
    if (seenDoc.has(doc)) continue;
    const key = nearDuplicateKey(h.content);
    if (seenText.has(key)) continue;
    if ((perSource.get(h.source) ?? 0) >= cap) continue;
    seenDoc.add(doc);
    seenText.add(key);
    perSource.set(h.source, (perSource.get(h.source) ?? 0) + 1);
    out.push(h);
  }
  return out;
}

// ── Búsqueda completa ───────────────────────────────────────────────────

/** Un fragmento del índice (una línea de docs.jsonl). */
export interface IndexDoc {
  /** `fuente:ref#n` — único en el índice. */
  id: string;
  source: string;
  /** Ancla dentro de su fuente (uuid de memoria, meeting_id, ruta del vault, id de repetición…). */
  ref: string;
  /** Número de fragmento dentro del documento (0 = el primero). */
  chunk: number;
  title: string;
  text: string;
  project: string | null;
  createdAt: string;
  /** Huella de título + texto: si no cambia, el vector se reusa. */
  hash: string;
  /** Solo memorias: 1-5. */
  importance?: number;
  /** Solo memorias: su tipo (user, project…). La consolidación compara dentro del mismo tipo. */
  kind?: string;
}

/** Clave del DOCUMENTO de un fragmento (todos los fragmentos de una nota comparten clave). */
export function docKey(doc: { source: string; ref: string }): string {
  return `${doc.source}:${doc.ref}`;
}

/** Los términos con que se indexa un fragmento: el título cuenta (una nota se busca por su nombre). */
export function docTokens(doc: { title: string; text: string }): string[] {
  return tokenize(`${doc.title}\n${doc.text}`);
}

export type SearchMode = "lexical" | "vector" | "hybrid";

export interface SearchInput {
  docs: readonly IndexDoc[];
  lexical: LexicalIndex;
  vectors?: VectorMatrix | null;
  query: string;
  /** Vector de la pregunta, del MISMO modelo que el índice y normalizado. Sin él la búsqueda es léxica. */
  queryVector?: Float32Array | null;
  /** Reloj inyectado (ms). */
  now: number;
  limit?: number;
  sources?: readonly string[];
  project?: string;
  /** Forzar un modo (evaluación). Por defecto: híbrido si hay vector de la pregunta, léxico si no. */
  mode?: SearchMode;
  /** Claves de documento (`fuente:ref`) reemplazadas por otro hecho. */
  superseded?: ReadonlySet<string> | ReadonlyMap<string, unknown>;
  /** true = el historial también sale (los reemplazados vuelven a la lista). */
  includeSuperseded?: boolean;
  boost?: BoostWeights;
  /** Similitud mínima para que un vecino cuente (por debajo es ruido del modelo). */
  minSimilarity?: number;
}

export interface SearchHit {
  doc: IndexDoc;
  index: number;
  score: number;
  /** Coseno contra la pregunta, si hubo vectores. */
  similarity: number | null;
  lexRank: number | null;
  vecRank: number | null;
}

export interface SearchOutput {
  hits: SearchHit[];
  /** El modo que DE VERDAD respondió (pedir híbrido sin vectores da léxico). */
  mode: SearchMode;
}

/**
 * La búsqueda entera: filtra, ordena por cada vía, fusiona, impulsa y diversifica.
 * Determinista: mismos datos y mismo `now` → mismo resultado.
 */
export function searchIndex(input: SearchInput): SearchOutput {
  const limit = input.limit ?? 12;
  // Se piden de más a cada vía: varios fragmentos de un mismo documento y los
  // casi-duplicados se caen después, y la fusión necesita cola para comparar.
  const pool = Math.max(60, limit * 6);
  const sources = input.sources?.length ? new Set(input.sources) : null;
  const superseded = input.includeSuperseded ? null : (input.superseded ?? null);
  const filter = (i: number): boolean => {
    const d = input.docs[i];
    if (!d) return false;
    if (sources && !sources.has(d.source)) return false;
    if (input.project && d.project !== input.project) return false;
    if (superseded && superseded.has(docKey(d))) return false;
    return true;
  };

  const canVector = !!(input.vectors && input.queryVector && input.vectors.dims === input.queryVector.length);
  const mode: SearchMode =
    input.mode === "lexical" || !canVector ? "lexical" : input.mode === "vector" ? "vector" : "hybrid";

  const lex = mode === "vector" ? [] : bm25Search(input.lexical, tokenize(input.query), { limit: pool, filter });
  const vec =
    mode === "lexical"
      ? []
      : vectorSearch(input.vectors!, input.queryVector!, { limit: pool, filter, minSimilarity: input.minSimilarity });

  const similarity = new Map(vec.map((v) => [v.index, v.score]));
  const fused = rrfFuse([lex, vec]);
  const boost = input.boost ?? DEFAULT_BOOST;
  const ranked: (SearchHit & Diversifiable)[] = fused.map((f) => {
    const doc = input.docs[f.index];
    return {
      doc,
      index: f.index,
      score: f.score + boostOf(doc, input.now, boost),
      similarity: similarity.get(f.index) ?? null,
      lexRank: f.ranks[0],
      vecRank: f.ranks[1],
      source: doc.source,
      ref: doc.ref,
      content: doc.text,
    };
  });
  ranked.sort((a, b) => b.score - a.score || a.index - b.index);

  const hits = diversify(ranked, limit, { cap: !(sources && sources.size === 1) }).map(
    ({ doc, index, score, similarity: sim, lexRank, vecRank }) => ({ doc, index, score, similarity: sim, lexRank, vecRank }),
  );
  return { hits, mode };
}

// ── Consolidación nocturna: candidatos ──────────────────────────────────

export interface DreamItem {
  /** Clave del documento (`memory:<uuid>`). */
  key: string;
  kind: string | null;
  project: string | null;
  createdAt: string;
  /** Vector normalizado del primer fragmento de la memoria. */
  vector: Float32Array;
}

export interface DreamGroup {
  keys: string[];
  /** La similitud más alta entre dos memorias del grupo. */
  similarity: number;
}

/** Clave estable de un par (para no volver a proponer lo que ya se decidió). */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Memorias que PODRÍAN ser el mismo hecho (o contradecirse): mismo tipo, mismo
 * proyecto y coseno alto. Un par muy parecido es o un duplicado («prefiere
 * pnpm» dos veces) o una actualización («la IP es .100» / «la IP es .104»):
 * distinguirlo es trabajo del modelo, aquí solo se arma la lista corta.
 *
 * Los grupos son componentes conexas de esos pares, cortadas a `maxGroup`
 * (más allá el modelo se pierde) y ordenadas de más a menos parecidas.
 * `skipPairs` = pares ya decididos; un grupo cuyos pares ya se vieron todos no vuelve.
 */
export function dreamCandidates(
  items: readonly DreamItem[],
  opts: { threshold?: number; maxGroup?: number; skipPairs?: ReadonlySet<string> } = {},
): DreamGroup[] {
  const threshold = opts.threshold ?? 0.86;
  const maxGroup = Math.max(2, opts.maxGroup ?? 4);
  const pairs: { a: number; b: number; sim: number }[] = [];
  for (let a = 0; a < items.length; a++) {
    for (let b = a + 1; b < items.length; b++) {
      const x = items[a];
      const y = items[b];
      if (x.kind !== y.kind || x.project !== y.project) continue;
      if (opts.skipPairs?.has(pairKey(x.key, y.key))) continue;
      const sim = cosine(x.vector, y.vector);
      if (sim >= threshold) pairs.push({ a, b, sim });
    }
  }
  pairs.sort((p, q) => q.sim - p.sim || p.a - q.a || p.b - q.b);

  // Unión de pares de mayor a menor similitud, sin dejar que un grupo pase del tope.
  const group = items.map((_, i) => i);
  const size = items.map(() => 1);
  const best = new Map<number, number>();
  const find = (i: number): number => (group[i] === i ? i : (group[i] = find(group[i])));
  for (const p of pairs) {
    const ra = find(p.a);
    const rb = find(p.b);
    if (ra === rb) continue;
    if (size[ra] + size[rb] > maxGroup) continue;
    group[rb] = ra;
    size[ra] += size[rb];
    best.set(ra, Math.max(best.get(ra) ?? 0, best.get(rb) ?? 0, p.sim));
  }
  const members = new Map<number, number[]>();
  items.forEach((_, i) => {
    const r = find(i);
    if (size[r] < 2) return;
    members.set(r, [...(members.get(r) ?? []), i]);
  });
  return [...members.entries()]
    .map(([root, idx]) => ({
      keys: idx
        .slice()
        .sort((i, j) => items[i].createdAt.localeCompare(items[j].createdAt) || items[i].key.localeCompare(items[j].key))
        .map((i) => items[i].key),
      similarity: best.get(root) ?? threshold,
    }))
    .sort((g, h) => h.similarity - g.similarity || g.keys[0].localeCompare(h.keys[0]));
}

// ── Salud ───────────────────────────────────────────────────────────────

export type MemoryHealth = "hibrida" | "lexica" | "caida";

/**
 * La salud en una palabra, la que pinta el panel:
 * - híbrida: hay índice y un motor de vectores que responde con el modelo del índice;
 * - solo léxica: hay índice pero ningún motor (se busca por palabras: sirve, pero
 *   no cruza idiomas ni sinónimos);
 * - caída: no hay índice local y el camino anterior tampoco tiene vectores.
 */
export function memoryHealth(s: { chunks: number; vectors: number; engineReady: boolean }): MemoryHealth {
  if (s.chunks <= 0) return "caida";
  return s.engineReady && s.vectors > 0 ? "hibrida" : "lexica";
}

// ── Evaluación ──────────────────────────────────────────────────────────

/** Una pregunta de evaluación (`~/.hermes-os/memoria/eval.jsonl`). */
export interface EvalQuestion {
  q: string;
  /** Basta UNA: subcadena que debe traer el resultado (sin tildes ni mayúsculas) o ancla `fuente:ref`. */
  expect: string[];
  /** Acota la búsqueda a una fuente. */
  source?: string;
  /** true = la propuso el modelo (`--bootstrap`) y no la escribió el dueño. */
  generated?: boolean;
  note?: string;
}

export interface EvalHit {
  source: string;
  ref: string;
  title: string;
  content: string;
}

const squash = (s: string) => foldAccents(s).replace(/\s+/g, " ");

/** ¿Este resultado responde la pregunta? Por ancla exacta o porque trae la subcadena esperada. */
export function matchesExpectation(hit: EvalHit, expect: readonly string[]): boolean {
  const key = `${hit.source}:${hit.ref}`;
  const body = squash(`${hit.title}\n${hit.content}`);
  return expect.some((e) => {
    const want = e.trim();
    if (!want) return false;
    return want === key || want === hit.ref || body.includes(squash(want));
  });
}

/** Puesto (1 = primero) del primer resultado que responde; null si ninguno. */
export function firstRelevantRank(hits: readonly EvalHit[], expect: readonly string[]): number | null {
  const i = hits.findIndex((h) => matchesExpectation(h, expect));
  return i < 0 ? null : i + 1;
}

export interface EvalModeResult {
  mode: string;
  questions: number;
  /** Fracción de preguntas cuya respuesta sale en los primeros 5. */
  recallAt5: number;
  /** Media de 1/puesto del primer resultado correcto (0 si no salió). */
  mrr: number;
  /** Preguntas sin respuesta en los primeros 5. */
  failed: { q: string; rank: number | null }[];
}

/** Métricas de un modo a partir del puesto de la respuesta en cada pregunta. */
export function evalMetrics(mode: string, ranks: readonly { q: string; rank: number | null }[]): EvalModeResult {
  const n = ranks.length;
  const hit5 = ranks.filter((r) => r.rank !== null && r.rank <= 5).length;
  const mrr = ranks.reduce((sum, r) => sum + (r.rank ? 1 / r.rank : 0), 0);
  return {
    mode,
    questions: n,
    recallAt5: n ? hit5 / n : 0,
    mrr: n ? mrr / n : 0,
    failed: ranks.filter((r) => r.rank === null || r.rank > 5).map((r) => ({ q: r.q, rank: r.rank })),
  };
}

/** El informe en texto: una fila por modo con los dos números y, debajo, qué falló en cada uno. */
export function formatEvalReport(results: readonly EvalModeResult[], header: string[] = []): string {
  const pct = (x: number) => `${(x * 100).toFixed(1)} %`;
  const lines = [...header];
  const width = Math.max(4, ...results.map((r) => r.mode.length));
  lines.push(`${"modo".padEnd(width)}  recall@5   MRR     preguntas`);
  for (const r of results) {
    lines.push(`${r.mode.padEnd(width)}  ${pct(r.recallAt5).padStart(8)}   ${r.mrr.toFixed(3)}   ${r.questions}`);
  }
  for (const r of results) {
    lines.push("");
    lines.push(`Fallan en «${r.mode}» (${r.failed.length} de ${r.questions}):`);
    if (!r.failed.length) lines.push("  ninguna");
    for (const f of r.failed) lines.push(`  - ${f.q}${f.rank ? ` (salió en el puesto ${f.rank})` : " (no salió)"}`);
  }
  return lines.join("\n");
}
