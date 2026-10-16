"use client";

// Tablero Linear-first del tab TAREAS. Linear es la verdad: aquí solo se
// proyectan los issues (lista agrupada por estado, patrón Linear/Mobbin) y se
// decide cuáles ejecuta Claude Code. La ejecución reusa el motor existente
// vía la fila-puente local (ver linear-run.ts del agente).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProjectStatus, Task } from "@hermes/shared";
import {
  createLinearTask,
  executeLinearIssue,
  getLinearBoard,
  getTask,
  type LinearBoardIssue,
  type RunRef,
} from "@/lib/hermes";
import { PanelState } from "@/components/ui/PanelState";
import { ViewHeader } from "@/components/ui/ViewHeader";
import { Button } from "@/components/ui/Button";

const POLL_MS = 15_000; // API remota de Linear: poll sereno + refresh tras cada acción

// Estado del grupo = icono de estado estilo Linear (anillo vacío, punteado,
// a medias, check). El color es ESTADO: cyan en curso, verde hecho; lo que
// todavía no empieza va en gris.
const GROUPS: { type: string; label: string }[] = [
  { type: "started", label: "En curso" },
  { type: "unstarted", label: "Por hacer" },
  { type: "backlog", label: "Backlog" },
  { type: "completed", label: "Hecho" },
];

