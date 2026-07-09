"use client";

import { useCallback, useEffect, useState } from "react";
import type { Task } from "@hermes/shared";
import { listTasks } from "@/lib/hermes";

/** Polling del tablero de tareas (global o filtrado por proyecto). */
export function useTasks(project?: string | null) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const t = await listTasks({ project: project ?? undefined });
    setTasks(t);
    setLoading(false);
    return t;
  }, [project]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const tick = async () => {
      const t = await listTasks({ project: project ?? undefined });
      if (alive) {
        setTasks(t);
        setLoading(false);
      }
    };
    void tick();
    const iv = setInterval(tick, 5000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [project]);

  return { tasks, loading, refresh: load };
}
