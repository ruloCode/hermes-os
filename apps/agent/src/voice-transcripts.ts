/**
 * Persistencia de las conversaciones de VOZ (ElevenLabs Agents).
 * El diálogo de voz vive en ElevenLabs y hasta ahora se perdía: Hermes solo
 * guardaba los efectos secundarios (save_memory, log_transaction…). Este job
 * trae los transcripts terminados a conversation_messages (channel 'voice',
 * project_slug 'voz') con embeddings, para que entren a match_knowledge.
 *
 * Best-effort e idempotente: local_key = sha1(voice|conversation_id|turno);
 * una conversación terminada es inmutable, así que si ya tiene filas se salta.
 */
import { createHash } from "node:crypto";
import { env } from "./env.js";
import { supabase } from "./supabase.js";
import { embedBatch } from "./embeddings.js";

const API = "https://api.elevenlabs.io/v1/convai";
const PAGE_SIZE = 20; // conversaciones recientes a revisar por ciclo
const MIN_EMBED_CHARS = 20;

interface ConvSummary {
  conversation_id: string;
  status?: string;
  start_time_unix_secs?: number;
}

interface TranscriptTurn {
  role?: string;
  message?: string | null;
  time_in_call_secs?: number;
}

let running = false;

async function api<T>(path: string): Promise<T | null> {
  const res = await fetch(`${API}${path}`, {
    headers: { "xi-api-key": env.ELEVENLABS_API_KEY },
  });
  if (!res.ok) {
    console.error(`[voz] ElevenLabs ${path}: ${res.status} ${await res.text().then((t) => t.slice(0, 200))}`);
    return null;
  }
  return (await res.json()) as T;
}

export interface VoiceSyncResult {
  checked: number;
  mirrored: number;
  turns: number;
}

export async function syncVoiceTranscripts(): Promise<VoiceSyncResult | null> {
  if (!supabase || !env.ELEVENLABS_API_KEY || !env.ELEVENLABS_AGENT_ID) return null;
  if (running) return null;
  running = true;
  const db = supabase;
  try {
    const list = await api<{ conversations?: ConvSummary[] }>(
      `/conversations?agent_id=${env.ELEVENLABS_AGENT_ID}&page_size=${PAGE_SIZE}`,
    );
    const conversations = list?.conversations ?? [];
    let mirrored = 0;
    let turns = 0;

    for (const conv of conversations) {
      if (!conv.conversation_id) continue;
      // Solo conversaciones cerradas: un transcript "done" ya no cambia.
      if (conv.status && !["done", "failed"].includes(conv.status)) continue;

      const { count } = await db
        .from("conversation_messages")
        .select("id", { count: "exact", head: true })
        .eq("chat_id", conv.conversation_id);
      if ((count ?? 0) > 0) continue; // ya espejada

      const detail = await api<{
        transcript?: TranscriptTurn[];
        metadata?: { start_time_unix_secs?: number };
      }>(`/conversations/${conv.conversation_id}`);
      const turnsRaw = (detail?.transcript ?? []).filter((t) => (t.message ?? "").trim());
      if (!turnsRaw.length) continue;

      const startSecs =
        detail?.metadata?.start_time_unix_secs ??
        conv.start_time_unix_secs ??
        Math.floor(Date.now() / 1000);
      const vectors = await embedBatch(turnsRaw.map((t) => t.message!.trim()));
      const rows = turnsRaw.map((t, i) => {
        const content = t.message!.trim();
        return {
          local_key: createHash("sha1")
            .update(`voice|${conv.conversation_id}|${i}`)
            .digest("hex"),
          project_slug: "voz",
          role: t.role === "user" ? "user" : "assistant",
          content,
          ts: new Date((startSecs + (t.time_in_call_secs ?? i)) * 1000).toISOString(),
          session_id: conv.conversation_id,
          machine: env.MACHINE_NAME,
          chat_id: conv.conversation_id,
          channel: "voice",
          embedding: content.length >= MIN_EMBED_CHARS ? vectors[i] : null,
        };
      });
      const { error } = await db
        .from("conversation_messages")
        .upsert(rows, { onConflict: "local_key", ignoreDuplicates: true });
      if (error) {
        console.error("[voz] espejo transcript:", error.message);
        continue;
      }
      mirrored += 1;
      turns += rows.length;
    }

    if (mirrored) {
      console.log(`[voz] transcripts persistidos: ${mirrored} conversaciones (${turns} turnos)`);
    }
    return { checked: conversations.length, mirrored, turns };
  } catch (err) {
    console.error("[voz] sync transcripts:", err);
    return null;
  } finally {
    running = false;
  }
}
