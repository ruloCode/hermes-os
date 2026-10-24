"use client";

// Datos del plan de estudios de inglés (/ingles → Plan): la ruta, el XP, la
// racha y cómo va cada patrón en tus clases. Un solo GET; cada envío (quiz o
// ejercicio hablado) devuelve el plan ya actualizado, así que no hace falta
// re-pedirlo. Poll solo mientras hay una lección con la tutora abierta (se
// cierra sola cuando la práctica se guarda al colgar).

import { useCallback, useEffect, useState } from "react";
import type { EnglishPlanPayload, PlanAttempt } from "@hermes/shared";
import { hermesFetch, hermesGet, hermesPost } from "@/lib/hermes";

export type PlanSubmit =
  | { ok: true; attempt: PlanAttempt; plan: EnglishPlanPayload }
  | { ok: false; error: string; transcript?: string };

const PENDING_POLL_MS = 8_000;

export function useEnglishPlan() {
  const [plan, setPlan] = useState<EnglishPlanPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setPlan(await hermesGet<EnglishPlanPayload>("/english/plan"));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const pending = Boolean(plan?.pendingTutor);
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => void refresh(), PENDING_POLL_MS);
    return () => clearInterval(t);
  }, [pending, refresh]);

  const submitQuiz = useCallback(async (lessonId: string, correct: number, total: number) => {
    try {
      const r = await hermesPost<PlanSubmit>("/english/plan/quiz", { lessonId, correct, total });
      if (r.ok) setPlan(r.plan);
      return r;
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
    }
  }, []);

  const submitDrill = useCallback(
    async (input: { lessonId: string; durationSec: number; blob?: Blob; text?: string }): Promise<PlanSubmit> => {
      const form = new FormData();
      form.append("lessonId", input.lessonId);
      form.append("durationSec", String(input.durationSec));
      if (input.text) form.append("text", input.text);
      if (input.blob)
        form.append("audio", input.blob, `drill.${input.blob.type.includes("mp4") ? "m4a" : "webm"}`);
      try {
        const res = await hermesFetch("/english/plan/drill", { method: "POST", body: form });
        const json = (await res.json().catch(() => null)) as PlanSubmit | null;
        if (!json) return { ok: false, error: `plan → ${res.status}` };
        if (json.ok) setPlan(json.plan);
        return json;
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    [],
  );

  const cancelTutor = useCallback(async () => {
    await hermesFetch("/english/plan/tutor", { method: "DELETE" }).catch(() => null);
    await refresh();
  }, [refresh]);

  return { plan, error, refresh, submitQuiz, submitDrill, cancelTutor };
}
