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
import { env } from "../env.js";

export interface TranscriptResult {
  text: string;
  provider: "scribe" | "whisper";
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

  // Orden: por defecto Scribe → Whisper; HERMES_STT=whisper lo invierte.
  const order: ("scribe" | "whisper")[] =
    env.STT_PROVIDER === "whisper" ? ["whisper", "scribe"] : ["scribe", "whisper"];

  for (const provider of order) {
    if (provider === "scribe") {
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
