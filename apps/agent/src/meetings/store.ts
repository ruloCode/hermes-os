/**
 * Storage de reuniones. Fuente de verdad: markdown en el vault
 * (projects/<slug>/reuniones/<id>.md). Espejo best-effort en Supabase
 * (meetings + meeting_actionables) para búsqueda semántica e historial/estado
 * accesible desde otra Mac. Reusa el parser del vault y el patrón idempotente
 * (local_key sha1) del historial de conversaciones.
 */
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import matter from "gray-matter";
import type {
  LiveSuggestion,
  Meeting,
  MeetingActionable,
  MeetingCoach,
  MeetingSource,
  MeetingSummary,
} from "@hermes/shared";
import { env } from "../env.js";
import { supabase } from "../supabase.js";
import { embed } from "../embeddings.js";
import { safeName } from "../conversations.js";
import { extractSection, readProjects } from "../vault/projects.js";
import { tasksForMeeting } from "../tasks/store.js";

/** Fragmento estructurado que produce el pipeline de ingest para persistir. */
export interface MeetingDraft {
  projectSlug: string;
  title: string;
  fecha: Date;
  summary: string;
  transcript: string;
  actionables: { title: string; one_liner: string; exec_prompt: string }[];
  source: MeetingSource;
  sttProvider?: string | null;
  durationSec?: number | null;
  participants?: string[];
  /** sugerencias del copiloto (solo juntas EN VIVO): sección propia en el .md. */
  liveSuggestions?: LiveSuggestion[];
  /** coach de la junta EN VIVO (métricas reales + evaluación si hubo selfSpeaker). */
  coach?: MeetingCoach;
}

// ── Helpers de ruta / id / idempotencia ────────────────────────────────

/** El slug real (nombre de carpeta) del proyecto; case-insensitive. */
async function realSlug(slug: string): Promise<string> {
  const p = (await readProjects()).find((x) => x.slug.toLowerCase() === slug.toLowerCase());
  return p?.slug ?? slug;
}

function meetingsDir(realProjectSlug: string): string {
  return join(env.VAULT_PATH, "projects", realProjectSlug, "reuniones");
}

/** id de reunión = 2026-07-07-1830-titulo (nombre del archivo sin .md). */
function makeMeetingId(fecha: Date, title: string): string {
  const iso = fecha.toISOString();
  const day = iso.slice(0, 10);
  const hm = iso.slice(11, 16).replace(":", "");
  const tslug =
    title
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "reunion";
  return `${day}-${hm}-${tslug}`;
}

function meetingLocalKey(slug: string, meetingId: string): string {
  return createHash("sha1").update(`${safeName(slug)}|${meetingId}`).digest("hex");
}

function toIso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return v ? String(v) : "";
}

