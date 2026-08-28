/**
 * Backfill de la capa de conocimiento (migración 009): vectoriza retroactivamente
 * todo lo que ya existía sin embedding para que entre a match_knowledge.
 *
 *   1. memories sin embedding
 *   2. meetings sin summary_embedding
 *   3. task_executions sin embedding (prompt + análisis + resultado)
 *   4. conversation_messages sin embedding (mensajes con señal, ≥20 chars)
 *   5. vault → vault_docs (índice completo del vault, por hash)
 *   6. transcripts de voz recientes de ElevenLabs
 *
 * Idempotente: correrlo dos veces no re-embebe nada. Uso: pnpm backfill:knowledge
 */
import { env } from "../src/env.js";
import { supabase } from "../src/supabase.js";
import { embed, embedBatch } from "../src/embeddings.js";
import { syncVaultKnowledge } from "../src/vault/knowledge-sync.js";
import { syncVoiceTranscripts } from "../src/voice-transcripts.js";

if (!supabase) {
  console.error("Supabase no configurado (falta NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).");
  process.exit(1);
}
const db = supabase;

if (!env.OPENAI_API_KEY) {
  console.error("Falta OPENAI_API_KEY en .env — sin ella no se pueden generar embeddings.");
  process.exit(1);
}

const MIN_EMBED_CHARS = 20;

// ── 1) memories ─────────────────────────────────────────────────────────
console.log("— memories sin embedding…");
{
  let done = 0;
  for (;;) {
    const { data } = await db
      .from("memories")
      .select("id,content")
      .is("embedding", null)
      .limit(50);
    if (!data?.length) break;
    for (const row of data) {
      const vector = await embed(row.content ?? "");
      if (!vector) {
        console.error(`  ✗ memoria ${row.id}: embed falló, corto esta fase`);
        break;
      }
      await db
        .from("memories")
        .update({ embedding: vector, updated_at: new Date().toISOString() })
        .eq("id", row.id);
      done++;
    }
    if (data.length < 50) break;
  }
  console.log(`  ✓ ${done} memorias vectorizadas`);
}

// ── 2) meetings ─────────────────────────────────────────────────────────
console.log("— meetings sin summary_embedding…");
{
  const { data } = await db
    .from("meetings")
    .select("id,summary")
    .is("summary_embedding", null)
    .not("summary", "is", null)
    .limit(500);
  let done = 0;
  for (const row of data ?? []) {
    const vector = await embed(row.summary ?? "");
    if (!vector) break;
    await db.from("meetings").update({ summary_embedding: vector }).eq("id", row.id);
    done++;
  }
  console.log(`  ✓ ${done} reuniones vectorizadas`);
}

// ── 3) task_executions ──────────────────────────────────────────────────
console.log("— task_executions sin embedding…");
{
  let done = 0;
  let cursor = 0;
  for (;;) {
    const { data } = await db
      .from("task_executions")
      .select("id,prompt,analysis,result")
      .is("embedding", null)
      .gt("id", cursor)
      .order("id", { ascending: true })
      .limit(50);
    if (!data?.length) break;
    cursor = data[data.length - 1].id as number;
    const texts = data.map((r) =>
      [r.prompt, r.analysis, r.result].filter(Boolean).join("\n"),
    );
    const vectors = await embedBatch(texts);
    for (let i = 0; i < data.length; i++) {
      if (!vectors[i]) continue;
      await db.from("task_executions").update({ embedding: vectors[i] }).eq("id", data[i].id);
      done++;
    }
  }
  console.log(`  ✓ ${done} ejecuciones vectorizadas`);
}

// ── 4) conversation_messages ────────────────────────────────────────────
// Cursor por id (no "is null" a secas): los mensajes cortos quedan sin vector
// a propósito y no deben ciclar el loop.
console.log("— conversation_messages sin embedding…");
{
  let done = 0;
  let skipped = 0;
  let cursor = 0;
  for (;;) {
    const { data } = await db
      .from("conversation_messages")
      .select("id,content")
      .is("embedding", null)
      .gt("id", cursor)
      .order("id", { ascending: true })
      .limit(100);
    if (!data?.length) break;
    cursor = data[data.length - 1].id as number;
    const eligible = data.filter((r) => (r.content ?? "").trim().length >= MIN_EMBED_CHARS);
    skipped += data.length - eligible.length;
    if (!eligible.length) continue;
    const vectors = await embedBatch(eligible.map((r) => r.content as string));
    for (let i = 0; i < eligible.length; i++) {
      if (!vectors[i]) continue;
      await db
        .from("conversation_messages")
        .update({ embedding: vectors[i] })
        .eq("id", eligible[i].id);
      done++;
    }
    if (done % 200 < 100 && done > 0) console.log(`  … ${done} mensajes vectorizados`);
  }
  console.log(`  ✓ ${done} mensajes vectorizados (${skipped} cortos sin señal, se saltan)`);
}

// ── 5) vault ────────────────────────────────────────────────────────────
console.log("— índice semántico del vault…");
{
  const res = await syncVaultKnowledge();
  if (res) console.log(`  ✓ ${res.indexed} notas vectorizadas de ${res.scanned} escaneadas (${res.removed} eliminadas)`);
  else console.log("  (sin vault o sin Supabase)");
}

// ── 6) voz ──────────────────────────────────────────────────────────────
console.log("— transcripts de voz de ElevenLabs…");
{
  const res = await syncVoiceTranscripts();
  if (res) console.log(`  ✓ ${res.mirrored} conversaciones nuevas (${res.turns} turnos) de ${res.checked} revisadas`);
  else console.log("  (sin credenciales de ElevenLabs o sin Supabase)");
}

console.log("\n✅ Backfill de conocimiento terminado.");
