/**
 * Estado global mínimo de la app (sin librería externa: Context + useState).
 * Comparte: lista de proyectos, tab activo, proyecto en foco y overlay de
 * Ajustes — lo que las client tools de voz necesitan para "manejar la interfaz".
 */
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import * as api from "./hermes";
import { subscribeConfig } from "./config";
import type { ProjectStatus } from "./types";

export type Tab = "voz" | "reuniones" | "proyectos" | "tareas";

interface Store {
  projects: ProjectStatus[];
  projectsLoading: boolean;
  refreshProjects: () => Promise<void>;
  online: boolean | null;
  machine: string | null;

  tab: Tab;
  setTab: (t: Tab) => void;

  focused: string | null;
  setFocused: (slug: string | null) => void;

  settingsOpen: boolean;
  setSettingsOpen: (v: boolean) => void;

  /** Resuelve lo que dice la voz ("careways", "el de salud") a un slug real. */
  resolveSlug: (raw?: string) => string | null;
}

const Ctx = createContext<Store | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [projects, setProjects] = useState<ProjectStatus[]>([]);
  const [projectsLoading, setLoading] = useState(true);
  const [online, setOnline] = useState<boolean | null>(null);
  const [machine, setMachine] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("voz");
  const [focused, setFocused] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const refreshProjects = useCallback(async () => {
    setLoading(true);
    try {
      const [ps, h] = await Promise.all([api.projects(), api.health().catch(() => null)]);
      setProjects(ps);
      setOnline(true);
      if (h?.machine) setMachine(h.machine);
    } catch {
      setOnline(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshProjects();
    // Al cambiar la config (Ajustes) reintenta contra el nuevo agente.
    return subscribeConfig(() => void refreshProjects());
  }, [refreshProjects]);

  const resolveSlug = useCallback(
    (raw?: string): string | null => {
      const q = (raw ?? "").trim().toLowerCase();
      if (!q) return null;
      const m =
        projects.find((p) => p.slug.toLowerCase() === q) ??
        projects.find((p) => p.name.toLowerCase() === q) ??
        projects.find(
          (p) => p.name.toLowerCase().includes(q) || q.includes(p.slug.toLowerCase()),
        );
      return m?.slug ?? null;
    },
    [projects],
  );

  const value: Store = {
    projects,
    projectsLoading,
    refreshProjects,
    online,
    machine,
    tab,
    setTab,
    focused,
    setFocused,
    settingsOpen,
    setSettingsOpen,
    resolveSlug,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): Store {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp fuera de AppProvider");
  return v;
}
