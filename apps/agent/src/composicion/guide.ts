/**
 * GUÍA CANTADA ("vocaloid-lite"): las líneas de letra, cantadas sobre la
 * melodía de un pasaje o una toma, para ESCUCHAR si la letra calza antes de
 * cantarla. Es una guía, no un demo: suena a TTS llevado a las notas.
 *
 * Por línea: la lectura con sinalefas que eligió `lineFit` (`lineReading`) +
 * lo que pide cada posición del molde (`slots`) → TTS de ElevenLabs con
 * alineación por carácter (tts.ts, cacheado) → sílabas dentro del audio del
 * TTS (`alignSyllables`) → plan: qué tramo va a qué tiempo del pasaje y con
 * qué altura (`planGuide`; en modo "tarareo" con el contorno f0 real) →
 * PSOLA (`renderSung`). Todas las líneas se mezclan en un buffer del largo del
 * pasaje y se escribe UN WAV en analisis/<pid>/guias/<hash>.wav.
 *
 * Caché en dos niveles: el WAV por hash del pedido (líneas, modo, altura,
 * semitonos, voz, correcciones del molde, `analyzedAt` y versión del motor) y
 * el TTS por texto (tts.ts). Cambiar semitonos o el modo re-renderiza pero NO
 * vuelve a cobrar caracteres.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  alignSyllables,
  encodeWav16,
  lineReading,
  moldSlots,
  phraseMold,
  planGuide,
  renderSung,
  stripChords,
  type GuideRequest,
  type GuideResult,
  type GuideSegment,
  type MelismaMode,
  type PassageAnalysis,
} from "@hermes/shared";
import { env } from "../env.js";
import { emit } from "../events.js";
import { MAX_TRANSPOSE } from "./media.js";
import { readAnalysis, readSession } from "./store.js";
import { TtsError, elevenTts, isVoiceId, ttsModel } from "./tts.js";

/** Versión del motor: entra al hash, así un cambio del plan o del PSOLA no sirve WAVs viejos. */
export const GUIDE_ENGINE_VERSION = "psola-1";
const MAX_LINES = 32;
const MAX_LINE_CHARS = 200;
/** Pedidos simultáneos al TTS (la cuenta admite 3; se deja uno libre para la voz de Hermes). */
const TTS_POOL = 2;

