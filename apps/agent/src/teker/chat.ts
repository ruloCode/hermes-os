import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { env } from "../env.js";
import { askTekerIa, patientDataIn, type TekerModel, type TekerTurn } from "./ia.js";
import type { CloudAgentSummary, CloudChat } from "../cloud/managed.js";

/**
 * TeKer IA como integrante del Equipo de Hermes Phone. El teléfono pinta lo
 * que devuelve /cloud/agents y conversa por /cloud/agents/:id/chat, así que
 * TeKer IA entra por esas mismas rutas con la forma de un agente de la nube:
 * cero cambios en el APK.
 *
 * El hilo vive en ~/.hermes-os/teker/chat.json (la API no guarda historial).
 * Mandar no espera la respuesta (puede tardar 3 min): el teléfono ve
 * `running` y sondea cada 2 s hasta que llega.
 */

export const TEKER_MEMBER_ID = "teker-ia";

const DIR = join(homedir(), ".hermes-os", "teker");
const FILE = join(DIR, "chat.json");
/** Turnos anteriores que viajan como contexto de un seguimiento. */
const HISTORY_TURNS = 6;

interface Line {
  id: string;
  role: "user" | "agent";
  text: string;
  at: string;
  /** Las respuestas de error no viajan como contexto. */
  failed?: boolean;
}

let lines: Line[] | null = null;
let busy = false;

async function load(): Promise<Line[]> {
  if (lines) return lines;
  const raw = await readFile(FILE, "utf8").catch(() => "");
  try {
    const parsed = JSON.parse(raw);
    lines = Array.isArray(parsed) ? parsed : [];
  } catch {
    lines = [];
  }
  return lines!;
}

async function save(): Promise<void> {
  await mkdir(DIR, { recursive: true });
  await writeFile(FILE, JSON.stringify((lines ?? []).slice(-200), null, 1));
}

export const tekerEnabled = () => Boolean(env.TEKER_IA_API_KEY.trim());

/** Desarrollo solo si se pide con todas las letras. */
export function wantsDev(text: string): boolean {
  return /\bteker_ia_dev\b/i.test(text) || /^\s*dev\s*[:·-]/i.test(text);
}

/** Los turnos anteriores que salieron bien, en formato OpenAI. */
export function historyOf(all: Line[], turns = HISTORY_TURNS): TekerTurn[] {
  const out: TekerTurn[] = [];
  for (let i = 0; i < all.length - 1; i++) {
    const q = all[i];
    const a = all[i + 1];
    if (q.role === "user" && a.role === "agent" && !a.failed) {
      out.push({ role: "user", content: q.text }, { role: "assistant", content: a.text });
    }
  }
  return out.slice(-turns * 2);
}

export async function tekerSummary(): Promise<CloudAgentSummary> {
  const all = await load();
  const lastAgent = all.filter((l) => l.role === "agent").at(-1);
  return {
    id: TEKER_MEMBER_ID,
    name: "TeKer IA",
    description: "Cifras de citas de TeKer, preguntas sobre TeKer, correos y búsquedas. No maneja datos de pacientes.",
    model: "asistente_operacion",
    status: busy ? "running" : all.length ? "idle" : "none",
    preview: lastAgent?.text.split("\n").find((l) => l.trim())?.slice(0, 160) ?? null,
    updated_at: all.at(-1)?.at ?? null,
    cost_usd: 0,
    next_run_at: null,
  };
}

export async function tekerChat(): Promise<CloudChat> {
  const all = await load();
  return {
    agent_id: TEKER_MEMBER_ID,
    session_id: all.length ? "local" : null,
    status: busy ? "running" : all.length ? "idle" : "none",
    messages: all.map(({ id, role, text, at }) => ({ id, role, text, at })),
    steps: busy ? [{ id: "ask", text: "Preguntando a TeKer IA…", at: null }] : [],
    cost_usd: 0,
    url: null,
  };
}

/** Anota la pregunta y responde en segundo plano. */
export async function tekerSend(text: string): Promise<{ session_id: string }> {
  if (busy) throw new Error("TeKer IA todavía está respondiendo la pregunta anterior.");
  const all = await load();
  const history = historyOf(all);
  all.push({ id: randomUUID(), role: "user", text, at: new Date().toISOString() });
  // Un dato de paciente no sale de la Mac: se contesta aquí mismo, sin reintento.
  const pii = patientDataIn(text);
  if (pii) {
    all.push({ id: randomUUID(), role: "agent", text: `La pregunta trae ${pii}. TeKer IA no maneja datos de pacientes: pregunta en general, sin el dato.`, at: new Date().toISOString(), failed: true });
    await save();
    return { session_id: "local" };
  }
  busy = true;
  await save();
  const model: TekerModel = wantsDev(text) ? "teker_ia_dev" : "asistente_operacion";
  void askTekerIa(text, model, history)
    .then((r) => {
      all.push(
        r.ok
          ? {
              id: randomUUID(),
              role: "agent",
              text: r.model === "teker_ia_dev" ? `[teker_ia_dev · desarrollo: cifras NO reales]\n\n${r.text}` : r.text,
              at: new Date().toISOString(),
            }
          : { id: randomUUID(), role: "agent", text: `TeKer IA no respondió: ${r.error}. Reintenta en un minuto.`, at: new Date().toISOString(), failed: true },
      );
    })
    .finally(() => {
      busy = false;
      save().catch((err) => console.error("[teker] guardar chat:", err));
    });
  return { session_id: "local" };
}

export async function tekerNewChat(): Promise<void> {
  if (busy) throw new Error("Espera a que TeKer IA termine de responder.");
  lines = [];
  await save();
}
