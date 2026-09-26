/**
 * TTS con TIMESTAMPS para la guía cantada (ElevenLabs). La guía no suena a
 * TTS: el texto dicho se corta por sílabas (alineación por carácter) y cada
 * sílaba se lleva a su nota con PSOLA (guide.ts). Aquí solo vive lo que
 * habla con la API y su caché.
 *
 * Contrato verificado contra la doc vigente (2026-09):
 *  - POST /v1/text-to-speech/{voice_id}/with-timestamps?output_format=pcm_24000
 *    body {text, model_id, language_code, voice_settings{stability, speed}, seed}
 *    → {audio_base64, alignment{characters, character_start_times_seconds,
 *    character_end_times_seconds}, normalized_alignment}. pcm_24000 = PCM
 *    16 bits little-endian, mono, 24 kHz, sin cabecera.
 *  - La cabecera `character-cost` dice lo cobrado (sin ella, el largo del texto).
 *  - GET /v1/voices → {voices:[{voice_id, name, category, labels{gender, accent, language…}}]}.
 *
 * Caché en COMPOSICION_DIR/tts-cache/<sha1>.{json,pcm}: cambiar la altura, el
 * modo o el timing de la guía NO vuelve a cobrar (la segunda vez, 0 caracteres).
 * La clave jamás se loguea ni viaja en un mensaje de error.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { TtsAlignment } from "@hermes/shared";
import { env } from "../env.js";
import { COMPOSICION_DIR } from "./store.js";

const API = "https://api.elevenlabs.io";
export const TTS_SR = 24000;
const OUTPUT_FORMAT = "pcm_24000";
/**
 * Ajustes fijos de la lectura: estable (la guía no actúa) y un poco lenta (las
 * vocales más largas se estiran mejor). Semilla fija: misma línea, mismo audio.
 * Entran al hash de la caché: cambiarlos invalida lo cacheado.
 */
const VOICE_SETTINGS = { stability: 0.6, speed: 0.9 } as const;
const SEED = 20260924;
const LANGUAGE = "es";
const TTS_TIMEOUT_MS = 60_000;
const MAX_TEXT = 400;

export class TtsError extends Error {
  constructor(
    message: string,
    public status: 400 | 402 | 409 | 502 | 503 = 502,
  ) {
    super(message);
  }
}

export interface TtsResult {
  /** Mono float32 (−1..1) a `sr`. */
  pcm: Float32Array;
  sr: number;
  alignment: TtsAlignment;
  /** Caracteres cobrados en ESTA llamada (0 = salió de la caché). */
  chars: number;
  cached: boolean;
}

export function ttsModel(): string {
  return env.COMPOSICION_TTS_MODEL || "eleven_multilingual_v2";
}

const cacheDir = () => join(COMPOSICION_DIR, "tts-cache");

/** Clave de caché: voz | modelo | texto (+ los ajustes fijos, que cambian el audio). */
export function ttsCacheKey(text: string, voiceId: string, model: string): string {
  const settings = `${LANGUAGE}|${VOICE_SETTINGS.stability}|${VOICE_SETTINGS.speed}|${SEED}|${OUTPUT_FORMAT}`;
  return createHash("sha1").update(`${voiceId}|${model}|${text}|${settings}`).digest("hex");
}

/** Id de voz de ElevenLabs: alfanumérico corto (llega a una URL). */
export function isVoiceId(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9]{8,40}$/.test(v);
}

// ─────────────────────────── PCM ───────────────────────────

/** PCM 16 bits LE → float32. */
export function pcm16ToFloat(bytes: Uint8Array): Float32Array {
  const n = bytes.byteLength >> 1;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, n * 2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = dv.getInt16(i * 2, true);
    out[i] = v < 0 ? v / 32768 : v / 32767;
  }
  return out;
}

function validAlignment(a: unknown): a is TtsAlignment {
  if (!a || typeof a !== "object") return false;
  const x = a as Record<string, unknown>;
  const c = x.characters;
  const s = x.character_start_times_seconds;
  const e = x.character_end_times_seconds;
  return (
    Array.isArray(c) &&
    Array.isArray(s) &&
    Array.isArray(e) &&
    c.length > 0 &&
    c.length === s.length &&
    c.length === e.length &&
    s.every((t) => typeof t === "number" && Number.isFinite(t)) &&
    e.every((t) => typeof t === "number" && Number.isFinite(t))
  );
}

// ─────────────────────────── Caché ───────────────────────────

interface CacheMeta {
  voiceId: string;
  model: string;
  text: string;
  sr: number;
  alignment: TtsAlignment;
  chars: number;
  at: string;
}

