/**
 * Persistencia de COMPOSICIÓN en JSON (sin Supabase, a propósito: el material
 * de una sesión son gigas en un disco extraíble y el estado que lo describe
 * tiene que viajar con la máquina que lo procesa).
 *
 *   <COMPOSICION_DIR>/board.json                          el tablero (canciones…)
 *   <COMPOSICION_DIR>/sesiones/<id>/session.json          ComposeSession
 *   <COMPOSICION_DIR>/sesiones/<id>/transcript.json       TranscriptWord[]
 *   <COMPOSICION_DIR>/sesiones/<id>/passages/<pid>.json   PassageAnalysis
 *   <COMPOSICION_DIR>/sesiones/<id>/lyrics/<pid>.json     LyricBoard
 *   <COMPOSICION_DIR>/temas/<id>.json                     Tema (la máquina de temas)
 *
 * Una TOMA de un tema no tiene archivo propio aquí: es una sesión más (con
 * `take`), así reusa análisis, molde y letras sin duplicar nada.
 *
 * Dos reglas:
 *  - Escritura ATÓMICA (tmp + rename): un corte a mitad no deja medio JSON.
 *  - Escrituras SERIALIZADAS por sesión: el pipeline parchea etapas mientras
 *    las rutas renombran voces o mueven pasajes; sin el candado, el último en
 *    escribir borraba lo del otro (leer-modificar-escribir no es atómico).
 */
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  BOARD_CONFLICT_ERROR,
  SESSION_STAGES,
  phraseSignature,
  reconcileLyricBoard,
  samePhraseLayout,
  validateBoard,
  validateTema,
  type ComposeSession,
  type ComposeSessionSummary,
  type ComposicionBoard,
  type LyricBoard,
  type PassageAnalysis,
  type Tema,
  type TemaListItem,
  type TranscriptWord,
} from "@hermes/shared";
import { env } from "../env.js";

export const COMPOSICION_DIR = env.COMPOSICION_DIR;
export const BOARD_PATH = join(COMPOSICION_DIR, "board.json");
const SESSIONS_DIR = join(COMPOSICION_DIR, "sesiones");
const TEMAS_DIR = join(COMPOSICION_DIR, "temas");

/** Ids que llegan a rutas de disco: nada de "/", "..", ni espacios. */
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;

export class ComposicionNotFoundError extends Error {}

export function isSafeId(id: string): boolean {
  return SAFE_ID.test(id);
}

function assertId(id: string, what: string): void {
  if (!isSafeId(id)) throw new ComposicionNotFoundError(`${what} inválido`);
}

export function sessionStateDir(id: string): string {
  assertId(id, "id de sesión");
  return join(SESSIONS_DIR, id);
}

// ─────────────────────────── Primitivas ───────────────────────────

let tmpSeq = 0;

/** Escribe JSON de forma atómica: tmp en la MISMA carpeta (rename no cruza discos). */
export async function writeJsonAtomic(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${++tmpSeq}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 1), "utf8");
  await rename(tmp, path);
}

async function readJson<T>(path: string): Promise<T | null> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return null;
  }
  return JSON.parse(text) as T;
}

/**
 * Candado por clave (cola de promesas). No es un mutex de SO: basta porque un
 * solo proceso (el agente) escribe estos archivos.
 */
const locks = new Map<string, Promise<unknown>>();

export function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  // La cola sigue aunque `fn` falle; se limpia cuando nadie más espera.
  const tail = run.catch(() => undefined);
  locks.set(key, tail);
  void tail.then(() => {
    if (locks.get(key) === tail) locks.delete(key);
  });
  return run;
}

// ─────────────────────────── Tablero ───────────────────────────

/** El tablero, o null si todavía no existe (la web cae a su mock). */
export async function readBoard(): Promise<ComposicionBoard | null> {
  const raw = await readJson<unknown>(BOARD_PATH);
  if (raw === null) return null;
  return validateBoard(raw);
}

/** El PUT llegó con una base vieja: alguien escribió el tablero después de que el cliente lo leyó. */
export class BoardConflictError extends Error {
  constructor(public board: ComposicionBoard) {
    super(BOARD_CONFLICT_ERROR);
  }
}

/**
 * Sello de escritura ESTRICTAMENTE mayor que el anterior. Dos escrituras en el
 * mismo milisegundo darían el mismo `updatedAt`, y la concurrencia optimista
 * (que compara sellos) dejaría pasar una base vieja como si fuera la vigente.
 */
export function nextStamp(prev?: string): string {
  const now = Date.now();
  const p = prev ? Date.parse(prev) : NaN;
  return new Date(Number.isFinite(p) && p >= now ? p + 1 : now).toISOString();
}

