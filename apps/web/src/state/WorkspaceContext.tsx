"use client";

// Estado de UI del workspace (antes vivía en app/page.tsx). Al subirlo al
// shell, el foco de proyecto, el tab central y la sesión de Claude sobreviven
// a la navegación entre / y /vida, y la voz puede manejarlos desde cualquier
// vista con un solo registro de tools.

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import type { Task } from "@hermes/shared";
import { claudeStartRun, type ClaudeExecConfig, type RunRef } from "@/lib/hermes";
import { DEFAULT_CLAUDE_CONFIG } from "@/components/ClaudeExecBar";
import type { DetailTarget } from "@/components/TaskDetail";
import { useHermesDataContext } from "./HermesDataProvider";

export type CenterTab =
  | "voz"
  | "consola"
  | "actividad"
  | "tareas"
  | "reuniones"
  | "memoria"
  | "claude";

interface Workspace {
  // Tab central (los paneles quedan montados y se alternan con hidden).
  tab: CenterTab;
  setTab: (tab: CenterTab) => void;
  /** Como setTab pero desde la voz/comandos: vuelve a "/" si estás en /vida. */
  showPanel: (tab: CenterTab) => void;

  // Proyecto en foco: la consola conversa centrada en él.
  selectedProject: string | null;
  selectedProjectName: string | undefined;
  selectedProjectData: ReturnType<typeof useHermesDataContext>["projects"][number] | undefined;
  focusProject: (slug: string | null) => void;

  // Config de ejecución de Claude Code (modelo · esfuerzo · permisos) + run vivo.
  claudeConfig: ClaudeExecConfig;
  setClaudeConfig: (c: ClaudeExecConfig) => void;
  claudeRunId: string | null;
  claudeSessionId: string | null;
  setClaudeRun: (runId: string | null, sessionId: string | null) => void;
  openRun: (ref: { slug: string; runId: string; sessionId: string }) => void;
  /**
   * Tarea (fila-puente de Linear) dueña de la sesión abierta en la consola:
   * el composer del terminal rutea "más instrucciones" por continueTask para
   * que la ejecución quede en la memoria de la tarea. null = sesión suelta.
   */
  claudeTaskId: number | null;
  /** Abre la ejecución de una tarea en la CONSOLA principal (tab claude). */
  openTaskRun: (task: Task, run: RunRef) => void;
  launchClaudeRun: (opts: {
    project: string;
    prompt: string;
  }) => Promise<{ runId: string } | null>;

  // Detalle del tab TAREAS (tarea seleccionada o stream de su run).
  taskDetail: DetailTarget | null;
  selectTask: (task: Task) => void;
  openRunFromTask: (task: Task, run: RunRef) => void;
  clearTaskDetail: () => void;

  // Sidebar izquierdo colapsable (persistido en localStorage).
  sidebarOpen: boolean;
  toggleSidebar: () => void;

  // Command palette (⌘K).
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;

  // Borrador para el input de la consola (lo consume ChatPanel una vez).
  consoleDraft: string | null;
  setConsoleDraft: (text: string | null) => void;
}

