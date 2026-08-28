/**
 * Convención de captura del Estudio — la parte que comparten agente y
 * dashboard. (El nombre del crudo por bloque, `takeStem`, vive en
 * `apps/web/src/lib/capture.ts`: solo lo usa la UI.)
 *
 * Un bloque del guion puede quedar cubierto por DOS caminos:
 *
 *   crudos/01-hook.mov        ← lo que se VE (cámara o grabación de pantalla)
 *   assets/01-hook-vo.wav     ← lo que se DICE (voz en off grabada en Hermes)
 *
 * Re-grabar la voz NUNCA pisa: la toma nueva toma el siguiente sufijo libre
 * (`-vo`, `-vo-2`, `-vo-3`…) y la ÚLTIMA es la que manda para el checklist y
 * para el run de edición. Las anteriores quedan listadas para borrarlas a mano
 * — una toma buena no se pierde por volver a intentar.
 */
import type { PieceMediaFile } from "./types.js";

/** Marca de voz en off en el nombre del archivo. */
export const VO_SUFFIX = "-vo";

/** "[0-4s]" → "0-4s" · "Hook" → "hook" · "Intro alterna" → "intro-alterna". */
export function captureSlug(label: string): string {
  return (
    label
      .replace(/^\[|\]$/g, "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "toma"
  );
}

/** "01-hook" → "01-hook-vo" (idempotente: no duplica el sufijo). */
export function voBase(stem: string): string {
  return stem.endsWith(VO_SUFFIX) ? stem : `${stem}${VO_SUFFIX}`;
}

/** "01-hook-vo-2" → "01-hook-vo" · null si el archivo no es voz en off. */
export function voBaseOf(fileStem: string): string | null {
  const m = fileStem.toLowerCase().match(/^(.*-vo)(?:-\d+)?$/);
  return m ? m[1] : null;
}

/** ¿El archivo es una toma de voz en off? ("01-hook-vo", "01-hook-vo-2"). */
export function isVoStem(fileStem: string): boolean {
  return voBaseOf(fileStem) !== null;
}

/** Número de toma: "…-vo" = 1, "…-vo-3" = 3. */
export function voTakeNumber(fileStem: string): number {
  const m = fileStem.match(/-vo-(\d+)$/);
  return m ? Number(m[1]) : 1;
}

/** Tomas de voz de un bloque, en orden de grabación (la última manda). */
export function voTakesFor(files: PieceMediaFile[], stem: string): PieceMediaFile[] {
  const base = voBase(stem).toLowerCase();
  return files
    .filter((f) => voBaseOf(f.stem) === base)
    .sort((a, b) => voTakeNumber(a.stem) - voTakeNumber(b.stem));
}

/** Todas las tomas de voz de la carpeta (para el run de edición y el conteo). */
export function voTakes(files: PieceMediaFile[]): PieceMediaFile[] {
  return files.filter((f) => isVoStem(f.stem));
}

/**
 * La toma que MANDA por bloque: la última grabada. Es lo que ve el checklist
 * y lo único que entra al prompt de la edición automática — las anteriores
 * quedan en disco por si hay que volver a una, pero no editan nada solas.
 */
export function latestVoTakes(files: PieceMediaFile[]): PieceMediaFile[] {
  const byBase = new Map<string, PieceMediaFile>();
  for (const f of voTakes(files)) {
    const base = voBaseOf(f.stem);
    if (!base) continue;
    const prev = byBase.get(base);
    if (!prev || voTakeNumber(f.stem) >= voTakeNumber(prev.stem)) byBase.set(base, f);
  }
  return [...byBase.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Siguiente nombre libre para una toma nueva: nunca pisa la anterior.
 * `existingStems` son los nombres base ya presentes en assets/.
 */
export function nextVoName(stem: string, existingStems: string[], ext = ".wav"): string {
  const base = voBase(captureSlug(stem));
  const taken = new Set(existingStems.map((s) => s.toLowerCase()));
  if (!taken.has(base)) return `${base}${ext}`;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return `${candidate}${ext}`;
  }
  // 999 tomas del mismo bloque: absurdo, pero jamás devolver un nombre ocupado.
  return `${base}-${Date.now()}${ext}`;
}
