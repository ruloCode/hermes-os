"use client";

import { useEffect, useState } from "react";
import type { Task, TaskExecutionSummary, TaskState } from "@hermes/shared";
import { continueTask, executeTask, setTaskStatus } from "@/lib/hermes";
import { useTaskExecutions } from "@/hooks/useTaskExecutions";
import { ClaudeTerminal } from "./ClaudeTerminal";
import { ExecutionDetail } from "./ExecutionDetail";
import { TabBar } from "@/components/ui/TabBar";
import { PanelState } from "@/components/ui/PanelState";
import { Badge } from "@/components/ui/Badge";
import type { Tone } from "@/components/ui/tones";

const SOURCE_LABEL: Record<Task["source"], string> = {
  meeting: "junta",
  manual: "manual",
  vault: "vault",
  voice: "voz",
};

// Estado de tarea → label + tono (mismo mapeo que las columnas del tablero).
const STATUS_META: Record<TaskState, { label: string; tone: Tone }> = {
  pending: { label: "Pendiente", tone: "amber" },
  running: { label: "Ejecutando", tone: "cyan" },
  done: { label: "Hecha", tone: "green" },
  dismissed: { label: "Ignorada", tone: "neutral" },
};

/** Qué mostrar en el panel de detalle: una tarea y/o un run/sesión a transmitir. */
export interface DetailTarget {
  project: string;
  runId: string | null;
  sessionId: string | null;
  task: Task | null;
}

/**
 * Panel de detalle del orquestador. Dos vistas hermanas de la misma tarea:
 *  · En vivo → stream de la ejecución / transcript de la sesión (ClaudeTerminal)
 *    + input para CONTINUAR (resume la sesión con otro prompt, nuevo run).
 *  · Ejecuciones → memoria curada: historial de ejecuciones y su documento
 *    {prompt · análisis · resultado} renderizado (ExecutionDetail).
 * El run vive en el agente → sigue aunque navegues.
 */
