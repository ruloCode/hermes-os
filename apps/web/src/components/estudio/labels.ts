/** Etiquetas y tonos del ESTUDIO — un solo lugar para pilares y etapas.
 *  La DEFINICIÓN de cada etapa (qué significa, qué falta para avanzar) vive en
 *  `@hermes/shared/content.ts`: aquí solo se le pone color. */
import { CONTENT_STAGES, STAGES } from "@hermes/shared";
import type { ContentPillar, ContentStatus, PublishState } from "@hermes/shared";
import type { Tone } from "@/components/ui/tones";

export const PILLARS: Record<ContentPillar, { label: string; short: string; tone: Tone }> = {
  p1: { label: "Jarvis en público", short: "P1", tone: "violet" },
  p2: { label: "Agentes que trabajan", short: "P2", tone: "cyan" },
  p3: { label: "Automatización real", short: "P3", tone: "green" },
  p4: { label: "Build in public", short: "P4", tone: "amber" },
  p5: { label: "Puente no-técnico", short: "P5", tone: "neutral" },
};

/** Orden del pipeline (descartada no es etapa: es una salida, se lista aparte). */
export const STATUS_ORDER: ContentStatus[] = CONTENT_STAGES;

const STATUS_TONE: Record<ContentStatus, Tone> = {
  idea: "neutral",
  guion: "amber",
  grabacion: "cyan",
  edicion: "violet",
  programado: "green",
  publicado: "neutral",
  descartada: "red",
};

export const STATUSES: Record<ContentStatus, { label: string; tone: Tone }> = Object.fromEntries(
  (Object.keys(STATUS_TONE) as ContentStatus[]).map((s) => [
    s,
    { label: STAGES[s].label, tone: STATUS_TONE[s] },
  ]),
) as Record<ContentStatus, { label: string; tone: Tone }>;

/** "3 días" · "hoy" — antigüedad legible para el seguimiento de etapa. */
export function fmtDays(days: number | null): string {
  if (days == null) return "—";
  if (days < 1) return "hoy";
  const d = Math.floor(days);
  return d === 1 ? "1 día" : `${d} días`;
}

export const PLATFORMS = ["youtube", "shorts", "tiktok", "reels", "linkedin", "x"] as const;

/** Cómo se lee cada estado REAL de publicación (el de máquina, no el editorial). */
export const PUBLISH_STATES: Record<PublishState, { label: string; tone: Tone }> = {
  pendiente: { label: "en cola", tone: "amber" },
  subiendo: { label: "subiendo", tone: "violet" },
  programada: { label: "programada", tone: "cyan" },
  publicada: { label: "en vivo", tone: "green" },
  error: { label: "error", tone: "red" },
  manual: { label: "manual", tone: "neutral" },
};

/** ISO → valor de <input type="datetime-local"> en hora local. */
export function isoToLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "sáb 1 ago · 10:00" en hora de Bogotá. */
export function fmtPublish(iso: string | null): string {
  if (!iso) return "sin fecha";
  return new Date(iso)
    .toLocaleString("es-CO", {
      timeZone: "America/Bogota",
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    })
    .replace(",", " ·");
}
