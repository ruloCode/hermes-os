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
import { Button } from "@/components/ui/Button";
import { PanelState } from "@/components/ui/PanelState";
import { PriorityIcon, StateIcon } from "@/components/LinearBoard";
import { useWorkspace } from "@/state/WorkspaceContext";

const PROJECT_SLUG = "ingles";
const POLL_MS = 30_000; // API remota de Linear: poll sereno

// v5: el estado de cada issue con el MISMO icono del tablero de Tareas (antes
// un "●" de color propio por estado, con "sin empezar" pintado de acento), el
// alta con un campo de 32px como los del resto de la app, y las acciones de
// fila como iconos fantasma que aparecen al pasar el mouse.

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
    <div className="flex h-full min-h-0 flex-col gap-2">
      <form
        className="flex shrink-0 items-center gap-1.5 px-0.5"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Nueva tarea de inglés…"
          title="Hermes la crea en Linear con contexto y Copy prompt"
          className="h-8 min-w-0 flex-1 rounded-sm border border-line bg-panel px-3 text-sm text-text outline-none transition-colors placeholder:text-text-faint focus:border-line-2"
        />
        <Button type="submit" size="md" disabled={!title.trim()} title="Crear con Hermes">
          Crear
        </Button>
      </form>
      {note && <p className="shrink-0 px-2 text-xs text-text-faint">{note}</p>}

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
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
              className="group flex min-h-8 items-center gap-2 rounded-sm px-2 py-1 transition-colors hover:bg-hover"
            >
              <span title={i.state.name} className="flex shrink-0">
                <StateIcon type={i.state.type} />
              </span>
              <PriorityIcon priority={i.priority} />
              <span
                className={`min-w-0 flex-1 truncate text-sm ${done ? "text-text-faint line-through" : "text-text"}`}
              >
                {i.title}
              </span>
              {running && (
                <span
                  className="pulse-dot h-1.5 w-1.5 shrink-0 rounded-full bg-cyan"
                  title="Claude Code ejecutando"
                />
              )}
              {i.hasPrompt && !running && !done && (
                <button
                  type="button"
                  onClick={() => void exec(i)}
                  disabled={execBusy === i.identifier}
                  title="Ejecutar con Claude Code"
                  aria-label="Ejecutar con Claude Code"
                  className="grid h-6 w-6 shrink-0 cursor-pointer place-items-center rounded-xs text-text-faint opacity-0 transition-[opacity,color,background-color] group-hover:opacity-100 hover:bg-hover hover:text-text focus-visible:opacity-100 disabled:opacity-40"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                    <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" />
                  </svg>
                </button>
              )}
              <a
                href={i.url}
                target="_blank"
                rel="noreferrer"
                title={`${i.identifier} en Linear`}
                aria-label={`Abrir ${i.identifier} en Linear`}
                className="grid h-6 w-6 shrink-0 place-items-center rounded-xs text-text-faint transition-colors hover:bg-hover hover:text-text"
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M7 17 17 7M8 7h9v9" />
                </svg>
              </a>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => ws.showPanel("tareas")}
        className="flex h-7 shrink-0 cursor-pointer items-center gap-1 self-start rounded-xs px-2 text-xs text-text-dim transition-colors hover:bg-hover hover:text-text"
      >
        Ver el tablero completo
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
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
      </button>
    </div>
  );
}
