/**
 * Medidas EN VIVO del Playground (molde, calce de una línea, semitonos hacia
 * la canción, notas fuera de la tonalidad) sobre la lógica pura de
 * `@hermes/shared/melody` — la misma que usa el agente, así lo que la UI mide
 * mientras escribes es lo que el agente guardó.
 */
import {
  lineFit,
  outOfKey,
  phraseMold,
  semitonesToKey,
  transposeNotes,
  type Key,
  type LineFit,
  type MelismaMode,
  type MelodyNote,
  type Phrase,
  type PhraseMold,
} from "@hermes/shared";
import { mod12 } from "@/lib/music-theory";

/** Molde de la frase según el modo de melisma; la corrección humana manda. */
export const moldOf = (phrase: Phrase, mode: MelismaMode): PhraseMold => phraseMold(phrase, mode);

/**
 * Calce de una línea contra un molde; null = sin texto o no se pudo medir. Una
 * entrada rara no debe romper la pantalla en la que se está escribiendo.
 */
export function fitOf(text: string, mold: PhraseMold, mode: MelismaMode): LineFit | null {
  if (!text.trim()) return null;
  try {
    return lineFit(text, mold, mode);
  } catch {
    return null;
  }
}

/** Mayor/menor relativas cuentan como la misma escala. */
export const semisToKey = (from: Key, to: Key): number => semitonesToKey(from, to);

/** Por nota: ¿fuera de la escala? (en menor se tolera la sensible del V mayor). */
export const outOfKeyMask = (notes: MelodyNote[], key: Key): boolean[] => outOfKey(notes, key);

export function shiftNotes(notes: MelodyNote[], semis: number): MelodyNote[] {
  return semis === 0 ? notes : transposeNotes(notes, semis);
}

/** Transpone una tonalidad: la escala se mueve entera, el modo no cambia. */
export const shiftKey = (k: Key, semis: number): Key => ({ tonic: mod12(k.tonic + semis), mode: k.mode });

