"use client";

// Lista de memorias recientes (rescatada para el tab MEMORIA). Renderiza solo
// la lista — el contenedor lo pone quien la use.
//
// v5: sin rayita de color por fila ni tipo en mayúsculas de color. El tipo es
// una CATEGORÍA, no un estado: va como etiqueta neutra y en español.

import type { Memory } from "@hermes/shared";

const TYPE_LABEL: Record<string, string> = {
  user: "usuario",
  feedback: "feedback",
  project: "proyecto",
  reference: "referencia",
  daily: "diario",
  agent: "agente",
};

export function RecentInsights({ memories }: { memories: Memory[] }) {
  if (!memories.length) {
    return (
      <p className="py-6 text-center text-sm text-text-faint">
        Sin memorias aún — conecta Supabase y corre la migración.
      </p>
    );
  }
  return (
    <ul>
      {memories.map((m) => (
        <li key={m.id} className="border-t border-line first:border-t-0">
          <div className="min-w-0 rounded-sm px-2 py-2.5 transition-colors hover:bg-hover">
            <div className="flex min-w-0 items-center gap-2">
              <span className="inline-flex h-5 shrink-0 items-center rounded-full border border-line px-2 text-2xs text-text-dim">
                {TYPE_LABEL[m.type] ?? m.type}
              </span>
              {m.project_slug && (
                <span className="min-w-0 truncate text-xs text-text-faint">{m.project_slug}</span>
              )}
              <span className="ml-auto shrink-0 font-mono text-2xs text-text-faint tabular-nums">
                {m.created_at.slice(5, 10)}
              </span>
            </div>
            <p className="mt-1.5 line-clamp-2 text-sm leading-snug text-text">
              {m.summary || m.content}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
