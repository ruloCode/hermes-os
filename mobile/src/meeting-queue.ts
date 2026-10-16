/**
 * Motor de entrega de juntas: teléfono → agente → junta. Vive FUERA de las
 * pantallas (singleton + useSyncExternalStore), así que salir de Reuniones no
 * corta una subida ni un seguimiento.
 *
 * Cadena de custodia (ver memoria "juntas-nunca-se-pierden"):
 *   guardada en el teléfono → subiendo por partes (reanudable) → procesando en
 *   la Mac → junta lista → RECIÉN AHÍ se borra el audio del teléfono.
 *
 * Reglas:
 *  - Sube sola, en orden, todo lo que tiene proyecto. Si falla, reintenta con
 *    espera creciente (30 s, 2, 5, 15 min) y también al volver a la app.
 *  - Una sola subida a la vez: dos juntas de 50 MB en paralelo por datos
 *    móviles no llegan ninguna.
 *  - El servidor recuerda los bytes: reanudar nunca re-sube lo ya enviado.
 *  - Si la Mac ya tiene el audio (job viejo sin estado), NO se re-sube: se
 *    ofrece reprocesar allá o liberar el teléfono.
 */
import { useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { File } from "expo-file-system";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as api from "./hermes";
import { resolveBase } from "./config";
import * as rec from "./recordings";
import { HermesRecorder } from "../modules/hermes-recorder";
import { reportError } from "./crash";

const CHUNK = 2 * 1024 * 1024; // 2 MB: cada parte tarda segundos, no minutos
const BACKOFF_MS = [30_000, 120_000, 300_000, 900_000];
const POLL_MS = 4000;
const DONE_KEY = "hermes.recentMeetingsDone";
/** Más vieja que esto y de antes del grabador nativo = atraso: no se sube sola. */
const AUTO_WINDOW_MS = 48 * 3600 * 1000;

/**
 * ¿Se sube sola? Las del grabador nuevo (`rec-…`) y las recientes, sí. El
 * atraso viejo (había 40 pendientes el 2026-10-08) NO: subirlo de golpe gasta
 * transcripción y puede duplicar juntas que ya existen. Lo decide el usuario.
 */
function autoUpload(e: rec.PendingRecording): boolean {
  return (
    !!e.approved ||
    e.id.startsWith("rec-") ||
    Date.now() - new Date(e.createdAt).getTime() < AUTO_WINDOW_MS
  );
}

export type Phase =
  | "waiting" // en el teléfono, esperando turno o reintento
  | "held" // atraso viejo: espera que decidas (subirla cuesta transcripción)
  | "needs-project" // rescatada sin proyecto
  | "uploading"
  | "processing" // el agente la está transcribiendo/analizando
  | "on-server" // la Mac tiene el audio, pero no sabe si terminó (job viejo)
  | "failed"; // falló el análisis o la subida: hay motivo y acción

export interface QueueItem extends rec.PendingRecording {
  phase: Phase;
  /** 0..1 durante la subida. */
  progress: number;
  /** epoch ms del próximo reintento automático. */
  retryAt: number | null;
}

export interface DoneItem {
  id: string;
  project: string;
  meetingId: string;
  title: string;
  at: string;
}

interface Snapshot {
  items: QueueItem[];
  done: DoneItem[];
  /** Último error de conexión, para el aviso general. */
  offline: string | null;
}

let snapshot: Snapshot = { items: [], done: [], offline: null };
const listeners = new Set<() => void>();
const runtime = new Map<
  string,
  { phase?: Phase; progress: number; attempts: number; retryAt: number | null }
>();
let started = false;
let pumping = false;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

function rt(id: string) {
  let r = runtime.get(id);
  if (!r) {
    r = { progress: 0, attempts: 0, retryAt: null };
    runtime.set(id, r);
  }
  return r;
}

function phaseOf(e: rec.PendingRecording): Phase {
  const r = runtime.get(e.id);
  if (r?.phase === "uploading") return "uploading";
  if (e.serverHasAudio && !e.jobId) return "on-server";
  if (e.jobId) return e.lastError ? (e.jobUnknown ? "on-server" : "failed") : "processing";
  if (!e.project) return "needs-project";
  if (!autoUpload(e)) return "held";
  if (e.lastError && (r?.attempts ?? 0) >= BACKOFF_MS.length) return "failed";
  return "waiting";
}

function emit() {
  for (const l of listeners) l();
}

async function refresh(): Promise<void> {
  const list = await rec.listPending();
  snapshot = {
    ...snapshot,
    items: list.map((e) => {
      const r = runtime.get(e.id);
      return { ...e, phase: phaseOf(e), progress: r?.progress ?? 0, retryAt: r?.retryAt ?? null };
    }),
  };
  emit();
}

async function loadDone() {
  try {
    const raw = await AsyncStorage.getItem(DONE_KEY);
    snapshot = { ...snapshot, done: raw ? (JSON.parse(raw) as DoneItem[]) : [] };
  } catch {
    /* sin historial reciente no pasa nada */
  }
}

async function pushDone(d: DoneItem) {
  const done = [d, ...snapshot.done.filter((x) => x.id !== d.id)].slice(0, 8);
  snapshot = { ...snapshot, done };
  emit();
  await AsyncStorage.setItem(DONE_KEY, JSON.stringify(done)).catch(() => {});
}

const errMsg = (e: unknown) => {
  const m = e instanceof Error ? e.message : String(e);
  if (/network request failed|failed to fetch|network/i.test(m)) {
    return "sin conexión con el agente (¿la Mac está encendida y con red?)";
  }
  return m;
};

const stampNow = () =>
  new Date().toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });

