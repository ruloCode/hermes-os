/**
 * Un test por cada `#### Scenario` de openspec/changes/v6-nucleo/specs/memoria/spec.md.
 *
 * Nada toca Supabase, la red ni el `~/.hermes-os` real: el índice vive en una
 * carpeta temporal y el motor de vectores es uno de juguete que convierte
 * palabras en «conceptos» (reunión = meeting), suficiente para probar que la
 * vía de vectores encuentra lo que la léxica no puede.
 */
import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeVector, tokenize, type KnowledgeSource } from "@hermes/shared";

const ROOT = mkdtempSync(join(tmpdir(), "memoria-test-"));
process.env.HERMES_MEMORIA_HOME = join(ROOT, "home-memoria");
process.env.HERMES_MEMORY = "v2";
after(() => rmSync(ROOT, { recursive: true, force: true }));

const { EmbedChain, OpenAIEmbedEngine, setEmbedChain } = await import("./embedder.js");
type EmbedEngine = import("./embedder.js").EmbedEngine;
const { MemoryIndex } = await import("./store.js");
const { syncIndex, toIndexDocs } = await import("./sync.js");
const { localCollectors, allCollectors, EXCLUDED_SOURCES, memoryToSourceDoc } = await import("./sources.js");
type SourceCollector = import("./sources.js").SourceCollector;
type SourceDoc = import("./sources.js").SourceDoc;
const { searchMemoria, indexMemory, similarMemory, resetMemoriaService, flushIndex } = await import("./service.js");
const { runDream } = await import("./dream.js");
const { memoriaStatus } = await import("./status.js");
const { openaiCooling, OPENAI_COOLDOWN_MS } = await import("./cooldown.js");
const { embedBatch } = await import("../embeddings.js");
const { dreamDue } = await import("./jobs.js");

// ── Motor de juguete ────────────────────────────────────────────────────

const CONCEPTS: string[][] = [
  ["reunion", "meeting", "junta"],
  ["client", "customer"],
  ["presupuesto", "budget"],
  ["gimnasio", "articulacion", "gym"],
  ["meta", "goal", "objetivo"],
];

class FakeEngine implements EmbedEngine {
  readonly kind = "local" as const;
  readonly dims = CONCEPTS.length + 1;
  calls: string[][] = [];
  down = "";
  fail = false;
  constructor(readonly id = "local:juguete") {}
  unavailable() {
    return this.down;
  }
  async embed(texts: string[]) {
    if (this.fail) throw new Error("connect ECONNREFUSED 127.0.0.1:8657");
    this.calls.push(texts);
    return texts.map((t) => {
      const v = new Float32Array(this.dims);
      const toks = tokenize(t);
      CONCEPTS.forEach((words, i) => (v[i] = toks.filter((x) => words.includes(x)).length));
      v[this.dims - 1] = 0.2; // ningún vector en cero
      return normalizeVector(v);
    });
  }
  get embedded() {
    return this.calls.reduce((n, c) => n + c.length, 0);
  }
}

/** Un OpenAI que nunca se puede usar (sin llave), para que la cadena tenga el segundo eslabón. */
const deadOpenAI = () => new OpenAIEmbedEngine("");

let dirN = 0;
function freshDir(): string {
  const dir = join(ROOT, `idx-${++dirN}`);
  process.env.HERMES_MEMORIA_DIR = dir;
  resetMemoriaService();
  return dir;
}

function fixed(id: KnowledgeSource, docs: SourceDoc[]): SourceCollector {
  return { id, origin: "local", collect: async () => docs };
}

const d = (source: KnowledgeSource, ref: string, text: string, extra: Partial<SourceDoc> = {}): SourceDoc => ({
  source,
  ref,
  title: extra.title ?? text.slice(0, 40),
  text,
  project: null,
  createdAt: "2026-10-01T12:00:00.000Z",
  ...extra,
});

