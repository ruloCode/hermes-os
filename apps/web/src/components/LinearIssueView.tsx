"use client";

// Vista CENTRAL de un issue de Linear (tab TAREAS). Reemplaza a la lista
// mientras hay selección — patrón Linear/Mobbin: "← Tareas" arriba, cuerpo
// ancho (título → acciones → descripción → Copy prompt → ejecuciones) y
// sidebar de propiedades a la derecha. Ejecutar abre la CONSOLA principal.

import { useEffect, useState } from "react";
import type { Task, TaskExecutionSummary } from "@hermes/shared";
import {
  executeLinearIssue,
  getLinearIssue,
  getTask,
  listTaskExecutions,
  setLinearIssueState,
  type LinearBoardIssue,
  type LinearIssueFull,
  type RunRef,
} from "@/lib/hermes";
import { Markdown } from "@/components/Markdown";
import { ExecutionDetail } from "@/components/ExecutionDetail";
import { PanelState } from "@/components/ui/PanelState";
import { ViewHeader } from "@/components/ui/ViewHeader";
import { Button } from "@/components/ui/Button";
import { PriorityIcon, StateIcon } from "@/components/LinearBoard";

const PRIORITY_TEXT = ["—", "Urgente", "Alta", "Media", "Baja"];

export function LinearIssueView({
  boardIssue,
  onBack,
  onRun,
  onOpenStream,
}: {
  boardIssue: LinearBoardIssue;
  onBack: () => void;
  /** Ejecutar: el run se abre en la consola principal (tab claude). */
  onRun: (task: Task, run: RunRef) => void;
  /** Ver el stream de un run ya en curso (misma consola). */
  onOpenStream: (task: Task) => void;
}) {
  const identifier = boardIssue.identifier;
  const [issue, setIssue] = useState<LinearIssueFull | null>(null);
  const [execs, setExecs] = useState<TaskExecutionSummary[]>([]);
  const [openExec, setOpenExec] = useState<string | null>(null);
  const [busy, setBusy] = useState<"exec" | "done" | "reopen" | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setIssue(null);
    setExecs([]);
    setOpenExec(null);
    let alive = true;
    void getLinearIssue(identifier).then((i) => alive && setIssue(i));
    if (boardIssue.local) {
      void listTaskExecutions(boardIssue.local.task_id).then((e) => alive && setExecs(e));
    }
    return () => {
      alive = false;
    };
  }, [identifier, boardIssue.local]);

  const running = boardIssue.local?.status === "running";

  const exec = async () => {
    setBusy("exec");
    try {
      const run = await executeLinearIssue(identifier);
      if (!run) return;
      const task = await getTask(run.taskId);
      if (task) onRun(task, run);
    } finally {
      setBusy(null);
    }
  };

  const openStream = async () => {
    if (!boardIssue.local) return;
    const task = await getTask(boardIssue.local.task_id);
    if (task) onOpenStream(task);
  };

  const setState = async (type: "completed" | "unstarted", kind: "done" | "reopen") => {
    setBusy(kind);
    try {
      await setLinearIssueState(identifier, type);
      const fresh = await getLinearIssue(identifier);
      if (fresh) setIssue(fresh);
    } finally {
      setBusy(null);
    }
  };

  const copyPrompt = async () => {
    if (!issue?.copyPrompt) return;
    try {
      await navigator.clipboard.writeText(issue.copyPrompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard bloqueado: el bloque sigue visible */
    }
  };

  const notDone = issue ? issue.state.type !== "completed" : boardIssue.state.type !== "completed";

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Cabecera de PIEZA: ← Tareas · identificador · acciones del issue. La
          decisión del tablero (ejecutar / cerrar) vive arriba, a un clic. */}
      <ViewHeader
        title={identifier}
        onBack={onBack}
        backLabel="Tareas"
        meta={
          running ? (
            <span className="inline-flex items-center gap-1.5 text-text-dim">
              <span aria-hidden className="pulse-dot h-1.5 w-1.5 rounded-full bg-cyan" />
              Ejecutando
            </span>
          ) : undefined
        }
        actions={
          <>
            <a
              href={boardIssue.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-7 items-center gap-1.5 rounded-sm px-2.5 text-xs font-medium text-text-dim transition-colors hover:bg-hover hover:text-text"
            >
              Abrir en Linear
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M7 17 17 7M9 7h8v8" />
              </svg>
            </a>
            {issue &&
              (notDone ? (
                <Button
                  onClick={() => void setState("completed", "done")}
                  disabled={busy !== null}
                  title="Marcar Done en Linear (tras revisar el resultado)"
                  icon={
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="m5 12.5 4.5 4.5L19 7.5" />
                    </svg>
                  }
                >
                  {busy === "done" ? "Marcando…" : "Marcar hecho"}
                </Button>
              ) : (
                <Button onClick={() => void setState("unstarted", "reopen")} disabled={busy !== null}>
                  {busy === "reopen" ? "Reabriendo…" : "Reabrir"}
                </Button>
              ))}
            {running ? (
              <Button variant="primary" onClick={() => void openStream()}>
                Ver en la consola
              </Button>
            ) : (
              notDone && (
                <Button
                  variant="primary"
                  onClick={() => void exec()}
                  disabled={busy !== null}
                  title={
                    issue?.copyPrompt
                      ? "Ejecutar el Copy prompt con Claude Code (se abre en la consola)"
                      : "Sin Copy prompt: se ejecuta con un prompt generado del issue"
                  }
                  icon={
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                      <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" />
                    </svg>
                  }
                >
                  {busy === "exec" ? "Lanzando…" : "Ejecutar con Claude Code"}
                </Button>
              )
            )}
          </>
        }
      />

      {!issue ? (
        <PanelState kind="loading" title="Cargando issue…" />
      ) : (
        <div className="mx-auto flex w-full max-w-[1040px] min-h-0 flex-1 gap-8 overflow-hidden">
          {/* ── Cuerpo ── */}
          <div className="min-w-0 flex-1 overflow-y-auto pr-2 pb-6">
            <h2 className="text-lg leading-snug font-semibold text-text">{issue.title}</h2>

            {/* Descripción (sin la sección Copy prompt — esa va aparte) */}
            <div className="mt-4">
              {issue.description.split(/^##\s.*copy prompt.*$/im)[0].trim() ? (
                <Markdown source={issue.description.split(/^##\s.*copy prompt.*$/im)[0].trim()} />
              ) : (
                <p className="text-sm text-text-faint">Sin descripción.</p>
              )}
            </div>

            {/* Copy prompt: se OPERA (copiar), por eso lleva marco. */}
            <section className="mt-6 overflow-hidden rounded-md border border-line bg-panel">
              <div className="flex h-10 items-center justify-between border-b border-line pr-1.5 pl-3.5">
                <span className="text-xs font-medium text-text">Copy prompt</span>
                {issue.copyPrompt && (
                  <button
                    type="button"
                    onClick={() => void copyPrompt()}
                    className={`inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-xs px-2 text-xs transition-colors hover:bg-hover ${
                      copied ? "text-green" : "text-text-dim hover:text-text"
                    }`}
                  >
                    {copied ? (
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="m5 12.5 4.5 4.5L19 7.5" />
                      </svg>
                    ) : (
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <rect x="8" y="8" width="12" height="12" rx="2" />
                        <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
                      </svg>
                    )}
                    {copied ? "Copiado" : "Copiar"}
                  </button>
                )}
              </div>
              {issue.copyPrompt ? (
                <pre className="max-h-72 overflow-y-auto px-3.5 py-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-text">
                  {issue.copyPrompt}
                </pre>
              ) : (
                <p className="px-3.5 py-3 text-xs text-text-faint">
                  Este issue no trae bloque Copy prompt. Ejecutar usa un prompt generado del
                  título y la descripción; pídele a Hermes que lo re-cree con contexto si
                  quieres uno curado.
                </p>
              )}
            </section>

            {/* Ejecuciones de esta tarea (memoria: prompt · análisis · resultado) */}
            {execs.length > 0 && (
              <section className="mt-6">
                <h3 className="mb-2 flex items-center gap-2 text-xs font-medium text-text-dim">
                  Ejecuciones
                  <span className="text-text-faint tabular-nums">{execs.length}</span>
                </h3>
                <div className="space-y-0.5">
                  {execs.map((e) => (
                    <div key={e.id}>
                      <button
                        type="button"
                        onClick={() => setOpenExec(openExec === e.id ? null : e.id)}
                        aria-expanded={openExec === e.id}
                        className={`flex h-9 w-full min-w-0 cursor-pointer items-center gap-3 rounded-sm px-2 text-left transition-colors ${
                          openExec === e.id ? "bg-selected" : "hover:bg-hover"
                        }`}
                      >
                        <span
                          aria-label={e.status === "done" ? "Terminó bien" : "Falló"}
                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                            e.status === "done" ? "bg-green" : "bg-red"
                          }`}
                        />
                        <span className="min-w-0 flex-1 truncate text-sm text-text">
                          {e.result_snippet || e.id}
                        </span>
                        <span className="shrink-0 font-mono text-2xs text-text-faint tabular-nums">
                          {e.created_at.slice(5, 16).replace("T", " ")}
                          {e.cost_usd != null ? ` · $${e.cost_usd.toFixed(2)}` : ""}
                        </span>
                      </button>
                      {openExec === e.id && (
                        <div className="mt-1 mb-2 rounded-md border border-line bg-panel p-3">
                          <ExecutionDetail
                            project={e.project_slug}
                            id={e.id}
                            onBack={() => setOpenExec(null)}
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>

          {/* ── Propiedades (sidebar Linear-style) ── */}
          <aside className="w-[220px] shrink-0 overflow-y-auto border-l border-line pl-6">
            <h3 className="mb-3 text-xs font-medium text-text-dim">Propiedades</h3>
            <dl className="space-y-3.5 text-sm">
              <PropRow label="Estado">
                <span className="flex items-center gap-2 text-text">
                  <StateIcon type={issue.state.type} />
                  {issue.state.name}
                </span>
              </PropRow>
              <PropRow label="Prioridad">
                <span className="flex items-center gap-2 text-text">
                  <PriorityIcon priority={issue.priority} />
                  {PRIORITY_TEXT[issue.priority] ?? "—"}
                </span>
              </PropRow>
              <PropRow label="Proyecto">
                <span className="text-text">{issue.project?.name ?? "—"}</span>
              </PropRow>
              {issue.labels.nodes.length > 0 && (
                <PropRow label="Labels">
                  <span className="flex flex-wrap gap-1">
                    {issue.labels.nodes.map((l) => (
                      <span
                        key={l.name}
                        className="inline-flex h-5 items-center rounded-full border border-line px-2 text-2xs text-text-dim"
                      >
                        {l.name}
                      </span>
                    ))}
                  </span>
                </PropRow>
              )}
              <PropRow label="Creado">
                <span className="font-mono text-xs text-text-dim tabular-nums">
                  {issue.createdAt.slice(0, 10)}
                </span>
              </PropRow>
              <PropRow label="Actualizado">
                <span className="font-mono text-xs text-text-dim tabular-nums">
                  {issue.updatedAt.slice(0, 10)}
                </span>
              </PropRow>
              {issue.copyPrompt && (
                <PropRow label="Prompt">
                  <span className="text-text-dim">Listo para ejecutar</span>
                </PropRow>
              )}
            </dl>
          </aside>
        </div>
      )}
    </div>
  );
}

function PropRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-text-faint">{label}</dt>
      <dd className="mt-1">{children}</dd>
    </div>
  );
}
