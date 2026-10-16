"use client";

import { useCallback, useEffect, useState } from "react";
import type { GymRep, GymToday } from "@hermes/shared";
import { hermesFetch } from "@/lib/hermes";

export type GymSubmit =
  | { ok: true; rep: GymRep; today: GymToday }
  | { ok: false; error: string; transcript?: string };

/**
 * Datos del gimnasio de articulación: el día (plan + repeticiones + racha) y
 * el envío de cada repetición. Solo pide mientras la vista está activa: el
 * AppShell mantiene todas las vistas montadas.
 */
export function useGym(active: boolean) {
  const [today, setToday] = useState<GymToday | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await hermesFetch("/gym/today");
      if (!res.ok) throw new Error(`gimnasio → ${res.status}`);
      setToday((await res.json()) as GymToday);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    if (active) void refresh();
  }, [active, refresh]);

  const submit = useCallback(
    async (input: { scenarioId: string; durationSec: number; blob?: Blob; text?: string }): Promise<GymSubmit> => {
      const form = new FormData();
      form.append("scenarioId", input.scenarioId);
      form.append("durationSec", String(input.durationSec));
      if (input.text) form.append("text", input.text);
      if (input.blob) form.append("audio", input.blob, `rep.${input.blob.type.includes("mp4") ? "m4a" : "webm"}`);
      try {
        const res = await hermesFetch("/gym/reps", { method: "POST", body: form });
        const json = (await res.json().catch(() => null)) as GymSubmit | null;
        if (!json) return { ok: false, error: `gimnasio → ${res.status}` };
        if (json.ok) setToday(json.today);
        return json;
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    [],
  );

  /** Otra ronda (sin límite). Puede tardar ~30 s si no había temas preparados. */
  const newRound = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    try {
      const res = await hermesFetch("/gym/rounds", { method: "POST" });
      const json = (await res.json().catch(() => null)) as
        | { ok: true; today: GymToday }
        | { ok: false; error: string }
        | null;
      if (!json) return { ok: false, error: `gimnasio → ${res.status}` };
      if (json.ok) setToday(json.today);
      return json.ok ? { ok: true } : { ok: false, error: json.error };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }, []);

  return { today, error, refresh, submit, newRound };
}