// ── Subida por partes ───────────────────────────────────────────────────

async function uploadOne(e: rec.PendingRecording): Promise<void> {
  const r = rt(e.id);
  const file = new File(e.uri);
  const size = file.size;
  const mime = rec.mimeOf(e.filename);
  r.phase = "uploading";
  r.progress = 0;
  await refresh();

  let jobId: string;
  try {
    let { received, jobId: existing } = await api.initMeetingUpload({
      id: e.id,
      project: e.project!,
      size,
      mime,
      filename: e.filename,
      durationSec: e.durationSec,
    });
    if (existing) {
      jobId = existing;
    } else {
      const handle = file.open();
      try {
        let offset = received;
        while (offset < size) {
          handle.offset = offset;
          const bytes = handle.readBytes(Math.min(CHUNK, size - offset));
          try {
            offset = await api.putMeetingChunk(e.id, offset, bytes);
          } catch (err) {
            // 409 = el servidor tiene otro offset: seguir desde el suyo.
            if (err instanceof api.UploadHttpError && err.status === 409 && err.received != null) {
              offset = err.received;
            } else {
              throw err;
            }
          }
          r.progress = size ? offset / size : 1;
          await refresh();
        }
      } finally {
        handle.close();
      }
      jobId = (await api.completeMeetingUpload(e.id)).meeting_job_id;
    }
  } catch (err) {
    // Agente viejo sin /meetings/uploads → subida clásica de un solo POST.
    if (err instanceof api.UploadHttpError && err.status === 404 && r.progress === 0) {
      jobId = (
        await api.uploadMeetingAudio({
          project: e.project!,
          uri: e.uri,
          filename: e.filename,
          mime,
          durationSec: e.durationSec ?? undefined,
        })
      ).meeting_job_id;
    } else {
      throw err;
    }
  }

  r.phase = undefined;
  r.progress = 1;
  r.attempts = 0;
  r.retryAt = null;
  // El audio NO se borra aquí: 200 = "job aceptado", no "junta creada".
  await rec.patchPending(e.id, { jobId, lastError: null, serverHasAudio: true });
}

