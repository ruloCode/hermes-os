import { execFile, spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { promisify } from "node:util";
import type { CodeGraph3D, CodeGraphLink, CodeGraphNode } from "@hermes/shared";
import { env } from "./env.js";

// Memoria de código (codebase-memory-mcp): indexa cada repo a un SQLite propio
// en ~/.cache/codebase-memory-mcp/<slug>.db y responde consultas de estructura
// en milisegundos. Aquí NO se registra como servidor MCP a propósito: sus 17
// tools costarían ~4.600 tokens fijos en cada turno del agente. Se invoca el
// binario en modo one-shot (`cbm cli <tool> '<json>'`) desde ESTE proceso y el
// modelo sigue viendo una sola tool (query_code_graph). Lo mismo para el 3D:
// el dashboard le pide el grafo al agente, no al daemon.

const execFileAsync = promisify(execFile);

const exists = (p: string) => access(p).then(() => true, () => false);

/**
 * Entorno del binario: allowlist, como el del proceso hijo del SDK. cbm es AST
 * puro (no habla con ningún LLM), así que no tiene por qué ver el .env.
 */
function cbmEnv(): NodeJS.ProcessEnv {
  const e: NodeJS.ProcessEnv = { NO_COLOR: "1" };
  for (const key of ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "CBM_CACHE_DIR", "CBM_RUNTIME_DIR"]) {
    const v = process.env[key];
    if (v) e[key] = v;
  }
  return e;
}

export const cbmAvailable = () => exists(env.CBM_BIN);

/**
 * Slug con el que cbm nombra un repo: su ruta absoluta sin la barra inicial y
 * todo lo que no sea alfanumérico colapsado a guiones. Se deriva en vez de
 * pedirlo con list_projects para no gastar un spawn por consulta (una ruta con
 * espacios —"Rulo Code"— también cae aquí, verificado contra el binario).
 */
