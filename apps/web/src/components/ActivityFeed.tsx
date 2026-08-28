"use client";

import { useEffect, useRef } from "react";
import type { AgentActivityEvent } from "@hermes/shared";
import { PanelState } from "@/components/ui/PanelState";

// Icono + clase de color por tipo de evento (tokens del design system).
const KIND_STYLE: Record<string, { icon: string; className: string }> = {
  task_start: { icon: "▶", className: "text-cyan" },
  tool_call: { icon: "⚙", className: "text-violet" },
  tool_result: { icon: "↩", className: "text-text-dim" },
  text: { icon: "…", className: "text-text-dim" },
  task_done: { icon: "✓", className: "text-green" },
  error: { icon: "✗", className: "text-red" },
  session_start: { icon: "◆", className: "text-blue" },
};

export function ActivityFeed({ events }: { events: AgentActivityEvent[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [events.length]);

  return (
    <div ref={ref} className="h-full space-y-1 overflow-y-auto pr-1 text-xs leading-snug">
      {events.length === 0 && (
        <PanelState
          kind="empty"
          title="Sin actividad"
          hint="el feed se llena cuando el agente trabaja"
          compact
        />
      )}
      {events.map((ev, i) => {
        const st = KIND_STYLE[ev.kind] ?? KIND_STYLE.text;
        return (
          <div key={i} className="flex gap-2">
            <span className="w-10 shrink-0 opacity-40">{ev.ts.slice(11, 19)}</span>
            <span className={st.className}>{st.icon}</span>
            <span className="min-w-0 flex-1 truncate">
              {ev.toolName && <b className={`mr-1 ${st.className}`}>{ev.toolName}</b>}
              <span className="text-text-dim">{ev.detail ?? ev.kind}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
