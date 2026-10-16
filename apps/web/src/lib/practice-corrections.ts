// Correcciones de la compañera durante "Practicar ahora". Viven aquí (módulo,
// fuera de React) porque las escribe el hook de la compañera y las lee
// EnglishTutorTools al guardar la sesión — incluso en el cierre abrupto, que
// ocurre justo cuando la compañera se apaga.

import { correctionsFromSuggestions, type EnglishError, type LiveSuggestion } from "@hermes/shared";

/** Tope del agente para `errors` en POST /english/sessions. */
const MAX_ERRORS = 12;

let current: LiveSuggestion[] = [];

export function resetPracticeCorrections(): void {
  current = [];
}

export function addPracticeCorrection(s: LiveSuggestion): void {
  if (s.kind === "corregir") current = [...current, s];
}

/** Errores del tutor primero; luego las correcciones en vivo que no repiten ninguno. */
export function mergePracticeCorrections(errors: EnglishError[]): EnglishError[] {
  const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "").trim();
  const seen = new Set(errors.map((e) => norm(e.correction)));
  const extra = correctionsFromSuggestions(current).filter((e) => !seen.has(norm(e.correction)));
  return [...errors, ...extra].slice(0, MAX_ERRORS);
}
