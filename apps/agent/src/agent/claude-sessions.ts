/**
 * Persistencia de las sesiones de Claude Code (CLI) por proyecto.
 *
 * Cada sesión = una conversación resumible de `claude -p` (identificada por el
 * uuid que le pasamos con --session-id). Guardamos metadata + el transcript
 * (las líneas que ya mostramos en vivo) en <repo>/.data/claude-sessions/
 * <proyecto>/<id>.json, para poder listarlas, reabrirlas y resumirlas.
 *
 * Funciona sin Supabase (igual que conversations.ts). El resume real lo hace
 * el CLI vía `claude --resume <sdkSessionId>` en el mismo cwd del proyecto.
 */
import { readFile, writeFile, mkdir, readdir, unlink, rename } from "node:fs/promises";
import { join } from "node:path";
import { REPO_ROOT } from "../env.js";
import type {
  ClaudeSessionDetail,
  ClaudeSessionLine,
  ClaudeSessionSummary,
} from "@hermes/shared";

const DIR = join(REPO_ROOT, ".data", "claude-sessions");
const MAX_LINES = 2000;
const MAX_SESSIONS = 60;

function safe(s: string): string {
  return (s || "general").toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 80) || "general";
}
function dirFor(project: string): string {
  return join(DIR, safe(project));
}
function fileFor(project: string, id: string): string {
  return join(dirFor(project), `${safe(id)}.json`);
}

// Serializa las escrituras para no perder líneas por carreras de lectura-modif.
let writeChain: Promise<unknown> = Promise.resolve();
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeChain.then(fn, fn);
  writeChain = next.catch(() => {});
  return next;
}

async function readDetail(project: string, id: string): Promise<ClaudeSessionDetail | null> {
  try {
    const raw = await readFile(fileFor(project, id), "utf8");
    const d = JSON.parse(raw) as ClaudeSessionDetail;
    return d && typeof d.id === "string" ? d : null;
  } catch {
    return null;
  }
}

async function writeDetail(detail: ClaudeSessionDetail): Promise<void> {
  await mkdir(dirFor(detail.projectSlug), { recursive: true });
  const file = fileFor(detail.projectSlug, detail.id);
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(detail), "utf8");
  await rename(tmp, file); // atómico
}

const toSummary = (d: ClaudeSessionDetail): ClaudeSessionSummary => ({
  id: d.id,
  projectSlug: d.projectSlug,
  title: d.title,
  model: d.model,
  status: d.status,
  createdAt: d.createdAt,
  updatedAt: d.updatedAt,
  lineCount: d.lines?.length ?? 0,
});

export async function listClaudeSessions(project: string): Promise<ClaudeSessionSummary[]> {
  let files: string[] = [];
  try {
    files = (await readdir(dirFor(project))).filter((f) => f.endsWith(".json") && !f.endsWith(".tmp.json"));
  } catch {
    return [];
  }
  const out: ClaudeSessionSummary[] = [];
  for (const f of files) {
    const d = await readDetail(project, f.replace(/\.json$/, ""));
    if (d) out.push(toSummary(d));
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getClaudeSession(project: string, id: string): Promise<ClaudeSessionDetail | null> {
  return readDetail(project, id);
}

export async function deleteClaudeSession(project: string, id: string): Promise<void> {
  await enqueue(async () => {
    try {
      await unlink(fileFor(project, id));
    } catch {
      /* no existía */
    }
  });
}

// Evicta las sesiones más viejas de un proyecto si se pasa del tope.
async function evictOld(project: string): Promise<void> {
  const all = await listClaudeSessions(project);
  if (all.length <= MAX_SESSIONS) return;
  for (const s of all.slice(MAX_SESSIONS)) {
    try {
      await unlink(fileFor(project, s.id));
    } catch {
      /* ya no está */
    }
  }
}

/**
 * Crea o toca una sesión al iniciar una corrida. Para una sesión nueva fija
 * createdAt/title; para un resume conserva lo previo y solo marca running.
 */
export function startSession(meta: {
  id: string;
  projectSlug: string;
  title: string;
  model: string;
  effort: string;
  permissionMode: string;
  cwd: string;
  sdkSessionId: string;
  isResume: boolean;
}): Promise<void> {
  return enqueue(async () => {
    const now = new Date().toISOString();
    const prev = await readDetail(meta.projectSlug, meta.id);
    const detail: ClaudeSessionDetail = {
      id: meta.id,
      projectSlug: meta.projectSlug,
      title: prev?.title || meta.title || "Nueva sesión",
      model: meta.model,
      effort: meta.effort,
      permissionMode: meta.permissionMode,
      cwd: meta.cwd,
      sdkSessionId: prev?.sdkSessionId || meta.sdkSessionId,
      status: "running",
      createdAt: prev?.createdAt || now,
      updatedAt: now,
      lines: prev?.lines ?? [],
    };
    await writeDetail(detail);
    if (!meta.isResume && !prev) await evictOld(meta.projectSlug);
  });
}

/**
 * Cierra una corrida: agrega las líneas nuevas al transcript, actualiza el
 * estado final y, si el CLI reportó otro session_id (fork), lo adopta para el
 * próximo resume.
 */
export function finishSession(args: {
  id: string;
  projectSlug: string;
  newLines: ClaudeSessionLine[];
  status: "done" | "error";
  sdkSessionId?: string;
}): Promise<void> {
  return enqueue(async () => {
    const now = new Date().toISOString();
    const prev = await readDetail(args.projectSlug, args.id);
    if (!prev) return; // se borró mientras corría
    const lines = [...prev.lines, ...args.newLines].slice(-MAX_LINES);
    await writeDetail({
      ...prev,
      status: args.status,
      updatedAt: now,
      sdkSessionId: args.sdkSessionId || prev.sdkSessionId,
      lines,
    });
  });
}
