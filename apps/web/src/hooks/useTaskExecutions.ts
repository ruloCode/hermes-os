"use client";

import { useCallback, useEffect, useState } from "react";
import type { TaskExecutionSummary } from "@hermes/shared";
import { listTaskExecutions } from "@/lib/hermes";

/**
 * Historial de ejecuciones de una tarea (memoria del tracker). Poll suave: una
 * ejecución nueva aparece unos segundos después de terminar el run (el análisis
 * lo redacta un pase LLM), así que refrescamos periódicamente mientras la tarea
 * está enfocada. Sin taskId, no consulta.
 */
export function useTaskExecutions(taskId: number | null | undefined) {
  const [executions, setExecutions] = useState<TaskExecutionSummary[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (taskId == null) {
      setExecutions([]);
      return [];
    }
    const list = await listTaskExecutions(taskId);
    setExecutions(list);
    setLoading(false);
    return list;
  }, [taskId]);

  useEffect(() => {
    if (taskId == null) {
      setExecutions([]);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    const tick = async () => {
      const list = await listTaskExecutions(taskId);
      if (alive) {
        setExecutions(list);
        setLoading(false);
      }
    };
    void tick();
    const iv = setInterval(tick, 6000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [taskId]);

  return { executions, loading, refresh: load };
}
