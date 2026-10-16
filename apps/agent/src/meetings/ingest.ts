/**
 * Pipeline de ingest de una reunión: transcripción → (Agent SDK) resumen +
 * EXACTAMENTE 2 accionables → persistencia en vault + Supabase.
 *
 * El resumen lo genera Claude vía el Agent SDK (funciona con el login de Claude
 * Code, sin ANTHROPIC_API_KEY). Para garantizar salida estructurada forzamos al
 * modelo a llamar una tool MCP acotada (`record_meeting_result`, validada por
 * Zod); si por algún motivo no la llama, caemos a parsear un bloque JSON.
 */
import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join as joinPath } from "node:path";
import type {
  LiveClientKind,
  LiveCoachMetrics,
  LiveSuggestion,
  Meeting,
  MeetingPerformance,
  MeetingSource,
} from "@hermes/shared";
import { env } from "../env.js";
import { emit } from "../events.js";
import { notifyMac } from "../notify.js";
import { setPresence } from "../presence.js";
import { getProjectBriefing, readProjects } from "../vault/projects.js";
import { saveMeeting, type MeetingRewriteBase } from "./store.js";
import { transcribe } from "./stt.js";
import { OWNER } from "../owner.js";

const MAX_TRANSCRIPT_CHARS = 120_000; // ~30k tokens: cabe de sobra en el contexto

interface Extracted {
  title: string;
  summary: string;
  actionables: { title: string; one_liner: string; exec_prompt: string }[];
  performance?: MeetingPerformance;
}

export interface IngestOptions {
  project: string;
  transcript: string;
  title?: string;
  source: MeetingSource;
  sttProvider?: string | null;
  durationSec?: number | null;
  /** id de la task (para emitir eventos al feed). */
  taskId?: string;
  /** sugerencias del copiloto durante la junta EN VIVO (sección propia del .md). */
  liveSuggestions?: LiveSuggestion[];
  /** Métricas del coach en vivo — activa la evaluación de desempeño SOLO si
   *  traen selfSpeaker (sin saber quién es el dueño no hay a quién evaluar). */
  coachMetrics?: LiveCoachMetrics | null;
  /** Reunión de equipo: sección "## Repaso" ya armada (ventanas + para estudiar). */
  review?: string;
  /** Desde dónde se grabó (dashboard o Hermes Phone) → frontmatter `client`. */
  client?: LiveClientKind;
  /**
   * Re-ingesta SOBRE un acta existente (mismo id, mismo .md, misma fila de
   * Supabase): nuevo resumen desde la transcripción nueva, conservando título,
   * fecha, sugerencias en vivo, coach, repaso y client. Si los accionables ya
   * se triaron, también se conservan (las tareas apuntan a su índice).
   */
  rewrite?: {
    base: MeetingRewriteBase;
    /** Constancia visible bajo el título del acta. */
    notice: string;
    extraFrontmatter?: Record<string, unknown>;
  };
}

