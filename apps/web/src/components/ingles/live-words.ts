// Lógica pura del karaoke de la práctica en vivo: tokenizar la frase del tutor
// en palabras clickeables y estimar cuánto "dura" cada palabra hablada. El SDK
// de ElevenLabs entrega la frase completa (sin timings por palabra), así que el
// resaltado es una animación estimada: arranca con el audio del agente
// (isSpeaking) y se completa cuando el audio termina.

export interface WordToken {
  /** Texto tal cual se pinta (conserva mayúsculas y puntuación pegada). */
  raw: string;
  /** Forma normalizada para el banco (minúsculas, sin puntuación) o null si el token no es palabra. */
  clean: string | null;
}

/** Núcleo de palabra: letras (con acentos) + apóstrofes/guiones internos. */
const WORD_CORE = /([A-Za-zÀ-ÖØ-öø-ÿ]+(?:['’-][A-Za-zÀ-ÖØ-öø-ÿ]+)*)/;
const WORD_EXACT = new RegExp(`^${WORD_CORE.source}$`);

export function tokenizeWords(text: string): WordToken[] {
  return text
    .split(WORD_CORE)
    .filter((part) => part.length > 0)
    .map((part) => ({
      raw: part,
      clean: WORD_EXACT.test(part) ? part.toLowerCase() : null,
    }));
}

/** Solo palabras con sustancia van al banco ("I"/"a" no; contracciones sí). */
export function saveableWord(clean: string): boolean {
  return clean.length >= 2;
}

/**
 * Duración estimada de cada palabra hablada (ms), indexada por palabra (no por
 * token). ~160 wpm del TTS: base + longitud, con pausa extra si a la palabra
 * le sigue puntuación fuerte (fin de cláusula).
 */
export function wordSchedule(tokens: WordToken[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (!t.clean) continue;
    let ms = Math.min(700, 150 + t.clean.length * 45);
    const next = tokens[i + 1];
    if (next && !next.clean && /[.,;:!?…—]/.test(next.raw)) ms += 260;
    out.push(ms);
  }
  return out;
}
