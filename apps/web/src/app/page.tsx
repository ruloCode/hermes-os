"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ConversationProvider } from "@elevenlabs/react";
import { claudeStartRun } from "@/lib/hermes";
import { useHermesData } from "@/hooks/useHermesData";
import { useAgentEvents } from "@/hooks/useAgentEvents";
import { Panel } from "@/components/Panel";
import { Clock } from "@/components/Clock";
import { ClaudeUsage } from "@/components/ClaudeUsage";
import { ActiveAgents } from "@/components/ActiveAgents";
import { ProjectsStrip } from "@/components/ProjectsStrip";
import { KnowledgeGraph } from "@/components/KnowledgeGraph";
import { ChatPanel } from "@/components/ChatPanel";
import { ClaudeTerminal } from "@/components/ClaudeTerminal";
import { DEFAULT_CLAUDE_CONFIG } from "@/components/ClaudeExecBar";
import type { ClaudeExecConfig } from "@/lib/hermes";
import { ActivityFeed } from "@/components/ActivityFeed";
import { CommandDeck } from "@/components/CommandDeck";
import { OrchestratorPanel } from "@/components/OrchestratorPanel";
import { ProjectContextPanel } from "@/components/ProjectContextPanel";
import { MeetingsPanel } from "@/components/MeetingsPanel";
import { ProjectVersion } from "@/components/ProjectVersion";
import { Toasts } from "@/components/Toasts";
import { MachineSelector } from "@/components/MachineSelector";
import { VoiceBusyProvider } from "@/components/VoiceBusyContext";
import { VoiceClientTools } from "@/components/VoiceClientTools";
import { VoiceEventsBridge } from "@/components/VoiceEventsBridge";
import { VoiceSessionBridge } from "@/components/VoiceSessionBridge";
import { VoiceOrb } from "@/components/VoiceOrb";
import { VoicePanel } from "@/components/VoicePanel";
import { VoiceScopeSync } from "@/components/VoiceScopeSync";
import { VozView } from "@/components/VozView";

