"use client";

/**
 * Datos de UN tema: su detalle (tema + tomas candidatas + lo que le falta a
 * cada etapa) con un poll de 2 s solo mientras haya tomas procesándose, y los
 * cambios con PATCH diferido y acumulado (~600 ms): mover un acorde o escribir
 * la intención no manda una petición por tecla.
 *
 * Lo local manda sobre lo que llega del agente, sin carreras:
 *  - Un GET se pinta con lo que está EN VUELO y lo pendiente encima
 *    ({...inflight, ...pending}): el PATCH ya salió pero todavía no volvió, y
 *    un GET que se cruzó con él no lo trae.
 *  - Las escrituras se numeran: un GET que empezó antes de que se CONFIRMARA
 *    una escritura (tema o toma) se descarta y se vuelve a leer — podría traer
 *    el estado de antes del cambio y pisarlo.
 *  - Un PATCH a la vez: si se pide otro con uno en vuelo, sale cuando vuelve
 *    (dos en paralelo podían responder en desorden).
 *  - `reload()` con otro GET en vuelo NO se descarta: marca "otra vez" y relee
 *    al terminar (su promesa espera esa relectura).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { temaGates, type ComposeSession, type TakeMeta, type TemaDetail, type TemaGate } from "@hermes/shared";
import { ComposeApiError } from "@/lib/hermes";
import { useTemasApi, type TemaPatchBody } from "./api";
import type { TemaPatch } from "./TemaContext";

export type SaveState = "idle" | "saving" | "saved" | "error";

const PATCH_DELAY = 600;

/**
 * Lo que viaja en el PATCH. El agente MEZCLA `intent` y `track` con lo que ya
 * tiene (y reemplaza secciones y montaje enteros): una clave que se borró
 * (`pov: undefined`) desaparece del JSON y la mezcla conservaría la vieja. Por
 * eso lo borrado viaja como `null`, que en el agente borra la clave.
 */
function wire(p: TemaPatch): TemaPatchBody {
  const nullify = <T extends object>(o: T): T =>
    Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === undefined ? null : v])) as T;
  return {
    ...p,
    ...(p.intent ? { intent: nullify(p.intent) } : {}),
    ...(p.track ? { track: nullify(p.track) } : {}),
    // `songId: undefined` explícito = desvincular (deshacer un aplicar): viaja como null.
    ...("songId" in p && !p.songId ? { songId: null as unknown as string } : {}),
  };
}

