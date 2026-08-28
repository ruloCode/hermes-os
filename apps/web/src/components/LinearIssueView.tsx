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
import { Badge } from "@/components/ui/Badge";
import { PanelState } from "@/components/ui/PanelState";
import { PriorityIcon } from "@/components/LinearBoard";

const STATE_TONE = {
  backlog: "neutral",
  unstarted: "violet",
  started: "cyan",
  completed: "green",
  canceled: "neutral",
} as const;

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

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Barra superior: volver + identificador + link */}
      <div className="mb-2 flex shrink-0 items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="rounded-sm border border-line px-2 py-0.5 text-2xs tracking-label text-text-dim uppercase transition-colors hover:border-line-2 hover:text-text"
        >
          ← Tareas
        </button>
        <span className="font-mono text-2xs text-text-dim">{identifier}</span>
        {running && (
          <span className="pulse-dot text-2xs text-cyan" title="Claude Code ejecutando">
            ● ejecutando
          </span>
        )}
        <a
          href={boardIssue.url}
          target="_blank"
          rel="noreferrer"
          className="ml-auto text-2xs tracking-label text-text-dim uppercase transition-colors hover:text-text"
        >
          Abrir en Linear ↗
        </a>
      </div>

      {!issue ? (
        <PanelState kind="loading" title="Cargando issue…" />
      ) : (
        <div className="mx-auto flex w-full max-w-[980px] min-h-0 flex-1 gap-5 overflow-hidden">
          {/* ── Cuerpo ── */}
          <div className="min-w-0 flex-1 overflow-y-auto pr-2">
            <h2 className="text-lg leading-snug font-semibold text-text">{issue.title}</h2>

            {/* Acciones: la decisión del tablero */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {running ? (
                <button
                  type="button"
                  onClick={() => void openStream()}
                  className="cmd-btn !w-auto !border-cyan !text-cyan"
                >
                  ▣ Ver en la consola
                </button>
              ) : (
                issue.state.type !== "completed" && (
                  <button
                    type="button"
                    onClick={() => void exec()}
                    disabled={busy !== null}
                    className="cmd-btn !w-auto !border-green !text-green disabled:opacity-40"
                    title={
                      issue.copyPrompt
                        ? "Ejecutar el Copy prompt con Claude Code (se abre en la consola)"
                        : "Sin Copy prompt: se ejecuta con un prompt generado del issue"
                    }
                  >
                    {busy === "exec" ? "Lanzando…" : "▶ Ejecutar con Claude Code"}
                  </button>
                )
              )}
              {issue.state.type !== "completed" ? (
                <button
                  type="button"
                  onClick={() => void setState("completed", "done")}
                  disabled={busy !== null}
                  className="cmd-btn !w-auto !border-line !text-text-dim hover:!text-green disabled:opacity-40"
                  title="Marcar Done en Linear (tras revisar el resultado)"
                >
                  {busy === "done" ? "…" : "✓ Done"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void setState("unstarted", "reopen")}
                  disabled={busy !== null}
                  className="cmd-btn !w-auto !border-amber !text-amber disabled:opacity-40"
                >
                  {busy === "reopen" ? "…" : "↩ Reabrir"}
                </button>
              )}
            </div>

            {/* Descripción (sin la sección Copy prompt — esa va aparte) */}
            <div className="mt-4">
              {issue.description.split(/^##\s.*copy prompt.*$/im)[0].trim() ? (
                <Markdown source={issue.description.split(/^##\s.*copy prompt.*$/im)[0].trim()} />
              ) : (
                <p className="text-xs text-text-dim">Sin descripción.</p>
              )}
            </div>

            {/* Copy prompt */}
            <div className="mt-4 rounded-sm border border-line bg-panel-2">
              <div className="flex items-center justify-between border-b border-line px-2.5 py-1.5">
                <span className="text-2xs font-semibold tracking-label text-violet uppercase">
                  ⚡ Copy prompt
                </span>
                {issue.copyPrompt && (
                  <button
                    type="button"
                    onClick={() => void copyPrompt()}
                    className={`text-2xs tracking-label uppercase transition-colors ${
                      copied ? "text-green" : "text-text-dim hover:text-text"
                    }`}
                  >
                    {copied ? "✓ copiado" : "⧉ copiar"}
                  </button>
                )}
              </div>
              {issue.copyPrompt ? (
                <pre className="max-h-72 overflow-y-auto p-2.5 font-mono text-2xs leading-relaxed whitespace-pre-wrap text-text">
                  {issue.copyPrompt}
                </pre>
              ) : (
                <p className="p-2.5 text-2xs text-text-dim">
                  Este issue no trae bloque Copy prompt. Ejecutar usa un prompt generado del
                  título y la descripción; pídele a Hermes que lo re-cree con contexto si
                  quieres uno curado.
                </p>
              )}
            </div>

            {/* Ejecuciones de esta tarea (memoria: prompt · análisis · resultado) */}
            {execs.length > 0 && (
              <div className="mt-4">
                <p className="mb-1.5 text-2xs font-semibold tracking-label text-text-dim uppercase">
                  Ejecuciones · {execs.length}
                </p>
                <div className="space-y-1">
                  {execs.map((e) => (
                    <div key={e.id}>
                      <button
                        type="button"
                        onClick={() => setOpenExec(openExec === e.id ? null : e.id)}
                        className={`flex w-full items-center gap-2 rounded-sm border px-2 py-1.5 text-left transition-colors ${
                          openExec === e.id
                            ? "border-violet bg-violet/10"
                            : "border-line bg-panel-2 hover:border-line-2"
                        }`}
                      >
                        <span className={e.status === "done" ? "text-green" : "text-red"}>
                          {e.status === "done" ? "✓" : "⚠"}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-xs text-text">
                          {e.result_snippet || e.id}
                        </span>
                        <span className="shrink-0 text-2xs text-text-dim">
                          {e.created_at.slice(5, 16).replace("T", " ")}
                          {e.cost_usd != null ? ` · $${e.cost_usd.toFixed(2)}` : ""}
                        </span>
                      </button>
                      {openExec === e.id && (
                        <div className="mt-1 rounded-sm border border-line bg-panel-2 p-2">
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
              </div>
            )}
          </div>

          {/* ── Propiedades (sidebar Linear-style) ── */}
          <aside className="w-[210px] shrink-0 overflow-y-auto">
            <p className="mb-2 text-2xs font-semibold tracking-label text-text-dim uppercase">
              Propiedades
            </p>
            <dl className="space-y-2.5 text-xs">
              <PropRow label="Estado">
                <Badge tone={STATE_TONE[issue.state.type as keyof typeof STATE_TONE] ?? "neutral"} size="sm">
                  {issue.state.name}
                </Badge>
              </PropRow>
              <PropRow label="Prioridad">
                <span className="flex items-center gap-1.5 text-text">
                  <PriorityIcon priority={issue.priority} />
                  {PRIORITY_TEXT[issue.priority] ?? "—"}
                </span>
              </PropRow>
              <PropRow label="Proyecto">
                <span className="text-cyan">{issue.project?.name ?? "—"}</span>
              </PropRow>
              {issue.labels.nodes.length > 0 && (
                <PropRow label="Labels">
                  <span className="flex flex-wrap gap-1">
                    {issue.labels.nodes.map((l) => (
                      <span key={l.name} className="text-text-dim">
                        #{l.name}
                      </span>
                    ))}
                  </span>
                </PropRow>
              )}
              <PropRow label="Creado">
                <span className="text-text-dim">{issue.createdAt.slice(0, 10)}</span>
              </PropRow>
              <PropRow label="Actualizado">
                <span className="text-text-dim">{issue.updatedAt.slice(0, 10)}</span>
              </PropRow>
              {issue.copyPrompt && (
                <PropRow label="Prompt">
                  <span className="text-violet">⚡ listo</span>
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
      <dt className="text-2xs tracking-label text-text-dim uppercase">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}
