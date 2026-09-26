/**
 * TEMAS — la máquina de temas de Composición, lado agente (contrato en
 * packages/shared/src/tema.ts; rutas en routes.ts).
 *
 * Un tema es un JSON chico (store.ts) con la pista, la intención y el
 * montaje. Sus TOMAS no son otra entidad: cada una es una `ComposeSession`
 * con `take` y un solo pasaje P01, así heredan el pipeline, el análisis, el
 * molde, las letras y el servidor de archivos sin duplicar nada. Lo que vive
 * aquí es lo que un tema agrega encima:
 *
 *  - Crear un tema en blanco o DESDE UN TARAREO de Sesiones (la tonalidad
 *    medida y un bpm estimado — aproximado, y rotulado así).
 *  - El detalle: tomas + pasajes enlazados vistos como CANDIDATOS de cada
 *    sección, y lo que le falta a cada etapa (gates sobre el material real).
 *  - Recibir una toma (WAV + meta con la rejilla) y validarla ANTES de
 *    escribir un byte: un WAV roto o una rejilla incoherente no deben
 *    llegar a un análisis que después "mide" basura.
 *  - Corregir una toma (★, latencia, pista de texto) → re-análisis.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  beatsPerBar,
  decodeWav,
  estimateTempo,
  newTema,
  parseChord,
  sessionSlug,
  temaGates,
  type ChordBar,
  type ComposeSession,
  type Key,
  type MemoRef,
  type MontagePick,
  type Tema,
  type TemaCandidate,
  type TemaDetail,
  type TemaStage,
  type TakeGrid,
  type TakeMeta,
} from "@hermes/shared";
import { temasMediaRoot } from "./media.js";
import {
  TAKE_PASSAGE,
  createTakeSession,
  localDate,
  queuePassageAnalysis,
  sessionBusy,
} from "./pipeline.js";
import {
  ComposicionNotFoundError,
  createTemaRecord,
  listSessions,
  patchSession,
  patchTema,
  readAnalysis,
  readBoard,
  readLyrics,
  readSession,
  readTema,
  temaExists,
  withLock,
} from "./store.js";

/** Tope de una toma: 60 MB de WAV son ~5 min mono a 48 kHz/16 bits — una toma es de segundos. */
export const MAX_TAKE_BYTES = 60 * 1024 * 1024;
/** Una toma más corta que esto no tiene nada que medir. */
const MIN_TAKE_SEC = 0.5;
/** Latencia creíble de un navegador (Bluetooth llega a ~250 ms; 1 s ya es un error de medida). */
const MAX_LATENCY_MS = 1000;
const MAX_HINT = 500;

