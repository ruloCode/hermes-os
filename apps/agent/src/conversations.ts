/**
 * Historial de conversaciones de la consola, persistido LOCALMENTE por proyecto
 * (JSON en <repo>/.data/conversations/<proyecto>.json). Funciona sin Supabase;
 * cuando se configure, se puede sincronizar además a la nube.
 *
 * Clave: el slug del proyecto en foco, o "general" cuando no hay foco.
 */
import { readdir, readFile, writeFile, mkdir, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { ChatSummary } from "@hermes/shared";
import { REPO_ROOT, env } from "./env.js";
import { supabase } from "./supabase.js";
import { embedBatch } from "./embeddings.js";

export interface StoredMessage {
  role: "user" | "assistant";
  content: string;
  ts: string;
  sessionId?: string;
}

/**
 * Clave determinística de un mensaje para idempotencia del espejo/backfill en
 * Supabase. Basada en contenido (no en archivo/índice) para que sea estable
 * aunque el mensaje pase de la conversación activa al archive.
 */
export function conversationLocalKey(project: string, msg: StoredMessage): string {
  const basis = `${safeName(project)}|${msg.role}|${msg.ts}|${msg.content}`;
  return createHash("sha1").update(basis).digest("hex");
}

/** Mensajes más cortos no aportan señal semántica ("ok", "dale"): sin vector. */
const MIN_EMBED_CHARS = 20;

/**
 * Espejo best-effort de mensajes a Supabase (conversation_messages). Fire and
 * forget: nunca rompe el chat si falla la red. Idempotente vía local_key.
 * chatId = null → conversación activa; slug del archivo si viene del archive.
 * Cada mensaje se vectoriza (embedding) para que el chat entre a match_knowledge.
 */
export function mirrorMessages(
  project: string,
  msgs: StoredMessage[],
  chatId: string | null = null,
): void {
  if (!supabase || msgs.length === 0) return;
  const db = supabase;
  void (async () => {
    const vectors = await embedBatch(msgs.map((m) => m.content));
    const rows = msgs.map((m, i) => ({
      local_key: conversationLocalKey(project, m),
      project_slug: safeName(project),
      role: m.role,
      content: m.content,
      ts: m.ts,
      session_id: m.sessionId ?? null,
      machine: env.MACHINE_NAME,
      chat_id: chatId,
      channel: "text",
      embedding: m.content.trim().length >= MIN_EMBED_CHARS ? vectors[i] : null,
    }));
    const { error } = await db
      .from("conversation_messages")
      .upsert(rows, { onConflict: "local_key", ignoreDuplicates: true });
    if (error) console.error("[conversations] espejo Supabase:", error.message);
  })().catch((err) => console.error("[conversations] espejo Supabase:", err));
}

const DIR = join(REPO_ROOT, ".data", "conversations");
const MAX_STORED = 500;

export function safeName(project: string): string {
  return (project || "general").toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 60) || "general";
}

function fileFor(project: string): string {
  return join(DIR, `${safeName(project)}.json`);
}

// Chats archivados (historial): .data/conversations/archive/<proyecto>/<id>.json
function archiveDirFor(project: string): string {
  return join(DIR, "archive", safeName(project));
}

export async function getConversation(project: string): Promise<StoredMessage[]> {
  try {
    const raw = await readFile(fileFor(project), "utf8");
    const arr = JSON.parse(raw) as StoredMessage[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return []; // sin historial todavía
  }
}

// Serializa TODAS las escrituras para evitar carreras de lectura-modificación.
let writeChain: Promise<unknown> = Promise.resolve();

async function doAppend(project: string, user: string, assistant: string, sessionId?: string) {
  await mkdir(DIR, { recursive: true });
  const file = fileFor(project);
  const existing = await getConversation(project);
  const now = new Date().toISOString();
  const userMsg: StoredMessage = { role: "user", content: user, ts: now, sessionId };
  const assistantMsg: StoredMessage = { role: "assistant", content: assistant, ts: now, sessionId };
  existing.push(userMsg, assistantMsg);
  const trimmed = existing.slice(-MAX_STORED);
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(trimmed), "utf8");
  await rename(tmp, file); // atómico
  // Espejo a la nube (best-effort): sobrevive a la máquina y lo ven otras Macs.
  mirrorMessages(project, [userMsg, assistantMsg]);
}

