"use client";

// Client tools del TUTOR DE INGLÉS (agente ElevenLabs "Hermes English Tutor").
// Se registran siempre junto a las de Hermes: el SDK solo invoca las que el
// agente activo tiene configuradas, así que no hace falta gating por modo.
// No renderiza nada.

import { useEffect, useRef } from "react";
import { useConversationClientTool, useConversationStatus } from "@elevenlabs/react";
import type { EnglishError, EnglishSession, VocabEntry } from "@hermes/shared";
import { hermesGet, hermesPost } from "@/lib/hermes";
import { useVoice } from "./VoiceBusyContext";

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;

/** Bajo esto, un cierre abrupto no amerita auto-guardado (ruido). */
const MIN_ABRUPT_LINES = 8;

export function EnglishTutorTools() {
  const { mode, transcript } = useVoice();
  const { status } = useConversationStatus();

  // Estado de la sesión de práctica en curso (refs: no re-renderiza nada).
  const startedAtRef = useRef<string | null>(null);
  const savedRef = useRef(false);
  const transcriptRef = useRef(transcript);
  transcriptRef.current = transcript;
  /** Índice del transcript donde arrancó ESTA sesión (excluye charla previa con Hermes). */
  const startLineRef = useRef(0);

  const sessionTranscript = () =>
    transcriptRef.current
      .slice(startLineRef.current)
      .map((l) => `${l.who}: ${l.text}`)
      .join("\n");

  const durationSec = () =>
    startedAtRef.current
      ? Math.max(0, Math.round((Date.now() - Date.parse(startedAtRef.current)) / 1000))
      : 0;

  useConversationClientTool("save_vocab", async (p) => {
    const term = str(p.term);
    const meaning = str(p.meaning_es);
    if (!term || !meaning) return "Missing term or meaning.";
    try {
      await hermesPost<VocabEntry>("/english/vocab", {
        term,
        meaning_es: meaning,
        example: str(p.example),
      });
      return `Saved "${term}".`;
    } catch {
      return "Could not save it (agent offline) — keep going.";
    }
  });

  useConversationClientTool("recall_vocab", async () => {
    try {
      const due = await hermesGet<VocabEntry[]>("/english/vocab?due=true&limit=6");
      if (!due.length) return "No vocabulary due for review — nothing pending.";
      // Los taps del transcript llegan sin significado: pedirle al tutor que
      // los defina (y re-guarde con save_vocab) cierra el ciclo del banco.
      return `Vocabulary due for review: ${due
        .map((v) =>
          v.meaning_es
            ? `${v.term} (${v.meaning_es})`
            : `${v.term} (no meaning saved yet — explain it and re-save it with save_vocab)`,
        )
        .join(" · ")}. Quiz him conversationally on a few of these.`;
    } catch {
      return "Could not fetch the vocabulary list (agent offline).";
    }
  });

  useConversationClientTool("end_practice_session", async (p) => {
    const errors = Array.isArray(p.errors)
      ? (p.errors as Record<string, unknown>[])
          .map((e) => ({
            quote: str(e.quote) ?? "",
            correction: str(e.correction) ?? "",
            note_es: str(e.note_es),
          }))
          .filter((e) => e.quote && e.correction)
      : [];
    try {
      await hermesPost<EnglishSession>("/english/sessions", {
        started_at: startedAtRef.current ?? new Date().toISOString(),
        duration_sec: durationSec(),
        topics: Array.isArray(p.topics) ? (p.topics as unknown[]).map(String) : [],
        fluency: typeof p.fluency === "number" ? p.fluency : undefined,
        errors: errors satisfies EnglishError[],
        wins: Array.isArray(p.wins) ? (p.wins as unknown[]).map(String) : [],
        transcript: sessionTranscript(),
      });
      savedRef.current = true;
      return "Session saved — the full report will show up in his dashboard in a minute.";
    } catch {
      return "Could not save the session (agent offline). Tell him the summary out loud instead.";
    }
  });

  // Ciclo de vida de la sesión: marca el inicio al conectar en modo tutor y
  // auto-guarda si la llamada se corta sin end_practice_session (>N líneas).
  const prevRef = useRef({ status, mode });
  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = { status, mode };
    if (mode === "tutor" && status === "connected" && prev.status !== "connected") {
      startedAtRef.current = new Date().toISOString();
      savedRef.current = false;
      startLineRef.current = transcriptRef.current.length;
      return;
    }
    // Cierre abrupto (colgó sin despedirse): el transcript no se pierde — el
    // reporte post-sesión extrae errores/temas de ahí.
    if (
      prev.mode === "tutor" &&
      prev.status === "connected" &&
      status === "disconnected" &&
      !savedRef.current &&
      startedAtRef.current &&
      transcriptRef.current.length - startLineRef.current >= MIN_ABRUPT_LINES
    ) {
      const payload = {
        started_at: startedAtRef.current,
        duration_sec: durationSec(),
        transcript: sessionTranscript(),
      };
      savedRef.current = true;
      void hermesPost("/english/sessions", payload).catch(() => undefined);
    }
  }, [status, mode]);

  return null;
}
