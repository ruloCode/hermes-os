/**
 * Procesamiento de una SESIÓN de composición: un job por sesión que recorre
 * las etapas del contrato en orden (SESSION_STAGES) con estado real
 * persistido — status, pct y detalle salen de lo que de verdad está pasando.
 *
 *   copiar → audio → transcribir → resumen → pasajes → separar → melodia
 *
 * Reglas:
 *  - Reanudar desde cualquier etapa (las anteriores quedan como están).
 *  - Detener es real: mata ffmpeg / python / el turno del SDK.
 *  - Un pasaje que falla no tumba la sesión; una etapa "blanda" (transcribir,
 *    resumen, separar) que falla tampoco: la siguiente trabaja con lo que hay.
 *  - Los jobs viven en memoria: al arrancar el agente, lo que quedó
 *    "corriendo" se marca como error con el motivo (reconcileComposicion).
 *
 * TOMAS de un tema (`session.take`): la misma tubería con ramas propias —
 * nada sale del equipo salvo que se pida (`take.stt`), no hay resumen, el
 * único pasaje es la toma entera (P01), solo se separa si se grabó con
 * parlantes, y la melodía se lee EN LA REJILLA con la que se grabó
 * (buildTakeAnalysis): el tempo no se adivina, se sabe.
 */
import { existsSync } from "node:fs";
import { copyFile, link, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import {
  SESSION_STAGES,
  SESSION_STAGE_LABEL,
  acousticSeconds,
  anchorSyllables,
  analyzeOnGrid,
  applyHint,
  buildPhrases,
  classifyPassage,
  detectPassages,
  downsampleF0,
  estimateKey,
  estimateTuningCents,
  estimateVowel,
  keyLabel,
  metricWeight,
  midiToHz,
  peaksOf,
  pitchClassProfile,
  pitchTracker,
  segmentNotes,
  sessionSlug,
  syllablesFromTrack,
  toGrid,
  vowelOfText,
  type AcousticSecond,
  type ComposeSession,
  type KeyEstimate,
  type MelodyNote,
  type Passage,
  type PassageAnalysis,
  type PassageCandidate,
  type PitchOptions,
  type PitchTrack,
  type SessionStage,
  type StageState,
  type SungSyllable,
  type TakeGrid,
  type TakeMeta,
  type TimedWord,
  type TranscriptWord,
} from "@hermes/shared";
import { emit } from "../events.js";
import { env } from "../env.js";
import {
  AbortedError,
  SEPARATION_PAD_SEC,
  SEP_INPUT,
  adoptableFolder,
  cleanOrphanSepInputs,
  isSeparated,
  copyVerified,
  cutWav,
  decodePcm,
  ensureSessionFolder,
  extractSessionAudio,
  mediaRoot,
  probeMedia,
  sessionPeaks,
  takeMediaDir,
  temasMediaRoot,
  validateImportPath,
} from "./media.js";
import { separatePassages, separatorAvailable, type SeparationResult } from "./separator.js";
import {
  ComposicionNotFoundError,
  alignLyricsToAnalysis,
  createSessionRecord,
  freshStages,
  hasLyricContent,
  isSafeId,
  listSessions,
  listTemas,
  patchSession,
  readAnalysis,
  readBoard,
  readSession,
  readTema,
  readTranscript,
  removeAnalysis,
  sessionExists,
  withLock,
  writeAnalysis,
  writeTranscript,
} from "./store.js";
import { summarizeSession } from "./summary.js";
import { clock, computeSpeakers, sttAvailable, transcribeSession } from "./transcribe.js";

/** Frecuencia a la que se analiza la altura (YIN: hop 160 = 10 ms). */
const ANALYSIS_SR = 16000;
/** Resolución de la curva de altura que se guarda para dibujar. */
const F0_HOP = 0.02;
/** Cubetas de la onda de un pasaje. */
const PASSAGE_PEAKS = 400;
/** Umbrales de la detección (contrato de detectPassages). */
const PROBABLE_MIN = 0.35;
const DUDOSO_MIN = 0.2;
/** Etapas sin las cuales no hay nada que hacer después. */
const FATAL_STAGES = new Set<SessionStage>(["copiar", "audio", "pasajes"]);
/** El único pasaje de una toma: la toma entera. */
export const TAKE_PASSAGE = "P01";
/** Por qué una toma no acepta pasajes nuevos ni editados: su rejilla se lee sobre la toma ENTERA. */
export const TAKE_ONE_PASSAGE = "una toma tiene un solo pasaje";
/**
 * Cuadros de YIN entre cesiones del event loop: 500 cuadros = 5 s de audio ≈
 * 30 ms de CPU. Una sesión de 20 min sin ceder congelaba el agente ~8 s
 * (poll del dashboard, WS de la junta en vivo, jobs: todo en el mismo hilo).
 */
const PITCH_CHUNK_FRAMES = 500;
/**
 * Bajo esta confianza la vocal estimada por formantes NO se guarda: una vocal
 * inventada contamina el eco fonético de la letra, y "sin vocal" es honesto
 * (el humano la puede escribir en la pista de texto, que siempre manda).
 * La escala de estimateVowel es chica (separación relativa × ajuste × cuadros
 * con formantes × castigo por f0 alto). Medido con vocales sintéticas a
 * 220 Hz: una /a/ con formantes reales sale bien con 0,23; un tono SIN
 * formantes se lee mal (/o/) con 0,12. El corte va entre los dos.
 */
const MIN_VOWEL_CONFIDENCE = 0.2;

type StageOutcome = { status: "listo" | "omitido"; detail?: string };

interface StageCtx {
  id: string;
  signal: AbortSignal;
  progress: (pct: number, detail?: string) => void;
}

// ─────────────────────────── Jobs en memoria ───────────────────────────

/** Trabajo vivo por sesión: el pipeline y los análisis sueltos de pasajes. */
const controllers = new Map<string, Set<AbortController>>();
/** Cola por sesión: pipeline y análisis de pasajes nunca compiten por la GPU. */
const queues = new Map<string, Promise<unknown>>();
const pipelines = new Set<string>();

function track(id: string, abort: AbortController): () => void {
  const set = controllers.get(id) ?? new Set();
  set.add(abort);
  controllers.set(id, set);
  return () => {
    set.delete(abort);
    if (!set.size) controllers.delete(id);
  };
}

function enqueue<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(id) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.catch(() => undefined);
  queues.set(id, tail);
  void tail.then(() => {
    if (queues.get(id) === tail) queues.delete(id);
  });
  return run;
}

const taskId = (id: string) => `composicion-${id}`;

// ─────────────────────────── Alta de sesiones ───────────────────────────

/** Fecha CALENDARIO local (la cámara escribe UTC: 22:13 en Bogotá es 03:13Z del día siguiente). */
export function localDate(iso: string): Date {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: env.SCHEDULED_TZ }).format(new Date(iso));
  return new Date(`${day}T12:00:00Z`);
}

async function uniqueId(base: string, root?: string): Promise<string> {
  let id = base;
  for (let n = 2; (await sessionExists(id)) || (root && existsSync(join(root, id))); n++) id = `${base}-${n}`;
  return id;
}

/** Si la misma fuente ya se importó, se devuelve esa sesión (nada de duplicados). */
async function findBySource(path: string): Promise<ComposeSession | null> {
  for (const s of await listSessions()) {
    if (s.source.path === path) return readSession(s.id);
  }
  return null;
}

const realOr = (p: string) => realpath(p).catch(() => resolve(p));

/** La sesión que ya vive en esa carpeta de medios (comparando rutas reales), o null. */
async function sessionInFolder(dir: string): Promise<ComposeSession | null> {
  const target = await realOr(dir);
  for (const sum of await listSessions()) {
    const s = await readSession(sum.id);
    if (s && (await realOr(s.mediaDir)) === target) return s;
  }
  return null;
}

export class ImportError extends Error {
  constructor(
    message: string,
    public status: 400 | 404 | 409 = 400,
  ) {
    super(message);
  }
}

/**
 * Importa un archivo del disco (video de la cámara o audio). Si ya está en
 * la carpeta de una sesión (<raíz>/<x>/crudos/) se ADOPTA sin copiar — salvo
 * que OTRA sesión ya viva en esa carpeta: dos sesiones en la misma carpeta se
 * pisan assets/session.wav, peaks.json y analisis/<pid>/ (P01 de una es P01
 * de la otra). Ahí se copia (verificado) a una carpeta propia. Si no, la etapa
 * "copiar" lo trae con md5 verificado. Arranca el procesamiento.
 */
export async function createSessionFromPath(input: {
  path: string;
  title?: string;
  language?: ComposeSession["language"];
  songId?: string;
}): Promise<ComposeSession> {
  let src: string;
  try {
    src = await validateImportPath(input.path);
  } catch (err) {
    throw new ImportError((err as Error).message, (err as { status?: number }).status === 404 ? 404 : 400);
  }
  // Decidir carpeta e id y escribir el registro van juntos: dos importaciones
  // a la vez no deben adoptar la misma carpeta ni elegir el mismo id.
  return withLock("composicion:importar", () => importLocked(src, input));
}

