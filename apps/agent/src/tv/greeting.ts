import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { dayView } from "../day/index.js";
import { env } from "../env.js";
import { OWNER } from "../owner.js";
import { weatherWords } from "@hermes/shared";
import { getWeather } from "../weather.js";
import { buildGreeting, type Greeting } from "./plan.js";

/**
 * Saludo del despertar: el texto sale de "Mi día" (agenda, pendientes y
 * hábitos de HOY) y se vuelve voz con ElevenLabs (la voz de Hermes,
 * ELEVENLABS_VOICE_ID). Lo reproduce la app Hermes TV (GreetingActivity), que
 * lee GET /tv/greeting y /tv/greeting.mp3. Sin voz configurada o si la TTS
 * falla, la pantalla igual muestra el texto: se dice por qué en el registro.
 */

const DIR = join(homedir(), ".hermes-os", "tv");
const JSON_PATH = join(DIR, "greeting.json");
export const GREETING_MP3 = join(DIR, "greeting.mp3");
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID?.trim() ?? "";
/** mp3 a 128 kbps: los bytes dicen la duración sin ffprobe. */
const BITRATE = 128_000;

export interface StoredGreeting extends Greeting {
  created_at: string;
  audio: boolean;
  duration_s: number | null;
  /** Por qué no hay audio (null si lo hay). */
  audio_error: string | null;
}

export function hourMinute(iso: string, tz: string): { h: number; m: number } {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  return { h: Number(parts.find((p) => p.type === "hour")?.value), m: Number(parts.find((p) => p.type === "minute")?.value) };
}

async function tts(text: string): Promise<Buffer> {
  if (!env.ELEVENLABS_API_KEY || !VOICE_ID) throw new Error("falta ELEVENLABS_API_KEY o ELEVENLABS_VOICE_ID");
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": env.ELEVENLABS_API_KEY, "Content-Type": "application/json" },
    // Misma voz y ajustes que los agentes de voz de Hermes (estabilidad 0,5, ELEVENLABS_VOICE_SPEED).
    body: JSON.stringify({
      text,
      model_id: "eleven_multilingual_v2",
      language_code: "es",
      voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: Number(process.env.ELEVENLABS_VOICE_SPEED || "1.0") },
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`ElevenLabs respondió ${res.status}: ${(await res.text()).slice(0, 160)}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Arma el saludo de AHORA (datos de hoy) y su audio. Con `wake` (la hora
 * objetivo del despertar) cierra con el discurso y el llamado a ponerse de
 * pie. Nunca lanza: lo que falle queda en audio_error.
 */
export async function prepareGreeting(outro?: string, wake?: { at: string; source: "compromiso" | "alarma" | "escena" } | null): Promise<StoredGreeting> {
  const [day, w] = await Promise.all([dayView(), getWeather().catch(() => null)]);
  const g = buildGreeting({
    owner: OWNER,
    date: day.date,
    weather: w && !w.stale ? { place: w.place, temp_c: Math.round(w.now.tempC), words: weatherWords(w.now.weatherCode) } : null,
    events: day.events.map((e) => (e.all_day ? { title: e.title, h: null, m: null } : { title: e.title, ...hourMinute(e.start, env.SCHEDULED_TZ) })),
    tasks: day.tasks,
    habits: day.habits,
    outro,
    wake: wake ? { ...hourMinute(wake.at, env.SCHEDULED_TZ), source: wake.source } : null,
  });
  return prepareSpoken(g);
}

/**
 * Lo que la TV va a decir y mostrar (saludo, aviso de sección, felicitación):
 * genera la voz y lo deja donde GreetingActivity lo lee. Nunca lanza.
 */
export async function prepareSpoken(g: Greeting): Promise<StoredGreeting> {
  await mkdir(DIR, { recursive: true });
  let audio = false;
  let duration: number | null = null;
  let audioError: string | null = null;
  try {
    const mp3 = await tts(g.speech);
    await writeFile(GREETING_MP3, mp3);
    audio = true;
    duration = Math.round((mp3.length * 8) / BITRATE);
  } catch (err) {
    audioError = err instanceof Error ? err.message : String(err);
    console.warn(`[tv] saludo sin voz: ${audioError}`);
  }
  const stored: StoredGreeting = { ...g, created_at: new Date().toISOString(), audio, duration_s: duration, audio_error: audioError };
  await writeFile(JSON_PATH, JSON.stringify(stored, null, 2));
  return stored;
}

export async function readGreeting(): Promise<StoredGreeting | null> {
  try {
    return JSON.parse(await readFile(JSON_PATH, "utf8")) as StoredGreeting;
  } catch {
    return null;
  }
}
