/**
 * Repaso diario de inglés: almacén y lógica de servicio (la lógica de las
 * tarjetas es pura y vive en @hermes/shared/english-review).
 *
 * - Errores: de las sesiones guardadas (solo lectura). Las tarjetas se
 *   recalculan en cada pedido: un error nuevo en una clase entra solo.
 * - Estado: `<HERMES_HOME>/english-review/state.json` (cajas + set de cada día)
 *   y `answers.jsonl` (append-only, una línea por respuesta, con `clientId`
 *   para que el teléfono reintente sin duplicar). Sin migración, como gym/.
 * - Completar el repaso del día marca el hábito "Práctica de inglés" UNA vez
 *   (el set guarda `completedAt`; el check-in además es idempotente por día).
 *
 * Todo entra por `createReviewService(deps)`: los tests pasan dobles (carpeta
 * temporal, sesiones de mentira, check-in que solo cuenta) y nunca tocan
 * Supabase ni el hábito real. Este archivo no importa nada con red.
 *
 * `HERMES_ENGLISH_REVIEW_DRY=1`: corrige pero no guarda ni marca el hábito
 * (el estado vive en memoria del proceso). Solo para ensayos con datos reales.
 */
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  applyAnswer,
  bogotaDay,
  cardsFromErrors,
  checkTyped,
  emptyReviewState,
  reviewPatternStats,
  reviewPayload,
  reviewSourceLabel,
  todayReview,
  withDaySet,
  type DiscardReason,
  type ReviewAnswerRecord,
  type ReviewCard,
  type ReviewPatternStat,
  type ReviewPayload,
  type ReviewSessionLike,
  type ReviewState,
} from "@hermes/shared";

/** Una respuesta en cola puede llegar hasta 7 días tarde (el teléfono sin red un fin de semana largo). */
export const ANSWER_MAX_AGE_MS = 7 * 86_400_000;
/** Un reloj del teléfono adelantado no puede fechar respuestas en el futuro. */
const ANSWER_MAX_SKEW_MS = 5 * 60_000;
/** Días de sets que se conservan en state.json (la racha mira hacia atrás desde hoy). */
const KEEP_DAYS = 400;

export interface ReviewDeps {
  dir: string;
  loadSessions: () => Promise<ReviewSessionLike[]>;
  /** Marca el hábito de práctica de inglés en ese día (AAAA-MM-DD). */
  checkin: (day: string) => Promise<void>;
  now?: () => Date;
  dry?: boolean;
}

export interface ReviewAnswerInput {
  cardId?: unknown;
  kind?: unknown;
  answer?: unknown;
  clientId?: unknown;
  answeredAt?: unknown;
  /** Día del set al que pertenece la tarjeta (si se descargó antes de medianoche). */
  day?: unknown;
}

export type ReviewAnswerResponse =
  | {
      ok: true;
      cardId: string;
      clientId: string;
      correct: boolean;
      /** Ya había una respuesta con este clientId (no contó otra vez). */
      duplicate: boolean;
      /** La tarjeta ya estaba respondida ese día con otro clientId: vale la primera. */
      already: boolean;
      said: string;
      better: string;
      accept: string[];
      rule: string | null;
      source: { sessionId: number; date: string; kind: "class" | "practice"; label: string };
    }
  | { ok: false; clientId?: string; cardId?: string; error: string };

export interface ReviewService {
  today(): Promise<ReviewPayload>;
  answer(input: ReviewAnswerInput): Promise<{ result: ReviewAnswerResponse; next: ReviewPayload }>;
  answers(inputs: ReviewAnswerInput[]): Promise<{ results: ReviewAnswerResponse[]; next: ReviewPayload }>;
  stats(): Promise<{
    patterns: ReviewPatternStat[];
    totalCards: number;
    mastered: number;
    discarded: Partial<Record<DiscardReason, number>>;
  }>;
}

async function readState(file: string): Promise<ReviewState> {
  try {
    const s = JSON.parse(await readFile(file, "utf8")) as ReviewState;
    if (s && s.version === 1 && s.cards && s.days) return s;
  } catch {
    /* sin archivo o corrupto: se empieza de cero (las respuestas siguen en el jsonl) */
  }
  return emptyReviewState();
}

async function readAnswers(file: string): Promise<ReviewAnswerRecord[]> {
  let raw = "";
  try {
    raw = await readFile(file, "utf8");
  } catch {
    return [];
  }
  const out: ReviewAnswerRecord[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as ReviewAnswerRecord);
    } catch {
      /* línea cortada por un append a medias: se ignora */
    }
  }
  return out;
}