async function importLocked(
  src: string,
  input: { title?: string; language?: ComposeSession["language"]; songId?: string },
): Promise<ComposeSession> {
  const existing = await findBySource(src);
  if (existing) return existing;

  let probe;
  try {
    probe = await probeMedia(src);
  } catch (err) {
    throw new ImportError(`no se pudo leer el archivo con ffprobe: ${String(err).slice(0, 160)}`);
  }
  if (!probe.audio) throw new ImportError("el archivo no tiene pista de audio");
  const st = await stat(src);
  const recordedAt = probe.recordedAt ?? st.mtime.toISOString();
  const title = input.title?.trim() || basename(src, extname(src));
  let adopt = await adoptableFolder(src);
  if (adopt) {
    const owner = await sessionInFolder(adopt.dir);
    if (owner) {
      // Es el MISMO archivo que esa sesión usa como original (llegó por otra ruta): es esa sesión.
      if (owner.files.original && (await realOr(join(owner.mediaDir, owner.files.original))) === (await realOr(src)))
        return owner;
      adopt = null;
    }
  }

  let id: string;
  let mediaDir: string;
  let kind: ComposeSession["mediaRoot"];
  if (adopt) {
    mediaDir = adopt.dir;
    kind = adopt.kind;
    // La carpeta ya es la sesión: su nombre es el id (disco y estado quedan alineados).
    id = isSafeId(adopt.folder) && !(await sessionExists(adopt.folder))
      ? adopt.folder
      : await uniqueId(sessionSlug(title, localDate(recordedAt)));
  } else {
    const root = mediaRoot();
    id = await uniqueId(sessionSlug(title, localDate(recordedAt)), root.root);
    mediaDir = join(root.root, id);
    kind = root.kind;
  }
  const now = new Date().toISOString();
  const session: ComposeSession = {
    id,
    title,
    createdAt: now,
    updatedAt: now,
    recordedAt,
    source: {
      path: src,
      name: basename(src),
      bytes: st.size,
      kind: src.includes("/DCIM/") ? "camara" : "archivo",
    },
    mediaDir,
    mediaRoot: kind,
    files: adopt ? { original: join("crudos", basename(src)) } : {},
    ...(probe.durationSec ? { durationSec: probe.durationSec } : {}),
    ...(probe.video ? { video: probe.video } : {}),
    language: input.language ?? "auto",
    status: "procesando",
    stages: freshStages(),
    speakers: [],
    passages: [],
    ...(input.songId ? { songId: input.songId } : {}),
  };
  await ensureSessionFolder(mediaDir);
  await createSessionRecord(session);
  startPipeline(id);
  return session;
}

/** Memo grabado en el dashboard: aterriza directo en crudos/ de una sesión nueva. */
export async function createSessionFromRecording(input: {
  bytes: Uint8Array;
  ext: string;
  title?: string;
  /** El idioma que eligió el humano al grabar (Scribe lo usa como pista). */
  language?: "es" | "en" | "auto";
}): Promise<ComposeSession> {
  const ext = input.ext.replace(/[^a-z0-9]/gi, "").toLowerCase() || "webm";
  const now = new Date();
  const title = input.title?.trim() || `Memo ${new Intl.DateTimeFormat("es-CO", { timeZone: env.SCHEDULED_TZ, dateStyle: "medium", timeStyle: "short" }).format(now)}`;
  const root = mediaRoot();
  const id = await uniqueId(sessionSlug(title, localDate(now.toISOString())), root.root);
  const mediaDir = join(root.root, id);
  await ensureSessionFolder(mediaDir);
  const name = `memo.${ext}`;
  const path = join(mediaDir, "crudos", name);
  await writeFile(path, input.bytes);
  let probe: Awaited<ReturnType<typeof probeMedia>> = {};
  try {
    probe = await probeMedia(path);
  } catch {
    /* webm de MediaRecorder sin duración en el header: la etapa de audio la mide */
  }
  const session: ComposeSession = {
    id,
    title,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    recordedAt: now.toISOString(),
    source: { path, name, bytes: input.bytes.length, kind: "microfono" },
    mediaDir,
    mediaRoot: root.kind,
    files: { original: join("crudos", name) },
    ...(probe.durationSec ? { durationSec: probe.durationSec } : {}),
    language: input.language ?? "auto",
    status: "procesando",
    stages: freshStages(),
    speakers: [],
    passages: [],
  };
  await createSessionRecord(session);
  startPipeline(id);
  return session;
}

/**
 * TOMA de un tema: el WAV que grabó el browser encima de la pista aterriza en
 * crudos/ de la carpeta de la toma (<temas>/<temaId>/tomas/<id>/) y arranca
 * la tubería con las ramas de toma. La validación (WAV, meta, número de toma)
 * la hace temas.ts antes de llamar aquí.
 */
export async function createTakeSession(input: {
  bytes: Uint8Array;
  title: string;
  /** Texto del que sale el id (legible en disco: "toma 2 coro <tema>"). */
  slug: string;
  take: TakeMeta;
  durationSec: number;
}): Promise<ComposeSession> {
  const root = temasMediaRoot();
  const now = new Date();
  const tomas = join(root.root, input.take.temaId, "tomas");
  const id = await uniqueId(sessionSlug(input.slug, localDate(now.toISOString())), tomas);
  const mediaDir = takeMediaDir(root.root, input.take.temaId, id);
  await ensureSessionFolder(mediaDir);
  const name = "toma.wav";
  const path = join(mediaDir, "crudos", name);
  await writeFile(path, input.bytes);
  const session: ComposeSession = {
    id,
    title: input.title,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    recordedAt: now.toISOString(),
    source: { path, name, bytes: input.bytes.length, kind: "microfono" },
    mediaDir,
    mediaRoot: root.kind,
    files: { original: join("crudos", name) },
    durationSec: round3(input.durationSec),
    // Los fonemas son español (o relleno): si se pide Scribe, que no adivine.
    language: "es",
    status: "procesando",
    stages: freshStages(),
    speakers: [],
    passages: [],
    take: input.take,
  };
  await createSessionRecord(session);
  startPipeline(id);
  return session;
}

// ─────────────────────────── Correr / detener ───────────────────────────

/**
 * Arranca (o reanuda) el pipeline. Sin `from`, desde la primera etapa que no
 * está lista; con `from`, rehace esa etapa y las siguientes.
 */
export async function processSession(
  id: string,
  from?: SessionStage,
): Promise<{ ok: boolean; error?: string; status?: 400 | 404 | 409 }> {
  const s = await readSession(id);
  if (!s) return { ok: false, error: "sesión no encontrada", status: 404 };
  if (pipelines.has(id)) return { ok: false, error: "la sesión ya se está procesando", status: 409 };
  if (from && !SESSION_STAGES.includes(from)) return { ok: false, error: `etapa inválida: ${from}`, status: 400 };
  if (!from && !s.stages.some((st) => st.status !== "listo" && st.status !== "omitido"))
    return {
      ok: false,
      error: "la sesión ya está procesada; manda `from` para rehacer una etapa",
      status: 400,
    };
  startPipeline(id, from);
  return { ok: true };
}

function startPipeline(id: string, from?: SessionStage): void {
  pipelines.add(id);
  const abort = new AbortController();
  const untrack = track(id, abort);
  void enqueue(id, () => runPipeline(id, from, abort.signal))
    .catch((err) => console.error(`[composicion] pipeline ${id}:`, err))
    .finally(() => {
      untrack();
      pipelines.delete(id);
    });
}

/** ¿Hay trabajo vivo en la sesión (pipeline o análisis de un pasaje)? */
export function sessionBusy(id: string): boolean {
  return pipelines.has(id) || (controllers.get(id)?.size ?? 0) > 0;
}

/** Espera a que la cola de la sesión se vacíe (tests y scripts: nada queda escribiendo). */
export async function whenIdle(id: string): Promise<void> {
  let seen: Promise<unknown> | undefined;
  for (;;) {
    const q = queues.get(id);
    // La misma cola ya esperada = nada nuevo encolado detrás.
    if (!q || q === seen) return;
    seen = q;
    await q;
  }
}

export async function stopSession(id: string): Promise<{ ok: boolean; error?: string }> {
  const set = controllers.get(id);
  if (!set?.size) return { ok: false, error: "no hay nada corriendo en esta sesión" };
  for (const c of set) c.abort();
  return { ok: true };
}

async function setStage(id: string, stage: SessionStage, patch: Partial<StageState>): Promise<void> {
  await patchSession(id, (s) => {
    const i = s.stages.findIndex((st) => st.stage === stage);
    const base: StageState = i >= 0 ? s.stages[i] : { stage, status: "pendiente" };
    const next = { ...base, ...patch, stage };
    for (const k of Object.keys(next) as (keyof StageState)[]) if (next[k] === undefined) delete next[k];
    if (i >= 0) s.stages[i] = next;
    else s.stages.push(next);
  });
}

