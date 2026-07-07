import type { Memory, MemoryType } from "@hermes/shared";
import { supabase, hasSupabase } from "./supabase.js";
import { embed } from "./embeddings.js";
import { env } from "./env.js";

export interface SaveMemoryInput {
  content: string;
  type: MemoryType;
  project?: string;
  tags?: string[];
  importance?: number;
  source?: string;
  summary?: string;
}

export async function saveMemory(input: SaveMemoryInput): Promise<string> {
  if (!supabase) return "Supabase no configurado: la memoria no se guardó.";
  const embedding = await embed(input.content);
  const { data, error } = await supabase
    .from("memories")
    .insert({
      type: input.type,
      content: input.content,
      summary: input.summary ?? null,
      embedding,
      project_slug: input.project ?? null,
      tags: input.tags ?? [],
      importance: input.importance ?? 3,
      source: input.source ?? "agent",
      machine: env.MACHINE_NAME,
    })
    .select("id")
    .single();
  if (error) return `Error guardando memoria: ${error.message}`;
  return `Memoria guardada (${data.id}).`;
}

export async function searchMemory(
  query: string,
  type?: MemoryType,
  limit = 8,
): Promise<Memory[]> {
  if (!supabase) return [];
  const embedding = await embed(query);
  if (embedding) {
    const { data, error } = await supabase.rpc("match_memories", {
      query_embedding: embedding,
      match_count: limit,
      filter_type: type ?? null,
    });
    if (!error && data) return data as Memory[];
    if (error) console.error("[hermes] match_memories", error.message);
  }
  // Fallback sin embeddings: texto plano + recencia
  let q = supabase
    .from("memories")
    .select("id,type,content,summary,project_slug,tags,importance,source,machine,created_at")
    .ilike("content", `%${query}%`)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (type) q = q.eq("type", type);
  const { data } = await q;
  return (data ?? []) as Memory[];
}

export async function recentMemories(limit = 10): Promise<Memory[]> {
  if (!supabase) return [];
  const { data } = await supabase
    .from("memories")
    .select("id,type,content,summary,project_slug,tags,importance,source,machine,created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as Memory[];
}

export async function savePreference(key: string, value: unknown): Promise<string> {
  if (!supabase) return "Supabase no configurado: la preferencia no se guardó.";
  const { error } = await supabase.from("preferences").upsert({
    key,
    value,
    updated_at: new Date().toISOString(),
  });
  return error ? `Error: ${error.message}` : `Preferencia "${key}" guardada.`;
}

export async function listPreferences(): Promise<Record<string, unknown>> {
  if (!supabase) return {};
  const { data } = await supabase.from("preferences").select("key,value").limit(50);
  return Object.fromEntries((data ?? []).map((r) => [r.key, r.value]));
}

export async function memoriesCount(): Promise<number> {
  if (!supabase) return 0;
  const { count } = await supabase
    .from("memories")
    .select("id", { count: "exact", head: true });
  return count ?? 0;
}

export { hasSupabase };
