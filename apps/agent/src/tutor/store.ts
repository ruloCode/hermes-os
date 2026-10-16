/**
 * Conversaciones del tutor de proyecto, en disco LOCAL
 * (~/.hermes-os/tutor/<proyecto>/<id>.json). No van a Supabase a propósito:
 * hablan de código y actas de clientes, y el lugar más privado es la máquina
 * donde ya viven esos repos.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  TutorConversation,
  TutorConversationSummary,
  TutorMessage,
} from "@hermes/shared";

const ROOT = process.env.HERMES_TUTOR_DIR || join(homedir(), ".hermes-os", "tutor");
const SAFE = /^[a-z0-9][a-z0-9._-]*$/i;

function dirOf(project: string): string {
  if (!SAFE.test(project)) throw new Error("proyecto inválido");
  return join(ROOT, project);
}

function pathOf(project: string, id: string): string {
  if (!SAFE.test(id)) throw new Error("conversación inválida");
  return join(dirOf(project), `${id}.json`);
}

function summary(c: TutorConversation): TutorConversationSummary {
  return {
    id: c.id,
    project: c.project,
    title: c.title,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    messages: c.history.length,
  };
}

export async function listConversations(project: string): Promise<TutorConversationSummary[]> {
  let files: string[] = [];
  try {
    files = (await readdir(dirOf(project))).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const out: TutorConversationSummary[] = [];
  for (const f of files) {
    try {
      out.push(summary(JSON.parse(await readFile(join(dirOf(project), f), "utf8"))));
    } catch {
      /* archivo corrupto: se saltea */
    }
  }
  return out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export async function getConversation(
  project: string,
  id: string,
): Promise<TutorConversation | null> {
  try {
    return JSON.parse(await readFile(pathOf(project, id), "utf8")) as TutorConversation;
  } catch {
    return null;
  }
}

/** Título = la primera pregunta, recortada (se puede leer en la lista). */
function titleFrom(message: string): string {
  const t = message.replace(/\s+/g, " ").trim();
  return t.length > 70 ? `${t.slice(0, 68).trimEnd()}…` : t;
}

export async function createConversation(
  project: string,
  firstMessage: string,
): Promise<TutorConversation> {
  const now = new Date().toISOString();
  const c: TutorConversation = {
    id: randomUUID().slice(0, 8),
    project,
    title: titleFrom(firstMessage),
    createdAt: now,
    updatedAt: now,
    messages: 0,
    history: [],
  };
  await saveConversation(c);
  return c;
}

export async function saveConversation(c: TutorConversation): Promise<void> {
  await mkdir(dirOf(c.project), { recursive: true });
  c.messages = c.history.length;
  await writeFile(pathOf(c.project, c.id), JSON.stringify(c, null, 2), "utf8");
}

export async function appendMessage(c: TutorConversation, m: TutorMessage): Promise<void> {
  c.history.push(m);
  c.updatedAt = m.at;
  await saveConversation(c);
}

export async function deleteConversation(project: string, id: string): Promise<boolean> {
  try {
    await unlink(pathOf(project, id));
    return true;
  } catch {
    return false;
  }
}