export class TemaError extends Error {
  constructor(
    message: string,
    public status: 400 | 404 | 409 | 413 = 400,
  ) {
    super(message);
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const round2 = (n: number) => Math.round(n * 100) / 100;
const METERS = new Set(["4/4", "3/4", "6/8"]);

// ─────────────────────────── Crear ───────────────────────────

function parseMemo(raw: unknown): MemoRef {
  if (!isObj(raw) || typeof raw.sessionId !== "string" || typeof raw.passageId !== "string")
    throw new TemaError("fromPassage debe ser {sessionId, passageId}");
  return { sessionId: raw.sessionId, passageId: raw.passageId };
}

/**
 * Id libre para un tema. No basta con que no exista el JSON: las tomas de un
 * tema BORRADO siguen en disco con su temaId, y un tema nuevo con el mismo id
 * las heredaría como propias.
 */
async function uniqueTemaId(base: string): Promise<string> {
  const orphanTakes = new Set((await listSessions()).flatMap((s) => (s.take ? [s.take.temaId] : [])));
  const root = temasMediaRoot().root;
  let id = base;
  for (let n = 2; (await temaExists(id)) || orphanTakes.has(id) || existsSync(join(root, id)); n++) id = `${base}-${n}`;
  return id;
}

/**
 * Tema nuevo. Desde un pasaje de Sesiones, prellena lo que se puede MEDIR: la
 * tonalidad (el instrumento manda, la voz si no hubo instrumento; si el
 * pasaje no tiene análisis, la de la sesión) y el bpm estimado de los ataques
 * de sus notas — aproximado, y la pista lo rotula como "estimado". El pasaje
 * entra como referencia del Coro (el tarareo del que nació).
 */
export async function createTema(input: { title?: unknown; fromPassage?: unknown }): Promise<Tema> {
  if (input.title !== undefined && typeof input.title !== "string") throw new TemaError("title debe ser texto");
  let title = (input.title ?? "").trim().slice(0, 120);
  const now = new Date();
  let key: Key | undefined;
  let keySource: "medida" | undefined;
  let bpm: number | undefined;
  let bpmSource: "estimado" | undefined;
  let origin: MemoRef | undefined;

  if (input.fromPassage !== undefined && input.fromPassage !== null) {
    origin = parseMemo(input.fromPassage);
    const s = await readSession(origin.sessionId);
    if (!s) throw new ComposicionNotFoundError("sesión no encontrada");
    const p = s.passages.find((q) => q.id === origin!.passageId);
    if (!p) throw new ComposicionNotFoundError("pasaje no encontrado");
    const a = await readAnalysis(s.id, p.id);
    const measured = a ? (a.instrumentKey ?? a.key) : s.key;
    if (measured && measured.confidence > 0) {
      key = measured.best.key;
      keySource = "medida";
    }
    const onsets = (a?.notes ?? []).map((n) => n.start);
    const tempo = onsets.length >= 4 ? estimateTempo(onsets) : null;
    if (tempo && Number.isFinite(tempo.bpm)) {
      bpm = Math.min(220, Math.max(40, Math.round(tempo.bpm)));
      bpmSource = "estimado";
    }
    if (!title) title = `${s.title} · ${p.label}`.slice(0, 120);
  }
  if (!title) title = "Tema nuevo";

  // Elegir el id y escribir van juntos: dos altas simultáneas con el mismo
  // título no deben elegir el mismo id (la segunda reventaría con un 500).
  return withLock("temas:alta", async () => {
    const id = await uniqueTemaId(sessionSlug(title, localDate(now.toISOString())));
    const tema = newTema({
      id,
      title,
      now: now.toISOString(),
      ...(key ? { key, keySource } : {}),
      ...(bpm ? { bpm, bpmSource } : {}),
      ...(origin ? { origin } : {}),
    });
    if (origin) {
      const memo = origin;
      const coro = tema.track.sections.find((sec) => sec.kind === "coro") ?? tema.track.sections[0];
      if (coro && !coro.refs?.some((r) => r.sessionId === memo.sessionId && r.passageId === memo.passageId))
        coro.refs = [...(coro.refs ?? []), memo];
      tema.origin = memo;
    }
    return createTemaRecord(tema);
  });
}

// ─────────────────────────── Editar ───────────────────────────

const TEMA_PATCH_KEYS = new Set(["title", "stage", "intent", "track", "montage", "songId"]);
/** Vienen de vuelta si la web manda el tema entero: se ignoran (no se editan por PATCH). */
const TEMA_READONLY = new Set(["id", "createdAt", "updatedAt", "origin"]);

/** Merge de un nivel: `null` borra la clave (así se limpia un campo opcional). */
function mergeShallow<T extends object>(base: T, patch: Record<string, unknown>): T {
  const out = { ...base } as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k];
    else if (v !== undefined) out[k] = v;
  }
  return out as T;
}

/**
 * PATCH fino de un tema: title, stage, intent (merge), track (merge; `sections`
 * se reemplaza entera), montage (se reemplaza), songId (null = desvincular).
 * validateTema corre sobre el RESULTADO (store.patchTema). Un campo que no es
 * del contrato es un 400 — un typo de la web no debe perderse en silencio.
 */