export class GuideError extends Error {
  constructor(
    message: string,
    public status: 400 | 402 | 404 | 409 | 502 | 503 = 400,
  ) {
    super(message);
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const round3 = (n: number) => Math.round(n * 1000) / 1000;

interface ValidRequest {
  lines: { phrase: number; text: string }[];
  mode: MelismaMode;
  pitch: GuideRequest["pitch"];
  semitones: number;
  voiceId: string;
}

export function validateGuideRequest(raw: unknown, analysis: PassageAnalysis): ValidRequest {
  if (!isObj(raw)) throw new GuideError("cuerpo JSON inválido");
  const phrases = new Set(analysis.phrases.map((p) => p.idx));
  if (!Array.isArray(raw.lines) || raw.lines.length < 1 || raw.lines.length > MAX_LINES)
    throw new GuideError(`lines debe traer de 1 a ${MAX_LINES} líneas`);
  const seen = new Set<number>();
  const lines = raw.lines.map((l) => {
    if (!isObj(l) || !Number.isInteger(l.phrase) || typeof l.text !== "string")
      throw new GuideError("cada línea necesita {phrase, text}");
    const phrase = l.phrase as number;
    if (!phrases.has(phrase)) throw new GuideError(`la frase ${phrase} no existe en el pasaje`);
    if (seen.has(phrase)) throw new GuideError(`la frase ${phrase} viene dos veces`);
    seen.add(phrase);
    const text = stripChords(l.text).replace(/\s+/g, " ").trim();
    if (!text) throw new GuideError(`la frase ${phrase} no tiene texto`);
    if (text.length > MAX_LINE_CHARS) throw new GuideError(`la frase ${phrase} pasa de ${MAX_LINE_CHARS} caracteres`);
    return { phrase, text };
  });
  const mode = raw.mode ?? "respetar";
  if (mode !== "respetar" && mode !== "silabizar") throw new GuideError('mode: "respetar" | "silabizar"');
  const pitch = raw.pitch ?? "notas";
  if (pitch !== "notas" && pitch !== "tarareo") throw new GuideError('pitch: "notas" | "tarareo"');
  const semitones = raw.semitones ?? 0;
  if (!Number.isInteger(semitones) || Math.abs(semitones as number) > MAX_TRANSPOSE)
    throw new GuideError(`semitones: entero entre −${MAX_TRANSPOSE} y ${MAX_TRANSPOSE}`);
  const voice = raw.voiceId ?? env.COMPOSICION_GUIDE_VOICE;
  if (!voice) throw new GuideError("elige una voz para la guía (GET /composicion/guide/voices)");
  if (!isVoiceId(voice)) throw new GuideError("voiceId inválido");
  return {
    lines: lines.sort((a, b) => a.phrase - b.phrase),
    mode,
    pitch,
    semitones: semitones as number,
    voiceId: voice,
  };
}

/** Hash del WAV: todo lo que cambia el audio y nada más. */
export function guideHash(req: ValidRequest, analysis: PassageAnalysis): string {
  const overrides = req.lines.map((l) => analysis.phrases.find((p) => p.idx === l.phrase)?.override ?? null);
  const key = JSON.stringify({
    engine: GUIDE_ENGINE_VERSION,
    model: ttsModel(),
    analyzedAt: analysis.analyzedAt,
    lines: req.lines,
    mode: req.mode,
    pitch: req.pitch,
    semitones: req.semitones,
    voiceId: req.voiceId,
    overrides,
  });
  return createHash("sha1").update(key).digest("hex").slice(0, 20);
}

/**
 * Corre `fn` sobre `items` con a lo más `n` en vuelo; conserva el orden. Al
 * PRIMER fallo nadie toma un ítem nuevo (lo que ya está en vuelo termina) y
 * se rechaza con ese error: antes Promise.all rechazaba, pero el otro worker
 * seguía pidiendo TTS — y cobrando caracteres — para una guía que ya falló.
 */
export async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length && !failed) {
      const i = next++;
      try {
        out[i] = await fn(items[i]);
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  });
  await Promise.all(workers);
  return out;
}

type Cached = Omit<GuideResult, "ttsChars" | "cached">;

/**
 * Renderiza (o sirve de caché) la guía cantada de unas líneas sobre un pasaje.
 * Síncrono (~1-2 s por línea nueva; de caché, milisegundos). `signal` = el
 * request: si el browser cancela, se corta el TTS en vuelo.
 */
