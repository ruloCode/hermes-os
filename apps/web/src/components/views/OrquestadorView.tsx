"use client";

// Vista ORQUESTADOR (home). Rediseño minimalista 2026-07.
//
// Por qué cambió: el home anterior repartía los píxeles al revés del uso real.
// La VOZ es el 88% de las conversaciones (622 de 704) y tenía una cajita de
// 2%; Claude Usage tenía un gauge radial + 5 modelos para 8 ejecuciones
// históricas; el TaskBoard ocupaba un tab entero leyendo una tabla vacía
// mientras el trabajo real (28 tareas) vive en el vault. Catorce paneles con
// el mismo peso visual = ninguna jerarquía.
//
// Ahora: el orbe de voz ES el foco (y el botón de llamada), la consola debajo,
// y a la derecha "qué sigue". El resto de tabs siguen montados y se alternan
// con CSS — no se pierde ninguna capacidad, solo deja de gritar toda a la vez.

import { useCallback, useRef, useState } from "react";
import { claudeStartRun, continueTask, type LinearBoardIssue } from "@/lib/hermes";
import { useHermesData } from "@/hooks/useHermesData";
import { useAgentEvents } from "@/hooks/useAgentEvents";
import { useWorkspace, type CenterTab } from "@/state/WorkspaceContext";
import { useVoiceConnect } from "@/hooks/useVoiceConnect";
import { useOrbState } from "@/components/voice/orbState";
import { useVoice } from "@/components/VoiceBusyContext";
import { VoiceOrb3D } from "@/components/voice/VoiceOrb3D";
import { ContextRail } from "@/components/views/ContextRail";
import { VoiceThread } from "@/components/views/VoiceThread";
import { ChatPanel } from "@/components/ChatPanel";
import { ClaudeTerminal } from "@/components/ClaudeTerminal";
import { ActivityFeed } from "@/components/ActivityFeed";
import { MeetingsPanel } from "@/components/MeetingsPanel";
import { LinearBoard } from "@/components/LinearBoard";
import { LinearIssueView } from "@/components/LinearIssueView";
import { VozView } from "@/components/VozView";
import { MemoryView } from "@/components/views/MemoryView";
import { CommandChips } from "@/components/CommandChips";
import { Panel } from "@/components/ui/Panel";
import { OWNER } from "@/lib/owner";

const SALUDO = () => {
  const h = new Date().getHours();
  return h < 12 ? "Buenos días" : h < 19 ? "Buenas tardes" : "Buenas noches";
};

const ETIQUETA: Record<string, string> = {
  na: "Voz no configurada",
  off: "Clic en el orbe para hablar",
  connecting: "Conectando…",
  listening: "Escuchando…",
  speaking: "Hermes está hablando",
  exec: "Ejecutando",
};

