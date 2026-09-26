/**
 * Análisis de letras en español — lógica pura, sin React.
 *
 * Lo que un letrista mira sin pensarlo: cuántas sílabas métricas tiene cada
 * verso (para que el coro "cuadre" con la melodía), cómo riman los finales
 * (esquema ABAB / AABB…) y qué acordes van sobre qué palabra. Nada de esto
 * decide por el humano: son instrumentos de medida, como un metrónomo.
 *
 * Métrica: heurística honesta (vocales fuertes/débiles, diptongos, sinalefa
 * entre palabras y el ajuste por la acentuación de la última palabra).
 * Se etiqueta como aproximada en la UI porque lo es.
 */

const STRONG = "aeoáéóAEOÁÉÓ";
const WEAK = "iuIU";
const ACCENTED_WEAK = "íúÍÚ";
const VOWELS = STRONG + WEAK + ACCENTED_WEAK + "üÜ";

const isVowel = (c: string) => VOWELS.includes(c);
const isStrong = (c: string) => STRONG.includes(c) || ACCENTED_WEAK.includes(c);

/** Sílabas fonéticas de UNA palabra (sin ajustes de acento). */
export function wordSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-záéíóúüñ]/g, "");
  if (!w) return 0;
  let count = 0;
  let prevVowel = false;
  let prevChar = "";
  for (const c of w) {
    if (isVowel(c)) {
      if (!prevVowel) count++;
      else if (isStrong(c) && isStrong(prevChar)) count++; // hiato: dos fuertes
      else if (ACCENTED_WEAK.includes(c) || ACCENTED_WEAK.includes(prevChar)) count++; // í/ú rompen el diptongo
      prevVowel = true;
    } else {
      // "qu"/"gu" mudas: la u no cuenta como vocal.
      prevVowel = false;
    }
    prevChar = c;
  }
  // qu/gu + e/i: la 'u' se contó de más solo si formó sílaba propia; con la
  // regla de diptongo ya se pliega, así que no se corrige aparte.
  return Math.max(1, count);
}

/** Acentuación de la última palabra: aguda +1, llana 0, esdrújula −1. */
export function stressAdjust(lastWord: string): number {
  const w = lastWord.toLowerCase().replace(/[^a-záéíóúüñ]/g, "");
  if (!w) return 0;
  const syl = wordSyllables(w);
  if (syl === 1) return 1; // monosílabo = aguda a efectos métricos
  // Posición de la vocal acentuada (si hay tilde).
  const accentIdx = [...w].findIndex((c) => "áéíóú".includes(c));
  if (accentIdx >= 0) {
    // ¿En qué sílaba (desde el final) cae la tilde?
    const after = w.slice(accentIdx + 1);
    const sylAfter = countVowelGroups(after, w[accentIdx]);
    if (sylAfter === 0) return 1; // aguda
    if (sylAfter === 1) return 0; // llana
    return -1; // esdrújula
  }
  const last = w[w.length - 1];
  return isVowel(last) || last === "n" || last === "s" ? 0 : 1;
}

function countVowelGroups(s: string, prev: string): number {
  let n = 0;
  let prevVowel = isVowel(prev);
  let prevChar = prev;
  for (const c of s) {
    if (isVowel(c)) {
      if (!prevVowel) n++;
      else if (isStrong(c) && isStrong(prevChar)) n++;
      prevVowel = true;
    } else prevVowel = false;
    prevChar = c;
  }
  return n;
}

/** Sílabas métricas de un verso: suma de palabras − sinalefas + ajuste final. */
export function lineSyllables(line: string): number {
  const words = stripChords(line)
    .split(/\s+/)
    .map((w) => w.replace(/[^a-záéíóúüñA-ZÁÉÍÓÚÜÑ]/g, ""))
    .filter(Boolean);
  if (words.length === 0) return 0;
  let total = words.reduce((n, w) => n + wordSyllables(w), 0);
  // Sinalefa: vocal final + vocal inicial (la h es muda) se funden.
  for (let i = 0; i < words.length - 1; i++) {
    const a = words[i].toLowerCase();
    const b = words[i + 1].toLowerCase();
    const endV = isVowel(a[a.length - 1]);
    const startV = isVowel(b[0]) || (b[0] === "h" && b.length > 1 && isVowel(b[1]));
    if (endV && startV) total--;
  }
  return Math.max(1, total + stressAdjust(words[words.length - 1]));
}