export function useTema(id: string, opts: { active: boolean }) {
  const api = useTemasApi();
  const [detail, setDetail] = useState<TemaDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** 404: el tema ya no existe (otra pestaña lo borró). */
  const [notFound, setNotFound] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  /** Tocado y todavía no enviado. */
  const pending = useRef<TemaPatch>({});
  /** Enviado y todavía sin respuesta (un PATCH a la vez). */
  const inflight = useRef<TemaPatch | null>(null);
  /** Hay que mandar otro PATCH en cuanto vuelva el que está en vuelo. */
  const flushAgain = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Escrituras confirmadas (PATCH del tema o de una toma): un GET que se cruzó con una no vale. */
  const confirmed = useRef(0);
  /** La relectura en curso (por id) y si hay que leer otra vez al terminar. */
  const loading = useRef<{ id: string; promise: Promise<void> } | null>(null);
  const again = useRef(false);
  const idRef = useRef(id);
  idRef.current = id;

  const withLocal = useCallback((d: TemaDetail): TemaDetail => {
    const local = { ...(inflight.current ?? {}), ...pending.current };
    return Object.keys(local).length ? { ...d, tema: { ...d.tema, ...local } } : d;
  }, []);

  const reload = useCallback((): Promise<void> => {
    const cur = loading.current;
    if (cur && cur.id === id) {
      // Ya hay un GET en vuelo (quizás de ANTES de lo que el que llama acaba de escribir):
      // se relee al terminar, y quien llama espera esa relectura.
      again.current = true;
      return cur.promise;
    }
    const run = (async () => {
      // Tope: con escrituras confirmándose sin parar, no releer para siempre.
      for (let tries = 0; tries < 4; tries++) {
        again.current = false;
        const seen = confirmed.current;
        try {
          const d = await api.get(id);
          if (idRef.current !== id) return;
          // Se confirmó una escritura mientras leíamos: este GET puede ser de antes. Otra vez.
          if (confirmed.current !== seen) {
            again.current = true;
          } else {
            setDetail(withLocal(d));
            setLoadError(null);
            setNotFound(false);
          }
        } catch (e) {
          if (idRef.current !== id) return;
          setLoadError((e as Error).message);
          setNotFound(e instanceof ComposeApiError && e.status === 404);
        }
        if (!again.current) return;
      }
    })().finally(() => {
      if (loading.current?.promise === run) loading.current = null;
    });
    loading.current = { id, promise: run };
    return run;
  }, [api, id, withLocal]);

  useEffect(() => {
    setDetail(null);
    setLoadError(null);
    void reload();
  }, [reload]);

  const flush = useCallback(async (): Promise<void> => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    // Uno a la vez: el siguiente sale cuando vuelva este (con todo lo acumulado).
    if (inflight.current) {
      flushAgain.current = true;
      return;
    }
    const p = pending.current;
    if (!Object.keys(p).length) return;
    pending.current = {};
    inflight.current = p;
    setSaveState("saving");
    let ok = false;
    try {
      const t = await api.patch(id, wire(p));
      inflight.current = null;
      confirmed.current++;
      ok = true;
      // Lo tocado MIENTRAS viajaba el PATCH manda sobre lo que devolvió el agente.
      if (idRef.current === id) setDetail((d) => (d ? { ...d, tema: { ...t, ...pending.current } } : d));
      setSaveState(Object.keys(pending.current).length ? "saving" : "saved");
      setSaveError(null);
    } catch (e) {
      // Lo no guardado vuelve a la cola (sin pisar lo que se tocó después).
      inflight.current = null;
      pending.current = { ...p, ...pending.current };
      setSaveState("error");
      setSaveError((e as Error).message);
    }
    if (flushAgain.current) {
      flushAgain.current = false;
      // Tras un error no se reintenta en bucle: el próximo cambio (o "reintentar") vuelve a mandar.
      if (ok && Object.keys(pending.current).length) await flush();
    }
  }, [api, id]);

  /** Cambio optimista inmediato + PATCH diferido de lo acumulado. */
  const patch = useCallback(
    (p: TemaPatch) => {
      setDetail((d) => (d ? { ...d, tema: { ...d.tema, ...p } } : d));
      pending.current = { ...pending.current, ...p };
      setSaveState("saving");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), PATCH_DELAY);
    },
    [flush],
  );

  // Salir del tema (o cerrar la pestaña) guarda lo pendiente.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      void flush();
    };
  }, [flush]);

  // Poll de 2 s solo mientras alguna toma se procesa y la vista se ve.
  const processing = detail?.candidates.some((c) => c.status === "procesando" || c.status === "analizando") ?? false;
  useEffect(() => {
    if (!processing || !opts.active) return;
    const t = setInterval(() => void reload(), 2000);
    return () => clearInterval(t);
  }, [processing, opts.active, reload]);

  // Lo que falta, recalculado EN VIVO sobre lo que se acaba de tocar (la
  // lógica pura vive en shared); si todavía no responde, manda el del agente.
  const gates: TemaGate[] = useMemo(() => {
    if (!detail) return [];
    try {
      return temaGates(detail.tema, detail.candidates);
    } catch {
      return detail.gates;
    }
  }, [detail]);

  const uploadTake = useCallback(
    async (input: { wav: Blob; meta: Omit<TakeMeta, "n"> }): Promise<ComposeSession> => {
      const s = await api.uploadTake(id, input.wav, input.meta);
      confirmed.current++;
      void reload();
      return s;
    },
    [api, id, reload],
  );

  const patchTake = useCallback(
    async (sessionId: string, p: { favorite?: boolean; latencyMs?: number; hint?: string }) => {
      await api.patchTake(id, sessionId, p);
      // Escritura confirmada: un GET que ya estaba en vuelo no la trae (se descarta y se relee).
      confirmed.current++;
      await reload();
    },
    [api, id, reload],
  );

  return { detail, gates, loadError, notFound, saveState, saveError, reload, patch, flush, uploadTake, patchTake };
}

export type TemaData = ReturnType<typeof useTema>;
