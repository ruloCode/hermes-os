/**
 * Completar una junta EN VIVO con el archivo del teléfono, sin duplicarla.
 *
 * Hermes Phone graba el audio local (AAC) Y lo manda en vivo por el WS. Al
 * terminar sube el archivo completo con `liveSessionId` + `gapMs` (ms que no
 * llegaron en vivo). Este job (mismo store durable que el resto: GET
 * /meetings/jobs/:id funciona igual) decide con `planLiveCompletion`:
 *
 *   esperando_junta → la sesión aún ingesta (poll 5 s, tope 20 min, sobrevive reinicios)
 *   adjuntando      → acta lista y hueco < 3 s: el audio queda en custodia de ESA acta
 *   retranscribiendo→ hueco ≥ 3 s: STT batch del archivo y re-ingesta SOBRE la misma acta
 *   flujo_normal    → sin acta (o sesión desconocida): junta nueva desde el audio, una vez
 */
import { readFile, unlink } from "node:fs/promises";
import type { LiveClientKind } from "@hermes/shared";
import { emit } from "../events.js";
import { notifyMac } from "../notify.js";
import {
  getMeetingJobDurable,
  ingestMeeting,
  listPersistedMeetingJobs,
  MIN_SPOKEN_WORDS,
  spokenWords,
  startMeetingJob,
  trackMeetingJob,
  type LiveCompletionInfo,
  type MeetingJob,
} from "./ingest.js";
import { findLiveSnapshotFile, getLiveMeeting } from "./live.js";
import { getLiveOutcome } from "./live-index.js";
import { planLiveCompletion, type LiveCompletionPlan } from "./live-completion-plan.js";
import { annotateMeeting, readMeetingForRewrite } from "./store.js";
import { transcribe } from "./stt.js";

const POLL_MS = 5_000;
/** Jobs con su bucle corriendo en este proceso (retomar + reintentar no los duplica). */
const active = new Set<string>();

const mimeOf = (path: string) => {
  const ext = path.split(".").pop()?.toLowerCase() ?? "m4a";
  return ext === "webm"
    ? "audio/webm"
    : ext === "mp3"
      ? "audio/mpeg"
      : ext === "aac"
        ? "audio/aac"
        : "audio/mp4";
};

export function startLiveCompletionJob(input: {
  id: string;
  /** Proyecto que eligió el teléfono (solo se usa si cae al flujo normal). */
  project: string;
  audioPath: string;
  /** Lo que declaró el teléfono (undefined en apps viejas: no se inventa). */
  client?: LiveClientKind;
  live: Omit<LiveCompletionInfo, "waitingSince">;
}): MeetingJob {
  const job: MeetingJob = {
    id: input.id,
    project: input.project,
    status: "running",
    startedAt: new Date().toISOString(),
    title: input.live.title,
    audioPath: input.audioPath,
    ...(input.client ? { client: input.client } : {}),
    kind: "live-completion",
    live: { ...input.live, waitingSince: new Date().toISOString() },
    stage: "esperando_junta",
  };
  trackMeetingJob(job);
  emit({
    kind: "task_start",
    taskId: job.id,
    detail: `audio del teléfono para la junta en vivo ${input.live.sessionId}`,
  });
  launch(job);
  return job;
}

/** Al arrancar: retoma los jobs que un reinicio dejó esperando/adjuntando/re-transcribiendo. */
export async function resumeLiveCompletionJobs(): Promise<void> {
  const pending = (await listPersistedMeetingJobs()).filter(
    (j) =>
      j.kind === "live-completion" &&
      j.status === "running" &&
      j.stage !== "flujo_normal" && // el flujo normal ya creó (o creaba) una junta: no se repite
      j.live &&
      j.audioPath,
  );
  for (const job of pending) {
    console.log(`[meetings] retomando completación ${job.id} (sesión ${job.live?.sessionId}, ${job.stage})`);
    trackMeetingJob(job);
    launch(job);
  }
}

/**
 * Reintento de un job de completación que falló (POST /meetings/jobs/:id/retry).
 * null = no es un job de completación (el caller sigue con el reintento normal).
 */
export async function retryLiveCompletion(id: string): Promise<MeetingJob | null> {
  const job = await getMeetingJobDurable(id);
  if (!job || job.kind !== "live-completion" || !job.live) return null;
  if (job.status === "done" || active.has(id)) return job;
  if (!job.audioPath) throw new Error(`la Mac no tiene el audio del job ${id}`);
  const again: MeetingJob = {
    ...job,
    status: "running",
    error: undefined,
    finishedAt: undefined,
    stage: "esperando_junta",
    live: { ...job.live, waitingSince: new Date().toISOString() },
  };
  trackMeetingJob(again);
  launch(again);
  return again;
}

function launch(job: MeetingJob): void {
  if (active.has(job.id)) return;
  active.add(job.id);
  void run(job)
    .catch((err) => fail(job, err))
    .finally(() => active.delete(job.id));
}

type FinalPlan = Exclude<LiveCompletionPlan, { action: "wait" }>;

