"use client";

// Datos de la página AGENDA: poll ligero del feed ICS de Google Calendar.
// El backend ya cachea 5 min (y Google cachea en su edge), así que refrescar
// cada 60s es de sobra — el calendario cambia lento. Mismo patrón de un solo
// poll por vista que useVida; no reusa el snapshot de /dashboard porque esa
// ventana es corta (3 eventos) y aquí queremos el mes completo.

import { useCallback, useEffect, useState } from "react";
import type { UpcomingCalendar } from "@hermes/shared";
import { getUpcomingCalendar } from "@/lib/hermes";

const POLL_MS = 60_000;

export interface AgendaData {
  calendar: UpcomingCalendar | null;
  loading: boolean;
  /** true = agente inalcanzable (distinto de configured:false). */
  offline: boolean;
  refresh: () => void;
}

export function useAgenda(): AgendaData {
  const [calendar, setCalendar] = useState<UpcomingCalendar | null>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await getUpcomingCalendar();
      setCalendar(data);
      setOffline(false);
    } catch {
      // Agente caído o sin endpoint: conservamos lo último bueno y marcamos offline.
      setOffline(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  return { calendar, loading, offline, refresh: load };
}
