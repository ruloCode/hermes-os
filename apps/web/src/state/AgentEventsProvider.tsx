"use client";

// Suscripción SSE ÚNICA al bus de actividad del agente (/events), con
// reconexión. Compartida por ActivityFeed, VozView, Toasts y los bridges de
// voz — antes solo la página "/" la abría.

import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { AgentActivityEvent } from "@hermes/shared";
import { sseUrl } from "@/lib/hermes";

const LIMIT = 60;

interface AgentEvents {
  events: AgentActivityEvent[];
  connected: boolean;
}

const AgentEventsContext = createContext<AgentEvents | null>(null);

export function AgentEventsProvider({ children }: { children: React.ReactNode }) {
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
          setEvents((prev) => [...prev.slice(-(LIMIT - 1)), parsed]);
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
  }, []);

  return (
    <AgentEventsContext.Provider value={{ events, connected }}>
      {children}
    </AgentEventsContext.Provider>
  );
}

export function useAgentEventsContext(): AgentEvents {
  const ctx = useContext(AgentEventsContext);
  if (!ctx) throw new Error("useAgentEvents requiere <AgentEventsProvider> en el árbol");
  return ctx;
}
