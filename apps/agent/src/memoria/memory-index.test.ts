/**
 * Contratos de la lógica pura del índice (packages/shared/src/memory-index.ts).
 * Vectores a mano: lo que se prueba es el orden, no un modelo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bm25Search,
  boostOf,
  buildLexicalIndex,
  chunkText,
  contentHash,
  cosine,
  diversify,
  dreamCandidates,
  evalMetrics,
  firstRelevantRank,
  formatEvalReport,
  memoryHealth,
  normalizeVector,
  RANK_UNIT,
  rrfFuse,
  searchIndex,
  tokenize,
  docTokens,
  type IndexDoc,
} from "@hermes/shared";

const NOW = Date.parse("2026-11-10T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

function doc(i: number, over: Partial<IndexDoc>): IndexDoc {
  return {
    id: `${over.source ?? "memory"}:${over.ref ?? i}#0`,
    source: "memory",
    ref: String(i),
    chunk: 0,
    title: "",
    text: "",
    project: null,
    createdAt: daysAgo(10),
    hash: String(i),
    ...over,
  };
}

test("tokenizador: minúsculas, sin tildes, sin palabras vacías es/en; números y siglas se quedan", () => {
  const t = tokenize("La reunión de IA con el cliente fue en el puerto 8650, the API is ready");
  assert.ok(t.includes("reunion"), "sin tilde y en minúscula");
  assert.ok(t.includes("ia"), "la sigla IA no se descarta aunque «ia» parezca vacía");
  assert.ok(t.includes("8650"), "los números se conservan");
  assert.ok(t.includes("api"), "sigla en inglés");
  for (const w of ["la", "de", "con", "el", "fue", "en", "the", "is"]) assert.ok(!t.includes(w), `«${w}» es vacía`);
  // Plural y singular caen en la misma forma.
  assert.deepEqual(tokenize("reuniones"), tokenize("reunión"));
  assert.deepEqual(tokenize("agentes"), tokenize("agente"));
  assert.ok(tokenize("v2 3").includes("v2") && tokenize("v2 3").includes("3"));
});

test("BM25: el término raro pesa más que el común y el documento que lo tiene gana", () => {
  const docs = [
    "proyecto teker reunión semanal",
    "proyecto ternium reunión semanal",
    "proyecto teker presupuesto aprobado oracle",
    "proyecto careways reunión",
  ];
  const idx = buildLexicalIndex(docs.map((d) => tokenize(d)));
  const r = bm25Search(idx, tokenize("presupuesto de teker"));
  assert.equal(r[0].index, 2);
  assert.ok(r.every((x) => x.score > 0));
  assert.equal(bm25Search(idx, tokenize("zanahoria")).length, 0);
});

test("coseno y normalización", () => {
  const a = normalizeVector(Float32Array.from([3, 4]));
  assert.ok(Math.abs(a[0] - 0.6) < 1e-6 && Math.abs(a[1] - 0.8) < 1e-6);
  assert.ok(Math.abs(cosine(Float32Array.from([1, 0]), Float32Array.from([0, 1]))) < 1e-9);
  assert.equal(cosine(Float32Array.from([1, 0]), Float32Array.from([1, 0, 0])), 0, "dimensiones distintas no se comparan");
});

test("RRF: lo que está arriba en las dos listas gana a lo que está primero en una sola", () => {
  const fused = rrfFuse([
    [{ index: 1, score: 9 }, { index: 2, score: 5 }],
    [{ index: 3, score: 0.9 }, { index: 2, score: 0.8 }],
  ]);
  assert.equal(fused[0].index, 2);
  assert.deepEqual(fused[0].ranks, [2, 2]);
});

test("impulso suave: lo reciente desempata pero no entierra el hecho viejo que es LA respuesta", () => {
  // El viejo es primero en las dos vías; el nuevo es segundo en las dos, de hoy y crítico.
  const old = rrfFuse([[{ index: 0, score: 1 }, { index: 1, score: 0.5 }], [{ index: 0, score: 1 }, { index: 1, score: 0.5 }]]);
  const oldScore = old[0].score + boostOf({ createdAt: daysAgo(400), importance: 3 }, NOW);
  const newScore = old[1].score + boostOf({ createdAt: daysAgo(0), importance: 5 }, NOW);
  assert.ok(oldScore > newScore, "el viejo correcto sigue primero");
  // Con el mismo puesto, gana el reciente.
  assert.ok(boostOf({ createdAt: daysAgo(1) }, NOW) > boostOf({ createdAt: daysAgo(300) }, NOW));
  assert.ok(boostOf({ createdAt: daysAgo(0), importance: 5 }, NOW) <= 2 * RANK_UNIT + 1e-12);
});

test("fragmentación: respeta párrafos, solapa y no pasa del tope", () => {
  const para = (n: number) => `Párrafo ${n}. ` + "Esta es una frase de relleno con contenido real. ".repeat(8);
  const text = Array.from({ length: 8 }, (_, i) => para(i)).join("\n\n");
  const chunks = chunkText(text, { maxChars: 1000, overlap: 120 });
  assert.ok(chunks.length > 1);
  for (const c of chunks) assert.ok(c.length <= 1000, `fragmento de ${c.length}`);
  // Ningún párrafo corto quedó partido: cada «Párrafo n.» aparece entero en algún fragmento.
  for (let i = 0; i < 8; i++) assert.ok(chunks.some((c) => c.includes(para(i).trim())), `párrafo ${i} entero`);
  // Solape: el segundo fragmento arranca con texto del final del primero.
  const tail = chunks[0].slice(-60).split(". ").pop()!.trim().slice(0, 20);
  assert.ok(chunks[1].includes(tail), "el siguiente repite la cola del anterior");
  assert.deepEqual(chunkText("corto"), ["corto"]);
  assert.deepEqual(chunkText("   "), []);
});

test("huella: determinista y sensible a un carácter", () => {
  assert.equal(contentHash("hola mundo"), contentHash("hola mundo"));
  assert.notEqual(contentHash("hola mundo"), contentHash("hola mundo."));
});

test("diversidad: tope por fuente, un documento una vez, casi-duplicados una vez", () => {
  const hits = [
    { source: "conversation", ref: "1", content: "texto a" },
    { source: "conversation", ref: "1", content: "otro fragmento del mismo" },
    { source: "conversation", ref: "2", content: "texto b" },
    { source: "memory", ref: "9", content: "Texto   B" },
    { source: "conversation", ref: "3", content: "texto c" },
    { source: "conversation", ref: "4", content: "texto d" },
    { source: "vault", ref: "x", content: "nota" },
  ];
  const out = diversify(hits, 4);
  assert.equal(out.filter((h) => h.source === "conversation").length, 2);
  assert.equal(out.filter((h) => h.ref === "1").length, 1);
  assert.ok(!out.some((h) => h.source === "memory"), "«Texto   B» es casi idéntico a «texto b»");
  assert.ok(out.some((h) => h.source === "vault"));
});

test("búsqueda: los hechos reemplazados no salen salvo que se pida el historial", () => {
  const docs = [doc(1, { text: "la IP de la luz es 192.168.1.100" }), doc(2, { text: "la IP de la luz es 192.168.1.104" })];
  const lexical = buildLexicalIndex(docs.map(docTokens));
  const superseded = new Set(["memory:1"]);
  const now = searchIndex({ docs, lexical, query: "ip de la luz", now: NOW, superseded });
  assert.deepEqual(now.hits.map((h) => h.doc.ref), ["2"]);
  const all = searchIndex({ docs, lexical, query: "ip de la luz", now: NOW, superseded, includeSuperseded: true });
  assert.deepEqual(all.hits.map((h) => h.doc.ref).sort(), ["1", "2"]);
});

test("candidatos del sueño: mismo tipo y proyecto con coseno alto, nunca cruzados", () => {
  const v = (...x: number[]) => normalizeVector(Float32Array.from(x));
  const items = [
    { key: "memory:a", kind: "user", project: null, createdAt: daysAgo(30), vector: v(1, 0.05, 0) },
    { key: "memory:b", kind: "user", project: null, createdAt: daysAgo(1), vector: v(1, 0.06, 0) },
    { key: "memory:c", kind: "project", project: null, createdAt: daysAgo(1), vector: v(1, 0.05, 0) },
    { key: "memory:d", kind: "user", project: null, createdAt: daysAgo(1), vector: v(0, 1, 0) },
  ];
  const groups = dreamCandidates(items, { threshold: 0.9 });
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].keys, ["memory:a", "memory:b"], "ordenado del más viejo al más nuevo");
  assert.equal(dreamCandidates(items, { threshold: 0.9, skipPairs: new Set(["memory:a|memory:b"]) }).length, 0);
});

test("salud en una palabra", () => {
  assert.equal(memoryHealth({ chunks: 10, vectors: 10, engineReady: true }), "hibrida");
  assert.equal(memoryHealth({ chunks: 10, vectors: 10, engineReady: false }), "lexica");
  assert.equal(memoryHealth({ chunks: 10, vectors: 0, engineReady: true }), "lexica");
  assert.equal(memoryHealth({ chunks: 0, vectors: 0, engineReady: true }), "caida");
});

test("evaluación: recall@5, MRR y preguntas que fallan", () => {
  const hits = [
    { source: "meeting", ref: "m1", title: "Junta Teker", content: "Se aprobó el presupuesto de Oracle" },
    { source: "memory", ref: "x", title: "", content: "otra cosa" },
  ];
  assert.equal(firstRelevantRank(hits, ["presupuesto de oracle"]), 1);
  assert.equal(firstRelevantRank(hits, ["memory:x"]), 2, "por ancla fuente:ref");
  assert.equal(firstRelevantRank(hits, ["nada"]), null);
  const m = evalMetrics("híbrido", [
    { q: "a", rank: 1 },
    { q: "b", rank: 2 },
    { q: "c", rank: null },
    { q: "d", rank: 7 },
  ]);
  assert.equal(m.recallAt5, 0.5);
  assert.ok(Math.abs(m.mrr - (1 + 0.5 + 0 + 1 / 7) / 4) < 1e-9);
  assert.deepEqual(m.failed.map((f) => f.q), ["c", "d"]);
});
