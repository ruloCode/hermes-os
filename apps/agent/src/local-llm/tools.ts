/**
 * Tools del modelo local. Pocas a propósito: un 4B elige bien entre cinco y se
 * enreda con cuarenta. Todo corre sin red:
 *   - proyectos: del vault si hay, si no del espejo de Supabase, y SIEMPRE se
 *     guarda una copia en disco (`proyectos.json`) para que en el avión, sin
 *     ninguna de las dos fuentes, el modelo siga sabiendo en qué va cada cosa;
 *   - código: rg/lectura acotados a los repos del proyecto que existen aquí
 *     (los .env y llaves no se leen nunca);
 *   - notas: lo único que escribe, y solo agrega líneas.
 */
import { execFile } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import type { ProjectStatus } from "@hermes/shared";
import { env } from "../env.js";
import { HERMES_HOME } from "../home.js";
import { readProjects, resolveProjectRepos } from "../vault/projects.js";
import { LOCAL_DIR } from "./server.js";

const run = promisify(execFile);
const SNAPSHOT_PATH = join(LOCAL_DIR, "proyectos.json");
const RG_BIN = process.env.RG_BIN || "/opt/homebrew/bin/rg";
// Todo lo que devuelve una tool el modelo lo tiene que LEER antes de contestar
// (~135 tok/s): 3.000 caracteres son ~1 s; 6.000 eran el doble.
const MAX_RESULT = 3000;

// Proyectos de prueba que ensucian la lista (los crean los sims y el QA).
const isNoise = (slug: string) => slug.startsWith("_") || slug === "livetest";

interface Snapshot {
  at: string;
  projects: ProjectStatus[];
}

/** Proyectos frescos si hay fuente; si no, la última copia guardada. */
export async function loadProjects(): Promise<{ projects: ProjectStatus[]; from: string }> {
  try {
    const fresh = await Promise.race([
      readProjects(),
      new Promise<ProjectStatus[]>((r) => setTimeout(() => r([]), 4000)),
    ]);
    const projects = fresh.filter((p) => !isNoise(p.slug));
    if (projects.length) {
      const snap: Snapshot = { at: new Date().toISOString(), projects };
      await mkdir(LOCAL_DIR, { recursive: true });
      await writeFile(SNAPSHOT_PATH, JSON.stringify(snap));
      return { projects, from: "en vivo" };
    }
  } catch {
    /* sin red ni vault: cae a la copia */
  }
  try {
    const snap = JSON.parse(await readFile(SNAPSHOT_PATH, "utf8")) as Snapshot;
    return { projects: snap.projects, from: `copia del ${snap.at.slice(0, 16).replace("T", " ")}` };
  } catch {
    return { projects: [], from: "sin copia" };
  }
}

function findProject(projects: ProjectStatus[], q: unknown): ProjectStatus | undefined {
  const needle = String(q ?? "").toLowerCase().trim();
  if (!needle) return undefined;
  const norm = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, "");
  return (
    projects.find((p) => p.slug.toLowerCase() === needle) ??
    projects.find((p) => norm(p.name) === norm(needle)) ??
    projects.find((p) => norm(p.slug).includes(norm(needle)) || norm(p.name).includes(norm(needle)))
  );
}

/** Repos donde se puede buscar/leer: los del proyecto, o todos los que hay aquí. */
async function codeRoots(project: unknown): Promise<{ name: string; root: string }[] | string> {
  const { projects } = await loadProjects();
  if (project) {
    const p = findProject(projects, project);
    if (!p) return `No conozco el proyecto "${String(project)}". Usa list_projects.`;
    const repos = resolveProjectRepos(p);
    return repos.length ? repos : `El proyecto ${p.slug} no tiene su código en esta Mac.`;
  }
  const all = projects.flatMap((p) => resolveProjectRepos(p));
  const seen = new Set<string>();
  const roots = all.filter((r) => !seen.has(r.root) && seen.add(r.root));
  return roots.length ? roots : "No hay repos de proyectos en esta Mac.";
}

const SECRET_RE = /(^|\/)(\.env[^/]*|.*\.(pem|key|p12)|id_(rsa|ed25519)[^/]*|credentials[^/]*)$/i;

const inside = (root: string, abs: string) => {
  const rel = relative(root, abs);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

const clip = (s: string, max = MAX_RESULT) =>
  s.length > max ? `${s.slice(0, max)}\n… (recortado)` : s;

/** Fecha y hora LOCALES de la Mac (en un vuelo, la del reloj que ves). */
function localStamp(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, "0");
  return {
    day: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
    time: `${p(d.getHours())}:${p(d.getMinutes())}`,
  };
}

/** Dónde caen las notas: la nota del día del vault, o una carpeta propia sin vault. */
export function notesFile(day: string): string {
  return env.VAULT_PATH
    ? join(env.VAULT_PATH, "40 Diario", `${day}.md`)
    : join(HERMES_HOME, "notas-de-vuelo", `${day}.md`);
}