async function buildIndex(collectors: SourceCollector[], engine: EmbedEngine | null) {
  const chain = new EmbedChain(engine ? [engine, deadOpenAI()] : [deadOpenAI()], () => {});
  setEmbedChain(chain);
  const idx = await MemoryIndex.load();
  const res = await syncIndex(idx, collectors, chain);
  resetMemoriaService();
  return { idx, res, chain };
}

beforeEach(() => {
  setEmbedChain(null);
});

// ── Índice local híbrido ────────────────────────────────────────────────

test("Escenario «Sin internet ni OpenAI»: con el motor local, la búsqueda es híbrida", async () => {
  freshDir();
  const engine = new FakeEngine();
  await buildIndex(
    [fixed("meeting", [d("meeting", "m1", "Reunión con el cliente: se movió al viernes"), d("meeting", "m2", "Presupuesto aprobado")])],
    engine,
  );
  const out = await searchMemoria("reunión con el cliente");
  assert.equal(out.mode, "hybrid");
  assert.equal(out.hits[0].ref, "m1");
  assert.ok(typeof out.hits[0].similarity === "number");
});

test("Escenario «Sin vectores»: resultados léxicos y el estado dice modo léxico", async () => {
  freshDir();
  const engine = new FakeEngine();
  await buildIndex([fixed("memory", [d("memory", "a", "El puerto del agente de producción es 8650")])], engine);
  engine.down = "No encuentro llama-server en /nada";
  const out = await searchMemoria("puerto 8650");
  assert.equal(out.mode, "lexical");
  assert.equal(out.hits[0]?.ref, "a");
  const st = await memoriaStatus();
  assert.equal(st.health, "lexica");
  assert.equal(st.engine.ready, false);
  assert.match(String(st.engine.reason), /llama-server/);
});

test("Escenario «Pregunta en español, texto en inglés»: aparece por la parte de vectores", async () => {
  freshDir();
  await buildIndex(
    [
      fixed("vault", [
        d("vault", "notes/en.md", "The customer meeting was moved to Friday afternoon", { title: "Weekly notes" }),
        d("vault", "notes/budget.md", "Presupuesto de Oracle aprobado", { title: "Oracle" }),
        d("vault", "notes/gym.md", "Rutina de gimnasio de articulación", { title: "Gimnasio" }),
      ]),
    ],
    new FakeEngine(),
  );
  const out = await searchMemoria("¿cuándo es la reunión con el cliente?", { limit: 3 });
  const hit = out.hits.find((h) => h.ref === "notes/en.md");
  assert.ok(hit, "el texto en inglés aparece");
  assert.equal(out.hits[0].ref, "notes/en.md");
  // No comparte ni una palabra con la pregunta: solo la vía de vectores lo pudo traer.
  const lexical = await searchMemoria("¿cuándo es la reunión con el cliente?", { limit: 3, mode: "lexical" });
  assert.ok(!lexical.hits.some((h) => h.ref === "notes/en.md"));
});

test("Escenario «Diversidad»: ninguna fuente ocupa más de la mitad de la respuesta", async () => {
  freshDir();
  const chats = Array.from({ length: 20 }, (_, i) => d("conversation", `c${i}`, `Hablamos del presupuesto de Teker, vuelta ${i} número ${i * 7}`));
  await buildIndex(
    [
      fixed("conversation", chats),
      fixed("vault", [d("vault", "teker.md", "Presupuesto de Teker: 40 millones")]),
      fixed("meeting", [d("meeting", "t1", "Junta Teker: presupuesto y plazos")]),
    ],
    new FakeEngine(),
  );
  const out = await searchMemoria("presupuesto de Teker", { limit: 6 });
  const bySource = new Map<string, number>();
  for (const h of out.hits) bySource.set(h.source, (bySource.get(h.source) ?? 0) + 1);
  for (const [s, n] of bySource) assert.ok(n <= out.hits.length / 2, `${s} ocupa ${n} de ${out.hits.length}`);
  assert.ok(bySource.has("vault") && bySource.has("meeting"));
});

// ── Todos los almacenes ─────────────────────────────────────────────────

