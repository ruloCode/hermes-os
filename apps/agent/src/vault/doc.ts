import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import matter from "gray-matter";
import type { VaultDoc } from "@hermes/shared";
import { env } from "../env.js";

/**
 * Resuelve una referencia a un .md del vault — un wikilink `[[estrategia-contenido]]`
 * (con alias `|` o heading `#` opcionales) o una ruta `docs/estrategia-contenido.md` —
 * y devuelve su contenido para el visor tipo Notion del dashboard.
 *
 * Seguro por construcción: solo se sirven archivos que aparecen en el índice del
 * vault (walk acotado bajo VAULT_PATH), así que un `ref` tipo `../../etc/passwd`
 * nunca hace match → no hay lectura de rutas arbitrarias.
 */
let idx: { at: number; files: string[] } | null = null;
const TTL = 60_000;
const SKIP = new Set([".obsidian", ".git", ".trash", "node_modules", ".DS_Store", ".temp"]);

async function walk(dir: string, acc: string[], depth = 0): Promise<void> {
  if (depth > 8) return;
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (SKIP.has(e.name) || e.name.startsWith(".")) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) await walk(full, acc, depth + 1);
    else if (e.name.endsWith(".md")) acc.push(full);
  }
}

async function index(): Promise<string[]> {
  if (idx && Date.now() - idx.at < TTL) return idx.files;
  const files: string[] = [];
  if (env.VAULT_PATH) await walk(env.VAULT_PATH, files);
  idx = { at: Date.now(), files };
  return files;
}

// Slug tolerante: minúsculas, sin acentos, no-alfanumérico → guiones.
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function resolveVaultDoc(ref: string, projectSlug?: string): Promise<VaultDoc> {
  if (!env.VAULT_PATH || !ref?.trim()) return { found: false, ref };

  // Limpia el envoltorio del wikilink y su alias/heading: "[[name|alias#h]]" → "name".
  const target = ref
    .trim()
    .replace(/^\[\[|\]\]$/g, "")
    .split("|")[0]
    .split("#")[0]
    .trim();
  const wantName = norm(target.replace(/\.md$/i, ""));
  if (!wantName) return { found: false, ref };

  const files = await index();
  const asPath = target.replace(/\\/g, "/").toLowerCase();
  const pathSuffix = asPath.endsWith(".md") ? asPath : `${asPath}.md`;

  // 1) Match por ruta que termina en el target (refs tipo docs/estrategia-contenido.md).
  const byPath = files.filter((f) => f.replace(/\\/g, "/").toLowerCase().endsWith(pathSuffix));
  // 2) Match por basename normalizado (wikilinks tipo estrategia-contenido).
  const byName = files.filter((f) => norm(basename(f, ".md")) === wantName);

  const candidates = [...byPath, ...byName];
  // Preferir el que viva dentro del proyecto en foco (desambigua nombres repetidos).
  let hit =
    (projectSlug && candidates.find((f) => norm(f).includes(norm(projectSlug)))) ||
    candidates[0];

  if (!hit) return { found: false, ref };

  try {
    const raw = await readFile(hit, "utf8");
    const { data, content } = matter(raw);
    return {
      found: true,
      ref,
      name: basename(hit, ".md"),
      title: String(data.proyecto ?? data.title ?? basename(hit, ".md")),
      path: relative(env.VAULT_PATH, hit),
      markdown: content.trim(),
      updated: data.actualizado ? String(data.actualizado) : undefined,
    };
  } catch {
    return { found: false, ref };
  }
}
