"use client";

// Logs del agente seleccionado, tal como salen: para un run de claude -p, su
// stream (init, texto, tools, resultados y stderr: lo mismo que la consola);
// para una tarea del SDK, los eventos del bus de actividad con su taskId (lo
// que ven el feed y los monitores, recortado como siempre).

import { useEffect, useRef } from "react";
import type { AgentActivityEvent } from "@hermes/shared";
import type { Redact } from "@/lib/oficina/public-view";

export interface LogLine {
  t?: number | string;
  kind: string;
  text: string;
}

const KIND_CLASS: Record<string, string> = {
  tool: "text-accent",
  tool_call: "text-accent",
  result: "text-text-dim",
  tool_result: "text-text-dim",
  error: "text-red",
  done: "text-green",
  task_done: "text-green",
  init: "text-text-faint",
  task_start: "text-text-faint",
  session_start: "text-text-faint",
};

function hhmmss(t: number | string | undefined): string {
  if (t === undefined) return "";
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("es-CO", { hour12: false });
}

export function busLines(events: AgentActivityEvent[], taskId: string): LogLine[] {
  return events.filter((e) => e.taskId === taskId).map((e) => ({ t: e.ts, kind: e.kind, text: [e.toolName, e.detail].filter(Boolean).join(" · ") }));
}

export function LogsView({ lines, source, redact, big = false }: { lines: LogLine[] | null; source: string; redact: Redact; big?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (el && follow.current) el.scrollTop = el.scrollHeight;
  }, [lines?.length]);
  return (
    <div className="flex h-full min-h-0 flex-col" data-logs>
      <p className={`mb-1 text-text-dim ${big ? "text-[17px]" : "text-xs"}`}>{source}</p>
      <div
        ref={ref}
        onScroll={(e) => {
          const el = e.currentTarget;
          follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className={`min-h-0 flex-1 overflow-y-auto rounded-lg border border-line bg-panel px-3 py-2 font-mono ${big ? "text-[17px] leading-[25px]" : "text-[11px] leading-4"}`}
      >
        {!lines ? <p className="text-text-faint">Este run ya salió de la memoria del agente: sus logs no están.</p> : lines.length === 0 ? <p className="text-text-faint">Sin logs todavía.</p> : null}
        {lines?.slice(-600).map((l, i) => (
          <div key={i} className={`break-words whitespace-pre-wrap ${KIND_CLASS[l.kind] ?? "text-text"}`}>
            <span className="text-text-faint">{hhmmss(l.t)} </span>
            <span className="text-text-faint">[{l.kind}] </span>
            {redact(l.text)}
          </div>
        ))}
      </div>
    </div>
  );
}
