"use client";

import { useMemo, useState } from "react";
import type { ProjectStatus, Task, TaskState } from "@hermes/shared";
import {
  createTask,
  executeTask,
  importVaultTasks,
  setTaskStatus,
  type RunRef,
} from "@/lib/hermes";
import { useTasks } from "@/hooks/useTasks";

const COLUMNS: { status: TaskState; label: string; color: string }[] = [
  { status: "pending", label: "Pendiente", color: "var(--amber)" },
  { status: "running", label: "Ejecutando", color: "var(--cyan)" },
  { status: "done", label: "Hecha", color: "var(--green)" },
  { status: "dismissed", label: "Ignorada", color: "var(--text-dim)" },
];

const SOURCE_LABEL: Record<Task["source"], string> = {
  meeting: "junta",
  manual: "manual",
  vault: "vault",
  voice: "voz",
};

export function TaskBoard({
  projects,
  selectedTaskId,
  onSelect,
  onRun,
}: {
  projects: ProjectStatus[];
  selectedTaskId?: number | null;
  onSelect: (task: Task) => void;
  onRun: (task: Task, run: RunRef) => void;
}) {
  const [filter, setFilter] = useState<string>(""); // "" = todos
  const [newTitle, setNewTitle] = useState("");
  const [importing, setImporting] = useState(false);
  const { tasks, refresh } = useTasks(filter || undefined);

  const byStatus = useMemo(() => {
    const map: Record<TaskState, Task[]> = { pending: [], running: [], done: [], dismissed: [] };
    for (const t of tasks) (map[t.status] ??= []).push(t);
    return map;
  }, [tasks]);

  const exec = async (t: Task) => {
    const run = await executeTask(t.id);
    await refresh();
    if (run) onRun({ ...t, status: "running", run_id: run.runId }, run);
  };
  const setStatus = async (t: Task, status: TaskState) => {
    await setTaskStatus(t.id, status);
    await refresh();
  };

  const addManual = async () => {
    const title = newTitle.trim();
    if (!title || !filter) return; // requiere proyecto elegido
    await createTask(filter, title);
    setNewTitle("");
    await refresh();
  };

  const doImport = async () => {
    if (!filter) return;
    setImporting(true);
    await importVaultTasks(filter);
    await refresh();
    setImporting(false);
  };

  return (
    <div className="flex h-full flex-col gap-2">
      {/* Toolbar: filtro + crear + importar */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="rounded-sm border bg-transparent px-2 py-1 text-[11px] outline-none"
          style={{ borderColor: "var(--line)", color: "var(--text)" }}
        >
          <option value="" style={{ background: "var(--bg)" }}>
            Todos los proyectos
          </option>
          {projects.map((p) => (
            <option key={p.slug} value={p.slug} style={{ background: "var(--bg)" }}>
              {p.name}
            </option>
          ))}
        </select>

        <div className="flex min-w-0 flex-1 items-center gap-2">
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void addManual()}
            placeholder={filter ? "Nueva tarea…" : "Elige un proyecto para crear"}
            disabled={!filter}
            className="min-w-0 flex-1 rounded-sm border bg-transparent px-2 py-1 text-[11px] outline-none disabled:opacity-40"
            style={{ borderColor: "var(--line)", color: "var(--text)" }}
          />
          <button
            type="button"
            onClick={() => void addManual()}
            disabled={!filter || !newTitle.trim()}
            className="cmd-btn !w-auto disabled:opacity-40"
            style={{ borderColor: "var(--violet)", color: "var(--violet)" }}
          >
            + Tarea
          </button>
          <button
            type="button"
            onClick={() => void doImport()}
            disabled={!filter || importing}
            title="Importar las Tareas Pendientes escritas en la nota del proyecto"
            className="cmd-btn !w-auto disabled:opacity-40"
            style={{ borderColor: "var(--cyan)", color: "var(--cyan)" }}
          >
            {importing ? "Importando…" : "⇩ Importar vault"}
          </button>
        </div>
      </div>

      {/* Columnas por estado */}
      <div className="grid min-h-0 flex-1 grid-cols-4 gap-2 overflow-hidden">
        {COLUMNS.map((col) => (
          <div key={col.status} className="flex min-h-0 flex-col">
            <div className="mb-1.5 flex items-center justify-between px-1">
              <span
                className="text-[9px] font-semibold tracking-[0.2em] uppercase"
                style={{ color: col.color }}
              >
                {col.label}
              </span>
              <span className="text-[9px]" style={{ color: "var(--text-dim)" }}>
                {byStatus[col.status].length}
              </span>
            </div>
            <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
              {byStatus[col.status].length === 0 && (
                <p className="px-1 pt-2 text-[9px] tracking-[0.15em]" style={{ color: "var(--text-dim)" }}>
                  —
                </p>
              )}
              {byStatus[col.status].map((t) => (
                <TaskCard
                  key={t.id}
                  task={t}
                  active={t.id === selectedTaskId}
                  showProject={!filter}
                  onSelect={() => onSelect(t)}
                  onExec={() => void exec(t)}
                  onComplete={() => void setStatus(t, "done")}
                  onIgnore={() => void setStatus(t, "dismissed")}
                  onReopen={() => void setStatus(t, "pending")}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TaskCard({
  task,
  active,
  showProject,
  onSelect,
  onExec,
  onComplete,
  onIgnore,
  onReopen,
}: {
  task: Task;
  active: boolean;
  showProject: boolean;
  onSelect: () => void;
  onExec: () => void;
  onComplete: () => void;
  onIgnore: () => void;
  onReopen: () => void;
}) {
  const s = task.status;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => e.key === "Enter" && onSelect()}
      className="cursor-pointer rounded-sm border p-1.5 transition-colors"
      style={{
        borderColor: active ? "var(--violet)" : "var(--line)",
        background: active ? "rgba(167,139,250,0.08)" : "rgba(122,132,255,0.03)",
      }}
    >
      <p className="text-[10.5px] leading-snug" style={{ color: "var(--text)" }}>
        {task.title}
      </p>
      <div className="mt-1 flex items-center gap-1.5 text-[8px] tracking-[0.1em] uppercase" style={{ color: "var(--text-dim)" }}>
        {showProject && <span style={{ color: "var(--cyan)" }}>{task.project_slug}</span>}
        <span>· {SOURCE_LABEL[task.source]}</span>
        {s === "running" && <span className="pulse-dot" style={{ color: "var(--cyan)" }}>· ●</span>}
      </div>
      {/* Acciones (stopPropagation para no abrir el detalle) */}
      <div className="mt-1 flex flex-wrap gap-1" onClick={(e) => e.stopPropagation()}>
        {s === "pending" && (
          <>
            <Act label="▶ Ejecutar" color="var(--green)" onClick={onExec} />
            <Act label="✓" color="var(--green)" title="Marcar hecha" onClick={onComplete} />
            <Act label="✕" color="var(--text-dim)" title="Ignorar" onClick={onIgnore} />
          </>
        )}
        {s === "running" && (
          <>
            <Act label="ver stream" color="var(--cyan)" onClick={onSelect} />
            <Act label="✓" color="var(--green)" title="Marcar hecha" onClick={onComplete} />
            <Act label="↩" color="var(--amber)" title="Reabrir (reset a pendiente)" onClick={onReopen} />
          </>
        )}
        {s === "done" && <Act label="↩ reabrir" color="var(--amber)" onClick={onReopen} />}
        {s === "dismissed" && <Act label="↩ reactivar" color="var(--amber)" onClick={onReopen} />}
      </div>
    </div>
  );
}

function Act({
  label,
  color,
  title,
  onClick,
}: {
  label: string;
  color: string;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="rounded-sm border px-1.5 py-0.5 text-[8.5px] tracking-[0.1em] uppercase transition-opacity hover:opacity-100"
      style={{ borderColor: color, color, background: "rgba(122,132,255,0.04)", opacity: 0.85 }}
    >
      {label}
    </button>
  );
}