export async function ingestMeeting(opts: IngestOptions): Promise<Meeting> {
  const transcript = opts.transcript.trim();
  if (!transcript) throw new Error("Transcripción vacía.");

  // Evaluación de desempeño solo con junta EN VIVO + "soy yo" marcado.
  const evalSelf =
    opts.source === "live" && opts.coachMetrics?.selfSpeaker ? opts.coachMetrics : null;

  let captured: Extracted | null = null;

  // Tool acotada: el modelo la llama UNA vez con el resultado estructurado.
  const recordTool = tool(
    "record_meeting_result",
    "Registra el análisis de la reunión: título, resumen y EXACTAMENTE 2 accionables. Llámala una sola vez.",
    {
      title: z
        .string()
        .describe(
          "Título BREVE del tema de la reunión: 3-6 palabras, en español, sin punto final ni comillas. Es lo que se lee en la lista del historial, así que debe decir DE QUÉ trató, no quién habló. Ej: 'Cambio de backend y pruebas', 'Diseño del módulo de actas'.",
        ),
      summary: z.string().describe("Resumen ejecutivo de la reunión (4-8 líneas), en español."),
      actionables: z
        .array(
          z.object({
            title: z.string().describe("Título corto en imperativo (ej: 'Migrar el editor a v2')."),
            one_liner: z.string().describe("Una línea explicando el accionable."),
            exec_prompt: z
              .string()
              .describe(
                "Prompt AUTOCONTENIDO para que Claude Code ejecute este accionable en el repo del proyecto. Incluye el contexto necesario; no asumas que quien lo ejecuta vio la reunión.",
              ),
          }),
        )
        .describe("Exactamente 2 accionables, los más importantes y ejecutables."),
      performance: z
        .object({
          score: z.number().min(1).max(10).describe(`Desempeño de ${OWNER} en la junta, 1-10.`),
          highlights: z.array(z.string()).max(3).describe("2-3 cosas que hizo bien (español)."),
          improvements: z
            .array(z.string())
            .max(3)
            .describe("2-3 mejoras concretas para la próxima junta (español)."),
        })
        .optional()
        .describe(`SOLO si el prompt pide evaluar el desempeño de ${OWNER}; si no, omítelo.`),
    },
    async (args) => {
      captured = {
        title: args.title,
        summary: args.summary,
        actionables: args.actionables.slice(0, 2),
        // Sin coach activo se descarta aunque el modelo lo mande (dato sin fuente).
        performance: evalSelf ? args.performance : undefined,
      };
      return { content: [{ type: "text" as const, text: "Registrado." }] };
    },
  );
  const ingestServer = createSdkMcpServer({ name: "ingest", version: "0.1.0", tools: [recordTool] });

  const briefing = await getProjectBriefing(opts.project);
  const project = (await readProjects()).find(
    (p) => p.slug.toLowerCase() === opts.project.toLowerCase(),
  );
  const systemPrompt = buildIngestPrompt({
    slug: opts.project,
    name: project?.name,
    briefing,
    estadoActual: project?.estado_actual,
    tareas: project?.tareas_pendientes,
    coach: evalSelf,
  });

  setPresence("working", `analizando reunión de ${project?.name ?? opts.project}`);
  emit({ kind: "tool_call", taskId: opts.taskId, toolName: "analizar_reunión", detail: opts.project });

  try {
    const q = query({
      prompt: buildUserPrompt(
        opts.rewrite?.base.title ?? opts.title,
        transcript.slice(0, MAX_TRANSCRIPT_CHARS),
      ),
      options: {
        cwd: env.VAULT_PATH || process.cwd(),
        systemPrompt,
        model: process.env.HERMES_MODEL || undefined,
        // 6 se quedaba corto con transcripciones largas (el modelo razona un
        // par de turnos antes de llamar a la tool) y el SDK LANZA al topar el
        // límite → se perdían juntas enteras. Con el catch de abajo el límite
        // ya no es fatal, pero darle aire evita el caso común.
        maxTurns: 16,
        settingSources: [],
        mcpServers: { ingest: ingestServer },
        // Bare allowedTools auto-aprueba la tool (sin canUseTool): es una
        // extracción read-only, no toca disco ni bash.
        allowedTools: ["mcp__ingest__record_meeting_result"],
        permissionMode: "default",
      },
    });

    let finalText = "";
    // El SDK LANZA desde el iterador cuando el result es de error (p.ej.
    // maxTurns). Si el modelo YA llamó a la tool, `captured` está lleno y el
    // análisis es válido: no tiene sentido tirar la junta por un turno de más.
    try {
      for await (const message of q) {
        const m = message as Record<string, any>;
        if (m.type === "assistant") {
          for (const block of m.message?.content ?? []) {
            if (block.type === "text" && block.text) finalText = block.text as string;
          }
        } else if (m.type === "result" && m.subtype === "success" && typeof m.result === "string") {
          finalText = m.result || finalText;
        }
      }
    } catch (err) {
      if (!captured) captured = parseJsonFallback(finalText);
      if (!captured) throw err; // sin análisis: el error del SDK es la causa real
      console.warn(`[meetings] análisis rescatado pese al error del SDK: ${String(err).slice(0, 160)}`);
    }
    if (!captured) captured = parseJsonFallback(finalText);
  } finally {
    setPresence("idle");
  }

  if (!captured || !captured.summary || captured.actionables.length === 0) {
    throw new Error("El análisis no produjo un resumen con accionables.");
  }

  const rw = opts.rewrite;
  const meeting = await saveMeeting({
    projectSlug: rw?.base.slug ?? opts.project,
    // Título: el del acta que se reescribe > el que puso el usuario > el breve
    // del modelo > primera frase.
    title:
      rw?.base.title ??
      (opts.title?.trim() || captured.title?.trim() || deriveTitle(captured.summary)),
    fecha: rw?.base.fecha ?? new Date(),
    summary: captured.summary,
    transcript,
    // Accionables ya triados: las tareas apuntan a su índice → no se reemplazan.
    actionables: rw?.base.triaged ? rw.base.actionables : captured.actionables,
    source: opts.source,
    sttProvider: opts.sttProvider ?? null,
    durationSec: opts.durationSec ?? null,
    liveSuggestions: opts.liveSuggestions,
    review: rw ? rw.base.reviewMarkdown || undefined : opts.review,
    // El coach de la reescritura es el medido EN VIVO (las etiquetas de
    // hablante del STT batch no son las mismas: re-evaluar sería inventar).
    coach: rw
      ? rw.base.coach
      : opts.coachMetrics
        ? { metrics: opts.coachMetrics, performance: captured.performance }
        : undefined,
    client: opts.client ?? rw?.base.client,
    rewrite: rw
      ? {
          id: rw.base.id,
          suggestionsMarkdown: rw.base.suggestionsMarkdown,
          keepFrontmatter: { ...rw.base.keepFrontmatter, ...(rw.extraFrontmatter ?? {}) },
          notice: rw.notice,
        }
      : undefined,
  });

  // Nota: antes el resumen se espejaba también como memoria para que el recall
  // transversal lo viera. Ya no hace falta: match_knowledge (migración 009)
  // busca directo en `meetings`, y duplicarlo solo ensuciaba los resultados.

  return meeting;
}