export const LOCAL_TOOL_DEFS = [
  {
    type: "function",
    function: {
      name: "list_projects",
      description: "Lista los proyectos con su estado y cuántas tareas pendientes tienen.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_project_status",
      description: "Estado actual y tareas pendientes de UN proyecto.",
      parameters: {
        type: "object",
        properties: { project: { type: "string", description: "slug o nombre del proyecto" } },
        required: ["project"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_code",
      description:
        "Busca un texto literal en el código de un proyecto (o de todos los que están en esta Mac). Devuelve archivo:línea.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "texto a buscar (literal, corto: un nombre de función, una palabra)" },
          project: { type: "string", description: "slug del proyecto (opcional)" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Lee un archivo del código de un proyecto, con números de línea.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "ruta relativa al repo (como la devuelve search_code)" },
          project: { type: "string", description: "slug del proyecto (opcional)" },
          start: { type: "number", description: "línea inicial (default 1)" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "capture_idea",
      description:
        "Guarda una nota en la nota del día. SOLO si el usuario lo pide con palabras como «anota», «guarda», «apunta» o «recuérdame». Nunca para responder preguntas.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "la nota, en una o pocas líneas" },
          project: { type: "string", description: "proyecto relacionado (opcional)" },
        },
        required: ["text"],
      },
    },
  },
];

/** Nombre con el que la consola pinta el paso (reusa los íconos de Read/Grep). */
export const STEP_NAME: Record<string, string> = { search_code: "Grep", read_file: "Read" };

export async function runLocalTool(name: string, args: Record<string, unknown>): Promise<string> {
  try {
    switch (name) {
      case "list_projects": {
        const { projects, from } = await loadProjects();
        if (!projects.length) return "No tengo proyectos (ni en vivo ni copia guardada).";
        const lines = projects
          .sort((a, b) => Number(a.estado !== "activo") - Number(b.estado !== "activo"))
          .map((p) => `- ${p.slug} (${p.name}) · ${p.estado} · ${p.tareas_pendientes.length} pendientes`);
        return `Proyectos (${from}):\n${lines.join("\n")}`;
      }
      case "get_project_status": {
        const { projects, from } = await loadProjects();
        const p = findProject(projects, args.project);
        if (!p) return `No conozco el proyecto "${String(args.project ?? "")}". Usa list_projects.`;
        const tasks = p.tareas_pendientes.length
          ? p.tareas_pendientes.map((t) => `- ${t}`).join("\n")
          : "(sin tareas pendientes)";
        return clip(
          `# ${p.name} (${p.slug}) · ${p.estado} · ${from}\n## Tareas pendientes\n${tasks}\n## Estado actual\n${p.estado_actual.slice(0, 1800) || "(vacío)"}`,
        );
      }
      case "search_code": {
        const query = String(args.query ?? "").trim();
        if (!query) return "Falta el texto a buscar.";
        const roots = await codeRoots(args.project);
        if (typeof roots === "string") return roots;
        const out: string[] = [];
        for (const r of roots) {
          try {
            const { stdout } = await run(
              RG_BIN,
              ["-n", "-S", "-F", "--max-count", "3", "--max-columns", "200", "--glob", "!*.env*", "--", query, "."],
              { cwd: r.root, timeout: 8000, maxBuffer: 2 * 1024 * 1024 },
            );
            const hits = stdout.trim().split("\n").filter(Boolean).slice(0, 40);
            if (hits.length) out.push(`## ${r.name}\n${hits.map((h) => h.replace(/^\.\//, "")).join("\n")}`);
          } catch (err) {
            // rg sale con 1 cuando no encuentra nada: no es error.
            if ((err as { code?: number }).code !== 1) out.push(`## ${r.name}\n(error buscando)`);
          }
        }
        return out.length ? clip(out.join("\n\n")) : `No encontré "${query}".`;
      }
      case "read_file": {
        const raw = String(args.path ?? "").trim();
        if (!raw) return "Falta la ruta.";
        const roots = await codeRoots(args.project);
        if (typeof roots === "string") return roots;
        for (const r of roots) {
          const abs = isAbsolute(raw) ? raw : resolve(r.root, raw);
          if (!existsSync(abs)) continue;
          const real = realpathSync(abs);
          if (!inside(realpathSync(r.root), real)) return "Esa ruta está fuera del proyecto.";
          if (SECRET_RE.test(real)) return "Ese archivo guarda secretos: no lo leo.";
          const lines = (await readFile(real, "utf8")).split("\n");
          const start = Math.max(1, Math.floor(Number(args.start) || 1));
          const slice = lines.slice(start - 1, start - 1 + 120);
          const body = slice.map((l, i) => `${start + i}\t${l}`).join("\n");
          const more = start - 1 + slice.length < lines.length ? `\n… (${lines.length} líneas en total)` : "";
          return clip(`${r.name}/${relative(r.root, real)}\n${body}${more}`, 6000);
        }
        return `No encontré ${raw} en ${roots.map((r) => r.name).join(", ")}.`;
      }
      case "capture_idea": {
        const text = String(args.text ?? "").trim();
        if (!text) return "Falta el texto de la nota.";
        const { day, time } = localStamp();
        const file = notesFile(day);
        await mkdir(join(file, ".."), { recursive: true });
        if (!existsSync(file)) await writeFile(file, `# ${day}\n\n`);
        const tag = args.project ? ` [${String(args.project)}]` : "";
        await appendFile(file, `- ${time} ✈${tag} ${text.replace(/\n+/g, " ")}\n`);
        return `Guardado en ${basename(file)}.`;
      }
      default:
        return `No existe la tool ${name}.`;
    }
  } catch (err) {
    return `Error en ${name}: ${err instanceof Error ? err.message : String(err)}`;
  }
}
