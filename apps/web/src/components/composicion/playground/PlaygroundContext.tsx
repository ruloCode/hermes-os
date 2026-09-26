"use client";

/**
 * Estado del Playground: la lista de sesiones (con poll) y la navegación
 * contexto → lista → pieza (sesiones → sesión → memo). Vive por encima de la
 * vista para que el selector de secciones pueda contar sesiones y para que
 * volver de un memo te deje en la misma sesión, con el mismo pasaje elegido.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ComposeSessionSummary } from "@hermes/shared";
import { usePlaygroundApi, useViewActive } from "./api";

export type MemoTab = "melodia" | "molde" | "versiones";

interface PlaygroundState {
  sessions: ComposeSessionSummary[] | null;
  sessionsError: string | null;
  reloadSessions: () => Promise<void>;
  sessionId: string | null;
  passageId: string | null;
  memoTab: MemoTab;
  setMemoTab: (t: MemoTab) => void;
  openSession: (id: string | null) => void;
  openPassage: (pid: string | null) => void;
  /** Pasaje elegido en la lista de la sesión (sobrevive a abrir y cerrar el memo). */
  focusPassage: string | null;
  setFocusPassage: (pid: string | null) => void;
}

const Ctx = createContext<PlaygroundState | null>(null);

export function PlaygroundProvider({ children, visible }: { children: ReactNode; visible: boolean }) {
  const api = usePlaygroundApi();
  const active = useViewActive();
  const [sessions, setSessions] = useState<ComposeSessionSummary[] | null>(null);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [passageId, setPassageId] = useState<string | null>(null);
  const [focusPassage, setFocusPassage] = useState<string | null>(null);
  const [memoTab, setMemoTab] = useState<MemoTab>("melodia");
  const busy = useRef(false);

  const reloadSessions = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const list = await api.listSessions();
      setSessions([...list].sort((a, b) => (b.recordedAt ?? b.createdAt).localeCompare(a.recordedAt ?? a.createdAt)));
      setSessionsError(null);
    } catch (e) {
      setSessionsError((e as Error).message);
    } finally {
      busy.current = false;
    }
  }, [api]);

  // Una lectura al montar (el selector de secciones muestra cuántas hay).
  useEffect(() => {
    void reloadSessions();
  }, [reloadSessions]);

  // Poll solo mientras se ve la LISTA: rápido si algo se está procesando
  // (el checklist avanza solo), lento si todo está quieto.
  const processing = sessions?.some((s) => s.status === "procesando") ?? false;
  useEffect(() => {
    if (!visible || !active || sessionId) return;
    const t = setInterval(() => void reloadSessions(), processing ? 2000 : 10_000);
    return () => clearInterval(t);
  }, [visible, active, sessionId, processing, reloadSessions]);

  const openSession = useCallback(
    (id: string | null) => {
      setSessionId(id);
      setPassageId(null);
      setFocusPassage(null);
      if (!id) void reloadSessions();
    },
    [reloadSessions],
  );

  const openPassage = useCallback((pid: string | null) => {
    setPassageId(pid);
    if (pid) setFocusPassage(pid);
  }, []);

  const value = useMemo(
    () => ({
      sessions,
      sessionsError,
      reloadSessions,
      sessionId,
      passageId,
      memoTab,
      setMemoTab,
      openSession,
      openPassage,
      focusPassage,
      setFocusPassage,
    }),
    [sessions, sessionsError, reloadSessions, sessionId, passageId, memoTab, openSession, openPassage, focusPassage],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePlayground(): PlaygroundState {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePlayground fuera de PlaygroundProvider");
  return v;
}
