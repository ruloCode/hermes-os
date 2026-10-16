"use client";

import { useEffect, useState } from "react";
import type { TaskExecution } from "@hermes/shared";
import { getTaskExecution } from "@/lib/hermes";
import { Markdown } from "./Markdown";
import { PanelState } from "@/components/ui/PanelState";

/**
 * Detalle legible de UNA ejecución de tarea: metadata (costo · duración · turnos
 * · modelo) + el documento markdown {Prompt · Análisis · Resultado} renderizado.
 * Es la memoria curada, hermana del stream crudo del terminal.
 */
export function ExecutionDetail({
  project,
  id,
  onBack,
}: {
  project: string;
  id: string;
  onBack: () => void;
}) {
  const [exec, setExec] = useState<TaskExecution | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getTaskExecution(project, id).then((e) => {
      if (!alive) return;
      setExec(e);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [project, id]);

  return (
    <div className="flex h-full flex-col">
      <button
        type="button"
        onClick={onBack}
        className="-ml-1 mb-2 flex h-7 w-fit cursor-pointer items-center gap-1 rounded-xs pr-2 pl-1 text-xs text-text-dim transition-colors hover:bg-hover hover:text-text"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m15 18-6-6 6-6" />
        </svg>
        Ejecuciones
      </button>

      {loading && <PanelState kind="loading" compact />}

      {!loading && !exec && <PanelState kind="error" title="No se pudo cargar la ejecución" />}

      {exec && (
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          {/* Metadatos reales: el estado va en el punto; lo demás, gris. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-dim">
            <span className="inline-flex items-center gap-1.5">
              <span
                aria-hidden
                className={`h-1.5 w-1.5 rounded-full ${exec.status === "done" ? "bg-green" : "bg-red"}`}
              />
              {exec.status === "done" ? "Hecha" : "Error"}
            </span>
            <span>{exec.kind === "continue" ? "Continuación" : "Ejecución"}</span>
            <span className="font-mono tabular-nums">
              {exec.created_at.slice(0, 16).replace("T", " ")}
            </span>
            {exec.cost_usd != null && (
              <span className="tabular-nums">${exec.cost_usd.toFixed(2)}</span>
            )}
            {exec.duration_ms != null && (
              <span className="tabular-nums">{Math.round(exec.duration_ms / 1000)} s</span>
            )}
            {exec.num_turns != null && (
              <span className="tabular-nums">{exec.num_turns} turnos</span>
            )}
            {exec.model && <span className="font-mono text-2xs">{exec.model}</span>}
          </div>

          <Markdown source={exec.markdown} />
        </div>
      )}
    </div>
  );
}