/** Sube, en orden, lo que tiene proyecto y no está en el agente. */
async function pump(): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    for (;;) {
      const list = await rec.listPending();
      const now = Date.now();
      const next = list
        .filter((e) => e.project && !e.jobId && !e.serverHasAudio && autoUpload(e))
        .filter((e) => (rt(e.id).retryAt ?? 0) <= now)
        .filter((e) => rt(e.id).attempts < BACKOFF_MS.length || rt(e.id).retryAt === 0)
        .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))[0];
      if (!next) break;
      try {
        await uploadOne(next);
        snapshot = { ...snapshot, offline: null };
      } catch (err) {
        const r = rt(next.id);
        r.phase = undefined;
        const wait = BACKOFF_MS[Math.min(r.attempts, BACKOFF_MS.length - 1)];
        r.attempts += 1;
        r.retryAt = r.attempts < BACKOFF_MS.length ? Date.now() + wait : null;
        const msg = errMsg(err);
        snapshot = { ...snapshot, offline: /sin conexión/.test(msg) ? msg : snapshot.offline };
        await rec.patchPending(next.id, { lastError: `${stampNow()} · ${msg}` });
        // Sin red no tiene sentido intentar la siguiente: esperar al reintento.
        if (/sin conexión/.test(msg)) {
          // Re-sondear LAN/túnel: la base pudo quedar vieja al cambiar de red.
          void resolveBase().catch(() => false);
          break;
        }
      }
      await refresh();
    }
  } finally {
    pumping = false;
    await refresh();
    scheduleRetry();
    schedulePoll();
  }
}

function scheduleRetry() {
  if (retryTimer) clearTimeout(retryTimer);
  const times = [...runtime.values()].map((r) => r.retryAt).filter((t): t is number => !!t);
  if (!times.length) return;
  const wait = Math.max(1000, Math.min(...times) - Date.now());
  retryTimer = setTimeout(() => void pump(), wait);
}

// ── Seguimiento de jobs ────────────────────────────────────────────────

async function pollJobs(): Promise<void> {
  const list = await rec.listPending();
  for (const e of list.filter((x) => x.jobId)) {
    try {
      const job = await api.getMeetingJob(e.jobId!);
      if (job.status === "done" && job.meetingId) {
        // Recién AHORA la junta existe en el agente → soltar el audio local.
        await rec.removePending(e.id);
        runtime.delete(e.id);
        await pushDone({
          id: e.id,
          project: e.project ?? "",
          meetingId: job.meetingId,
          title: job.title ?? "Junta",
          at: new Date().toISOString(),
        });
      } else if (job.status === "error") {
        await rec.patchPending(e.id, {
          lastError: `${stampNow()} · el análisis falló: ${job.error ?? "sin detalle"}`,
          serverHasAudio: !!job.audioOnServer,
          jobUnknown: false,
        });
      } else if (job.status === "unknown") {
        await rec.patchPending(e.id, {
          lastError: "la Mac tiene el audio, pero no sabe si la junta se creó (job de antes de una actualización)",
          serverHasAudio: true,
          jobUnknown: true,
        });
      }
    } catch (err) {
      // 404 = el agente no tiene ni el job ni el audio → hay que volver a subir.
      if (/→ 404/.test(String(err))) {
        await rec.patchPending(e.id, {
          jobId: undefined,
          serverHasAudio: false,
          lastError: `${stampNow()} · el agente no tiene esta grabación; se vuelve a subir`,
        });
      }
      /* otro error = transitorio: se reintenta en el próximo poll */
    }
  }
  await refresh();
  void pump();
}

function schedulePoll() {
  if (pollTimer) clearTimeout(pollTimer);
  const processing = snapshot.items.some((i) => i.phase === "processing");
  if (!processing || AppState.currentState !== "active") return;
  pollTimer = setTimeout(() => void pollJobs().finally(schedulePoll), POLL_MS);
}

// ── API pública ────────────────────────────────────────────────────────