/** Espera (poll) hasta que la sesión en vivo tenga un desenlace; project = donde vive su acta. */
async function nextPlan(job: MeetingJob): Promise<{ plan: FinalPlan; project?: string }> {
  const info = job.live!;
  for (;;) {
    const snap = getLiveMeeting(info.sessionId);
    const indexed = await getLiveOutcome(info.sessionId);
    const plan = planLiveCompletion({
      session: snap ? { status: snap.status, meetingId: snap.meetingId, coachMode: snap.coachMode } : undefined,
      indexed,
      orphanSnapshot: !!(await findLiveSnapshotFile(info.sessionId)),
      gapMs: info.gapMs,
      waitedMs: Date.now() - Date.parse(info.waitingSince),
    });
    if (plan.action !== "wait") return { plan, project: snap?.project ?? indexed?.project };
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

function update(job: MeetingJob, patch: Partial<MeetingJob>): void {
  Object.assign(job, patch);
  trackMeetingJob(job);
}

async function run(job: MeetingJob): Promise<void> {
  const info = job.live!;
  const next = await nextPlan(job);
  const plan = next.plan;
  if (plan.action === "new_meeting") return fallback(job, plan.reason);
  const project = next.project ?? job.project;
  if (plan.action === "attach") return attach(job, project, plan.meetingId, plan.note);

  // Re-ingesta SOBRE la misma acta: el teléfono tiene el audio entero y al vivo le faltó un pedazo.
  update(job, { stage: "retranscribiendo", project });
  const base = await readMeetingForRewrite(project, plan.meetingId);
  if (!base) return fallback(job, `el acta ${plan.meetingId} ya no está en el vault`);
  const gapS = Math.round(info.gapMs / 1000);
  try {
    emit({ kind: "tool_call", taskId: job.id, toolName: "transcribir", detail: `audio del teléfono (${gapS} s faltaron en vivo)` });
    const r = await transcribe(new Blob([await readFile(job.audioPath!)], { type: mimeOf(job.audioPath!) }));
    if (spokenWords(r.text) < MIN_SPOKEN_WORDS) {
      throw new Error(`la transcripción del archivo casi no tiene voz (${spokenWords(r.text)} palabras)`);
    }
    const notice = `Transcripción rehecha desde el audio del teléfono: ${gapS} s no llegaron en vivo.`;
    const meeting = await ingestMeeting({
      project: base.slug,
      transcript: r.text,
      source: "live",
      sttProvider: r.provider,
      durationSec: info.durationSec,
      taskId: job.id,
      client: base.client ?? job.client,
      rewrite: {
        base,
        notice,
        extraFrontmatter: {
          transcripcion_rehecha: { fecha: new Date().toISOString(), hueco_s: gapS, job: job.id },
          audio_telefono: job.audioPath,
        },
      },
    });
    finish(job, {
      meetingId: meeting.id,
      title: meeting.title,
      outcome: "reingested",
      note: notice + (base.triaged ? " Los accionables ya estaban triados y se conservaron." : ""),
    });
  } catch (err) {
    // El acta en vivo sigue siendo válida y el audio ya está en la Mac: el job
    // termina adjuntando (el teléfono puede soltar su copia) y dice qué falló.
    console.error(`[meetings] no pude rehacer la junta ${plan.meetingId}:`, err);
    return attach(
      job,
      project,
      plan.meetingId,
      `no se pudo rehacer la transcripción (${String(err instanceof Error ? err.message : err).slice(0, 160)}); el acta en vivo quedó como estaba y el audio quedó adjunto — reintenta con POST /meetings/jobs/${job.id}/retry`,
    );
  }
}

async function attach(job: MeetingJob, project: string, meetingId: string, note?: string): Promise<void> {
  update(job, { stage: "adjuntando", project });
  // Clase de inglés: no hay .md de junta (vive en english_sessions); el
  // vínculo es el job mismo (meetingId english-N + audioPath).
  if (!meetingId.startsWith("english-")) {
    await annotateMeeting(project, meetingId, { audio_telefono: job.audioPath, audio_job: job.id });
  }
  finish(job, { meetingId, outcome: "attached", note });
}

function finish(job: MeetingJob, patch: Partial<MeetingJob>): void {
  update(job, { ...patch, status: "done", finishedAt: new Date().toISOString() });
  const what =
    job.outcome === "reingested" ? "transcripción rehecha" : "audio adjunto";
  emit({ kind: "task_done", taskId: job.id, detail: `junta en vivo ${job.live?.sessionId}: ${what}` });
  if (job.outcome === "reingested") notifyMac("reunión", `✅ ${job.title ?? job.meetingId}: ${what}`);
}

async function fallback(job: MeetingJob, reason: string): Promise<void> {
  const info = job.live!;
  // Si el recover del boot aún tiene el snapshot, se descarta: el audio del
  // teléfono es la versión completa y dos actas de la misma junta es peor.
  const snap = getLiveMeeting(info.sessionId);
  if (!snap || snap.status === "error" || snap.status === "done") {
    const orphan = await findLiveSnapshotFile(info.sessionId);
    if (orphan) await unlink(orphan).catch(() => undefined);
  }
  console.log(`[meetings] completación ${job.id} → flujo normal: ${reason}`);
  const data = await readFile(job.audioPath!);
  startMeetingJob({
    id: job.id,
    project: job.project,
    audio: new Blob([data], { type: mimeOf(job.audioPath!) }),
    existingAudioPath: job.audioPath,
    title: info.title,
    source: "audio",
    durationSec: info.durationSec,
    client: job.client,
    meta: { kind: "live-completion", live: info, stage: "flujo_normal", note: `junta nueva desde el audio: ${reason}` },
  });
}

function fail(job: MeetingJob, err: unknown): void {
  console.error(`[meetings] completación ${job.id} falló:`, err);
  update(job, {
    status: "error",
    error: String(err instanceof Error ? err.message : err).slice(0, 300),
    finishedAt: new Date().toISOString(),
  });
  emit({ kind: "error", taskId: job.id, detail: `completar junta en vivo falló: ${job.error}` });
}
