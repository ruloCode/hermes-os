"use client";

import { useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { StatusPill } from "@/components/ui/StatusPill";
import type { ProjectStatus } from "@hermes/shared";

// El estado_actual viene del markdown del vault y puede traer callouts de
// Obsidian ("> [!note] …"), viñetas o énfasis: para la línea de descripción
// se limpia a texto plano (la nota completa se ve al enfocar el proyecto).
function plainLine(md: string): string {
  return md
    .replace(/>\s*\[![a-z]+\][-+]?\s*/gi, "")
    .replace(/[>*_`#-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Fila clickable de un proyecto: nombre + pill de estado y descripción
// (estado_actual del frontmatter) truncada a una línea. El seleccionado
// lleva borde izquierdo violet + fondo violet/5.
function ProjectRow({
  project,
  selected,
  onSelect,
}: {
  project: ProjectStatus;
  selected: boolean;
  onSelect?: (slug: string | null) => void;
}) {
  const isActive = project.estado === "activo";
  return (
    <button
      type="button"
      onClick={() => onSelect?.(selected ? null : project.slug)}
      aria-pressed={selected}
      title={selected ? "Quitar foco" : `Enfocar la consola en ${project.name}`}
      className={`block w-full border-l-2 px-2 py-1 text-left transition-colors ${
        selected
          ? "border-violet bg-violet/5"
          : "border-transparent hover:bg-panel-2"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className={`truncate font-display text-xs font-semibold tracking-title uppercase ${
            selected ? "text-cyan glow-text-cyan" : "text-text"
          }`}
        >
          {project.name}
        </span>
        {isActive ? (
          <StatusPill status="active" size="sm" />
        ) : (
          <StatusPill
            status="paused"
            size="sm"
            // Estados distintos de "pausado" muestran su texto real del frontmatter
            label={project.estado !== "pausado" ? project.estado.toUpperCase() : undefined}
          />
        )}
      </div>
      {project.estado_actual && (
        <p className="mt-0.5 truncate text-2xs text-text-dim">
          {plainLine(project.estado_actual)}
        </p>
      )}
    </button>
  );
}

export function ProjectsStrip({
  projects,
  selected,
  onSelect,
  onNew,
}: {
  projects: ProjectStatus[];
  selected?: string | null;
  onSelect?: (slug: string | null) => void;
  onNew?: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const activos = projects.filter((p) => p.estado === "activo");
  const inactivos = projects.filter((p) => p.estado !== "activo");

  return (
    <Panel
      title="Proyectos"
      delay={90}
      right={
        onNew ? (
          <button
            type="button"
            onClick={onNew}
            className="text-2xs tracking-label uppercase text-text-dim transition-colors hover:text-violet"
          >
            + nuevo
          </button>
        ) : undefined
      }
    >
      <div className="space-y-1">
        {activos.length === 0 && (
          <p className="px-2 text-2xs tracking-label text-text-faint">
            SIN PROYECTOS ACTIVOS EN EL VAULT
          </p>
        )}
        {activos.map((p) => (
          <ProjectRow
            key={p.slug}
            project={p}
            selected={selected === p.slug}
            onSelect={onSelect}
          />
        ))}

        {/* Los no activos viven detrás del toggle para no ocupar la strip */}
        {inactivos.length > 0 && (
          <>
            {showAll &&
              inactivos.map((p) => (
                <ProjectRow
                  key={p.slug}
                  project={p}
                  selected={selected === p.slug}
                  onSelect={onSelect}
                />
              ))}
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              aria-expanded={showAll}
              className="block w-full px-2 pt-1 text-left text-2xs tracking-label text-text-dim transition-colors hover:text-cyan"
            >
              {showAll ? "◂ SOLO ACTIVOS" : `VER TODOS (${inactivos.length}) →`}
            </button>
          </>
        )}
      </div>
    </Panel>
  );
}