export async function updateTema(id: string, body: Record<string, unknown>): Promise<Tema> {
  for (const k of Object.keys(body))
    if (!TEMA_PATCH_KEYS.has(k) && !TEMA_READONLY.has(k)) throw new TemaError(`campo desconocido: ${k}`);
  if (body.intent !== undefined && !isObj(body.intent)) throw new TemaError("intent debe ser un objeto");
  if (body.track !== undefined && !isObj(body.track)) throw new TemaError("track debe ser un objeto");
  if (body.montage !== undefined && !Array.isArray(body.montage)) throw new TemaError("montage debe ser una lista");
  if (body.songId !== undefined && body.songId !== null && typeof body.songId !== "string")
    throw new TemaError("songId debe ser texto o null");
  if (typeof body.songId === "string" && body.songId) {
    const board = await readBoard();
    if (!board?.songs.some((s) => s.id === body.songId)) throw new TemaError("la canción no existe en el tablero", 404);
  }
  return patchTema(id, (t) => {
    if (body.title !== undefined) {
      const title = typeof body.title === "string" ? body.title.trim().slice(0, 120) : "";
      if (!title) throw new TemaError("el título no puede quedar vacío");
      t.title = title;
    }
    if (body.stage !== undefined) t.stage = body.stage as TemaStage;
    if (isObj(body.intent)) t.intent = mergeShallow(t.intent, body.intent);
    if (isObj(body.track)) t.track = mergeShallow(t.track, body.track);
    if (Array.isArray(body.montage)) t.montage = body.montage as MontagePick[];
    if (body.songId !== undefined) {
      if (body.songId === null || body.songId === "") delete t.songId;
      else t.songId = body.songId as string;
    }
  });
}

// ─────────────────────────── Detalle ───────────────────────────

/** Resumen del tablero de letras de un pasaje: cuántas versiones, cuánto de "Tu versión", el mejor calce. */
async function lyricsSummary(sessionId: string, passageId: string): Promise<TemaCandidate["lyrics"]> {
  const b = await readLyrics(sessionId, passageId).catch(() => null);
  if (!b) return { versions: 0, mine: 0 };
  // El calce de una versión = el promedio de sus líneas (el mismo número que ordena en la UI).
  const scores = b.versions
    .filter((v) => v.lines.length)
    .map((v) => v.lines.reduce((a, l) => a + (l.fit?.score ?? 0), 0) / v.lines.length);
  return {
    versions: b.versions.length,
    // Las líneas de un análisis anterior (stale) no cuentan: no calzan con las frases de hoy.
    mine: b.mine.filter((m) => m.text.trim() && !m.stale).length,
    ...(scores.length ? { bestScore: round2(Math.max(...scores)) } : {}),
  };
}

/**
 * Candidatos del tema: sus tomas (sesiones con take.temaId) y los pasajes de
 * Sesiones enlazados en `refs` de cada sección. "procesando" = hay trabajo
 * vivo sobre esa toma (pipeline o re-análisis): la web hace poll mientras
 * alguno lo esté. Un pasaje enlazado que ya no existe se omite.
 */
export async function temaCandidates(tema: Tema): Promise<TemaCandidate[]> {
  const out: (TemaCandidate & { _order: number; _n: number })[] = [];
  const sectionOrder = new Map(tema.track.sections.map((sec, i) => [sec.id, i]));
  const orderOf = (sectionId: string) => sectionOrder.get(sectionId) ?? tema.track.sections.length;

  for (const sum of await listSessions()) {
    if (sum.take?.temaId !== tema.id) continue;
    const s = await readSession(sum.id);
    if (!s?.take) continue;
    const p = s.passages.find((q) => q.id === TAKE_PASSAGE);
    const busy = s.status === "procesando" || sessionBusy(s.id);
    const status: TemaCandidate["status"] = busy
      ? "procesando"
      : p
        ? p.status
        : s.status === "error"
          ? "error"
          : "pendiente";
    out.push({
      memo: { sessionId: s.id, passageId: TAKE_PASSAGE },
      kind: "toma",
      label: s.title,
      sectionId: s.take.sectionId,
      favorite: Boolean(s.take.favorite),
      status,
      onGrid: true,
      recordedAt: s.recordedAt ?? s.createdAt,
      ...(s.durationSec !== undefined ? { durationSec: s.durationSec } : {}),
      ...(p?.syllables !== undefined ? { syllables: p.syllables } : {}),
      ...(p?.melismas !== undefined ? { melismas: p.melismas } : {}),
      lyrics: p ? await lyricsSummary(s.id, p.id) : { versions: 0, mine: 0 },
      _order: orderOf(s.take.sectionId),
      _n: s.take.n,
    });
  }

  for (const sec of tema.track.sections) {
    for (const ref of sec.refs ?? []) {
      const s = await readSession(ref.sessionId);
      const p = s?.passages.find((q) => q.id === ref.passageId);
      if (!s || !p) continue;
      out.push({
        memo: { sessionId: s.id, passageId: p.id },
        kind: "pasaje",
        label: `${p.label} · ${s.title}`,
        sectionId: sec.id,
        favorite: false,
        status: sessionBusy(s.id) && p.status !== "listo" ? "procesando" : p.status,
        onGrid: false,
        recordedAt: s.recordedAt ?? s.createdAt,
        durationSec: round2(p.end - p.start),
        ...(p.syllables !== undefined ? { syllables: p.syllables } : {}),
        ...(p.melismas !== undefined ? { melismas: p.melismas } : {}),
        lyrics: await lyricsSummary(s.id, p.id),
        _order: orderOf(sec.id),
        _n: Number.MAX_SAFE_INTEGER,
      });
    }
  }

  // Orden de lectura: por sección (el orden de la pista), tomas por número, los pasajes al final.
  return out
    .sort((a, b) => a._order - b._order || a._n - b._n || a.recordedAt.localeCompare(b.recordedAt))
    .map(({ _order, _n, ...c }) => c);
}