export default function Home() {
  const { stats, projects, memories, online } = useHermesData();
  const { events } = useAgentEvents();
  const [tab, setTab] = useState<"consola" | "actividad" | "claude" | "reuniones" | "voz">("consola");
  // Config de ejecución de Claude Code (modelo · esfuerzo · permisos).
  const [claudeConfig, setClaudeConfig] = useState<ClaudeExecConfig>(DEFAULT_CLAUDE_CONFIG);
  const [claudeRunId, setClaudeRunId] = useState<string | null>(null);
  // Sesión de Claude Code activa (para resumir en la próxima corrida).
  const [claudeSessionId, setClaudeSessionId] = useState<string | null>(null);
  // Proyecto en foco: la consola conversa centrada en él (slug o null).
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  // Sidebar izquierdo colapsable: más espacio para la consola. Se lee de
  // localStorage tras montar (evita mismatch de hidratación SSR).
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
  // Elegir un proyecto lleva a la consola para conversar sobre él.
  const focusProject = (slug: string | null) => {
    setSelectedProject(slug);
    if (slug) setTab("consola");
  };

  // Run que se quiere abrir junto con el cambio de proyecto (Orquestador o
  // lanzar Divisual). Sin esto, el effect de abajo limpiaría el run entrante.
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

  // Abre el stream de un run (del Orquestador o recién lanzado) en el terminal
  // central, enfocando su proyecto. Si el proyecto cambia, el effect de arriba
  // aplica el run vía openingRunRef; si es el mismo, se aplica directo aquí.
  const openRun = ({
    slug,
    runId,
    sessionId,
  }: {
    slug: string;
    runId: string;
    sessionId: string;
  }) => {
    if (slug !== selectedProject) {
      openingRunRef.current = { runId, sessionId };
      setSelectedProject(slug);
    } else {
      setClaudeRunId(runId);
      setClaudeSessionId(sessionId);
    }
    setTab("claude");
  };

  // Capacidad ejecutable del deck y de la VOZ: lanza un run de Claude Code en el
  // repo de un proyecto y abre su stream en el terminal central. Devuelve el
  // runId para que la voz lo reporte y lo consulte luego con check_task.
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

  const working = stats?.presence?.status === "working" || stats?.presence?.status === "thinking";

  return (
    // Las CLIENT TOOLS de la voz ahora se registran en <VoiceClientTools> (usan
    // el ref-pattern del SDK para no capturar handlers de UI obsoletos), y
    // <VoiceEventsBridge> le pasa a Hermes los avisos de tareas terminadas.
    <ConversationProvider>
      <VoiceBusyProvider>
        <VoiceClientTools
          projects={projects}
          onFocusProject={focusProject}
          onShowPanel={setTab}
          onWork={launchClaudeRun}
        />
        <VoiceEventsBridge events={events} />
        {/* Transcripción + memoria de sesión (recap al reconectar) + preview
            de artefactos. Al conectar la llamada, salta a la vista Voz. */}
        <VoiceSessionBridge events={events} onConnected={() => setTab("voz")} />
        {/* Scope: el proyecto en foco viaja a la voz (dynamic var al conectar,
            contextual update si cambia en vivo). */}
        <VoiceScopeSync slug={selectedProject} name={selectedProjectName} />
        <main className="mx-auto flex h-screen max-w-[1700px] flex-col gap-3 p-3 lg:p-4">
        {/* ── Header ─────────────────────────────────────────────── */}
        <header className="hud-in flex items-end justify-between px-1">
          <div className="flex items-end gap-3">
            <button
              type="button"
              onClick={toggleSidebar}
              title={sidebarOpen ? "Ocultar panel lateral" : "Mostrar panel lateral"}
              aria-label={sidebarOpen ? "Ocultar panel lateral" : "Mostrar panel lateral"}
              aria-pressed={sidebarOpen}
              className="mb-1 grid h-7 w-7 place-items-center rounded-sm border transition-colors"
              style={{
                borderColor: "var(--line)",
                color: sidebarOpen ? "var(--violet)" : "var(--text-dim)",
                background: sidebarOpen ? "rgba(167,139,250,0.06)" : "transparent",
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.7" />
                <path d="M9 3v18" stroke="currentColor" strokeWidth="1.7" />
                {sidebarOpen && <path d="M4.5 4.5h3.5v15H4.5z" fill="currentColor" opacity="0.35" stroke="none" />}
              </svg>
            </button>
            <div>
              <h1 className="font-display text-2xl font-bold tracking-[0.35em] glow-violet">
                HERMES<span style={{ color: "var(--violet)" }}> OS</span>
              </h1>
              <p className="mt-1 text-[9px] tracking-[0.42em] uppercase" style={{ color: "var(--text-dim)" }}>
                Voice-Activated Agentic Operating System · RuloCode
              </p>
            </div>
          </div>
          <nav className="hidden gap-5 text-[10px] tracking-[0.3em] uppercase lg:flex" style={{ color: "var(--text-dim)" }}>
            {["Core", "Proyectos", "Memoria", "Voz", "Vivo"].map((item, i) => (
              <span key={item} className="flex items-center gap-1.5">
                <span style={{ color: i === 0 ? "var(--violet)" : "inherit" }}>·</span>
                {item}
              </span>
            ))}
          </nav>
          <div className="flex items-end gap-4">
            {/* Página aparte: Control de Misión (orquestador + tareas) */}
            <Link
              href="/orquestador"
              className="pb-1 text-[10px] tracking-[0.25em] uppercase transition-opacity hover:opacity-100"
              style={{ color: "var(--violet)", opacity: 0.85 }}
            >
              ◧ Orquestador
            </Link>
            {/* Orbe de voz: control siempre visible de la llamada con Hermes */}
            <VoiceOrb />
            {/* Multi-Mac: solo aparece si NEXT_PUBLIC_HERMES_AGENTS está definida */}
            <MachineSelector />
            <Clock />
          </div>
        </header>

        {/* ── Grid principal ─────────────────────────────────────── */}
        <div className="grid min-h-0 flex-1 grid-cols-12 gap-3">
          {/* Columna izquierda (sidebar colapsable; hidden conserva el estado) */}
          <div className={`col-span-3 min-h-0 flex-col gap-3 overflow-y-auto ${sidebarOpen ? "flex" : "hidden"}`}>
            <VoicePanel />
            <ClaudeUsage />
            <ActiveAgents stats={stats} online={online} />
            <OrchestratorPanel
              online={online}
              onOpenRun={openRun}
              dailyCostUsd={stats?.dailyRunCostUsd}
              runsToday={stats?.runsToday}
            />
            <ProjectsStrip projects={projects} selected={selectedProject} onSelect={focusProject} />
          </div>

          {/* Centro: la consola protagonista. En modo VOZ se ensancha (la
              columna derecha se oculta) para darle todo el espacio al preview. */}
          <div
            className={`${
              tab === "voz"
                ? sidebarOpen
                  ? "col-span-9"
                  : "col-span-12"
                : sidebarOpen
                  ? "col-span-6"
                  : "col-span-9"
            } flex min-h-0 flex-col gap-3`}
          >
            <Panel
              title={
                tab === "consola"
                  ? "Consola"
                  : tab === "actividad"
                    ? "Actividad en vivo"
                    : tab === "reuniones"
                      ? "Reuniones"
                      : tab === "voz"
                        ? "Voz en vivo"
                        : "Claude Code"
              }
              delay={90}
              className="min-h-0 flex-1"
              right={
                <div className="flex gap-3 text-[9px] tracking-[0.2em]">
                  {(
                    [
                      ["voz", "voz en vivo"],
                      ["consola", "consola"],
                      ["actividad", "actividad"],
                      ["reuniones", "reuniones"],
                      ["claude", "claude code"],
                    ] as const
                  ).map(([t, label]) => (
                    <button
                      key={t}
                      onClick={() => setTab(t)}
                      className="uppercase transition-colors"
                      style={{ color: tab === t ? "var(--violet)" : "var(--text-dim)" }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              }
            >
              {/* Los paneles quedan montados y se alternan con CSS: así la
                  consola no pierde su transcripción/scroll al cambiar de tab. */}
              <div className={`h-full ${tab === "voz" ? "" : "hidden"}`}>
                <VozView events={events} />
              </div>
              <div className={`h-full ${tab === "consola" ? "" : "hidden"}`}>
                <ChatPanel
                  online={online}
                  selectedProject={selectedProject}
                  projectName={selectedProjectName}
                  onClearProject={() => setSelectedProject(null)}
                  claudeConfig={claudeConfig}
                  onClaudeConfigChange={setClaudeConfig}
                  claudeSessionId={claudeSessionId}
                  onClaudeRun={(id, sessionId) => {
                    setClaudeRunId(id);
                    setClaudeSessionId(sessionId);
                    setTab("claude");
                  }}
                />
              </div>
              <div className={`h-full ${tab === "actividad" ? "" : "hidden"}`}>
                <ActivityFeed events={events} />
              </div>
              <div className={`h-full ${tab === "reuniones" ? "" : "hidden"}`}>
                <MeetingsPanel
                  project={selectedProject}
                  projectName={selectedProjectName}
                  onExecute={({ slug, runId, sessionId }) => openRun({ slug, runId, sessionId })}
                />
              </div>
              <div className={`h-full ${tab === "claude" ? "" : "hidden"}`}>
                <ClaudeTerminal
                  project={selectedProject}
                  runId={claudeRunId}
                  sessionId={claudeSessionId}
                  onSelectSession={(id) => {
                    // Si es la sesión que ya está corriendo en vivo, no la
                    // conviertas en historial (perderías el stream).
                    if (id === claudeSessionId && claudeRunId) return;
                    setClaudeSessionId(id);
                    setClaudeRunId(null);
                  }}
                  onNewSession={() => {
                    setClaudeSessionId(null);
                    setClaudeRunId(null);
                  }}
                />
              </div>
            </Panel>
          </div>

          {/* Columna derecha (se oculta en modo voz para ensanchar el preview) */}
          <div className={`col-span-3 min-h-0 flex-col gap-3 ${tab === "voz" ? "hidden" : "flex"}`}>
            {selectedProject ? (
              <ProjectContextPanel
                key={selectedProject}
                slug={selectedProject}
                name={selectedProjectName}
                estadoActual={selectedProjectData?.estado_actual}
                tareas={selectedProjectData?.tareas_pendientes}
                onClear={() => setSelectedProject(null)}
              />
            ) : (
              <CommandDeck
                onLaunched={() => setTab("actividad")}
                onLaunchClaude={(opts) => void launchClaudeRun(opts)}
              />
            )}
            {/* Con proyecto en foco, el grafo cede su slot a la vista Versión
                (rama · commit · cambios del repo local). */}
            <Panel
              title={selectedProject ? "Versión" : "Knowledge Network"}
              delay={240}
              className="min-h-0 flex-1"
              right={
                selectedProject ? (
                  <span className="text-[9px] tracking-[0.2em] uppercase" style={{ color: "var(--cyan)" }}>
                    ◈ {selectedProjectName ?? selectedProject}
                  </span>
                ) : undefined
              }
            >
              {selectedProject ? (
                <ProjectVersion key={selectedProject} slug={selectedProject} />
              ) : (
                <KnowledgeGraph
                  projects={projects}
                  memories={memories}
                  working={!!working}
                  selectedProject={selectedProject}
                  onSelectProject={focusProject}
                />
              )}
            </Panel>
          </div>
        </div>

        {/* ── Footer ─────────────────────────────────────────────── */}
        <footer
          className="hud-in flex items-center justify-between px-1 text-[9px] tracking-[0.35em] uppercase"
          style={{ color: "var(--text-dim)", animationDelay: "400ms" }}
        >
          <span>AI Agent Network · {online ? "24/7 Operativo" : "Desconectado"}</span>
          <span>
            {stats?.machine?.toUpperCase() ?? "—"} · DB {stats?.supabase ? "SYNC" : "LOCAL"}
          </span>
        </footer>

        {/* Avisos flotantes de tareas/runs terminados (mismo SSE de events) */}
        <Toasts events={events} />
        </main>
      </VoiceBusyProvider>
    </ConversationProvider>
  );
}
