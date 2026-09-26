"use client";

// Vista ORQUESTADOR (home).
//
// v2 (2026-07) puso el orbe de voz de protagonista para corregir que la voz
// —el 88% de las conversaciones— tuviera una cajita del 2%. Funcionó, pero se
// pasó de largo: el orbe medía 220px MÁS 132px de margen calculado a mano para
// que los anillos no pisaran el saludo. Casi la mitad del alto útil para lo
// que, en esencia, es un botón de llamada. Y como vivía aquí, la conversación
// solo existía en el home: hablar mientras editabas un guion en Estudio
// significaba conversar en una pantalla que no estabas viendo.
//
// v3 (2026-09) separa las dos cosas que v2 había fundido:
//  - La PRESENCIA (orbe + estado + hilo) subió al shell, a la PresenceBar del
//    pie. Mide 40px y acompaña en las diez rutas.
//  - El CENTRO es ahora lo que sigue: saludo, las tareas reales del vault y el
//    composer. Empiezas escribiendo o hablando, no mirando.
//
// El resto de tabs siguen montados y se alternan con CSS — no se pierde
// ninguna capacidad, solo deja de gritar toda a la vez.

import { useState } from "react";
import { claudeStartRun, continueTask, type LinearBoardIssue } from "@/lib/hermes";
import { useHermesData } from "@/hooks/useHermesData";
import { useAgentEvents } from "@/hooks/useAgentEvents";
import { useWorkspace, type CenterTab } from "@/state/WorkspaceContext";
import { ContextRail } from "@/components/views/ContextRail";
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

export function OrquestadorView() {
  const { projects, memories, online } = useHermesData();
  const { events } = useAgentEvents();
  const ws = useWorkspace();

  const [consolaVacia, setConsolaVacia] = useState(true);
  // Tab TAREAS (Linear-first): issue seleccionado → vista central de detalle.
  const [selectedIssue, setSelectedIssue] = useState<LinearBoardIssue | null>(null);

  // El hero vive en la consola vacía. Ya no depende de si hay llamada: la
  // conversación pasa en la PresenceBar, así que "qué sigue" puede seguir
  // visible mientras hablas — que es justo lo que quieres mirando.
  const hero = ws.tab === "consola" && consolaVacia;

  const activosList = projects.filter((p) => p.estado === "activo");
  const pendientes = activosList.reduce((n, p) => n + (p.tareas_pendientes?.length ?? 0), 0);
  const activos = activosList.length;

  // "Qué sigue": la PRÓXIMA TAREA de cada proyecto activo, los que más cargan
  // primero. Regla de oro: dato del vault o nada.
  //
  // Ojo con el riel: también lista proyectos, y al principio esta tarjeta era
  // otra lista de proyectos con el mismo orden y los mismos números — dos
  // paneles contestando lo mismo, que es justo el problema que este rediseño
  // venía a quitar. Se reparten las preguntas: el riel es el INVENTARIO
  // (dónde vive mi trabajo, cuántos pendientes, ver más), y esto es la ACCIÓN
  // (qué hago ahora). Por eso aquí manda la tarea y el proyecto es la meta.
  const queSigue = activosList
    .filter((p) => (p.tareas_pendientes?.length ?? 0) > 0)
    .sort((a, b) => (b.tareas_pendientes?.length ?? 0) - (a.tareas_pendientes?.length ?? 0))
    .slice(0, 4)
    .map((p) => ({
      slug: p.slug,
      project: p.name ?? p.slug,
      // Los wikilinks del vault son sintaxis de Obsidian, no texto de UI.
      task: p.tareas_pendientes[0].replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, "$1"),
    }));

  return (
    <>
      <div className="flex min-h-0 flex-1 gap-3">
        {/* ── Centro ───────────────────────────────────────────── */}
        <section className="relative flex min-h-0 flex-1 flex-col items-center">
          {/* HERO: saludo + lo que sigue. Solo con la consola vacía.
              Sin orbe: la presencia vive en la PresenceBar del pie. */}
          {hero && (
            <div className="w-full max-w-[680px] pt-[6vh]">
              <h2 className="text-3xl font-light text-text">
                {SALUDO()}
                {OWNER ? (
                  <>
                    , <b className="font-semibold text-accent">{OWNER}</b>
                  </>
                ) : null}
              </h2>
              {/* Regla de oro: dato real o nada. Sale del vault. */}
              {activos > 0 && (
                <p className="mt-2 text-sm text-text-faint">
                  {activos} {activos === 1 ? "proyecto activo" : "proyectos activos"} · {pendientes}{" "}
                  {pendientes === 1 ? "tarea pendiente" : "tareas pendientes"} en el vault
                </p>
              )}

              {/* Qué sigue: el trabajo real, a un clic de conversarlo. */}
              {queSigue.length > 0 && (
                <div className="mt-7 overflow-hidden rounded-md border border-line bg-panel">
                  <h3 className="border-b border-line px-4 py-2.5 text-xs font-medium text-text-dim">
                    Qué sigue
                  </h3>
                  <ul>
                    {queSigue.map((t) => (
                      <li key={t.slug} className="border-t border-line/60 first:border-t-0">
                        <button
                          type="button"
                          onClick={() => ws.focusProject(t.slug)}
                          title={`Conversar sobre ${t.project}`}
                          className="group flex w-full cursor-pointer items-baseline gap-4 px-4 py-2.5 text-left"
                        >
                          <span className="min-w-0 flex-1 truncate text-sm text-text transition-colors group-hover:text-accent">
                            {t.task}
                          </span>
                          <span className="shrink-0 text-xs text-text-faint">{t.project}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
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
            {/* La llamada NO se lee aquí: vive en la PresenceBar del pie, que
                acompaña en todas las rutas. Escribir y hablar siguen siendo el
                mismo canal, pero el centro se queda con el trabajo. */}
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
              onExecute={(run, task) => (task ? ws.openTaskRun(task, run) : ws.openRun(run))}
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
