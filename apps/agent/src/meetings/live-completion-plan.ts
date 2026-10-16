/**
 * Decisión PURA del job que completa una junta en vivo con el archivo del
 * teléfono (A3). Sin I/O: recibe lo que se sabe de la sesión y dice qué hacer.
 *
 *   sesión aún viva/cerrando/ingestando → esperar (tope 20 min)
 *   terminó con acta, gap < 3 s         → adjuntar el audio (cero STT)
 *   terminó con acta, gap ≥ 3 s         → re-transcribir y re-ingestar SOBRE esa acta
 *   clase de inglés con acta            → adjuntar siempre (la clase no se re-ingesta)
 *   sin acta (error) o id desconocido   → flujo normal: junta nueva desde el audio
 */
import { CLASS_COACH_MODE } from "@hermes/shared";
import type { LiveMeetingStatus } from "@hermes/shared";
import type { LiveIndexEntry } from "./live-index.js";

/** Menos que esto no amerita re-transcribir: lo que faltó ni se nota en el acta. */
export const GAP_REINGEST_MS = 3_000;
/** Lo más que se espera a que la junta en vivo termine de ingestar. */
export const LIVE_WAIT_TIMEOUT_MS = 20 * 60_000;

export interface LiveCompletionFacts {
  /** Sesión en memoria (si el agente aún la recuerda). */
  session?: { status: LiveMeetingStatus; meetingId?: string; coachMode?: string };
  /** Lo que dice el índice durable. */
  indexed?: Pick<LiveIndexEntry, "status" | "meetingId" | "coachMode">;
  /** Queda un `.live-<id>.json` en el vault: el recover del boot la va a ingestar. */
  orphanSnapshot: boolean;
  gapMs: number;
  /** Cuánto lleva esperando el job. */
  waitedMs: number;
}

export type LiveCompletionPlan =
  | { action: "wait"; reason: string }
  | { action: "attach"; meetingId: string; note?: string }
  | { action: "reingest"; meetingId: string }
  | { action: "new_meeting"; reason: string };

const IN_FLIGHT: LiveMeetingStatus[] = ["connecting", "live", "stopping", "ingesting"];

export function planLiveCompletion(f: LiveCompletionFacts): LiveCompletionPlan {
  const gapMs = Math.max(0, Number.isFinite(f.gapMs) ? f.gapMs : 0);
  const resolved = (meetingId: string, coachMode?: string): LiveCompletionPlan => {
    if (coachMode === CLASS_COACH_MODE) {
      // La clase vive en english_sessions con su reporte: re-ingestarla haría
      // otra sesión de inglés. El audio se adjunta y el hueco solo se anota.
      return gapMs >= GAP_REINGEST_MS
        ? {
            action: "attach",
            meetingId,
            note: `clase de inglés: ${Math.round(gapMs / 1000)} s no llegaron en vivo, pero la clase no se re-ingesta (solo se adjunta el audio)`,
          }
        : { action: "attach", meetingId };
    }
    return gapMs >= GAP_REINGEST_MS ? { action: "reingest", meetingId } : { action: "attach", meetingId };
  };
  const waitOr = (reason: string): LiveCompletionPlan =>
    f.waitedMs >= LIVE_WAIT_TIMEOUT_MS
      ? { action: "new_meeting", reason: `la junta en vivo no terminó en ${LIVE_WAIT_TIMEOUT_MS / 60_000} min (${reason})` }
      : { action: "wait", reason };

  const s = f.session;
  if (s && IN_FLIGHT.includes(s.status)) return waitOr(`la junta sigue en «${s.status}»`);
  if (s?.status === "done" && s.meetingId) return resolved(s.meetingId, s.coachMode);

  const ix = f.indexed;
  if (ix?.status === "done" && ix.meetingId) return resolved(ix.meetingId, ix.coachMode ?? s?.coachMode);
  // Ingesta fallida con snapshot guardado: el recover del próximo boot la crea.
  if (ix?.status === "pending" || f.orphanSnapshot) return waitOr("la ingesta en vivo quedó para el recover");
  if (s?.status === "error" || ix?.status === "error")
    return { action: "new_meeting", reason: "la junta en vivo terminó sin acta" };
  return { action: "new_meeting", reason: "sesión en vivo desconocida" };
}