export function appendTurn(
  project: string,
  user: string,
  assistant: string,
  sessionId?: string,
): Promise<void> {
  // best-effort: nunca romper el chat si falla el disco.
  writeChain = writeChain
    .then(() => doAppend(project, user, assistant, sessionId))
    .catch((err) => console.error("[conversations] no se pudo guardar:", err));
  return writeChain as Promise<void>;
}

export async function clearConversation(project: string): Promise<void> {
  await new Promise<void>((resolve) => {
    writeChain = writeChain.then(async () => {
      try {
        await unlink(fileFor(project));
      } catch {
        /* no existía */
      }
      resolve();
    });
  });
}

// ── Historial de chats (archivo por chat) ──────────────────────────────

// Mueve la conversación activa al archivo (si tiene mensajes) y la vacía.
// Debe correr DENTRO del writeChain: comparte archivos con appendTurn.
async function doArchive(project: string): Promise<void> {
  const msgs = await getConversation(project);
  if (msgs.length === 0) return;
  const dir = archiveDirFor(project);
  await mkdir(dir, { recursive: true });
  const id = new Date().toISOString().replace(/[:.]/g, "-");
  await writeFile(join(dir, `${id}.json`), JSON.stringify(msgs), "utf8");
  await unlink(fileFor(project)).catch(() => {});
}

/** "Nuevo chat": archiva la conversación activa y deja la consola limpia. */
export function archiveConversation(project: string): Promise<void> {
  writeChain = writeChain
    .then(() => doArchive(project))
    .catch((err) => console.error("[conversations] no se pudo archivar:", err));
  return writeChain as Promise<void>;
}

/** Lista los chats archivados de un proyecto, del más reciente al más viejo. */
export async function listChats(project: string): Promise<ChatSummary[]> {
  let files: string[] = [];
  try {
    files = (await readdir(archiveDirFor(project))).filter((f) => f.endsWith(".json"));
  } catch {
    return []; // sin archivo todavía
  }
  const chats: ChatSummary[] = [];
  for (const f of files) {
    try {
      const msgs = JSON.parse(
        await readFile(join(archiveDirFor(project), f), "utf8"),
      ) as StoredMessage[];
      if (!Array.isArray(msgs) || msgs.length === 0) continue;
      const firstUser = msgs.find((m) => m.role === "user");
      chats.push({
        id: f.replace(/\.json$/, ""),
        title: (firstUser?.content ?? "(sin título)").slice(0, 80),
        ts: msgs[msgs.length - 1]?.ts ?? "",
        messages: msgs.length,
      });
    } catch {
      /* archivo corrupto: lo salteamos */
    }
  }
  return chats.sort((a, b) => (a.ts < b.ts ? 1 : -1)).slice(0, 40);
}

/**
 * Restaura un chat archivado como conversación activa (la activa actual se
 * archiva antes, así no se pierde). Devuelve sus mensajes, o null si no existe.
 */
export async function restoreChat(
  project: string,
  id: string,
): Promise<StoredMessage[] | null> {
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, "");
  const src = join(archiveDirFor(project), `${safeId}.json`);
  let msgs: StoredMessage[];
  try {
    msgs = JSON.parse(await readFile(src, "utf8")) as StoredMessage[];
  } catch {
    return null;
  }
  if (!Array.isArray(msgs) || msgs.length === 0) return null;
  await new Promise<void>((resolve) => {
    writeChain = writeChain.then(async () => {
      try {
        await doArchive(project);
        await mkdir(DIR, { recursive: true });
        const file = fileFor(project);
        const tmp = `${file}.tmp`;
        await writeFile(tmp, JSON.stringify(msgs), "utf8");
        await rename(tmp, file); // atómico
        await unlink(src); // dejó de ser archivo: ahora es el chat activo
      } catch (err) {
        console.error("[conversations] no se pudo restaurar:", err);
      }
      resolve();
    });
  });
  return msgs;
}
