/**
 * Coach en vivo de la junta: métricas por hablante computadas SOLO del
 * transcript real (regla de oro del dashboard: nada inventado). Corre en el
 * tick de 5 s de live.ts — es una función pura y barata, sin LLM.
 *
 * Métricas: tiempo hablado (ratio de conversación), palabras, WPM y conteo
 * de muletillas es/en. El juicio cualitativo (claridad, estructura, score)
 * se difiere al post-meeting (ingest), donde sí hay LLM y contexto completo.
 */
import type { LiveCoachMetrics, LiveSegment, LiveSpeakerStats } from "@hermes/shared";

// Muletillas por idioma. Palabra completa (\b) para no contar substrings;
// "este" y "like" son ambiguas pero el conteo agregado sigue siendo señal
// útil de ritmo (el post-meeting las pondera con contexto).
const FILLERS_ES = /\b(este|estee|o sea|osea|pues|eh|ehh|em|emm|como que|digamos|¿no\?|¿sí\?)\b/gi;
const FILLERS_EN = /\b(like|you know|um|umm|uh|uhh|basically|actually|i mean|sort of|kind of)\b/gi;

export function countFillers(text: string): number {
  const es = text.match(FILLERS_ES)?.length ?? 0;
  const en = text.match(FILLERS_EN)?.length ?? 0;
  return es + en;
}

export function computeCoachMetrics(
  segments: LiveSegment[],
  selfSpeaker: string | undefined,
  atMs: number,
): LiveCoachMetrics {
  const bySpeaker: Record<string, LiveSpeakerStats> = {};
  for (const seg of segments) {
    if (!seg.final) continue; // los parciales cambian: solo texto consolidado
    const text = seg.text.trim();
    if (!text) continue;
    const stats = (bySpeaker[seg.speaker] ??= { talkMs: 0, words: 0, wpm: 0, fillers: 0 });
    stats.talkMs += Math.max(0, seg.endMs - seg.startMs);
    stats.words += text.split(/\s+/).length;
    stats.fillers += countFillers(text);
  }
  for (const stats of Object.values(bySpeaker)) {
    stats.wpm = stats.talkMs > 0 ? Math.round((stats.words / stats.talkMs) * 60_000) : 0;
  }
  return { atMs, bySpeaker, selfSpeaker };
}
