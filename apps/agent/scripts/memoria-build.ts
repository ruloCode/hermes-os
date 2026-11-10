/**
 * `pnpm memoria:build` — rehace el índice de la memoria v2 COMPLETO desde las
 * fuentes (Supabase, solo lectura, y los almacenes de ~/.hermes-os) y calcula
 * todos los vectores con el primer motor disponible (local → OpenAI).
 *
 *   --incremental   solo lo que cambió (lo mismo que hace el job cada 15 min)
 *   --keep-engine   no apagar el motor local al terminar
 *
 * Conserva state.json (hechos reemplazados, pares ya decididos).
 */
import { supabase } from "../src/supabase.js";
import { embedChain } from "../src/memoria/embedder.js";
import { allCollectors } from "../src/memoria/sources.js";
import { MemoryIndex, memoriaDir } from "../src/memoria/store.js";
import { syncIndex } from "../src/memoria/sync.js";

const args = new Set(process.argv.slice(2));
const full = !args.has("--incremental");

async function main() {
  const dir = memoriaDir();
  console.log(`[memoria] ${full ? "reconstrucción completa" : "sincronización incremental"} en ${dir}`);
  if (!supabase) console.warn("[memoria] sin Supabase: solo fuentes locales");
  const chain = embedChain();
  const idx = await MemoryIndex.load(dir);
  let lastLine = "";
  const res = await syncIndex(idx, allCollectors(supabase), chain, {
    full,
    onProgress: (p) => {
      const line =
        p.phase === "sources"
          ? `fuentes ${p.done}/${p.total} (${p.detail})`
          : p.phase === "embed"
            ? `vectores ${p.done}/${p.total}`
            : p.done ? "escrito" : "escribiendo…";
      if (line !== lastLine) console.log(`  ${line}`);
      lastLine = line;
    },
  });
  const bytes = await idx.diskBytes();
  console.log("");
  console.log(`modelo: ${res.model ?? "ninguno (solo léxico)"}${res.engineError ? ` — ${res.engineError}` : ""}`);
  console.log(`documentos: ${res.docs} · fragmentos: ${res.chunks} · vectores calculados: ${res.embedded} · reusados: ${res.reused} · sin vector: ${res.withoutVector} · quitados: ${res.removed}`);
  console.log(`tiempo: ${(res.ms / 1000).toFixed(1)} s · en disco: ${(bytes / 1e6).toFixed(1)} MB`);
  console.log("");
  console.log("fuente        docs  fragmentos  con vector");
  for (const [source, c] of Object.entries(idx.meta.bySource).sort()) {
    console.log(`${source.padEnd(12)} ${String(c.docs).padStart(5)}  ${String(c.chunks).padStart(10)}  ${String(c.vectors).padStart(10)}`);
  }
  for (const [s, e] of Object.entries(res.sourceErrors)) console.log(`  ✗ ${s}: ${e}`);
  if (!args.has("--keep-engine")) await chain.stop();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
