/**
 * Contexto del proyecto para el copiloto de juntas EN VIVO, armado de fuentes
 * LOCALES (el vault) — sin embeddings ni red. El RAG semántico (match_knowledge)
 * depende de OpenAI para los embeddings y, cuando falla (sin créditos, caída),
 * cae a un ILIKE sobre memorias que casi nunca trae nada del proyecto: el
 * copiloto quedaba soplando a ciegas justo en el proyecto que más historia
 * tiene. Lo que sí está siempre en disco:
 *
 * - la nota del proyecto: objetivo y stack (hasta "Estado Actual", que son
 *   bitácoras de runs y meten ruido), el briefing si existe, estado y tareas;
 * - las últimas actas del proyecto: de qué se habló, qué se decidió, qué quedó
 *   pendiente — la continuidad que un senior trae a la reunión.
 *
 * Se arma UNA vez al arrancar la junta (en paralelo con el STT) y lo usan los
 * motores rápidos y el loop estratégico.
 */
import matter from "gray-matter";
import { getMeeting, listMeetings } from "./store.js";
import { getProjectBriefing, getProjectNote, readProjects } from "../vault/projects.js";

const NOTE_MAX_CHARS = 1_800;
const RECENT_MEETINGS = 4;
const MEETING_SUMMARY_CHARS = 450;
const LOAD_TIMEOUT_MS = 4_000;

export interface MeetingContext {
  name?: string;
  briefing: string;
  /** Objetivo, stack y decisiones de la nota (sin la bitácora de Estado Actual). */
  projectNote: string;
  estadoActual?: string;
  tareas: string[];
  /** Últimas actas: fecha · título · resumen · accionables. */
  recentMeetings: string;
}

/** Cuerpo de la nota hasta "Estado Actual" (o el tope), sin frontmatter ni callouts. */
export function noteDigest(raw: string, max = NOTE_MAX_CHARS): string {
  const { content } = matter(raw);
  const cut = content.search(/^#{1,3}\s*.*Estado Actual/im);
  const body = (cut >= 0 ? content.slice(0, cut) : content)
    .split("\n")
    .filter((l) => !/^\s*>/.test(l)) // callouts de Hermes: bitácora, no contexto
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return body.length > max ? `${body.slice(0, max).trimEnd()}…` : body;
}

async function recentMeetingsBlock(slug: string): Promise<string> {
  const list = (await listMeetings(slug)).slice(0, RECENT_MEETINGS);
  const details = await Promise.all(list.map((m) => getMeeting(slug, m.id).catch(() => null)));
  return details
    .filter((m): m is NonNullable<typeof m> => !!m)
    .map((m) => {
      const day = m.fecha.slice(0, 10);
      const summary = m.summary.replace(/\s+/g, " ").trim();
      const acc = m.actionables.map((a) => a.title).join("; ");
      return `- ${day} · ${m.title}: ${summary.slice(0, MEETING_SUMMARY_CHARS)}${summary.length > MEETING_SUMMARY_CHARS ? "…" : ""}${acc ? ` Accionables: ${acc}.` : ""}`;
    })
    .join("\n");
}

function withTimeout<T>(p: Promise<T>, fallback: T): Promise<T> {
  return Promise.race([
    p.catch(() => fallback),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), LOAD_TIMEOUT_MS).unref()),
  ]);
}

/** Contexto local del proyecto; cada pieza degrada sola (nunca lanza). */
export async function loadMeetingContext(slug: string): Promise<MeetingContext> {
  const [projects, briefing, note, recentMeetings] = await Promise.all([
    withTimeout(readProjects(), []),
    withTimeout(getProjectBriefing(slug), ""),
    withTimeout(getProjectNote(slug), null),
    withTimeout(recentMeetingsBlock(slug), ""),
  ]);
  const project = projects.find((p) => p.slug.toLowerCase() === slug.toLowerCase());
  return {
    name: project?.name,
    briefing,
    projectNote: note ? noteDigest(note.raw) : "",
    estadoActual: project?.estado_actual,
    tareas: project?.tareas_pendientes ?? [],
    recentMeetings,
  };
}

/** "Estado Actual" sin la sintaxis de callouts de Obsidian (> [!note] Hermes · fecha). */
export function cleanEstado(estado: string | undefined, max = 700): string {
  if (!estado) return "";
  const text = estado
    .split("\n")
    .map((l) => l.replace(/^(\s*>\s*)+/, "").trim())
    .filter((l) => l && !/^\[!\w+\]/.test(l))
    .join("\n")
    .trim();
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

/** Bloques de prompt del contexto (los vacíos se omiten). */
export function meetingContextBlocks(c: MeetingContext, knowledge?: string): string[] {
  return [
    c.projectNote ? `## El proyecto\n${c.projectNote}` : "",
    c.briefing.trim() ? `## Briefing del proyecto\n${c.briefing.trim()}` : "",
    cleanEstado(c.estadoActual) ? `## Estado actual\n${cleanEstado(c.estadoActual)}` : "",
    c.tareas.length ? `## Tareas pendientes\n${c.tareas.slice(0, 8).map((t) => `- ${t}`).join("\n")}` : "",
    c.recentMeetings
      ? `## Reuniones anteriores de este proyecto (lo que ya se habló y decidió)\n${c.recentMeetings}`
      : "",
    knowledge?.trim() ? `## Historial de Hermes sobre el tema\n${knowledge.trim()}` : "",
  ].filter(Boolean);
}