function writeHome(): string {
  const home = join(ROOT, `home-${++dirN}`);
  mkdirSync(join(home, "gym"), { recursive: true });
  mkdirSync(join(home, "growth"), { recursive: true });
  mkdirSync(join(home, "finance"), { recursive: true });
  mkdirSync(join(home, "composicion"), { recursive: true });
  writeFileSync(
    join(home, "gym", "reps.jsonl"),
    JSON.stringify({
      id: "r1",
      date: "2026-10-14",
      scenarioId: "es-explicar-rag",
      lang: "es",
      attempt: 1,
      transcript: "Un RAG le pasa al modelo el conocimiento de tu empresa como contexto",
      durationSec: 20,
      words: 14,
      wpm: 120,
      fillers: 0,
      weak: [],
      feedback: { scores: {}, notes: {}, better: "RAG es memoria para el modelo", tip: "Empieza por el punto" },
      score: 70,
      createdAt: "2026-10-14T15:00:00.000Z",
    }) + "\n",
  );
  writeFileSync(
    join(home, "growth", "plans.json"),
    JSON.stringify([{ id: "p1", goal_id: 4, words: "Martes y jueves a las 12:00, dos conversaciones de venta", when: {}, measure: {}, status: "active", created_at: "2026-10-15T00:00:00.000Z" }]),
  );
  writeFileSync(join(home, "finance", "plan.json"), JSON.stringify({ nota: "zarzaparrilla mensual 500000" }));
  writeFileSync(join(home, "composicion", "board.json"), JSON.stringify({ letra: "zarzaparrilla en la madrugada" }));
  return home;
}

test("Escenario «Dato que solo vivía en un JSON local»: la repetición del gimnasio y la meta salen con su fuente", async () => {
  freshDir();
  const home = writeHome();
  await buildIndex(localCollectors(home), new FakeEngine());
  const gym = await searchMemoria("qué dije sobre RAG en el gimnasio");
  assert.equal(gym.hits[0]?.source, "gym");
  assert.match(gym.hits[0].content, /RAG/);
  const goal = await searchMemoria("conversaciones de venta martes");
  assert.equal(goal.hits[0]?.source, "growth");
});

test("Escenario «Fuentes excluidas»: finanzas y composición quedan fuera", async () => {
  const home = writeHome();
  const collectors = allCollectors(null, home);
  const ids = collectors.map((c) => c.id as string);
  for (const x of EXCLUDED_SOURCES) assert.ok(!ids.includes(x), `${x} no es fuente`);
  const docs = (await Promise.all(collectors.map((c) => c.collect()))).flat();
  assert.ok(docs.length > 0);
  assert.ok(!docs.some((x) => /zarzaparrilla/.test(`${x.title} ${x.text}`)), "nada de finance/ ni composicion/ entró");
});

// ── Memorias nuevas ─────────────────────────────────────────────────────

test("Escenario «Guardar y buscar»: aparece al instante aunque OpenAI esté caído", async () => {
  freshDir();
  const engine = new FakeEngine();
  await buildIndex([fixed("memory", [d("memory", "vieja", "Prefiere pnpm sobre npm")])], engine);
  // OpenAI sin crédito: la cadena lo tiene, pero en enfriamiento (no hay llave).
  const row = { id: "nueva-1", type: "user", content: "La tira de luces se llama luz led y es una KL400L5", summary: null, project_slug: null, importance: 4, created_at: new Date().toISOString() };
  const r = await indexMemory(row);
  assert.equal(r.withVector, true);
  const out = await searchMemoria("cómo se llama la tira de luces");
  assert.equal(out.hits[0]?.ref, "nueva-1");
  // Y queda en disco: un reinicio la conserva.
  await flushIndex();
  resetMemoriaService();
  const again = await searchMemoria("KL400L5");
  assert.equal(again.hits[0]?.ref, "nueva-1");
  // Sin motor alguno también entra (sale por léxico).
  engine.down = "apagado";
  await indexMemory({ ...row, id: "nueva-2", content: "El router de la casa es un TP-Link Archer" });
  assert.equal((await searchMemoria("router TP-Link")).hits[0]?.ref, "nueva-2");
});

