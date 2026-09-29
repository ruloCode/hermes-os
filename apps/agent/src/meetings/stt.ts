/**
 * Speech-to-text para reuniones. Fetch directo (sin SDK), mismo patrón que
 * embeddings.ts. Preferimos ElevenLabs Scribe (archivos largos + diarización
 * "quién habló"); caemos a OpenAI Whisper para audios ≤25 MB. Las credenciales
 * ya existen en el .env raíz (ELEVENLABS_API_KEY / OPENAI_API_KEY).
 *
 * Formas de API verificadas contra la doc oficial (2026):
 * - Scribe: POST /v1/speech-to-text, header `xi-api-key`, form `file`+`model_id`
 *   (default scribe_v2), respuesta { text, language_code, words:[{speaker_id}] }.
 * - Whisper: POST /v1/audio/transcriptions, Bearer, form `file`+`model`,
 *   respuesta { text }. Límite 25 MB.
 * En ambos: NO fijar Content-Type (fetch pone el boundary) y el `file` DEBE
 * llevar filename con extensión (si no, falla la detección de formato).
 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join as joinPath } from "node:path";
import { env } from "../env.js";

export type SttProvider = "scribe" | "whisper" | "local";

export interface TranscriptResult {
  text: string;
  provider: SttProvider;
  language?: string;
}

const WHISPER_MAX_BYTES = 25 * 1024 * 1024; // límite duro de OpenAI

/** Extensión de archivo a partir del mime (para el filename del form). */
function extFor(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("webm")) return "webm";
  if (m.includes("mp4") || m.includes("m4a")) return "m4a";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("wav")) return "wav";
  if (m.includes("ogg")) return "ogg";
  if (m.includes("flac")) return "flac";
  return "webm";
}

/**
 * Transcribe un audio. Prueba los proveedores en orden (configurable con
 * HERMES_STT); si uno falla —p.ej. Scribe sin créditos— cae al siguiente.
 * Lanza si no hay credenciales o si todos fallan.
 */
export async function transcribe(file: Blob): Promise<TranscriptResult> {
  const mime = file.type || "audio/webm";
  const filename = `reunion.${extFor(mime)}`;
  const errors: string[] = [];

  // Orden: por defecto Scribe → Whisper → local. `local` (whisper.cpp) va
  // último porque es el más lento, pero es el único que NUNCA depende de la
  // red ni de créditos: es la red de seguridad real de una junta larga.
  // HERMES_STT=whisper|local pone ese proveedor de primero.
  const order: SttProvider[] =
    env.STT_PROVIDER === "whisper"
      ? ["whisper", "scribe", "local"]
      : env.STT_PROVIDER === "local"
        ? ["local", "scribe", "whisper"]
        : ["scribe", "whisper", "local"];

  for (const provider of order) {
    if (provider === "local") {
      try {
        return await transcribeLocal(file, filename);
      } catch (err) {
        errors.push(`local: ${String(err).slice(0, 200)}`);
        console.error("[meetings] whisper local falló:", err);
      }
    } else if (provider === "scribe") {
      if (!env.ELEVENLABS_API_KEY) continue;
      try {
        return await transcribeScribe(file, filename);
      } catch (err) {
        errors.push(`scribe: ${String(err).slice(0, 200)}`);
        console.error("[meetings] Scribe falló:", err);
      }
    } else {
      if (!env.OPENAI_API_KEY) continue;
      if (file.size > WHISPER_MAX_BYTES) {
        errors.push("whisper: archivo >25 MB (necesitas ElevenLabs Scribe con créditos para juntas largas)");
        continue;
      }
      try {
        return await transcribeWhisper(file, filename);
      } catch (err) {
        errors.push(`whisper: ${String(err).slice(0, 200)}`);
        console.error("[meetings] Whisper falló:", err);
      }
    }
  }

  throw new Error(
    errors.length
      ? `No se pudo transcribir. ${errors.join(" · ")}`
      : "STT no configurado: falta ELEVENLABS_API_KEY u OPENAI_API_KEY en el .env.",
  );
}

// ── ElevenLabs Scribe ──────────────────────────────────────────────────

interface ScribeWord {
  text?: string;
  type?: string;
  speaker_id?: string;
}
interface ScribeResponse {
  text?: string;
  language_code?: string;
  words?: ScribeWord[];
}

async function transcribeScribe(file: Blob, filename: string): Promise<TranscriptResult> {
  const form = new FormData();
  form.append("file", file, filename);
  form.append("model_id", "scribe_v2");
  form.append("diarize", "true"); // etiqueta quién habló
  form.append("tag_audio_events", "true");

  const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": env.ELEVENLABS_API_KEY }, // NO Content-Type manual
    body: form,
  });
  if (!res.ok) {
    throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const json = (await res.json()) as ScribeResponse;
  const flat = (json.text ?? "").trim();
  if (!flat) throw new Error("Scribe devolvió transcripción vacía.");
  return {
    text: transcriptWithSpeakers(json.words, flat),
    provider: "scribe",
    language: json.language_code,
  };
}

/** Palabra cruda de Scribe con su tiempo (lo que `transcribe()` descarta). */
export interface ScribeTimedWord {
  text: string;
  start: number;
  end: number;
  type: "word" | "spacing" | "audio_event";
  speaker_id?: string;
  logprob?: number;
}