async function runPipeline(id: string, from: SessionStage | undefined, signal: AbortSignal): Promise<void> {
  const s0 = await readSession(id);
  if (!s0) return;
  // Sesiones viejas: garantiza las etapas del contrato en su orden.
  const stages = SESSION_STAGES.map((stage) => s0.stages.find((st) => st.stage === stage) ?? { stage, status: "pendiente" as const });
  let startIdx = from
    ? SESSION_STAGES.indexOf(from)
    : stages.findIndex((st) => st.status !== "listo" && st.status !== "omitido");
  if (startIdx < 0) startIdx = 0;

  await patchSession(id, (s) => {
    s.status = "procesando";
    s.stages = stages.map((st, i) => (i >= startIdx ? { stage: st.stage, status: "pendiente" } : st));
  });
  emit({ private: true, kind: "task_start", taskId: taskId(id), detail: "Composición: procesando una sesión" });

  for (const stage of SESSION_STAGES.slice(startIdx)) {
    if (signal.aborted) break;
    const startedAt = new Date().toISOString();
    await setStage(id, stage, { status: "corriendo", startedAt, pct: 0 });
    emit({ private: true, kind: "tool_call", taskId: taskId(id), toolName: `composicion_${stage}`, detail: SESSION_STAGE_LABEL[stage] });
    const t0 = Date.now();
    const progress = throttledProgress(id, stage);
    try {
      const out = await STAGES[stage]({ id, signal, progress: progress.push });
      await progress.flush();
      await setStage(id, stage, {
        status: out.status,
        detail: out.detail,
        pct: out.status === "listo" ? 1 : undefined,
        endedAt: new Date().toISOString(),
      });
      console.log(`[composicion] ${id} · ${stage} ${out.status} en ${((Date.now() - t0) / 1000).toFixed(1)} s${out.detail ? ` · ${out.detail}` : ""}`);
    } catch (err) {
      await progress.flush();
      if (signal.aborted || err instanceof AbortedError) {
        await setStage(id, stage, { status: "pendiente", detail: "detenida a mitad", pct: undefined });
        await markAnalyzingAs(id, "pendiente");
        await patchSession(id, (s) => void (s.status = "detenida"));
        emit({ private: true, kind: "task_done", taskId: taskId(id), detail: `Composición: sesión detenida en ${SESSION_STAGE_LABEL[stage]}` });
        return;
      }
      const msg = (err as Error).message ?? String(err);
      console.error(`[composicion] ${id} · ${stage} falló:`, msg);
      await setStage(id, stage, { status: "error", error: msg.slice(0, 400), endedAt: new Date().toISOString() });
      emit({ private: true, kind: "error", taskId: taskId(id), toolName: `composicion_${stage}`, detail: msg.slice(0, 200) });
      if (FATAL_STAGES.has(stage)) {
        await patchSession(id, (s) => void (s.status = "error"));
        return;
      }
    }
  }
  if (signal.aborted) {
    await patchSession(id, (s) => void (s.status = "detenida"));
    return;
  }
  const done = await patchSession(id, (s) => void (s.status = "lista"));
  const probable = done.passages.filter((p) => p.group === "probable").length;
  emit({
    private: true,
    kind: "task_done",
    taskId: taskId(id),
    detail: `Composición: sesión lista · ${probable} pasajes probables${done.key ? ` · ${keyLabel(done.key.best.key, "latin")}` : ""}`,
  });
}

/** El progreso persiste a lo sumo 1 vez por segundo (el callback de copiar llega por chunk). */
function throttledProgress(id: string, stage: SessionStage) {
  let pending: { pct: number; detail?: string } | null = null;
  let last = 0;
  let writing: Promise<void> = Promise.resolve();
  const write = () => {
    if (!pending) return;
    const p = pending;
    pending = null;
    last = Date.now();
    writing = writing.then(() =>
      setStage(id, stage, { pct: Math.round(p.pct * 1000) / 1000, ...(p.detail ? { detail: p.detail } : {}) }).catch(() => {}),
    );
  };
  return {
    push(pct: number, detail?: string) {
      pending = { pct, detail };
      if (Date.now() - last > 1000) write();
    },
    async flush() {
      await writing;
    },
  };
}

async function markAnalyzingAs(id: string, status: Passage["status"]): Promise<void> {
  await patchSession(id, (s) => {
    for (const p of s.passages) if (p.status === "analizando") p.status = status;
  });
}

// ─────────────────────────── Etapas ───────────────────────────

const GB = (n: number) => `${(n / 1e9).toLocaleString("es-CO", { maximumFractionDigits: 1 })} GB`;
const fmtBytes = (n: number) =>
  n >= 1e9 ? GB(n) : `${(n / 1e6).toLocaleString("es-CO", { maximumFractionDigits: 1 })} MB`;

async function mustSession(id: string): Promise<ComposeSession> {
  const s = await readSession(id);
  if (!s) throw new ComposicionNotFoundError("sesión no encontrada");
  return s;
}

/** El pasaje TAL COMO ESTÁ AHORA en la sesión (el humano pudo editarlo después de la foto de la etapa). */
async function currentPassage(id: string, passageId: string): Promise<Passage | null> {
  return (await readSession(id))?.passages.find((q) => q.id === passageId) ?? null;
}

/** Los mismos pasajes, releídos (sin los borrados ni los descartados mientras tanto). */
async function currentPassages(id: string, passages: Passage[]): Promise<Passage[]> {
  const now = (await readSession(id))?.passages ?? [];
  return passages.flatMap((p) => now.filter((q) => q.id === p.id && q.group !== "descartado"));
}

/** ¿El análisis se hizo sobre el tramo vigente del pasaje? Sin `span` (análisis viejo) no se sabe: no. */
export const sameSpan = (p: { start: number; end: number }, span?: { start: number; end: number }): boolean =>
  !!span && span.start === p.start && span.end === p.end;

/** Una toma con audífonos ya es voz sola: no hay nada que separar. */
const wantsSeparation = (s: ComposeSession) => !s.take || s.take.monitor === "parlantes";

