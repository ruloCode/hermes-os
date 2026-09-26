/**
 * La lectura de una línea PUESTA SOBRE su molde, para mostrarla sílaba por
 * sílaba (lógica pura, sin React):
 *
 *  - `originTokens`: lo que se tarareó en cada posición del molde ("na na ná
 *    uh oh"), con la tónica marcada con tilde, el melisma y la vocal que el
 *    tarareo pide ahí (solo en rellenos: en palabras reales no se exige nada).
 *  - `readingTokens`: las sílabas que mide `lineFit` (`fit.reading`, en
 *    minúsculas y sin puntuación) devueltas a la escritura ORIGINAL
 *    ("Na-da más, tu voz"): mayúsculas, signos y la sinalefa como "‿".
 *
 * Nada aquí mide: la medida es `lineFit` de @hermes/shared (la misma que usa
 * el agente). Esto solo la dibuja.
 */
import { moldPositions, stripChords, vowelOfText, type MelismaMode, type Phrase, type Vowel } from "@hermes/shared";

export interface OriginToken {
  /** 1-based. */
  pos: number;
  /** Lo que se cantó ahí; en el tarareo, la tónica lleva tilde ("ná"). */
  text: string;
  stressed: boolean;
  /** Notas del melisma (modo respetar). */
  melisma?: number;
  /** Continúa el melisma de la posición anterior (modo silabizar). */
  cont: boolean;
  /** Vocal que el tarareo pide aquí (solo rellenos). */
  want?: Vowel;
  filler: boolean;
}

export interface ReadingToken {
  /** 1-based: la posición del molde en la que cae. */
  pos: number;
  /** Escritura original ("más,"), con "‿" donde hay sinalefa ("va‿el"). */
  text: string;
  /** Empieza palabra (si no, va pegada a la anterior: "Na-da"). */
  wordStart: boolean;
  /** Palabras de la línea que caen aquí (dos con sinalefa), sin signos. */
  words: string[];
  /** Índice en `text` de la vocal que canta; −1 si no hay. */
  nucleus: number;
}

const STRONG = "aeoáéóíúAEOÁÉÓÍÚ";
const WEAK = "iuüyIUÜY";
const ACUTE: Record<string, string> = { a: "á", e: "é", i: "í", o: "ó", u: "ú" };

/** La vocal que canta en una sílaba: la fuerte (o í/ú con tilde); si no, la última débil. */
export function nucleusIndex(syl: string): number {
  for (let i = 0; i < syl.length; i++) if (STRONG.includes(syl[i])) return i;
  for (let i = syl.length - 1; i >= 0; i--) if (WEAK.includes(syl[i])) return i;
  return -1;
}

/** "na" → "ná", "dun" → "dún" (si ya lleva tilde, igual). */
function withAcute(syl: string): string {
  const i = nucleusIndex(syl);
  if (i < 0) return syl;
  const c = ACUTE[syl[i]];
  return c ? syl.slice(0, i) + c + syl.slice(i + 1) : syl;
}

/**
 * Lo que se tarareó en cada posición del molde, en el modo de melisma dado.
 * `count` = sílabas del molde (con la corrección humana): si es menor que las
 * posiciones medidas, se recorta; si es mayor, las que faltan salen como "·".
 */
export function originTokens(phrase: Phrase, mode: MelismaMode, count?: number): OriginToken[] {
  let ps: ReturnType<typeof moldPositions>;
  try {
    ps = moldPositions(phrase, mode);
  } catch {
    return [];
  }
  const out: OriginToken[] = ps.map((p, i) => {
    const s = phrase.syllables[p.syllable];
    const cont = i > 0 && ps[i - 1].syllable === p.syllable;
    const want = p.info.filler ? p.info.vowel : undefined;
    const raw = (s?.text ?? "").normalize("NFC").toLowerCase().replace(/[^a-záéíóúüñ]/g, "");
    // La continuación de un melisma silabizado se escribe con su vocal sola ("oh · o · o").
    const base = cont ? (want ?? (raw ? vowelOfText(raw) : null) ?? "·") : raw || "·";
    return {
      pos: p.pos,
      // La tilde marca el acento solo en el tarareo ("ná"); en una palabra real sería una falta.
      text: p.stressed && !cont && p.info.filler ? withAcute(base) : base,
      stressed: p.stressed,
      melisma: p.melisma?.notes,
      cont,
      want,
      filler: p.info.filler,
    };
  });
  const n = count ?? out.length;
  if (n <= out.length) return out.slice(0, Math.max(0, n));
  for (let k = out.length; k < n; k++) out.push({ pos: k + 1, text: "·", stressed: false, cont: false, filler: false });
  return out;
}

