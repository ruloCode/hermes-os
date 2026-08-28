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

export function fmtDate(iso: string): string {
  return iso.slice(0, 10);
}
