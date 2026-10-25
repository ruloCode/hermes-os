/**
 * Cierre de una clase de inglés EN VIVO: en vez del acta de junta (resumen +
 * 2 accionables, que no aplica a una clase), la sesión entra al pipeline de
 * inglés — english_sessions (source "class") + reporte post-sesión con
 * errores recurrentes y drills + check-in del hábito "Práctica de inglés".
 * Así la tutora de voz abre la siguiente práctica con los errores REALES de
 * la clase ({{practice_context}}).
 */
import {
  audioReportLine,
  classMetricsLine,
  computeClassMetrics,
  correctionsFromSuggestions,
  type EnglishSession,
  type LiveAudioReport,
  type LiveSegment,
  type LiveSuggestion,
} from "@hermes/shared";
import { generatePracticeReport } from "./report.js";
import { saveEnglishSession } from "./store.js";

/** Tope de errores guardados por clase (el tutor guarda 3-6 por sesión). */
const MAX_CLASS_ERRORS = 20;

export async function ingestClass(p: {
  /** ISO del arranque: ancla idempotente del local_key (un reintento no duplica). */
  startedAt: string;
  durationSec: number | null;
  /** Transcript final con nombres Profe/Yo (buildFinalTranscript de live.ts). */
  transcript: string;
  segments: LiveSegment[];
  selfSpeaker: string | undefined;
  suggestions: LiveSuggestion[];
  /** Qué mic usó el browser y cuánta voz entró por cada fuente (si lo reportó). */
  audio?: LiveAudioReport;
}): Promise<EnglishSession> {
  const errors = correctionsFromSuggestions(p.suggestions, MAX_CLASS_ERRORS);
  const corrections = p.suggestions.filter((s) => s.kind === "corregir").length;
  const metrics = computeClassMetrics(p.segments, p.selfSpeaker, corrections);
  const session = await saveEnglishSession({
    startedAt: p.startedAt,
    durationSec: p.durationSec,
    transcript: [classMetricsLine(metrics), audioReportLine(p.audio), "", p.transcript]
      .filter((l, i) => l || i === 2)
      .join("\n"),
    errors,
    source: "class",
  });
  if (!session) throw new Error("no se pudo guardar la clase (sin Supabase)");
  void generatePracticeReport(session.id);
  return session;
}
