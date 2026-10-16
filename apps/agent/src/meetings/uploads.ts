/**
 * Subida de audio de juntas POR PARTES, reanudable.
 *
 * Una junta de una hora pesa 30-60 MB y la subida de un solo POST moría por el
 * túnel: Cloudflare corta a los ~100 s y el teléfono veía un 500 después de dos
 * minutos subiendo (2026-10-07, dos intentos de 45,6 MB perdidos así). Aquí
 * cada parte es una petición corta y el servidor recuerda cuántos bytes tiene:
 * si se cae la red, el teléfono pregunta y sigue desde ahí.
 *
 *   POST /meetings/uploads            {id, project, size, mime, …} → {received, jobId?}
 *   PUT  /meetings/uploads/:id?offset → bytes crudos                → {received}
 *   POST /meetings/uploads/:id/complete                             → {meeting_job_id}
 *
 * El `id` lo pone el TELÉFONO (el id de su grabación): reiniciar la app, el
 * agente o cambiar de red no crea una subida nueva. `complete` es idempotente:
 * si el job ya existe, devuelve el mismo.
 *
 * Con `liveSessionId` (la junta también se mandó EN VIVO) el `complete` no
 * crea una junta nueva: completa la del vivo (live-completion.ts) — adjunta
 * el audio o, si faltaron ≥3 s (`gapMs`), re-transcribe sobre la misma acta.
 */
import { execFile } from "node:child_process";
import { appendFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join as joinPath } from "node:path";
import { promisify } from "node:util";
import type { LiveClientKind, MeetingSource } from "@hermes/shared";
import { env } from "../env.js";
import { custodyAudioPath, newMeetingJobId, startMeetingJob } from "./ingest.js";
import { startLiveCompletionJob } from "./live-completion.js";
import { claimCompletion, isLiveSessionId, releaseCompletion } from "./live-index.js";

const run = promisify(execFile);
// Override solo para tests (no tocar ~/.hermes-os desde `pnpm test`).
const uploadsDir = () =>
  process.env.HERMES_MEETING_UPLOADS_DIR || joinPath(homedir(), ".hermes-os", "meeting-uploads");

export interface UploadMeta {
  id: string;
  project: string;
  size: number;
  mime: string;
  filename: string;
  durationSec: number | null;
  title?: string;
  createdAt: string;
  /** Job creado al completar (idempotencia de `complete`). */
  jobId?: string;
  /** Desde dónde se grabó (default web: los clientes viejos no lo mandan). */
  client?: LiveClientKind;
  /** La junta también se mandó en vivo: completar ESA en vez de crear otra. */
  liveSessionId?: string;
  /** ms de audio que no llegaron en vivo (lo mide el teléfono). */
  gapMs?: number;
}

export class UploadError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409,
    readonly received?: number,
  ) {
    super(message);
  }
}

/** Id del teléfono → nombre de carpeta seguro (nada de `..` ni barras). */
export function safeUploadId(raw: string): string | null {
  const id = String(raw ?? "").trim();
  return /^[A-Za-z0-9._-]{4,120}$/.test(id) && !id.includes("..") ? id : null;
}

const dirOf = (id: string) => joinPath(uploadsDir(), id);
const partOf = (id: string) => joinPath(dirOf(id), "data.part");
const metaOf = (id: string) => joinPath(dirOf(id), "meta.json");

async function readMeta(id: string): Promise<UploadMeta | null> {
  try {
    return JSON.parse(await readFile(metaOf(id), "utf8")) as UploadMeta;
  } catch {
    return null;
  }
}

async function received(id: string): Promise<number> {
  try {
    return (await stat(partOf(id))).size;
  } catch {
    return 0;
  }
}

// Una parte a la vez por subida: un reintento que llega mientras la parte
// original aún se escribe no puede duplicar bytes.
const locks = new Map<string, Promise<unknown>>();
function withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(id) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(
    id,
    next.catch(() => {}),
  );
  return next;
}

export async function initUpload(input: {
  id: string;
  project: string;
  size: number;
  mime: string;
  filename: string;
  durationSec: number | null;
  title?: string;
  client?: LiveClientKind;
  liveSessionId?: string;
  gapMs?: number;
}): Promise<{ received: number; jobId?: string }> {
  const id = safeUploadId(input.id);
  if (!id) throw new UploadError("id de subida inválido", 400);
  if (!input.project) throw new UploadError("project requerido", 400);
  if (!(input.size > 0)) throw new UploadError("size requerido", 400);
  if (input.liveSessionId !== undefined && !isLiveSessionId(input.liveSessionId))
    throw new UploadError("liveSessionId inválido", 400);
  if (input.gapMs !== undefined && !(Number.isFinite(input.gapMs) && input.gapMs >= 0))
    throw new UploadError("gapMs debe ser un número ≥ 0", 400);
  return withLock(id, async () => {
    const existing = await readMeta(id);
    if (existing) {
      // Mismo archivo → reanudar. Otro tamaño = el teléfono re-codificó o es
      // otra grabación con el mismo id: empezar de cero sería pisar datos, así
      // que se rechaza y el teléfono decide.
      if (existing.size !== input.size && !existing.jobId) {
        throw new UploadError(
          `la subida ${id} ya existe con otro tamaño (${existing.size} B)`,
          409,
          await received(id),
        );
      }
      if (!existing.jobId) {
        // Un init repetido puede traer datos más frescos (proyecto elegido
        // después, el gap medido al final): se actualizan sin perder bytes.
        const fresh: UploadMeta = {
          ...existing,
          project: input.project,
          ...(input.client ? { client: input.client } : {}),
          ...(input.liveSessionId ? { liveSessionId: input.liveSessionId } : {}),
          ...(input.gapMs !== undefined ? { gapMs: input.gapMs } : {}),
        };
        if (JSON.stringify(fresh) !== JSON.stringify(existing)) {
          await writeFile(metaOf(id), JSON.stringify(fresh, null, 2));
        }
      }
      return { received: existing.jobId ? existing.size : await received(id), jobId: existing.jobId };
    }
    await mkdir(dirOf(id), { recursive: true });
    const meta: UploadMeta = { ...input, id, createdAt: new Date().toISOString() };
    await writeFile(metaOf(id), JSON.stringify(meta, null, 2));
    await writeFile(partOf(id), Buffer.alloc(0));
    return { received: 0 };
  });
}