async function readCache(hash: string): Promise<{ meta: CacheMeta; pcm: Float32Array } | null> {
  try {
    const meta = JSON.parse(await readFile(join(cacheDir(), `${hash}.json`), "utf8")) as CacheMeta;
    const raw = await readFile(join(cacheDir(), `${hash}.pcm`));
    if (!validAlignment(meta.alignment) || !raw.byteLength) return null;
    return { meta, pcm: pcm16ToFloat(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)) };
  } catch {
    return null;
  }
}

/** Escritura atómica (tmp + rename): el .pcm primero, así un .json nunca apunta a un audio a medias. */
async function writeCache(hash: string, meta: CacheMeta, bytes: Uint8Array): Promise<void> {
  const dir = cacheDir();
  await mkdir(dir, { recursive: true });
  const tag = `${process.pid}.${Date.now()}`;
  await writeFile(join(dir, `${hash}.pcm.${tag}.tmp`), bytes);
  await rename(join(dir, `${hash}.pcm.${tag}.tmp`), join(dir, `${hash}.pcm`));
  await writeFile(join(dir, `${hash}.json.${tag}.tmp`), JSON.stringify(meta), "utf8");
  await rename(join(dir, `${hash}.json.${tag}.tmp`), join(dir, `${hash}.json`));
}

// ─────────────────────────── Errores de la API ───────────────────────────

/** Mensaje legible del error de ElevenLabs (`detail` puede ser texto, objeto o lista de validación). */
function apiDetail(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const d = (body as { detail?: unknown }).detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map((x) => (x && typeof x === "object" ? String((x as { msg?: unknown }).msg ?? "") : String(x))).join("; ");
  if (d && typeof d === "object") {
    const o = d as { message?: unknown; status?: unknown };
    return [o.status, o.message].filter((x) => typeof x === "string" && x).join(": ");
  }
  return "";
}

function ttsFailure(status: number, detail: string): TtsError {
  const why = detail ? ` — ${detail.slice(0, 240)}` : "";
  // ElevenLabs responde la cuota agotada con 401 + status "quota_exceeded": se mira antes que la clave.
  if (status === 402 || /quota|credit|insufficient/i.test(detail))
    return new TtsError(`ElevenLabs: sin caracteres o créditos para el TTS (${status})${why}`, 402);
  if (status === 401) return new TtsError(`ElevenLabs rechazó la API key (401)${why}`, 503);
  if (status === 404) return new TtsError(`ElevenLabs no encontró la voz (404)${why}`, 400);
  if (status === 422 || status === 400) return new TtsError(`ElevenLabs no aceptó el pedido de TTS (${status})${why}`, 400);
  if (status === 429) return new TtsError(`ElevenLabs está saturado o llegaste al tope de pedidos simultáneos (429)${why}`, 503);
  return new TtsError(`ElevenLabs TTS falló (${status})${why}`, 502);
}

// ─────────────────────────── TTS ───────────────────────────

async function callTts(
  text: string,
  voiceId: string,
  model: string,
  withLanguage: boolean,
  signal?: AbortSignal,
): Promise<Response> {
  const key = env.ELEVENLABS_API_KEY;
  if (!key) throw new TtsError("sin ELEVENLABS_API_KEY: la guía cantada necesita el TTS de ElevenLabs", 503);
  const timeout = AbortSignal.timeout(TTS_TIMEOUT_MS);
  const url = `${API}/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?output_format=${OUTPUT_FORMAT}`;
  return fetch(url, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      text,
      model_id: model,
      ...(withLanguage ? { language_code: LANGUAGE } : {}),
      voice_settings: VOICE_SETTINGS,
      seed: SEED,
    }),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
}

/**
 * Texto → audio mono 24 kHz + alineación por carácter. Primero la caché (0
 * caracteres); si no, la API. `language_code: "es"` fuerza el español; si el
 * modelo no lo acepta (400/422 que lo nombra), se reintenta UNA vez sin él.
 */
