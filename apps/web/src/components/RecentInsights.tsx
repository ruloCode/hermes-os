"use client";

// Lista de memorias recientes (rescatada para el tab MEMORIA). Renderiza solo
// la lista — el contenedor/Panel lo pone quien la use.

import type { Memory } from "@hermes/shared";

const TYPE_COLOR: Record<string, string> = {
  user: "var(--color-cyan)",
  feedback: "var(--color-amber)",
  project: "var(--color-blue)",
  reference: "var(--color-green)",
  daily: "var(--color-text-dim)",
  agent: "var(--color-violet)",
};

export function RecentInsights({ memories }: { memories: Memory[] }) {
  if (!memories.length) {
    return (
      <p className="pt-4 text-center text-2xs tracking-label uppercase text-text-dim">
        Sin memorias aún — conecta Supabase y corre la migración
      </p>
    );
  }
  return (
    <div className="space-y-2.5 pr-1">
      {memories.map((m) => (
        <div
          key={m.id}
          className="border-l-2 pl-2.5"
          style={{ borderColor: TYPE_COLOR[m.type] ?? "var(--color-violet)" }}
        >
          <div className="flex justify-between text-2xs tracking-label uppercase">
            <span style={{ color: TYPE_COLOR[m.type] ?? "var(--color-violet)" }}>
              {m.type}
              {m.project_slug ? ` · ${m.project_slug}` : ""}
            </span>
            <span className="text-text-dim">{m.created_at.slice(5, 10)}</span>
          </div>
          <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-text">
            {m.summary || m.content}
          </p>
        </div>
      ))}
    </div>
  );
}
