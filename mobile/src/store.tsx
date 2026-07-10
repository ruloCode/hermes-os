/**
 * Estado global mínimo de la app (sin librería externa: Context + useState).
 * Comparte: sesión (login Supabase), lista de proyectos, tab activo, proyecto
 * en foco y overlay de Ajustes. Arranque en dos fases: hidratar config+sesión
 * de AsyncStorage → resolver base URL (LAN vs túnel) → cargar proyectos.
 */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import * as api from "./hermes";
import { getBase, getKey, loadConfig, resolveBase, subscribeConfig } from "./config";
import {
  getSession,
  loadSession,
  signIn as authSignIn,
  signOut as authSignOut,
  subscribeAuth,
} from "./auth";
import type { ProjectStatus } from "./types";

export type Tab = "voz" | "reuniones" | "proyectos" | "tareas" | "finanzas";

interface Store {
  projects: ProjectStatus[];
  projectsLoading: boolean;
  refreshProjects: () => Promise<void>;
  /** Re-resuelve la base (LAN/túnel) y recarga. Para pull-to-refresh y volver del background. */
  reconnect: () => Promise<void>;
  online: boolean | null;
  machine: string | null;
  agentBase: string;

  /** null = hidratando storage (splash); false = mostrar login. */
  authed: boolean | null;
  email: string | null;
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;

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
  const [agentBase, setAgentBase] = useState(getBase());
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("voz");
  const [focused, setFocused] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const booted = useRef(false);

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

  const reconnect = useCallback(async () => {
    await resolveBase();
    await refreshProjects();
  }, [refreshProjects]);

  // Arranque: hidratar storage → login gate → resolver base → proyectos.
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    void (async () => {
      await loadConfig();
      await loadSession();
      const s = getSession();
      setAuthed(!!s);
      setEmail(s?.email ?? null);
      // Sin sesión pero con API key manual (modo LAN heredado) también entra.
      if (s || getKey()) void reconnect();
    })();

    const unsubConfig = subscribeConfig(() => {
      setAgentBase(getBase());
    });
    const unsubAuth = subscribeAuth(() => {
      const s = getSession();
      setAuthed(!!s);
      setEmail(s?.email ?? null);
    });
    // Volver del background (posiblemente en otra red) → re-resolver la base.
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active" && (getSession() || getKey())) void reconnect();
    });
    return () => {
      unsubConfig();
      unsubAuth();
      sub.remove();
    };
  }, [reconnect]);

  const signIn = useCallback(
    async (mail: string, password: string): Promise<string | null> => {
      const err = await authSignIn(mail, password);
      if (!err) void reconnect();
      return err;
    },
    [reconnect],
  );

  const signOut = useCallback(async () => {
    await authSignOut();
    setProjects([]);
    setOnline(null);
  }, []);

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
    reconnect,
    online,
    machine,
    agentBase,
    authed,
    email,
    signIn,
    signOut,
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
