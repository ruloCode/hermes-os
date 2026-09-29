import { execFile } from "node:child_process";
import { access, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { CodeGraph3D, CodeGraphLink, CodeGraphNode } from "@hermes/shared";
import { cbmAvailable, cbmGraph3D, cbmList, cbmProject, cbmQuery, indexRepo } from "./code-memory.js";
import { env } from "./env.js";
import { readProjects, resolveProjectRoot } from "./vault/projects.js";

// Grafo de código: indexa cada repo con tree-sitter (AST puro, sin LLM) y
// responde consultas de estructura. Multi-repo: hermes-os (este monorepo) +
// los proyectos activos del vault con ruta_local que existe y es git. Lógica
// compartida tool + job + render 3D.
//
// DOS proveedores tras la misma fachada (HERMES_CODE_MEMORY):
//  - cbm (codebase-memory-mcp, default cuando el binario está): un SQLite por
//    carpeta, ~7s de indexado y consultas en ~1.6s; respeta .gitignore.
//  - graphify: el original. Se queda porque indexa lo que NO es código (vault,
//    docs, video) y porque es el fallback cuando cbm no está instalado.
// El proveedor se resuelve por repo y por consulta, así que una máquina sin
// cbm sigue respondiendo con graphify sin tocar una env.

const execFileAsync = promisify(execFile);

// Slug reservado para el propio monorepo (siempre indexable, sin pasar por el vault).
const SELF_SLUG = "hermes-os";

const exists = (p: string) => access(p).then(() => true, () => false);
const graphJson = (root: string) => join(root, "graphify-out", "graph.json");

/**
 * Ejecuta graphify sobre `root` (cwd + --graph absoluto donde aplica: no
 * dependemos del cwd del servicio launchd). Se retiran las API keys de LLM del
 * entorno hijo: el grafo de código es AST puro y así graphify jamás gasta
 * tokens por su cuenta (nombrar comunidades es manual: `graphify label .`).
 */
async function run(root: string, args: string[], timeoutMs: number): Promise<string> {
  const childEnv: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: "1" };
  for (const key of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "DEEPSEEK_API_KEY", "KIMI_API_KEY", "MOONSHOT_API_KEY"]) {
    delete childEnv[key];
  }
  const { stdout } = await execFileAsync(env.GRAPHIFY_BIN, args, {
    cwd: root,
    timeout: timeoutMs,
    maxBuffer: 1024 * 1024 * 4,
    env: childEnv,
  });
  return stdout;
}

/**
 * Proveedor efectivo. "auto" = cbm si el binario existe. Se consulta en cada
 * llamada (es un access() en disco) para que instalar cbm no exija reiniciar
 * el servicio.
 */
async function provider(): Promise<"cbm" | "graphify"> {
  if (env.CODE_MEMORY === "graphify") return "graphify";
  if (env.CODE_MEMORY === "cbm") return "cbm";
  return (await cbmAvailable()) ? "cbm" : "graphify";
}

export type GraphMode = "query" | "path" | "explain";
export interface IndexableRepo {
  slug: string;
  root: string;
}

/**
 * Repos indexables: hermes-os + proyectos activos con ruta_local que existe y
 * es git. Deduplicado por RAÍZ, no por slug: este monorepo también es un
 * proyecto del vault, así que sin esto se indexaba dos veces por corrida.
 */
export async function indexableRepos(): Promise<IndexableRepo[]> {
  const repos: IndexableRepo[] = [{ slug: SELF_SLUG, root: env.CODE_GRAPH_ROOT }];
  const seen = new Set([env.CODE_GRAPH_ROOT]);
  for (const p of await readProjects()) {
    if (p.estado !== "activo") continue;
    // El repo se resuelve contra el disco de ESTA máquina: en otro PC los
    // clones viven en otra carpeta y la ruta_local del vault no aplica.
    const root = resolveProjectRoot(p);
    if (!root || seen.has(root)) continue;
    if (await exists(join(root, ".git"))) {
      seen.add(root);
      repos.push({ slug: p.slug, root });
    }
  }
  return repos;
}

/**
 * Resuelve un `project` (slug o nombre, tolerante a parciales) a su raíz de
 * repo. Sin project → el propio monorepo. `error` (accionable) cuando el
 * proyecto no se conoce o su ruta_local está rota.
 */
