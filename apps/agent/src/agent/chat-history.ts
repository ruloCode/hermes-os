/**
 * Historial de la consola leído DIRECTO de ~/.claude/projects/<cwd>/<id>.jsonl
 * — la misma fuente que usa Claude Code, así la consola y `claude` abierto en
 * Cursor dentro del mismo repo ven las MISMAS conversaciones.
 *
 * Reglas de parsing verificadas contra archivos reales (CLI 2.1.x):
 * - El nombre de carpeta codifica el cwd con todo carácter no alfanumérico → "-".
 * - sessionId == nombre del archivo; el resume appendea al MISMO jsonl.
 * - Título: última línea `ai-title` → última `last-prompt` → primer user real.
 * - Render: solo type user/assistant, sin isMeta/isSidechain, solo bloques de
 *   texto (nada de thinking/tool_use/tool_result), y se descartan los metas de
 *   slash-commands (empiezan con "<") y los "[Request interrupted…]".
 */
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import readline from "node:readline";
import type { ChatSessionDetail, ChatSessionMessage, ChatSessionSummary } from "@hermes/shared";
import { env } from "../env.js";
import { readProjects, resolveProjectRoot } from "../vault/projects.js";

const MAX_SESSIONS = 30;
const MAX_MESSAGES = 200;

/** Codifica un cwd absoluto al nombre de carpeta de ~/.claude/projects. */
export function encodeCwd(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, "-");
}

/**
 * Resuelve el cwd de las sesiones de la consola para un proyecto en foco: el
 * repo del proyecto EN ESTA MÁQUINA (resolveProjectRoot cubre el caso de un PC
 * donde los clones viven en otra carpeta); sin foco o sin repo → el vault.
 */
export async function resolveChatCwd(projectSlug?: string | null): Promise<string> {
  const fallback = env.VAULT_PATH || process.cwd();
  if (!projectSlug) return fallback;
  const project = (await readProjects()).find(
    (p) => p.slug.toLowerCase() === projectSlug.toLowerCase(),
  );
  if (!project) return fallback;
  return resolveProjectRoot(project) ?? fallback;
}

// ── Parsing de un jsonl de sesión ───────────────────────────────────────

interface ParsedSession {
  title: string;
  userCount: number;
  transcript: ChatSessionMessage[];
}

// Texto "humano" de un user record; null si es meta (slash-commands, tools…).
function userText(message: Record<string, unknown>): string | null {
  const content = message.content;
  let text = "";
  if (typeof content === "string") {
    text = content.trim();
  } else if (Array.isArray(content)) {
    text = content
      .filter(
        (b): b is { type: string; text: string } =>
          !!b && typeof b === "object" && (b as { type?: unknown }).type === "text",
      )
      .map((b) => b.text)
      .join("\n")
      .trim();
  }
  if (!text) return null;
  // Meta de slash-commands / caveats ("<command-name>…") e interrupciones.
  if (text.startsWith("<")) return null;
  if (text.startsWith("[Request interrupted")) return null;
  return text;
}

