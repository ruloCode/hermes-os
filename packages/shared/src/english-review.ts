/**
 * Repaso diario de inglés (v6, openspec/changes/v6-nucleo/specs/ingles).
 *
 * Cada error REAL anotado en una sesión (dijo → mejor | regla) se vuelve una
 * tarjeta; las tarjetas vuelven por cajas de Leitner (1, 3, 7, 16 y 35 días).
 * Sin modelo en el camino: todo aquí es puro, determinista y con el reloj
 * inyectado (`today` = AAAA-MM-DD de Bogotá, `now` = ISO), para que la web,
 * el agente y el teléfono (que lo porta a Kotlin) den lo mismo.
 */
import { patternHits, PLAN_UNITS, type PlanPattern } from "./english-plan.js";

// ── Tipos ──────────────────────────────────────────────────────────────

export interface ReviewErrorInput {
  quote: string;
  correction: string;
  note_es?: string;
}

/** Lo mínimo de una sesión que necesita el repaso (EnglishSession lo cumple). */
export interface ReviewSessionLike {
  id: number;
  started_at: string;
  source: string;
  errors: ReviewErrorInput[];
}

export interface ReviewCard {
  /** Huella estable del par (dijo, mejor) normalizado. */
  id: string;
  said: string;
  /** La versión correcta principal (la primera si la nota traía alternativas). */
  better: string;
  /** Otras formas correctas que dio el corrector ("…, or …", "… / …"). */
  accept: string[];
  rule?: string;
  pattern?: PlanPattern;
  /** En cuántas apariciones (sesiones distintas o repetidas) salió este error. */
  seen: number;
  /** Día de Bogotá (AAAA-MM-DD) de la primera y la última aparición. */
  firstSeen: string;
  lastSeen: string;
  /** ISO de la última aparición: decide si un error dominado "reaparece". */
  lastSeenAt: string;
  /** La aparición más reciente. */
  source: { sessionId: number; date: string; kind: "class" | "practice" };
}

export type DiscardReason = "sin-correccion" | "igual" | "largo" | "articulacion" | "stt" | "confuso";

export type ReviewKind = "type" | "choose";

/** Una tarjeta dentro del set de un día (se congela al armarlo). */
export interface ReviewDayItem {
  id: string;
  kind: ReviewKind;
  /** Solo en `choose`: textos en el orden en que se muestran. */
  options?: string[];
}

export interface ReviewDay {
  items: ReviewDayItem[];
  /** cardId → acertó. Una respuesta por tarjeta y día. */
  results: Record<string, boolean>;
  /** ISO del momento en que se completó (marca el hábito una sola vez). */
  completedAt?: string;
}

export interface ReviewCardState {
  /** Índice de caja 0..4 → 1, 3, 7, 16, 35 días. */
  box: number;
  /** Día en que vuelve (AAAA-MM-DD). */
  due: string;
  /** ISO en que quedó dominada (acierto en la caja de 35 días). */
  masteredAt?: string;
  lastAnsweredAt?: string;
  right: number;
  wrong: number;
}

export interface ReviewState {
  version: 1;
  cards: Record<string, ReviewCardState>;
  days: Record<string, ReviewDay>;
}

export interface ReviewAnswerRecord {
  clientId: string;
  cardId: string;
  day: string;
  kind: ReviewKind;
  answer: string;
  correct: boolean;
  answeredAt: string;
  receivedAt: string;
}

// ── Constantes ─────────────────────────────────────────────────────────

export const REVIEW_BOX_DAYS = [1, 3, 7, 16, 35] as const;
export const REVIEW_DAILY_MAX = 8;
/** Límites de una tarjeta legible (como el quiz del plan). */
const SAID_MAX = 90;
const BETTER_MAX = 110;
/** Escribir una frase más larga que esto en el teléfono es castigo, no repaso. */
const TYPE_MAX_CHARS = 80;
const TYPE_MAX_WORDS = 14;

export function emptyReviewState(): ReviewState {
  return { version: 1, cards: {}, days: {} };
}

// ── Utilidades ─────────────────────────────────────────────────────────

