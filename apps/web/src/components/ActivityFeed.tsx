"use client";

import { useEffect, useRef } from "react";
import type { AgentActivityEvent } from "@hermes/shared";

const KIND_STYLE: Record<string, { icon: string; color: string }> = {
  task_start: { icon: "▶", color: "var(--cyan)" },
  tool_call: { icon: "⚙", color: "var(--violet)" },
  tool_result: { icon: "↩", color: "var(--text-dim)" },
  text: { icon: "…", color: "var(--text-dim)" },
  task_done: { icon: "✓", color: "var(--green)" },
  error: { icon: "✗", color: "var(--red)" },
  session_start: { icon: "◆", color: "var(--blue)" },
};

export function ActivityFeed({ events }: { events: AgentActivityEvent[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [events.length]);

  return (
    <div ref={ref} className="h-full space-y-1 overflow-y-auto pr-1 text-[11px] leading-snug">
      {events.length === 0 && (
        <p className="pt-6 text-center text-[10px] tracking-[0.25em]" style={{ color: "var(--text-dim)" }}>
          SIN ACTIVIDAD — el feed se llena cuando el agente trabaja
        </p>
      )}
      {events.map((ev, i) => {
        const style = KIND_STYLE[ev.kind] ?? KIND_STYLE.text;
        return (
          <div key={i} className="flex gap-2">
            <span className="w-10 shrink-0 opacity-40">{ev.ts.slice(11, 19)}</span>
            <span style={{ color: style.color }}>{style.icon}</span>
            <span className="min-w-0 flex-1 truncate">
              {ev.toolName && (
                <b className="mr-1" style={{ color: style.color }}>
                  {ev.toolName}
                </b>
              )}
              <span style={{ color: "var(--text-dim)" }}>{ev.detail ?? ev.kind}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