export function cbmProject(root: string): string {
  return root
    .replace(/^\/+/, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Palabras que no dicen nada del código: si entran a la búsqueda, ganan ellas.
// Una pregunta en español pasada tal cual a BM25 devuelve ruido (medido: la
// pregunta completa traía vttToText y cleanDescription; los términos solos
// traen clap-detector).
const STOPWORDS = new Set([
  "como","cómo","donde","dónde","cuando","cuándo","que","qué","cual","cuál","quien","quién","por","para",
  "con","sin","the","and","for","from","with","this","that","what","where","when","which","who","how",
  "una","uno","unos","unas","los","las","del","des","est","esta","este","esto","estos","estas","hay",
  "más","mas","muy","son","ser","está","están","tiene","tienen","hace","hacer","puede","pueden","sobre",
  "todo","toda","todos","todas","entre","desde","hasta","pero","porque","cuanto","cuánto","are","was",
  "does","did","can","get","set","use","used","using","into","about","there","their","have","has",
]);

/**
 * Términos de búsqueda de una pregunta en lenguaje natural: fuera las palabras
 * vacías (es/en), fuera lo de menos de 3 letras, sin repetir y con tope. Los
 * identificadores se preservan tal cual (createClapDetector, snake_case).
 */
export function searchTerms(question: string, max = 8): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of question.split(/[^A-Za-z0-9_áéíóúñüÁÉÍÓÚÑÜ]+/)) {
    if (raw.length < 3) continue;
    const key = raw.toLowerCase();
    if (STOPWORDS.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(raw);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Paquete al que pertenece un archivo: `apps/web`, `packages/shared`, `mobile`…
 * Es lo que agrupa el grafo 3D. cbm detecta clusters (get_architecture) pero no
 * expone a qué cluster pertenece cada nodo, así que se agrupa por la carpeta
 * real — dato del repo, no una etiqueta inventada.
 */
export function topPackage(file: string | null | undefined): string {
  if (!file) return "raíz";
  const parts = file.split("/").filter(Boolean);
  if (parts.length <= 1) return "raíz";
  if ((parts[0] === "apps" || parts[0] === "packages") && parts.length > 2) {
    return `${parts[0]}/${parts[1]}`;
  }
  return parts[0];
}

interface CbmError {
  stdout?: string;
  stderr?: string;
  message?: string;
  killed?: boolean;
}

/** Texto de error de cbm, ya recortado y sin JSON crudo cuando se puede leer. */
function errText(err: unknown): string {
  const e = err as CbmError;
  const body = (e.stdout || e.stderr || e.message || String(err)).trim();
  try {
    const j = JSON.parse(body) as { error?: string; hint?: string };
    if (j.error) return j.hint ? `${j.error} — ${j.hint}` : j.error;
  } catch {
    // no era JSON: sirve el texto crudo
  }
  return body.slice(0, 400);
}

const notIndexed = (err: unknown) => /not found or not indexed/i.test(errText(err));

/** Una tool de cbm, one-shot. Lanza si el binario sale con error. */
async function cbm(tool: string, args: Record<string, unknown>, timeoutMs = 60_000): Promise<string> {
  const { stdout } = await execFileAsync(
    env.CBM_BIN,
    ["cli", "--quiet", tool, JSON.stringify(args)],
    { timeout: timeoutMs, maxBuffer: 1024 * 1024 * 8, env: cbmEnv() },
  );
  return stdout.trim();
}

/** Repos ya indexados (salida en árbol: una línea por proyecto). */
export async function cbmList(): Promise<string> {
  return cbm("list_projects", { limit: 200 }, 30_000);
}

/** Indexa (o reindexa, incremental) un repo. ~7s la primera vez, ~3s después. */
export async function indexRepo(root: string): Promise<void> {
  await cbm("index_repository", { repo_path: root }, 10 * 60_000);
}

/** Como `cbm`, pero si el repo aún no está indexado lo indexa y reintenta UNA vez. */
async function cbmIndexed(
  root: string,
  tool: string,
  args: Record<string, unknown>,
  timeoutMs = 60_000,
): Promise<string> {
  try {
    return await cbm(tool, { project: cbmProject(root), ...args }, timeoutMs);
  } catch (err) {
    if (!notIndexed(err)) throw err;
    await indexRepo(root);
    return await cbm(tool, { project: cbmProject(root), ...args }, timeoutMs);
  }
}

const TOKENS = 1400; // tope de salida por consulta: el modelo lee, no vuelca el grafo

/**
 * Consulta de estructura sobre el grafo de un repo. Cada modo se traduce a la
 * primitiva de cbm que de verdad responde esa pregunta:
 *  - query   → search_code (texto rankeado por grafo; es lo único que entiende
 *              una pregunta en español) y, si no hay nada, BM25 sobre símbolos.
 *  - explain → el símbolo exacto + quién lo llama y a quién llama.
 *  - path    → ¿están conectados y a cuántos saltos? + el vecindario del origen.
 * Nunca lanza: todo error vuelve como texto accionable para el LLM.
 */
export async function cbmQuery(
  mode: "query" | "path" | "explain",
  query: string,
  target: string | undefined,
  root: string,
): Promise<string> {
  try {
    if (mode === "explain") {
      const name = query.trim().replace(/[^A-Za-z0-9_$.]/g, "");
      if (!name) return "Para mode=explain pasa el nombre del símbolo (ej: ingestMeeting).";
      const found = await cbmIndexed(root, "search_graph", {
        name_pattern: `^${name}$`,
        limit: 5,
        max_output_tokens: 500,
      });
      const trace = await cbmIndexed(root, "trace_path", {
        function_name: name,
        direction: "both",
        depth: 2,
        max_output_tokens: TOKENS,
      });
      return `${found}\n\n${trace}`.trim();
    }

    if (mode === "path") {
      if (!target) return "mode=path requiere 'target' (nodo destino).";
      const a = query.trim().replace(/["\\]/g, "");
      const b = target.trim().replace(/["\\]/g, "");
      const hops = await cbmIndexed(root, "query_graph", {
        query: `MATCH (a {name: "${a}"})-[*1..6]-(b {name: "${b}"}) RETURN b.qualified_name, b.file_path LIMIT 3`,
        max_rows: 3,
      });
      if (/^rows: 0\b/m.test(hops)) {
        return `"${a}" y "${b}" no aparecen conectados dentro de 6 saltos en este repo. Verifica los nombres con mode=explain.`;
      }
      const trace = await cbmIndexed(root, "trace_path", {
        function_name: a,
        direction: "outbound",
        depth: 4,
        max_output_tokens: TOKENS,
      });
      return `Conectados (≤6 saltos):\n${hops}\n\nCadena desde ${a}:\n${trace}`.trim();
    }

    const terms = searchTerms(query);
    if (!terms.length) return "La pregunta no tiene términos buscables (todo eran palabras vacías).";
    const pattern = terms.length === 1 ? terms[0] : `(${terms.join("|")})`;
    const hits = await cbmIndexed(root, "search_code", {
      pattern,
      regex: terms.length > 1,
      limit: 12,
      max_output_tokens: TOKENS,
    });
    if (!/^results: 0\b/m.test(hits) && hits) return hits;
    // Sin coincidencias de texto: BM25 sobre nombres de símbolos.
    return await cbmIndexed(root, "search_graph", {
      query: terms.join(" "),
      limit: 12,
      max_output_tokens: TOKENS,
    });
  } catch (err) {
    const e = err as CbmError;
    if (e.killed) return "La consulta al grafo excedió el tiempo límite. Intenta una pregunta más acotada.";
    return `Error de codebase-memory: ${errText(err)}`;
  }
}

// ── Grafo 3D vía el daemon (tab MEMORIA) ────────────────────────────────────

// El daemon calcula el layout 3D server-side y lo sirve por HTTP en el puerto
// de la UI. Es la única superficie que entrega el grafo completo de una vez
// (su /rpc tiene allowlist: solo list_projects pasa), y nos ahorra leer y
// parsear un JSON de varios MB por repo.
interface LayoutNode {
  id: number;
  x: number;
  y: number;
  z: number;
  label?: string;
  name?: string;
  file_path?: string | null;
  qualified_name?: string;
}
interface LayoutEdge {
  source: number;
  target: number;
  type?: string;
}
interface LayoutPayload {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  total_nodes?: number;
}

const uiUrl = (path: string) => `http://127.0.0.1:${env.CBM_UI_PORT}${path}`;

/**
 * Comandos de ciclo de vida del daemon, con stdin CERRADO. Sin eso `--ui=true`
 * persiste el flag y se queda esperando en el stdio del servidor MCP: desde la
 * terminal parece instantáneo (hay TTY), desde el agente cuelga hasta el
 * timeout y el tab MEMORIA se caía a graphify sin decir por qué.
 */
function cbmControl(args: string[], timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(env.CBM_BIN, args, { stdio: "ignore", env: cbmEnv() });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve(false);
    }, timeoutMs);
    child.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
}

let daemonReady: Promise<boolean> | null = null;

/**
 * Deja el daemon con la UI escuchando. La UI se apaga sola cuando se va el
 * último cliente, así que se arranca "permanente" (`daemon start`) la primera
 * vez que alguien pide el grafo. Memoizado: un fallo se puede reintentar.
 */
async function ensureDaemon(): Promise<boolean> {
  const probe = async () => {
    try {
      const res = await fetch(uiUrl("/"), { signal: AbortSignal.timeout(1500) });
      return res.ok;
    } catch {
      return false;
    }
  };
  if (await probe()) return true;
  daemonReady ??= (async () => {
    if (!(await cbmControl(["--ui=true", `--port=${env.CBM_UI_PORT}`], 20_000))) return false;
    if (!(await cbmControl(["daemon", "start"], 60_000))) return false;
    // La UI calienta de forma asíncrona: hasta 6s de gracia.
    for (let i = 0; i < 12; i++) {
      if (await probe()) return true;
      await new Promise((r) => setTimeout(r, 500));
    }
    return false;
  })();
  const ok = await daemonReady;
  if (!ok) daemonReady = null; // no cachear el fallo: el siguiente intento vuelve a probar
  return ok;
}

/**
 * Grafo de un repo listo para el render 3D. Trae las posiciones YA calculadas
 * por el daemon (x/y/z), agrupa por paquete real y deja `available:false` —sin
 * lanzar— cuando el daemon no responde o el repo no está indexado.
 */
export async function cbmGraph3D(root: string, slug: string, maxNodes: number): Promise<CodeGraph3D> {
  const empty: CodeGraph3D = {
    available: false,
    project: slug,
    provider: "cbm",
    builtAtCommit: null,
    nodes: [],
    links: [],
    communities: {},
  };
  if (!(await ensureDaemon())) return empty;
  const project = cbmProject(root);
  let payload: LayoutPayload;
  try {
    const url = uiUrl(`/api/layout?project=${encodeURIComponent(project)}&max_nodes=${maxNodes}`);
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) {
      if (res.status !== 404) return empty;
      await indexRepo(root); // primera vez que se abre un repo nuevo en el tab
      const retry = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!retry.ok) return empty;
      payload = (await retry.json()) as LayoutPayload;
    } else {
      payload = (await res.json()) as LayoutPayload;
    }
  } catch {
    return empty;
  }
  if (!payload?.nodes?.length) return empty;

  // Comunidades = paquetes reales del repo, numerados por orden de aparición.
  const commId = new Map<string, number>();
  const communities: Record<string, string> = {};
  const idOf = (pkg: string) => {
    const known = commId.get(pkg);
    if (known !== undefined) return known;
    const id = commId.size;
    commId.set(pkg, id);
    communities[String(id)] = pkg;
    return id;
  };

  const index = new Map<number, number>();
  const degree = new Map<number, number>();
  for (const e of payload.edges ?? []) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }
  const nodes: CodeGraphNode[] = payload.nodes.map((n, i) => {
    index.set(n.id, i);
    return {
      id: n.qualified_name || String(n.id),
      label: n.name || n.qualified_name || String(n.id),
      kind: n.label ?? "code",
      community: idOf(topPackage(n.file_path)),
      degree: degree.get(n.id) ?? 0,
      file: n.file_path ?? null,
      x: n.x,
      y: n.y,
      z: n.z,
    };
  });
  const links: CodeGraphLink[] = [];
  for (const e of payload.edges ?? []) {
    const s = index.get(e.source);
    const t = index.get(e.target);
    if (s !== undefined && t !== undefined && s !== t) links.push({ s, t, relation: e.type ?? "" });
  }
  return { available: true, project: slug, provider: "cbm", builtAtCommit: null, nodes, links, communities };
}
