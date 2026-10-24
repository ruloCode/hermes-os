"use client";

// Datos del Dojo (/dojo): la vista (estado de cada lección, racha, repasos)
// en un GET; cada intento guardado devuelve la vista ya actualizada, así que
// no hay poll. El contenido (enunciados, tests, pistas) vive en @hermes/shared.

import { useCallback, useEffect, useRef, useState } from "react";
import type { BigO, DojoAttempt, DojoCoachFeedback, DojoCoachStage, DojoPayload } from "@hermes/shared";
import { hermesFetch, hermesGet } from "@/lib/hermes";
import { gameAward, gameLevelUp } from "@/lib/dojo/game";

export interface AttemptInput {
  itemId: string;
  passed: boolean;
  gaveUp?: boolean;
  hints?: number;
  review?: boolean;
  ms?: number;
  tests?: { passed: number; total: number };
  checks?: { correct: number; total: number };
  code?: string;
  understanding?: string;
  plan?: string;
  learned?: string;
  guessedTime?: BigO;
}

export interface TypingInput {
  itemId: string;
  source: "ejemplo" | "solucion";
  blind: boolean;
  chars: number;
  errors: number;
  ms: number;
  maxCombo: number;
}

export interface CoachInput {
  itemId: string;
  stage: DojoCoachStage;
  understanding?: string;
  edgeCase?: string;
  plan?: string;
  code?: string;
  failing?: { call: string; expected: string; got: string | null; error?: string | null };
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await hermesFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  // Contrato {ok, …|error}: un 400 también trae el motivo en el cuerpo.
  const json = (await res.json().catch(() => null)) as T | null;
  if (!json) throw new Error(`${path} → ${res.status}`);
  return json;
}

export function useDojo(active: boolean) {
  const [dojo, setDojo] = useState<DojoPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastXp = useRef<{ total: number; level: number } | null>(null);

  // Cada guardado devuelve la vista nueva: el XP que se anuncia es la
  // diferencia REAL del total, y el nivel sube si el agente lo dice.
  const adopt = useCallback((next: DojoPayload, label?: string) => {
    const prev = lastXp.current;
    if (prev) {
      gameAward(next.xp.total - prev.total, label);
      if (next.xp.level > prev.level) setTimeout(() => gameLevelUp(next.xp.level), 700);
    }
    lastXp.current = { total: next.xp.total, level: next.xp.level };
    setDojo(next);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const d = await hermesGet<DojoPayload>("/dojo");
      lastXp.current = { total: d.xp.total, level: d.xp.level };
      setDojo(d);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  // Al entrar a la vista (el día pudo cambiar y vencer un repaso).
  useEffect(() => {
    if (active) void refresh();
  }, [active, refresh]);

  const saveAttempt = useCallback(
    async (input: AttemptInput): Promise<{ ok: true; attempt: DojoAttempt } | { ok: false; error: string }> => {
      try {
        const r = await post<{ ok: true; attempt: DojoAttempt; dojo: DojoPayload } | { ok: false; error: string }>(
          "/dojo/attempts",
          input,
        );
        if (r.ok) adopt(r.dojo, input.passed ? undefined : "rendirse también enseña");
        return r.ok ? { ok: true, attempt: r.attempt } : r;
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    [adopt],
  );

  const saveTyping = useCallback(
    async (input: TypingInput): Promise<{ ok: boolean; error?: string }> => {
      try {
        const r = await post<{ ok: true; dojo: DojoPayload } | { ok: false; error: string }>("/dojo/typing", input);
        if (r.ok) adopt(r.dojo, input.blind ? "de memoria" : "tecleo");
        return r;
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    [adopt],
  );

  const askCoach = useCallback(
    async (input: CoachInput): Promise<{ ok: true; feedback: DojoCoachFeedback } | { ok: false; error: string }> => {
      try {
        return await post("/dojo/coach", input);
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    [],
  );

  return { dojo, error, refresh, saveAttempt, saveTyping, askCoach };
}
