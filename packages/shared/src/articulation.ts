/**
 * Articulación: cómo SUENA lo que dices, aparte de qué dices. Lógica pura que
 * comparten el agente (prompts del copiloto, métricas del coach, compuerta del
 * motor "Dilo más claro") y el dashboard (etiquetas).
 *
 * Los principios vienen de la idea "la articulación se entrena como un
 * músculo": no hace falta tener mejores ideas, hace falta sonar como alguien
 * que cree en las que tiene. En la práctica eso son cinco hábitos que se oyen
 * en el transcript:
 *
 * 1. El punto primero — conclusión, luego el porqué (nada de calentar motores).
 * 2. Sin pedir permiso ni disculparse por hablar ("solo quería…", "perdón por
 *    quitarles tiempo", "I just wanted to…").
 * 3. Sin "pero" que borre lo anterior ("entiendo perfectamente, pero…" anula
 *    la primera mitad: se dice "entiendo X, y por eso propongo Y").
 * 4. Sin certeza de relleno ("obviamente, como pueden ver…"): si es obvio no
 *    hace falta decirlo; si no lo es, suena a que se esconde algo.
 * 5. Convicción: verbo firme en vez de "creo que tal vez podríamos".
 *
 * El detector es una heurística por regex, como las muletillas del coach:
 * cuenta señales reales del transcript (regla de oro: nada inventado) y decide
 * qué intervenciones vale la pena mandar a reescribir. El juicio fino lo hace
 * el modelo.
 */

export type WeakKind = "permiso" | "disculpa" | "borra" | "relleno" | "duda";

export interface WeakHit {
  kind: WeakKind;
  /** El fragmento tal cual apareció. */
  match: string;
  lang: "es" | "en";
}

/** Nombre corto y el porqué de cada señal (UI y prompts). */
export const WEAK_KINDS: Record<WeakKind, { label: string; why: string }> = {
  permiso: {
    label: "Pide permiso",
    why: "Anunciar que vas a hablar gasta la atención antes del punto.",
  },
  disculpa: {
    label: "Se disculpa",
    why: "Disculparte por hablar le dice al resto que tu turno vale menos.",
  },
  borra: {
    label: "«Pero» que borra",
    why: "Todo lo que va antes del «pero» deja de existir para quien escucha.",
  },
  relleno: {
    label: "Certeza de relleno",
    why: "«Obviamente», «como pueden ver»: si es obvio sobra; si no, suena a esconder algo.",
  },
  duda: {
    label: "Suena a duda",
    why: "«Creo que tal vez» le quita fuerza a una idea que sí defiendes.",
  },
};