export function StateIcon({ type }: { type: string }) {
  const common = {
    width: 14,
    height: 14,
    viewBox: "0 0 14 14",
    fill: "none",
    "aria-hidden": true,
    className: "shrink-0",
  } as const;
  if (type === "started")
    return (
      <svg {...common} className="shrink-0 text-cyan">
        <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M7 3.5a3.5 3.5 0 0 1 0 7z" fill="currentColor" />
      </svg>
    );
  if (type === "completed")
    return (
      <svg {...common} className="shrink-0 text-green">
        <circle cx="7" cy="7" r="6" fill="currentColor" />
        <path
          d="m4.5 7.2 1.7 1.6 3.3-3.4"
          stroke="var(--color-bg)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  if (type === "backlog")
    return (
      <svg {...common} className="shrink-0 text-text-faint">
        <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2.2 2" />
      </svg>
    );
  return (
    <svg {...common} className="shrink-0 text-text-dim">
      <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** "hace 3d" compacto para la columna de fecha (estilo Linear). */
function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/** Icono de prioridad estilo Linear: barras 1-3 o señal de urgente. */
export function PriorityIcon({ priority }: { priority: number }) {
  if (priority === 1)
    return (
      <svg width="12" height="12" viewBox="0 0 12 12" className="shrink-0 text-red" aria-hidden>
        <title>Urgente</title>
        <rect x="0.5" y="0.5" width="11" height="11" rx="3" fill="currentColor" opacity="0.9" />
        <path d="M6 3v3.6M6 8.6v.1" stroke="var(--color-bg)" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  const bars = priority === 2 ? 3 : priority === 3 ? 2 : priority === 4 ? 1 : 0;
  const title = ["Sin prioridad", "Urgente", "Alta", "Media", "Baja"][priority] ?? "—";
  return (
    <svg width="12" height="10" viewBox="0 0 12 10" className="shrink-0" aria-hidden>
      <title>{title}</title>
      {[0, 1, 2].map((i) => (
        <rect
          key={i}
          x={i * 4.5}
          y={6 - i * 3}
          width="3"
          height={4 + i * 3}
          rx="0.5"
          className={i < bars ? "fill-text-dim" : "fill-line"}
        />
      ))}
    </svg>
  );
}

export function LinearBoard({
  projects,
  selectedId,
  onSelect,
  onOpenTask,
  onRun,
}: {
  projects: ProjectStatus[];
  selectedId: string | null;
  onSelect: (issue: LinearBoardIssue) => void;
  /** Abre el run vivo de la fila-puente en la consola principal. */
  onOpenTask: (task: Task) => void;
  onRun: (task: Task, run: RunRef) => void;
}) {
  const [filter, setFilter] = useState<string>(""); // "" = todos
  const [issues, setIssues] = useState<LinearBoardIssue[]>([]);
  const [available, setAvailable] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [doneOpen, setDoneOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [creating, setCreating] = useState<string | null>(null);
  const [execBusy, setExecBusy] = useState<string | null>(null);
  const filterRef = useRef(filter);
  filterRef.current = filter;

  const refresh = useCallback(async () => {
    const board = await getLinearBoard(filterRef.current || undefined);
    setAvailable(board.available);
    setIssues(board.issues);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(t);
  }, [refresh, filter]);

  const groups = useMemo(() => {
    const map = new Map<string, LinearBoardIssue[]>(GROUPS.map((g) => [g.type, []]));
    for (const i of issues) {
      // running local manda: un issue ejecutándose se lee "En curso" aunque
      // Linear aún no refleje el cambio de estado.
      const type = i.local?.status === "running" ? "started" : i.state.type;
      map.get(map.has(type) ? type : "backlog")!.push(i);
    }
    return map;
  }, [issues]);

  const exec = async (i: LinearBoardIssue) => {
    setExecBusy(i.identifier);
    try {
      const run = await executeLinearIssue(i.identifier);
      if (!run) return;
      const task = await getTask(run.taskId);
      await refresh();
      if (task) onRun(task, run);
    } finally {
      setExecBusy(null);
    }
  };

  const openStream = async (i: LinearBoardIssue) => {
    if (!i.local) return;
    const task = await getTask(i.local.task_id);
    if (task) onOpenTask(task);
  };

  const create = async () => {
    const instruction = newTitle.trim();
    if (!instruction) return;
    setCreating("Hermes está creando el issue con contexto…");
    setNewTitle("");
    const ok = await createLinearTask(instruction, filter || undefined);
    setCreating(ok ? "Issue en camino — aparecerá aquí al terminar Hermes." : "No se pudo encargar a Hermes.");
    setTimeout(() => setCreating(null), 6000);
  };

  const activeProjects = projects.filter((p) => p.estado === "activo");
  const filterName = activeProjects.find((p) => p.slug === filter)?.name ?? filter;

  // Datos reales para la cabecera: cuántos issues hay en lo que estás viendo.
  const meta = loaded && available ? `${issues.length} ${issues.length === 1 ? "issue" : "issues"}` : undefined;

  if (loaded && !available) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <ViewHeader title="Tareas" />
        <PanelState
          kind="empty"
          title="Linear no configurado"
          hint="Agrega LINEAR_API_KEY al .env de la raíz y reinicia el agente para activar el tablero."
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ViewHeader
        title="Tareas"
        meta={meta}
        actions={
          // Nueva tarea vía Hermes: él la redacta en Linear con contexto real.
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder={filter ? `Nueva tarea en ${filterName}…` : "Nueva tarea — Hermes la redacta…"}
              aria-label="Nueva tarea para Linear"
              title="Hermes crea el issue en Linear con contexto del proyecto"
              className="h-8 w-[300px] max-w-[46vw] min-w-0 rounded-sm border border-line bg-panel px-3 text-sm text-text outline-none transition-colors placeholder:text-text-faint focus:border-line-2"
            />
            <Button
              type="submit"
              variant="primary"
              size="md"
              disabled={!newTitle.trim()}
              icon={
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  aria-hidden
                >
                  <path d="M12 5v14M5 12h14" />
                </svg>
              }
            >
              Crear issue
            </Button>
          </form>
        }
      />

      {/* Filtro por proyecto: UNA fila con scroll horizontal (la rueda vertical
          también la desplaza). min-w-0 en el contenedor: sin eso los 13 chips
          fijaban el ancho mínimo y empujaban la vista fuera de la pantalla. */}
      <div className="flex min-w-0 shrink-0 items-center gap-3">
        <div
          className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [mask-image:linear-gradient(to_right,black_calc(100%-40px),transparent)] [&::-webkit-scrollbar]:hidden"
          onWheel={(e) => {
            if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY;
          }}
        >
          <FilterChip label="Todos" active={!filter} onClick={() => setFilter("")} />
          {/* Solo proyectos ACTIVOS: son el espejo 1:1 con los proyectos de Linear. */}
          {activeProjects.map((p) => (
            <FilterChip
              key={p.slug}
              label={p.name}
              active={filter === p.slug}
              onClick={() => setFilter(p.slug)}
            />
          ))}
          <span aria-hidden className="w-8 shrink-0" />
        </div>
      </div>
      {creating && (
        <p className="mt-2 flex items-center gap-2 px-1 text-xs text-text-dim">
          <span aria-hidden className="pulse-dot h-1.5 w-1.5 rounded-full bg-cyan" />
          {creating}
        </p>
      )}

      {/* Lista agrupada por estado (patrón Linear) */}
      <div className="-mx-2 mt-3 min-h-0 flex-1 overflow-y-auto px-2">
        {!loaded && <PanelState kind="loading" title="Cargando tablero…" />}
        {loaded &&
          GROUPS.map((g) => {
            const rows = groups.get(g.type) ?? [];
            if (!rows.length && g.type !== "unstarted") return null;
            const collapsible = g.type === "completed";
            const collapsed = collapsible && !doneOpen;
            return (
              <section key={g.type} className="mb-4">
                <button
                  type="button"
                  onClick={() => collapsible && setDoneOpen((v) => !v)}
                  aria-expanded={collapsible ? !collapsed : undefined}
                  className={`flex h-8 w-full items-center gap-2 rounded-sm bg-hover px-2 text-left ${
                    collapsible ? "cursor-pointer hover:bg-selected" : "cursor-default"
                  }`}
                >
                  <StateIcon type={g.type} />
                  <span className="text-xs font-medium text-text">{g.label}</span>
                  <span className="text-xs text-text-faint tabular-nums">{rows.length}</span>
                  {collapsible && (
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                      className={`ml-auto text-text-faint transition-transform ${collapsed ? "-rotate-90" : ""}`}
                    >
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  )}
                </button>
                {!collapsed && (
                  <div className="mt-0.5">
                    {rows.length === 0 && (
                      <p className="px-2 py-2 text-xs text-text-faint">
                        Sin issues por hacer — crea uno arriba o pídeselo a Hermes en la consola.
                      </p>
                    )}
                    {rows.map((i) => (
                      <IssueRow
                        key={i.identifier}
                        issue={i}
                        active={i.identifier === selectedId}
                        showProject={!filter}
                        busy={execBusy === i.identifier}
                        onSelect={() => onSelect(i)}
                        onExec={() => void exec(i)}
                        onStream={() => void openStream(i)}
                      />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
      </div>
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  // Seleccionado = capa neutra (no acento): el acento es para acciones.
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`h-7 shrink-0 cursor-pointer rounded-full border px-3 text-xs whitespace-nowrap transition-colors ${
        active
          ? "border-line-2 bg-selected font-medium text-text"
          : "border-line text-text-dim hover:bg-hover hover:text-text"
      }`}
    >
      {label}
    </button>
  );
}

function IssueRow({
  issue,
  active,
  showProject,
  busy,
  onSelect,
  onExec,
  onStream,
}: {
  issue: LinearBoardIssue;
  active: boolean;
  showProject: boolean;
  busy: boolean;
  onSelect: () => void;
  onExec: () => void;
  onStream: () => void;
}) {
  const running = issue.local?.status === "running";
  const done = issue.state.type === "completed";
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => e.key === "Enter" && onSelect()}
      className={`group flex h-9 min-w-0 cursor-pointer items-center gap-3 rounded-sm px-2 transition-colors ${
        active ? "bg-selected" : "hover:bg-hover"
      }`}
    >
      <PriorityIcon priority={issue.priority} />
      <span className="w-14 shrink-0 font-mono text-2xs text-text-faint">{issue.identifier}</span>
      <span className={`min-w-0 flex-1 truncate text-sm ${done ? "text-text-dim" : "text-text"}`}>
        {issue.title}
      </span>
      {running && (
        <span
          className="flex shrink-0 items-center gap-1.5 text-2xs text-text-dim"
          title="Claude Code ejecutando"
        >
          <span aria-hidden className="pulse-dot h-1.5 w-1.5 rounded-full bg-cyan" />
          Ejecutando
        </span>
      )}
      {/* Indicador de "Copy prompt listo" en una celda fija: así el proyecto
          de cada fila arranca en la misma columna. */}
      <span className="flex w-4 shrink-0 justify-center text-text-faint">
        {issue.hasPrompt && !running && (
          <span title="Copy prompt listo para ejecutar">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-label="Copy prompt listo"
            >
              <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
              <path d="m7.5 9.5 2.8 2.5-2.8 2.5M13 15h3.5" />
            </svg>
          </span>
        )}
      </span>
      {showProject && (
        <span className="hidden w-[150px] shrink-0 sm:flex">
          {issue.project && (
            <span className="inline-flex h-5 max-w-full items-center rounded-full border border-line px-2 text-2xs text-text-dim">
              <span className="truncate">{issue.project.name}</span>
            </span>
          )}
        </span>
      )}
      {/* Fecha y acciones comparten la celda final: al hover las acciones
          reemplazan la fecha sin empujar el resto de la fila. */}
      <span className="relative flex h-full w-[68px] shrink-0 items-center justify-end">
        <span className="text-2xs text-text-faint tabular-nums transition-opacity group-focus-within:opacity-0 group-hover:opacity-0">
          {ago(issue.updatedAt)}
        </span>
        <span
          className="absolute inset-y-0 right-0 flex items-center gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
          onClick={(e) => e.stopPropagation()}
        >
          {running ? (
            <RowAct title="Ver el run en vivo" onClick={onStream}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
                <circle cx="12" cy="12" r="2.5" />
              </svg>
            </RowAct>
          ) : (
            !done && (
              <RowAct title="Ejecutar con Claude Code" onClick={onExec} disabled={busy}>
                {busy ? (
                  <span aria-hidden className="pulse-dot h-1.5 w-1.5 rounded-full bg-current" />
                ) : (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                    <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" />
                  </svg>
                )}
              </RowAct>
            )
          )}
          <a
            href={issue.url}
            target="_blank"
            rel="noreferrer"
            title="Abrir en Linear"
            aria-label="Abrir en Linear"
            className="grid h-7 w-7 place-items-center rounded-xs text-text-faint transition-colors hover:bg-selected hover:text-text"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M7 17 17 7M9 7h8v8" />
            </svg>
          </a>
        </span>
      </span>
    </div>
  );
}

function RowAct({
  title,
  onClick,
  disabled,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className="grid h-7 w-7 cursor-pointer place-items-center rounded-xs text-text-dim transition-colors hover:bg-selected hover:text-text disabled:cursor-default"
    >
      {children}
    </button>
  );
}