/**
 * Scribe con las palabras CON TIEMPO (diarizado + eventos de audio como
 * "[canta]"). Composición lo necesita para anclar sílabas a notas; las juntas
 * siguen usando `transcribe()`, que solo arma texto por hablante.
 * `language` = código ISO ("es"/"en"); sin él Scribe lo detecta.
 */
export async function scribeWords(
  file: Blob,
  filename: string,
  opts: { language?: string; signal?: AbortSignal } = {},
): Promise<{ words: ScribeTimedWord[]; language?: string; durationSec?: number }> {
  if (!env.ELEVENLABS_API_KEY) throw new Error("falta ELEVENLABS_API_KEY");
  const form = new FormData();
  form.append("file", file, filename);
  form.append("model_id", "scribe_v2");
  form.append("diarize", "true");
  form.append("tag_audio_events", "true");
  form.append("timestamps_granularity", "word");
  if (opts.language) form.append("language_code", opts.language);

  const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": env.ELEVENLABS_API_KEY }, // NO Content-Type manual
    body: form,
    signal: opts.signal,
  });
  if (!res.ok) {
    throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const json = (await res.json()) as ScribeResponse & {
    words?: (ScribeWord & { start?: number; end?: number; logprob?: number })[];
    audio_duration_secs?: number;
  };
  const words: ScribeTimedWord[] = [];
  for (const w of json.words ?? []) {
    if (typeof w.start !== "number" || typeof w.end !== "number") continue;
    const type = w.type === "spacing" || w.type === "audio_event" ? w.type : "word";
    words.push({
      text: w.text ?? "",
      start: w.start,
      end: w.end,
      type,
      speaker_id: w.speaker_id,
      logprob: w.logprob,
    });
  }
  return { words, language: json.language_code, durationSec: json.audio_duration_secs };
}

/**
 * Reconstruye un transcript atribuido por hablante desde words[] con speaker_id.
 * Si no hay diarización utilizable, devuelve el texto plano.
 */
function transcriptWithSpeakers(words: ScribeWord[] | undefined, fallback: string): string {
  if (!Array.isArray(words) || !words.some((w) => w.speaker_id)) return fallback;
  const turns: { speaker: string; text: string }[] = [];
  for (const w of words) {
    const raw = w.text ?? "";
    if (w.type === "spacing") {
      if (turns.length) turns[turns.length - 1].text += raw;
      continue;
    }
    const speaker = w.speaker_id ?? "speaker";
    const last = turns[turns.length - 1];
    if (last && last.speaker === speaker) last.text += raw;
    else turns.push({ speaker, text: raw });
  }
  const label = (id: string) => id.replace(/^speaker[_\s]?/i, "Hablante ");
  const out = turns
    .filter((t) => t.text.trim())
    .map((t) => `**${label(t.speaker)}:** ${t.text.trim()}`)
    .join("\n\n");
  return out || fallback;
}

// ── OpenAI Whisper ─────────────────────────────────────────────────────

async function transcribeWhisper(file: Blob, filename: string): Promise<TranscriptResult> {
  const form = new FormData();
  form.append("file", file, filename);
  form.append("model", "gpt-4o-transcribe");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` }, // NO Content-Type manual
    body: form,
  });
  if (!res.ok) {
    throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const json = (await res.json()) as { text?: string };
  const text = (json.text ?? "").trim();
  if (!text) throw new Error("Whisper devolvió transcripción vacía.");
  return { text, provider: "whisper" };
}

// ── Whisper local (whisper.cpp) ────────────────────────────────────────
// La red de seguridad: corre en la máquina, sin créditos ni internet, y no
// tiene el tope de 25 MB de la API de OpenAI. No hace diarización (no separa
// hablantes), pero una junta sin "quién dijo qué" sigue siendo infinitamente
// mejor que una junta perdida.

/** Corre un binario y resuelve con su stdout; rechaza con stderr si sale ≠ 0. */
function run(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args);
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) =>
      reject(new Error(`no pude ejecutar ${bin}: ${String(e)} (¿instalado? brew install whisper-cpp ffmpeg)`)),
    );
    child.on("close", (code) =>
      code === 0 ? resolve(out) : reject(new Error(`${bin} salió ${code}: ${err.slice(-300)}`)),
    );
  });
}

async function transcribeLocal(file: Blob, filename: string): Promise<TranscriptResult> {
  const dir = await mkdtemp(joinPath(tmpdir(), "hermes-stt-"));
  try {
    const src = joinPath(dir, filename);
    await writeFile(src, Buffer.from(await file.arrayBuffer()));

    // whisper.cpp solo come WAV PCM 16 kHz mono: ffmpeg normaliza cualquier
    // cosa que mande el teléfono (m4a/opus/webm) sin re-encodear a un lossy.
    const wav = joinPath(dir, "audio.wav");
    await run(env.FFMPEG_BIN, ["-nostdin", "-loglevel", "error", "-y", "-i", src, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav]);

    const outBase = joinPath(dir, "out");
    await run(env.WHISPER_BIN, [
      "-m", env.WHISPER_MODEL,
      "-f", wav,
      "-l", "auto", // junta en español, pero el code-switching con inglés es real
      "-otxt",
      "-of", outBase,
      "--no-prints",
    ]);

    const text = (await readFile(`${outBase}.txt`, "utf8")).trim();
    if (!text) throw new Error("whisper local devolvió transcripción vacía.");
    return { text, provider: "local" };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