export async function temaDetail(id: string): Promise<TemaDetail> {
  const tema = await readTema(id);
  if (!tema) throw new ComposicionNotFoundError("tema no encontrado");
  const candidates = await temaCandidates(tema);
  return { tema, candidates, gates: temaGates(tema, candidates) };
}

// ─────────────────────────── Tomas ───────────────────────────

function num(v: unknown, what: string, min: number, max: number): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max)
    throw new TemaError(`${what} debe ser un número entre ${min} y ${max}`);
  return v;
}

function int(v: unknown, what: string, min: number, max: number): number {
  if (!Number.isInteger(v) || (v as number) < min || (v as number) > max)
    throw new TemaError(`${what} debe ser un entero entre ${min} y ${max}`);
  return v as number;
}

function parseKey(raw: unknown): Key {
  if (!isObj(raw) || (raw.mode !== "major" && raw.mode !== "minor"))
    throw new TemaError("grid.key debe ser {tonic 0..11, mode major|minor}");
  return { tonic: int(raw.tonic, "grid.key.tonic", 0, 11), mode: raw.mode };
}

function parseLoop(raw: unknown, meter: TakeGrid["meter"]): ChordBar[] {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 16)
    throw new TemaError("grid.loop debe tener entre 1 y 16 compases");
  const beats = beatsPerBar(meter);
  return raw.map((bar, i) => {
    if (!isObj(bar) || !Array.isArray(bar.chords) || bar.chords.length < 1 || bar.chords.length > 2)
      throw new TemaError(`grid.loop[${i}]: cada compás lleva 1 o 2 acordes`);
    return {
      chords: bar.chords.map((c: unknown) => {
        if (!isObj(c) || typeof c.symbol !== "string" || !parseChord(c.symbol))
          throw new TemaError(`grid.loop[${i}]: acorde no reconocido (${isObj(c) ? String(c.symbol) : "?"})`);
        return { symbol: c.symbol, beat: int(c.beat, `grid.loop[${i}].beat`, 0, beats - 1) };
      }),
    };
  });
}

/**
 * La rejilla con la que se grabó. `downbeatSec` es un segundo DEL AUDIO de la
 * toma (ya compensado por latencia): tiene que caer dentro de ella, o el
 * análisis pondría todas las notas en compases que no existen.
 */
function parseGrid(raw: unknown, durationSec: number): TakeGrid {
  if (!isObj(raw)) throw new TemaError("meta.grid es obligatorio");
  if (typeof raw.meter !== "string" || !METERS.has(raw.meter)) throw new TemaError("grid.meter: 4/4 | 3/4 | 6/8");
  const meter = raw.meter as TakeGrid["meter"];
  const downbeatSec = num(raw.downbeatSec, "grid.downbeatSec", 0, Number.MAX_VALUE);
  if (downbeatSec >= durationSec)
    throw new TemaError(
      `grid.downbeatSec (${downbeatSec.toFixed(3)} s) cae fuera de la toma (dura ${durationSec.toFixed(3)} s)`,
    );
  return {
    bpm: num(raw.bpm, "grid.bpm", 40, 220),
    meter,
    key: parseKey(raw.key),
    downbeatSec,
    loop: parseLoop(raw.loop, meter),
    bars: int(raw.bars, "grid.bars", 1, 64),
    ...(raw.swing !== undefined ? { swing: num(raw.swing, "grid.swing", 0, 0.5) } : {}),
  };
}

