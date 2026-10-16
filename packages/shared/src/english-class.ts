/**
 * Clase de inglés EN VIVO (modo "clase-ingles" de la junta en vivo): lógica
 * pura que comparten el agente y el dashboard. Sin timers ni red — lo que
 * decide QUÉ se corrige, cómo se lee una corrección y qué métricas salen del
 * transcript real.
 */
import type { EnglishError, LiveClassMetrics, LiveSegment, LiveSuggestion } from "./types.js";

/** Key del modo en COACH_MODES y en el snapshot. */
export const CLASS_COACH_MODE = "clase-ingles";
/** La clase vive en el proyecto Inglés del vault (snapshots anti-reinicio incluidos). */
export const CLASS_PROJECT_SLUG = "ingles";
/** Menos palabras que esto no amerita corrección ("yes, sure", "ok thanks"). */
export const CORRECT_MIN_WORDS = 5;

export function wordCount(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

// Palabras función por idioma (las que casi toda frase trae). Por TOKENS, no
// por substring: "Yes, I make a similar agent last year" no traía ninguna de
// la lista vieja (the/and/you/is…) y el empate la mandaba a "es" — nunca se
// corregía. Las ambiguas ("a", "no", "me") no cuentan para ninguno.
const EN_WORDS = new Set(
  "the and you your what how is are to of with do does did i i'm i've it it's my was were for have has had in on at we they this that but very can will would there their about from be been".split(" "),
);
const ES_WORDS = new Set(
  "el la los las de del que y en para con qué cómo es está están por un una mi yo pero lo se al muy tengo eso esto también porque cuando pues bueno entonces hay fue soy estoy como más".split(" "),
);

/** Heurística barata de idioma (palabras función es/en). Empate → acentos/¿¡ deciden. */
export function guessLang(text: string): "es" | "en" {
  const tokens = text.toLowerCase().match(/[\p{L}']+/gu) ?? [];
  let es = 0;
  let en = 0;
  for (const t of tokens) {
    if (EN_WORDS.has(t)) en += 1;
    if (ES_WORDS.has(t)) es += 1;
  }
  if (en !== es) return en > es ? "en" : "es";
  return /[áéíóúñ¿¡]/i.test(text) ? "es" : "en";
}

/**
 * ¿Vale la pena mandar este bloque al corrector? Tiene que ser inglés y largo
 * suficiente: lo dicho en español no es un error de gramática, es una caída
 * al español (se cuenta aparte en las métricas).
 */
export function correctable(text: string): boolean {
  return wordCount(text) >= CORRECT_MIN_WORDS && guessLang(text) === "en";
}

const QUOTES = /^[\s"'“”«»‘’`]+|[\s"'“”«»‘’`]+$/g;
const norm = (t: string) =>
  t
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Lee la línea del corrector: `lo que dijo → cómo se dice | regla`.
 * null = silencio ("—"), formato roto o una "corrección" idéntica al original.
 *
 * `said` = lo que se mandó a corregir: cuando el error abarca toda la frase el
 * modelo suele reescribirla sin repetir "lo que dijo" (`forma | regla`), y con
 * `said` esa respuesta sigue siendo una corrección legible.
 */
export function parseCorrection(raw: string, said?: string): EnglishError | null {
  const line = raw.trim().split("\n")[0]?.trim() ?? "";
  if (!line || /^[—–-]+$/.test(line)) return null;
  // La flecha cuenta solo ANTES de la regla: "forma | regla con a → b" (el
  // modelo omitió lo que dijo) no puede leerse como corrección.
  const head = line.split(/\s*\|\s*/)[0];
  const arrow = head.match(/\s*(?:→|->|=>)\s*/);
  if (!arrow || arrow.index == null) {
    const quote = said?.trim().replace(QUOTES, "");
    const correction = head.replace(QUOTES, "");
    if (!quote || !correction || !line.includes("|") || norm(quote) === norm(correction)) return null;
    const note = line.slice(line.indexOf("|") + 1).trim();
    return note ? { quote, correction, note_es: note } : { quote, correction };
  }
  const quote = line.slice(0, arrow.index).replace(QUOTES, "");
  const rest = line.slice(arrow.index + arrow[0].length);
  const sep = rest.match(/\s+[|·]\s+|\s*\|\s*/);
  const correction = (sep?.index != null ? rest.slice(0, sep.index) : rest).replace(QUOTES, "");
  const note = sep?.index != null ? rest.slice(sep.index + sep[0].length).trim() : "";
  if (!quote || !correction || norm(quote) === norm(correction)) return null;
  return note ? { quote, correction, note_es: note } : { quote, correction };
}

/** Texto de la tarjeta de una corrección (el `why` lleva la regla). */
export function correctionText(e: EnglishError): string {
  return `${e.quote} → ${e.correction}`;
}

/**
 * Correcciones en vivo → `errors` de la sesión de inglés: deduplicadas por
 * la forma corregida (el mismo error dos veces es UNA entrada) y con tope.
 */
export function correctionsFromSuggestions(
  suggestions: LiveSuggestion[],
  max = 20,
): EnglishError[] {
  const out: EnglishError[] = [];
  const seen = new Set<string>();
  for (const s of suggestions) {
    if (s.kind !== "corregir") continue;
    const e = parseCorrection(s.why ? `${s.text} | ${s.why}` : s.text);
    if (!e) continue;
    const key = `${norm(e.quote)}→${norm(e.correction)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Nombres del transcript de una clase: tú = "Yo", el resto = "Profe" (salvo
 * que les hayas puesto nombre a mano). Sin selfSpeaker los nombres no se tocan.
 */
export function classSpeakerNames(
  segments: LiveSegment[],
  selfSpeaker: string | undefined,
  names: Record<string, string>,
): Record<string, string> {
  if (!selfSpeaker) return { ...names };
  const out: Record<string, string> = { ...names };
  for (const seg of segments) {
    if (seg.speaker === "UNKNOWN" || out[seg.speaker]?.trim()) continue;
    out[seg.speaker] = seg.speaker === selfSpeaker ? "Yo" : "Profe";
  }
  out[selfSpeaker] = "Yo";
  return out;
}

/** Métricas de speaking de la clase. undefined hasta saber quién eres tú. */
export function computeClassMetrics(
  segments: LiveSegment[],
  selfSpeaker: string | undefined,
  corrections: number,
): LiveClassMetrics | undefined {
  if (!selfSpeaker) return undefined;
  let selfMs = 0;
  let totalMs = 0;
  let selfWords = 0;
  let selfTurns = 0;
  let spanishTurns = 0;
  for (const seg of segments) {
    const text = seg.text.trim();
    if (!seg.final || !text) continue;
    const ms = Math.max(0, seg.endMs - seg.startMs);
    totalMs += ms;
    if (seg.speaker !== selfSpeaker) continue;
    selfMs += ms;
    const words = wordCount(text);
    selfWords += words;
    selfTurns += 1;
    if (words >= 3 && guessLang(text) === "es") spanishTurns += 1;
  }
  return {
    selfShare: totalMs > 0 ? Math.round((selfMs / totalMs) * 100) / 100 : 0,
    selfWords,
    selfTurns,
    spanishTurns,
    corrections,
    correctionsPer100: selfWords > 0 ? Math.round((corrections / selfWords) * 1000) / 10 : 0,
  };
}

/** Línea de cabecera del transcript guardado (la lee el reporte post-clase). */
export function classMetricsLine(m: LiveClassMetrics | undefined): string {
  if (!m) return "> Clase en vivo — sin marcar quién eras tú: sin métricas de speaking.";
  return `> Clase en vivo — tu habla: ${Math.round(m.selfShare * 100)} % del tiempo · ${m.selfWords} palabras en ${m.selfTurns} turnos · ${m.spanishTurns} turnos en español · ${m.corrections} correcciones (${m.correctionsPer100} por cada 100 palabras).`;
}

// ── "Soy yo" automático ────────────────────────────────────────────────
// En remoto el browser tiene las dos fuentes por separado ANTES de mezclarlas:
// el mic (con cancelación de eco: no oye a la profe por los parlantes) y la
// pestaña de Meet (que no te devuelve tu propia voz). La voz cuyos turnos
// coinciden con energía del mic eres tú.

/** Energía de un frame de ~100 ms, en el reloj del audio ENVIADO al STT. */
export interface SourceEnergy {
  ms: number;
  mic: number;
  tab: number;
}

const MIN_TURN_MS = 600;
const MIN_LEVEL = 0.004;
const DOMINANCE = 2;

/**
 * Hablante que eres tú según la energía por fuente, o undefined si aún no es
 * claro. Exige ≥2 turnos con el mic dominante, mayoría 3:1 sobre los turnos
 * donde dominó la pestaña, y UN solo candidato (con dos, no se adivina).
 */
export function inferSelfSpeaker(
  segments: LiveSegment[],
  frames: SourceEnergy[],
): string | undefined {
  if (frames.length === 0) return undefined;
  const votes = new Map<string, { mic: number; tab: number }>();
  for (const seg of segments) {
    if (!seg.final || seg.speaker === "UNKNOWN" || seg.endMs - seg.startMs < MIN_TURN_MS) continue;
    let mic = 0;
    let tab = 0;
    let n = 0;
    for (const f of frames) {
      if (f.ms < seg.startMs || f.ms > seg.endMs) continue;
      mic += f.mic;
      tab += f.tab;
      n += 1;
    }
    if (n === 0) continue;
    mic /= n;
    tab /= n;
    const v = votes.get(seg.speaker) ?? { mic: 0, tab: 0 };
    if (mic > MIN_LEVEL && mic > tab * DOMINANCE) v.mic += 1;
    else if (tab > MIN_LEVEL && tab > mic * DOMINANCE) v.tab += 1;
    votes.set(seg.speaker, v);
  }
  const candidates = [...votes.entries()].filter(([, v]) => v.mic >= 2 && v.mic >= v.tab * 3);
  return candidates.length === 1 ? candidates[0][0] : undefined;
}