async function resolveRoot(project?: string): Promise<{ root?: string; error?: string }> {
  if (!project || project.toLowerCase() === SELF_SLUG || project.toLowerCase() === "hermes") {
    return { root: env.CODE_GRAPH_ROOT };
  }
  const q = project.toLowerCase();
  const projects = await readProjects();
  const p =
    projects.find((x) => x.slug.toLowerCase() === q || x.name.toLowerCase() === q) ??
    projects.find((x) => x.slug.toLowerCase().includes(q) || x.name.toLowerCase().includes(q));
  if (!p) {
    const known = (await indexableRepos()).map((r) => r.slug).join(", ");
    return { error: `No conozco un proyecto "${project}". Proyectos indexables: ${known}.` };
  }
  const root = resolveProjectRoot(p);
  if (!root) {
    return {
      error: `No encontré el repo de "${p.slug}" en esta máquina (${env.MACHINE_NAME}). Vault: ${p.ruta_local ?? "sin ruta_local"}; clones locales: ${env.CODE_ROOT}.`,
    };
  }
  if (!(await exists(join(root, ".git")))) {
    return { error: `El proyecto "${p.slug}" apunta a ${root}, que no es un repo git en esta máquina.` };
  }
  return { root };
}

/** Consulta el grafo de un repo. Nunca lanza: todo error vuelve como texto accionable para el LLM. */
export async function queryCodeGraph(mode: GraphMode, query: string, target?: string, project?: string): Promise<string> {
  const { root, error } = await resolveRoot(project);
  if (error) return error;
  if ((await provider()) === "cbm") return cbmQuery(mode, query, target, root!);
  if (!(await exists(env.GRAPHIFY_BIN))) {
    return `graphify no está instalado (esperado en ${env.GRAPHIFY_BIN}). Instálalo con: uv tool install "graphifyy[sql,openai]"`;
  }
  const gj = graphJson(root!);
  if (!(await exists(gj))) {
    return `El grafo de "${project ?? SELF_SLUG}" no existe aún. Constrúyelo con: cd ${root} && graphify extract . --code-only — o espera al job "code-graph-update".`;
  }
  const args =
    mode === "path"
      ? ["path", query, target ?? "", "--graph", gj]
      : [mode, query, "--graph", gj];
  try {
    const out = (await run(root!, args, 30_000)).trim();
    return out.slice(0, 8000) || "graphify no devolvió resultados para esa consulta.";
  } catch (err) {
    const e = err as { killed?: boolean; stderr?: string; message?: string };
    if (e.killed) return "La consulta al grafo excedió 30s (timeout). Intenta una pregunta más acotada.";
    return `Error de graphify: ${(e.stderr || e.message || String(err)).slice(0, 400)}`;
  }
}

// ── Grafo 3D (tab MEMORIA) ──────────────────────────────────────────────────

// Formato crudo del graph.json de graphify (node-link de networkx).
interface RawGraph {
  nodes: Array<{
    id: string;
    label?: string;
    file_type?: string;
    community?: number;
    source_file?: string;
  }>;
  links: Array<{ source: string; target: string; relation?: string }>;
  built_at_commit?: string;
}

const EMPTY_GRAPH = (project: string, prov: "cbm" | "graphify" = "graphify"): CodeGraph3D => ({
  available: false,
  project,
  provider: prov,
  builtAtCommit: null,
  nodes: [],
  links: [],
  communities: {},
});

// Cache por repo, invalidado por mtime del graph.json (el job de 6h lo rota).
const graph3dCache = new Map<string, { mtimeMs: number; payload: CodeGraph3D }>();

/**
 * Grafo de código de un repo recortado para el render 3D del dashboard:
 * nodos {id,label,kind,community,degree,file} + aristas por índice + nombres
 * de comunidades. `available:false` (sin lanzar) cuando el grafo no existe.
 */
