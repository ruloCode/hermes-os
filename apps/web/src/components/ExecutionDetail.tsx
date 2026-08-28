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
        className="mb-2 flex w-fit items-center gap-1.5 text-2xs tracking-label text-text-dim uppercase transition-colors hover:text-text"
      >
        ← Ejecuciones
      </button>

      {loading && <PanelState kind="loading" compact />}

      {!loading && !exec && <PanelState kind="error" title="No se pudo cargar la ejecución" />}

      {exec && (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-2xs tracking-label text-text-dim uppercase">
            <span className={exec.status === "done" ? "text-green" : "text-red"}>
              ● {exec.status === "done" ? "hecha" : "error"}
            </span>
            <span>▸ {exec.kind === "continue" ? "continuación" : "ejecución"}</span>
            <span>◷ {exec.created_at.slice(0, 16).replace("T", " ")}</span>
            {exec.cost_usd != null && <span>${exec.cost_usd.toFixed(2)}</span>}
            {exec.duration_ms != null && <span>⧗ {Math.round(exec.duration_ms / 1000)}s</span>}
            {exec.num_turns != null && <span>↺ {exec.num_turns} turnos</span>}
            {exec.model && <span>{exec.model}</span>}
          </div>

          <Markdown source={exec.markdown} />
        </div>
      )}
    </div>
  );
}