export async function appendChunk(rawId: string, offset: number, bytes: Buffer): Promise<number> {
  const id = safeUploadId(rawId);
  if (!id) throw new UploadError("id de subida inválido", 400);
  return withLock(id, async () => {
    const meta = await readMeta(id);
    if (!meta) throw new UploadError("subida no encontrada", 404);
    if (meta.jobId) return meta.size;
    const have = await received(id);
    // Parte repetida (el teléfono no vio la respuesta): ya está, no se duplica.
    if (offset + bytes.length <= have) return have;
    if (offset !== have) throw new UploadError(`offset ${offset} ≠ recibido ${have}`, 409, have);
    if (have + bytes.length > meta.size) throw new UploadError("la parte excede el tamaño declarado", 400, have);
    await appendFile(partOf(id), bytes);
    return have + bytes.length;
  });
}

/**
 * AAC ADTS (lo que graba el teléfono: sobrevive a un cierre abrupto) → M4A sin
 * re-codificar. Los proveedores de STT y los reproductores esperan MP4.
 */
async function toM4a(src: string, dest: string): Promise<boolean> {
  try {
    await run(env.FFMPEG_BIN, ["-y", "-v", "error", "-i", src, "-c", "copy", "-bsf:a", "aac_adtstoasc", dest], {
      timeout: 120_000,
    });
    return true;
  } catch (e) {
    console.error("[uploads] no pude remuxear ADTS → m4a:", e);
    return false;
  }
}

const isAdts = (meta: UploadMeta) =>
  (/aac/i.test(meta.mime) && !/mp4|m4a/i.test(meta.mime)) || /\.aac$/i.test(meta.filename);

export async function completeUpload(rawId: string): Promise<{ jobId: string; status: string }> {
  const id = safeUploadId(rawId);
  if (!id) throw new UploadError("id de subida inválido", 400);
  return withLock(id, async () => {
    const meta = await readMeta(id);
    if (!meta) throw new UploadError("subida no encontrada", 404);
    if (meta.jobId) return { jobId: meta.jobId, status: "running" };
    const have = await received(id);
    if (have !== meta.size) throw new UploadError(`faltan bytes: ${have}/${meta.size}`, 409, have);

    const jobId = newMeetingJobId();
    if (meta.liveSessionId) {
      // Una sola completación por sesión en vivo: otra subida de la misma
      // sesión (el teléfono re-codificó, cambió el id) devuelve el job que ya existe.
      const owner = await claimCompletion(meta.liveSessionId, jobId);
      if (owner !== jobId) {
        await writeFile(metaOf(id), JSON.stringify({ ...meta, jobId: owner }, null, 2));
        await rm(partOf(id), { force: true });
        return { jobId: owner, status: "running" };
      }
    }
    try {
      return await finishUpload(id, meta, jobId);
    } catch (err) {
      // El job nunca nació: soltar el reclamo para que un reintento pueda completar.
      if (meta.liveSessionId) await releaseCompletion(meta.liveSessionId, jobId);
      throw err;
    }
  });
}

async function finishUpload(
  id: string,
  meta: UploadMeta,
  jobId: string,
): Promise<{ jobId: string; status: string }> {
  let audioPath: string;
  let mime = meta.mime || "audio/mp4";
  if (isAdts(meta)) {
    const m4a = await custodyAudioPath(meta.project, jobId, "m4a");
    if (await toM4a(partOf(id), m4a)) {
      audioPath = m4a;
      mime = "audio/mp4";
      await rm(partOf(id), { force: true });
    } else {
      audioPath = await custodyAudioPath(meta.project, jobId, "aac");
      await rename(partOf(id), audioPath);
    }
  } else {
    const ext = /webm/i.test(mime) ? "webm" : /mpeg|mp3/i.test(mime) ? "mp3" : "m4a";
    audioPath = await custodyAudioPath(meta.project, jobId, ext);
    await rename(partOf(id), audioPath);
  }
  console.log(`[meetings] subida por partes ${id} completa → ${audioPath}`);

  // El job queda anotado ANTES de arrancar: un `complete` repetido devuelve
  // este mismo job en vez de crear otra junta.
  await writeFile(metaOf(id), JSON.stringify({ ...meta, jobId }, null, 2));
  if (meta.liveSessionId) {
    const job = startLiveCompletionJob({
      id: jobId,
      project: meta.project,
      audioPath,
      client: meta.client,
      live: {
        sessionId: meta.liveSessionId,
        gapMs: meta.gapMs ?? 0,
        durationSec: meta.durationSec,
        title: meta.title,
      },
    });
    return { jobId: job.id, status: job.status };
  }
  const job = startMeetingJob({
    id: jobId,
    project: meta.project,
    audio: new Blob([await readFile(audioPath)], { type: mime }),
    existingAudioPath: audioPath,
    title: meta.title,
    source: "audio" as MeetingSource,
    durationSec: meta.durationSec,
    client: meta.client,
  });
  return { jobId: job.id, status: job.status };
}