export function OrquestadorView() {
  const { projects, memories, online } = useHermesData();
  const { events } = useAgentEvents();
  const ws = useWorkspace();
  const { state, getVolume } = useOrbState();
  const { connect, disconnect, connected, connecting } = useVoiceConnect();
  const { transcript } = useVoice();

  const heroRef = useRef<HTMLButtonElement>(null);
  const dockRef = useRef<HTMLButtonElement>(null);
  const [consolaVacia, setConsolaVacia] = useState(true);
  // Tab TAREAS (Linear-first): issue seleccionado → vista central de detalle.
  const [selectedIssue, setSelectedIssue] = useState<LinearBoardIssue | null>(null);

  // La voz manda mientras haya llamada o transcripción: es el 88% del uso.
  const enVoz = connected || connecting || transcript.length > 0;

  // El hero (orbe grande + saludo) vive en la consola vacía y SIN llamada. En
  // cuanto hay conversación —hablada o escrita— el orbe se va al muelle.
  const hero = ws.tab === "consola" && consolaVacia && !enVoz;

  // El ancla se lee cada frame desde el loop del orbe: el CSS manda la
  // posición y el WebGL solo la rastrea.
  const getAnchor = useCallback(
    () => (hero ? heroRef.current : dockRef.current),
    [hero],
  );

  const toggleVoz = () => {
    if (connected || connecting) void disconnect();
    else void connect();
  };

  const pendientes = projects
    .filter((p) => p.estado === "activo")
    .reduce((n, p) => n + (p.tareas_pendientes?.length ?? 0), 0);
  const activos = projects.filter((p) => p.estado === "activo").length;

  return (
    <>
      {/* Canvas fijo a toda la ventana, detrás de la UI (pointer-events:none).
          En una caja del tamaño del orbe, anillos y partículas se recortan. */}
      <VoiceOrb3D getAnchor={getAnchor} simplified={!hero} state={state} getVolume={getVolume} />

      <div className="flex min-h-0 flex-1 gap-3">
        {/* ── Centro ───────────────────────────────────────────── */}
        <section className="relative flex min-h-0 flex-1 flex-col items-center">
          {/* Muelle del orbe: esquina superior derecha del área de trabajo */}
          <button
            type="button"
            ref={dockRef}
            onClick={toggleVoz}
            title={ETIQUETA[state]}
            aria-label={ETIQUETA[state]}
            // Hero y muelle son el MISMO botón en dos sitios: el que no está en
            // uso sale del árbol de accesibilidad y del tabindex, si no se
            // anuncian dos botones idénticos y uno enfoca al vacío.
            aria-hidden={hero}
            tabIndex={hero ? -1 : 0}
            className={`absolute top-2 right-4 z-3 h-[76px] w-[76px] cursor-grab rounded-full transition-opacity duration-500 active:cursor-grabbing ${
              hero ? "pointer-events-none opacity-0" : "opacity-100"
            }`}
          >
            {/* La presencia de Hermes mientras responde: donde ChatGPT/Claude
                ponen un avatar estático, aquí late el orbe real. */}
            <span className="absolute top-full left-1/2 -translate-x-1/2 text-[8.5px] tracking-title text-text-faint uppercase">
              {state === "off" || state === "na" ? "Hermes" : ETIQUETA[state]}
            </span>
          </button>

          {/* HERO: orbe protagonista + saludo. Solo con la consola vacía.
              El ancla mide la ESFERA, pero los anillos llegan a ~2x su radio:
              de ahí el margen inferior — sin él se montan sobre el saludo. */}
          {hero && (
            <div className="flex flex-col items-center pt-[3vh]">
              <button
                type="button"
                ref={heroRef}
                onClick={toggleVoz}
                title={ETIQUETA[state]}
                aria-label={ETIQUETA[state]}
                className="h-[220px] w-[220px] cursor-grab rounded-full active:cursor-grabbing"
              />
              <p className="mt-[132px] h-4 text-2xs tracking-title text-text-faint uppercase">
                {ETIQUETA[state]}
              </p>
              <h2 className="mt-5 text-2xl font-light text-text">
                {SALUDO()}{OWNER ? <>, <b className="font-semibold text-violet">{OWNER}</b></> : null}
              </h2>
              {/* Regla de oro: dato real o nada. Sale del vault. */}
              {activos > 0 && (
                <p className="mt-2 text-xs text-text-faint">
                  {activos} proyectos activos · {pendientes} tareas pendientes en el vault
                </p>
              )}
            </div>
          )}

          {/* Consola: protagonista cuando hay conversación. `ghost` = sin
              marco; el hilo es el contenido, no una caja más. */}
          <div
            className={`flex w-full flex-col ${ws.tab === "consola" ? "" : "hidden"} ${
              // En hero el composer va PEGADO al saludo (sin flex-1 que lo
              // empuje al fondo); con hilo, ocupa toda la altura.
              hero ? "mt-7 max-w-[680px]" : "min-h-0 flex-1 max-w-[760px]"
            }`}
          >
            {/* La llamada se lee AQUÍ, con la misma piel que el texto. El
                composer sigue debajo: puedes escribir mientras hablas. */}
            {enVoz && (
              <div className="mb-3 flex min-h-0 flex-1 flex-col">
                <VoiceThread />
              </div>
            )}
            <ChatPanel
              online={online}
              selectedProject={ws.selectedProject}
              projectName={ws.selectedProjectName}
              onClearProject={() => ws.focusProject(null)}
              claudeConfig={ws.claudeConfig}
              onClaudeConfigChange={ws.setClaudeConfig}
              claudeSessionId={ws.claudeSessionId}
              externalDraft={ws.consoleDraft}
              onExternalDraftConsumed={() => ws.setConsoleDraft(null)}
              onEmptyChange={setConsolaVacia}
              hideEmptyHint={hero}
              onClaudeRun={(id, sessionId) => {
                ws.setClaudeRun(id, sessionId);
                ws.setTab("claude");
              }}
            />
            {hero && (
              <div className="mt-3 shrink-0">
                <CommandChips />
              </div>
            )}
          </div>

          {/* Resto de tabs: montados y alternados con CSS para no perder
              scroll/streams al cambiar (misma regla que antes). */}
          <TabPanel show={ws.tab === "voz"}>
            <VozView events={events} />
          </TabPanel>
          <TabPanel show={ws.tab === "actividad"}>
            <ActivityFeed events={events} />
          </TabPanel>
          <TabPanel show={ws.tab === "tareas"}>
            {/* Linear-first: el tablero proyecta los issues de Linear; clic en
                una fila abre el DETALLE CENTRAL (patrón Linear, con ← volver).
                Ejecutar abre la CONSOLA principal (tab claude) con stop + chat. */}
            {selectedIssue ? (
              <LinearIssueView
                boardIssue={selectedIssue}
                onBack={() => setSelectedIssue(null)}
                onRun={ws.openTaskRun}
                onOpenStream={(task) =>
                  ws.openTaskRun(task, {
                    runId: task.run_id ?? "",
                    sessionId: task.session_id ?? "",
                    slug: task.project_slug,
                  })
                }
              />
            ) : (
              <LinearBoard
                projects={projects}
                selectedId={null}
                onSelect={setSelectedIssue}
                onOpenTask={(task) =>
                  ws.openTaskRun(task, {
                    runId: task.run_id ?? "",
                    sessionId: task.session_id ?? "",
                    slug: task.project_slug,
                  })
                }
                onRun={ws.openTaskRun}
              />
            )}
          </TabPanel>
          <TabPanel show={ws.tab === "reuniones"}>
            <MeetingsPanel
              project={ws.selectedProject}
              projectName={ws.selectedProjectName}
              onExecute={(run, task) =>
                task ? ws.openTaskRun(task, run) : ws.openRun(run)
              }
            />
          </TabPanel>
          <TabPanel show={ws.tab === "memoria"}>
            <MemoryView memories={memories} online={online} />
          </TabPanel>
          <TabPanel show={ws.tab === "claude"}>
            <ClaudeTerminal
              project={ws.selectedProject}
              runId={ws.claudeRunId}
              sessionId={ws.claudeSessionId}
              onSelectSession={(id) => {
                if (id === ws.claudeSessionId && ws.claudeRunId) return;
                ws.setClaudeRun(null, id);
              }}
              onNewSession={() => ws.setClaudeRun(null, null)}
              onSend={async (prompt) => {
                // Tarea de Linear activa → continueTask: misma sesión Y la
                // ejecución queda en la memoria de la tarea (vault + Supabase).
                if (ws.claudeTaskId) {
                  const run = await continueTask(ws.claudeTaskId, prompt);
                  if (run) ws.setClaudeRun(run.runId, run.sessionId);
                  return run;
                }
                // Sesión suelta: resume (o arranca) con la config de la barra.
                try {
                  const r = await claudeStartRun(
                    prompt,
                    ws.claudeConfig,
                    ws.selectedProject,
                    ws.claudeSessionId,
                  );
                  ws.setClaudeRun(r.runId, r.sessionId);
                  return r;
                } catch {
                  return null;
                }
              }}
            />
          </TabPanel>
        </section>

        {/* ── Riel de contexto ─────────────────────────────────── */}
        <aside
          aria-label="Contexto"
          className="hidden w-[264px] shrink-0 border-l border-line lg:flex lg:flex-col"
        >
          <ContextRail />
        </aside>
      </div>
    </>
  );
}

function TabPanel({ show, children }: { show: boolean; children: React.ReactNode }) {
  return (
    <div className={`w-full min-h-0 flex-1 ${show ? "flex flex-col" : "hidden"}`}>{children}</div>
  );
}
