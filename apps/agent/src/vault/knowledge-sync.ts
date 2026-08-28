/**
 * Índice vectorial del vault de Obsidian → tabla vault_docs (migración 009).
 * La VERDAD sigue siendo el .md en disco; esto lo vuelve buscable por
 * match_knowledge junto con memorias, reuniones, ejecuciones y chats.
 *
 * Sync incremental por hash: solo se re-embebe lo que cambió, así el ciclo
 * periódico cuesta cero llamadas a OpenAI cuando el vault está quieto.
 * Best-effort: cualquier error se loguea y no tumba el server.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";
import matter from "gray-matter";
import { env } from "../env.js";
import { supabase } from "../supabase.js";
import { embedBatch } from "../embeddings.js";

/** Carpetas del vault que entran al índice (conocimiento, no config). */
const INDEXED_FOLDERS = ["projects", "00 Inbox", "10 Notas"];
const SKIP_DIRS = new Set([".obsidian", ".trash", ".git", "node_modules"]);
const MAX_FILE_BYTES = 512 * 1024; // un .md más grande que esto no es una nota
const MAX_CONTENT_CHARS = 16_000; // lo que guardamos para retrieval (embed trunca a 8000)

interface VaultDocRow {
  path: string;
  project_slug: string | null;
  title: string;
  content: string;
  content_hash: string;
}

let running = false;

async function walkMarkdown(dir: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // la carpeta no existe en este vault
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) await walkMarkdown(join(dir, e.name), out);
    } else if (e.name.endsWith(".md")) {
      out.push(join(dir, e.name));
    }
  }
}

function docFromFile(relPath: string, raw: string): VaultDocRow {
  const { data, content } = matter(raw);
  const basename = relPath.split("/").pop()!.replace(/\.md$/, "");
  const title = String(data.title ?? data.proyecto ?? basename);
  // projects/<slug>/... → slug (para filtrar por proyecto en match_knowledge)
  const m = relPath.match(/^projects\/([^/]+)\//);
  return {
    path: relPath,
    project_slug: m ? m[1] : null,
    title,
    content: content.trim().slice(0, MAX_CONTENT_CHARS),
    content_hash: createHash("sha1").update(raw).digest("hex"),
  };
}

/** Hashes ya indexados, paginando (supabase-js corta en ~1000 filas). */
async function existingHashes(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!supabase) return map;
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("vault_docs")
      .select("path,content_hash")
      .range(from, from + PAGE - 1);
    if (error || !data?.length) break;
    for (const r of data) map.set(r.path as string, r.content_hash as string);
    if (data.length < PAGE) break;
  }
  return map;
}

export interface VaultSyncResult {
  scanned: number;
  indexed: number;
  removed: number;
}

export async function syncVaultKnowledge(): Promise<VaultSyncResult | null> {
  if (!supabase || !env.VAULT_PATH) return null;
  if (running) return null; // un sync a la vez
  running = true;
  try {
    const files: string[] = [];
    for (const folder of INDEXED_FOLDERS) {
      await walkMarkdown(join(env.VAULT_PATH, folder), files);
    }

    const known = await existingHashes();
    const seen = new Set<string>();
    const changed: VaultDocRow[] = [];

    for (const abs of files) {
      const relPath = relative(env.VAULT_PATH, abs);
      seen.add(relPath);
      try {
        const info = await stat(abs);
        if (info.size > MAX_FILE_BYTES) continue;
        const raw = await readFile(abs, "utf8");
        const doc = docFromFile(relPath, raw);
        if (!doc.content) continue; // nota vacía: nada que indexar
        if (known.get(relPath) !== doc.content_hash) changed.push(doc);
      } catch {
        /* archivo ilegible: lo salteamos */
      }
    }

    // Vectoriza y sube solo lo que cambió (upsert por path).
    let indexed = 0;
    if (changed.length) {
      const vectors = await embedBatch(changed.map((d) => `${d.title}\n${d.content}`));
      const rows = changed.map((d, i) => ({
        ...d,
        embedding: vectors[i],
        machine: env.MACHINE_NAME,
        updated_at: new Date().toISOString(),
      }));
      const { error } = await supabase
        .from("vault_docs")
        .upsert(rows, { onConflict: "path" });
      if (error) console.error("[vault] sync vault_docs:", error.message);
      else indexed = rows.length;
    }

    // Notas borradas del vault → fuera del índice.
    const stale = [...known.keys()].filter((p) => !seen.has(p));
    if (stale.length) {
      const { error } = await supabase.from("vault_docs").delete().in("path", stale);
      if (error) console.error("[vault] limpieza vault_docs:", error.message);
    }

    if (indexed || stale.length) {
      console.log(
        `[vault] índice semántico: ${indexed} notas vectorizadas, ${stale.length} eliminadas (${files.length} escaneadas)`,
      );
    }
    return { scanned: files.length, indexed, removed: stale.length };
  } catch (err) {
    console.error("[vault] sync índice semántico:", err);
    return null;
  } finally {
    running = false;
  }
}
