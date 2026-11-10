// Cliente del repaso diario de inglés (/english/review/*). Contrato completo en
// openspec/changes/v6-nucleo/specs/ingles/spec.md → "Notas de implementación".
// Todo responde 200 con { ok:false, error } cuando hay algo que decir: el error
// se devuelve como dato, no se lanza, para que la tarjeta muestre el motivo.

import type { ReviewPayload, ReviewPatternStat } from "@hermes/shared";
import { hermesGet, hermesPost, uuid } from "@/lib/hermes";

export type ReviewVerdict = {
  ok: true;
  cardId: string;
  clientId: string;
  correct: boolean;
  duplicate: boolean;
  already: boolean;
  said: string;
  better: string;
  accept: string[];
  rule: string | null;
  source: { sessionId: number; date: string; kind: "class" | "practice"; label: string };
  next: ReviewPayload;
};

type Fail = { ok: false; error: string };

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function getTodayReview(): Promise<{ ok: true; review: ReviewPayload } | Fail> {
  try {
    return await hermesGet<{ ok: true; review: ReviewPayload } | Fail>("/english/review/today");
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}

/**
 * Responde una tarjeta. `clientId` se genera UNA vez por respuesta: reintentar
 * tras un corte de red con el mismo id no la cuenta dos veces.
 */
export async function answerReviewCard(input: {
  cardId: string;
  kind: string;
  answer: string;
  clientId?: string;
}): Promise<ReviewVerdict | Fail> {
  const body = { ...input, clientId: input.clientId ?? uuid(), answeredAt: new Date().toISOString() };
  try {
    return await hermesPost<ReviewVerdict | Fail>("/english/review/answer", body);
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}

export async function getReviewStats(): Promise<
  | { ok: true; patterns: ReviewPatternStat[]; totalCards: number; mastered: number; discarded: Record<string, number> }
  | Fail
> {
  try {
    return await hermesGet("/english/review/stats");
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}
