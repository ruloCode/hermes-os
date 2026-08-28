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
import { saveMeeting } from "./store.js";
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
      prompt: buildUserPrompt(opts.title, transcript.slice(0, MAX_TRANSCRIPT_CHARS)),
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

  const meeting = await saveMeeting({
    projectSlug: opts.project,
    // Título: el que puso el usuario > el breve del modelo > primera frase.
    title: opts.title?.trim() || captured.title?.trim() || deriveTitle(captured.summary),
    fecha: new Date(),
    summary: captured.summary,
    transcript,
    actionables: captured.actionables,
    source: opts.source,
    sttProvider: opts.sttProvider ?? null,
    durationSec: opts.durationSec ?? null,
    liveSuggestions: opts.liveSuggestions,
    coach: opts.coachMetrics
      ? { metrics: opts.coachMetrics, performance: captured.performance }
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
${OWNER} habló en esta junta (en el transcript es el hablante "${p.coach.selfSpeaker}"). Métricas REALES medidas en vivo: ${pct}% del tiempo hablado, ${self?.wpm ?? 0} palabras/min, ${self?.fillers ?? 0} muletillas contadas.
Con el transcript + estas métricas, llena también \`performance\`: score 1-10, 2-3 highlights y 2-3 mejoras concretas (claridad, estructura, si amarró compromisos, si respondió bien las preguntas). Honesto y específico — cita momentos del transcript, no generalidades.`);
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
  status: "running" | "done" | "error";
  startedAt: string;
  finishedAt?: string;
  /** id de la reunión creada (cuando status === done). */
  meetingId?: string;
  title?: string;
  error?: string;
  /** true si la transcripción sobrevivió al fallo → se puede reintentar sin audio. */
  retryable?: boolean;
}

const jobs = new Map<string, MeetingJob>();

export function getMeetingJob(id: string): MeetingJob | undefined {
  return jobs.get(id);
}

// ── Red de seguridad: transcripciones huérfanas ────────────────────────
// Transcribir cuesta plata y tiempo, y el teléfono borra el audio apenas el
// job arranca. Si el análisis falla, la transcripción es lo ÚNICO que queda de
// la junta: se guarda en disco para poder reintentar sin el audio.

const FAILED_DIR = joinPath(homedir(), ".hermes-os", "transcripciones-pendientes");

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
}

export function startMeetingJob(input: StartMeetingJobInput): MeetingJob {
  const id = randomUUID().slice(0, 8);
  const job: MeetingJob = {
    id,
    project: input.project,
    status: "running",
    startedAt: new Date().toISOString(),
    title: input.title,
  };
  jobs.set(id, job);
  emit({ kind: "task_start", taskId: id, detail: `reunión: ${input.title || input.project}` });

  void (async () => {
    // Fuera del try: si el análisis falla, la transcripción es lo único que
    // queda de la junta (el teléfono ya borró el audio) → hay que salvarla.
    let transcript = "";
    let sttProvider: string | null = input.sttProvider ?? null;
    try {
      transcript = input.transcript?.trim() ?? "";
      if (!transcript && input.audio) {
        emit({ kind: "tool_call", taskId: id, toolName: "transcribir", detail: `${Math.round(input.audio.size / 1024)} KB` });
        const r = await transcribe(input.audio);
        transcript = r.text;
        sttProvider = r.provider;
      }
      if (!transcript) throw new Error("Sin audio ni transcripción utilizable.");

      const meeting = await ingestMeeting({
        project: input.project,
        transcript,
        title: input.title,
        source: input.source,
        sttProvider,
        durationSec: input.durationSec ?? null,
        taskId: id,
      });

      job.status = "done";
      job.meetingId = meeting.id;
      job.title = meeting.title;
      job.finishedAt = new Date().toISOString();
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
          });
          job.retryable = true;
          console.error(`[meetings] análisis falló; transcripción a salvo en ${path}`);
        } catch (e) {
          console.error("[meetings] no pude guardar la transcripción:", e);
        }
      }
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