const base = (c: string) =>
  c
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
const isLetter = (c: string) => /\p{L}/u.test(c);
const isSpace = (c: string) => /\s/.test(c);
/** Signos que ABREN (van con la sílaba siguiente). */
const OPENERS = "¿¡«(“\"'";

/**
 * Devuelve cada sílaba de la lectura (`fit.reading`) a la escritura original
 * de la línea. Tolerante: si una letra no aparece (la línea cambió mientras
 * se medía) se cae a la sílaba normalizada, nunca a un error.
 */
export function readingTokens(line: string, reading: string[]): ReadingToken[] {
  const chars = [...stripChords(line).normalize("NFC")];
  // Palabra de cada carácter (para el malacento: «quería», no «rí»).
  const wordOf: number[] = [];
  const words: string[] = [];
  let w = -1;
  let inWord = false;
  chars.forEach((c) => {
    if (isSpace(c)) {
      inWord = false;
      wordOf.push(-1);
      return;
    }
    if (!inWord) {
      w++;
      words.push("");
      inWord = true;
    }
    if (isLetter(c)) words[w] += c;
    wordOf.push(w);
  });

  const out: ReadingToken[] = [];
  let i = 0;
  let lost = false;
  reading.forEach((syl, k) => {
    const letters = [...syl.normalize("NFC")].filter((c) => !isSpace(c));
    let text = "";
    let wordStart = k === 0;
    const here = new Set<number>();
    // Lo que va antes: espacios (empieza palabra) y signos que abren.
    while (i < chars.length && !isLetter(chars[i])) {
      if (isSpace(chars[i])) wordStart = true;
      else text += chars[i];
      i++;
    }
    for (const L of letters) {
      let guard = 0;
      while (i < chars.length && base(chars[i]) !== base(L) && guard < 6) {
        // Dentro de una sinalefa: el espacio se vuelve "‿".
        text += isSpace(chars[i]) ? "‿" : chars[i];
        if (!isSpace(chars[i]) && wordOf[i] >= 0 && isLetter(chars[i])) here.add(wordOf[i]);
        i++;
        guard++;
      }
      if (i >= chars.length || base(chars[i]) !== base(L)) {
        lost = true;
        return;
      }
      text += chars[i];
      if (wordOf[i] >= 0) here.add(wordOf[i]);
      i++;
    }
    // Lo que cierra (coma, interrogación…) se queda con esta sílaba.
    while (i < chars.length && !isLetter(chars[i]) && !isSpace(chars[i]) && !OPENERS.includes(chars[i])) {
      text += chars[i];
      i++;
    }
    out.push({ pos: k + 1, text, wordStart, words: [...here].map((x) => words[x]).filter(Boolean), nucleus: nucleusIndex(text) });
  });
  if (!lost) return out;
  // La línea no se pudo recorrer: las sílabas normalizadas, sin inventar palabras.
  return reading.map((syl, k) => {
    const text = syl.replace(/ /g, "‿");
    return { pos: k + 1, text, wordStart: true, words: [syl.replace(/ /g, "")], nucleus: nucleusIndex(text) };
  });
}

/** La palabra que carga una sílaba (con sinalefa, la más larga: la de contenido). */
export function wordOfToken(t: ReadingToken | undefined, fallback: string): string {
  if (!t || !t.words.length) return fallback;
  return t.words.reduce((a, b) => (b.length > a.length ? b : a));
}