function fnv(s: string, seed = 2166136261): number {
  let h = seed;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function shiftDay(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Bogotá es UTC−5 todo el año (sin horario de verano). */
export function bogotaDay(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso.slice(0, 10);
  return new Date(t - 5 * 3600_000).toISOString().slice(0, 10);
}

const stripAccents = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Recorta arranques cortados y muletillas iniciales del transcript (como el quiz del plan). */
function tidy(s: string): string {
  return s
    .replace(/^.*[—–]\s+/, "")
    .replace(/(^|\s)[\w']+-(?=\s)/g, "$1")
    .replace(/\s+/g, " ")
    .replace(/^((yeah|uh|um|so|well|of course)[,.]?\s+)+/i, "")
    // Tartamudeo: "retrace, retrace my point" → "retrace my point".
    .replace(/\b([A-Za-z']+(?:\s+[A-Za-z']+){0,2}),?\s+\1\b/gi, "$1")
    .replace(/^["“”'‘’]+|["“”'‘’]+$/g, "")
    .trim();
}

// ── Comparación tolerante (escribir la frase) ──────────────────────────

const PRONOUN_IS = "he|she|it|that|there|here|what|who|where|how|this";
const CONTRACTIONS: [RegExp, string][] = [
  [/\bcan't\b/g, "can not"],
  [/\bcannot\b/g, "can not"],
  [/\bwon't\b/g, "will not"],
  [/\bshan't\b/g, "shall not"],
  [/\bain't\b/g, "is not"],
  [/\blet's\b/g, "let us"],
  [/\b([a-z]+)n't\b/g, "$1 not"],
  [/\b([a-z]+)'m\b/g, "$1 am"],
  [/\b([a-z]+)'re\b/g, "$1 are"],
  [/\b([a-z]+)'ve\b/g, "$1 have"],
  [/\b([a-z]+)'ll\b/g, "$1 will"],
  [/\b([a-z]+)'d\b/g, "$1 would"],
  [new RegExp(`\\b(${PRONOUN_IS})'s\\b`, "g"), "$1 is"],
];

/**
 * Forma canónica para comparar lo escrito: minúsculas, sin tildes, comillas y
 * apóstrofos tipográficos unificados, contracciones expandidas, sin puntuación
 * y con un solo espacio. Las palabras quedan intactas: «he go» ≠ «he goes».
 */
export function canonicalEnglish(s: string): string {
  let t = stripAccents(s.normalize("NFKC").toLowerCase())
    .replace(/[’‘`´ʼ]/g, "'")
    .replace(/[“”«»]/g, '"');
  for (const [re, rep] of CONTRACTIONS) t = t.replace(re, rep);
  return t
    .replace(/[-–—/]/g, " ")
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/(^|\s)'+|'+(?=\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** ¿Lo escrito es la frase correcta? Perdona forma (mayúsculas, puntuación, contracciones), nunca gramática. */
export function checkTyped(answer: string, better: string, accept: string[] = []): boolean {
  const got = canonicalEnglish(answer);
  if (!got) return false;
  return [better, ...accept].some((b) => canonicalEnglish(b) === got);
}

/** Igualdad "de contenido" para deduplicar y descartar (sin espacios ni signos). */
const bare = (s: string) => canonicalEnglish(s).replace(/[^a-z0-9]+/g, "");

// ── Errores → tarjetas ─────────────────────────────────────────────────

/** Divide "a, or b" / "a / b" / "a o b" en alternativas; descarta las que son un pedazo. */
function splitAlternatives(correction: string): string[] {
  const parts = correction
    .split(/\s*,\s+or\s+|\s+\/\s+|\s+o\s+/)
    .map(tidy)
    .filter(Boolean);
  if (parts.length <= 1) return parts;
  const words = (s: string) => s.split(/\s+/).length;
  const first = words(parts[0]);
  return [parts[0], ...parts.slice(1).filter((p) => words(p) >= Math.ceil(first * 0.6))];
}

/** Por qué un error anotado NO sirve de tarjeta (null = sirve). */
export function discardReason(e: ReviewErrorInput): DiscardReason | null {
  const quote = typeof e.quote === "string" ? e.quote : "";
  const correction = typeof e.correction === "string" ? e.correction : "";
  const note = stripAccents((e.note_es ?? "").toLowerCase()).trim();
  if (!correction.trim()) return "sin-correccion";
  if (/\bstt\b|transcripci/.test(note)) return "stt";
  // La regla «Directo: …» del corrector es de ARTICULACIÓN (sonar firme), no un error de inglés;
  // lo mismo las repeticiones y vacilaciones: el inglés estaba bien, sobraban palabras.
  if (/^directo\b/.test(note)) return "articulacion";
  if (/repeti|repite|redundan|vacila/.test(note) && patternHits(e).length === 0) return "articulacion";
  if (/reconstru|frase cortada/.test(note) || /→|\|/.test(correction)) return "confuso";
  const said = tidy(quote);
  const alts = splitAlternatives(correction);
  if (!alts.length || !said) return "sin-correccion";
  if (said.length > SAID_MAX || alts[0].length > BETTER_MAX || said.length < 3) return "largo";
  const bs = bare(said);
  if (alts.some((a) => bare(a) === bs)) return "igual";
  // Lo dicho YA trae la versión correcta y le sobra mucho alrededor: el corrector
  // recortó un pedazo, no corrigió nada ("…where users couldn't add" → "users couldn't add").
  // Una palabra de más sí es el error ("it's breakfast is" → "breakfast is").
  const ws = words(said).join(" ");
  const wb = words(alts[0]).join(" ");
  if (` ${ws} `.includes(` ${wb} `) && words(said).length - words(alts[0]).length >= 3) return "igual";
  // El corte del transcript dejó un resto sin sentido ("I will— how can I say— agree" → "agree").
  if (words(said).length < words(alts[0]).length * 0.4) return "confuso";
  return null;
}

export function cardId(said: string, better: string): string {
  const key = `${bare(said)}→${bare(better)}`;
  return `c${fnv(key).toString(36)}${fnv(key, 0x811c9dc5 ^ 0x5bd1e995).toString(36)}`;
}

export interface CardsFromErrorsResult {
  cards: ReviewCard[];
  discarded: { reason: DiscardReason; quote: string; correction: string; sessionId: number }[];
}

/**
 * Una tarjeta por error DISTINTO. El mismo par (normalizado) en dos sesiones
 * es una tarjeta con `seen: 2`; se queda con la regla y la fuente más recientes.
 */
export function cardsFromErrors(sessions: ReviewSessionLike[]): CardsFromErrorsResult {
  const byId = new Map<string, ReviewCard>();
  const discarded: CardsFromErrorsResult["discarded"] = [];
  const sorted = [...sessions].sort((a, b) => a.started_at.localeCompare(b.started_at));
  for (const s of sorted) {
    for (const e of Array.isArray(s.errors) ? s.errors : []) {
      if (!e || typeof e !== "object") continue;
      const reason = discardReason(e);
      if (reason) {
        discarded.push({ reason, quote: String(e.quote ?? ""), correction: String(e.correction ?? ""), sessionId: s.id });
        continue;
      }
      const said = tidy(e.quote);
      const [better, ...accept] = splitAlternatives(e.correction);
      const id = cardId(said, better);
      const day = bogotaDay(s.started_at);
      const source = { sessionId: s.id, date: day, kind: s.source === "class" ? ("class" as const) : ("practice" as const) };
      const rule = e.note_es?.trim() || undefined;
      const pattern = patternHits(e)[0];
      const prev = byId.get(id);
      if (prev) {
        prev.seen++;
        prev.lastSeen = day;
        prev.lastSeenAt = s.started_at;
        prev.source = source;
        if (rule) prev.rule = rule;
        if (!prev.pattern && pattern) prev.pattern = pattern;
        for (const a of accept) if (!prev.accept.some((x) => bare(x) === bare(a))) prev.accept.push(a);
      } else {
        byId.set(id, {
          id,
          said,
          better,
          accept,
          rule,
          pattern,
          seen: 1,
          firstSeen: day,
          lastSeen: day,
          lastSeenAt: s.started_at,
          source,
        });
      }
    }
  }
  return { cards: [...byId.values()], discarded };
}

// ── Leitner ────────────────────────────────────────────────────────────

/**
 * El estado que vale HOY para una tarjeta. Si el mismo error reapareció en una
 * sesión posterior a la última respuesta (o a dominarla), vuelve a la primera
 * caja y toca desde el día en que reapareció. Sin estado = nueva.
 */
export function effectiveCardState(card: ReviewCard, entry: ReviewCardState | undefined): ReviewCardState | null {
  if (!entry) return null;
  const since = entry.masteredAt ?? entry.lastAnsweredAt;
  if (since && card.lastSeenAt > since) {
    return { box: 0, due: card.lastSeen, right: entry.right, wrong: entry.wrong, lastAnsweredAt: entry.lastAnsweredAt };
  }
  return entry;
}

/** Siguiente estado tras responder. `answeredDay` = día de Bogotá de la respuesta. */
export function leitnerNext(
  current: ReviewCardState | null,
  correct: boolean,
  answeredDay: string,
  answeredAt: string,
): ReviewCardState {
  const box = current?.box ?? 0;
  const right = (current?.right ?? 0) + (correct ? 1 : 0);
  const wrong = (current?.wrong ?? 0) + (correct ? 0 : 1);
  if (!correct) return { box: 0, due: shiftDay(answeredDay, REVIEW_BOX_DAYS[0]), lastAnsweredAt: answeredAt, right, wrong };
  if (box >= REVIEW_BOX_DAYS.length - 1)
    return { box, due: shiftDay(answeredDay, REVIEW_BOX_DAYS[box]), masteredAt: answeredAt, lastAnsweredAt: answeredAt, right, wrong };
  const nb = box + 1;
  return { box: nb, due: shiftDay(answeredDay, REVIEW_BOX_DAYS[nb]), lastAnsweredAt: answeredAt, right, wrong };
}

// ── El set del día ─────────────────────────────────────────────────────

export function reviewKindFor(card: Pick<ReviewCard, "id" | "better">, day: string): ReviewKind {
  const long = card.better.length > TYPE_MAX_CHARS || card.better.split(/\s+/).length > TYPE_MAX_WORDS;
  if (long) return "choose";
  return fnv(`${card.id}|${day}|kind`) % 2 === 0 ? "type" : "choose";
}

const words = (s: string) => s.toLowerCase().match(/[a-z0-9']+/g) ?? [];
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** La diferencia de UNA palabra entre lo dicho y lo correcto (cambiar o faltar), si la hay. */
function oneWordDiff(said: string, better: string): { right: string; wrong: string | null } | null {
  const ts = words(said);
  const tb = words(better);
  if (ts.length === tb.length) {
    const diff = ts.map((w, i) => (w === tb[i] ? -1 : i)).filter((i) => i >= 0);
    return diff.length === 1 ? { right: tb[diff[0]], wrong: ts[diff[0]] } : null;
  }
  if (tb.length === ts.length + 1) {
    let i = 0;
    while (i < ts.length && ts[i] === tb[i]) i++;
    const rest = [...tb.slice(0, i), ...tb.slice(i + 1)];
    return rest.join(" ") === ts.join(" ") ? { right: tb[i], wrong: null } : null;
  }
  return null;
}

/**
 * Distractor honesto: el MISMO tipo de error que cometiste en otra tarjeta del
 * mismo patrón, aplicado a esta frase ("rely for/on" → "information for the
 * internet"). Si ninguno aplica limpio, no hay distractor (se dan dos opciones).
 */
export function distractorFor(card: ReviewCard, all: ReviewCard[]): string | null {
  if (!card.pattern) return null;
  const others = all.filter((o) => o.id !== card.id && o.pattern === card.pattern).sort((a, b) => a.id.localeCompare(b.id));
  const taken = new Set([card.said, card.better, ...card.accept].map(bare));
  for (const o of others) {
    const d = oneWordDiff(o.said, o.better);
    if (!d) continue;
    const re = new RegExp(`(^|[^A-Za-z0-9'])(${escapeRe(d.right)})(?=$|[^A-Za-z0-9'])`, "i");
    const m = card.better.match(re);
    if (!m || m.index == null) continue;
    const start = m.index + m[1].length;
    const end = start + m[2].length;
    let out: string;
    if (d.wrong) {
      const w = /^[A-Z]/.test(m[2]) ? d.wrong[0].toUpperCase() + d.wrong.slice(1) : d.wrong;
      out = card.better.slice(0, start) + w + card.better.slice(end);
    } else {
      out = (card.better.slice(0, start) + card.better.slice(end)).replace(/\s{2,}/g, " ").trim();
    }
    if (!out || taken.has(bare(out))) continue;
    return out;
  }
  return null;
}

function seededShuffle<T>(arr: T[], seed: number): T[] {
  const out = [...arr];
  let x = seed || 1;
  for (let i = out.length - 1; i > 0; i--) {
    x = Math.imul(x ^ (x >>> 15), 2246822507) ^ Math.imul(x ^ (x >>> 13), 3266489909);
    x >>>= 0;
    const j = x % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Opciones de una tarjeta de elegir: lo dicho, la correcta y quizá un distractor; orden por tarjeta y día. */
export function chooseOptions(card: ReviewCard, all: ReviewCard[], day: string): string[] {
  const d = distractorFor(card, all);
  const base = d ? [card.said, card.better, d] : [card.said, card.better];
  return seededShuffle(base, fnv(`${card.id}|${day}|opts`));
}

/** Cuántas tarjetas tiene cada patrón: los que más se repiten van primero entre las nuevas. */
function patternWeight(cards: ReviewCard[]): Map<string, number> {
  const w = new Map<string, number>();
  for (const c of cards) if (c.pattern) w.set(c.pattern, (w.get(c.pattern) ?? 0) + c.seen);
  return w;
}

/**
 * Arma el set de hoy desde cero: primero las vencidas (más atrasadas primero),
 * luego nuevas (patrón más repetido, error más reciente), hasta 8.
 */
export function buildDaySet(cards: ReviewCard[], state: ReviewState, today: string, max = REVIEW_DAILY_MAX): ReviewDayItem[] {
  const due: { c: ReviewCard; due: string }[] = [];
  const fresh: ReviewCard[] = [];
  for (const c of cards) {
    const st = effectiveCardState(c, state.cards[c.id]);
    if (!st) fresh.push(c);
    else if (!st.masteredAt && st.due <= today) due.push({ c, due: st.due });
  }
  due.sort((a, b) => a.due.localeCompare(b.due) || a.c.id.localeCompare(b.c.id));
  // Nuevas: por turnos entre patrones, del que más se repite al que menos (sin
  // patrón al final), y dentro de cada uno la más reciente. Ocho de la misma
  // regla seguidas se resuelven por inercia; intercaladas obligan a pensar.
  const weight = patternWeight(cards);
  const groups = new Map<string, ReviewCard[]>();
  for (const c of fresh) {
    const k = c.pattern ?? "";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(c);
  }
  const order = [...groups.keys()].sort(
    (a, b) => Number(a === "") - Number(b === "") || (weight.get(b) ?? 0) - (weight.get(a) ?? 0) || a.localeCompare(b),
  );
  for (const k of order) groups.get(k)!.sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt) || a.id.localeCompare(b.id));
  const freshOrdered: ReviewCard[] = [];
  for (let round = 0; freshOrdered.length < fresh.length; round++)
    for (const k of order) {
      const c = groups.get(k)![round];
      if (c) freshOrdered.push(c);
    }
  const picked = [...due.map((d) => d.c), ...freshOrdered].slice(0, max);
  return picked.map((c) => {
    const kind = reviewKindFor(c, today);
    return kind === "choose" ? { id: c.id, kind, options: chooseOptions(c, cards, today) } : { id: c.id, kind };
  });
}

/**
 * El repaso de hoy. Si ya se armó (está en el estado), es ESE: responder 3 y
 * volver deja las otras 5, no otro set. `fresh` = hay que guardarlo.
 */
export function todayReview(
  cards: ReviewCard[],
  state: ReviewState,
  today: string,
): { day: string; items: ReviewDayItem[]; fresh: boolean } {
  const saved = state.days[today];
  if (saved) {
    const ids = new Set(cards.map((c) => c.id));
    return { day: today, items: saved.items.filter((i) => ids.has(i.id)), fresh: false };
  }
  return { day: today, items: buildDaySet(cards, state, today), fresh: true };
}

/** Guarda el set de un día en el estado (si no estaba). */
export function withDaySet(state: ReviewState, day: string, items: ReviewDayItem[]): ReviewState {
  if (state.days[day] || !items.length) return state;
  return { ...state, days: { ...state.days, [day]: { items, results: {} } } };
}

export type ApplyAnswerResult =
  | { ok: true; state: ReviewState; correct: boolean; already: boolean; completedNow: boolean }
  | { ok: false; error: string };

/**
 * Registra la respuesta de una tarjeta del set de `day`. Una sola por tarjeta y
 * día: la segunda devuelve la primera (`already`). La caja se mueve con el día
 * de la respuesta (una respuesta en cola de ayer cuenta desde ayer).
 */
export function applyAnswer(
  state: ReviewState,
  card: ReviewCard,
  input: { day: string; correct: boolean; answeredAt: string },
): ApplyAnswerResult {
  const dayState = state.days[input.day];
  if (!dayState || !dayState.items.some((i) => i.id === card.id))
    return { ok: false, error: "Esa tarjeta no está en el repaso de ese día." };
  if (card.id in dayState.results)
    return { ok: true, state, correct: dayState.results[card.id], already: true, completedNow: false };
  const answeredDay = bogotaDay(input.answeredAt);
  const next = leitnerNext(effectiveCardState(card, state.cards[card.id]), input.correct, answeredDay, input.answeredAt);
  const results = { ...dayState.results, [card.id]: input.correct };
  const complete = dayState.items.every((i) => i.id in results);
  const completedNow = complete && !dayState.completedAt;
  return {
    ok: true,
    correct: input.correct,
    already: false,
    completedNow,
    state: {
      ...state,
      cards: { ...state.cards, [card.id]: next },
      days: {
        ...state.days,
        [input.day]: { ...dayState, results, ...(completedNow ? { completedAt: input.answeredAt } : {}) },
      },
    },
  };
}

/** Días seguidos con el repaso COMPLETO, desde hoy (o desde ayer si hoy aún no se hace). */
export function reviewStreak(state: ReviewState, today: string): number {
  const done = (d: string) => Boolean(state.days[d]?.completedAt);
  let d = done(today) ? today : shiftDay(today, -1);
  let n = 0;
  while (done(d)) {
    n++;
    d = shiftDay(d, -1);
  }
  return n;
}

// ── Lo que ven la web y el teléfono ────────────────────────────────────

export interface ReviewReveal {
  said: string;
  better: string;
  accept: string[];
  rule: string | null;
  source: { sessionId: number; date: string; kind: "class" | "practice"; label: string };
}

export interface ReviewCardView {
  id: string;
  kind: ReviewKind;
  /** Solo en `type`: lo que dijiste (la frase a corregir). */
  said?: string;
  /** Solo en `choose`: las opciones, sin decir cuál es cuál. */
  options?: string[];
  pattern: PlanPattern | null;
  patternTitle: string | null;
  seen: number;
  /** null = sin responder hoy. */
  answered: { correct: boolean } | null;
  /**
   * La solución, en base64 de un JSON UTF-8 (`ReviewReveal`): está para que el
   * teléfono corrija sin conexión, pero codificada para que ninguna interfaz la
   * pinte por accidente. Decodificar SOLO después de responder.
   */
  reveal: string;
}

export interface ReviewPayload {
  day: string;
  cards: ReviewCardView[];
  /** Respondidas hoy / del set de hoy. */
  done: number;
  correct: number;
  total: number;
  complete: boolean;
  streak: number;
  mastered: number;
  totalCards: number;
  /** Tarjetas que vuelven mañana (fallos de hoy y las que vencen mañana). */
  dueTomorrow: number;
  /** Sin repaso hoy: el próximo día con tarjetas (null = no hay ninguna programada). */
  nextDue: string | null;
  byBox: number[];
}

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
export function reviewSourceLabel(source: ReviewCard["source"]): string {
  const [, m, d] = source.date.split("-").map(Number);
  return `${source.kind === "class" ? "Clase" : "Práctica"} · ${d} ${MONTHS[(m ?? 1) - 1]}`;
}

export function patternTitle(p: PlanPattern | null | undefined): string | null {
  return p ? (PLAN_UNITS.find((u) => u.key === p)?.title ?? null) : null;
}

function toBase64Utf8(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function fromBase64Utf8(b64: string): string {
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function revealOf(card: ReviewCard): ReviewReveal {
  return {
    said: card.said,
    better: card.better,
    accept: card.accept,
    rule: card.rule ?? null,
    source: { ...card.source, label: reviewSourceLabel(card.source) },
  };
}

export function decodeReveal(b64: string): ReviewReveal {
  return JSON.parse(fromBase64Utf8(b64)) as ReviewReveal;
}

/** El estado del repaso de `today` tal como lo consumen la web y el teléfono. */
export function reviewPayload(cards: ReviewCard[], state: ReviewState, today: string): ReviewPayload {
  const { items } = todayReview(cards, state, today);
  const byId = new Map(cards.map((c) => [c.id, c]));
  const results = state.days[today]?.results ?? {};
  const views: ReviewCardView[] = [];
  for (const it of items) {
    const c = byId.get(it.id);
    if (!c) continue;
    views.push({
      id: c.id,
      kind: it.kind,
      ...(it.kind === "type" ? { said: c.said } : { options: it.options ?? [c.said, c.better] }),
      pattern: c.pattern ?? null,
      patternTitle: patternTitle(c.pattern),
      seen: c.seen,
      answered: c.id in results ? { correct: results[c.id] } : null,
      reveal: toBase64Utf8(JSON.stringify(revealOf(c))),
    });
  }
  const done = views.filter((v) => v.answered).length;
  const tomorrow = shiftDay(today, 1);
  let mastered = 0;
  let dueTomorrow = 0;
  let nextDue: string | null = null;
  const byBox = REVIEW_BOX_DAYS.map(() => 0);
  for (const c of cards) {
    const st = effectiveCardState(c, state.cards[c.id]);
    if (!st) continue;
    if (st.masteredAt) {
      mastered++;
      continue;
    }
    byBox[st.box]++;
    if (st.due === tomorrow) dueTomorrow++;
    if (st.due > today && (!nextDue || st.due < nextDue)) nextDue = st.due;
  }
  return {
    day: today,
    cards: views,
    done,
    correct: views.filter((v) => v.answered?.correct).length,
    total: views.length,
    complete: views.length > 0 && done === views.length,
    streak: reviewStreak(state, today),
    mastered,
    totalCards: cards.length,
    dueTomorrow,
    nextDue,
    byBox,
  };
}

export interface ReviewPatternStat {
  pattern: PlanPattern | null;
  title: string | null;
  cards: number;
  mastered: number;
  /** Respuestas de los últimos 14 días (incluido hoy). */
  answered14: number;
  /** 0..1, null sin respuestas en la ventana. */
  accuracy14: number | null;
}

/** Por patrón: tarjetas, dominadas y tasa de acierto de 14 días. */
export function reviewPatternStats(
  cards: ReviewCard[],
  state: ReviewState,
  answers: Pick<ReviewAnswerRecord, "cardId" | "correct" | "answeredAt">[],
  today: string,
): ReviewPatternStat[] {
  const from = shiftDay(today, -13);
  const patternOf = new Map(cards.map((c) => [c.id, c.pattern ?? null]));
  const rows = new Map<string, ReviewPatternStat>();
  const row = (p: PlanPattern | null) => {
    const k = p ?? "";
    let r = rows.get(k);
    if (!r) rows.set(k, (r = { pattern: p, title: patternTitle(p), cards: 0, mastered: 0, answered14: 0, accuracy14: null }));
    return r;
  };
  const right = new Map<string, number>();
  for (const c of cards) {
    const r = row(c.pattern ?? null);
    r.cards++;
    if (effectiveCardState(c, state.cards[c.id])?.masteredAt) r.mastered++;
  }
  for (const a of answers) {
    const d = bogotaDay(a.answeredAt);
    if (d < from || d > today || !patternOf.has(a.cardId)) continue;
    const p = patternOf.get(a.cardId) ?? null;
    const r = row(p);
    r.answered14++;
    if (a.correct) right.set(p ?? "", (right.get(p ?? "") ?? 0) + 1);
  }
  for (const [k, r] of rows) r.accuracy14 = r.answered14 ? (right.get(k) ?? 0) / r.answered14 : null;
  return [...rows.values()].sort((a, b) => b.cards - a.cards || (a.title ?? "~").localeCompare(b.title ?? "~"));
}