export async function readCodeGraph3D(project?: string): Promise<CodeGraph3D> {
  const slug = project?.trim() || SELF_SLUG;
  const { root, error } = await resolveRoot(project);
  if (error || !root) return EMPTY_GRAPH(slug);
  if ((await provider()) === "cbm") {
    // Con cbm el layout ya viene calculado por el daemon; si no contesta (o el
    // repo no está indexado todavía) se cae al graph.json de graphify en vez
    // de dejar el tab vacío.
    const g = await cbmGraph3D(root, slug, env.CBM_MAX_NODES);
    if (g.available) return g;
  }
  const gj = graphJson(root);
  let mtimeMs: number;
  try {
    mtimeMs = (await stat(gj)).mtimeMs;
  } catch {
    return EMPTY_GRAPH(slug);
  }
  const cached = graph3dCache.get(root);
  if (cached && cached.mtimeMs === mtimeMs) return cached.payload;

  const raw = JSON.parse(await readFile(gj, "utf8")) as RawGraph;
  const labelsPath = join(root, "graphify-out", ".graphify_labels.json");
  const communities = await readFile(labelsPath, "utf8")
    .then((s) => JSON.parse(s) as Record<string, string>)
    .catch(() => ({}) as Record<string, string>);

  const degree = new Map<string, number>();
  for (const l of raw.links) {
    degree.set(l.source, (degree.get(l.source) ?? 0) + 1);
    degree.set(l.target, (degree.get(l.target) ?? 0) + 1);
  }
  const index = new Map<string, number>();
  const nodes: CodeGraphNode[] = raw.nodes.map((n, i) => {
    index.set(n.id, i);
    return {
      id: n.id,
      label: n.label ?? n.id,
      kind: n.file_type ?? "code",
      community: n.community ?? -1,
      degree: degree.get(n.id) ?? 0,
      file: n.source_file ?? null,
    };
  });
  const links: CodeGraphLink[] = [];
  for (const l of raw.links) {
    const s = index.get(l.source);
    const t = index.get(l.target);
    if (s !== undefined && t !== undefined && s !== t) {
      links.push({ s, t, relation: l.relation ?? "" });
    }
  }
  const payload: CodeGraph3D = {
    available: true,
    project: slug,
    provider: "graphify",
    builtAtCommit: raw.built_at_commit ?? null,
    nodes,
    links,
    communities,
  };
  graph3dCache.set(root, { mtimeMs, payload });
  return payload;
}

/**
 * Job periódico: refresca el grafo de TODOS los repos indexables. Incremental
 * (`update`) si ya hay grafo; construcción completa (`extract --code-only`) si
 * no. Un repo que falla no tumba a los demás. null → "skipped" (sin binario).
 */
export async function updateCodeGraph(): Promise<{ total: number; updated: number; built: number; failed: number } | null> {
  if ((await provider()) === "cbm") return updateCodeMemory();
  if (!(await exists(env.GRAPHIFY_BIN))) return null; // sin binario instalado: skipped, no error
  const repos = await indexableRepos();
  let updated = 0;
  let built = 0;
  let failed = 0;
  for (const { root } of repos) {
    try {
      if (await exists(graphJson(root))) {
        await run(root, ["update", "."], 10 * 60_000);
        updated++;
      } else {
        await run(root, ["extract", ".", "--code-only"], 10 * 60_000);
        built++;
      }
    } catch {
      failed++; // un repo roto/lento no debe frustrar el refresco de los demás
    }
  }
  return { total: repos.length, updated, built, failed };
}

/**
 * El mismo job, con cbm: index_repository por repo (incremental de fábrica —
 * la primera corrida tarda ~7s, las siguientes ~3s). Un repo que falla no
 * tumba a los demás; "built" son los que aún no tenían índice.
 */
async function updateCodeMemory(): Promise<{ total: number; updated: number; built: number; failed: number } | null> {
  if (!(await cbmAvailable())) return null;
  const repos = await indexableRepos();
  const known = new Set<string>();
  try {
    // Un solo spawn para saber qué repos ya tenían índice (el resto es ruido
    // de la salida en árbol: solo interesan los nombres).
    const out = await cbmList();
    for (const line of out.split("\n")) {
      const name = line.trim().split(/\s+/)[0];
      if (name) known.add(name);
    }
  } catch {
    // sin lista: todos cuentan como nuevos, el indexado es igual de válido
  }
  let updated = 0;
  let built = 0;
  let failed = 0;
  for (const { root } of repos) {
    try {
      const had = known.has(cbmProject(root));
      await indexRepo(root);
      if (had) updated++;
      else built++;
    } catch {
      failed++;
    }
  }
  return { total: repos.length, updated, built, failed };
}