const WorkspaceContext = createContext<Workspace | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { projects } = useHermesDataContext();

  const [tab, setTab] = useState<CenterTab>("consola");
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [claudeConfig, setClaudeConfig] = useState<ClaudeExecConfig>(DEFAULT_CLAUDE_CONFIG);
  const [claudeRunId, setClaudeRunId] = useState<string | null>(null);
  const [claudeSessionId, setClaudeSessionId] = useState<string | null>(null);
  const [claudeTaskId, setClaudeTaskId] = useState<number | null>(null);
  const [taskDetail, setTaskDetail] = useState<DetailTarget | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [consoleDraft, setConsoleDraft] = useState<string | null>(null);

  // Sidebar: se lee de localStorage tras montar (evita mismatch de hidratación).
  const [sidebarOpen, setSidebarOpen] = useState(true);
  useEffect(() => {
    try {
      setSidebarOpen(localStorage.getItem("hermes_sidebar") !== "0");
    } catch {
      /* sin localStorage */
    }
  }, []);
  const toggleSidebar = () =>
    setSidebarOpen((v) => {
      try {
        localStorage.setItem("hermes_sidebar", v ? "0" : "1");
      } catch {
        /* noop */
      }
      return !v;
    });

  const selectedProjectData = projects.find((p) => p.slug === selectedProject);
  const selectedProjectName = selectedProjectData?.name;

  // La voz y los comandos pueden pedir un panel desde /vida: volvemos a "/"
  // (nada se desmonta: el AppShell solo alterna vistas con CSS).
  const goHome = () => {
    if (pathname !== "/") router.push("/");
  };

  const showPanel = (t: CenterTab) => {
    goHome();
    setTab(t);
  };

  // Elegir un proyecto lleva a la consola para conversar sobre él.
  const focusProject = (slug: string | null) => {
    setSelectedProject(slug);
    if (slug) {
      goHome();
      setTab("consola");
    }
  };

  // Run que se quiere abrir junto con el cambio de proyecto (Orquestador o
  // lanzar desde voz). Sin esto, el effect de abajo limpiaría el run entrante.
  const openingRunRef = useRef<{ runId: string; sessionId: string } | null>(null);

  // Al cambiar de proyecto en foco, reinicia el panel de Claude Code (cada
  // proyecto tiene sus propias sesiones y un cwd distinto) — SALVO que el
  // cambio venga de "abrir un run": en ese caso aplica el run entrante.
  useEffect(() => {
    const opening = openingRunRef.current;
    openingRunRef.current = null;
    if (opening) {
      setClaudeRunId(opening.runId);
      setClaudeSessionId(opening.sessionId);
    } else {
      setClaudeSessionId(null);
      setClaudeRunId(null);
    }
  }, [selectedProject]);

  // Abre el stream de un run en el terminal central, enfocando su proyecto.
  // Un run "suelto" (no de tarea) desasocia la tarea activa del composer.
  const openRun = ({ slug, runId, sessionId }: { slug: string; runId: string; sessionId: string }) => {
    if (slug !== selectedProject) {
      openingRunRef.current = { runId, sessionId };
      setSelectedProject(slug);
    } else {
      setClaudeRunId(runId);
      setClaudeSessionId(sessionId);
    }
    goHome();
    setTab("claude");
  };

  // Capacidad ejecutable del deck y de la voz: lanza un run de Claude Code en
  // el repo de un proyecto y abre su stream. Devuelve el runId para la voz.
  const launchClaudeRun = async ({
    project,
    prompt,
  }: {
    project: string;
    prompt: string;
  }): Promise<{ runId: string } | null> => {
    try {
      const { runId, sessionId } = await claudeStartRun(prompt, claudeConfig, project, null);
      openRun({ slug: project, runId, sessionId });
      return { runId };
    } catch {
      /* agente offline: el feed/consola lo reflejan */
      return null;
    }
  };

  // ── Tab TAREAS: detalle de la tarea/run seleccionado ─────────────────
  const selectTask = (task: Task) =>
    setTaskDetail({
      project: task.project_slug,
      runId: task.status === "running" ? (task.run_id ?? null) : null,
      sessionId: task.session_id ?? null,
      task,
    });
  const openRunFromTask = (task: Task, run: RunRef) =>
    setTaskDetail({ project: run.slug, runId: run.runId, sessionId: run.sessionId, task });

  // Linear-first: ejecutar una tarea la abre en la CONSOLA principal (tab
  // claude) con su sesión, y deja la tarea asociada para que el composer
  // rutee las instrucciones siguientes por continueTask (memoria de ejecuciones).
  const openTaskRun = (task: Task, run: RunRef) => {
    setClaudeTaskId(task.id);
    openRun({ slug: run.slug, runId: run.runId, sessionId: run.sessionId });
  };

  const value = useMemo<Workspace>(
    () => ({
      tab,
      setTab,
      showPanel,
      selectedProject,
      selectedProjectName,
      selectedProjectData,
      focusProject,
      claudeConfig,
      setClaudeConfig,
      claudeRunId,
      claudeSessionId,
      setClaudeRun: (runId, sessionId) => {
        setClaudeRunId(runId);
        setClaudeSessionId(sessionId);
        // Cambiar de sesión o abrir una nueva desasocia la tarea del composer.
        if (!runId && !sessionId) setClaudeTaskId(null);
      },
      openRun,
      claudeTaskId,
      openTaskRun,
      launchClaudeRun,
      taskDetail,
      selectTask,
      openRunFromTask,
      clearTaskDetail: () => setTaskDetail(null),
      sidebarOpen,
      toggleSidebar,
      paletteOpen,
      setPaletteOpen,
      consoleDraft,
      setConsoleDraft,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      tab,
      selectedProject,
      selectedProjectData,
      claudeConfig,
      claudeRunId,
      claudeSessionId,
      claudeTaskId,
      taskDetail,
      sidebarOpen,
      paletteOpen,
      consoleDraft,
      pathname,
      projects,
    ],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): Workspace {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace requiere <WorkspaceProvider> en el árbol");
  return ctx;
}
