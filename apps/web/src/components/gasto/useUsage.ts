"use client";

// El único poll del panel de gasto. Ritmo: al abrir la vista (o cambiar de
// periodo) y cada 60 s MIENTRAS se ve. El AppShell deja todas las vistas
// montadas, así que `active` es lo que dice si esta está al frente; con la
// pestaña del navegador oculta tampoco se pregunta. El gasto no es telemetría
// en vivo: cambia cuando termina un turno, y un minuto de retraso no engaña a
// nadie.
//
// El catálogo (/usage/models) se pide una vez por apertura: solo cambia si se
// reinicia el agente con otras variables.

import { useCallback, useEffect, useRef, useState } from "react";
import { getUsageCatalog, getUsageSummary, type UsageCatalog, type UsageSummaryData } from "@/lib/usage-api";

const POLL_MS = 60_000;

export type UsagePeriod = 1 | 7 | 30;

export interface UsageState {
  /** El resumen del periodo elegido; null = todavía no llegó (o nunca llegó). */
  data: UsageSummaryData | null;
  catalog: UsageCatalog | null;
  /** Primera carga del periodo en curso (no hay nada que mostrar aún). */
  loading: boolean;
  /** Motivo del último intento fallido del resumen; null = el último salió bien. */
  error: string | null;
  /** El fallo fue de conexión (el agente no contestó), no un motivo del agente. */
  offline: boolean;
  /** Motivo si el catálogo no se pudo leer. */
  catalogError: string | null;
  /** Cuándo llegó `data` (ms). */
  fetchedAt: number;
}

const EMPTY: UsageState = {
  data: null,
  catalog: null,
  loading: true,
  error: null,
  offline: false,
  catalogError: null,
  fetchedAt: 0,
};

export function useUsage(active: boolean, days: UsagePeriod) {
  const [state, setState] = useState<UsageState>(EMPTY);
  // Lo último que llegó por periodo: volver a "7 días" pinta al instante lo que
  // ya se tenía mientras se refresca por detrás.
  const cache = useRef(new Map<number, { data: UsageSummaryData; at: number }>());
  // Cada pedido lleva su número: si cambias de periodo a mitad de vuelo, la
  // respuesta vieja no pisa a la nueva.
  const seq = useRef(0);
  const daysRef = useRef(days);
  daysRef.current = days;

  const loadSummary = useCallback(async () => {
    const mine = ++seq.current;
    const wanted = daysRef.current;
    const res = await getUsageSummary(wanted);
    if (mine !== seq.current) return;
    if (res.ok) {
      cache.current.set(wanted, { data: res.data, at: Date.now() });
      setState((s) => ({ ...s, data: res.data, loading: false, error: null, offline: false, fetchedAt: Date.now() }));
    } else {
      // Se conserva lo último que se vio de ESTE periodo (si lo hay) y se dice que es viejo.
      setState((s) => ({ ...s, loading: false, error: res.error, offline: res.offline }));
    }
  }, []);

  const loadCatalog = useCallback(async () => {
    const res = await getUsageCatalog();
    setState((s) => (res.ok ? { ...s, catalog: res.data, catalogError: null } : { ...s, catalogError: res.error }));
  }, []);

  const refresh = useCallback(() => {
    void loadSummary();
    void loadCatalog();
  }, [loadSummary, loadCatalog]);

  // Abrir la vista o cambiar de periodo.
  useEffect(() => {
    if (!active) return;
    const hit = cache.current.get(days);
    setState((s) => ({ ...s, data: hit?.data ?? null, fetchedAt: hit?.at ?? 0, loading: !hit, error: null, offline: false }));
    void loadSummary();
  }, [active, days, loadSummary]);

  useEffect(() => {
    if (active) void loadCatalog();
  }, [active, loadCatalog]);

  // Cada minuto con la vista al frente; al volver a la pestaña, si lo que hay ya está viejo.
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadSummary();
    }, POLL_MS);
    const onVisible = () => {
      const at = cache.current.get(daysRef.current)?.at ?? 0;
      if (document.visibilityState === "visible" && Date.now() - at > POLL_MS) void loadSummary();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active, loadSummary]);

  return { state, refresh };
}