test("Dedup de saveMemory con el motor local: coseno ≥ 0,9 contra la memoria del mismo tipo", async () => {
  freshDir();
  await buildIndex(
    [fixed("memory", [d("memory", "m1", "Junta con el cliente los viernes", { kind: "user", title: "Junta con el cliente los viernes" })])],
    new FakeEngine(),
  );
  const same = await similarMemory("Junta con el cliente los viernes", "user");
  assert.ok(same && same.ref === "m1" && same.similarity >= 0.9);
  const otherType = await similarMemory("Junta con el cliente los viernes", "project");
  assert.equal(otherType, null, "otro tipo no cuenta");
});

// ── Sincronización ──────────────────────────────────────────────────────

test("Escenario «Nada cambió»: no se calcula ningún vector", async () => {
  freshDir();
  const engine = new FakeEngine();
  const src = [fixed("memory", [d("memory", "a", "uno"), d("memory", "b", "dos")]), fixed("vault", [d("vault", "n.md", "nota larga ".repeat(300))])];
  const { idx, res, chain } = await buildIndex(src, engine);
  assert.ok(res.embedded > 0);
  const before = engine.embedded;
  const again = await syncIndex(idx, src, chain);
  assert.equal(again.embedded, 0);
  assert.equal(engine.embedded, before, "el motor no recibió nada");
});

test("Escenario «Un documento cambió»: solo ese se vuelve a embeber", async () => {
  freshDir();
  const engine = new FakeEngine();
  const docs = [d("memory", "a", "uno"), d("memory", "b", "dos"), d("vault", "n.md", "nota larga con párrafos. ".repeat(200))];
  const { idx, chain } = await buildIndex([fixed("memory", docs.slice(0, 2)), fixed("vault", docs.slice(2))], engine);
  engine.calls = [];
  const changed = d("memory", "b", "dos, ahora con otro texto");
  const res = await syncIndex(idx, [fixed("memory", [docs[0], changed]), fixed("vault", docs.slice(2))], chain);
  assert.equal(res.embedded, toIndexDocs(changed).length);
  assert.ok(engine.calls.flat().every((t) => t.includes("otro texto")));
});

test("Escenario «Reconstrucción»: el índice se rehace completo desde las fuentes", async () => {
  freshDir();
  const engine = new FakeEngine();
  const { idx, chain } = await buildIndex([fixed("memory", [d("memory", "a", "uno"), d("memory", "b", "dos")])], engine);
  const res = await syncIndex(idx, [fixed("memory", [d("memory", "a", "uno")])], chain, { full: true });
  assert.equal(res.embedded, 1, "re-embebe todo lo que existe, aunque no haya cambiado");
  assert.equal(res.removed, 1, "lo que ya no está en las fuentes se va");
  assert.deepEqual(idx.docs.map((x) => x.ref), ["a"]);
  assert.equal(idx.meta.lastSyncKind, "full");
});

test("Una fuente rota no tumba a las demás y conserva lo que tenía", async () => {
  freshDir();
  const engine = new FakeEngine();
  const { idx, chain } = await buildIndex([fixed("memory", [d("memory", "a", "uno")]), fixed("vault", [d("vault", "n.md", "nota")])], engine);
  const broken: SourceCollector = { id: "vault", origin: "supabase", collect: async () => Promise.reject(new Error("timeout")) };
  const res = await syncIndex(idx, [fixed("memory", [d("memory", "a", "uno"), d("memory", "c", "tres")]), broken], chain);
  assert.match(res.sourceErrors["supabase:vault"], /timeout/);
  assert.deepEqual(idx.docs.map((x) => x.ref).sort(), ["a", "c", "n.md"]);
});

// ── Vigencia y sueño ────────────────────────────────────────────────────

