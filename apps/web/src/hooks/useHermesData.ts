"use client";

import { useEffect, useState } from "react";
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

/** Polling ligero de stats + proyectos + memorias recientes. */
export function useHermesData() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [projects, setProjects] = useState<ProjectStatus[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [online, setOnline] = useState(false);

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
        setStats(s);
        setProjects(p);
        setMemories(m);
        setOnline(true);
      } catch {
        if (alive) setOnline(false);
      }
    };
    void load();
    const interval = setInterval(load, 10_000);
    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, []);

  return { stats, projects, memories, online };
}
