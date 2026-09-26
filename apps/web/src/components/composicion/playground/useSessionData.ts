"use client";

/**
 * Datos de UNA sesión: la sesión (con poll de 2 s mientras el agente la
 * procesa o analiza un pasaje — el checklist avanza solo), la transcripción y
 * los picos de la onda (se piden cuando sus etapas terminan, no antes: un 404
 * a mitad del proceso no es un error, es "todavía no").
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ComposeSession, Passage } from "@hermes/shared";
import { usePlaygroundApi, useViewActive, type ComposeTranscriptLine, type PassagePatch } from "./api";

const stageDone = (s: ComposeSession | null, stage: string) =>
  s?.stages.some((x) => x.stage === stage && x.status === "listo") ?? false;

export function useSessionData(id: string) {
  const api = usePlaygroundApi();
  const active = useViewActive();
  const [session, setSession] = useState<ComposeSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<ComposeTranscriptLine[] | null>(null);
  const [peaks, setPeaks] = useState<{ peaks: number[]; durationSec: number } | null>(null);
  /** Pasajes con un PATCH en vuelo: el poll no los pisa con el valor viejo. */
  const pending = useRef(new Map<string, PassagePatch>());

  const reload = useCallback(async () => {
    try {
      const s = await api.getSession(id);
      const overlay = pending.current;
      setSession(
        overlay.size
          ? { ...s, passages: s.passages.map((p) => (overlay.has(p.id) ? { ...p, ...overlay.get(p.id) } : p)) }
          : s,
      );
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api, id]);

  useEffect(() => {
    setSession(null);
    setTranscript(null);
    setPeaks(null);
    void reload();
  }, [reload]);

  const busy =
    session?.status === "procesando" || (session?.passages.some((p) => p.status === "analizando") ?? false);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => void reload(), busy ? 2000 : 15_000);
    return () => clearInterval(t);
  }, [active, busy, reload]);

  const transcribed = stageDone(session, "transcribir");
  useEffect(() => {
    if (!transcribed) return;
    let cancelled = false;
    api
      .transcript(id)
      .then((t) => !cancelled && setTranscript(t.lines))
      .catch(() => !cancelled && setTranscript(null));
    return () => {
      cancelled = true;
    };
  }, [api, id, transcribed]);

  const hasAudio = stageDone(session, "audio") || !!session?.files.audio;
  useEffect(() => {
    if (!hasAudio) return;
    let cancelled = false;
    api
      .peaks(id)
      .then((p) => !cancelled && setPeaks(p))
      .catch(() => !cancelled && setPeaks(null));
    return () => {
      cancelled = true;
    };
  }, [api, id, hasAudio]);

  /** Cambio optimista de un pasaje: se ve al instante y el servidor confirma. */
  const patchPassage = useCallback(
    async (pid: string, patch: PassagePatch): Promise<Passage | null> => {
      pending.current.set(pid, { ...(pending.current.get(pid) ?? {}), ...patch });
      setSession((s) =>
        s ? { ...s, passages: s.passages.map((p) => (p.id === pid ? { ...p, ...patch } : p)) } : s,
      );
      try {
        const saved = await api.patchPassage(id, pid, patch);
        pending.current.delete(pid);
        setSession((s) => (s ? { ...s, passages: s.passages.map((p) => (p.id === pid ? saved : p)) } : s));
        return saved;
      } catch (e) {
        pending.current.delete(pid);
        setError((e as Error).message);
        void reload();
        return null;
      }
    },
    [api, id, reload],
  );

  const patchSession = useCallback(
    async (patch: Parameters<typeof api.patchSession>[1]) => {
      try {
        const s = await api.patchSession(id, patch);
        setSession(s);
        return s;
      } catch (e) {
        setError((e as Error).message);
        return null;
      }
    },
    [api, id],
  );

  return { session, setSession, error, setError, reload, transcript, peaks, patchPassage, patchSession };
}

export type SessionData = ReturnType<typeof useSessionData>;