/**
 * Reemplaza el tablero completo (PUT de la web). Valida antes de escribir.
 * Con `baseUpdatedAt` (el sello del tablero que el cliente vio) es
 * concurrencia optimista: si el vigente tiene otro sello, NO se escribe y se
 * lanza BoardConflictError con el vigente (la ruta responde 409). Sin base
 * (clientes viejos) gana el último, como antes. Sin tablero en disco (o uno
 * ilegible, que el PUT viene a reparar) no hay nada que pisar.
 */
export function writeBoard(input: unknown, opts: { baseUpdatedAt?: string } = {}): Promise<ComposicionBoard> {
  return withLock("board", async () => {
    const valid = validateBoard(input);
    const current = await readBoard().catch(() => null);
    if (opts.baseUpdatedAt !== undefined && current && current.updatedAt !== opts.baseUpdatedAt)
      throw new BoardConflictError(current);
    const board: ComposicionBoard = { ...valid, updatedAt: nextStamp(current?.updatedAt) };
    await writeJsonAtomic(BOARD_PATH, board);
    return board;
  });
}

/** Leer-modificar-escribir del tablero (lo usa "crear canción desde la sesión"). */
export function updateBoard(fn: (board: ComposicionBoard) => void): Promise<ComposicionBoard> {
  return withLock("board", async () => {
    const board: ComposicionBoard = (await readBoard()) ?? {
      version: 1,
      songs: [],
      refs: [],
      notebook: [],
      updatedAt: new Date().toISOString(),
    };
    const prev = board.updatedAt;
    fn(board);
    board.updatedAt = nextStamp(prev);
    await writeJsonAtomic(BOARD_PATH, validateBoard(board));
    return board;
  });
}

// ─────────────────────────── Sesiones ───────────────────────────

const sessionPath = (id: string) => join(sessionStateDir(id), "session.json");

export async function readSession(id: string): Promise<ComposeSession | null> {
  if (!isSafeId(id)) return null;
  return readJson<ComposeSession>(sessionPath(id));
}

export async function sessionExists(id: string): Promise<boolean> {
  if (!isSafeId(id)) return false;
  return stat(sessionPath(id)).then(
    () => true,
    () => false,
  );
}

/** Alta de una sesión nueva (falla si el id ya existe: los ids son estables). */
export function createSessionRecord(session: ComposeSession): Promise<ComposeSession> {
  return withLock(`s:${session.id}`, async () => {
    if (await sessionExists(session.id)) throw new Error(`la sesión ${session.id} ya existe`);
    await writeJsonAtomic(sessionPath(session.id), session);
    summaryCache.delete(session.id);
    return session;
  });
}

/**
 * Parche serializado de una sesión. `fn` muta la copia leída (o devuelve una
 * nueva); se sella updatedAt. Lanza ComposicionNotFoundError si no existe.
 */
export function patchSession(
  id: string,
  fn: (s: ComposeSession) => ComposeSession | void,
): Promise<ComposeSession> {
  return withLock(`s:${id}`, async () => {
    const current = await readSession(id);
    if (!current) throw new ComposicionNotFoundError("sesión no encontrada");
    const next = fn(current) ?? current;
    next.updatedAt = new Date().toISOString();
    await writeJsonAtomic(sessionPath(id), next);
    return next;
  });
}

/** Resumen liviano para la lista. Cache por mtime: la lista se consulta en poll. */
const summaryCache = new Map<string, { mtimeMs: number; summary: ComposeSessionSummary }>();

export function toSummary(s: ComposeSession): ComposeSessionSummary {
  const running = s.stages.find((st) => st.status === "corriendo");
  const failed = s.stages.find((st) => st.status === "error");
  // La etapa que importa ver en la lista: la que corre, si no la que falló,
  // si no la última que avanzó.
  const lastDone = [...s.stages].reverse().find((st) => st.status !== "pendiente");
  return {
    id: s.id,
    title: s.title,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    recordedAt: s.recordedAt,
    durationSec: s.durationSec,
    status: s.status,
    songId: s.songId,
    mediaRoot: s.mediaRoot,
    stage: running ?? failed ?? lastDone,
    passages: s.passages.filter((p) => p.group !== "descartado").length,
    probable: s.passages.filter((p) => p.group === "probable").length,
    key: s.key?.best,
    source: s.source,
    // Lo justo para que la lista distinga una toma de una sesión y la agrupe por tema.
    ...(s.take
      ? {
          take: {
            temaId: s.take.temaId,
            sectionId: s.take.sectionId,
            n: s.take.n,
            ...(s.take.favorite !== undefined ? { favorite: s.take.favorite } : {}),
          },
        }
      : {}),
  };
}

