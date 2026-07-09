/**
 * Vectoriza las memorias que quedaron sin embedding (p. ej. guardadas cuando no
 * había OPENAI_API_KEY). Busca embedding IS NULL, genera el vector con el mismo
 * embed() del server y actualiza la fila. Idempotente: al terminar no debería
 * quedar ninguna pendiente. Red de seguridad tras migrar / si falló la key.
 *
 * Uso: pnpm backfill:embeddings
 */
import { env } from "../src/env.js";
import { supabase } from "../src/supabase.js";
import { embed } from "../src/embeddings.js";

if (!supabase) {
  console.error("Supabase no configurado (falta NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).");
  process.exit(1);
}
const db = supabase;

if (!env.OPENAI_API_KEY) {
  console.error("Falta OPENAI_API_KEY en .env — sin ella no se pueden generar embeddings.");
  process.exit(1);
}

const { count: pending } = await db
  .from("memories")
  .select("id", { count: "exact", head: true })
  .is("embedding", null);

console.log(`Memorias sin embedding: ${pending ?? 0}`);
if (!pending) {
  console.log("✅ Nada que vectorizar.");
  process.exit(0);
}

let done = 0;
let failed = 0;

// Paginamos: cada update saca una fila del conjunto "embedding is null",
// así que siempre pedimos el primer lote pendiente hasta agotarlo.
for (;;) {
  const { data, error } = await db
    .from("memories")
    .select("id,content")
    .is("embedding", null)
    .limit(50);
  if (error) {
    console.error("Error leyendo pendientes:", error.message);
    break;
  }
  if (!data || data.length === 0) break;

  for (const row of data) {
    const vector = await embed(row.content ?? "");
    if (!vector) {
      failed++;
      console.error(`  ✗ ${row.id}: embed devolvió null`);
      // Evita loop infinito si la API sigue fallando: marca y corta.
      if (failed >= 5) {
        console.error("Demasiados fallos seguidos de embeddings, abortando.");
        console.log(`\nParcial: ${done} vectorizadas, ${failed} fallidas.`);
        process.exit(1);
      }
      continue;
    }
    const { error: upErr } = await db
      .from("memories")
      .update({ embedding: vector, updated_at: new Date().toISOString() })
      .eq("id", row.id);
    if (upErr) {
      failed++;
      console.error(`  ✗ ${row.id}: ${upErr.message}`);
    } else {
      done++;
      failed = 0; // reset del contador de fallos consecutivos
      if (done % 25 === 0) console.log(`  … ${done} vectorizadas`);
    }
  }
}

console.log(`\n✅ Backfill de embeddings terminado: ${done} vectorizadas.`);
