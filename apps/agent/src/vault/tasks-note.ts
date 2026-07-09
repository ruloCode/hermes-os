/**
 * Espejo humano de las tareas en la nota del proyecto: "## Tareas Pendientes"
 * como checkboxes. La verdad del ESTADO vive en Supabase (tabla tasks); esto es
 * para que Rulo vea/edite las tareas en Obsidian. Reusa getProjectNote.
 */
import { writeFile } from "node:fs/promises";
import { getProjectNote } from "./projects.js";

/** Anexa `- [ ] <title>` a "## Tareas Pendientes" (crea la sección si falta). */
export async function appendTaskLine(slug: string, title: string): Promise<void> {
  const note = await getProjectNote(slug);
  if (!note) return;
  const line = `- [ ] ${title}`;
  // No duplicar si ya está exactamente (ni como pendiente ni hecha).
  if (note.raw.includes(line) || note.raw.includes(`- [x] ${title}`)) return;
  const lines = note.raw.split("\n");
  const idx = lines.findIndex((l) => /^#{1,3}\s*.*Tareas Pendientes/i.test(l));
  const next =
    idx === -1
      ? `${note.raw.trimEnd()}\n\n## 📋 Tareas Pendientes\n${line}\n`
      : (lines.splice(idx + 1, 0, line), lines.join("\n"));
  await writeFile(note.path, next, "utf8");
}

/** Marca `- [ ] <title>` → `- [x] <title>` (match exacto por título). */
export async function markTaskDone(slug: string, title: string): Promise<void> {
  const note = await getProjectNote(slug);
  if (!note) return;
  const esc = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^(\\s*[-*]\\s*)\\[ \\](\\s*${esc}\\s*)$`, "im");
  if (!re.test(note.raw)) return;
  await writeFile(note.path, note.raw.replace(re, "$1[x]$2"), "utf8");
}