const STAGES: Record<SessionStage, (ctx: StageCtx) => Promise<StageOutcome>> = {
  async copiar({ id, signal, progress }) {
    const s = await mustSession(id);
    if (s.take)
      return { status: "listo", detail: `toma ${s.take.n} grabada sobre la pista · ${fmtBytes(s.source.bytes)} (ya está en su carpeta)` };
    if (s.source.kind === "microfono") return { status: "listo", detail: "grabado en el dashboard" };
    const current = s.files.original ? join(s.mediaDir, s.files.original) : null;
    if (current && existsSync(current)) {
      const same =
        existsSync(s.source.path) && (await realpath(current)) === (await realpath(s.source.path));
      return {
        status: "listo",
        detail: same
          ? `ya estaba en la carpeta de la sesión · ${fmtBytes(s.source.bytes)} (sin copiar)`
          : `${fmtBytes(s.source.bytes)} ya copiados${s.source.md5 ? ` · md5 ${s.source.md5.slice(0, 8)}` : ""}`,
      };
    }
    if (!existsSync(s.source.path))
      throw new Error(`la fuente ya no está disponible (${s.source.path}); conecta la tarjeta y reintenta`);
    await ensureSessionFolder(s.mediaDir);
    const dest = join(s.mediaDir, "crudos", s.source.name);
    const size = s.source.bytes;
    const { md5, bytes } = await copyVerified(s.source.path, dest, {
      signal,
      onProgress: (done, total, phase) => {
        const inPhase = phase === "copiar" ? done : done - size;
        progress(done / total, `${phase === "copiar" ? "copiando" : "verificando md5"} ${GB(inPhase)} de ${GB(size)}`);
      },
    });
    await patchSession(id, (x) => {
      x.files.original = join("crudos", s.source.name);
      x.source.md5 = md5;
    });
    return { status: "listo", detail: `${fmtBytes(bytes)} copiados · md5 ${md5.slice(0, 8)} verificado` };
  },

  async audio({ id, signal, progress }) {
    const s = await mustSession(id);
    if (!s.files.original) throw new Error("no hay original: falta la etapa de copiar");
    const input = join(s.mediaDir, s.files.original);
    const out = join(s.mediaDir, "assets", "session.wav");
    await extractSessionAudio(input, out, {
      signal,
      durationSec: s.durationSec,
      onProgress: (pct) => progress(pct, `extrayendo ${Math.round(pct * 100)} %`),
    });
    const probe = await probeMedia(out);
    const updated = await patchSession(id, (x) => {
      x.files.audio = join("assets", "session.wav");
      if (probe.durationSec) x.durationSec = probe.durationSec;
    });
    progress(0.95, "calculando la onda");
    await sessionPeaks(updated);
    return { status: "listo", detail: `${clock(updated.durationSec ?? 0)} · WAV 44,1 kHz mono` };
  },

  async transcribir({ id, signal, progress }) {
    const s = await mustSession(id);
    // Una toma es local por defecto: el audio solo va a Scribe si se pidió.
    if (s.take && !s.take.stt) return { status: "omitido", detail: "toma local: no sale del equipo" };
    const avail = sttAvailable();
    if (!avail.ok) return { status: "omitido", detail: avail.reason };
    progress(0.1, "comprimiendo y enviando a Scribe");
    const words = await transcribeSession(s, signal);
    await writeTranscript(id, words);
    const speakers = computeSpeakers(words, s.speakers);
    await patchSession(id, (x) => void (x.speakers = speakers));
    const nWords = words.filter((w) => w.type === "word").length;
    const events = words.filter((w) => w.type === "audio_event").length;
    return { status: "listo", detail: `${nWords} palabras · ${speakers.length} voces · ${events} eventos de audio` };
  },

  async resumen({ id, signal, progress }) {
    const s = await mustSession(id);
    if (s.take) return { status: "omitido", detail: "una toma no tiene conversación" };
    const words = await readTranscript(id);
    if (!words?.length) return { status: "omitido", detail: "sin transcripción: no hay de dónde resumir" };
    progress(0.2, "Hermes está leyendo la sesión");
    const summary = await summarizeSession(s, words, signal);
    await patchSession(id, (x) => void (x.summary = summary));
    return {
      status: "listo",
      detail: `${summary.lines.length} líneas de letra · ${summary.decisions.length} decisiones · ${summary.pending.length} pendientes`,
    };
  },

  async pasajes({ id, signal, progress }) {
    const s = await mustSession(id);
    if (s.take) return takePassage(s);
    const words = (await readTranscript(id)) ?? [];
    const duration = s.durationSec ?? 0;
    let acoustic: AcousticSecond[] | undefined;
    const acousticOnly = !words.some((w) => w.type === "word");
    if (acousticOnly) {
      // Sin transcripción solo queda el audio: la mezcla con guitarra da una
      // pista pobre (la guitarra también "tiene altura"). Se rotula aproximado.
      progress(0.1, "sin transcripción: midiendo la voz en la mezcla");
      acoustic = await acousticFromMix(s, signal);
    }
    const lyricLines = s.summary?.lines.map((l) => ({ text: l.text, at: l.at }));
    const cands = detectPassages(words, { durationSec: duration, acoustic, lyricLines });
    // Origen "resumen" = lo que SOLO aparece gracias a las líneas del resumen
    // (sin ellas no se detectaba): se corre la detección otra vez sin ellas.
    const base = lyricLines?.length ? detectPassages(words, { durationSec: duration, acoustic }) : cands;
    const bySummary = new Set(
      cands.filter(
        (c) => !base.some((b) => overlap(b, c) >= 0.5 * Math.min(c.end - c.start, b.end - b.start)),
      ),
    );
    const next = await mergePassages(s, cands, acousticOnly, bySummary);
    const probable = next.filter((p) => p.group === "probable").length;
    const dudoso = next.filter((p) => p.group === "dudoso").length;
    const seconds = next.filter((p) => p.group === "probable").reduce((a, p) => a + (p.end - p.start), 0);
    return {
      status: "listo",
      detail: `${probable} probables · ${dudoso} dudosos · ${clock(seconds)} cantados${acousticOnly ? " (solo audio, aproximado)" : ""}`,
    };
  },

  async separar({ id, signal, progress }) {
    const s = await mustSession(id);
    // Con audífonos al mic solo entró la voz: separar sería gastar ~20 s de GPU en nada.
    if (s.take?.monitor === "audifonos") return { status: "omitido", detail: "con audífonos la toma ya es voz sola" };
    const ids = s.passages.filter((p) => p.group !== "descartado").map((p) => p.id);
    if (!ids.length) return { status: "omitido", detail: "no hay pasajes que separar" };
    // Cada pasaje se RELEE antes de cortarlo: el humano pudo mover su tramo
    // mientras corría el pipeline, y se corta el vigente (no el de la foto).
    let targets: Passage[] = [];
    for (const [i, pid] of ids.entries()) {
      const p = await currentPassage(id, pid);
      if (!p || p.group === "descartado") continue;
      await ensureCuts(s, p, signal);
      targets.push(p);
      progress((0.1 * (i + 1)) / ids.length, `cortando ${p.label}`);
    }
    if (!targets.length) return { status: "omitido", detail: "no hay pasajes que separar" };
    const avail = separatorAvailable();
    if (!avail.ok)
      return {
        status: "omitido",
        detail: s.take ? `${avail.reason} — la melodía se medirá sobre la mezcla con la pista` : avail.reason,
      };
    await cleanOrphanSepInputs(s.mediaDir);
    targets = await currentPassages(id, targets);
    const results = await runSeparation(s, targets, signal, (done, label) =>
      progress(0.1 + 0.9 * (done / targets.length), label ? `separando ${label} · ${done} de ${targets.length}` : `${done} de ${targets.length}`),
    );
    const ok = results.filter((r) => !r.error);
    if (!ok.length) throw new Error(results[0]?.error ?? "la separación no produjo stems");
    // Una toma no mide afinación: la pista sonó en La 440, es 0 por construcción.
    const tuning = s.take ? null : sessionTuning(targets, results);
    if (tuning !== null) await patchSession(id, (x) => void (x.tuningCents = tuning));
    const secs = ok.reduce((a, r) => a + (r.sec ?? 0), 0);
    return {
      status: "listo",
      detail: `${ok.length} de ${targets.length} pasajes en ${clock(secs)}${tuning !== null ? ` · afinación ${tuning > 0 ? "+" : ""}${tuning} c` : ""}${results.length - ok.length ? ` · ${results.length - ok.length} con error` : ""}`,
    };
  },

  async melodia({ id, signal, progress }) {
    const s = await mustSession(id);
    if (s.take) return takeMelodia(s, signal, progress);
    const ids = s.passages.filter((p) => p.group !== "descartado").map((p) => p.id);
    if (!ids.length) return { status: "omitido", detail: "no hay pasajes que analizar" };
    const words = (await readTranscript(id)) ?? [];
    await patchSession(id, (x) => {
      for (const p of x.passages) if (ids.includes(p.id)) p.status = "analizando";
    });

    // 1ª pasada: altura de cada pasaje (y afinación de la voz si no hubo instrumento).
    // Cada pasaje se RELEE antes de cortarlo: se mide el tramo VIGENTE, y el
    // análisis guarda cuál midió (span) para que nadie lo confunda con otro.
    const tracks = new Map<string, { track: PitchTrack; source: "voz" | "mezcla"; p: Passage }>();
    for (const [i, pid] of ids.entries()) {
      if (signal.aborted) throw new AbortedError();
      const p = await currentPassage(id, pid);
      if (!p || p.group === "descartado") continue;
      try {
        await prepareCut(s, p, signal);
        tracks.set(pid, { ...(await pitchOf(s, p, signal)), p });
      } catch (err) {
        if (err instanceof AbortedError) throw err;
        await failPassage(id, pid, err);
      }
      progress((0.4 * (i + 1)) / ids.length, `altura de ${p.label}`);
    }
    const measured = [...tracks.values()];
    const tuning =
      s.tuningCents ??
      weightedMedian(measured.map((t) => ({ v: estimateTuningCents(t.track), w: t.p.end - t.p.start }))) ??
      0;

    // 2ª pasada: notas, sílabas, frases, molde, tonalidad.
    let ok = 0;
    /** Pasajes cuyo tramo cambió a mitad de la etapa: los re-analiza su propio encolado. */
    let deferred = 0;
    const voiceProfile = new Array(12).fill(0);
    const instProfile = new Array(12).fill(0);
    let instWeight = 0;
    for (const [i, t] of measured.entries()) {
      if (signal.aborted) throw new AbortedError();
      const p = t.p;
      try {
        const analysis = await buildAnalysis(s, p, t.track, t.source, words, tuning, signal);
        if (!(await commitAnalysis(id, p.id, analysis, words))) {
          deferred++;
          continue;
        }
        const dur = p.end - p.start;
        pitchClassProfile(analysis.notes).forEach((v, k) => (voiceProfile[k] += v * dur));
        const chroma = (await readStems(s, p.id))?.chroma;
        if (chroma?.length === 12) {
          chroma.forEach((v, k) => (instProfile[k] += v * dur));
          instWeight += dur;
        }
        ok++;
      } catch (err) {
        if (err instanceof AbortedError) throw err;
        await failPassage(id, p.id, err);
      }
      progress(0.4 + (0.6 * (i + 1)) / measured.length, `${p.label}: ${i + 1} de ${measured.length}`);
    }
    // Lo que la etapa marcó y no llegó a analizar (descartado o movido a mitad) no se queda "analizando".
    await markAnalyzingAs(id, "pendiente");
    const aside = deferred ? ` · ${deferred} cambiaron de tramo: se re-analizan aparte` : "";
    if (!ok) {
      if (deferred) return { status: "listo", detail: `ningún pasaje quedó con su tramo original${aside}` };
      throw new Error("ningún pasaje se pudo analizar");
    }

    // Tonalidad de la sesión: la guitarra manda (chroma del instrumento), la voz valida.
    const voiceKey = estimateKey(normalize(voiceProfile), "voz");
    const instKey = instWeight > 0 ? estimateKey(normalize(instProfile), "instrumento") : null;
    const key: KeyEstimate = instKey ?? voiceKey;
    await patchSession(id, (x) => {
      x.key = key;
      x.tuningCents = tuning;
    });
    const agree = instKey && sameScale(instKey, voiceKey);
    return {
      status: "listo",
      detail: `${ok} de ${ids.length} pasajes · ${keyLabel(key.best.key, "latin")} (${key.source}, confianza ${Math.round(key.confidence * 100)} %)${
        instKey ? ` · voz: ${keyLabel(voiceKey.best.key, "latin")}${agree ? " (coincide)" : ""}` : ""
      } · afinación ${tuning > 0 ? "+" : ""}${Math.round(tuning)} c${aside}`,
    };
  },
};

// ─────────────────────────── Pasajes ───────────────────────────

const passageNo = (id: string) => Number(/^P(\d+)$/.exec(id)?.[1] ?? 0);
const pid = (n: number) => `P${String(n).padStart(2, "0")}`;

/**
 * Siguiente id libre: nunca reusa uno vivo NI uno que ya se asignó alguna vez
 * (`seq` = ComposeSession.passageSeq, el último número entregado).
 */
export function nextPassageId(passages: Passage[], seq = 0): string {
  return pid(passages.reduce((m, p) => Math.max(m, passageNo(p.id)), Math.max(0, seq)) + 1);
}

function groupOf(score: number): Passage["group"] {
  return score >= PROBABLE_MIN ? "probable" : score >= DUDOSO_MIN ? "dudoso" : "descartado";
}

const overlap = (a: { start: number; end: number }, b: { start: number; end: number }) =>
  Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));

/**
 * Pasajes de la sesión que algo de AFUERA referencia por id: la melodía de una
 * sección del tablero (SongSection.memo), el origen, las referencias por
 * sección y el montaje de un tema, y los que tienen letras (versiones o "Tu
 * versión" con texto). Una re-detección no puede tirarlos: la referencia
 * quedaría apuntando a nada (o, si el id se reusara, a otro tramo).
 */
async function referencedPassageIds(s: ComposeSession): Promise<Set<string>> {
  const ids = new Set<string>();
  const board = await readBoard().catch(() => null);
  for (const song of board?.songs ?? [])
    for (const sec of song.sections ?? []) if (sec.memo?.sessionId === s.id) ids.add(sec.memo.passageId);
  for (const item of await listTemas().catch(() => [])) {
    const t = await readTema(item.id).catch(() => null);
    if (!t) continue;
    const refs = [t.origin, ...t.track.sections.flatMap((sec) => sec.refs ?? []), ...t.montage.map((m) => m.memo)];
    for (const r of refs) if (r?.sessionId === s.id) ids.add(r.passageId);
  }
  for (const p of s.passages) if (await hasLyricContent(s.id, p.id)) ids.add(p.id);
  return ids;
}