async function parseSession(filePath: string): Promise<ParsedSession> {
  let aiTitle = "";
  let lastPrompt = "";
  let firstUser = "";
  let userCount = 0;
  const transcript: ChatSessionMessage[] = [];
  // Cada línea assistant trae UN bloque; un turno son varias líneas con el
  // mismo message.id → los bloques de texto consecutivos se fusionan.
  let lastAssistantMsgId = "";

  const rl = readline.createInterface({
    input: createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line) continue;
    let rec: Record<string, any>;
    try {
      rec = JSON.parse(line);
    } catch {
      continue; // línea malformada/parcial
    }

    if (rec.type === "ai-title" && typeof rec.aiTitle === "string") {
      aiTitle = rec.aiTitle;
      continue;
    }
    if (rec.type === "last-prompt" && typeof rec.lastPrompt === "string") {
      lastPrompt = rec.lastPrompt;
      continue;
    }
    if (rec.type !== "user" && rec.type !== "assistant") continue;
    if (rec.isMeta === true || rec.isSidechain === true) continue;
    const message = rec.message as Record<string, unknown> | undefined;
    if (!message || typeof message !== "object") continue;

    if (rec.type === "user") {
      const text = userText(message);
      if (!text) continue;
      userCount += 1;
      if (!firstUser) firstUser = text;
      transcript.push({ role: "user", content: text });
      lastAssistantMsgId = "";
      continue;
    }

    // assistant: solo bloques de texto no vacíos.
    const content = message.content;
    if (!Array.isArray(content)) continue;
    const block = content[0] as { type?: string; text?: string } | undefined;
    if (!block || block.type !== "text" || !block.text?.trim()) continue;
    const msgId = typeof message.id === "string" ? message.id : "";
    const prev = transcript[transcript.length - 1];
    if (msgId && msgId === lastAssistantMsgId && prev?.role === "assistant") {
      if (!prev.content.includes(block.text)) prev.content += `\n\n${block.text}`;
    } else {
      transcript.push({ role: "assistant", content: block.text });
      lastAssistantMsgId = msgId;
    }
  }

  return {
    title: (aiTitle || lastPrompt || firstUser).slice(0, 120),
    userCount,
    transcript: transcript.slice(-MAX_MESSAGES),
  };
}

// Cache por archivo (mtime+size): listar/reabrir no reparsea lo que no cambió.
const cache = new Map<string, { mtimeMs: number; size: number; parsed: ParsedSession }>();

async function getParsed(filePath: string): Promise<ParsedSession & { mtimeMs: number }> {
  const st = await stat(filePath);
  const hit = cache.get(filePath);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) {
    return { ...hit.parsed, mtimeMs: st.mtimeMs };
  }
  const parsed = await parseSession(filePath);
  cache.set(filePath, { mtimeMs: st.mtimeMs, size: st.size, parsed });
  return { ...parsed, mtimeMs: st.mtimeMs };
}

// ── API pública ─────────────────────────────────────────────────────────

function sessionsDirFor(cwd: string): string {
  return join(homedir(), ".claude", "projects", encodeCwd(cwd));
}

/** Lista las sesiones de un cwd, de la más reciente a la más vieja. */
export async function listChatSessions(cwd: string): Promise<ChatSessionSummary[]> {
  const dir = sessionsDirFor(cwd);
  let names: string[];
  try {
    names = (await readdir(dir)).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return []; // el cwd no tiene sesiones todavía
  }

  // Ordena por mtime sin parsear, y parsea solo las más recientes.
  const stats = await Promise.all(
    names.map(async (name) => {
      try {
        const st = await stat(join(dir, name));
        return { name, mtimeMs: st.mtimeMs };
      } catch {
        return null;
      }
    }),
  );
  const recent = stats
    .filter((s): s is { name: string; mtimeMs: number } => s !== null)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, MAX_SESSIONS);

  const sessions: ChatSessionSummary[] = [];
  for (const { name, mtimeMs } of recent) {
    try {
      const parsed = await getParsed(join(dir, name));
      if (parsed.userCount === 0) continue; // sesión basura (p.ej. solo /login)
      sessions.push({
        id: name.replace(/\.jsonl$/, ""),
        title: parsed.title,
        updatedAt: new Date(mtimeMs).toISOString(),
        messages: parsed.transcript.length,
      });
    } catch {
      /* archivo ilegible: lo salteamos */
    }
  }
  return sessions;
}

/** Lee una sesión completa (mensajes de texto en orden) o null si no existe. */
export async function readChatSession(
  cwd: string,
  sessionId: string,
): Promise<ChatSessionDetail | null> {
  const safeId = sessionId.replace(/[^a-zA-Z0-9-]/g, "");
  if (!safeId) return null;
  const filePath = join(sessionsDirFor(cwd), `${safeId}.jsonl`);
  try {
    const parsed = await getParsed(filePath);
    return {
      id: safeId,
      title: parsed.title,
      updatedAt: new Date(parsed.mtimeMs).toISOString(),
      messages: parsed.transcript.length,
      transcript: parsed.transcript,
    };
  } catch {
    return null;
  }
}
