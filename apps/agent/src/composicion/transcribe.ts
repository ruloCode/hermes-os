/**
 * Transcripción de una sesión de composición: Scribe con palabras CON TIEMPO
 * (diarizado + eventos como "[canta]"), normalizado a TranscriptWord[].
 *
 * Es lo que ancla sílabas a notas y alimenta la detección de pasajes. Sin
 * ELEVENLABS_API_KEY la etapa queda "omitido" y la detección cae a la pista
 * acústica sola (peor, pero la sesión sigue siendo útil).
 */
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { ComposeSession, SessionSpeaker, TranscriptWord } from "@hermes/shared";
import { env } from "../env.js";
import { scribeWords } from "../meetings/stt.js";
import { compressForStt } from "./media.js";

export function sttAvailable(): { ok: boolean; reason?: string } {
  return env.ELEVENLABS_API_KEY
    ? { ok: true }
    : { ok: false, reason: "sin ELEVENLABS_API_KEY: la detección usa solo el audio (aproximada)" };
}

/** Scribe → palabras normalizadas (sin los "spacing"; texto recortado). */
export async function transcribeSession(
  session: ComposeSession,
  signal?: AbortSignal,
): Promise<TranscriptWord[]> {
  if (!session.files.audio) throw new Error("la sesión no tiene audio extraído");
  const wav = join(session.mediaDir, session.files.audio);
  const mp3 = join(session.mediaDir, "assets", "stt.mp3");
  await compressForStt(wav, mp3, signal);
  try {
    const blob = new Blob([await readFile(mp3)], { type: "audio/mpeg" });
    const language = session.language === "auto" ? undefined : session.language;
    const { words } = await scribeWords(blob, "sesion.mp3", { language, signal });
    return normalizeWords(words);
  } finally {
    await rm(mp3, { force: true }).catch(() => {});
  }
}

export function normalizeWords(
  raw: { text: string; start: number; end: number; type: string; speaker_id?: string }[],
): TranscriptWord[] {
  const out: TranscriptWord[] = [];
  for (const w of raw) {
    if (w.type !== "word" && w.type !== "audio_event") continue;
    const text = w.text.trim();
    if (!text) continue;
    out.push({
      text,
      start: round3(w.start),
      end: round3(Math.max(w.start, w.end)),
      ...(w.speaker_id ? { speaker: w.speaker_id } : {}),
      type: w.type,
    });
  }
  return out.sort((a, b) => a.start - b.start);
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export interface TranscriptLine {
  speaker: string;
  start: number;
  end: number;
  text: string;
}

/**
 * Agrupa palabras en LÍNEAS legibles: corta al cambiar de voz, en silencios
 * de más de `gapSec` o cuando la línea pasa de ~140 caracteres. Los eventos
 * ("[canta]") quedan dentro de la línea: son contexto para el resumen.
 */
export function transcriptLines(words: TranscriptWord[], gapSec = 1.2): TranscriptLine[] {
  const lines: TranscriptLine[] = [];
  let cur: TranscriptLine | null = null;
  for (const w of words) {
    const speaker = w.speaker ?? "speaker_0";
    const breakLine =
      !cur || cur.speaker !== speaker || w.start - cur.end > gapSec || cur.text.length > 140;
    if (breakLine) {
      if (cur) lines.push(cur);
      cur = { speaker, start: w.start, end: w.end, text: w.text };
    } else if (cur) {
      cur.text += ` ${w.text}`;
      cur.end = Math.max(cur.end, w.end);
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/**
 * Voces de la sesión con sus segundos reales (turnos: palabras seguidas de
 * la misma voz con huecos < 1,5 s). Conserva nombres y uniones del humano.
 */
export function computeSpeakers(
  words: TranscriptWord[],
  previous: SessionSpeaker[] = [],
): SessionSpeaker[] {
  const seconds = new Map<string, number>();
  const order: string[] = [];
  let turn: { speaker: string; start: number; end: number } | null = null;
  const close = () => {
    if (!turn) return;
    seconds.set(turn.speaker, (seconds.get(turn.speaker) ?? 0) + (turn.end - turn.start));
  };
  for (const w of words) {
    const speaker = w.speaker ?? "speaker_0";
    if (!seconds.has(speaker) && !order.includes(speaker)) order.push(speaker);
    if (turn && turn.speaker === speaker && w.start - turn.end < 1.5) {
      turn.end = Math.max(turn.end, w.end);
    } else {
      close();
      turn = { speaker, start: w.start, end: w.end };
    }
  }
  close();
  const prev = new Map(previous.map((s) => [s.id, s]));
  // Orden estable por aparición: "Voz 1" es la primera que habló.
  return order.map((id, i) => ({
    id,
    name: prev.get(id)?.name ?? `Voz ${i + 1}`,
    seconds: Math.round((seconds.get(id) ?? 0) * 10) / 10,
    singingSeconds: prev.get(id)?.singingSeconds ?? 0,
    ...(prev.get(id)?.mergedInto ? { mergedInto: prev.get(id)!.mergedInto } : {}),
  }));
}

/** mm:ss para prompts y detalles. */
export function clock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