/** La meta que manda el browser (TakeMeta sin `n`), validada contra el tema y la duración real. */
export function parseTakeMeta(raw: unknown, tema: Tema, durationSec: number): Omit<TakeMeta, "n"> {
  if (!isObj(raw)) throw new TemaError("meta debe ser un objeto JSON");
  if (raw.temaId !== undefined && raw.temaId !== tema.id) throw new TemaError("meta.temaId no es el tema de la ruta");
  if (typeof raw.sectionId !== "string" || !tema.track.sections.some((s) => s.id === raw.sectionId))
    throw new TemaError(`la sección «${String(raw.sectionId)}» no existe en el tema`);
  let latency: TakeMeta["latency"] = { ms: 0, source: "manual" };
  if (raw.latency !== undefined) {
    const l = raw.latency;
    if (!isObj(l) || (l.source !== "medida" && l.source !== "navegador" && l.source !== "manual"))
      throw new TemaError("latency debe ser {ms, source: medida|navegador|manual}");
    latency = { ms: num(l.ms, "latency.ms", -MAX_LATENCY_MS, MAX_LATENCY_MS), source: l.source };
  }
  if (raw.monitor !== undefined && raw.monitor !== "audifonos" && raw.monitor !== "parlantes")
    throw new TemaError("monitor: audifonos | parlantes");
  if (raw.stt !== undefined && typeof raw.stt !== "boolean") throw new TemaError("stt debe ser true/false");
  if (raw.hint !== undefined && typeof raw.hint !== "string") throw new TemaError("hint debe ser texto");
  if (raw.favorite !== undefined && typeof raw.favorite !== "boolean") throw new TemaError("favorite debe ser true/false");
  const hint = typeof raw.hint === "string" ? raw.hint.trim().slice(0, MAX_HINT) : "";
  return {
    temaId: tema.id,
    sectionId: raw.sectionId,
    grid: parseGrid(raw.grid, durationSec),
    latency,
    // Default audífonos: es lo que se recomienda y el caso sin separación.
    monitor: raw.monitor === "parlantes" ? "parlantes" : "audifonos",
    stt: raw.stt === true,
    ...(hint ? { hint } : {}),
    ...(raw.favorite !== undefined ? { favorite: raw.favorite as boolean } : {}),
    ...(raw.cycle !== undefined ? { cycle: int(raw.cycle, "cycle", 0, 999) } : {}),
  };
}

/** Quita la ★ a las demás tomas de la sección: la favorita es UNA (el montaje la toma por defecto). */
async function clearOtherFavorites(temaId: string, sectionId: string, keep: string): Promise<void> {
  for (const s of await listSessions()) {
    if (s.id === keep || s.take?.temaId !== temaId || s.take.sectionId !== sectionId || !s.take.favorite) continue;
    await patchSession(s.id, (x) => {
      if (x.take) x.take.favorite = false;
    });
  }
}

/**
 * Recibe una toma: valida el WAV (cabecera RIFF/WAVE decodificable, ≤ 60 MB,
 * ≥ medio segundo) y la meta (sección existente, rejilla coherente con la
 * duración real), asigna el número (n = máximo de la sección + 1, bajo un
 * candado por tema: dos tomas que suben a la vez no comparten número), crea la
 * sesión en la carpeta de la toma y arranca el pipeline.
 */
