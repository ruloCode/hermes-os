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
//  - La PRESENCIA (orbe + estado + hilo) subió al shell (v4: una barra
//    flotante al pie; v5: el VoiceDock al pie de la barra lateral).
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
import { OWNER } from "@/lib/owner";

// De madrugada no son "buenos días": a la 1:17 a. m. el saludo mentía.
const SALUDO = () => {
  const h = new Date().getHours();
  return h < 5 ? "Buenas noches" : h < 12 ? "Buenos días" : h < 19 ? "Buenas tardes" : "Buenas noches";
};

const FECHA = () =>
  new Date().toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long" });

// El riel de contexto (agenda + proyectos) acompaña SOLO donde su contenido
// cambia lo que haces: conversar y ejecutar sobre un proyecto, y elegir de qué
// proyecto ver juntas. En Tareas, Memoria, Actividad y Voz le robaba 264px a
// listas que ya traen su propio filtro — y en Tareas y Actividad ni se veía:
// el contenido sin `min-w-0` lo empujaba fuera de la pantalla.
const RAIL_TABS = new Set<CenterTab>(["consola", "claude", "reuniones"]);

export function OrquestadorView() {
  const { projects, memories, online } = useHermesData();
  const { events } = useAgentEvents();
  const ws = useWorkspace();

  const [consolaVacia, setConsolaVacia] = useState(true);
  // Tab TAREAS (Linear-first): issue seleccionado → vista central de detalle.
  const [selectedIssue, setSelectedIssue] = useState<LinearBoardIssue | null>(null);

  // El hero vive en la consola vacía. Ya no depende de si hay llamada: la
  // conversación pasa en el VoiceDock, así que "qué sigue" puede seguir
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

  const showRail = RAIL_TABS.has(ws.tab);

  // Cada tab (Consola, Tareas, Reuniones…) abre con SU ViewHeader: ahí van sus
  // controles (filtro de proyecto, nueva sesión, pestañas). Inicio no lleva —
  // abre con el saludo, y una cabecera que dijera "Inicio" sería ruido.
  return (
    <>
      <div className="flex min-h-0 flex-1 gap-6">
        {/* ── Centro ───────────────────────────────────────────── */}
        {/* min-w-0: sin esto una fila larga (chips de proyectos, una línea
            de log) fija el ancho mínimo y empuja todo fuera de la pantalla. */}
        <section
          className={`relative flex min-h-0 min-w-0 flex-1 flex-col items-center ${
            hero ? "overflow-y-auto" : ""
          }`}
        >
          {/* HERO: saludo. Solo con la consola vacía. Debajo va el composer
              (lo primero que haces) y después "qué sigue" — el orden de
              Claude/ChatGPT: saludo → pedir → sugerencias. */}
          {hero && (
            <div className="w-full max-w-[680px] pt-[9vh]">
              <p className="text-sm text-text-faint first-letter:uppercase" suppressHydrationWarning>
                {FECHA()}
              </p>
              <h2 className="mt-1 text-2xl font-semibold text-text" suppressHydrationWarning>
                {SALUDO()}
                {OWNER ? `, ${OWNER}` : ""}
              </h2>
              {/* Regla de oro: dato real o nada. Sale del vault. */}
              {activos > 0 && (
                <p className="mt-1.5 text-sm text-text-dim">
                  {activos} {activos === 1 ? "proyecto activo" : "proyectos activos"} · {pendientes}{" "}
                  {pendientes === 1 ? "tarea pendiente" : "tareas pendientes"} en el vault
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
              hero ? "mt-6 max-w-[680px]" : "min-h-0 flex-1 max-w-[760px] pt-5"
            }`}
          >
            {/* La llamada NO se lee aquí: vive en el VoiceDock al pie de la
                barra lateral, que acompaña en todas las rutas. Escribir y
                hablar siguen siendo el mismo canal, pero el centro se queda
                con el trabajo. */}
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

          {/* Qué sigue: la PRÓXIMA tarea de cada proyecto, a un clic de
              conversarla. */}
          {hero && queSigue.length > 0 && (
            <div className="mt-10 w-full max-w-[680px] pb-6">
              <h3 className="mb-2 px-1 text-xs font-medium text-text-faint">Qué sigue</h3>
              <ul className="overflow-hidden rounded-md border border-line bg-panel">
                {queSigue.map((t) => (
                  <li key={t.slug} className="border-t border-line first:border-t-0">
                    <button
                      type="button"
                      onClick={() => ws.focusProject(t.slug)}
                      title={`Conversar sobre ${t.project}`}
                      className="group flex w-full cursor-pointer items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-hover"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm text-text">{t.task}</span>
                      <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-2xs text-text-dim">
                        {t.project}
                      </span>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0 text-text-faint opacity-0 transition-opacity group-hover:opacity-100">
                        <path d="M5 12h14M13 6l6 6-6 6" />
                      </svg>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

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

        {/* ── Riel de contexto: un panel lateral a sangre (toca el borde
            derecho y el inferior del lienzo) ──────────────────────── */}
        {showRail && (
          <aside
            aria-label="Contexto"
            className={`-mr-6 -mb-5 hidden w-[280px] shrink-0 border-l border-line ${ws.railOpen ? "lg:flex lg:flex-col" : ""}`}
          >
            <ContextRail />
          </aside>
        )}
      </div>
    </>
  );
}

function TabPanel({ show, children }: { show: boolean; children: React.ReactNode }) {
  return (
    <div className={`w-full min-h-0 flex-1 ${show ? "flex flex-col" : "hidden"}`}>{children}</div>
  );
}