export async function elevenTts(text: string, voiceId: string, signal?: AbortSignal): Promise<TtsResult> {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) throw new TtsError("no hay texto para leer", 400);
  if (clean.length > MAX_TEXT) throw new TtsError(`la línea pasa de ${MAX_TEXT} caracteres`, 400);
  if (!isVoiceId(voiceId)) throw new TtsError("id de voz inválido", 400);
  const model = ttsModel();
  const hash = ttsCacheKey(clean, voiceId, model);
  const hit = await readCache(hash);
  if (hit) return { pcm: hit.pcm, sr: hit.meta.sr, alignment: hit.meta.alignment, chars: 0, cached: true };

  let res: Response;
  try {
    res = await callTts(clean, voiceId, model, true, signal);
    if (res.status === 400 || res.status === 422) {
      const body = await res.json().catch(() => null);
      const detail = apiDetail(body);
      if (!/language/i.test(detail)) throw ttsFailure(res.status, detail);
      res = await callTts(clean, voiceId, model, false, signal);
    }
  } catch (err) {
    if (err instanceof TtsError) throw err;
    if (signal?.aborted) throw new TtsError("guía detenida", 409);
    const name = (err as Error)?.name;
    if (name === "TimeoutError") throw new TtsError("ElevenLabs no respondió a tiempo (60 s)", 502);
    throw new TtsError(`no se pudo hablar con ElevenLabs: ${String((err as Error)?.message ?? err).slice(0, 160)}`, 502);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw ttsFailure(res.status, apiDetail(body));
  }
  const body = (await res.json().catch(() => null)) as { audio_base64?: unknown; alignment?: unknown } | null;
  if (!body || typeof body.audio_base64 !== "string" || !body.audio_base64)
    throw new TtsError("ElevenLabs respondió sin audio", 502);
  if (!validAlignment(body.alignment))
    throw new TtsError("ElevenLabs respondió sin la alineación por carácter (with-timestamps)", 502);
  const bytes = Buffer.from(body.audio_base64, "base64");
  if (bytes.byteLength < 2) throw new TtsError("ElevenLabs respondió con un audio vacío", 502);
  const costHeader = res.headers.get("character-cost");
  const cost = costHeader === null || costHeader.trim() === "" ? NaN : Number(costHeader);
  const chars = Number.isFinite(cost) && cost >= 0 ? cost : clean.length;
  const u8 = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength - (bytes.byteLength & 1));
  await writeCache(
    hash,
    { voiceId, model, text: clean, sr: TTS_SR, alignment: body.alignment, chars, at: new Date().toISOString() },
    u8,
  ).catch((err) => console.warn(`[composicion] no se pudo guardar la caché del TTS: ${String(err).slice(0, 120)}`));
  return { pcm: pcm16ToFloat(u8), sr: TTS_SR, alignment: body.alignment, chars, cached: false };
}

// ─────────────────────────── Voces ───────────────────────────

export interface GuideVoice {
  id: string;
  name: string;
  gender?: string;
  accent?: string;
}

/**
 * Voces GENÉRICAS: las de fábrica (premade) y las de la Voice Library que la
 * cuenta agregó (professional/generated/high_quality: voces publicadas para
 * uso general). Las clonadas de la cuenta y las "famosas" quedan fuera: la
 * voz de una persona concreta no canta guías.
 */
const GENERIC = new Set(["premade", "professional", "generated", "high_quality"]);
const VOICES_TTL_MS = 60 * 60 * 1000;
let voicesCache: { at: number; voices: GuideVoice[] } | null = null;

/** Para las pruebas: olvidar la lista cacheada. */
export function resetVoicesCache(): void {
  voicesCache = null;
}

export async function listVoices(signal?: AbortSignal): Promise<GuideVoice[]> {
  if (voicesCache && Date.now() - voicesCache.at < VOICES_TTL_MS) return voicesCache.voices;
  const key = env.ELEVENLABS_API_KEY;
  if (!key) throw new TtsError("sin ELEVENLABS_API_KEY: no hay voces para la guía cantada", 503);
  let res: Response;
  try {
    const timeout = AbortSignal.timeout(20_000);
    res = await fetch(`${API}/v1/voices`, {
      headers: { "xi-api-key": key, Accept: "application/json" },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (err) {
    throw new TtsError(`no se pudo pedir las voces a ElevenLabs: ${String((err as Error)?.message ?? err).slice(0, 160)}`, 502);
  }
  if (!res.ok) throw ttsFailure(res.status, apiDetail(await res.json().catch(() => null)));
  const body = (await res.json().catch(() => null)) as { voices?: unknown } | null;
  if (!body || !Array.isArray(body.voices)) throw new TtsError("ElevenLabs respondió sin lista de voces", 502);
  type Raw = { voice_id?: unknown; name?: unknown; category?: unknown; labels?: Record<string, unknown> | null };
  const spanish = (v: Raw) => /^es/i.test(String(v.labels?.language ?? "")) || /latin|spanish|colomb|mexic|argent|spain|castil/i.test(String(v.labels?.accent ?? ""));
  const voices = (body.voices as Raw[])
    .filter((v) => isVoiceId(v.voice_id) && typeof v.name === "string" && GENERIC.has(String(v.category)))
    // Primero las que hablan español de nacimiento, luego las de fábrica, luego por nombre.
    .sort(
      (a, b) =>
        Number(spanish(b)) - Number(spanish(a)) ||
        Number(b.category === "premade") - Number(a.category === "premade") ||
        String(a.name).localeCompare(String(b.name)),
    )
    .map((v): GuideVoice => {
      const gender = typeof v.labels?.gender === "string" ? v.labels.gender : undefined;
      const accent = typeof v.labels?.accent === "string" ? v.labels.accent : undefined;
      return { id: v.voice_id as string, name: String(v.name).slice(0, 80), ...(gender ? { gender } : {}), ...(accent ? { accent } : {}) };
    });
  voicesCache = { at: Date.now(), voices };
  return voices;
}
