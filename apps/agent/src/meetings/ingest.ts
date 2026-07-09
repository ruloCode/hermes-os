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
import type { Meeting, MeetingSource } from "@hermes/shared";
import { env } from "../env.js";
import { emit } from "../events.js";
import { notifyMac } from "../notify.js";
import { setPresence } from "../presence.js";
import { saveMemory } from "../memory.js";
import { getProjectBriefing, readProjects } from "../vault/projects.js";
import { saveMeeting } from "./store.js";
import { transcribe } from "./stt.js";

const MAX_TRANSCRIPT_CHARS = 120_000; // ~30k tokens: cabe de sobra en el contexto

interface Extracted {
  summary: string;
  actionables: { title: string; one_liner: string; exec_prompt: string }[];
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
}

export async function ingestMeeting(opts: IngestOptions): Promise<Meeting> {
  const transcript = opts.transcript.trim();
  if (!transcript) throw new Error("Transcripción vacía.");

  let captured: Extracted | null = null;

  // Tool acotada: el modelo la llama UNA vez con el resultado estructurado.
  const recordTool = tool(
    "record_meeting_result",
    "Registra el análisis de la reunión: un resumen y EXACTAMENTE 2 accionables. Llámala una sola vez.",
    {
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
    },
    async (args) => {
      captured = { summary: args.summary, actionables: args.actionables.slice(0, 2) };
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
        maxTurns: 6,
        settingSources: [],
        mcpServers: { ingest: ingestServer },
        // Bare allowedTools auto-aprueba la tool (sin canUseTool): es una
        // extracción read-only, no toca disco ni bash.
        allowedTools: ["mcp__ingest__record_meeting_result"],
        permissionMode: "default",
      },
    });

    let finalText = "";
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
    if (!captured) captured = parseJsonFallback(finalText);
  } finally {
    setPresence("idle");
  }

  if (!captured || !captured.summary || captured.actionables.length === 0) {
    throw new Error("El análisis no produjo un resumen con accionables.");
  }

  const meeting = await saveMeeting({
    projectSlug: opts.project,
    title: opts.title?.trim() || deriveTitle(captured.summary),
    fecha: new Date(),
    summary: captured.summary,
    transcript,
    actionables: captured.actionables,
    source: opts.source,
    sttProvider: opts.sttProvider ?? null,
    durationSec: opts.durationSec ?? null,
  });

  // Espeja el resumen como memoria → recall semántico transversal ("¿qué
  // decidimos sobre X?") desde chat/voz, además de la búsqueda en reuniones.
  void saveMemory({
    content: `Reunión "${meeting.title}" (${meeting.project_slug}): ${captured.summary}`,
    type: "project",
    project: meeting.project_slug,
    summary: captured.summary,
    source: "agent",
    tags: ["reunion"],
  });

  return meeting;
}

// ── Prompts ────────────────────────────────────────────────────────────

function buildIngestPrompt(p: {
  slug: string;
  name?: string;
  briefing?: string;
  estadoActual?: string;
  tareas?: string[];
}): string {
  const parts = [
    `# Hermes — Analista de reuniones

Eres **Hermes**, el AI OS de Rulo. Estás procesando la transcripción de una reunión del proyecto **${p.name ?? p.slug}** (\`${p.slug}\`).

Tu tarea: producir (1) un RESUMEN ejecutivo claro en español y (2) EXACTAMENTE 2 accionables puntuales — los más importantes y ejecutables.`,
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
  parts.push(`## Reglas
- El resumen: 4-8 líneas — qué se habló, decisiones tomadas y próximos pasos. Sin relleno.
- Los 2 accionables: concretos, en imperativo, ejecutables por Rulo o por Claude Code en el repo.
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

Analiza la reunión y llama a record_meeting_result con el resumen y los 2 accionables.`;
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
    return { summary: obj.summary, actionables };
  } catch {
    return null;
  }
}

/** Título derivado de la primera oración del resumen. */
function deriveTitle(summary: string): string {
  const first = summary.split(/[.\n]/)[0]?.trim() ?? "";
  return (first || "Reunión").slice(0, 70);
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
}

const jobs = new Map<string, MeetingJob>();

export function getMeetingJob(id: string): MeetingJob | undefined {
  return jobs.get(id);
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
    try {
      let transcript = input.transcript?.trim() ?? "";
      let sttProvider: string | null = null;
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
      emit({ kind: "error", taskId: id, detail: `reunión falló: ${job.error}` });
      notifyMac("reunión", `❌ falló: ${String(err).slice(0, 80)}`);
    }
  })();

  return job;
}