export function TaskDetail({ target }: { target: DetailTarget | null }) {
  const [sessionId, setSessionId] = useState<string | null>(target?.sessionId ?? null);
  const [runId, setRunId] = useState<string | null>(target?.runId ?? null);
  const [execStatus, setExecStatus] = useState<"running" | "done" | "error" | "idle">("idle");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"live" | "execs">("live");
  const [openExec, setOpenExec] = useState<string | null>(null);
  // Estado local de la tarea: las acciones del panel lo reflejan al instante
  // (el tablero se pone al día solo, con su poll de 5s).
  const [statusOverride, setStatusOverride] = useState<TaskState | null>(null);

  const { executions, loading: execsLoading } = useTaskExecutions(target?.task?.id ?? null);

  useEffect(() => {
    setSessionId(target?.sessionId ?? null);
    setRunId(target?.runId ?? null);
    setDraft("");
    setTab("live");
    setOpenExec(null);
    setStatusOverride(null);
  }, [target?.project, target?.runId, target?.sessionId, target?.task?.id]);

  // El stream es la verdad más fresca: al terminar el run, el pill deja de
  // decir "Ejecutando" aunque el snapshot de la tarea siga viejo.
  useEffect(() => {
    if (statusOverride !== "running") return;
    if (execStatus === "done") setStatusOverride("done");
    else if (execStatus === "error") setStatusOverride(null);
  }, [execStatus, statusOverride]);

  if (!target) {
    return (
      <div className="grid h-full place-items-center px-6">
        <PanelState
          kind="empty"
          title="Sin selección"
          hint="Elige una tarea o una ejecución para ver su detalle y el stream en vivo."
        />
      </div>
    );
  }

  const t = target.task;
  const status: TaskState | undefined = statusOverride ?? t?.status;
  // No se puede inyectar a un `claude -p` vivo: continuar solo cuando NO corre.
  // Si el stream ya terminó (done/error), el snapshot "running" quedó viejo.
  const running = execStatus === "running" || (status === "running" && execStatus === "idle");

  const send = async (prompt?: string) => {
    if (!t || busy || running) return;
    setBusy(true);
    const run = await continueTask(t.id, prompt);
    setBusy(false);
    if (run) {
      setRunId(run.runId);
      setSessionId(run.sessionId);
      setDraft("");
      setTab("live");
    }
  };

  // Acciones del panel: mismas capacidades que el tablero, con label completo.
  const execNow = async () => {
    if (!t || busy || running) return;
    setBusy(true);
    const run = await executeTask(t.id);
    setBusy(false);
    if (run) {
      setStatusOverride("running");
      setRunId(run.runId);
      setSessionId(run.sessionId);
      setTab("live");
    }
  };

  const changeStatus = async (s: TaskState) => {
    if (!t) return;
    await setTaskStatus(t.id, s);
    setStatusOverride(s);
  };

  return (
    <div className="flex h-full flex-col gap-2">
      {t && (
        <div className="shrink-0 space-y-1.5 border-b border-line pb-2">
          {/* Anatomía FIJA (patrón Jira/Linear): título → estado SIEMPRE
              primero y visible → metadata → detalle → acciones con label.
              Entre estados solo cambian los valores y las acciones. */}
          <p className="text-sm leading-snug font-semibold text-text">{t.title}</p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Badge tone={STATUS_META[status ?? t.status].tone}>
              {STATUS_META[status ?? t.status].label}
            </Badge>
            <span className="text-2xs tracking-label text-cyan uppercase">{t.project_slug}</span>
            <span className="text-2xs tracking-label text-text-dim uppercase">
              · {SOURCE_LABEL[t.source] ?? t.source}
            </span>
          </div>
          {t.detail && <p className="text-xs leading-snug text-text-dim">{t.detail}</p>}
          {t.exec_prompt && (
            <details className="text-2xs">
              <summary className="cursor-pointer text-violet">prompt de ejecución</summary>
              <p className="mt-1 leading-snug whitespace-pre-wrap text-text-dim">
                {t.exec_prompt}
              </p>
            </details>
          )}
          {/* Acciones etiquetadas (los glyphs del tablero son solo el atajo) */}
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {status === "pending" && (
              <>
                <ActBtn tone="green" disabled={busy || running} onClick={() => void execNow()}>
                  ▶ Ejecutar
                </ActBtn>
                <ActBtn tone="green" onClick={() => void changeStatus("done")}>
                  ✓ Marcar hecha
                </ActBtn>
                <ActBtn tone="dim" onClick={() => void changeStatus("dismissed")}>
                  ✕ Ignorar
                </ActBtn>
              </>
            )}
            {status === "running" && (
              <>
                <ActBtn tone="green" onClick={() => void changeStatus("done")}>
                  ✓ Marcar hecha
                </ActBtn>
                <ActBtn tone="amber" onClick={() => void changeStatus("pending")}>
                  ↩ Devolver a pendiente
                </ActBtn>
              </>
            )}
            {status === "done" && (
              <ActBtn tone="amber" onClick={() => void changeStatus("pending")}>
                ↩ Reabrir
              </ActBtn>
            )}
            {status === "dismissed" && (
              <ActBtn tone="amber" onClick={() => void changeStatus("pending")}>
                ↩ Reactivar
              </ActBtn>
            )}
          </div>
        </div>
      )}

      {/* Segmentado: stream en vivo · memoria de ejecuciones */}
      {t && (
        <div className="shrink-0">
          <TabBar
            tabs={[
              { id: "live", label: "En vivo" },
              { id: "execs", label: "Ejecuciones", badge: executions.length || undefined },
            ]}
            active={tab}
            onChange={(id) => setTab(id as "live" | "execs")}
          />
        </div>
      )}

      <div className="min-h-0 flex-1">
        {t && tab === "execs" ? (
          openExec ? (
            <ExecutionDetail project={target.project} id={openExec} onBack={() => setOpenExec(null)} />
          ) : (
            <ExecutionsList
              executions={executions}
              loading={execsLoading}
              onOpen={setOpenExec}
            />
          )
        ) : (
          <ClaudeTerminal
            project={target.project}
            runId={runId}
            sessionId={sessionId}
            onStatus={setExecStatus}
            onSelectSession={(id) => {
              setSessionId(id);
              setRunId(null);
            }}
            onNewSession={() => {
              setSessionId(null);
              setRunId(null);
            }}
          />
        )}
      </div>

      {/* Continuar / enviar otro prompt (resume de la sesión de la tarea) */}
      {t && tab === "live" && (
        <form
          className="shrink-0 border-t border-line pt-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send(draft.trim() || undefined);
          }}
        >
          <div className="flex items-end gap-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(draft.trim() || undefined);
                }
              }}
              rows={1}
              disabled={running || busy}
              placeholder={
                running
                  ? "El run está activo… espera a que termine para continuar"
                  : "Continuar o enviar otro prompt a esta tarea…"
              }
              className="max-h-[90px] min-h-[30px] flex-1 resize-none rounded-sm border border-line bg-transparent px-2 py-1 text-xs leading-snug text-text outline-none transition-colors focus:border-line-2 disabled:opacity-40"
            />
            {/* UN solo botón: sin texto continúa donde quedó; con texto envía
                ese prompt (mismo send(), misma sesión — patrón follow-up). */}
            <button
              type="submit"
              title={
                draft.trim()
                  ? "Enviar este prompt a la tarea (nuevo run, misma sesión)"
                  : "Continuar donde se quedó (resume la sesión)"
              }
              disabled={running || busy}
              className="cmd-btn !w-auto !border-cyan !text-cyan disabled:opacity-40"
            >
              {busy ? "…" : draft.trim() ? "▶ Enviar" : "↻ Continuar"}
            </button>
          </div>
          <p className="mt-1 text-2xs text-text-dim">
            {running
              ? "El run sigue corriendo en el agente aunque navegues. Podrás continuar al terminar."
              : "Reanuda la MISMA conversación de la tarea con un run nuevo."}
          </p>
        </form>
      )}
    </div>
  );
}

