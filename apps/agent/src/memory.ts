import type { Memory, MemoryType } from "@hermes/shared";
import { supabase, hasSupabase } from "./supabase.js";
import { embed } from "./embeddings.js";
import { env } from "./env.js";
import { indexMemory, similarMemory } from "./memoria/service.js";

export interface SaveMemoryInput {
  content: string;
  type: MemoryType;
  project?: string;
  tags?: string[];
  importance?: number;
  source?: string;
  summary?: string;
}

/** Umbral de coseno a partir del cual dos memorias se consideran la misma. */
const DEDUP_SIMILARITY = 0.9;

export async function saveMemory(input: SaveMemoryInput): Promise<string> {
  if (!supabase) return "Supabase no configurado: la memoria no se guardó.";
  // Vector de OpenAI para la columna de Supabase (1.536). En enfriamiento o sin
  // llave vuelve null sin llamar a nadie; la memoria igual queda buscable en el
  // índice local (memoria v2), que tiene su propio motor.
  const embedding = await embed(input.content);

  // Dedup semántico: si ya existe una memoria casi idéntica del mismo tipo,
  // se refresca (contenido + fecha + importancia máxima) en vez de duplicarla.
  // Así la base no se llena de variantes de "prefiere pnpm". Primero con el
  // índice local (funciona sin OpenAI); si no hay vectores locales, con el RPC.
  const local = await similarMemory(input.content, input.type, input.summary).catch(() => null);
  let top: (Memory & { similarity: number }) | null = null;
  if (local && local.similarity >= DEDUP_SIMILARITY) {
    const { data } = await supabase
      .from("memories")
      .select("id,type,content,summary,project_slug,tags,importance,source,machine,created_at")
      .eq("id", local.ref)
      .maybeSingle();
    if (data) top = { ...(data as Memory), similarity: local.similarity };
  } else if (!local && embedding) {
    const { data: similar } = await supabase.rpc("match_memories", {
      query_embedding: embedding,
      match_count: 5,
      filter_type: input.type,
    });
    top =
      ((similar ?? []) as (Memory & { similarity: number })[])
        .filter((m) => typeof m.similarity === "number")
        .sort((a, b) => b.similarity - a.similarity)[0] ?? null;
  }
  if (top && top.similarity >= DEDUP_SIMILARITY) {
    const row = {
      content: input.content,
      summary: input.summary ?? top.summary,
      // Sin vector nuevo no se pisa el que ya tenía (null lo borraría del RPC).
      ...(embedding ? { embedding } : {}),
      project_slug: input.project ?? top.project_slug,
      tags: [...new Set([...(top.tags ?? []), ...(input.tags ?? [])])],
      importance: Math.max(top.importance ?? 3, input.importance ?? 3),
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from("memories").update(row).eq("id", top.id);
    if (!error) {
      await indexMemory({ ...top, ...row, type: input.type, created_at: top.created_at }, local?.vector).catch(logIndexError);
      return `Memoria actualizada (${top.id}): ya existía una casi idéntica.`;
    }
  }

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
    .select("id,type,content,summary,project_slug,importance,created_at")
    .single();
  if (error) return `Error guardando memoria: ${error.message}`;
  // Al índice local YA: buscable al instante, sin esperar la sincronización.
  await indexMemory(data, local?.vector).catch(logIndexError);
  return `Memoria guardada (${data.id}).`;
}

function logIndexError(err: unknown): void {
  console.error("[memoria] no pude agregar la memoria al índice local:", (err as Error)?.message ?? err);
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
