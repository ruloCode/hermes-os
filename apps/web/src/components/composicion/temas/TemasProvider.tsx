"use client";

/**
 * Estado de TEMAS: la lista (con poll suave solo mientras se ve) y la
 * navegación lista → tema. Vive por encima de las secciones de Composición
 * para que el selector cuente los temas y para que Sesiones pueda "Llevar a un
 * Tema" un pasaje: crea el tema, cambia a Temas y lo deja abierto.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { MemoRef, Tema, TemaListItem } from "@hermes/shared";
import { useComposicion } from "../ComposicionContext";
import { useViewActive } from "../playground/api";
import { useTemasApi } from "./api";

interface TemasState {
  temas: TemaListItem[] | null;
  error: string | null;
  reload: () => Promise<void>;
  openId: string | null;
  openTema: (id: string | null) => void;
  /** Crea un tema y lo abre. null si falló (el motivo queda en `createError`). */
  create: (input?: { title?: string; fromPassage?: MemoRef }) => Promise<Tema | null>;
  creating: boolean;
  createError: string | null;
  /** Desde Sesiones: tema nuevo con ese pasaje como tarareo → Temas con el tema abierto. */
  fromPassage: (ref: MemoRef, title?: string) => Promise<{ tema: Tema } | { error: string }>;
  remove: (id: string) => Promise<boolean>;
}

const Ctx = createContext<TemasState | null>(null);

export function TemasProvider({ children, visible }: { children: ReactNode; visible: boolean }) {
  const api = useTemasApi();
  const active = useViewActive();
  const comp = useComposicion();
  const [temas, setTemas] = useState<TemaListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const busy = useRef(false);

  const reload = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const list = await api.list();
      setTemas([...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      busy.current = false;
    }
  }, [api]);

  // Una lectura al montar: el selector de secciones muestra cuántos hay.
  useEffect(() => {
    void reload();
  }, [reload]);

  // Poll suave solo con la LISTA a la vista (un tema abierto trae su propio poll).
  useEffect(() => {
    if (!visible || !active || openId) return;
    const t = setInterval(() => void reload(), 15_000);
    return () => clearInterval(t);
  }, [visible, active, openId, reload]);

  const openTema = useCallback(
    (id: string | null) => {
      setOpenId(id);
      if (!id) void reload();
    },
    [reload],
  );

  /** Crea y abre; devuelve el tema o el motivo del fallo. */
  const createRaw = useCallback(
    async (input: { title?: string; fromPassage?: MemoRef }): Promise<{ tema: Tema } | { error: string }> => {
      setCreating(true);
      setCreateError(null);
      try {
        const t = await api.create(input);
        setOpenId(t.id);
        void reload();
        return { tema: t };
      } catch (e) {
        const error = (e as Error).message;
        setCreateError(error);
        return { error };
      } finally {
        setCreating(false);
      }
    },
    [api, reload],
  );

  const create = useCallback(
    async (input: { title?: string; fromPassage?: MemoRef } = {}) => {
      const r = await createRaw(input);
      return "tema" in r ? r.tema : null;
    },
    [createRaw],
  );

  const { setSection, setSelectedId } = comp;
  const fromPassage = useCallback(
    async (ref: MemoRef, title?: string) => {
      const r = await createRaw({ title, fromPassage: ref });
      if ("tema" in r) {
        setSelectedId(null);
        setSection("temas");
      }
      return r;
    },
    [createRaw, setSection, setSelectedId],
  );

  const remove = useCallback(
    async (id: string) => {
      try {
        await api.remove(id);
        setOpenId((cur) => (cur === id ? null : cur));
        setTemas((list) => list?.filter((t) => t.id !== id) ?? list);
        return true;
      } catch (e) {
        setError((e as Error).message);
        return false;
      }
    },
    [api],
  );

  const value = useMemo(
    () => ({ temas, error, reload, openId, openTema, create, creating, createError, fromPassage, remove }),
    [temas, error, reload, openId, openTema, create, creating, createError, fromPassage, remove],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTemas(): TemasState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useTemas fuera de TemasProvider");
  return v;
}

/** Igual que useTemas, pero null fuera del provider (Sesiones montada sola en otra página). */
export function useTemasMaybe(): TemasState | null {
  return useContext(Ctx);
}
