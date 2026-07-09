/**
 * Sube a Supabase el historial de conversaciones de la consola que hoy vive
 * solo en local (<repo>/.data/conversations):
 *   - <proyecto>.json                       → conversación activa (chat_id null)
 *   - archive/<proyecto>/<id>.json          → chats archivados (chat_id = id)
 *
 * Idempotente: usa el mismo local_key (sha1 del contenido) que el espejo en
 * vivo, con upsert onConflict → no duplica aunque se corra varias veces ni
 * aunque el mensaje ya lo haya subido el agente.
 *
 * Uso: pnpm backfill:conversations
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { REPO_ROOT, env } from "../src/env.js";
import { supabase } from "../src/supabase.js";
import { conversationLocalKey, safeName, type StoredMessage } from "../src/conversations.js";

if (!supabase) {
  console.error("Supabase no configurado (falta NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).");
  process.exit(1);
}
const db = supabase;

const DIR = join(REPO_ROOT, ".data", "conversations");

interface Row {
  local_key: string;
  project_slug: string;
  role: "user" | "assistant";
  content: string;
  ts: string;
  session_id: string | null;
  machine: string;
  chat_id: string | null;
}

function toRows(project: string, msgs: StoredMessage[], chatId: string | null): Row[] {
  return msgs
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({
      local_key: conversationLocalKey(project, m),
      project_slug: safeName(project),
      role: m.role,
      content: m.content,
      ts: m.ts || new Date(0).toISOString(),
      session_id: m.sessionId ?? null,
      machine: env.MACHINE_NAME,
      chat_id: chatId,
    }));
}

async function readMessages(path: string): Promise<StoredMessage[]> {
  try {
    const arr = JSON.parse(await readFile(path, "utf8"));
    return Array.isArray(arr) ? (arr as StoredMessage[]) : [];
  } catch {
    return [];
  }
}

/** Upsert por lotes con onConflict local_key; devuelve nº de filas enviadas. */
async function upsertRows(rows: Row[]): Promise<number> {
  let sent = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const { error } = await db
      .from("conversation_messages")
      .upsert(batch, { onConflict: "local_key", ignoreDuplicates: true });
    if (error) {
      console.error(`  ✗ lote ${i}: ${error.message}`);
    } else {
      sent += batch.length;
    }
  }
  return sent;
}

let totalRows = 0;

// ── 1. Conversaciones activas: .data/conversations/*.json ──────────────
let activeFiles: string[] = [];
try {
  activeFiles = (await readdir(DIR)).filter((f) => f.endsWith(".json"));
} catch {
  console.warn(`No hay ${DIR} — nada que subir.`);
}
for (const file of activeFiles) {
  const project = file.replace(/\.json$/, "");
  const msgs = await readMessages(join(DIR, file));
  if (!msgs.length) continue;
  const rows = toRows(project, msgs, null);
  const sent = await upsertRows(rows);
  totalRows += sent;
  console.log(`  activo  [${project}] ${sent} mensajes`);
}

// ── 2. Chats archivados: .data/conversations/archive/<proyecto>/<id>.json
const archiveDir = join(DIR, "archive");
let projects: string[] = [];
try {
  projects = (await readdir(archiveDir, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
} catch {
  /* sin archive todavía */
}
for (const project of projects) {
  const pDir = join(archiveDir, project);
  let chatFiles: string[] = [];
  try {
    chatFiles = (await readdir(pDir)).filter((f) => f.endsWith(".json"));
  } catch {
    continue;
  }
  for (const file of chatFiles) {
    const chatId = file.replace(/\.json$/, "");
    const msgs = await readMessages(join(pDir, file));
    if (!msgs.length) continue;
    const rows = toRows(project, msgs, chatId);
    const sent = await upsertRows(rows);
    totalRows += sent;
    console.log(`  archivo [${project}/${chatId}] ${sent} mensajes`);
  }
}

const { count } = await db
  .from("conversation_messages")
  .select("id", { count: "exact", head: true });

console.log(`\n✅ Backfill de conversaciones terminado: ${totalRows} filas enviadas (upsert). Total en tabla: ${count ?? "?"}.`);