// ── Prompts ────────────────────────────────────────────────────────────

function buildIngestPrompt(p: {
  slug: string;
  name?: string;
  briefing?: string;
  estadoActual?: string;
  tareas?: string[];
  /** Métricas reales del coach en vivo (con selfSpeaker) → pide evaluación. */
  coach?: LiveCoachMetrics | null;
}): string {
  const parts = [
    `# Hermes — Analista de reuniones

Eres **Hermes**, el AI OS de ${OWNER}. Estás procesando la transcripción de una reunión del proyecto **${p.name ?? p.slug}** (\`${p.slug}\`).

Tu tarea: producir (1) un TÍTULO breve del tema, (2) un RESUMEN ejecutivo claro en español y (3) EXACTAMENTE 2 accionables puntuales — los más importantes y ejecutables.`,
  ];
  if (p.briefing?.trim()) {
    parts.push(`## Briefing del proyecto (síguelo)\n${p.briefing.trim()}`);
  }
  if (p.estadoActual?.trim()) {
    parts.push(`## Estado actual del proyecto\n${p.estadoActual.slice(0, 800)}`);
  }
  if (p.tareas?.length) {
    parts.push(`## Tareas ya pendientes\n${p.tareas.slice(0, 6).map((t) => `- ${t}`).join("\n")}`);
  }
  if (p.coach?.selfSpeaker) {
    const self = p.coach.bySpeaker[p.coach.selfSpeaker];
    const totalMs = Object.values(p.coach.bySpeaker).reduce((a, s) => a + s.talkMs, 0);
    const pct = self && totalMs > 0 ? Math.round((self.talkMs / totalMs) * 100) : 0;
    parts.push(`## Evalúa el desempeño de ${OWNER} (campo \`performance\`)
${OWNER} habló en esta junta (en el transcript es el hablante "${p.coach.selfSpeaker}"). Métricas REALES medidas en vivo: ${pct}% del tiempo hablado, ${self?.wpm ?? 0} palabras/min, ${self?.fillers ?? 0} muletillas contadas, ${self?.weak ?? 0} arranques débiles (pedir permiso, disculparse, «pero» que borra, «obviamente», «creo que tal vez»).
Con el transcript + estas métricas, llena también \`performance\`: score 1-10, 2-3 highlights y 2-3 mejoras concretas (claridad, estructura, si amarró compromisos, si respondió bien las preguntas). Honesto y específico — cita momentos del transcript, no generalidades.
Evalúa también la ARTICULACIÓN: ¿abrió con el punto o lo enterró al final? ¿pidió permiso o se disculpó por hablar? ¿sonó convencido de sus ideas? Al menos una mejora debe ser una frase REAL suya reescrita, en el idioma en que la dijo: «dijiste: … → mejor: …».`);
  }
  parts.push(`## Reglas
- El título: 3-6 palabras sobre EL TEMA (lo que se lee en la lista del historial). Nada de "Reunión de…" ni quiénes hablaron: el tema. Ej: "Cambio de backend y pruebas".
- El resumen: 4-8 líneas — qué se habló, decisiones tomadas y próximos pasos. Sin relleno.
- Los 2 accionables: concretos, en imperativo, ejecutables por ${OWNER} o por Claude Code en el repo.
- \`exec_prompt\` de cada accionable debe ser AUTOCONTENIDO: incluye el contexto del proyecto y del briefing necesario para ejecutarlo, sin asumir que quien lo corre vio la reunión.
- Responde SIEMPRE llamando a la tool \`record_meeting_result\` UNA sola vez. No escribas texto libre.`);
  return parts.join("\n\n");
}

