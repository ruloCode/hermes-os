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

const POLL_MS = 15_000; // API remota de Linear: poll sereno + refresh tras cada acción

const GROUPS: { type: string; label: string; dot: string }[] = [
  { type: "started", label: "En curso", dot: "text-cyan" },
  { type: "unstarted", label: "Por hacer", dot: "text-violet" },
  { type: "backlog", label: "Backlog", dot: "text-text-dim" },
  { type: "completed", label: "Hecho", dot: "text-green" },
];

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
      <span title="Urgente" className="text-red text-2xs leading-none font-semibold">
        ▲
      </span>
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

  if (loaded && !available) {
    return (
      <PanelState
        kind="empty"
        title="Linear no configurado"
        hint="Agrega LINEAR_API_KEY al .env de la raíz y reinicia el agente para activar el tablero."
      />
    );
  }

  return (
    <div className="flex h-full flex-col gap-2">
      {/* Toolbar: chips de proyecto + nueva tarea vía Hermes. El pr-24 deja
          libre la esquina del orbe de Hermes (dock flotante del shell). */}
      <div className="flex flex-wrap items-center gap-2 pr-24">
        <div className="flex max-w-full items-center gap-1 overflow-x-auto">
          <FilterChip label="Todos" active={!filter} onClick={() => setFilter("")} />
          {/* Solo proyectos ACTIVOS: son el espejo 1:1 con los proyectos de Linear. */}
          {projects.filter((p) => p.estado === "activo").map((p) => (
            <FilterChip
              key={p.slug}
              label={p.name}
              active={filter === p.slug}
              onClick={() => setFilter(p.slug)}
            />
          ))}
        </div>
        <div className="flex min-w-[220px] flex-1 items-center gap-2">
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void create()}
            placeholder={
              filter
                ? `Nueva tarea de ${filter} — Hermes la crea en Linear con contexto…`
                : "Nueva tarea — Hermes la crea en Linear con contexto…"
            }
            className="min-w-0 flex-1 rounded-sm border border-line bg-transparent px-2 py-1 text-xs text-text outline-none transition-colors focus:border-line-2"
          />
          <button
            type="button"
            onClick={() => void create()}
            disabled={!newTitle.trim()}
            className="cmd-btn !w-auto !border-violet !text-violet disabled:opacity-40"
          >
            + Issue
          </button>
        </div>
      </div>
      {creating && <p className="px-1 text-2xs tracking-label text-cyan">{creating}</p>}

      {/* Lista agrupada por estado (patrón Linear) */}
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {!loaded && <PanelState kind="loading" title="Cargando tablero…" />}
        {loaded &&
          GROUPS.map((g) => {
            const rows = groups.get(g.type) ?? [];
            if (!rows.length && g.type !== "unstarted") return null;
            const collapsed = g.type === "completed" && !doneOpen;
            return (
              <section key={g.type} className="mb-2">
                <button
                  type="button"
                  onClick={() => g.type === "completed" && setDoneOpen((v) => !v)}
                  className={`flex w-full items-center gap-2 rounded-sm bg-panel-2 px-2 py-1 text-left ${
                    g.type === "completed" ? "cursor-pointer" : "cursor-default"
                  }`}
                >
                  <span className={`text-2xs ${g.dot}`}>●</span>
                  <span className="text-2xs font-semibold tracking-label text-text uppercase">
                    {g.label}
                  </span>
                  <span className="text-2xs text-text-dim tabular-nums">{rows.length}</span>
                  {g.type === "completed" && (
                    <span className="ml-auto text-2xs text-text-dim">{collapsed ? "▸" : "▾"}</span>
                  )}
                </button>
                {!collapsed && (
                  <div>
                    {rows.length === 0 && (
                      <p className="px-2 py-1.5 text-2xs tracking-label text-text-dim">
                        Sin issues — crea uno arriba o desde la consola.
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
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 rounded-sm border px-2 py-0.5 text-2xs tracking-label uppercase transition-colors ${
        active
          ? "border-violet bg-violet/10 text-violet"
          : "border-line text-text-dim hover:border-line-2 hover:text-text"
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
      className={`group flex cursor-pointer items-center gap-2 border-b border-line/50 px-2 py-1.5 transition-colors ${
        active ? "bg-violet/10" : "hover:bg-panel-2"
      }`}
    >
      <PriorityIcon priority={issue.priority} />
      <span className="w-14 shrink-0 font-mono text-2xs text-text-dim">{issue.identifier}</span>
      <span className={`min-w-0 flex-1 truncate text-xs ${done ? "text-text-dim" : "text-text"}`}>
        {issue.title}
      </span>
      {running && (
        <span className="pulse-dot shrink-0 text-2xs text-cyan" title="Claude Code ejecutando">
          ●
        </span>
      )}
      {issue.hasPrompt && !running && (
        <span className="shrink-0 text-2xs text-violet" title="Copy prompt listo para ejecutar">
          ⚡
        </span>
      )}
      {showProject && issue.project && (
        <span className="hidden shrink-0 text-2xs tracking-label text-cyan uppercase sm:inline">
          {issue.project.name}
        </span>
      )}
      <span className="w-7 shrink-0 text-right text-2xs text-text-dim tabular-nums">
        {ago(issue.updatedAt)}
      </span>
      {/* Acciones al hover (Linear-style) */}
      <span
        className="hidden shrink-0 items-center gap-1 group-hover:flex"
        onClick={(e) => e.stopPropagation()}
      >
        {running ? (
          <RowAct label="stream" tone="cyan" title="Ver el run en vivo" onClick={onStream} />
        ) : (
          !done && (
            <RowAct
              label={busy ? "…" : "▶"}
              tone="green"
              title="Ejecutar con Claude Code"
              onClick={onExec}
            />
          )
        )}
        <a
          href={issue.url}
          target="_blank"
          rel="noreferrer"
          title="Abrir en Linear"
          className="rounded-sm border border-line px-1.5 py-0.5 text-2xs text-text-dim transition-colors hover:border-line-2 hover:text-text"
        >
          ↗
        </a>
      </span>
    </div>
  );
}

const ROW_ACT = {
  green: "border-green text-green",
  cyan: "border-cyan text-cyan",
} as const;

function RowAct({
  label,
  tone,
  title,
  onClick,
}: {
  label: string;
  tone: keyof typeof ROW_ACT;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`rounded-sm border bg-panel-2 px-1.5 py-0.5 text-2xs tracking-label uppercase ${ROW_ACT[tone]}`}
    >
      {label}
    </button>
  );
}