/**
 * Reemplaza los pasajes automáticos por la detección nueva. Se conserva lo
 * que tiene trabajo humano: los manuales, los editados (etiqueta, grupo, voz,
 * tramo) y los referenciados (tablero, temas, montaje, letras). Un candidato
 * que pisa (>50 %) uno conservado no se duplica.
 *
 * Ids: NUNCA se reusan (passageSeq). Antes P05 podía volver a nacer como otro
 * tramo y el tablero, el tema o el montaje que decían "P05" pasaban a sonar
 * otra cosa. Un candidato con EXACTAMENTE el tramo de un pasaje reemplazable
 * es ese mismo pasaje: conserva su id (y su análisis).
 *
 * El merge corre DENTRO del parche de la sesión, sobre los pasajes vigentes:
 * lo que el humano agregó o editó mientras corría la etapa no se pierde.
 */
export async function mergePassages(
  s: ComposeSession,
  cands: PassageCandidate[],
  acousticOnly: boolean,
  bySummary: Set<PassageCandidate>,
): Promise<Passage[]> {
  const guarded = await referencedPassageIds(s);
  const sorted = [...cands].filter((c) => c.end - c.start > 0).sort((a, b) => a.start - b.start);
  let dropped: Passage[] = [];
  const next = await patchSession(s.id, (x) => {
    // label ≠ id: renombrado antes de que existiera `edited` (sesiones viejas).
    const keep = (p: Passage) => p.origin === "manual" || !!p.edited || p.label !== p.id || guarded.has(p.id);
    const kept = x.passages.filter(keep);
    const replaceable = x.passages.filter((p) => !keep(p));
    // Hasta el número más alto que se haya dado: los reemplazados también queman el suyo.
    let n = x.passages.reduce((m, p) => Math.max(m, passageNo(p.id)), Math.max(0, x.passageSeq ?? 0));
    const reused = new Set<string>();
    const fresh: Passage[] = [];
    for (const c of sorted) {
      const dur = c.end - c.start;
      if (kept.some((k) => overlap(k, c) > 0.5 * Math.min(dur, k.end - k.start))) continue;
      const start = round2(c.start);
      const end = round2(c.end);
      const detected = {
        text: c.text,
        confidence: Math.round(c.score * 1000) / 1000,
        group: c.group ?? groupOf(c.score),
        evidence: acousticOnly ? [...c.evidence, "solo audio (sin transcripción)"] : c.evidence,
        origin: bySummary.has(c) ? ("resumen" as const) : ("auto" as const),
      };
      const same = replaceable.find((p) => !reused.has(p.id) && p.start === start && p.end === end);
      if (same) {
        reused.add(same.id);
        const { speaker: _old, ...rest } = same;
        fresh.push({
          ...rest,
          ...(c.speaker ? { speaker: c.speaker } : {}),
          ...detected,
          // Analizado, su tipo salió de las sílabas medidas: vale más que el de la detección.
          kind: same.status === "listo" ? same.kind : c.kind,
        });
        continue;
      }
      const id = pid(++n);
      fresh.push({
        id,
        label: id,
        start,
        end,
        ...(c.speaker ? { speaker: c.speaker } : {}),
        kind: c.kind,
        ...detected,
        status: "pendiente",
      });
    }
    x.passageSeq = n;
    dropped = replaceable.filter((p) => !reused.has(p.id));
    x.passages = [...kept, ...fresh].sort((a, b) => a.start - b.start);
    x.speakers = withSinging(x.speakers, x.passages);
  });
  // Lo reemplazado se limpia del disco: sus cortes y análisis ya no describen
  // nada, y su id queda quemado (passageSeq): nunca nombrará otro tramo.
  for (const p of dropped) {
    await removeAnalysis(s.id, p.id);
    await rm(join(s.mediaDir, "analisis", p.id), { recursive: true, force: true });
  }
  return next.passages;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Segundos cantados por voz (pasajes probables). */
function withSinging(speakers: ComposeSession["speakers"], passages: Passage[]): ComposeSession["speakers"] {
  const sing = new Map<string, number>();
  for (const p of passages)
    if (p.group === "probable" && p.speaker) sing.set(p.speaker, (sing.get(p.speaker) ?? 0) + (p.end - p.start));
  return speakers.map((sp) => ({ ...sp, singingSeconds: Math.round((sing.get(sp.id) ?? 0) * 10) / 10 }));
}

/** Alta manual de un pasaje (se analiza aparte). */
export async function addManualPassage(
  id: string,
  input: { start: number; end: number; speaker?: string },
): Promise<Passage> {
  let created: Passage | null = null;
  await patchSession(id, (x) => {
    // La rejilla de una toma se lee sobre la toma ENTERA (buildTakeAnalysis no descuenta p.start).
    if (x.take) throw new ImportError(TAKE_ONE_PASSAGE, 409);
    const dur = x.durationSec ?? Infinity;
    const start = Math.max(0, Math.min(input.start, input.end));
    const end = Math.min(dur, Math.max(input.start, input.end));
    if (!(end - start >= 0.5)) throw new ImportError("el pasaje debe durar al menos medio segundo");
    const pidNew = nextPassageId(x.passages, x.passageSeq);
    x.passageSeq = passageNo(pidNew);
    created = {
      id: pidNew,
      label: pidNew,
      start: round2(start),
      end: round2(end),
      ...(input.speaker ? { speaker: input.speaker } : {}),
      text: "",
      kind: "mixto",
      confidence: 1,
      group: "probable",
      evidence: ["marcado a mano"],
      origin: "manual",
      status: "pendiente",
    };
    x.passages = [...x.passages, created].sort((a, b) => a.start - b.start);
    x.speakers = withSinging(x.speakers, x.passages);
  });
  const p = created!;
  // El texto real del tramo (lo que se cantó según la transcripción).
  const words = (await readTranscript(id)) ?? [];
  const text = words
    .filter((w) => w.end > p.start && w.start < p.end)
    .map((w) => w.text)
    .join(" ");
  if (text) await patchSession(id, (x) => void (x.passages.find((q) => q.id === p.id)!.text = text));
  queuePassageAnalysis(id, p.id);
  return { ...p, text };
}

/**
 * Edición humana de un pasaje. Cambiar el tramo invalida cortes y análisis →
 * se re-analiza. Todo cambio real lo marca `edited` (la re-detección lo
 * conserva). En una toma no se edita: su único pasaje es la toma entera.
 */
export async function patchPassage(
  id: string,
  passageId: string,
  input: { start?: number; end?: number; label?: string; group?: Passage["group"]; speaker?: string },
): Promise<Passage> {
  let reanalyze = false;
  let out: Passage | null = null;
  await patchSession(id, (x) => {
    if (x.take) throw new ImportError(TAKE_ONE_PASSAGE, 409);
    const p = x.passages.find((q) => q.id === passageId);
    if (!p) throw new ComposicionNotFoundError("pasaje no encontrado");
    const before = JSON.stringify([p.start, p.end, p.label, p.group, p.speaker ?? null]);
    const start = input.start ?? p.start;
    const end = input.end ?? p.end;
    if (input.start !== undefined || input.end !== undefined) {
      const dur = x.durationSec ?? Infinity;
      if (!(Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end <= dur && end - start >= 0.5))
        throw new ImportError("tramo inválido (mínimo medio segundo, dentro de la sesión)");
      if (start !== p.start || end !== p.end) {
        p.start = round2(start);
        p.end = round2(end);
        p.status = "pendiente";
        delete p.key;
        delete p.melismas;
        delete p.syllables;
        delete p.error;
        reanalyze = true;
      }
    }
    if (input.label !== undefined) {
      const label = input.label.trim().slice(0, 40);
      if (!label) throw new ImportError("la etiqueta no puede quedar vacía");
      p.label = label;
    }
    if (input.group !== undefined) {
      if (!["probable", "dudoso", "descartado"].includes(input.group)) throw new ImportError("grupo inválido");
      // Promover algo nunca analizado lo pone en la cola.
      if (p.group === "descartado" && input.group !== "descartado" && p.status === "pendiente") reanalyze = true;
      p.group = input.group;
    }
    if (input.speaker !== undefined) {
      if (input.speaker) p.speaker = input.speaker;
      else delete p.speaker;
    }
    if (JSON.stringify([p.start, p.end, p.label, p.group, p.speaker ?? null]) !== before) p.edited = true;
    x.passages.sort((a, b) => a.start - b.start);
    x.speakers = withSinging(x.speakers, x.passages);
    out = { ...p };
  });
  if (reanalyze) queuePassageAnalysis(id, passageId);
  return out!;
}

/**
 * Encola el análisis de UN pasaje (corte + separación + melodía), detrás del
 * pipeline. `force`: rehacerlo aunque el pipeline lo haya analizado mientras
 * esperaba — lo usa el re-análisis de una toma (latencia, pista de texto): el
 * pipeline pudo leer la meta VIEJA y aun así terminar después de encolar.
 */
export function queuePassageAnalysis(id: string, passageId: string, opts: { force?: boolean } = {}): void {
  const abort = new AbortController();
  const untrack = track(id, abort);
  const queuedAt = new Date().toISOString();
  void patchSession(id, (x) => {
    const p = x.passages.find((q) => q.id === passageId);
    if (p && p.status !== "analizando") p.status = "pendiente";
  }).catch(() => {});
  void enqueue(id, async () => {
    if (abort.signal.aborted) return;
    const s = await readSession(id);
    const p = s?.passages.find((q) => q.id === passageId);
    if (!s || !p) return;
    // El pipeline ya lo analizó mientras esperaba en la cola — y sobre ESTE
    // tramo. Un análisis posterior al encolado pero de un tramo viejo (el
    // humano movió los bordes mientras corría la melodía) no cuenta.
    if (p.status === "listo" && !opts.force) {
      const a = await readAnalysis(s.id, p.id);
      if (a && a.analyzedAt >= queuedAt && sameSpan(p, a.span)) return;
    }
    await analyzeOne(s, p, abort.signal);
  })
    .catch((err) => console.error(`[composicion] análisis ${id}/${passageId}:`, err))
    .finally(untrack);
}

async function analyzeOne(s: ComposeSession, p: Passage, signal: AbortSignal): Promise<void> {
  await patchSession(s.id, (x) => {
    const q = x.passages.find((y) => y.id === p.id);
    if (q) {
      q.status = "analizando";
      delete q.error;
    }
  });
  emit({ private: true, kind: "tool_call", taskId: taskId(s.id), toolName: "composicion_pasaje", detail: `Analizando ${p.label}` });
  try {
    await ensureCuts(s, p, signal);
    if (wantsSeparation(s) && separatorAvailable().ok) {
      const [r] = await runSeparation(s, [p], signal);
      if (r?.error) console.warn(`[composicion] ${s.id}/${p.id} separación: ${r.error}`);
    }
    const words = (await readTranscript(s.id)) ?? [];
    let analysis: PassageAnalysis;
    if (s.take) {
      analysis = (await buildTakeAnalysis(s, p, signal)).analysis;
    } else {
      const { track: t, source } = await pitchOf(s, p, signal);
      const stems = await readStems(s, p.id);
      const tuning = s.tuningCents ?? stems?.tuningCents ?? estimateTuningCents(t);
      analysis = await buildAnalysis(s, p, t, source, words, tuning, signal);
    }
    // Movido mientras se analizaba: su re-análisis ya está encolado detrás de este.
    if (!(await commitAnalysis(s.id, p.id, analysis, words))) return;
    if (s.take) await applyTakeSummary(s.id, analysis);
    emit({ private: true, kind: "task_done", taskId: taskId(s.id), detail: `${p.label} analizado` });
  } catch (err) {
    if (signal.aborted || err instanceof AbortedError) {
      await patchSession(s.id, (x) => {
        const q = x.passages.find((y) => y.id === p.id);
        if (q && q.status === "analizando") q.status = "pendiente";
      });
      return;
    }
    await failPassage(s.id, p.id, err);
  }
}

async function failPassage(id: string, passageId: string, err: unknown): Promise<void> {
  const msg = ((err as Error)?.message ?? String(err)).slice(0, 300);
  console.error(`[composicion] ${id}/${passageId}: ${msg}`);
  await patchSession(id, (x) => {
    const p = x.passages.find((q) => q.id === passageId);
    if (p) {
      p.status = "error";
      p.error = msg;
    }
  });
}

// ─────────────────────────── Cortes, separación y altura ───────────────────────────

interface CutInfo {
  start: number;
  end: number;
  /** Corte con relleno para el separador (segundos de sesión). */
  padStart: number;
  padEnd: number;
  pad: number;
  /** Solo en lo que devuelve ensureCuts (corte.json no lo guarda): había un corte de OTRO tramo y se rehízo. */
  recut?: boolean;
}

const passageDir = (s: ComposeSession, passageId: string) => join(s.mediaDir, "analisis", passageId);

/**
 * mezcla.wav = el pasaje EXACTO (sus tiempos = los de las notas). El
 * separador recibe aparte un corte con ±SEPARATION_PAD_SEC de contexto
 * (_sep_in.wav) y devuelve los stems ya recortados al pasaje: todos los
 * archivos del pasaje arrancan en passage.start. El tramo queda en corte.json.
 */
async function ensureCuts(s: ComposeSession, p: Passage, signal?: AbortSignal): Promise<CutInfo> {
  if (!s.files.audio) throw new Error("la sesión todavía no tiene audio extraído");
  const dir = passageDir(s, p.id);
  const cutPath = join(dir, "corte.json");
  const wav = join(s.mediaDir, s.files.audio);
  const duration = s.durationSec ?? p.end;
  const info: CutInfo = {
    start: p.start,
    end: p.end,
    padStart: Math.max(0, p.start - SEPARATION_PAD_SEC),
    padEnd: Math.min(duration, p.end + SEPARATION_PAD_SEC),
    pad: SEPARATION_PAD_SEC,
  };
  let prev: CutInfo | null = null;
  try {
    prev = JSON.parse(await readFile(cutPath, "utf8")) as CutInfo;
  } catch {
    /* primera vez */
  }
  const same = prev && prev.start === info.start && prev.end === info.end;
  if (same && existsSync(join(dir, "mezcla.wav"))) return info;
  // Tramo nuevo: todo lo derivado del tramo viejo miente (stems, renders transpuestos).
  const recut = !!prev && !same;
  if (recut) {
    for (const f of await readdir(dir).catch(() => [] as string[])) {
      if (f.endsWith(".wav") || f === "stems.json") await rm(join(dir, f), { force: true });
    }
  }
  await cutWav(wav, join(dir, "mezcla.wav"), p.start, p.end - p.start, signal);
  await writeFile(cutPath, JSON.stringify(info));
  return recut ? { ...info, recut } : info;
}

/**
 * El corte del tramo vigente para medir su altura. Si el tramo cambió desde
 * el último corte (el humano lo movió DESPUÉS de separar), ensureCuts ya
 * borró los stems viejos: se separa otra vez aquí, así lo que mide la etapa
 * es lo mismo que mediría el re-análisis encolado (que al ver el tramo ya
 * analizado, se salta) — y no una lectura sobre la mezcla por descuido.
 */
async function prepareCut(s: ComposeSession, p: Passage, signal: AbortSignal): Promise<void> {
  const cut = await ensureCuts(s, p, signal);
  if (!cut.recut || !wantsSeparation(s) || !separatorAvailable().ok) return;
  const [r] = await runSeparation(s, [p], signal);
  if (r?.error) console.warn(`[composicion] ${s.id}/${p.id} separación: ${r.error}`);
}

interface StemsInfo {
  tuningCents?: number | null;
  voiceTuningCents?: number | null;
  chroma?: number[] | null;
  sec?: number;
  error?: string;
  at: string;
}

async function readStems(s: ComposeSession, passageId: string): Promise<StemsInfo | null> {
  try {
    return JSON.parse(await readFile(join(passageDir(s, passageId), "stems.json"), "utf8")) as StemsInfo;
  } catch {
    return null;
  }
}

/**
 * Separa los pasajes que todavía no lo están. Cada resultado se persiste APENAS
 * llega (stems.json + se borra su corte de entrada): si el agente se reinicia a
 * mitad, lo ya separado sobrevive y la próxima corrida lo salta. Antes
 * stems.json se escribía al final del lote y un reinicio perdía todo.
 */
async function runSeparation(
  s: ComposeSession,
  passages: Passage[],
  signal: AbortSignal,
  onDone?: (done: number, nextLabel?: string) => void,
): Promise<SeparationResult[]> {
  const wav = join(s.mediaDir, s.files.audio!);
  const already = new Map<string, SeparationResult>();
  const items = [];
  for (const p of passages) {
    const cut = await ensureCuts(s, p, signal);
    const dir = passageDir(s, p.id);
    if (await isSeparated(dir)) {
      const st = await readStems(s, p.id);
      already.set(p.id, {
        id: p.id,
        voice: join(dir, "voz.wav"),
        tuningCents: st?.tuningCents ?? null,
        voiceTuningCents: st?.voiceTuningCents ?? null,
        chroma: st?.chroma ?? null,
        ...(st?.sec ? { sec: st.sec } : {}),
      });
      continue;
    }
    const input = join(dir, SEP_INPUT);
    await cutWav(wav, input, cut.padStart, cut.padEnd - cut.padStart, signal);
    items.push({ id: p.id, input, outDir: dir, trimStart: p.start - cut.padStart, trimDur: p.end - p.start });
  }
  const labels = new Map(passages.map((p) => [p.id, p.label]));
  let done = already.size;
  if (done) onDone?.(done);
  const persist = async (r: SeparationResult) => {
    const stems: StemsInfo = {
      tuningCents: r.tuningCents ?? null,
      voiceTuningCents: r.voiceTuningCents ?? null,
      chroma: r.chroma ?? null,
      ...(r.sec ? { sec: r.sec } : {}),
      ...(r.error ? { error: r.error } : {}),
      at: new Date().toISOString(),
    };
    await writeFile(join(passageDir(s, r.id), "stems.json"), JSON.stringify(stems));
    await rm(join(passageDir(s, r.id), SEP_INPUT), { force: true }).catch(() => {});
  };
  const writes: Promise<void>[] = [];
  try {
    const fresh = await separatePassages(items, {
      signal,
      onEvent: (e) => {
        if (e.event === "start" && e.id) onDone?.(done, labels.get(e.id));
        if ((e.event === "done" || e.event === "error") && e.id) onDone?.(++done);
      },
      onResult: (r) => void writes.push(persist(r)),
    });
    await Promise.all(writes);
    return passages.map((p) => already.get(p.id) ?? fresh.find((r) => r.id === p.id) ?? { id: p.id, error: "sin resultado" });
  } finally {
    await Promise.allSettled(writes);
    for (const it of items) await rm(it.input, { force: true }).catch(() => {});
  }
}

/** Afinación de la sesión: mediana (ponderada por duración) de la del instrumento. */
function sessionTuning(passages: Passage[], results: SeparationResult[]): number | null {
  const byId = new Map(passages.map((p) => [p.id, p]));
  return weightedMedian(
    results
      .filter((r) => typeof r.tuningCents === "number")
      .map((r) => ({ v: r.tuningCents as number, w: (byId.get(r.id)?.end ?? 0) - (byId.get(r.id)?.start ?? 0) })),
  );
}

export function weightedMedian(xs: { v: number; w: number }[]): number | null {
  const valid = xs.filter((x) => Number.isFinite(x.v) && x.w > 0).sort((a, b) => a.v - b.v);
  if (!valid.length) return null;
  const total = valid.reduce((a, x) => a + x.w, 0);
  let acc = 0;
  for (const x of valid) {
    acc += x.w;
    if (acc >= total / 2) return Math.round(x.v);
  }
  return Math.round(valid[valid.length - 1].v);
}

/** Altura del pasaje: sobre la voz aislada si existe, si no sobre la mezcla. */
async function pitchOf(
  s: ComposeSession,
  p: Passage,
  signal: AbortSignal,
): Promise<{ track: PitchTrack; source: "voz" | "mezcla" }> {
  const dir = passageDir(s, p.id);
  const voice = join(dir, "voz.wav");
  const source = existsSync(voice) ? "voz" : "mezcla";
  const pcm = await decodePcm(source === "voz" ? voice : join(dir, "mezcla.wav"), { sr: ANALYSIS_SR, signal });
  return { track: await trackPitchAsync(pcm, ANALYSIS_SR, { signal }), source };
}

/**
 * trackPitch sin bloquear el agente: los cuadros de YIN van por tramos de
 * PITCH_CHUNK_FRAMES y entre tramo y tramo se cede el event loop (y se mira
 * si llegó Detener). El resultado es IDÉNTICO al de trackPitch: es el mismo
 * pitchTracker, solo que partido.
 */
export async function trackPitchAsync(
  pcm: Float32Array,
  sr: number,
  opts: { signal?: AbortSignal; chunkFrames?: number; pitch?: PitchOptions } = {},
): Promise<PitchTrack> {
  const job = pitchTracker(pcm, sr, opts.pitch);
  const step = Math.max(1, Math.floor(opts.chunkFrames ?? PITCH_CHUNK_FRAMES));
  for (let i = 0; i < job.frames; i += step) {
    if (opts.signal?.aborted) throw new AbortedError();
    job.run(i, i + step);
    await new Promise<void>((r) => setImmediate(r));
  }
  if (opts.signal?.aborted) throw new AbortedError();
  return job.finish();
}

/** Palabras del tramo, en segundos RELATIVOS al inicio del pasaje. */
export function wordsInPassage(words: TranscriptWord[], p: { start: number; end: number }): TimedWord[] {
  const dur = p.end - p.start;
  return words
    .filter((w) => w.type === "word" && w.end > p.start && w.start < p.end)
    .map((w) => ({
      text: w.text,
      start: round3(Math.max(0, w.start - p.start)),
      end: round3(Math.min(dur, Math.max(w.start, w.end) - p.start)),
      ...(w.speaker ? { speaker: w.speaker } : {}),
    }));
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

async function buildAnalysis(
  s: ComposeSession,
  p: Passage,
  t: PitchTrack,
  source: "voz" | "mezcla",
  words: TranscriptWord[],
  tuningCents: number,
  signal: AbortSignal,
): Promise<PassageAnalysis> {
  const rel = wordsInPassage(words, p);
  const notes = segmentNotes(t, { tuningCents });
  const syllables = anchorSyllables(rel, notes);
  const phrases = buildPhrases(syllables, notes);
  const key = estimateKey(pitchClassProfile(notes), "voz");
  if (!notes.length) key.confidence = 0;
  const stems = await readStems(s, p.id);
  const instrumentKey = stems?.chroma?.length === 12 ? estimateKey(stems.chroma, "instrumento") : undefined;
  const dir = join("analisis", p.id);
  const mixPcm = await decodePcm(join(s.mediaDir, dir, "mezcla.wav"), { sr: 8000, signal });
  const midis = notes.map((n) => n.midi);
  return {
    sessionId: s.id,
    passageId: p.id,
    version: 1,
    analyzedAt: new Date().toISOString(),
    span: { start: p.start, end: p.end },
    source,
    tuningCents: Math.round(tuningCents),
    hop: F0_HOP,
    f0: downsampleF0(t, F0_HOP).map((v) => (v === null ? null : Math.round(v * 100) / 100)),
    peaks: peaksOf(mixPcm, PASSAGE_PEAKS).map((v) => Math.round(v * 1000) / 1000),
    notes,
    phrases,
    key,
    ...(instrumentKey ? { instrumentKey } : {}),
    range: midis.length ? { lo: Math.min(...midis), hi: Math.max(...midis) } : { lo: 0, hi: 0 },
    files: {
      mix: join(dir, "mezcla.wav"),
      ...(existsSync(join(s.mediaDir, dir, "voz.wav")) ? { voice: join(dir, "voz.wav") } : {}),
      ...(existsSync(join(s.mediaDir, dir, "instrumento.wav")) ? { instrument: join(dir, "instrumento.wav") } : {}),
    },
  };
}

/**
 * Guarda un análisis SOLO si describe el tramo vigente del pasaje. Si el
 * humano lo movió mientras se analizaba, este análisis es de un tramo que ya
 * no existe: no se escribe ni marca "listo" (patchPassage ya encoló el
 * re-análisis, que no se salta porque el análisis en disco no es de su
 * tramo). Al guardar, alinea el tablero de letras con las frases nuevas.
 * Devuelve si quedó guardado.
 */
async function commitAnalysis(
  id: string,
  passageId: string,
  a: PassageAnalysis,
  words: TranscriptWord[],
): Promise<boolean> {
  const cur = await currentPassage(id, passageId);
  if (!cur || !sameSpan(cur, a.span)) return false;
  const prev = await readAnalysis(id, passageId).catch(() => null);
  await writeAnalysis(a);
  await alignLyricsToAnalysis(prev, a).catch((err) =>
    console.warn(`[composicion] ${id}/${passageId}: no se pudo alinear el tablero de letras: ${String(err).slice(0, 160)}`),
  );
  // Se re-verifica bajo el candado de la sesión: entre la lectura y aquí el tramo pudo cambiar.
  return applyAnalysisSummary(id, passageId, a, words);
}

/** Lo que la lista muestra del pasaje sale del análisis (el instrumento manda en la tonalidad). */
async function applyAnalysisSummary(
  id: string,
  passageId: string,
  a: PassageAnalysis,
  words: TranscriptWord[],
): Promise<boolean> {
  const syllables = a.phrases.flatMap((ph) => ph.syllables);
  let applied = false;
  await patchSession(id, (x) => {
    const p = x.passages.find((q) => q.id === passageId);
    if (!p || !sameSpan(p, a.span)) return;
    applied = true;
    p.status = "listo";
    delete p.error;
    p.key = (a.instrumentKey ?? a.key).best;
    p.melismas = syllables.filter((y) => y.melisma).length;
    p.syllables = syllables.length;
    try {
      p.kind = classifyPassage(syllables, wordsInPassage(words, p));
    } catch {
      /* la clasificación de la detección se queda */
    }
  });
  return applied;
}

// ─────────────────────────── Tomas: pasaje y melodía en la rejilla ───────────────────────────

/**
 * El único pasaje de una toma es la toma entera. Re-correr la etapa NO borra
 * P01 (sus letras y la corrección del molde siguen valiendo): solo ajusta el
 * tramo si cambió la duración. El `kind` queda provisional hasta la melodía,
 * donde classifyPassage lo mide sobre las sílabas reales.
 */
async function takePassage(s: ComposeSession): Promise<StageOutcome> {
  const dur = s.durationSec ?? 0;
  if (!(dur >= 0.5)) throw new Error("la toma dura menos de medio segundo");
  const words = (await readTranscript(s.id)) ?? [];
  const sung = words.filter((w) => w.type === "word").map((w) => w.text).join(" ");
  const text = sung || s.take?.hint?.trim() || "";
  const end = round2(dur);
  await patchSession(s.id, (x) => {
    const p = x.passages.find((q) => q.id === TAKE_PASSAGE);
    if (p) {
      if (p.start !== 0 || p.end !== end) {
        p.start = 0;
        p.end = end;
        p.status = "pendiente";
      }
      p.text = text;
      return;
    }
    x.passageSeq = Math.max(x.passageSeq ?? 0, passageNo(TAKE_PASSAGE));
    x.passages = [
      {
        id: TAKE_PASSAGE,
        label: TAKE_PASSAGE,
        start: 0,
        end,
        text,
        kind: "mixto",
        confidence: 1,
        group: "probable",
        evidence: ["toma grabada sobre la pista"],
        origin: "manual",
        status: "pendiente",
      },
      ...x.passages.filter((q) => q.id !== TAKE_PASSAGE),
    ];
  });
  return { status: "listo", detail: `${TAKE_PASSAGE} = la toma entera (${clock(dur)})` };
}

async function takeMelodia(
  s: ComposeSession,
  signal: AbortSignal,
  progress: StageCtx["progress"],
): Promise<StageOutcome> {
  const p = s.passages.find((q) => q.id === TAKE_PASSAGE);
  if (!p) throw new Error(`la toma no tiene ${TAKE_PASSAGE}: falta la etapa de pasajes`);
  await patchSession(s.id, (x) => {
    const q = x.passages.find((y) => y.id === p.id);
    if (q) {
      q.status = "analizando";
      delete q.error;
    }
  });
  progress(0.1, "altura de la toma");
  try {
    const { analysis, vowels } = await buildTakeAnalysis(s, p, signal);
    progress(0.9, "guardando el análisis");
    if (!(await commitAnalysis(s.id, p.id, analysis, (await readTranscript(s.id)) ?? [])))
      return { status: "listo", detail: "la toma cambió de largo durante el análisis: se re-analiza aparte" };
    await applyTakeSummary(s.id, analysis);
    const syl = analysis.phrases.flatMap((ph) => ph.syllables);
    const g = analysis.grid;
    const shift = g?.suggestShiftMs;
    return {
      status: "listo",
      detail: [
        `${analysis.notes.length} notas · ${syl.length} sílabas · ${syl.filter((y) => y.melisma).length} melismas`,
        `${analysis.source === "voz" ? "sobre la voz" : "sobre la mezcla con la pista"}`,
        vowels.estimated ? `${vowels.estimated} vocales por formantes (aprox.)` : "",
        g ? `desvío mediano ${Math.round(g.medianOffMs)} ms` : "",
        typeof shift === "number" ? `la rejilla parece corrida ${shift > 0 ? "+" : ""}${Math.round(shift)} ms` : "",
      ]
        .filter(Boolean)
        .join(" · "),
    };
  } catch (err) {
    if (signal.aborted || err instanceof AbortedError) throw err;
    await failPassage(s.id, p.id, err);
    throw err;
  }
}

/** Lo que la sesión muestra de la toma: la tonalidad MEDIDA de la voz y afinación 0 (La 440). */
async function applyTakeSummary(id: string, a: PassageAnalysis): Promise<void> {
  await patchSession(id, (x) => {
    x.key = a.key;
    x.tuningCents = 0;
  });
}

/**
 * La toma leída en la rejilla con la que se grabó. Pasos:
 *  1. Altura sobre la voz (con audífonos la mezcla YA es la voz; con parlantes,
 *     la voz separada si la hubo — si no, la mezcla con la pista, y se dice).
 *  2. Afinación 0: la pista sonó en La 440, no hay nada que medir.
 *  3. Sílabas: ancladas a las palabras si hubo Scribe; si no, del propio audio
 *     (huecos y valles de energía → sílaba nueva; legato con otra altura =
 *     melisma). La pista de texto del humano, si existe, manda sobre el texto.
 *  4. Vocal por sílaba (el texto manda; sin texto, formantes con confianza) y
 *     su posición métrica en la rejilla.
 *  5. Frases → molde, y la toma entera en la rejilla (compás.tiempo, grado,
 *     rol sobre el acorde, dinámica, lectura en números).
 * La tonalidad de la voz se estima igual (valida), pero la de la rejilla es la
 * de la pista: `take.grid.key`.
 */
export async function buildTakeAnalysis(
  s: ComposeSession,
  p: Passage,
  signal: AbortSignal,
): Promise<{ analysis: PassageAnalysis; vowels: { estimated: number } }> {
  const take = s.take;
  if (!take) throw new Error("no es una toma");
  await ensureCuts(s, p, signal);
  const rel = join("analisis", p.id);
  const dir = join(s.mediaDir, rel);
  if (take.monitor === "audifonos") await exposeHeadphoneVoice(dir);
  const separated = existsSync(join(dir, "voz.wav"));
  const source: PassageAnalysis["source"] = separated || take.monitor === "audifonos" ? "voz" : "mezcla";
  const pcm = await decodePcm(join(dir, separated ? "voz.wav" : "mezcla.wav"), { sr: ANALYSIS_SR, signal });
  const t = await trackPitchAsync(pcm, ANALYSIS_SR, { signal });
  const tuningCents = 0;
  const notes = segmentNotes(t, { tuningCents });

  const words = take.stt ? wordsInPassage((await readTranscript(s.id)) ?? [], p) : [];
  let syllables = words.length ? anchorSyllables(words, notes) : syllablesFromTrack(t, notes);
  if (take.hint?.trim()) syllables = applyHint(syllables, take.hint);
  // Formantes solo sobre voz sola: con la pista mezclada, el LPC mediría los acordes.
  const vowels = withVowels(syllables, source === "voz" ? pcm : null, ANALYSIS_SR);
  syllables = withMetric(vowels.syllables, notes, take.grid);
  const phrases = buildPhrases(syllables, notes);
  const grid = analyzeOnGrid({ notes, phrases, track: t, grid: take.grid });

  const key = estimateKey(pitchClassProfile(notes), "voz");
  if (!notes.length) key.confidence = 0;
  const mixPcm = await decodePcm(join(dir, "mezcla.wav"), { sr: 8000, signal });
  const midis = notes.map((n) => n.midi);
  return {
    vowels: { estimated: vowels.estimated },
    analysis: {
      sessionId: s.id,
      passageId: p.id,
      version: 1,
      analyzedAt: new Date().toISOString(),
      span: { start: p.start, end: p.end },
      source,
      tuningCents,
      hop: F0_HOP,
      f0: downsampleF0(t, F0_HOP).map((v) => (v === null ? null : Math.round(v * 100) / 100)),
      peaks: peaksOf(mixPcm, PASSAGE_PEAKS).map((v) => Math.round(v * 1000) / 1000),
      notes,
      phrases,
      key,
      range: midis.length ? { lo: Math.min(...midis), hi: Math.max(...midis) } : { lo: 0, hi: 0 },
      files: {
        mix: join(rel, "mezcla.wav"),
        ...(separated ? { voice: join(rel, "voz.wav") } : {}),
        ...(existsSync(join(dir, "instrumento.wav")) ? { instrument: join(rel, "instrumento.wav") } : {}),
      },
      grid,
    },
  };
}

/**
 * Con audífonos la mezcla ES la voz sola. Se expone también como voz.wav
 * (enlace duro: no duplica bytes) para que todo lo que pide la voz —
 * transponer, la guía en modo tarareo, `files.voice` — funcione igual que en
 * un pasaje separado. Si ensureCuts rehace el corte, borra los .wav y este
 * enlace se vuelve a crear.
 */
async function exposeHeadphoneVoice(dir: string): Promise<void> {
  const voice = join(dir, "voz.wav");
  if (existsSync(voice)) return;
  const mix = join(dir, "mezcla.wav");
  await link(mix, voice).catch(() => copyFile(mix, voice));
}

/**
 * Vocal por sílaba. Orden de confianza: la que ya puso la pista de texto →
 * la del texto de la sílaba (Scribe) → la estimada por formantes (solo con
 * voz sola y sobre MIN_VOWEL_CONFIDENCE; si no, se queda sin vocal).
 */
export function withVowels(
  syllables: SungSyllable[],
  voicePcm: Float32Array | null,
  sr: number,
): { syllables: SungSyllable[]; estimated: number } {
  let estimated = 0;
  const out = syllables.map((s): SungSyllable => {
    if (s.vowel) return s;
    const fromText = s.text.trim() ? vowelOfText(s.text) : null;
    if (fromText) return { ...s, vowel: fromText, vowelSource: "texto" };
    if (!voicePcm || !(s.end > s.start)) return s;
    const est = estimateVowel(voicePcm, sr, s.start, s.end, s.midi !== null ? midiToHz(s.midi) : undefined);
    if (!est || est.confidence < MIN_VOWEL_CONFIDENCE) return s;
    estimated++;
    return { ...s, vowel: est.vowel, vowelSource: "formantes" };
  });
  return { syllables: out, estimated };
}

/**
 * Posición métrica de cada sílaba: la del ATAQUE de su primera nota (la
 * consonante entra antes del tiempo; lo que cae en el tiempo es la vocal, que
 * es donde la altura se vuelve estable). Sin nota, el inicio de la sílaba.
 */
export function withMetric(syllables: SungSyllable[], notes: MelodyNote[], grid: TakeGrid): SungSyllable[] {
  const spec = { bpm: grid.bpm, meter: grid.meter, downbeatSec: grid.downbeatSec, swing: grid.swing };
  return syllables.map((s) => {
    const starts = s.noteIdx.map((i) => notes[i]?.start).filter((x): x is number => Number.isFinite(x));
    const attack = starts.length ? Math.min(...starts) : s.start;
    const g = toGrid(attack, spec);
    return { ...s, metric: { absStep: g.absStep, weight: metricWeight(g.stepInBar, grid.meter) } };
  });
}

// ─────────────────────────── Tonalidad ───────────────────────────

function normalize(v: number[]): number[] {
  const sum = v.reduce((a, x) => a + x, 0);
  return sum > 0 ? v.map((x) => x / sum) : v;
}

/** ¿Misma escala? (idénticas o relativas mayor/menor: mismas siete notas). */
function sameScale(a: KeyEstimate, b: KeyEstimate): boolean {
  const pcOf = (k: KeyEstimate) => (k.best.key.mode === "major" ? k.best.key.tonic : (k.best.key.tonic + 3) % 12);
  return pcOf(a) === pcOf(b);
}

// ─────────────────────────── Solo-acústica (sin transcripción) ───────────────────────────

async function acousticFromMix(s: ComposeSession, signal: AbortSignal): Promise<AcousticSecond[]> {
  if (!s.files.audio) return [];
  const pcm = await decodePcm(join(s.mediaDir, s.files.audio), { sr: ANALYSIS_SR, signal });
  const t = await trackPitchAsync(pcm, ANALYSIS_SR, { signal });
  return acousticSeconds(t, segmentNotes(t, {}), { durationSec: pcm.length / ANALYSIS_SR });
}

// ─────────────────────────── Arranque ───────────────────────────

/** Lo que un reinicio dejó "corriendo" pasa a error con el motivo (no se miente). */
export async function reconcileComposicion(): Promise<number> {
  let fixed = 0;
  for (const summary of await listSessions()) {
    const s = await readSession(summary.id);
    if (!s) continue;
    const stuck =
      s.status === "procesando" ||
      s.stages.some((st) => st.status === "corriendo") ||
      s.passages.some((p) => p.status === "analizando");
    // Cortes de entrada del separador que dejó un proceso muerto.
    await cleanOrphanSepInputs(s.mediaDir);
    if (!stuck) continue;
    await patchSession(s.id, (x) => {
      if (x.status === "procesando") x.status = "error";
      for (const st of x.stages) {
        if (st.status === "corriendo") {
          st.status = "error";
          st.error = "se reinició el agente; reanuda desde esta etapa";
          st.endedAt = new Date().toISOString();
        }
      }
      for (const p of x.passages) {
        if (p.status === "analizando") {
          p.status = "error";
          p.error = "se reinició el agente";
        }
      }
    });
    fixed++;
  }
  return fixed;
}

