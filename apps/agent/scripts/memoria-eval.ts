/**
 * `pnpm memoria:eval` — recall@5 y MRR de la memoria por modo: léxico,
 * vectores, híbrido (índice local v2) y el camino anterior (`supabase`:
 * match_knowledge con OpenAI, o ILIKE de la frase entera si OpenAI no responde).
 *
 *   --file <ruta>     preguntas (default ~/.hermes-os/memoria/eval.jsonl)
 *   --out <ruta>      además, guarda el informe en ese archivo
 *   --modes a,b       solo esos modos
 *   --bootstrap N     propone N preguntas desde documentos reales del índice
 *                     (modelo barato) en eval.candidatas.jsonl, para curar a mano
 */
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { formatEvalReport, type EvalHit, type EvalQuestion, type SearchMode } from "@hermes/shared";
import { searchKnowledgeLegacy } from "../src/knowledge.js";
import { embedChain } from "../src/memoria/embedder.js";
import { candidatesPath, evalPath, pickForBootstrap, proposeQuestions, readEvalFile, runEval, type EvalSearcher } from "../src/memoria/eval.js";
import { MemoryIndex } from "../src/memoria/store.js";

const argv = process.argv.slice(2);
const arg = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const K = 10;

async function bootstrap(n: number) {
  const idx = await MemoryIndex.load();
  if (!idx.size) throw new Error("El índice está vacío: corre primero pnpm memoria:build.");
  // Reparto: las actas y memorias son lo que más se pregunta; las fuentes nuevas, un poco cada una.
  const docs = pickForBootstrap(idx.docs, n, { meeting: 10, memory: 8, vault: 8, english: 3, execution: 2, gym: 2, growth: 2, upwork: 2, tutor: 1, conversation: 2 });
  const out = candidatesPath();
  await mkdir(dirname(out), { recursive: true });
  let total = 0;
  for (let i = 0; i < docs.length; i += 10) {
    const batch = docs.slice(i, i + 10);
    const qs = await proposeQuestions(batch);
    total += qs.length;
    await appendFile(out, qs.map((q) => JSON.stringify(q)).join("\n") + (qs.length ? "\n" : ""));
    console.log(`  lote ${i / 10 + 1}: ${qs.length} de ${batch.length} preguntas válidas`);
  }
  console.log(`${total} candidatas en ${out}`);
}

async function main() {
  const n = arg("--bootstrap");
  if (n) return bootstrap(Math.max(1, Math.min(200, Number(n) || 40)));

  const file = arg("--file") ?? evalPath();
  const { questions, invalid } = await readEvalFile(file);
  if (!questions.length) throw new Error(`Sin preguntas en ${file}.`);
  const idx = await MemoryIndex.load();
  const chain = embedChain();
  const engine = idx.model ? chain.byId(idx.model) : null;

  // El vector de cada pregunta se calcula UNA vez y lo usan los tres modos locales.
  const qvec = new Map<string, Float32Array | null>();
  if (engine && idx.vectorCount) {
    const out = await chain.embedWith(engine.id, questions.map((q) => q.q));
    questions.forEach((q, i) => qvec.set(q.q, out?.[i] ?? null));
  }
  const now = Date.now();
  const local = (mode: SearchMode): EvalSearcher => ({
    mode: mode === "lexical" ? "léxico" : mode === "vector" ? "vectores" : "híbrido",
    async search(q: EvalQuestion): Promise<EvalHit[]> {
      if (mode !== "lexical" && !qvec.get(q.q)) return [];
      const out = idx.search({ query: q.q, queryVector: qvec.get(q.q) ?? null, now, limit: K, mode, sources: q.source ? [q.source] : undefined });
      return out.hits.map((h) => ({ source: h.doc.source, ref: h.doc.ref, title: h.doc.title, content: h.doc.text }));
    },
  });
  const legacy: EvalSearcher = {
    mode: "anterior (supabase)",
    async search(q) {
      const hits = await searchKnowledgeLegacy(q.q, { limit: K, sources: q.source ? [q.source as never] : undefined });
      return hits.map((h) => ({ source: h.source, ref: h.ref, title: h.title, content: h.content }));
    },
  };
  const all: Record<string, EvalSearcher> = { lexical: local("lexical"), vector: local("vector"), hybrid: local("hybrid"), supabase: legacy };
  const wanted = (arg("--modes") ?? "lexical,vector,hybrid,supabase").split(",").map((s) => s.trim());
  const t = Date.now();
  const results = await runEval(questions, wanted.map((m) => all[m]).filter(Boolean));
  const generated = questions.filter((q) => q.generated).length;
  const header = [
    `Evaluación de la memoria · ${new Date().toISOString()}`,
    `Preguntas: ${questions.length} (${generated} generadas por modelo y revisadas, ${questions.length - generated} escritas a mano)${invalid ? ` · ${invalid} líneas inválidas ignoradas` : ""}`,
    `Índice: ${idx.size} fragmentos, ${idx.vectorCount} con vector, modelo ${idx.model ?? "ninguno"} · archivo ${file}`,
    `Se piden ${K} resultados por pregunta; recall@5 = la respuesta sale en los primeros 5; MRR = media de 1/puesto.`,
    `Tiempo total: ${((Date.now() - t) / 1000).toFixed(1)} s`,
    "",
  ];
  const report = formatEvalReport(results, header);
  console.log(report);
  const out = arg("--out");
  if (out) {
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, report + "\n");
    console.log(`\nGuardado en ${out}`);
  }
  if (!argv.includes("--keep-engine")) await chain.stop();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
