// Tableros de la pared de la Oficina (puro: sin fs, red ni procesos). Tres
// fuentes reales, una por tablero:
//   · Issues   → Linear (la verdad de las tareas de Hermes), en tres columnas.
//   · PRs      → `gh pr list` en cada repo de los proyectos activos.
//   · Servicios → los procesos de desarrollo que están escuchando un puerto
//     (`lsof`), con el proyecto al que pertenecen según su carpeta.
// El agente corre los comandos y estas funciones convierten su salida. Si una
// fuente falla, su tablero lo dice (`error`) en vez de mostrarse vacío como si
// no hubiera nada.

export type IssueColumn = "todo" | "doing" | "done";

export interface BoardIssueItem {
  /** Identificador de Linear (RUL-12). */
  id: string;
  title: string;
  /** Nombre del estado tal como está en Linear ("In Progress"). */
  state: string;
  column: IssueColumn;
  project: string | null;
  url: string;
  priority: number;
  /** Trae bloque "Copy prompt": listo para que lo ejecute un agente. */
  ready: boolean;
  updatedAt: string;
}

export interface BoardPr {
  repo: string;
  /** Slug del proyecto del vault (o el del propio Hermes). */
  project: string;
  number: number;
  title: string;
  author: string;
  url: string;
  draft: boolean;
  updatedAt: string;
}

export interface BoardService {
  port: number;
  /** Nombre del proceso tal como lo da lsof (truncado a 9 letras por el sistema). */
  process: string;
  pid: number;
  /** Proyecto dueño de la carpeta donde corre el proceso, si se sabe. */
  project: string | null;
  /** Qué es, cuando es parte del propio Hermes (agente, dashboard). */
  role: string | null;
  url: string;
}

export interface BoardSection<T> {
  /** false = la fuente no está configurada en esta máquina (no es lo mismo que vacía). */
  available: boolean;
  items: T[];
  error?: string;
}

export interface OfficeBoards {
  fetchedAt: string;
  issues: BoardSection<BoardIssueItem>;
  prs: BoardSection<BoardPr>;
  services: BoardSection<BoardService>;
}

export type OfficeBoardId = "issues" | "prs" | "services";

export const OFFICE_BOARD_TITLES: Record<OfficeBoardId, string> = {
  issues: "Issues",
  prs: "Pull requests",
  services: "Servicios",
};

export function isOfficeBoardId(v: unknown): v is OfficeBoardId {
  return v === "issues" || v === "prs" || v === "services";
}

/** Columna de un issue según el tipo de estado de Linear. Cancelados: fuera del tablero. */
export function issueColumn(stateType: string): IssueColumn | null {
  if (stateType === "started") return "doing";
  if (stateType === "completed") return "done";
  if (stateType === "canceled") return null;
  return "todo"; // backlog, unstarted, triage
}

/** Lo que interesa de un issue de Linear (forma de `linearBoard()` del agente). */
export interface LinearIssueLike {
  identifier: string;
  title: string;
  url: string;
  priority: number;
  updatedAt: string;
  state: { name: string; type: string };
  project: { name: string } | null;
  hasPrompt?: boolean;
}

/** Issues de Linear → notas del tablero: las de cada columna, más recientes primero. */
export function boardIssues(issues: readonly LinearIssueLike[]): BoardIssueItem[] {
  const out: BoardIssueItem[] = [];
  for (const i of issues) {
    const column = issueColumn(i.state.type);
    if (!column) continue;
    out.push({
      id: i.identifier,
      title: i.title,
      state: i.state.name,
      column,
      project: i.project?.name ?? null,
      url: i.url,
      priority: i.priority,
      ready: !!i.hasPrompt,
      updatedAt: i.updatedAt,
    });
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Salida JSON de `gh pr list --json number,title,author,url,isDraft,updatedAt` → PRs del tablero. */
export function parseGhPrs(json: string, repo: string, project: string): BoardPr[] {
  let rows: unknown;
  try {
    rows = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(rows)) return [];
  const out: BoardPr[] = [];
  for (const r of rows as Record<string, unknown>[]) {
    if (typeof r?.number !== "number" || typeof r.title !== "string" || typeof r.url !== "string") continue;
    const author = (r.author as { login?: string } | undefined)?.login ?? "";
    out.push({
      repo,
      project,
      number: r.number,
      title: r.title,
      author,
      url: r.url,
      draft: r.isDraft === true,
      updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : "",
    });
  }
  return out;
}

/** "owner/repo" de una URL de remote de GitHub (https o ssh); null si no es GitHub. */
export function githubRepoOf(remote: string): string | null {
  const m = remote.trim().match(/github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

export interface ListeningSocket {
  pid: number;
  process: string;
  host: string;
  port: number;
}

/**
 * Salida de `lsof -nP -iTCP -sTCP:LISTEN -Fpcn` (una línea por campo: `p`
 * pid, `c` comando, `f` descriptor, `n` dirección) → sockets que escuchan,
 * sin repetir (pid, puerto): IPv4 e IPv6 del mismo servidor cuentan una vez.
 */
export function parseLsofListen(out: string): ListeningSocket[] {
  const seen = new Set<string>();
  const list: ListeningSocket[] = [];
  let pid = 0;
  let proc = "";
  for (const line of out.split("\n")) {
    const tag = line[0];
    const val = line.slice(1);
    if (tag === "p") pid = Number(val);
    else if (tag === "c") proc = val;
    else if (tag === "n") {
      const m = val.match(/^(.*):(\d+)$/);
      if (!m || !pid) continue;
      const port = Number(m[2]);
      const key = `${pid}:${port}`;
      if (seen.has(key)) continue;
      seen.add(key);
      list.push({ pid, process: proc, host: m[1], port });
    }
  }
  return list;
}

/** Procesos de desarrollo (lsof trunca el comando a 9 letras: "next-serv"). */
const DEV_PROCESSES = /^(node|bun|deno|python\d?(\.\d+)?|Python|ruby|java|php|go|uvicorn|gunicorn|vite|next-serv|astro|rails|cargo|dotnet|esbuild|tsx|uv)$/;

/**
 * ¿Es un servidor de desarrollo? Un proceso de los de arriba en un puerto
 * registrado (< 49152): los puertos altos son efímeros (inspectores, IPC).
 */
export function isDevService(s: ListeningSocket): boolean {
  return DEV_PROCESSES.test(s.process) && s.port > 0 && s.port < 49152;
}

/** El proyecto dueño de `cwd`: la raíz más larga que la contiene (un repo dentro de otro gana el de adentro). */
export function projectForPath(cwd: string, roots: readonly { slug: string; root: string }[]): string | null {
  let best: { slug: string; len: number } | null = null;
  for (const r of roots) {
    const root = r.root.replace(/\/+$/, "");
    if (cwd !== root && !cwd.startsWith(`${root}/`)) continue;
    if (!best || root.length > best.len) best = { slug: r.slug, len: root.length };
  }
  return best?.slug ?? null;
}

/** Ordena para el tablero: primero lo de Hermes y los proyectos conocidos, luego por puerto. */
export function sortServices(items: BoardService[]): BoardService[] {
  return items.slice().sort((a, b) => Number(!!b.role) - Number(!!a.role) || Number(!!b.project) - Number(!!a.project) || a.port - b.port);
}
