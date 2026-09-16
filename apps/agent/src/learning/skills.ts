import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import matter from "gray-matter";
import type { SkillInfo } from "@hermes/shared";
import { HERMES_HOME } from "../home.js";
import { supabase } from "../supabase.js";

/**
 * Skills de Hermes = memoria PROCEDIMENTAL, en disco.
 *
 * Las memorias (pgvector) guardan HECHOS: "el disco del Estudio es /Volumes/Rulo".
 * Una skill guarda un PROCEDIMIENTO: "cómo publicar una pieza de punta a punta".
 * Sin esto, cada sesión vuelve a deducir el mismo flujo desde cero.
 *
 * Viven como un PLUGIN LOCAL del CLI de Claude Code
 * (~/.hermes-os/plugin/skills/<nombre>/SKILL.md) y no en Supabase: el CLI las
 * descubre del disco y las carga solo cuando su `description` matchea — el
 * costo en contexto es el índice, no el cuerpo. Supabase solo lleva la
 * telemetría de uso (skill_usage) para que el curador sepa cuáles murieron.
 *
 * El plugin se pasa por `plugins: [{type:"local", path}]` en session.ts, así
 * que NO dependemos de settingSources ni contaminamos ~/.claude del usuario.
 */

export const PLUGIN_DIR: string = process.env.HERMES_PLUGIN_PATH || join(HERMES_HOME, "plugin");
export const SKILLS_DIR: string = join(PLUGIN_DIR, "skills");
const ARCHIVE_DIR: string = join(PLUGIN_DIR, ".archive");

/** Tope del cuerpo de una skill. Más que esto y deja de ser un procedimiento. */
const SKILL_MAX_CHARS = 8000;
/** El índice del system prompt trunca la descripción: pasarse = no rutea nunca. */
export const DESCRIPTION_MAX = 120;

const NAME_RE = /^[a-z][a-z0-9-]{1,48}[a-z0-9]$/;