/** Trae al índice lo que el grabador nativo terminó (app, notificación o cierre). */
export async function syncNative(): Promise<void> {
  if (!HermesRecorder) return;
  let finished: ReturnType<typeof HermesRecorder.getState>["finished"];
  try {
    finished = HermesRecorder.getState().finished ?? [];
  } catch {
    return;
  }
  const ids = await rec.ingestNativeFinished(finished);
  if (ids.length) HermesRecorder.ack(ids);
  await refresh();
}

/** Arranque único (raíz de la app). */
export function startMeetingQueue(): void {
  if (started) return;
  started = true;
  // Ningún fallo del arranque puede cerrar la app: se reporta y se sigue.
  void (async () => {
    try {
      await loadDone();
      await syncNative();
      await rec.adoptOrphans().catch(() => 0);
      await refresh();
      await pollJobs();
    } catch (e) {
      reportError(e, "error");
    }
  })();
  AppState.addEventListener("change", (s) => {
    if (s !== "active") return;
    // Volver a la app = buen momento para todo: puede haber red nueva.
    for (const r of runtime.values()) if (r.attempts < BACKOFF_MS.length) r.retryAt = 0;
    void syncNative().then(pollJobs);
  });
  HermesRecorder?.addListener("onStatus", (s) => {
    if (s.finished.length) void syncNative().then(() => pump());
  });
}

/** Reintento manual: salta la espera y reinicia el contador. */
export async function retryNow(id: string, project?: string | null): Promise<void> {
  if (project) await rec.patchPending(id, { project });
  const r = rt(id);
  r.attempts = 0;
  r.retryAt = 0;
  const e = (await rec.listPending()).find((x) => x.id === id);
  // Falló el ANÁLISIS con el audio en la Mac → reprocesar allá, no re-subir.
  if (e?.jobId && e.serverHasAudio) {
    await reprocessOnServer(id);
    return;
  }
  await rec.patchPending(id, {
    lastError: null,
    jobId: undefined,
    serverHasAudio: false,
    approved: true,
  });
  await refresh();
  void pump();
}

/** "Subir todas": aprueba el atraso que ya tiene proyecto. */
export async function approveAll(ids: string[]): Promise<void> {
  for (const id of ids) {
    await rec.patchPending(id, { approved: true });
    const r = rt(id);
    r.attempts = 0;
    r.retryAt = 0;
  }
  await refresh();
  void pump();
}

export async function setProject(id: string, project: string): Promise<void> {
  // Elegir proyecto a mano = decidir que se sube.
  await rec.patchPending(id, { project, approved: true });
  await refresh();
  void pump();
}

/** Solo anota el proyecto (sin decidir subirla todavía). */
export async function setProjectOnly(id: string, project: string): Promise<void> {
  await rec.patchPending(id, { project });
  await refresh();
  void pump();
}

/** La Mac ya tiene el audio: reprocesa allá (cero bytes por la red). */
export async function reprocessOnServer(id: string): Promise<void> {
  const e = (await rec.listPending()).find((x) => x.id === id);
  if (!e?.jobId) throw new Error("Esta grabación no tiene job en la Mac.");
  if (!e.project) throw new Error("Elige un proyecto antes de reprocesar.");
  const { meeting_job_id } = await api.retryMeetingJob(e.jobId, e.project, e.durationSec);
  await rec.patchPending(id, {
    jobId: meeting_job_id,
    lastError: null,
    serverHasAudio: true,
    jobUnknown: false,
  });
  await refresh();
  schedulePoll();
}

/** Quita del teléfono (la Mac tiene copia, o el usuario la descarta). */
export async function removeLocal(id: string): Promise<void> {
  await rec.removePending(id);
  runtime.delete(id);
  await refresh();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getSnapshot(): Snapshot {
  return snapshot;
}

export function useMeetingQueue(): Snapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Despierta el motor (p.ej. justo después de detener una grabación). */
export function kick(): void {
  void syncNative().then(() => pump());
}