async function twoFacts() {
  freshDir();
  const engine = new FakeEngine();
  const { idx } = await buildIndex(
    [
      fixed("memory", [
        d("memory", "vieja", "La junta con el cliente es los lunes", { kind: "user", createdAt: "2026-08-01T00:00:00.000Z" }),
        d("memory", "nueva", "La junta con el cliente pasó a los viernes", { kind: "user", createdAt: "2026-11-01T00:00:00.000Z" }),
      ]),
    ],
    engine,
  );
  return idx;
}

test("Escenario «Dato viejo contra dato nuevo»: la búsqueda devuelve la nueva y la vieja queda como historial", async () => {
  const idx = await twoFacts();
  const run = await runDream(idx, {
    auto: true,
    threshold: 0.8,
    now: new Date("2026-11-10T08:30:00Z"),
    decide: async (groups) => groups.map((_, group) => ({ group, action: "reemplaza" as const, keep: "memory:nueva", reason: "cambió el día" })),
  });
  assert.equal(run.applied, 1);
  await idx.persist();
  resetMemoriaService();
  const out = await searchMemoria("junta con el cliente");
  assert.ok(out.hits.some((h) => h.ref === "nueva"));
  assert.ok(!out.hits.some((h) => h.ref === "vieja"), "la vieja ya no sale");
  const history = await searchMemoria("junta con el cliente", { includeSuperseded: true });
  assert.ok(history.hits.some((h) => h.ref === "vieja"), "se puede consultar como historial");
  assert.deepEqual(
    { by: idx.state.superseded["memory:vieja"].by, since: idx.state.superseded["memory:vieja"].since },
    { by: "memory:nueva", since: "2026-11-10T08:30:00.000Z" },
  );
});

test("Escenario «Sin aprobación»: sin HERMES_LEARNING=auto deja propuestas y no cambia nada", async () => {
  const idx = await twoFacts();
  const run = await runDream(idx, {
    auto: false,
    threshold: 0.8,
    decide: async (groups) => groups.map((_, group) => ({ group, action: "reemplaza" as const, keep: "memory:nueva", reason: "cambió el día" })),
  });
  assert.equal(run.proposals, 1);
  assert.equal(run.applied, 0);
  assert.deepEqual(idx.state.superseded, {});
  const { readProposals } = await import("./dream.js");
  const pending = (await readProposals(idx)).filter((p) => p.status === "pending");
  assert.equal(pending.length, 1);
  assert.deepEqual(pending[0].superseded, ["memory:vieja"]);
  // Lo ya mirado no se vuelve a proponer la noche siguiente.
  const again = await runDream(idx, { auto: false, threshold: 0.8, decide: async () => assert.fail("no debía preguntar") });
  assert.equal(again.candidates, 0);
});

test("El sueño toca una vez por noche, pasadas las 3:30 hora local", () => {
  const at = (h: number, m: number, day = 10) => new Date(2026, 10, day, h, m);
  assert.equal(dreamDue(at(3, 0), null), false);
  assert.equal(dreamDue(at(3, 31), null), true);
  assert.equal(dreamDue(at(9, 0), at(3, 35).toISOString()), false, "ya soñó hoy");
  assert.equal(dreamDue(at(3, 40, 11), at(3, 35).toISOString()), true, "otra noche");
});

// ── Salud ───────────────────────────────────────────────────────────────

test("Escenario «El motor de vectores se cae»: UN aviso con el motivo, no uno por intento", async () => {
  const logs: string[] = [];
  const engine = new FakeEngine();
  const chain = new EmbedChain([engine], (m) => logs.push(m));
  assert.ok(await chain.embedWith(engine.id, ["hola"]));
  engine.fail = true;
  for (let i = 0; i < 5; i++) assert.equal(await chain.embedWith(engine.id, ["hola"]), null);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /\[memoria\].*ECONNREFUSED/);
  assert.equal(chain.notices.length, 1);
  assert.equal(chain.status()[0].state, "down");
  engine.fail = false;
  await chain.embedWith(engine.id, ["hola"]);
  assert.equal(logs.length, 2, "y una línea cuando vuelve");
  assert.equal(chain.status()[0].state, "ok");
});

