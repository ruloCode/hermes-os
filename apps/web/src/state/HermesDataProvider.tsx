"use client";

// Poll ÚNICO de stats + proyectos + memorias para toda la app. Antes cada
// página montaba su propio useHermesData (poll duplicado y estado que se
// perdía al navegar); ahora vive en el shell y todos beben de aquí.

import { createContext, useContext, useEffect, useState } from "react";
import type { Memory, ProjectStatus } from "@hermes/shared";
import { hermesGet } from "@/lib/hermes";

export interface Stats {
  memories: number;
  activeProjects: number;
  totalProjects: number;
  sessionsToday: number;
  tasksToday: number;
  /** Gasto real del día en runs de Claude Code (USD) y cuántos fueron. */
  dailyRunCostUsd?: number;
  runsToday?: number;
  machine: string;
  uptimeSeconds: number;
  supabase: boolean;
  presence: { status: string; currentTask: string | null };
}

export interface HermesData {
  stats: Stats | null;
  projects: ProjectStatus[];
  memories: Memory[];
  online: boolean;
}

const HermesDataContext = createContext<HermesData | null>(null);

export function HermesDataProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<HermesData>({
    stats: null,
    projects: [],
    memories: [],
    online: false,
  });

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [s, p, m] = await Promise.all([
          hermesGet<Stats>("/stats"),
          hermesGet<ProjectStatus[]>("/projects"),
          hermesGet<Memory[]>("/memories/recent"),
        ]);
        if (!alive) return;
        setData({ stats: s, projects: p, memories: m, online: true });
      } catch {
        if (alive) setData((d) => ({ ...d, online: false }));
      }
    };
    void load();
    const interval = setInterval(load, 10_000);
    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, []);

  return <HermesDataContext.Provider value={data}>{children}</HermesDataContext.Provider>;
}

export function useHermesDataContext(): HermesData {
  const ctx = useContext(HermesDataContext);
  if (!ctx) throw new Error("useHermesData requiere <HermesDataProvider> en el árbol");
  return ctx;
}
