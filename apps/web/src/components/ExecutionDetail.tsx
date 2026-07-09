"use client";

import { useEffect, useState } from "react";
import type { TaskExecution } from "@hermes/shared";
import { getTaskExecution } from "@/lib/hermes";
import { Markdown } from "./Markdown";

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
        className="mb-2 flex w-fit items-center gap-1.5 text-[10px] tracking-[0.2em] uppercase transition-colors hover:opacity-100"
        style={{ color: "var(--text-dim)" }}
      >
        ← Ejecuciones
      </button>

      {loading && (
        <p className="pt-6 text-center text-[10px] tracking-[0.25em] pulse-dot" style={{ color: "var(--text-dim)" }}>
          CARGANDO EJECUCIÓN…
        </p>
      )}

      {!loading && !exec && (
        <p className="pt-6 text-center text-[10.5px]" style={{ color: "var(--text-dim)" }}>
          No se pudo cargar la ejecución.
        </p>
      )}

      {exec && (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[9px] tracking-[0.14em] uppercase" style={{ color: "var(--text-dim)" }}>
            <span style={{ color: exec.status === "done" ? "var(--green)" : "var(--red)" }}>
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