// Botón de acción del panel: icono + label completo (nunca glyph suelto).
const ACT_CLASS = {
  green: "border-green text-green",
  amber: "border-amber text-amber",
  dim: "border-text-dim text-text-dim",
} as const;

function ActBtn({
  tone,
  onClick,
  disabled,
  children,
}: {
  tone: keyof typeof ACT_CLASS;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-sm border bg-panel-2 px-2 py-1 text-2xs tracking-label uppercase opacity-85 transition-opacity hover:opacity-100 disabled:opacity-40 ${ACT_CLASS[tone]}`}
    >
      {children}
    </button>
  );
}

function ExecutionsList({
  executions,
  loading,
  onOpen,
}: {
  executions: TaskExecutionSummary[];
  loading: boolean;
  onOpen: (id: string) => void;
}) {
  if (loading && executions.length === 0) {
    return <PanelState kind="loading" compact />;
  }
  if (executions.length === 0) {
    return (
      <PanelState
        kind="empty"
        title="Sin ejecuciones todavía"
        hint="Cuando ejecutes o continúes esta tarea, aquí quedará el registro de lo que se hizo y su resultado."
      />
    );
  }
  return (
    <div className="h-full space-y-1.5 overflow-y-auto pr-1">
      {executions.map((e) => (
        <button
          key={e.id}
          type="button"
          onClick={() => onOpen(e.id)}
          className="flex w-full items-start justify-between gap-2 rounded-sm border border-line bg-panel-2 px-2.5 py-2 text-left transition-colors hover:border-violet"
        >
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2 text-2xs tracking-label text-text-dim uppercase">
              <span className={e.status === "done" ? "text-green" : "text-red"}>
                ● {e.status === "done" ? "hecha" : "error"}
              </span>
              <span>{e.kind === "continue" ? "continuación" : "ejecución"}</span>
              <span>· {e.created_at.slice(0, 16).replace("T", " ")}</span>
              {e.cost_usd != null && <span>· ${e.cost_usd.toFixed(2)}</span>}
            </span>
            <span className="mt-1 block truncate text-xs text-text">
              {e.result_snippet || "—"}
            </span>
          </span>
          <span className="text-2xs text-violet">→</span>
        </button>
      ))}
    </div>
  );
}