function pruneDays(state: ReviewState, today: string): ReviewState {
  const keys = Object.keys(state.days).sort();
  if (keys.length <= KEEP_DAYS) return state;
  const keep = new Set(keys.slice(-KEEP_DAYS));
  void today;
  return { ...state, days: Object.fromEntries(Object.entries(state.days).filter(([d]) => keep.has(d))) };
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function createReviewService(deps: ReviewDeps): ReviewService {
  const stateFile = join(deps.dir, "state.json");
  const answersFile = join(deps.dir, "answers.jsonl");
  const now = deps.now ?? (() => new Date());
  const dry = Boolean(deps.dry);
  // En seco el estado vive aquí (se siembra una vez del disco, que no se toca).
  let memState: ReviewState | null = null;
  let memAnswers: ReviewAnswerRecord[] | null = null;
  // Una escritura a la vez: el lote del teléfono y la web pueden llegar juntos.
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(fn, fn);
    chain = run.catch(() => undefined);
    return run;
  };

  const loadState = async () => {
    if (dry) return (memState ??= await readState(stateFile));
    return readState(stateFile);
  };
  const loadAnswers = async () => {
    if (dry) return (memAnswers ??= await readAnswers(answersFile));
    return readAnswers(answersFile);
  };
  const saveState = async (s: ReviewState) => {
    if (dry) {
      memState = s;
      return;
    }
    await mkdir(deps.dir, { recursive: true });
    const tmp = `${stateFile}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(s), "utf8");
    await rename(tmp, stateFile);
  };
  const saveAnswer = async (r: ReviewAnswerRecord) => {
    if (dry) {
      (memAnswers ??= []).push(r);
      return;
    }
    await mkdir(deps.dir, { recursive: true });
    await appendFile(answersFile, JSON.stringify(r) + "\n", "utf8");
  };

  const loadCards = async () => cardsFromErrors(await deps.loadSessions());

  /** Congela el set de hoy la primera vez que se pide (así responder 3 y volver deja las otras 5). */
  const ensureToday = async (cards: ReviewCard[], state: ReviewState, today: string) => {
    const t = todayReview(cards, state, today);
    if (!t.fresh || !t.items.length) return state;
    const next = pruneDays(withDaySet(state, today, t.items), today);
    await saveState(next);
    return next;
  };

  async function answerOne(
    input: ReviewAnswerInput,
    ctx: { cards: ReviewCard[]; byId: Map<string, ReviewCard>; state: ReviewState; seen: Map<string, ReviewAnswerRecord> },
  ): Promise<ReviewAnswerResponse> {
    const clientId = typeof input.clientId === "string" ? input.clientId.trim() : "";
    const cardId = typeof input.cardId === "string" ? input.cardId : "";
    if (!clientId || clientId.length > 100) return { ok: false, cardId, error: "Falta clientId (un id único por respuesta)." };
    if (!cardId) return { ok: false, clientId, error: "Falta cardId." };
    const card = ctx.byId.get(cardId);
    const prev = ctx.seen.get(clientId);
    if (prev) {
      // Reintento del teléfono: se devuelve lo que ya se registró, sin contar otra vez.
      if (!card) return { ok: false, clientId, cardId, error: "Esa tarjeta ya no existe." };
      return { ...verdict(card, clientId, prev.correct), duplicate: true, already: false };
    }
    if (!card) return { ok: false, clientId, cardId, error: "Esa tarjeta ya no existe (se borró la sesión de donde salió)." };
    const answer = typeof input.answer === "string" ? input.answer.slice(0, 400) : "";
    if (!answer.trim()) return { ok: false, clientId, cardId, error: "Respuesta vacía." };

    const nowMs = now().getTime();
    let at = typeof input.answeredAt === "string" ? Date.parse(input.answeredAt) : NaN;
    if (!Number.isFinite(at) || at > nowMs + ANSWER_MAX_SKEW_MS) at = nowMs;
    if (at < nowMs - ANSWER_MAX_AGE_MS)
      return { ok: false, clientId, cardId, error: "Respuesta de hace más de 7 días: ya no cuenta para el repaso." };
    const answeredAt = new Date(at).toISOString();
    const today = bogotaDay(now().toISOString());
    let day = typeof input.day === "string" && DAY_RE.test(input.day) ? input.day : bogotaDay(answeredAt);
    // El set de un día que nunca se pidió: solo hoy se puede armar en el momento.
    if (!ctx.state.days[day] && day === today) ctx.state = await ensureToday(ctx.cards, ctx.state, today);
    // Respuesta hecha pasada la medianoche sobre el set de ayer, sin `day`: se busca en el anterior.
    if (!ctx.state.days[day]?.items.some((i) => i.id === cardId)) {
      const alt = Object.keys(ctx.state.days)
        .filter((d) => d <= day && d >= bogotaDay(new Date(nowMs - ANSWER_MAX_AGE_MS).toISOString()))
        .sort()
        .reverse()
        .find((d) => ctx.state.days[d].items.some((i) => i.id === cardId) && !(cardId in ctx.state.days[d].results));
      if (alt) day = alt;
    }
    const item = ctx.state.days[day]?.items.find((i) => i.id === cardId);
    if (!item) return { ok: false, clientId, cardId, error: "Esa tarjeta no está en el repaso de ese día." };
    // El tipo lo decide el set del día, no el cliente: elegir no se corrige como escribir y viceversa.
    const correct = checkTyped(answer, card.better, card.accept);
    const applied = applyAnswer(ctx.state, card, { day, correct, answeredAt });
    if (!applied.ok) return { ok: false, clientId, cardId, error: applied.error };
    if (applied.already) return { ...verdict(card, clientId, applied.correct), duplicate: false, already: true };
    ctx.state = applied.state;
    await saveState(ctx.state);
    const rec: ReviewAnswerRecord = {
      clientId,
      cardId,
      day,
      kind: item.kind,
      answer,
      correct,
      answeredAt,
      receivedAt: now().toISOString(),
    };
    await saveAnswer(rec);
    ctx.seen.set(clientId, rec);
    if (applied.completedNow && !dry) {
      try {
        await deps.checkin(day);
      } catch (err) {
        console.error("[english-review] check-in:", String(err).slice(0, 120));
      }
    }
    return { ...verdict(card, clientId, correct), duplicate: false, already: false };
  }

  function verdict(card: ReviewCard, clientId: string, correct: boolean) {
    return {
      ok: true as const,
      cardId: card.id,
      clientId,
      correct,
      said: card.said,
      better: card.better,
      accept: card.accept,
      rule: card.rule ?? null,
      source: { ...card.source, label: reviewSourceLabel(card.source) },
    };
  }

  async function runAnswers(inputs: ReviewAnswerInput[]) {
    const { cards } = await loadCards();
    const byId = new Map(cards.map((c) => [c.id, c]));
    const seen = new Map((await loadAnswers()).map((a) => [a.clientId, a]));
    const ctx = { cards, byId, state: await loadState(), seen };
    // Las respuestas en cola se aplican en el orden en que se hicieron.
    const order = inputs
      .map((inp, i) => ({ inp, i, at: typeof inp.answeredAt === "string" ? Date.parse(inp.answeredAt) || 0 : 0 }))
      .sort((a, b) => a.at - b.at || a.i - b.i);
    const results: ReviewAnswerResponse[] = new Array(inputs.length);
    for (const o of order) results[o.i] = await answerOne(o.inp, ctx);
    const today = bogotaDay(now().toISOString());
    ctx.state = await ensureToday(cards, ctx.state, today);
    return { results, next: reviewPayload(cards, ctx.state, today) };
  }

  return {
    today: () =>
      serial(async () => {
        const { cards } = await loadCards();
        const today = bogotaDay(now().toISOString());
        const state = await ensureToday(cards, await loadState(), today);
        return reviewPayload(cards, state, today);
      }),
    answer: (input) =>
      serial(async () => {
        const { results, next } = await runAnswers([input]);
        return { result: results[0], next };
      }),
    answers: (inputs) => serial(() => runAnswers(inputs)),
    stats: () =>
      serial(async () => {
        const { cards, discarded } = await loadCards();
        const today = bogotaDay(now().toISOString());
        const state = await loadState();
        const patterns = reviewPatternStats(cards, state, await loadAnswers(), today);
        const counts: Partial<Record<DiscardReason, number>> = {};
        for (const d of discarded) counts[d.reason] = (counts[d.reason] ?? 0) + 1;
        return {
          patterns,
          totalCards: cards.length,
          mastered: patterns.reduce((n, p) => n + p.mastered, 0),
          discarded: counts,
        };
      }),
  };
}