// Cada patrón es una frase completa (\b a los lados) para no contar substrings.
// Se prefieren falsos negativos: una señal mal contada en el coach es peor que
// una que se escapa.
const PATTERNS: { kind: WeakKind; lang: "es" | "en"; re: RegExp }[] = [
  // ── Español ──
  {
    kind: "permiso",
    lang: "es",
    re: /\b(solo quer[ií]a (?:decir|comentar|preguntar|mencionar|agregar|aclarar)|quer[ií]a (?:comentar|mencionar|aclarar) (?:algo|una cosa|r[aá]pidamente)|una pregunta r[aá]pida|puedo (?:decir|agregar|comentar) algo|si me permiten)\b/giu,
  },
  {
    kind: "disculpa",
    lang: "es",
    re: /\b(perd[oó]n (?:por|que|si)|disculp(?:en|a|ame|enme) (?:por|que|si|la)|siento (?:quitarles|robarles|interrumpir)|lamento (?:quitarles|interrumpir))\b/giu,
  },
  {
    kind: "borra",
    lang: "es",
    re: /\b(entiendo (?:perfectamente|totalmente|completamente|tu punto|su punto|lo que dices)[^.?!]{0,60}?,? pero|no es por nada,? pero|con todo respeto,? pero|s[ií],? pero)\b/giu,
  },
  {
    kind: "relleno",
    lang: "es",
    re: /\b(obviamente|como (?:pueden|puedes) ver|como ya (?:saben|sabes)|claramente|evidentemente)\b/giu,
  },
  {
    kind: "duda",
    lang: "es",
    re: /\b(creo que (?:tal vez|quiz[aá]s?|a lo mejor)|no s[eé] si|a lo mejor (?:podr[ií]amos|deber[ií]amos)|tal vez (?:podr[ií]amos|deber[ií]amos)|como que (?:podr[ií]amos|deber[ií]amos)|ser[ií]a bueno de pronto|de pronto (?:podr[ií]amos|ser[ií]a))\b/giu,
  },
  // ── Inglés ──
  {
    kind: "permiso",
    lang: "en",
    re: /\b(i just wanted to(?: say| mention| ask| add| check| flag)?|quick question|can i just(?: say| add)?|if i may|i was just wondering)\b/gi,
  },
  {
    kind: "disculpa",
    lang: "en",
    re: /\b(sorry (?:to|for|if)|i apologi[sz]e (?:for|if)|apologies (?:for|if))\b/gi,
  },
  {
    kind: "borra",
    lang: "en",
    re: /\b(i (?:totally|completely|fully) understand[^.?!]{0,60}?,? but|i hear you,? but|with all due respect,? but|no offen[cs]e,? but|yes,? but)\b/gi,
  },
  {
    kind: "relleno",
    lang: "en",
    re: /\b(obviously|as you can see|as you all know|clearly)\b/gi,
  },
  {
    kind: "duda",
    lang: "en",
    re: /\b(i think maybe|i guess(?: we| i)?|i'm not sure (?:if|whether)|maybe we could|we could maybe|kind of (?:think|feel)|sort of (?:think|feel)|it might be good to)\b/gi,
  },
];

/** Señales de articulación débil en un texto, en orden de aparición. */
export function detectWeakPhrases(text: string, lang?: "es" | "en"): WeakHit[] {
  const hits: (WeakHit & { at: number })[] = [];
  for (const p of PATTERNS) {
    if (lang && p.lang !== lang) continue;
    p.re.lastIndex = 0;
    for (const m of text.matchAll(p.re)) hits.push({ kind: p.kind, match: m[0], lang: p.lang, at: m.index ?? 0 });
  }
  return hits.sort((a, b) => a.at - b.at).map(({ at: _at, ...h }) => h);
}

/** Intervenciones más largas que esto suelen enterrar el punto (vale la pena revisarlas). */
export const RAMBLE_MIN_WORDS = 45;
/** Menos palabras que esto no amerita reescribirse ("sí, de acuerdo"). */
export const REWRITE_MIN_WORDS = 8;

/**
 * ¿Vale la pena mandar esta intervención al motor "Dilo más claro"? Si trae
 * una señal débil o es larga (el punto suele quedar enterrado al final). Lo
 * corto y limpio no gasta una llamada.
 */
export function rewriteWorthy(text: string): boolean {
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  if (words < REWRITE_MIN_WORDS) return false;
  return words >= RAMBLE_MIN_WORDS || detectWeakPhrases(text).length > 0;
}

/**
 * Reglas para TODO texto que Hermes sugiere decir en voz alta (junta, equipo,
 * estratégico, frase de la clase). Van en el system prompt: la sugerencia ya
 * nace articulada, y de paso es el ejemplo que el dueño repite.
 */
export function articulationRules(owner: string): string {
  return `## Cómo suena lo que sugieres (articulación)
Lo que sugieres es lo que ${owner} va a decir en voz alta: tiene que sonar a alguien que cree en su idea.
- El punto primero: la conclusión o la postura en la PRIMERA frase; el porqué después.
- Cero arranques que piden permiso o se disculpan ("solo quería…", "perdón por…", "I just wanted to…", "sorry to…").
- Sin "pero" que borre lo anterior: "entiendo X, y por eso propongo Y" (en inglés: "I hear you, and…").
- Sin certeza de relleno ("obviamente", "como pueden ver", "obviously", "as you can see").
- Verbo firme: "propongo", "recomiendo", "hagamos", "I'd go with" — no "creo que tal vez podríamos". La honestidad sobre lo que no sabes va directa ("no lo he medido; lo mido hoy"), no envuelta en dudas.
- Concreto y memorable: un número, un nombre o un ejemplo vale más que un adjetivo. Frases cortas que se puedan decir de un aliento.`;
}

/** Prefijo de la regla cuando una corrección de la clase es de articulación, no de gramática. */
export const ARTICULATION_RULE_PREFIX = "Directo:";