/** mm:ss del momento de la junta en que se sopló una sugerencia. */
function fmtAtMs(atMs: number): string {
  const total = Math.max(0, Math.floor(atMs / 1000));
  const mm = String(Math.floor(total / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

/** Sección ## Coach del .md: métricas reales + evaluación (si la hubo). */
function renderCoachBlock(coach: MeetingCoach): string {
  const totalMs = Object.values(coach.metrics.bySpeaker).reduce((a, s) => a + s.talkMs, 0);
  const lines = Object.entries(coach.metrics.bySpeaker)
    .sort(([, a], [, b]) => b.talkMs - a.talkMs)
    .map(([label, s]) => {
      const pct = totalMs > 0 ? Math.round((s.talkMs / totalMs) * 100) : 0;
      const self = label === coach.metrics.selfSpeaker ? " (yo)" : "";
      return `- **${label}${self}**: ${pct}% del tiempo · ${s.wpm} wpm · ${s.fillers} muletillas`;
    });
  const perf = coach.performance
    ? `
**Desempeño: ${coach.performance.score}/10**
${coach.performance.highlights.map((h) => `- ✓ ${h}`).join("\n")}
${coach.performance.improvements.map((i) => `- △ ${i}`).join("\n")}
`
    : "";
  return `## Coach
${lines.join("\n")}
${perf}
`;
}

function summaryFromFrontmatter(
  id: string,
  slug: string,
  data: Record<string, unknown>,
): MeetingSummary {
  const acc = Array.isArray(data.accionables) ? data.accionables.length : 0;
  const fuente = String(data.fuente ?? "upload");
  return {
    id,
    project_slug: slug,
    title: String(data.titulo ?? data.title ?? id),
    fecha: toIso(data.fecha),
    source: (["audio", "upload", "paste", "live"].includes(fuente)
      ? fuente
      : "upload") as MeetingSource,
    stt_provider: data.stt ? String(data.stt) : null,
    duracion_min: typeof data.duracion_min === "number" ? data.duracion_min : null,
    accionables_count: acc,
  };
}

// ── Escritura: archivo de reunión + accionables a Tareas Pendientes ────

/**
 * Escribe la reunión como markdown en el vault, anexa los 2 accionables a
 * "Tareas Pendientes" de la nota del proyecto y espeja a Supabase. Devuelve la
 * reunión completa (con ids de accionables).
 */
export async function saveMeeting(draft: MeetingDraft): Promise<Meeting> {
  const slug = await realSlug(draft.projectSlug);
  const id = makeMeetingId(draft.fecha, draft.title);
  const dir = meetingsDir(slug);
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${id}.md`);

  const actionables: MeetingActionable[] = draft.actionables.slice(0, 2).map((a, idx) => ({
    id: `${id}#${idx}`,
    idx,
    title: a.title,
    one_liner: a.one_liner,
    exec_prompt: a.exec_prompt,
    taskId: null, // se decide en el triage
  }));

  const duracion_min = draft.durationSec != null ? Math.round(draft.durationSec / 60) : null;
  const liveSuggestions = draft.liveSuggestions ?? [];
  const frontmatter = {
    tipo: "reunion",
    proyecto: slug,
    titulo: draft.title,
    fecha: draft.fecha.toISOString(),
    fuente: draft.source,
    stt: draft.sttProvider ?? null,
    duracion_min,
    participantes: draft.participants ?? [],
    tags: ["reunion"],
    // Estructurado para leer los accionables de vuelta sin re-parsear el cuerpo.
    accionables: actionables.map((a) => ({
      title: a.title,
      one_liner: a.one_liner,
      exec_prompt: a.exec_prompt,
    })),
    // Solo las juntas EN VIVO llevan el conteo (regla: sin fuente, sin campo).
    ...(liveSuggestions.length ? { sugerencias_vivo: liveSuggestions.length } : {}),
    // Coach estructurado (leerlo de vuelta sin re-parsear el cuerpo).
    ...(draft.coach ? { coach: draft.coach } : {}),
  };

  // Lo que el copiloto sopló durante la junta, con su minuto (mm:ss): queda
  // entre Accionables y Transcripción para leerse como cronología del acta.
  const suggestionsBlock = liveSuggestions.length
    ? `## Sugerencias en vivo
${liveSuggestions
  .map((sg) => `- **[${sg.kind} · ${fmtAtMs(sg.atMs)}]** ${sg.text} — _${sg.why}_`)
  .join("\n")}

`
    : "";

  const coachBlock = draft.coach ? renderCoachBlock(draft.coach) : "";

  const body = `# ${draft.title}

## Resumen
${draft.summary.trim()}

## Accionables
${actionables.map((a) => `- [ ] ${a.title} — ${a.one_liner}`).join("\n")}

${suggestionsBlock}${coachBlock}## Transcripción
${draft.transcript.trim()}
`;
  await writeFile(path, matter.stringify(body, frontmatter), "utf8");

  // Los accionables NO se anexan al vault aquí: se decide en el triage (cada uno
  // → ejecutar / pendiente / ignorar), que crea la tarea y su espejo si aplica.
  const meeting: Meeting = {
    ...summaryFromFrontmatter(id, slug, frontmatter as unknown as Record<string, unknown>),
    summary: draft.summary,
    transcript: draft.transcript,
    actionables,
    participantes: draft.participants,
    vault_path: path,
    coach: draft.coach,
  };

  void mirrorMeeting(meeting, draft.durationSec ?? null);
  return meeting;
}

