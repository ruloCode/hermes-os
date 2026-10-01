// Datos de los tableros de la pared de la Oficina (GET /office/boards): issues
// de Linear, PRs abiertos de GitHub y servicios de desarrollo que escuchan un
// puerto en ESTA máquina. La lógica de convertir cada salida es pura
// (packages/shared/src/office-boards.ts); aquí solo se corren los comandos,
// con caché y tiempo límite, y cada fuente falla por separado.
//
// Binarios por ruta absoluta (launchd no trae /opt/homebrew/bin en el PATH):
// GH_BIN y LSOF_BIN los cambian.

import { execFile } from "node:child_process";
import {
  boardIssues,
  githubRepoOf,
  isDevService,
  parseGhPrs,
  parseLsofListen,
  projectForPath,
  sortServices,
  type BoardPr,
  type BoardSection,
  type BoardService,
  type OfficeBoards,
} from "@hermes/shared";
import { env } from "../env.js";
import { linearEnabled } from "../linear.js";
import { linearBoard } from "../linear-run.js";
import { indexableRepos } from "../code-graph.js";

const GH_BIN = process.env.GH_BIN || "/opt/homebrew/bin/gh";
const LSOF_BIN = process.env.LSOF_BIN || "/usr/sbin/lsof";
const GIT_BIN = process.env.GIT_BIN || "git";
/** Puerto del dashboard (lo sirve otro proceso: aquí solo se reconoce). */
const WEB_PORT = Number(process.env.HERMES_WEB_PORT || 31415);

function run(bin: string, args: string[], opts: { cwd?: string; timeout?: number } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { cwd: opts.cwd, timeout: opts.timeout ?? 8000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      // lsof sale con 1 si algún pid no se pudo leer, pero igual imprime lo demás.
      if (err && !stdout) reject(new Error((stderr || err.message).trim().slice(0, 200)));
      else resolve(stdout);
    });
  });
}

/** Caché por fuente: issues y PRs cambian lento y cuestan red; los puertos, rápido. */
function cached<T>(ttlMs: number, load: () => Promise<T>) {
  let at = 0;
  let value: T | null = null;
  let inflight: Promise<T> | null = null;
  return (force = false): Promise<T> => {
    if (!force && value && Date.now() - at < ttlMs) return Promise.resolve(value);
    inflight ??= load()
      .then((v) => {
        value = v;
        at = Date.now();
        return v;
      })
      .finally(() => (inflight = null));
    return inflight;
  };
}

const issues = cached(30_000, async (): Promise<OfficeBoards["issues"]> => {
  if (!linearEnabled()) return { available: false, items: [] };
  try {
    return { available: true, items: boardIssues(await linearBoard()) };
  } catch (err) {
    return { available: true, items: [], error: `Linear no respondió: ${String((err as Error).message ?? err).slice(0, 160)}` };
  }
});

const prs = cached(60_000, async (): Promise<BoardSection<BoardPr>> => {
  const repos = await indexableRepos().catch(() => []);
  const errors: string[] = [];
  const lists = await Promise.all(
    repos.map(async (r) => {
      try {
        const repo = githubRepoOf(await run(GIT_BIN, ["remote", "get-url", "origin"], { cwd: r.root, timeout: 3000 }));
        if (!repo) return [];
        // --repo explícito: en un fork, gh sin él lista los PRs del upstream y la etiqueta mentiría.
        const out = await run(GH_BIN, ["pr", "list", "--repo", repo, "--state", "open", "--limit", "10", "--json", "number,title,author,url,isDraft,updatedAt"], { cwd: r.root });
        return parseGhPrs(out, repo, r.slug);
      } catch (err) {
        // Sin remote o sin `gh`: ese repo no aporta, pero el error de gh sí se cuenta.
        const msg = String((err as Error).message ?? err);
        if (!/No such remote|not a git repository/i.test(msg)) errors.push(`${r.slug}: ${msg.slice(0, 120)}`);
        return [];
      }
    }),
  );
  const items = lists.flat().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  // Si TODOS fallaron, el tablero no puede decir "no hay PRs": dice por qué.
  const allFailed = errors.length > 0 && errors.length === repos.length;
  return { available: true, items, ...(allFailed ? { error: `GitHub no respondió (${errors[0]})` } : {}) };
});

const services = cached(5_000, async (): Promise<BoardSection<BoardService>> => {
  let out: string;
  try {
    out = await run(LSOF_BIN, ["-nP", "-iTCP", "-sTCP:LISTEN", "-Fpcn"], { timeout: 5000 });
  } catch (err) {
    return { available: false, items: [], error: `lsof no está disponible: ${String((err as Error).message ?? err).slice(0, 120)}` };
  }
  const dev = parseLsofListen(out).filter(isDevService);
  // Carpeta de cada proceso → proyecto (un solo lsof para todos los pids).
  const cwdOf = new Map<number, string>();
  const pids = [...new Set(dev.map((s) => s.pid))];
  if (pids.length) {
    const cwd = await run(LSOF_BIN, ["-a", "-p", pids.join(","), "-d", "cwd", "-Fpn"], { timeout: 5000 }).catch(() => "");
    let pid = 0;
    for (const line of cwd.split("\n")) {
      if (line[0] === "p") pid = Number(line.slice(1));
      else if (line[0] === "n" && pid) cwdOf.set(pid, line.slice(1));
    }
  }
  const roots = await indexableRepos().catch(() => []);
  const items = dev.map((s): BoardService => {
    const dir = cwdOf.get(s.pid);
    const role = s.port === env.PORT ? "agente de Hermes" : s.port === WEB_PORT ? "dashboard de Hermes" : null;
    return {
      port: s.port,
      process: s.process,
      pid: s.pid,
      project: dir ? projectForPath(dir, roots) : null,
      role,
      url: `http://localhost:${s.port}`,
    };
  });
  return { available: true, items: sortServices(items) };
});

export async function officeBoards(force = false): Promise<OfficeBoards> {
  const [i, p, s] = await Promise.all([issues(force), prs(force), services(force)]);
  return { fetchedAt: new Date().toISOString(), issues: i, prs: p, services: s };
}