export async function listSessions(): Promise<ComposeSessionSummary[]> {
  let ids: string[];
  try {
    ids = (await readdir(SESSIONS_DIR, { withFileTypes: true }))
      .filter((e) => e.isDirectory() && isSafeId(e.name))
      .map((e) => e.name);
  } catch {
    return [];
  }
  const out: ComposeSessionSummary[] = [];
  for (const id of ids) {
    try {
      const st = await stat(sessionPath(id));
      const cached = summaryCache.get(id);
      if (cached && cached.mtimeMs === st.mtimeMs) {
        out.push(cached.summary);
        continue;
      }
      const s = await readSession(id);
      if (!s) continue;
      const summary = toSummary(s);
      summaryCache.set(id, { mtimeMs: st.mtimeMs, summary });
      out.push(summary);
    } catch (err) {
      // Una sesión corrupta no tumba la lista: se omite y queda en el log.
      console.error(`[composicion] sesión ${id} ilegible:`, String(err).slice(0, 160));
    }
  }
  return out.sort((a, b) => (b.recordedAt ?? b.createdAt).localeCompare(a.recordedAt ?? a.createdAt));
}

/** Estado inicial de las etapas (todas pendientes, en el orden del contrato). */
export function freshStages(): ComposeSession["stages"] {
  return SESSION_STAGES.map((stage) => ({ stage, status: "pendiente" as const }));
}

// ─────────────────────────── Transcripción ───────────────────────────

const transcriptPath = (id: string) => join(sessionStateDir(id), "transcript.json");

export async function readTranscript(id: string): Promise<TranscriptWord[] | null> {
  if (!isSafeId(id)) return null;
  return readJson<TranscriptWord[]>(transcriptPath(id));
}

export async function writeTranscript(id: string, words: TranscriptWord[]): Promise<void> {
  await writeJsonAtomic(transcriptPath(id), words);
}

// ─────────────────────────── Análisis y letras por pasaje ───────────────────────────

const analysisPath = (id: string, pid: string) => {
  assertId(pid, "id de pasaje");
  return join(sessionStateDir(id), "passages", `${pid}.json`);
};
const lyricsPath = (id: string, pid: string) => {
  assertId(pid, "id de pasaje");
  return join(sessionStateDir(id), "lyrics", `${pid}.json`);
};

export async function readAnalysis(id: string, pid: string): Promise<PassageAnalysis | null> {
  if (!isSafeId(id) || !isSafeId(pid)) return null;
  return readJson<PassageAnalysis>(analysisPath(id, pid));
}

export function writeAnalysis(analysis: PassageAnalysis): Promise<void> {
  return withLock(`a:${analysis.sessionId}/${analysis.passageId}`, () =>
    writeJsonAtomic(analysisPath(analysis.sessionId, analysis.passageId), analysis),
  );
}

/** Parche serializado del análisis (corrección humana del molde). */
export function patchAnalysis(
  id: string,
  pid: string,
  fn: (a: PassageAnalysis) => PassageAnalysis | void,
): Promise<PassageAnalysis> {
  return withLock(`a:${id}/${pid}`, async () => {
    const current = await readAnalysis(id, pid);
    if (!current) throw new ComposicionNotFoundError("el pasaje todavía no tiene análisis");
    const next = fn(current) ?? current;
    await writeJsonAtomic(analysisPath(id, pid), next);
    return next;
  });
}

export async function removeAnalysis(id: string, pid: string): Promise<void> {
  await rm(analysisPath(id, pid), { force: true });
}

export async function hasLyrics(id: string, pid: string): Promise<boolean> {
  return stat(lyricsPath(id, pid)).then(
    () => true,
    () => false,
  );
}

/** ¿El tablero de letras tiene trabajo (versiones o una línea de "Tu versión" con texto)? */
export async function hasLyricContent(id: string, pid: string): Promise<boolean> {
  if (!(await hasLyrics(id, pid))) return false;
  const b = await readLyrics(id, pid).catch(() => null);
  return !!b && (b.versions.length > 0 || b.mine.some((m) => m.text.trim()));
}

export function emptyLyricBoard(id: string, pid: string): LyricBoard {
  return {
    sessionId: id,
    passageId: pid,
    versions: [],
    mine: [],
    locked: [],
    melismaMode: "respetar",
    updatedAt: new Date().toISOString(),
  };
}

/** El tablero de letras del pasaje (vacío si nunca se generó nada). */
export async function readLyrics(id: string, pid: string): Promise<LyricBoard> {
  if (!isSafeId(id) || !isSafeId(pid)) throw new ComposicionNotFoundError("pasaje inválido");
  return (await readJson<LyricBoard>(lyricsPath(id, pid))) ?? emptyLyricBoard(id, pid);
}

/** Parche serializado del tablero de letras (generación y "Tu versión" a la vez). */
export function patchLyrics(
  id: string,
  pid: string,
  fn: (b: LyricBoard) => LyricBoard | void,
): Promise<LyricBoard> {
  return withLock(`l:${id}/${pid}`, async () => {
    const current = await readLyrics(id, pid);
    const next = fn(current) ?? current;
    next.updatedAt = new Date().toISOString();
    await writeJsonAtomic(lyricsPath(id, pid), next);
    return next;
  });
}