/** Asegura el plugin.json; sin él el CLI no reconoce el directorio. */
export async function ensurePlugin(): Promise<string> {
  await mkdir(SKILLS_DIR, { recursive: true });
  const manifestDir = join(PLUGIN_DIR, ".claude-plugin");
  await mkdir(manifestDir, { recursive: true });
  const manifest = join(manifestDir, "plugin.json");
  try {
    await readFile(manifest, "utf8");
  } catch {
    await writeFile(
      manifest,
      `${JSON.stringify(
        {
          name: "hermes",
          description: "Procedimientos que Hermes aprendió trabajando con su dueño.",
          version: "0.1.0",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  }
  return PLUGIN_DIR;
}

function skillPath(name: string): string {
  return join(SKILLS_DIR, name, "SKILL.md");
}

export interface SkillDoc {
  name: string;
  description: string;
  version: string;
  createdBy: "agent" | "human";
  createdAt: string | null;
  body: string;
}

async function readSkill(name: string): Promise<SkillDoc | null> {
  try {
    const raw = await readFile(skillPath(name), "utf8");
    const { data, content } = matter(raw);
    return {
      name: String(data.name || name),
      description: String(data.description || ""),
      version: String(data.version || "0.1.0"),
      createdBy: data.metadata?.hermes?.created_by === "human" ? "human" : "agent",
      createdAt: data.metadata?.hermes?.created_at ? String(data.metadata.hermes.created_at) : null,
      body: content.trim(),
    };
  } catch {
    return null;
  }
}

function render(doc: SkillDoc): string {
  const fm = [
    "---",
    `name: ${doc.name}`,
    `description: ${JSON.stringify(doc.description)}`,
    `version: ${doc.version}`,
    "metadata:",
    "  hermes:",
    `    created_by: ${doc.createdBy}`,
    `    created_at: ${doc.createdAt ?? new Date().toISOString()}`,
    "---",
    "",
  ].join("\n");
  return `${fm}${doc.body.trim()}\n`;
}

/** Telemetría en Supabase; nunca bloquea la operación en disco. */
async function touchUsage(name: string, patch: Record<string, unknown>): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase
    .from("skill_usage")
    .upsert({ name, updated_at: new Date().toISOString(), ...patch }, { onConflict: "name" });
  if (error) console.error("[hermes] skill_usage", error.message);
}

export interface SkillWriteResult {
  ok: boolean;
  message: string;
}

/**
 * Valida los estándares de autoría ANTES de escribir. Son los mismos que
 * hermes-agent aplica en review, y no son cosméticos: una descripción larga
 * se trunca en el índice y la skill deja de activarse.
 */
function validate(name: string, description: string, body: string): string | null {
  if (!NAME_RE.test(name)) {
    return `Nombre inválido "${name}": minúsculas-con-guiones, 3-50 chars (ej: publicar-pieza-estudio).`;
  }
  const desc = description.trim();
  if (!desc) return "Falta description: una frase que diga CUÁNDO usar la skill.";
  if (desc.length > DESCRIPTION_MAX) {
    return `La description tiene ${desc.length} chars y el tope es ${DESCRIPTION_MAX}. El índice la trunca ahí, así que lo que pase de ese largo nunca se lee: recórtala.`;
  }
  if (/\b(potente|completa|avanzada|integral|robusta|poderosa)\b/i.test(desc)) {
    return "Quita los adjetivos de marketing de la description: di qué hace, no qué tan buena es.";
  }
  const text = body.trim();
  if (text.length < 80) return "El cuerpo es demasiado corto para ser un procedimiento.";
  if (text.length > SKILL_MAX_CHARS) {
    return `El cuerpo tiene ${text.length} chars y el tope es ${SKILL_MAX_CHARS}: parte lo largo en archivos de referencia.`;
  }
  if (!/^##\s*Cu[áa]ndo usarla\s*$/im.test(text)) {
    return 'Falta la sección "## Cuándo usarla" (primera sección del cuerpo).';
  }
  if (!/^##\s*Verificaci[óo]n\s*$/im.test(text)) {
    return 'Falta la sección "## Verificación": cómo saber que el procedimiento salió bien.';
  }
  return null;
}

export async function createSkill(input: {
  name: string;
  description: string;
  body: string;
  createdBy?: "agent" | "human";
}): Promise<SkillWriteResult> {
  const name = input.name.trim().toLowerCase();
  const problem = validate(name, input.description, input.body);
  if (problem) return { ok: false, message: problem };
  if (await readSkill(name)) {
    return { ok: false, message: `Ya existe la skill "${name}". Usa patch para mejorarla.` };
  }
  await ensurePlugin();
  await mkdir(join(SKILLS_DIR, name), { recursive: true });
  await writeFile(
    skillPath(name),
    render({
      name,
      description: input.description.trim(),
      version: "0.1.0",
      createdBy: input.createdBy ?? "agent",
      createdAt: new Date().toISOString(),
      body: input.body,
    }),
    "utf8",
  );
  await touchUsage(name, { created_by: input.createdBy ?? "agent", state: "active" });
  return { ok: true, message: `Skill "${name}" creada. Se activa en la próxima sesión.` };
}

/** Reemplazo por substring: barato y preciso. Sin match, no escribe nada. */
export async function patchSkill(input: {
  name: string;
  find: string;
  replace: string;
}): Promise<SkillWriteResult> {
  const doc = await readSkill(input.name);
  if (!doc) return { ok: false, message: `No existe la skill "${input.name}".` };
  if (!doc.body.includes(input.find)) {
    return { ok: false, message: `No encontré ese texto en "${input.name}". Lee la skill y cita el fragmento exacto.` };
  }
  const body = doc.body.replace(input.find, input.replace);
  const problem = validate(doc.name, doc.description, body);
  if (problem) return { ok: false, message: `El patch dejaría la skill inválida: ${problem}` };
  const [maj, min] = doc.version.split(".").map(Number);
  await writeFile(
    skillPath(doc.name),
    render({ ...doc, body, version: `${maj || 0}.${(min || 0) + 1}.0` }),
    "utf8",
  );
  await touchUsage(doc.name, { state: "active" });
  return { ok: true, message: `Skill "${doc.name}" actualizada.` };
}

export async function getSkill(name: string): Promise<SkillDoc | null> {
  return readSkill(name);
}

/** Lista con telemetría. `state` sale de Supabase; el disco manda en el resto. */
export async function listSkills(): Promise<SkillInfo[]> {
  let names: string[] = [];
  try {
    const entries = await readdir(SKILLS_DIR, { withFileTypes: true });
    names = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }

  const usage = new Map<string, Record<string, any>>();
  if (supabase && names.length) {
    const { data } = await supabase.from("skill_usage").select("*").in("name", names);
    for (const row of data ?? []) usage.set(row.name, row);
  }

  const out: SkillInfo[] = [];
  for (const name of names) {
    const doc = await readSkill(name);
    if (!doc) continue;
    const u = usage.get(name) ?? {};
    out.push({
      name: doc.name,
      description: doc.description,
      version: doc.version,
      createdBy: doc.createdBy,
      createdAt: doc.createdAt,
      pinned: Boolean(u.pinned),
      useCount: Number(u.use_count) || 0,
      lastUsedAt: u.last_used_at ?? null,
      state: (u.state as SkillInfo["state"]) ?? "active",
      lines: doc.body.split("\n").length,
    });
  }
  return out.sort((a, b) => b.useCount - a.useCount || a.name.localeCompare(b.name));
}

/** Suma un uso. La llama el hook PostToolUse cuando el CLI carga una skill. */
export async function recordSkillUse(name: string): Promise<void> {
  if (!supabase) return;
  const { data } = await supabase.from("skill_usage").select("use_count").eq("name", name).maybeSingle();
  await touchUsage(name, {
    use_count: (Number(data?.use_count) || 0) + 1,
    last_used_at: new Date().toISOString(),
    state: "active",
  });
}

export async function setPinned(name: string, pinned: boolean): Promise<SkillWriteResult> {
  if (!(await readSkill(name))) return { ok: false, message: `No existe la skill "${name}".` };
  await touchUsage(name, { pinned });
  return { ok: true, message: pinned ? `"${name}" fijada: el curador no la tocará.` : `"${name}" liberada.` };
}

/**
 * Archivar NUNCA borra: mueve a .archive/ y es reversible. Una skill que el
 * agente tardó semanas en afinar no se pierde por un contador de uso.
 */
export async function archiveSkill(name: string): Promise<SkillWriteResult> {
  if (!(await readSkill(name))) return { ok: false, message: `No existe la skill "${name}".` };
  await mkdir(ARCHIVE_DIR, { recursive: true });
  const dest = join(ARCHIVE_DIR, `${name}-${Date.now()}`);
  await rename(join(SKILLS_DIR, name), dest);
  await touchUsage(name, { state: "archived" });
  return { ok: true, message: `"${name}" archivada en ${dest} (restaurable).` };
}

export async function restoreSkill(archivedDir: string): Promise<SkillWriteResult> {
  const name = archivedDir.replace(/-\d+$/, "");
  try {
    await rename(join(ARCHIVE_DIR, archivedDir), join(SKILLS_DIR, name));
  } catch (err) {
    return { ok: false, message: `No pude restaurar: ${String(err).slice(0, 120)}` };
  }
  await touchUsage(name, { state: "active" });
  return { ok: true, message: `"${name}" restaurada.` };
}

/** Borrado real: solo a mano desde el dashboard, y nunca una skill fijada. */
export async function deleteSkill(name: string): Promise<SkillWriteResult> {
  const info = (await listSkills()).find((s) => s.name === name);
  if (!info) return { ok: false, message: `No existe la skill "${name}".` };
  if (info.pinned) return { ok: false, message: `"${name}" está fijada: quítale el pin antes de borrarla.` };
  await rm(join(SKILLS_DIR, name), { recursive: true, force: true });
  if (supabase) await supabase.from("skill_usage").delete().eq("name", name);
  return { ok: true, message: `"${name}" eliminada.` };
}
