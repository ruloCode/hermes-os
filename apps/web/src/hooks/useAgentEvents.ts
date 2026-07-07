"use client";

import { useEffect, useRef, useState } from "react";
import type { AgentActivityEvent } from "@hermes/shared";
import { sseUrl } from "@/lib/hermes";

/** Suscripción SSE al bus de actividad del agente, con reconexión. */
export function useAgentEvents(limit = 60) {
  const [events, setEvents] = useState<AgentActivityEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout>;

    const connect = () => {
      if (cancelled) return;
      const source = new EventSource(sseUrl("/events"));
      sourceRef.current = source;
      source.onopen = () => setConnected(true);
      source.onmessage = (ev) => {
        try {
          const parsed = JSON.parse(ev.data) as AgentActivityEvent;
          setEvents((prev) => [...prev.slice(-(limit - 1)), parsed]);
        } catch {
          /* ping */
        }
      };
      source.onerror = () => {
        setConnected(false);
        source.close();
        retry = setTimeout(connect, 3000);
      };
    };

    connect();
    return () => {
      cancelled = true;
      clearTimeout(retry);
      sourceRef.current?.close();
    };
  }, [limit]);

  return { events, connected };
}