test("Escenario «OpenAI sin crédito»: no se le vuelve a llamar durante 6 horas", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response(JSON.stringify({ error: { code: "insufficient_quota", message: "You exceeded your current quota" } }), { status: 429 });
  }) as typeof fetch;
  try {
    const engine = new OpenAIEmbedEngine("sk-prueba");
    await assert.rejects(engine.embed(["hola"]));
    assert.equal(calls, 1);
    assert.match(engine.unavailable(), /crédito/);
    await assert.rejects(engine.embed(["hola"]));
    assert.equal(calls, 1, "en enfriamiento no se llama");
    // embeddings.ts (los vectores de Supabase) respeta el mismo enfriamiento.
    assert.deepEqual(await embedBatch(["hola", "chao"]), [null, null]);
    assert.equal(calls, 1);
    const now = Date.now();
    assert.ok(openaiCooling(now + OPENAI_COOLDOWN_MS - 60_000), "sigue enfriado casi 6 h después");
    assert.equal(openaiCooling(now + OPENAI_COOLDOWN_MS + 60_000), null, "pasadas las 6 h se vuelve a intentar");
  } finally {
    globalThis.fetch = original;
  }
});

test("memoryToSourceDoc y la sincronización producen la misma huella (saveMemory no se re-embebe)", () => {
  const row = { id: "x", type: "user", content: "hola", summary: null, project_slug: null, importance: 3, created_at: "2026-11-01T00:00:00.000Z" };
  const a = toIndexDocs(memoryToSourceDoc(row));
  const b = toIndexDocs(memoryToSourceDoc({ ...row }));
  assert.equal(a[0].hash, b[0].hash);
});

// ── Evaluación ──────────────────────────────────────────────────────────

test("Escenario «Comparación»: los dos números por modo (léxico, vectores, híbrido, anterior) y qué preguntas fallaron", async () => {
  const { runEval, parseEvalLines } = await import("./eval.js");
  const { formatEvalReport } = await import("@hermes/shared");
  const { questions, invalid } = parseEvalLines(
    [
      JSON.stringify({ q: "¿cuándo es la junta con el cliente?", expect: ["viernes"] }),
      JSON.stringify({ q: "¿qué puerto usa producción?", expect: ["memory:p"] }),
      "{roto",
      JSON.stringify({ q: "sin expect", expect: [] }),
    ].join("\n"),
  );
  assert.equal(questions.length, 2);
  assert.equal(invalid, 2);
  const hit = (source: string, ref: string, content: string) => ({ source, ref, title: "", content });
  const results = await runEval(questions, [
    { mode: "léxico", search: async (q) => (q.q.includes("puerto") ? [hit("memory", "p", "8650")] : []) },
    { mode: "vectores", search: async (q) => (q.q.includes("junta") ? [hit("x", "1", "nada"), hit("meeting", "m", "el viernes")] : []) },
    { mode: "híbrido", search: async () => [hit("meeting", "m", "el viernes"), hit("memory", "p", "8650")] },
    { mode: "anterior (supabase)", search: async () => Promise.reject(new Error("caído")) },
  ]);
  const report = formatEvalReport(results);
  for (const mode of ["léxico", "vectores", "híbrido", "anterior (supabase)"]) assert.match(report, new RegExp(mode.replace(/[()]/g, "\\$&")));
  const by = Object.fromEntries(results.map((r) => [r.mode, r]));
  assert.equal(by["híbrido"].recallAt5, 1);
  assert.equal(by["híbrido"].mrr, 0.75);
  assert.equal(by["vectores"].mrr, 0.25);
  assert.equal(by["anterior (supabase)"].recallAt5, 0, "un modo que falla cuenta como fallo, no tumba la evaluación");
  assert.match(report, /recall@5/);
  assert.match(report, /MRR/);
  assert.match(report, /Fallan en «léxico» \(1 de 2\):\n  - ¿cuándo es la junta con el cliente\? \(no salió\)/);
});
