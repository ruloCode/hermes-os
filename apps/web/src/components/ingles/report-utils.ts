// Helpers para leer el report_md post-sesión (secciones fijas que garantiza
// la tool record_practice_report del agente: Análisis · Errores recurrentes ·
// Drills). De aquí salen las recomendaciones accionables de la vista Inglés.

import type { EnglishSession } from "@hermes/shared";

/** Contenido de una sección "## Título" del markdown (hasta el próximo ##). */
export function extractSection(md: string, title: string): string | null {
  const re = new RegExp(`^##\\s*${title}\\s*$\\n([\\s\\S]*?)(?=\\n##\\s|$)`, "im");
  return md.match(re)?.[1]?.trim() ?? null;
}

/** Bullets/numerados de un bloque markdown, sin el marcador ni énfasis
 *  (negritas y code inline se muestran planos fuera del renderer de Markdown). */
export function extractBullets(block: string): string[] {
  return block
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^([-*]|\d+[.)])\s+\S/.test(l))
    .map((l) =>
      l
        .replace(/^([-*]|\d+[.)])\s+/, "")
        .replaceAll("**", "")
        .replaceAll("`", "")
        .trim(),
    )
    .filter(Boolean);
}

/** La sesión más reciente con reporte listo (fuente de las recomendaciones). */
export function latestReported(sessions: EnglishSession[]): EnglishSession | null {
  return sessions.find((s) => s.report_status === "done" && s.report_md) ?? null;
}

export function fmtDuration(totalSec: number): string {
  const min = Math.round(totalSec / 60);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${min % 60} min`;
}

/** Fecha ISO (AAAA-MM-DD): la que viaja a Linear y a los prompts. */
export function fmtDate(iso: string): string {
  return iso.slice(0, 10);
}

// Para LEER en la UI: "2026-10-14" obliga a descifrar; "mié 14 oct" se lee de
// un vistazo. Se arma con formatToParts porque el formato largo de es-CO mete
// comas y "de" ("mié, 14 de oct") que en una lista densa son ruido.
const DAY_FMT = new Intl.DateTimeFormat("es-CO", {
  weekday: "short",
  day: "numeric",
  month: "short",
});
const LONG_FMT = new Intl.DateTimeFormat("es-CO", {
  weekday: "long",
  day: "numeric",
  month: "long",
});
const TIME_FMT = new Intl.DateTimeFormat("es-CO", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function parts(fmt: Intl.DateTimeFormat, d: Date): Record<string, string> {
  return Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
}

/** "mié 14 oct" (+ año si no es el actual). Sin fecha válida, la ISO tal cual. */
export function fmtDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return fmtDate(iso);
  const p = parts(DAY_FMT, d);
  const base = `${p.weekday} ${p.day} ${p.month}`.replace(/\./g, "");
  return d.getFullYear() === new Date().getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

/** "miércoles 14 de octubre" — el encabezado de un reporte. */
export function fmtDayLong(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return fmtDate(iso);
  const p = parts(LONG_FMT, d);
  const base = `${p.weekday} ${p.day} de ${p.month}`;
  return d.getFullYear() === new Date().getFullYear() ? base : `${base} de ${d.getFullYear()}`;
}

/** "18:40" — distingue dos sesiones del mismo día. */
export function fmtTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : TIME_FMT.format(d);
}