// ── Lectura ────────────────────────────────────────────────────────────

/** Historial de reuniones de un proyecto, de la más reciente a la más vieja. */
export async function listMeetings(slugIn: string): Promise<MeetingSummary[]> {
  const slug = await realSlug(slugIn);
  let files: string[];
  try {
    files = (await readdir(meetingsDir(slug))).filter((f) => f.endsWith(".md"));
  } catch {
    return []; // sin reuniones todavía
  }
  const out: MeetingSummary[] = [];
  for (const f of files) {
    try {
      const { data } = matter(await readFile(join(meetingsDir(slug), f), "utf8"));
      out.push(summaryFromFrontmatter(f.replace(/\.md$/, ""), slug, data));
    } catch {
      /* archivo corrupto: lo salteamos */
    }
  }
  return out.sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
}

/** Detalle de una reunión (resumen + accionables + transcripción). */
export async function getMeeting(slugIn: string, id: string): Promise<Meeting | null> {
  const slug = await realSlug(slugIn);
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safeId) return null;
  const path = join(meetingsDir(slug), `${safeId}.md`);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return null;
  }
  const { data, content } = matter(raw);
  const summary = extractSection(content, /^#{1,3}\s*.*Resumen/i);
  const transcript = extractSection(content, /^#{1,3}\s*.*Transcripci/i);
  const fm = Array.isArray(data.accionables) ? (data.accionables as Record<string, unknown>[]) : [];
  let actionables: MeetingActionable[] = fm.slice(0, 2).map((a, idx) => ({
    id: `${safeId}#${idx}`,
    idx,
    title: String(a.title ?? ""),
    one_liner: String(a.one_liner ?? ""),
    exec_prompt: String(a.exec_prompt ?? a.title ?? ""),
    taskId: null,
  }));
  actionables = await overlayTaskState(safeId, actionables);
  return {
    ...summaryFromFrontmatter(safeId, slug, data),
    summary,
    transcript,
    actionables,
    participantes: Array.isArray(data.participantes) ? data.participantes.map(String) : undefined,
    vault_path: path,
    coach:
      data.coach && typeof data.coach === "object" ? (data.coach as Meeting["coach"]) : undefined,
  };
}

// ── Exportación (descargas del detalle de reunión) ─────────────────────

/**
 * El .md crudo del vault: el acta COMPLETA (resumen, accionables, sugerencias
 * en vivo, coach y transcripción). Es lo que se baja como "junta completa" —
 * se sirve tal cual para que el archivo descargado sea idéntico a la verdad.
 */
export async function readMeetingMarkdown(slugIn: string, id: string): Promise<string | null> {
  const slug = await realSlug(slugIn);
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safeId) return null;
  try {
    return await readFile(join(meetingsDir(slug), `${safeId}.md`), "utf8");
  } catch {
    return null;
  }
}

/**
 * Transcripción como .txt: cabecera mínima de contexto + el texto sin el
 * markdown de los hablantes (`**Hablante 0:**` → `Hablante 0:`), que en un
 * archivo de texto plano es ruido.
 */