export async function createTake(temaId: string, bytes: Uint8Array, rawMeta: unknown): Promise<ComposeSession> {
  const tema = await readTema(temaId);
  if (!tema) throw new ComposicionNotFoundError("tema no encontrado");
  if (bytes.length > MAX_TAKE_BYTES)
    throw new TemaError(`la toma pesa ${(bytes.length / 1024 / 1024).toFixed(1)} MB; el tope es 60 MB`, 413);
  let durationSec: number;
  try {
    const wav = decodeWav(bytes);
    durationSec = wav.pcm.length / wav.sr;
  } catch (err) {
    throw new TemaError(`el audio debe ser un WAV (RIFF/WAVE): ${(err as Error).message}`.slice(0, 300));
  }
  if (!(durationSec >= MIN_TAKE_SEC)) throw new TemaError("la toma dura menos de medio segundo");
  const meta = parseTakeMeta(rawMeta, tema, durationSec);
  const section = tema.track.sections.find((s) => s.id === meta.sectionId)!;

  return withLock(`takes:${temaId}`, async () => {
    const n =
      (await listSessions()).reduce(
        (m, s) => (s.take?.temaId === temaId && s.take.sectionId === meta.sectionId ? Math.max(m, s.take.n) : m),
        0,
      ) + 1;
    const session = await createTakeSession({
      bytes,
      title: `Toma ${n} · ${section.label}`,
      slug: `toma ${n} ${section.label} ${tema.title}`,
      take: { ...meta, n },
      durationSec,
    });
    if (meta.favorite) await clearOtherFavorites(temaId, meta.sectionId, session.id);
    return session;
  });
}

const TAKE_PATCH_KEYS = new Set(["favorite", "latencyMs", "hint"]);

/**
 * Corrige una toma. ★ es exclusiva por sección. `latencyMs` corre el primer
 * tiempo de la rejilla por la DIFERENCIA con la latencia con que se grabó (más
 * latencia = la voz llegó más tarde al archivo = el compás 1 cae más tarde en
 * el audio). Latencia y pista de texto cambian la lectura → re-análisis de P01.
 */
export async function patchTake(temaId: string, sid: string, body: Record<string, unknown>): Promise<ComposeSession> {
  for (const k of Object.keys(body)) if (!TAKE_PATCH_KEYS.has(k)) throw new TemaError(`campo desconocido: ${k}`);
  if (body.favorite !== undefined && typeof body.favorite !== "boolean") throw new TemaError("favorite debe ser true/false");
  const latencyMs =
    body.latencyMs === undefined ? undefined : num(body.latencyMs, "latencyMs", -MAX_LATENCY_MS, MAX_LATENCY_MS);
  if (body.hint !== undefined && body.hint !== null && typeof body.hint !== "string")
    throw new TemaError("hint debe ser texto o null");
  const hint = body.hint === undefined ? undefined : typeof body.hint === "string" ? body.hint.trim().slice(0, MAX_HINT) : "";

  const current = await readSession(sid);
  if (!current?.take || current.take.temaId !== temaId) throw new ComposicionNotFoundError("toma no encontrada en este tema");

  let reanalyze = false;
  const updated = await withLock(`takes:${temaId}`, async () => {
    const next = await patchSession(sid, (x) => {
      const take = x.take!;
      if (latencyMs !== undefined && latencyMs !== take.latency.ms) {
        const downbeat = take.grid.downbeatSec + (latencyMs - take.latency.ms) / 1000;
        const dur = x.durationSec ?? Infinity;
        if (!(downbeat >= 0 && downbeat < dur))
          throw new TemaError(`con ${latencyMs} ms el primer tiempo quedaría fuera de la toma (${downbeat.toFixed(3)} s)`);
        take.grid.downbeatSec = Math.round(downbeat * 10000) / 10000;
        take.latency = { ms: latencyMs, source: "manual" };
        reanalyze = true;
      }
      if (hint !== undefined && hint !== (take.hint ?? "")) {
        if (hint) take.hint = hint;
        else delete take.hint;
        // Sin Scribe, lo que se cantó ES la pista de texto.
        const p = x.passages.find((q) => q.id === TAKE_PASSAGE);
        if (p && !take.stt) p.text = hint;
        reanalyze = true;
      }
      if (body.favorite !== undefined) take.favorite = body.favorite as boolean;
    });
    if (body.favorite === true) await clearOtherFavorites(temaId, next.take!.sectionId, sid);
    return next;
  });
  // Sin P01 o sin audio todavía, el pipeline en curso leerá la meta nueva cuando llegue ahí.
  if (reanalyze && updated.files.audio && updated.passages.some((p) => p.id === TAKE_PASSAGE))
    queuePassageAnalysis(sid, TAKE_PASSAGE, { force: true });
  return updated;
}
