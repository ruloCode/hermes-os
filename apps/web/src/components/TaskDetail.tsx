"use client";

import { useEffect, useState } from "react";
import type { Task, TaskExecutionSummary } from "@hermes/shared";
import { continueTask } from "@/lib/hermes";
import { useTaskExecutions } from "@/hooks/useTaskExecutions";
import { ClaudeTerminal } from "./ClaudeTerminal";
import { ExecutionDetail } from "./ExecutionDetail";

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

  const { executions, loading: execsLoading } = useTaskExecutions(target?.task?.id ?? null);

  useEffect(() => {
    setSessionId(target?.sessionId ?? null);
    setRunId(target?.runId ?? null);
    setDraft("");
    setTab("live");
    setOpenExec(null);
  }, [target?.project, target?.runId, target?.sessionId, target?.task?.id]);

  if (!target) {
    return (
      <div className="grid h-full place-items-center px-6 text-center">
        <p className="text-[11px] leading-relaxed" style={{ color: "var(--text-dim)" }}>
          Elige una tarea o una ejecución para ver su detalle y el stream en vivo.
        </p>
      </div>
    );
  }

  const t = target.task;
  // No se puede inyectar a un `claude -p` vivo: continuar solo cuando NO corre.
  const running = execStatus === "running" || t?.status === "running";

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

  return (
    <div className="flex h-full flex-col gap-2">
      {t && (
        <div className="shrink-0 space-y-1 border-b pb-2" style={{ borderColor: "var(--line)" }}>
          <p className="text-[12px] font-semibold leading-snug" style={{ color: "var(--text)" }}>
            {t.title}
          </p>
          <div className="flex flex-wrap gap-x-3 text-[9px] tracking-[0.12em] uppercase" style={{ color: "var(--text-dim)" }}>
            <span style={{ color: "var(--cyan)" }}>{t.project_slug}</span>
            <span>· {t.status}</span>
            <span>· {t.source}</span>
          </div>
          {t.detail && (
            <p className="text-[10.5px] leading-snug" style={{ color: "var(--text-dim)" }}>
              {t.detail}
            </p>
          )}
          {t.exec_prompt && (
            <details className="text-[10px]">
              <summary className="cursor-pointer" style={{ color: "var(--violet)" }}>
                prompt de ejecución
              </summary>
              <p className="mt-1 whitespace-pre-wrap leading-snug" style={{ color: "var(--text-dim)" }}>
                {t.exec_prompt}
              </p>
            </details>
          )}
        </div>
      )}

      {/* Segmentado: stream en vivo · memoria de ejecuciones */}
      {t && (
        <div className="flex shrink-0 gap-1.5">
          <TabButton active={tab === "live"} onClick={() => setTab("live")} label="En vivo" />
          <TabButton
            active={tab === "execs"}
            onClick={() => setTab("execs")}
            label={`Ejecuciones${executions.length ? ` (${executions.length})` : ""}`}
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
          className="shrink-0 border-t pt-2"
          style={{ borderColor: "var(--line)" }}
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
              className="max-h-[90px] min-h-[30px] flex-1 resize-none rounded-sm border bg-transparent px-2 py-1 text-[11px] leading-snug outline-none disabled:opacity-40"
              style={{ borderColor: "var(--line)", color: "var(--text)" }}
            />
            <button
              type="button"
              title="Continuar donde se quedó (resume la sesión)"
              onClick={() => void send()}
              disabled={running || busy}
              className="cmd-btn !w-auto disabled:opacity-40"
              style={{ borderColor: "var(--cyan)", color: "var(--cyan)" }}
            >
              {busy ? "…" : "↻ Continuar"}
            </button>
            <button
              type="submit"
              title="Enviar este prompt a la tarea"
              disabled={running || busy || !draft.trim()}
              className="cmd-btn !w-auto disabled:opacity-40"
              style={{ borderColor: "var(--violet)", color: "var(--violet)" }}
            >
              ▶
            </button>
          </div>
          <p className="mt-1 text-[8.5px] tracking-[0.1em]" style={{ color: "var(--text-dim)" }}>
            {running
              ? "El run sigue corriendo en el agente aunque navegues. Podrás continuar al terminar."
              : "Reanuda la MISMA conversación de la tarea con un run nuevo."}
          </p>
        </form>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-sm border px-2.5 py-1 text-[9px] tracking-[0.14em] uppercase transition-opacity"
      style={{
        borderColor: active ? "var(--violet)" : "var(--line)",
        color: active ? "var(--violet)" : "var(--text-dim)",
        background: active ? "rgba(167,139,250,0.08)" : "transparent",
        opacity: active ? 1 : 0.7,
      }}
    >
      {label}
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
    return (
      <p className="pt-6 text-center text-[10px] tracking-[0.25em] pulse-dot" style={{ color: "var(--text-dim)" }}>
        CARGANDO EJECUCIONES…
      </p>
    );
  }
  if (executions.length === 0) {
    return (
      <p className="pt-6 text-center text-[10.5px] leading-relaxed" style={{ color: "var(--text-dim)" }}>
        Sin ejecuciones todavía. Cuando ejecutes o continúes esta tarea, aquí quedará el
        registro de lo que se hizo y su resultado.
      </p>
    );
  }
  return (
    <div className="h-full space-y-1.5 overflow-y-auto pr-1">
      {executions.map((e) => (
        <button
          key={e.id}
          type="button"
          onClick={() => onOpen(e.id)}
          className="flex w-full items-start justify-between gap-2 rounded-sm border px-2.5 py-2 text-left transition-colors hover:border-[var(--violet)]"
          style={{ borderColor: "var(--line)", background: "rgba(122,132,255,0.03)" }}
        >
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2 text-[9px] tracking-[0.12em] uppercase" style={{ color: "var(--text-dim)" }}>
              <span style={{ color: e.status === "done" ? "var(--green)" : "var(--red)" }}>
                ● {e.status === "done" ? "hecha" : "error"}
              </span>
              <span>{e.kind === "continue" ? "continuación" : "ejecución"}</span>
              <span>· {e.created_at.slice(0, 16).replace("T", " ")}</span>
              {e.cost_usd != null && <span>· ${e.cost_usd.toFixed(2)}</span>}
            </span>
            <span className="mt-1 block truncate text-[11px]" style={{ color: "var(--text)" }}>
              {e.result_snippet || "—"}
            </span>
          </span>
          <span className="text-[10px]" style={{ color: "var(--violet)" }}>
            →
          </span>
        </button>
      ))}
    </div>
  );
}
