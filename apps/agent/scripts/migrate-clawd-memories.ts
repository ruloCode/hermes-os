/**
 * Migra las memorias del workspace clawd (~/dev/side/clawd) a Supabase:
 *  - MEMORY.md   → memorias curadas (secciones ## como unidades, type según heurística)
 *  - memory/*.md → archivos datados YYYY-MM-DD-*.md como type 'daily'
 *
 * Idempotente: usa el tag 'clawd:<archivo>[:sección]' para no duplicar.
 * Uso: pnpm migrate:clawd
 */
import { config } from "dotenv";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const root = resolve(fileURLToPath(import.meta.url), "../../../..");
config({ path: resolve(root, ".env") });

const CLAWD = process.env.CLAWD_PATH || "";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const OPENAI_KEY = process.env.OPENAI_API_KEY || "";

if (!CLAWD || !SUPABASE_URL || !SERVICE_KEY) {
  console.error("Faltan CLAWD_PATH / NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en .env");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

async function embed(text: string): Promise<number[] | null> {
  if (!OPENAI_KEY) return null;
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({ model: "text-embedding-3-small", input: text.slice(0, 8000) }),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { data: { embedding: number[] }[] };
  return json.data[0]?.embedding ?? null;
}

/** Heurística de tipo según nombre de archivo / título de sección. */
function inferType(name: string): string {
  const n = name.toLowerCase();
  if (/rulo|sobre|user|perfil|interview|personal/.test(n)) return "user";
  if (/setup|config|install|quota|auth|mcp|gateway|tools/.test(n)) return "reference";
  if (/vitau|teker|nevada|topra|zylen|ternium|careways|project/.test(n)) return "project";
  if (/error|lesson|learning|propuesta|mejora|feedback/.test(n)) return "feedback";
  return "daily";
}

function inferProject(name: string): string | null {
  const match = name
    .toLowerCase()
    .match(/(ternium|careways|teker|ikigai|zylen|vitau|nevada|topra)/);
  return match ? match[1] : null;
}

const existingTags = new Set<string>();
{
  // Cargamos los tags clawd:* ya migrados para ser idempotentes.
  const { data } = await supabase.from("memories").select("tags").eq("source", "migration");
  for (const row of data ?? []) {
    for (const t of (row.tags as string[]) ?? []) {
      if (t.startsWith("clawd:")) existingTags.add(t);
    }
  }
}

let inserted = 0;
let skipped = 0;

async function insertMemory(opts: {
  content: string;
  type: string;
  tag: string;
  project?: string | null;
  createdAt?: string;
}) {
  if (existingTags.has(opts.tag)) {
    skipped++;
    return;
  }
  const content = opts.content.trim();
  if (content.length < 30) return; // ruido
  const embedding = await embed(content);
  const { error } = await supabase.from("memories").insert({
    type: opts.type,
    content: content.slice(0, 8000),
    project_slug: opts.project ?? null,
    tags: [opts.tag, "clawd-import"],
    importance: opts.type === "user" ? 4 : 3,
    source: "migration",
    machine: "migration",
    created_at: opts.createdAt ?? new Date().toISOString(),
  });
  if (error) {
    console.error(`  ✗ ${opts.tag}: ${error.message}`);
  } else {
    inserted++;
    console.log(`  + [${opts.type}] ${opts.tag}`);
  }
}

// ── 1. MEMORY.md curado → secciones ────────────────────────────────────
try {
  const memoryMd = await readFile(join(CLAWD, "MEMORY.md"), "utf8");
  const sections = memoryMd.split(/^##\s+/m).slice(1);
  console.log(`MEMORY.md → ${sections.length} secciones`);
  for (const section of sections) {
    const [titleLine, ...rest] = section.split("\n");
    const title = titleLine.trim();
    await insertMemory({
      content: `# ${title}\n${rest.join("\n")}`,
      type: inferType(title),
      tag: `clawd:MEMORY.md:${title.slice(0, 60)}`,
      project: inferProject(title),
    });
  }
} catch {
  console.warn("MEMORY.md no encontrado, salto.");
}

// ── 2. memory/*.md datados ─────────────────────────────────────────────
try {
  const files = (await readdir(join(CLAWD, "memory"))).filter((f) => f.endsWith(".md"));
  console.log(`memory/ → ${files.length} archivos`);
  for (const file of files) {
    const content = await readFile(join(CLAWD, "memory", file), "utf8");
    const dateMatch = file.match(/^(\d{4}-\d{2}-\d{2})/);
    await insertMemory({
      content: `# ${file}\n${content}`,
      type: inferType(file),
      tag: `clawd:memory/${file}`,
      project: inferProject(file),
      createdAt: dateMatch ? `${dateMatch[1]}T12:00:00Z` : undefined,
    });
  }
} catch (err) {
  console.warn("memory/ no accesible:", err);
}

console.log(`\n✅ Migración terminada: ${inserted} insertadas, ${skipped} ya existían.`);