/** Terminación desde la vocal tónica de la última palabra ("-ana", "-ión"). */
export function rhymeEnding(line: string): string {
  const words = stripChords(line)
    .split(/\s+/)
    .map((w) => w.toLowerCase().replace(/[^a-záéíóúüñ]/g, ""))
    .filter(Boolean);
  const w = words[words.length - 1];
  if (!w) return "";
  const chars = [...w];
  const accentIdx = chars.findIndex((c) => "áéíóú".includes(c));
  let start: number;
  if (accentIdx >= 0) start = accentIdx;
  else {
    // Sin tilde: llana si termina en vocal/n/s → penúltima vocal-grupo; aguda → última.
    const groups: number[] = [];
    let prevVowel = false;
    chars.forEach((c, i) => {
      if (isVowel(c)) {
        if (!prevVowel) groups.push(i);
        prevVowel = true;
      } else prevVowel = false;
    });
    if (groups.length === 0) return w;
    const last = chars[chars.length - 1];
    const llana = isVowel(last) || last === "n" || last === "s";
    start = groups.length >= 2 && llana ? groups[groups.length - 2] : groups[groups.length - 1];
  }
  return chars.slice(start).join("");
}

const strip = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

export type RhymeKind = "consonante" | "asonante" | null;

/** Compara dos versos: rima consonante (todo igual), asonante (solo vocales) o ninguna. */
export function rhymeBetween(a: string, b: string): RhymeKind {
  const ea = strip(rhymeEnding(a));
  const eb = strip(rhymeEnding(b));
  if (!ea || !eb) return null;
  if (ea === eb && ea.length >= 2) return "consonante";
  const va = ea.replace(/[^aeiou]/g, "");
  const vb = eb.replace(/[^aeiou]/g, "");
  if (va && va === vb) return "asonante";
  return null;
}

export interface LineAnalysis {
  text: string;
  syllables: number;
  ending: string;
  /** Letra del esquema (A, B, C…) o "–" si no rima con nadie. */
  scheme: string;
  rhyme: RhymeKind;
}

/** Esquema de rimas de una estrofa: cada verso recibe su letra. */
export function analyzeStanza(lines: string[]): LineAnalysis[] {
  const nonEmpty = lines.map((l) => l.trim());
  const labels: (string | null)[] = nonEmpty.map(() => null);
  const kinds: RhymeKind[] = nonEmpty.map(() => null);
  let next = 0;
  for (let i = 0; i < nonEmpty.length; i++) {
    if (!nonEmpty[i] || labels[i]) continue;
    let assigned: string | null = null;
    for (let j = i + 1; j < nonEmpty.length; j++) {
      if (!nonEmpty[j] || labels[j]) continue;
      const k = rhymeBetween(nonEmpty[i], nonEmpty[j]);
      if (k) {
        if (!assigned) {
          assigned = String.fromCharCode(65 + next++);
          labels[i] = assigned;
          kinds[i] = k;
        }
        labels[j] = assigned;
        kinds[j] = k;
      }
    }
  }
  return nonEmpty.map((text, i) => ({
    text,
    syllables: text ? lineSyllables(text) : 0,
    ending: text ? rhymeEnding(text) : "",
    scheme: text ? (labels[i] ?? "–") : "",
    rhyme: kinds[i],
  }));
}

// ── Acordes en la letra: notación [Am] inline (estilo ChordPro) ────────────

export interface ChordToken {
  chord: string;
  /** Índice del carácter (en el texto SIN acordes) sobre el que cae. */
  at: number;
}

/** Quita los [acordes] de un verso. */
export function stripChords(line: string): string {
  return line.replace(/\[[^\]]+\]/g, "");
}

/** Separa "Cuando [Am]llueve en la [F]ventana" en texto + acordes posicionados. */
export function splitChords(line: string): { text: string; chords: ChordToken[] } {
  const chords: ChordToken[] = [];
  let text = "";
  const re = /\[([^\]]+)\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    text += line.slice(last, m.index);
    chords.push({ chord: m[1], at: text.length });
    last = m.index + m[0].length;
  }
  text += line.slice(last);
  return { text, chords };
}

/** Acordes únicos usados en un bloque de letra, en orden de aparición. */
export function chordsInText(text: string): string[] {
  const seen: string[] = [];
  for (const m of text.matchAll(/\[([^\]]+)\]/g)) if (!seen.includes(m[1])) seen.push(m[1]);
  return seen;
}

/** Rimas sugeridas para una terminación: se buscan en un banco de palabras. */
export function findRhymes(word: string, bank: string[], limit = 12): { word: string; kind: RhymeKind }[] {
  const out: { word: string; kind: RhymeKind }[] = [];
  const target = word.toLowerCase();
  for (const w of bank) {
    if (w.toLowerCase() === target) continue;
    const k = rhymeBetween(word, w);
    if (k) out.push({ word: w, kind: k });
  }
  out.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "consonante" ? -1 : 1));
  return out.slice(0, limit);
}
