"use client";

import { Panel } from "./Panel";
import type { Memory } from "@hermes/shared";

const TYPE_COLOR: Record<string, string> = {
  user: "var(--cyan)",
  feedback: "var(--amber)",
  project: "var(--blue)",
  reference: "var(--green)",
  daily: "var(--text-dim)",
  agent: "var(--violet)",
};

export function RecentInsights({ memories }: { memories: Memory[] }) {
  return (
    <Panel title="Recent Insights" delay={240} className="min-h-0 flex-1">
      <div className="h-full space-y-2.5 overflow-y-auto pr-1">
        {memories.length === 0 && (
          <p className="pt-4 text-center text-[10px] tracking-[0.25em]" style={{ color: "var(--text-dim)" }}>
            SIN MEMORIAS AÚN — conecta Supabase y corre la migración
          </p>
        )}
        {memories.map((m) => (
          <div
            key={m.id}
            className="border-l-2 pl-2.5"
            style={{ borderColor: TYPE_COLOR[m.type] ?? "var(--violet)" }}
          >
            <div className="flex justify-between text-[9px] tracking-[0.18em] uppercase">
              <span style={{ color: TYPE_COLOR[m.type] ?? "var(--violet)" }}>
                {m.type}
                {m.project_slug ? ` · ${m.project_slug}` : ""}
              </span>
              <span style={{ color: "var(--text-dim)" }}>{m.created_at.slice(5, 10)}</span>
            </div>
            <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug" style={{ color: "var(--text)" }}>
              {m.summary || m.content}
            </p>
          </div>
        ))}
      </div>
    </Panel>
  );
}
