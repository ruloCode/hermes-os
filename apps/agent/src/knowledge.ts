/**
 * Base de conocimiento unificada: una sola búsqueda semántica sobre TODO lo
 * que Hermes sabe — memorias, reuniones, ejecuciones de tareas, conversaciones
 * (texto y voz) y notas del vault. Delega el ranking al RPC match_knowledge
 * (migración 009); si el RPC o los embeddings no están, degrada a la búsqueda
 * de memorias clásica (ILIKE + recencia) para no romper nada.
 */
import type { KnowledgeHit, KnowledgeSource, KnowledgeStats } from "@hermes/shared";
import { supabase } from "./supabase.js";
import { embed } from "./embeddings.js";
import { searchMemory } from "./memory.js";

export interface SearchKnowledgeOptions {
  sources?: KnowledgeSource[];
  project?: string;
  limit?: number;
}

export async function searchKnowledge(
  query: string,
  opts: SearchKnowledgeOptions = {},
): Promise<KnowledgeHit[]> {
  if (!supabase) return [];
  const limit = opts.limit ?? 12;
  const embedding = await embed(query);
  if (embedding) {
    // Se piden de más y se depura acá: sin esto, los turnos de chat recientes
    // (boost de recencia) acaparan el top y aparecen repetidos casi idénticos.
    const { data, error } = await supabase.rpc("match_knowledge", {
      query_embedding: embedding,
      match_count: Math.min(limit * 3, 40),
      filter_sources: opts.sources ?? null,
      filter_project: opts.project ?? null,
    });
    if (!error && data) {
      const hits = diversify(data as KnowledgeHit[], limit);
      touchMemories(hits);
      return hits;
    }
    if (error) console.error("[knowledge] match_knowledge:", error.message);
  }
  // Fallback (sin RPC o sin embeddings): al menos las memorias por ILIKE.
  const mems = await searchMemory(query, undefined, limit);
  return mems.map((m) => ({
    source: "memory" as const,
    ref: m.id,
    title: m.summary ?? m.content.slice(0, 120),
    content: m.content,
    project_slug: m.project_slug,
    created_at: m.created_at,
    similarity: null,
    score: null,
  }));
}

/**
 * Diversidad + dedup sobre los hits (ya vienen ordenados por score):
 * - ninguna fuente ocupa más de la mitad del resultado (los chats frescos
 *   tienden a barrer por recencia y taparían memorias/vault/reuniones);
 * - contenidos casi idénticos cuentan una sola vez, AUNQUE vengan de fuentes
 *   distintas (los resúmenes de reunión también se espejan como memoria).
 */
function diversify(hits: KnowledgeHit[], limit: number): KnowledgeHit[] {
  const cap = Math.max(2, Math.ceil(limit / 2));
  const seen = new Set<string>();
  const perSource = new Map<KnowledgeSource, number>();
  const out: KnowledgeHit[] = [];
  for (const h of hits) {
    const key = h.content.replace(/\s+/g, " ").trim().toLowerCase().slice(0, 160);
    if (seen.has(key)) continue;
    if ((perSource.get(h.source) ?? 0) >= cap) continue;
    seen.add(key);
    perSource.set(h.source, (perSource.get(h.source) ?? 0) + 1);
    out.push(h);
    if (out.length >= limit) break;
  }
  return out;
}

/** Refuerzo por uso: marca las memorias recuperadas (use_count/last_used_at).
 *  Fire-and-forget: la telemetría nunca frena una búsqueda. */
function touchMemories(hits: KnowledgeHit[]): void {
  if (!supabase) return;
  const ids = hits.filter((h) => h.source === "memory").map((h) => h.ref);
  if (!ids.length) return;
  void supabase.rpc("touch_memories", { ids }).then(({ error }) => {
    if (error) console.error("[knowledge] touch_memories:", error.message);
  });
}

const SOURCE_LABEL: Record<KnowledgeSource, string> = {
  memory: "memoria",
  meeting: "reunión",
  execution: "ejecución",
  conversation: "chat",
  vault: "vault",
};

// ── Conteos de la base de conocimiento (panel MEMORIA ACTIVA) ───────────

const EMPTY_STATS: KnowledgeStats = {
  available: false,
  total: 0,
  memories: 0,
  vaultDocs: 0,
  meetings: 0,
  executions: 0,
  conversationText: 0,
  conversationVoice: 0,
};

let statsCache: { at: number; stats: KnowledgeStats } | null = null;
const STATS_TTL_MS = 60_000;

/** Conteos reales por fuente (6 head-counts en paralelo, cache 60s). */
export async function knowledgeStats(): Promise<KnowledgeStats> {
  if (!supabase) return EMPTY_STATS;
  if (statsCache && Date.now() - statsCache.at < STATS_TTL_MS) return statsCache.stats;
  const db = supabase;
  const count = async (table: string, filter?: { col: string; val: string }) => {
    let q = db.from(table).select("*", { count: "exact", head: true });
    if (filter) q = q.eq(filter.col, filter.val);
    const { count: n, error } = await q;
    if (error) {
      console.error(`[knowledge] count ${table}:`, error.message);
      return 0;
    }
    return n ?? 0;
  };
  const [memories, vaultDocs, meetings, executions, conversationText, conversationVoice] =
    await Promise.all([
      count("memories"),
      count("vault_docs"),
      count("meetings"),
      count("task_executions"),
      count("conversation_messages", { col: "channel", val: "text" }),
      count("conversation_messages", { col: "channel", val: "voice" }),
    ]);
  const stats: KnowledgeStats = {
    available: true,
    total: memories + vaultDocs + meetings + executions + conversationText + conversationVoice,
    memories,
    vaultDocs,
    meetings,
    executions,
    conversationText,
    conversationVoice,
  };
  statsCache = { at: Date.now(), stats };
  return stats;
}

/** Formatea hits para consumo del LLM (tool / system prompt / voz). */
export function knowledgeToText(hits: KnowledgeHit[], maxPerHit = 400): string {
  return hits
    .map((h) => {
      const scope = h.project_slug ? `·${h.project_slug}` : "";
      const date = h.created_at?.slice(0, 10) ?? "";
      const body = h.content.replace(/\s+/g, " ").trim().slice(0, maxPerHit);
      return `[${SOURCE_LABEL[h.source] ?? h.source}${scope} ${date}] ${h.title}\n${body}`;
    })
    .join("\n---\n");
}