function buildUserPrompt(title: string | undefined, transcript: string): string {
  return `Título de la reunión: ${title?.trim() || "(sin título)"}

Transcripción:
"""
${transcript}
"""

Analiza la reunión y llama a record_meeting_result con el título, el resumen y los 2 accionables.`;
}

// ── Fallbacks ──────────────────────────────────────────────────────────

/** Extrae {summary, actionables} de un bloque JSON si el modelo no usó la tool. */
function parseJsonFallback(text: string): Extracted | null {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  try {
    const obj = JSON.parse(candidate);
    if (typeof obj?.summary !== "string" || !Array.isArray(obj?.actionables)) return null;
    const actionables = obj.actionables.slice(0, 2).map((a: Record<string, unknown>) => ({
      title: String(a.title ?? ""),
      one_liner: String(a.one_liner ?? ""),
      exec_prompt: String(a.exec_prompt ?? a.title ?? ""),
    }));
    if (!actionables.length) return null;
    return { title: String(obj.title ?? ""), summary: obj.summary, actionables };
  } catch {
    return null;
  }
}

/**
 * Fallback si el modelo no mandó título: primera oración del resumen, sin
 * markdown y cortada en la última palabra completa (nunca a mitad de palabra).
 */
function deriveTitle(summary: string): string {
  const first =
    summary
      .split(/[.\n]/)[0]
      ?.replace(/[*_`#]/g, "")
      .trim() ?? "";
  if (!first) return "Reunión";
  if (first.length <= 60) return first;
  return `${first.slice(0, 57).replace(/\s+\S*$/, "")}…`;
}

// ── Jobs async (subir/pegar → transcribir → resumir) ───────────────────
// Una reunión se procesa en background (transcripción + LLM tardan): el POST
// devuelve un job_id al instante y el progreso viaja por /events (task_*).

export interface MeetingJob {
  id: string;
  project: string;
  /**
   * `unknown` = job de antes de que los jobs se guardaran en disco: el agente
   * se reinició y no sabe cómo terminó, pero SÍ tiene el audio (audioPath).
   */
  status: "running" | "done" | "error" | "unknown";
  startedAt: string;
  finishedAt?: string;
  /** id de la reunión creada (cuando status === done). */
  meetingId?: string;
  title?: string;
  error?: string;
  /** true si la transcripción sobrevivió al fallo → se puede reintentar sin audio. */
  retryable?: boolean;
  /** Copia en disco del audio subido (existe aunque el STT falle). */
  audioPath?: string;
  /** Desde dónde se grabó (va al acta). */
  client?: LiveClientKind;
  /** "live-completion" = completa una junta EN VIVO con el archivo del teléfono. */
  kind?: "live-completion";
  /** Solo live-completion: lo necesario para retomar el job tras un reinicio. */
  live?: LiveCompletionInfo;
  /** Solo live-completion: en qué va (ver live-completion.ts). */
  stage?: LiveCompletionStage;
  /** Solo live-completion: cómo terminó. */
  outcome?: "attached" | "reingested" | "new_meeting";
  /** Constancia legible de lo que pasó (hueco, por qué cayó al flujo normal…). */
  note?: string;
}

export type LiveCompletionStage =
  | "esperando_junta"
  | "adjuntando"
  | "retranscribiendo"
  | "flujo_normal";

export interface LiveCompletionInfo {
  /** id de la sesión en vivo (`POST /meetings/live/start` → snapshot.id). */
  sessionId: string;
  /** ms de audio que NO llegaron en vivo (lo mide el teléfono). */
  gapMs: number;
  durationSec: number | null;
  title?: string;
  /** ISO de cuándo empezó a esperar la junta (el tope de 20 min sobrevive reinicios). */
  waitingSince: string;
}

const jobs = new Map<string, MeetingJob>();

// Los jobs vivían SOLO en memoria: cada reinicio del agente dejaba al teléfono
// preguntando por jobs que respondían 404 para siempre, y sus audios se
// apilaban en PENDIENTES sin poder resolverse (40 el 2026-10-08). Ahora cada
// cambio de estado se escribe a disco.
const JOBS_DIR = joinPath(homedir(), ".hermes-os", "meeting-jobs");

// Escrituras en cadena por job: una escritura vieja que termina tarde no puede
// pisar el estado final.
const jobWrites = new Map<string, Promise<void>>();

function persistJob(job: MeetingJob): void {
  const snapshot = JSON.stringify(job, null, 2);
  const prev = jobWrites.get(job.id) ?? Promise.resolve();
  const next = prev
    .then(() => mkdir(JOBS_DIR, { recursive: true }))
    .then(() => writeFile(joinPath(JOBS_DIR, `${job.id}.json`), snapshot))
    .catch((e) => console.error("[meetings] no pude guardar el job:", e));
  jobWrites.set(job.id, next);
}

/** Solo memoria (para quien necesita el job vivo, p.ej. el ingest en curso). */
export function getMeetingJob(id: string): MeetingJob | undefined {
  return jobs.get(id);
}

/** Registra (o actualiza) un job en memoria + disco. Lo usa live-completion.ts. */
export function trackMeetingJob(job: MeetingJob): void {
  jobs.set(job.id, job);
  persistJob(job);
}

/** Jobs guardados en disco (para retomar los live-completion al arrancar). */
export async function listPersistedMeetingJobs(): Promise<MeetingJob[]> {
  const files = (await readdir(JOBS_DIR).catch(() => [] as string[])).filter((f) =>
    f.endsWith(".json"),
  );
  const out: MeetingJob[] = [];
  for (const f of files) {
    try {
      out.push(JSON.parse(await readFile(joinPath(JOBS_DIR, f), "utf8")) as MeetingJob);
    } catch {
      /* archivo corrupto: lo salteamos */
    }
  }
  return out;
}

/** Id de job seguro para usar en rutas de disco (8 hex de randomUUID). */
const isJobId = (id: string) => /^[0-9a-f]{8}$/i.test(id);

/**
 * Estado de un job sobreviviendo reinicios: memoria → disco → evidencia en
 * disco (audio de custodia y transcripción guardada) para los jobs de antes
 * de la persistencia. Un job "running" en disco sin proceso vivo murió con
 * el agente: se reporta como error reprocesable si hay audio.
 */
export async function getMeetingJobDurable(id: string): Promise<MeetingJob | undefined> {
  const live = jobs.get(id);
  if (live) return live;
  if (!isJobId(id)) return undefined;

  const audioPath = await findCustodyAudio(id);
  try {
    const saved = JSON.parse(await readFile(joinPath(JOBS_DIR, `${id}.json`), "utf8")) as MeetingJob;
    if (saved.status === "running") {
      return {
        ...saved,
        status: "error",
        error: "el agente se reinició a mitad del análisis",
        audioPath: saved.audioPath ?? audioPath,
      };
    }
    return saved;
  } catch {
    /* job de antes de la persistencia: inferir */
  }

  const failed = (await readdir(FAILED_DIR).catch(() => [] as string[])).find(
    (f) => f.includes(id) && f.endsWith(".json"),
  );
  if (failed) {
    return {
      id,
      project: "",
      status: "error",
      startedAt: "",
      error: "el análisis falló; la transcripción quedó guardada en la Mac",
      retryable: true,
      audioPath,
    };
  }
  if (audioPath) {
    return { id, project: "", status: "unknown", startedAt: "", audioPath };
  }
  return undefined;
}

/** Audio de custodia de un job (`<fecha>-<proyecto>-<id>.<ext>`), si existe. */
async function findCustodyAudio(id: string): Promise<string | undefined> {
  const files = await readdir(AUDIO_DIR).catch(() => [] as string[]);
  const f = files.find((name) => name.replace(/\.[^.]+$/, "").endsWith(`-${id}`));
  return f ? joinPath(AUDIO_DIR, f) : undefined;
}

/**
 * Reprocesa un job desde el audio que la Mac ya tiene. Sirve para las
 * pendientes del teléfono cuyo job se perdió: no hay que volver a subir nada.
 */
export async function retryMeetingJobFromAudio(
  id: string,
  project: string,
  durationSec: number | null,
): Promise<MeetingJob> {
  // Si la transcripción ya está guardada, solo se re-analiza: transcribir
  // otra vez cuesta créditos y minutos sin aportar nada.
  const failed = (await readdir(FAILED_DIR).catch(() => [] as string[])).find(
    (f) => f.includes(id) && f.endsWith(".json"),
  );
  if (failed) return retryFailedTranscript(id);

  const job = await getMeetingJobDurable(id);
  const audioPath = job?.audioPath ?? (await findCustodyAudio(id));
  if (!audioPath) throw new Error(`la Mac no tiene el audio del job ${id}`);
  const data = await readFile(audioPath);
  const ext = audioPath.split(".").pop() ?? "m4a";
  const mime = ext === "webm" ? "audio/webm" : ext === "mp3" ? "audio/mpeg" : "audio/mp4";
  return startMeetingJob({
    project: project || job?.project || "",
    audio: new Blob([data], { type: mime }),
    source: "audio",
    durationSec,
    existingAudioPath: audioPath,
  });
}

// ── Red de seguridad: transcripciones huérfanas ────────────────────────
// Transcribir cuesta plata y tiempo, y el teléfono borra el audio apenas el
// job arranca. Si el análisis falla, la transcripción es lo ÚNICO que queda de
// la junta: se guarda en disco para poder reintentar sin el audio.

const FAILED_DIR = joinPath(homedir(), ".hermes-os", "transcripciones-pendientes");

// El audio es lo único irrecuperable de una junta: si el STT falla (sin
// créditos, sin red) no hay transcripción que salvar y, cuando el teléfono ya
// borró su copia, la junta se pierde entera. Por eso el audio se guarda en
// disco ANTES de intentar transcribir — nunca después.
const AUDIO_DIR = joinPath(homedir(), ".hermes-os", "audio-juntas");

/** Extensión a partir del mime, para que el archivo guardado sea reproducible. */
function audioExt(mime: string): string {
  const m = (mime || "").toLowerCase();
  if (m.includes("webm")) return "webm";
  if (m.includes("mp4") || m.includes("m4a") || m.includes("aac")) return "m4a";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("wav")) return "wav";
  if (m.includes("ogg") || m.includes("opus")) return "ogg";
  return "m4a";
}

/** Copia de custodia del audio recién subido. Devuelve la ruta. */
async function saveAudioBackup(audio: Blob, project: string, id: string, createdAt: string): Promise<string> {
  await mkdir(AUDIO_DIR, { recursive: true });
  const path = joinPath(AUDIO_DIR, `${createdAt.slice(0, 10)}-${project}-${id}.${audioExt(audio.type)}`);
  await writeFile(path, Buffer.from(await audio.arrayBuffer()));
  return path;
}

interface FailedTranscript {
  id: string;
  project: string;
  transcript: string;
  title?: string;
  source: MeetingSource;
  sttProvider: string | null;
  durationSec: number | null;
  error: string;
  createdAt: string;
  client?: LiveClientKind;
}

async function saveFailedTranscript(t: FailedTranscript): Promise<string> {
  await mkdir(FAILED_DIR, { recursive: true });
  const path = joinPath(FAILED_DIR, `${t.createdAt.slice(0, 10)}-${t.project}-${t.id}.json`);
  await writeFile(path, JSON.stringify(t, null, 2), "utf8");
  return path;
}

/** Resumen de una transcripción huérfana (sin el texto completo). */
export type FailedTranscriptSummary = Omit<FailedTranscript, "transcript"> & { chars: number };

/** Transcripciones que quedaron sin analizar (para /meetings/transcripciones). */
export async function listFailedTranscripts(): Promise<FailedTranscriptSummary[]> {
  let files: string[];
  try {
    files = (await readdir(FAILED_DIR)).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const out: FailedTranscriptSummary[] = [];
  for (const f of files) {
    try {
      const { transcript, ...rest } = JSON.parse(
        await readFile(joinPath(FAILED_DIR, f), "utf8"),
      ) as FailedTranscript;
      out.push({ ...rest, chars: transcript.length });
    } catch {
      /* archivo corrupto: lo salteamos */
    }
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/** Reintenta el ANÁLISIS de una transcripción guardada (sin volver a transcribir). */
export async function retryFailedTranscript(id: string): Promise<MeetingJob> {
  const files = await readdir(FAILED_DIR).catch(() => [] as string[]);
  const file = files.find((f) => f.includes(id) && f.endsWith(".json"));
  if (!file) throw new Error(`transcripción ${id} no encontrada`);
  const path = joinPath(FAILED_DIR, file);
  const saved = JSON.parse(await readFile(path, "utf8")) as FailedTranscript;
  const job = startMeetingJob({
    project: saved.project,
    transcript: saved.transcript,
    title: saved.title,
    source: saved.source,
    durationSec: saved.durationSec,
    sttProvider: saved.sttProvider,
    client: saved.client,
    onSuccess: () => unlink(path).catch(() => {}), // ya es una reunión de verdad
  });
  return job;
}

export interface StartMeetingJobInput {
  project: string;
  /** audio a transcribir (subido/grabado) — o... */
  audio?: Blob;
  /** ...transcripción ya lista (pegada / herramienta externa). */
  transcript?: string;
  title?: string;
  source: MeetingSource;
  durationSec?: number | null;
  /** Ya se sabe con qué se transcribió (reintento de una guardada). */
  sttProvider?: string | null;
  /** Hook del reintento: limpiar la transcripción guardada al lograrlo. */
  onSuccess?: () => void;
  /** El audio YA está en disco (subida por partes, reproceso): no se duplica. */
  existingAudioPath?: string;
  /** Id fijado por quien ya nombró el audio de custodia con él (newMeetingJobId). */
  id?: string;
  /** Desde dónde se grabó (dashboard o Hermes Phone) → acta. */
  client?: LiveClientKind;
  /** Campos extra del job (live-completion cae aquí al flujo normal con su mismo id). */
  meta?: Pick<MeetingJob, "kind" | "live" | "stage" | "note">;
}

export const newMeetingJobId = (): string => randomUUID().slice(0, 8);

/** Bajo esto una transcripción no es una junta (ruido, silencio, "Mm-hmm"). */
export const MIN_SPOKEN_WORDS = 12;

/** Palabras habladas, sin etiquetas de hablante (**Hablante 0:**) ni marcas. */
export function spokenWords(transcript: string): number {
  return transcript
    .replace(/\*\*[^*]{1,40}:\*\*/g, " ")
    .replace(/^[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ ]{0,20}\d{0,2}:\s/gm, " ")
    .replace(/[\[(][^\])]{0,40}[\])]/g, " ")
    .split(/\s+/)
    .filter((w) => /[a-záéíóúñ0-9]/i.test(w)).length;
}

/** Ruta de custodia de un audio (misma convención que saveAudioBackup). */
export async function custodyAudioPath(project: string, id: string, ext: string): Promise<string> {
  await mkdir(AUDIO_DIR, { recursive: true });
  return joinPath(AUDIO_DIR, `${new Date().toISOString().slice(0, 10)}-${project}-${id}.${ext}`);
}

export function startMeetingJob(input: StartMeetingJobInput): MeetingJob {
  const id = input.id ?? newMeetingJobId();
  const job: MeetingJob = {
    ...input.meta,
    id,
    project: input.project,
    status: "running",
    startedAt: new Date().toISOString(),
    title: input.title,
    ...(input.client ? { client: input.client } : {}),
  };
  if (input.existingAudioPath) job.audioPath = input.existingAudioPath;
  jobs.set(id, job);
  persistJob(job);
  emit({ kind: "task_start", taskId: id, detail: `reunión: ${input.title || input.project}` });

  void (async () => {
    // Fuera del try: si el análisis falla, la transcripción es lo único que
    // queda de la junta (el teléfono ya borró el audio) → hay que salvarla.
    let transcript = "";
    let sttProvider: string | null = input.sttProvider ?? null;
    try {
      transcript = input.transcript?.trim() ?? "";
      if (!transcript && input.audio) {
        // Primero el respaldo: si transcribir falla, el audio ya está a salvo.
        if (!job.audioPath) {
          try {
            job.audioPath = await saveAudioBackup(input.audio, input.project, id, job.startedAt);
            console.log(`[meetings] audio a salvo en ${job.audioPath}`);
            persistJob(job);
          } catch (e) {
            console.error("[meetings] no pude guardar el audio:", e);
          }
        }
        emit({ kind: "tool_call", taskId: id, toolName: "transcribir", detail: `${Math.round(input.audio.size / 1024)} KB` });
        const r = await transcribe(input.audio);
        transcript = r.text;
        sttProvider = r.provider;
      }
      if (!transcript) throw new Error("Sin audio ni transcripción utilizable.");
      // Audio mudo (micrófono silenciado por una llamada, teléfono en el
      // bolsillo) daba una "junta" con accionables INVENTADOS a partir del
      // contexto del proyecto (2026-10-09, prueba en emulador). Sin voz real no
      // hay junta: falla con motivo y el audio queda guardado.
      if (spokenWords(transcript) < MIN_SPOKEN_WORDS) {
        throw new Error(
          `La grabación casi no tiene voz (${spokenWords(transcript)} palabras): no creo una junta inventada. El audio quedó guardado.`,
        );
      }

      const meeting = await ingestMeeting({
        project: input.project,
        transcript,
        title: input.title,
        source: input.source,
        sttProvider,
        durationSec: input.durationSec ?? null,
        taskId: id,
        client: input.client,
      });

      job.status = "done";
      job.meetingId = meeting.id;
      if (job.kind === "live-completion") job.outcome = "new_meeting";
      job.title = meeting.title;
      job.finishedAt = new Date().toISOString();
      persistJob(job);
      input.onSuccess?.();
      emit({
        kind: "task_done",
        taskId: id,
        detail: `reunión "${meeting.title}" — ${meeting.actionables.length} accionables`,
      });
      notifyMac("reunión", `✅ ${meeting.title}: ${meeting.actionables.length} accionables`);
    } catch (err) {
      job.status = "error";
      job.error = String(err).slice(0, 300);
      job.finishedAt = new Date().toISOString();
      // Transcribió pero no analizó: guarda el texto → reintento sin audio.
      if (transcript) {
        try {
          const path = await saveFailedTranscript({
            id,
            project: input.project,
            transcript,
            title: input.title,
            source: input.source,
            sttProvider,
            durationSec: input.durationSec ?? null,
            error: job.error,
            createdAt: job.startedAt,
            client: input.client,
          });
          job.retryable = true;
          console.error(`[meetings] análisis falló; transcripción a salvo en ${path}`);
        } catch (e) {
          console.error("[meetings] no pude guardar la transcripción:", e);
        }
      }
      persistJob(job);
      if (job.audioPath) console.error(`[meetings] el audio de esta junta quedó en ${job.audioPath}`);
      emit({ kind: "error", taskId: id, detail: `reunión falló: ${job.error}` });
      notifyMac(
        "reunión",
        job.retryable
          ? `❌ análisis falló (transcripción a salvo): ${String(err).slice(0, 60)}`
          : `❌ falló: ${String(err).slice(0, 80)}`,
      );
    }
  })();

  return job;
}