export function renderTranscriptTxt(m: Meeting): string {
  const meta = [
    m.project_slug,
    m.fecha.slice(0, 10),
    m.duracion_min ? `${m.duracion_min} min` : null,
    m.stt_provider ?? null,
  ].filter(Boolean);
  const head = [
    m.title,
    meta.join(" · "),
    m.participantes?.length ? `Participantes: ${m.participantes.join(", ")}` : null,
  ].filter(Boolean) as string[];
  const body = (m.transcript || "").trim().replace(/\*\*(.+?)\*\*/g, "$1");
  return `${head.join("\n")}\n${"-".repeat(60)}\n\n${body}\n`;
}

// ── Espejo + estado en Supabase ────────────────────────────────────────

async function mirrorMeeting(m: Meeting, durationSec: number | null): Promise<void> {
  if (!supabase) return;
  const key = meetingLocalKey(m.project_slug, m.id);
  const embedding = await embed(m.summary);
  const { error } = await supabase.from("meetings").upsert(
    {
      local_key: key,
      meeting_id: m.id,
      project_slug: safeName(m.project_slug),
      title: m.title,
      meeting_date: m.fecha,
      transcript: m.transcript,
      summary: m.summary,
      summary_embedding: embedding,
      duration_sec: durationSec,
      source: m.source,
      stt_provider: m.stt_provider ?? null,
      participants: m.participantes ?? [],
      machine: env.MACHINE_NAME,
      vault_path: m.vault_path ?? null,
      coach: m.coach ?? null,
    },
    { onConflict: "local_key" },
  );
  if (error) console.error("[meetings] espejo meeting:", error.message);
}

/** Superpone el estado de triage (tarea creada) sobre los accionables del .md. */
async function overlayTaskState(
  meetingId: string,
  actionables: MeetingActionable[],
): Promise<MeetingActionable[]> {
  const tasks = await tasksForMeeting(meetingId);
  if (!tasks.length) return actionables;
  const byIdx = new Map(tasks.map((t) => [t.meeting_idx ?? -1, t]));
  return actionables.map((a) => {
    const t = byIdx.get(a.idx);
    if (!t) return a;
    // Triage Linear-first: la fila-puente guarda la URL del issue en `detail`
    // — de ahí sale el chip "RUL-x ↗" del detalle de la reunión.
    const linear = (t.detail ?? "").match(/linear\.app\/[^/]+\/issue\/([A-Za-z0-9]+-\d+)/);
    return {
      ...a,
      taskId: t.id,
      status: t.status,
      run_id: t.run_id ?? null,
      linear_identifier: linear?.[1] ?? null,
      linear_url: linear ? t.detail : null,
    };
  });
}

// ── Búsqueda semántica ─────────────────────────────────────────────────

export interface MeetingSearchHit extends MeetingSummary {
  summary?: string;
  similarity?: number;
}

export async function searchMeetings(
  query: string,
  project?: string,
  limit = 8,
): Promise<MeetingSearchHit[]> {
  if (!supabase) return [];
  const embedding = await embed(query);
  const hit = (r: Record<string, unknown>): MeetingSearchHit => ({
    id: String(r.meeting_id),
    project_slug: String(r.project_slug),
    title: String(r.title),
    fecha: toIso(r.meeting_date),
    source: "upload",
    accionables_count: 0,
    summary: r.summary ? String(r.summary) : undefined,
    similarity: typeof r.similarity === "number" ? r.similarity : undefined,
  });
  if (embedding) {
    const { data, error } = await supabase.rpc("match_meetings", {
      query_embedding: embedding,
      match_count: limit,
      filter_project: project ?? null,
    });
    if (!error && data) return (data as Record<string, unknown>[]).map(hit);
    if (error) console.error("[meetings] match_meetings:", error.message);
  }
  // Fallback sin embeddings: texto plano + recencia.
  let q = supabase
    .from("meetings")
    .select("meeting_id,project_slug,title,summary,meeting_date")
    .ilike("summary", `%${query}%`)
    .order("meeting_date", { ascending: false })
    .limit(limit);
  if (project) q = q.eq("project_slug", project);
  const { data } = await q;
  return (data ?? []).map(hit);
}