export async function renderGuide(
  sessionId: string,
  passageId: string,
  rawReq: unknown,
  signal?: AbortSignal,
): Promise<GuideResult> {
  if (!env.ELEVENLABS_API_KEY)
    throw new GuideError("sin ELEVENLABS_API_KEY: la guía cantada necesita el TTS de ElevenLabs (voz genérica)", 503);
  const session = await readSession(sessionId);
  if (!session) throw new GuideError("sesión no encontrada", 404);
  const passage = session.passages.find((p) => p.id === passageId);
  if (!passage) throw new GuideError("pasaje no encontrado", 404);
  const analysis = await readAnalysis(sessionId, passageId);
  if (!analysis) throw new GuideError("el pasaje todavía no tiene análisis (melodía)", 409);
  if (!analysis.phrases.length) throw new GuideError("el pasaje no tiene frases medibles", 409);
  const req = validateGuideRequest(rawReq, analysis);
  if (!existsSync(session.mediaDir))
    throw new GuideError("la carpeta de la sesión no está disponible (¿disco desconectado?)", 409);

  const hash = guideHash(req, analysis);
  const rel = `analisis/${passageId}/guias/${hash}.wav`;
  const absWav = join(session.mediaDir, rel);
  const absMeta = join(session.mediaDir, `analisis/${passageId}/guias/${hash}.json`);
  if (existsSync(absWav)) {
    try {
      const meta = JSON.parse(await readFile(absMeta, "utf8")) as Cached;
      if (meta.path === rel) return { ...meta, ttsChars: 0, cached: true };
    } catch {
      // Sin su JSON (o ilegible) el WAV no dice sus sílabas: se renderiza de nuevo.
    }
  }

  // Largo del buffer = el pasaje (lo que dura su audio); nunca menos que la última frase.
  const lastEnd = Math.max(...analysis.phrases.map((p) => p.end));
  const outDurSec = Math.max(passage.end - passage.start, lastEnd + 0.25);
  const warnings: string[] = [];
  let ttsChars = 0;

  const rendered = await pool(req.lines, TTS_POOL, async (line) => {
    if (signal?.aborted) throw new GuideError("guía detenida", 409);
    const ph = analysis.phrases.find((p) => p.idx === line.phrase)!;
    const mold = phraseMold(ph, req.mode);
    const slots = mold.slots ?? moldSlots(ph, req.mode);
    const reading = lineReading(line.text, mold, req.mode);
    let tts;
    try {
      tts = await elevenTts(line.text, req.voiceId, signal);
    } catch (err) {
      if (err instanceof TtsError) throw new GuideError(err.message, err.status);
      throw err;
    }
    ttsChars += tts.chars;
    const spans = alignSyllables(reading, tts.alignment);
    if (!spans) {
      warnings.push(`frase ${line.phrase}: el TTS no leyó «${line.text}» como se esperaba; no suena en la guía`);
      return null;
    }
    const plan = planGuide({
      phrase: ph,
      phraseIdx: ph.idx,
      spans,
      slots,
      mode: req.mode,
      pitch: req.pitch,
      semitones: req.semitones,
      f0: analysis.f0,
      hop: analysis.hop,
    });
    for (const w of plan.warnings) warnings.push(`frase ${line.phrase}: ${w}`);
    if (!plan.segments.length) return null;
    return { sr: tts.sr, segments: plan.segments, audio: renderSung(tts.pcm, tts.sr, plan.segments, { outDurSec }) };
  });
  if (signal?.aborted) throw new GuideError("guía detenida", 409);

  const ok = rendered.filter((r): r is { sr: number; segments: GuideSegment[]; audio: Float32Array } => r !== null);
  if (!ok.length) throw new GuideError(`ninguna línea se pudo cantar${warnings.length ? `: ${warnings.join(" · ")}` : ""}`, 409);
  const sr = ok[0].sr;
  if (ok.some((r) => r.sr !== sr)) throw new GuideError("el TTS devolvió audios con frecuencias distintas", 502);

  // Mezcla: las frases no se solapan en el tiempo, pero una cola de PSOLA puede tocar la siguiente.
  const mix = new Float32Array(Math.max(...ok.map((r) => r.audio.length)));
  for (const r of ok) for (let i = 0; i < r.audio.length; i++) mix[i] += r.audio[i];
  let peak = 0;
  for (let i = 0; i < mix.length; i++) peak = Math.max(peak, Math.abs(mix[i]));
  if (peak > 0.95) for (let i = 0; i < mix.length; i++) mix[i] *= 0.9 / peak;

  const syllables = ok
    .flatMap((r) => r.segments)
    .map((s) => ({ phrase: s.phrase, text: s.syllable, start: round3(s.dstStart), end: round3(s.dstEnd) }))
    .sort((a, b) => a.start - b.start);
  const result: Cached = { path: rel, engine: "psola", voiceId: req.voiceId, sr, syllables, warnings };

  const dir = join(session.mediaDir, "analisis", passageId, "guias");
  await mkdir(dir, { recursive: true });
  const tag = `${process.pid}.${Date.now()}`;
  await writeFile(`${absWav}.${tag}.tmp`, encodeWav16(mix, sr));
  await rename(`${absWav}.${tag}.tmp`, absWav);
  await writeFile(`${absMeta}.${tag}.tmp`, JSON.stringify(result), "utf8");
  await rename(`${absMeta}.${tag}.tmp`, absMeta);

  emit({
    private: true,
    kind: "tool_call",
    taskId: `composicion-${sessionId}`,
    toolName: "composicion_guia",
    detail: `guía cantada de ${ok.length} línea(s) en ${passage.label} · ${ttsChars} caracteres de TTS`,
  });
  return { ...result, ttsChars, cached: false };
}
