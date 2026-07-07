"use client";

import { Panel } from "./Panel";
import type { ProjectStatus } from "@hermes/shared";

export function ProjectsStrip({
  projects,
  selected,
  onSelect,
}: {
  projects: ProjectStatus[];
  selected?: string | null;
  onSelect?: (slug: string | null) => void;
}) {
  const activos = projects.filter((p) => p.estado === "activo");
  return (
    <Panel title="Proyectos" delay={90}>
      <div className="space-y-1.5">
        {activos.length === 0 && (
          <p className="text-[10px] tracking-[0.2em]" style={{ color: "var(--text-dim)" }}>
            SIN PROYECTOS ACTIVOS EN EL VAULT
          </p>
        )}
        {activos.map((p) => {
          const isSel = selected === p.slug;
          return (
            <button
              key={p.slug}
              type="button"
              onClick={() => onSelect?.(isSel ? null : p.slug)}
              aria-pressed={isSel}
              title={isSel ? "Quitar foco" : `Enfocar la consola en ${p.name}`}
              className="group block w-full rounded-sm px-2 py-1 text-left transition-colors"
              style={{
                background: isSel ? "rgba(103,232,249,0.08)" : "transparent",
                boxShadow: isSel ? "inset 0 0 0 1px var(--cyan)" : "none",
              }}
            >
              <div className="flex items-center justify-between">
                <span
                  className="font-display text-[12px] font-semibold tracking-[0.12em] uppercase"
                  style={isSel ? { color: "var(--cyan)", textShadow: "0 0 10px rgba(103,232,249,0.5)" } : undefined}
                >
                  {p.name}
                </span>
                <span
                  className="text-[8.5px] tracking-[0.2em]"
                  style={{ color: "var(--green)", textShadow: "0 0 8px var(--green)" }}
                >
                  ● ACTIVO
                </span>
              </div>
              {p.tareas_pendientes[0] && (
                <p className="mt-0.5 truncate text-[10px]" style={{ color: "var(--text-dim)" }}>
                  ▸ {p.tareas_pendientes[0]}
                </p>
              )}
            </button>
          );
        })}
      </div>
    </Panel>
  );
}
