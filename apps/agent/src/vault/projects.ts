import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import matter from "gray-matter";
import type { ProjectStatus } from "@hermes/shared";
import { env } from "../env.js";
import { supabase } from "../supabase.js";

/**
 * Lee projects/<slug>/<Nota>.md del vault y extrae frontmatter +
 * secciones "Estado Actual" / "Tareas Pendientes". Cache de 60s.
 */
let cache: { at: number; data: ProjectStatus[] } | null = null;
const TTL = 60_000;

export function extractSection(md: string, heading: RegExp): string {
  // Tolerante a emojis en headers: "## 📊 Estado Actual", "## Estado Actual", etc.
  const lines = md.split("\n");
  const start = lines.findIndex((l) => heading.test(l));
  if (start === -1) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^#{1,3}\s/.test(l));
  return rest
    .slice(0, end === -1 ? undefined : end)
    .join("\n")
    .trim();
}

export function extractTasks(section: string): string[] {
  return section
    .split("\n")
    .filter((l) => /^\s*[-*]\s*\[[ x]\]/i.test(l) || /^\s*[-*]\s+\S/.test(l))
    .map((l) => l.replace(/^\s*[-*]\s*(\[[ x]\]\s*)?/i, "").trim())
    .filter(Boolean)
    .slice(0, 12);
}

export async function readProjects(force = false): Promise<ProjectStatus[]> {
  if (!force && cache && Date.now() - cache.at < TTL) return cache.data;
  if (!env.VAULT_PATH) return [];

  const projectsDir = join(env.VAULT_PATH, "projects");
  const results: ProjectStatus[] = [];
  let dirs: string[] = [];
  try {
    dirs = (await readdir(projectsDir, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }

  for (const slug of dirs) {
    try {
      const files = await readdir(join(projectsDir, slug));
      const note = files.find((f) => f.endsWith(".md"));
      if (!note) continue;
      const raw = await readFile(join(projectsDir, slug, note), "utf8");
      const { data, content } = matter(raw);
      const estadoActual = extractSection(content, /^#{1,3}\s*.*Estado Actual/i);
      const tareasRaw = extractSection(content, /^#{1,3}\s*.*Tareas Pendientes/i);
      results.push({
        slug,
        name: note.replace(/\.md$/, ""),
        estado: String(data.estado ?? "desconocido"),
        rama: data.rama ? String(data.rama) : undefined,
        ruta_local: data.ruta_local ? String(data.ruta_local) : undefined,
        actualizado: data.actualizado ? String(data.actualizado) : undefined,
        estado_actual: estadoActual.slice(0, 2000),
        tareas_pendientes: extractTasks(tareasRaw),
      });
    } catch (err) {
      console.error(`[hermes] error leyendo proyecto ${slug}`, err);
    }
  }

  cache = { at: Date.now(), data: results };
  void syncToSupabase(results);
  return results;
}

/**
 * Ruta + contenido crudo de la nota principal de un proyecto (el primer .md de
 * su carpeta). Reusa readProjects para resolver el slug/name reales (la carpeta
 * puede tener mayúsculas). Lo usan las reuniones para leer el briefing y anexar
 * accionables a "Tareas Pendientes".
 */
export async function getProjectNote(
  slug: string,
): Promise<{ path: string; raw: string; name: string; slug: string } | null> {
  if (!env.VAULT_PATH) return null;
  const p = (await readProjects()).find((x) => x.slug.toLowerCase() === slug.toLowerCase());
  if (!p) return null;
  const path = join(env.VAULT_PATH, "projects", p.slug, `${p.name}.md`);
  try {
    return { path, raw: await readFile(path, "utf8"), name: p.name, slug: p.slug };
  } catch {
    return null;
  }
}

/**
 * Lee la sección "## Briefing Reuniones" de la nota del proyecto (vacío si no
 * existe). Guía cómo Hermes resume la junta y arma los accionables.
 */
export async function getProjectBriefing(slug: string): Promise<string> {
  const note = await getProjectNote(slug);
  if (!note) return "";
  const { content } = matter(note.raw);
  return extractSection(content, /^#{1,3}\s*.*Briefing Reuniones/i);
}

async function syncToSupabase(projects: ProjectStatus[]) {
  if (!supabase) return;
  const rows = projects.map((p) => ({
    slug: p.slug,
    name: p.name,
    estado: p.estado,
    rama: p.rama ?? null,
    ruta_local: p.ruta_local ?? null,
    estado_actual: p.estado_actual,
    tareas_pendientes: p.tareas_pendientes,
    synced_at: new Date().toISOString(),
  }));
  const { error } = await supabase.from("projects_cache").upsert(rows);
  if (error) console.error("[hermes] projects_cache upsert", error.message);
}
