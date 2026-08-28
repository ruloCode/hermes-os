"use client";

// Datos de la vista /ingles: sesiones (con reporte) y vocabulario. Poll corto
// mientras haya un reporte generándose (pending/running → done), lento si
// todo está quieto.

import { useCallback, useEffect, useState } from "react";
import type { EnglishSession, VocabEntry } from "@hermes/shared";
import { hermesGet } from "@/lib/hermes";

const IDLE_POLL_MS = 60_000;
const REPORT_POLL_MS = 10_000;

export function useEnglish() {
  const [sessions, setSessions] = useState<EnglishSession[]>([]);
  const [vocab, setVocab] = useState<VocabEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [s, v] = await Promise.all([
        hermesGet<EnglishSession[]>("/english/sessions?limit=50"),
        hermesGet<VocabEntry[]>("/english/vocab?limit=100"),
      ]);
      setSessions(s);
      setVocab(v);
    } catch {
      /* agente offline: el panel muestra el estado vacío */
    } finally {
      setLoading(false);
    }
  }, []);

  const generating = sessions.some(
    (s) => s.report_status === "pending" || s.report_status === "running",
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const t = setInterval(() => void refresh(), generating ? REPORT_POLL_MS : IDLE_POLL_MS);
    return () => clearInterval(t);
  }, [refresh, generating]);

  return { sessions, vocab, loading, refresh };
}
