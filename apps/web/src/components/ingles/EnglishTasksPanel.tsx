"use client";

// Tareas del proyecto "Inglés" en Linear: proyección compacta del tablero
// (mismo /linear/board del tab TAREAS, filtrado por el proyecto) + alta vía
// Hermes (crea el issue con contexto y Copy prompt) + ejecutar con Claude
// Code reusando la fila-puente (openTaskRun abre el stream en la consola).

import { useCallback, useEffect, useState } from "react";
import {
  createLinearTask,
  executeLinearIssue,
  getLinearBoard,
  getTask,
  type LinearBoardIssue,
} from "@/lib/hermes";
import { PanelState } from "@/components/ui/PanelState";
import { PriorityIcon } from "@/components/LinearBoard";
import { useWorkspace } from "@/state/WorkspaceContext";

const PROJECT_SLUG = "ingles";
const POLL_MS = 30_000; // API remota de Linear: poll sereno

const STATE_DOT: Record<string, string> = {
  started: "text-cyan",
  unstarted: "text-violet",
  backlog: "text-text-dim",
  completed: "text-green",
};

export function EnglishTasksPanel() {
  const ws = useWorkspace();
  const [issues, setIssues] = useState<LinearBoardIssue[]>([]);
  const [available, setAvailable] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [execBusy, setExecBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const board = await getLinearBoard(PROJECT_SLUG);
    setAvailable(board.available);
    // Hechas al final; el resto por actualización reciente (ya viene así).
    setIssues([
      ...board.issues.filter((i) => i.state.type !== "completed"),
      ...board.issues.filter((i) => i.state.type === "completed").slice(0, 3),
    ]);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  const create = async () => {
    const instruction = title.trim();
    if (!instruction) return;
    setTitle("");
    setNote("Hermes está creando el issue con contexto…");
    const ok = await createLinearTask(instruction, PROJECT_SLUG);
    setNote(ok ? "Issue en camino — aparecerá aquí al terminar." : "No se pudo encargar a Hermes.");
    setTimeout(() => setNote(null), 6000);
  };

  const exec = async (i: LinearBoardIssue) => {
    setExecBusy(i.identifier);
    try {
      const run = await executeLinearIssue(i.identifier);
      if (!run) return;
      const task = await getTask(run.taskId);
      await refresh();
      if (task) ws.openTaskRun(task, run);
    } finally {
      setExecBusy(null);
    }
  };

  if (loaded && !available) {
    return (
      <PanelState
        kind="empty"
        compact
        title="Linear no configurado"
        hint="Agrega LINEAR_API_KEY al .env de la raíz y reinicia el agente."
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-1.5">
      <div className="flex shrink-0 items-center gap-1.5">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void create()}
          placeholder="Nueva tarea de inglés — Hermes la crea en Linear…"
          className="min-w-0 flex-1 rounded-sm border border-line bg-transparent px-2 py-1 text-2xs text-text outline-none transition-colors focus:border-line-2"
        />
        <button
          type="button"
          onClick={() => void create()}
          disabled={!title.trim()}
          className="shrink-0 rounded-sm border border-violet px-2 py-1 text-2xs tracking-label text-violet uppercase transition-colors disabled:opacity-40"
        >
          +
        </button>
      </div>
      {note && <p className="shrink-0 text-2xs tracking-label text-cyan">{note}</p>}

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
        {!loaded && <PanelState kind="loading" compact title="Cargando tareas…" />}
        {loaded && issues.length === 0 && (
          <PanelState
            kind="empty"
            compact
            title="Sin tareas del proyecto"
            hint="Crea una arriba o convierte un drill en tarea desde Recomendaciones."
          />
        )}
        {issues.map((i) => {
          const running = i.local?.status === "running";
          const done = i.state.type === "completed";
          return (
            <div
              key={i.identifier}
              className="group flex items-center gap-2 border-b border-line/50 px-1 py-1.5"
            >
              <span className={`text-2xs ${STATE_DOT[i.state.type] ?? "text-text-dim"}`} title={i.state.name}>
                ●
              </span>
              <PriorityIcon priority={i.priority} />
              <span className={`min-w-0 flex-1 truncate text-xs ${done ? "text-text-dim line-through opacity-70" : "text-text"}`}>
                {i.title}
              </span>
              {running && (
                <span className="pulse-dot shrink-0 text-2xs text-cyan" title="Claude Code ejecutando">
                  ●
                </span>
              )}
              {i.hasPrompt && !running && !done && (
                <button
                  type="button"
                  onClick={() => void exec(i)}
                  disabled={execBusy === i.identifier}
                  title="Ejecutar con Claude Code"
                  className="shrink-0 rounded-sm border border-green/50 px-1.5 py-0.5 text-2xs text-green opacity-0 transition-opacity group-hover:opacity-100 disabled:opacity-40"
                >
                  {execBusy === i.identifier ? "…" : "▶"}
                </button>
              )}
              <a
                href={i.url}
                target="_blank"
                rel="noreferrer"
                title={`${i.identifier} en Linear`}
                className="shrink-0 text-2xs text-text-faint transition-colors hover:text-text"
              >
                ↗
              </a>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => ws.showPanel("tareas")}
        className="shrink-0 self-start text-2xs tracking-label text-text-dim uppercase transition-colors hover:text-violet"
      >
        tablero completo →
      </button>
    </div>
  );
}