/**
 * Alinea el tablero de letras con un análisis NUEVO del pasaje (lo llama el
 * pipeline al guardar un re-análisis). Si las frases se movieron, lo escrito
 * queda `stale` en vez de caer por índice en otra frase. Un tablero sin firma
 * (anterior al campo) se escribió sobre `prev`: si `prev` tenía las mismas
 * frases, adopta la firma nueva; si no, lo suyo es de un análisis anterior.
 */
export async function alignLyricsToAnalysis(
  prev: PassageAnalysis | null,
  next: PassageAnalysis,
): Promise<void> {
  const { sessionId: id, passageId: pid } = next;
  if (!(await hasLyrics(id, pid))) return;
  const sig = phraseSignature(next);
  const current = await readLyrics(id, pid).catch(() => null);
  if (current?.phrasesSig === sig) return;
  await patchLyrics(id, pid, (b) => {
    const boardSig = b.phrasesSig ?? (prev && !samePhraseLayout(prev, next) ? phraseSignature(prev) : undefined);
    reconcileLyricBoard(b, sig, boardSig);
  });
}

// ─────────────────────────── Temas ───────────────────────────

/**
 * Un tema es un JSON chico con PATCH fino (no va en el PUT del tablero: el
 * agente también escribe — las tomas cuelgan de él — y un PUT del browser con
 * un tablero viejo borraría lo que el servidor agregó).
 */
const temaPath = (id: string) => {
  assertId(id, "id de tema");
  return join(TEMAS_DIR, `${id}.json`);
};

export async function readTema(id: string): Promise<Tema | null> {
  if (!isSafeId(id)) return null;
  return readJson<Tema>(temaPath(id));
}

export async function temaExists(id: string): Promise<boolean> {
  if (!isSafeId(id)) return false;
  return stat(temaPath(id)).then(
    () => true,
    () => false,
  );
}

/** Alta de un tema (valida; falla si el id ya existe). */
export function createTemaRecord(tema: Tema): Promise<Tema> {
  return withLock(`t:${tema.id}`, async () => {
    if (await temaExists(tema.id)) throw new Error(`el tema ${tema.id} ya existe`);
    const valid = validateTema(tema);
    await writeJsonAtomic(temaPath(valid.id), valid);
    return valid;
  });
}

/**
 * Parche serializado de un tema: `fn` muta una copia; se valida el RESULTADO
 * del merge (no el parche suelto: un loop válido con un bpm inválido que ya
 * estaba no es "válido") y se sella updatedAt. id y createdAt no se tocan.
 */
export function patchTema(id: string, fn: (t: Tema) => Tema | void): Promise<Tema> {
  return withLock(`t:${id}`, async () => {
    const current = await readTema(id);
    if (!current) throw new ComposicionNotFoundError("tema no encontrado");
    const draft = structuredClone(current);
    const next = fn(draft) ?? draft;
    next.id = current.id;
    next.createdAt = current.createdAt;
    next.updatedAt = new Date().toISOString();
    const valid = validateTema(next);
    await writeJsonAtomic(temaPath(id), valid);
    return valid;
  });
}

/** Borra el tema. Sus tomas se quedan en disco (y en Sesiones): el audio no se tira. */
export function deleteTema(id: string): Promise<boolean> {
  return withLock(`t:${id}`, async () => {
    if (!(await temaExists(id))) return false;
    await rm(temaPath(id), { force: true });
    return true;
  });
}

/** Ids de temas en disco (los nombres raros o los .tmp de una escritura a medias se ignoran). */
async function temaIds(): Promise<string[]> {
  try {
    return (await readdir(TEMAS_DIR))
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.slice(0, -5))
      .filter(isSafeId);
  } catch {
    return [];
  }
}

/** La lista liviana, con cuántas tomas tiene cada tema (contadas sobre las sesiones reales). */
export async function listTemas(): Promise<TemaListItem[]> {
  const takes = new Map<string, number>();
  for (const s of await listSessions()) {
    if (s.take) takes.set(s.take.temaId, (takes.get(s.take.temaId) ?? 0) + 1);
  }
  const out: TemaListItem[] = [];
  for (const id of await temaIds()) {
    try {
      const t = await readTema(id);
      if (!t) continue;
      out.push({
        id: t.id,
        title: t.title,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        stage: t.stage,
        ...(t.songId ? { songId: t.songId } : {}),
        key: t.track.key,
        bpm: t.track.bpm,
        takes: takes.get(t.id) ?? 0,
      });
    } catch (err) {
      // Un tema corrupto no tumba la lista: se omite y queda en el log.
      console.error(`[composicion] tema ${id} ilegible:`, String(err).slice(0, 160));
    }
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
