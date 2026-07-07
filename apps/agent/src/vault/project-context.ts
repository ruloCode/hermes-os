import { execFile } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import matter from "gray-matter";
import type {
  ProjectContext,
  ProjectGit,
  ProjectMcpServer,
  ProjectSkill,
} from "@hermes/shared";
import { readProjects } from "./projects.js";

/**
 * Lee el "contexto operativo" de un proyecto desde su repo local (ruta_local):
 * skills (.claude/skills), servers MCP (.mcp.json), herramientas permitidas/
 * denegadas (.claude/settings*.json) y slash-commands (.claude/commands).
 * Cache por slug de 30s: enfocar/desenfocar un proyecto no re-lee el disco.
 */
const cache = new Map<string, { at: number; data: ProjectContext }>();
const TTL = 30_000;

// Forma parcial de un .claude/settings.json (solo lo que nos interesa).
interface ClaudeSettings {
  permissions?: { allow?: string[]; deny?: string[] };
  enabledMcpjsonServers?: string[];
  enableAllProjectMcpServers?: boolean;
}
interface McpServerCfg {
  command?: string;
  url?: string;
  type?: string;
}
interface McpJson {
  mcpServers?: Record<string, McpServerCfg>;
}

function expandHome(p: string): string {
  return p.startsWith("~") ? join(homedir(), p.slice(1)) : p;
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function readJson<T>(p: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(p, "utf8")) as T;
  } catch {
    return null;
  }
}

function uniq(arr: string[]): string[] {
  return [...new Set(arr.map(String))];
}

// Lee cada .claude/skills/<name>/SKILL.md y saca name + description del frontmatter.
async function readSkills(root: string): Promise<ProjectSkill[]> {
  const dir = join(root, ".claude", "skills");
  let names: string[] = [];
  try {
    names = (await readdir(dir, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
  const skills: ProjectSkill[] = [];
  for (const name of names) {
    try {
      const raw = await readFile(join(dir, name, "SKILL.md"), "utf8");
      const { data } = matter(raw);
      skills.push({
        name: String(data.name ?? name),
        description: String(data.description ?? "").slice(0, 220),
      });
    } catch {
      skills.push({ name, description: "" });
    }
  }
  return skills.slice(0, 40);
}

const exec = promisify(execFile);

// Estado git del repo: rama, último commit y archivos con cambios sin commitear.
// Devuelve null si la ruta no es un repo git (o git no está disponible).
async function readGit(root: string): Promise<ProjectGit | null> {
  const git = (...args: string[]) =>
    exec("git", ["-C", root, ...args], { timeout: 4000, maxBuffer: 8 * 1024 * 1024 }).then(
      (r) => r.stdout,
    );
  try {
    // %x1f = unit separator: el mensaje del commit puede traer cualquier cosa.
    // %b (cuerpo, multilínea) va al final para no romper los campos previos.
    const [rama, log, status] = await Promise.all([
      git("rev-parse", "--abbrev-ref", "HEAD"),
      git("log", "-1", "--format=%h%x1f%s%x1f%ct%x1f%b"),
      git("status", "--porcelain"),
    ]);
    const [commit, mensaje, ct, ...resto] = log.split("\x1f");
    return {
      rama: rama.trim(),
      commit: (commit ?? "").trim(),
      mensaje: (mensaje ?? "").slice(0, 120),
      descripcion: resto.join("\x1f").trim().slice(0, 600),
      commitAt: Number(ct ?? 0) * 1000,
      archivosCambiados: status.split("\n").filter((l) => l.trim()).length,
    };
  } catch {
    return null;
  }
}

// Slash-commands: nombres de .claude/commands/*.md.
async function readCommands(root: string): Promise<string[]> {
  try {
    return (await readdir(join(root, ".claude", "commands")))
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(/\.md$/, ""))
      .slice(0, 30);
  } catch {
    return [];
  }
}

// Normaliza el mapa de servers del .mcp.json a nuestra forma, marcando cuáles
// están habilitados según settings (enableAll o lista explícita).
function parseMcp(
  servers: Record<string, McpServerCfg> | undefined,
  enabled: Set<string> | "all" | null,
): ProjectMcpServer[] {
  if (!servers) return [];
  return Object.entries(servers).map(([name, cfg]) => {
    let kind = "unknown";
    let detail: string | undefined;
    if (typeof cfg.command === "string") {
      kind = "stdio";
      detail = cfg.command;
    } else if (typeof cfg.url === "string") {
      kind = cfg.type ?? "http";
      detail = cfg.url;
    } else if (typeof cfg.type === "string") {
      kind = cfg.type;
    }
    return {
      name,
      kind,
      detail: detail?.slice(0, 80),
      enabled: enabled === "all" ? true : enabled ? enabled.has(name) : undefined,
    };
  });
}

export async function readProjectContext(slug: string): Promise<ProjectContext> {
  const hit = cache.get(slug);
  if (hit && Date.now() - hit.at < TTL) return hit.data;

  const project = (await readProjects()).find(
    (p) => p.slug.toLowerCase() === slug.toLowerCase(),
  );
  const root = project?.ruta_local ? expandHome(project.ruta_local) : null;

  const base: ProjectContext = {
    slug,
    ruta_local: project?.ruta_local ?? null,
    found: false,
    rama: project?.rama,
    hasClaudeMd: false,
    skills: [],
    mcpServers: [],
    allowTools: [],
    denyTools: [],
    commands: [],
  };

  if (!root || !(await exists(root))) {
    cache.set(slug, { at: Date.now(), data: base });
    return base;
  }

  const settings = await readJson<ClaudeSettings>(join(root, ".claude", "settings.json"));
  const local = await readJson<ClaudeSettings>(join(root, ".claude", "settings.local.json"));

  // Qué servers MCP del .mcp.json están habilitados por settings.
  let enabled: Set<string> | "all" | null = null;
  if (settings?.enableAllProjectMcpServers || local?.enableAllProjectMcpServers) {
    enabled = "all";
  } else {
    const list = [
      ...(settings?.enabledMcpjsonServers ?? []),
      ...(local?.enabledMcpjsonServers ?? []),
    ];
    if (list.length) enabled = new Set(list.map(String));
  }

  const mcp = await readJson<McpJson>(join(root, ".mcp.json"));

  const git = await readGit(root);

  const data: ProjectContext = {
    slug,
    ruta_local: project?.ruta_local ?? root,
    found: true,
    rama: git?.rama ?? project?.rama,
    git,
    hasClaudeMd: await exists(join(root, "CLAUDE.md")),
    skills: await readSkills(root),
    mcpServers: parseMcp(mcp?.mcpServers, enabled),
    allowTools: uniq([
      ...(settings?.permissions?.allow ?? []),
      ...(local?.permissions?.allow ?? []),
    ]).slice(0, 80),
    denyTools: uniq([
      ...(settings?.permissions?.deny ?? []),
      ...(local?.permissions?.deny ?? []),
    ]).slice(0, 80),
    commands: await readCommands(root),
  };

  cache.set(slug, { at: Date.now(), data });
  return data;
}
