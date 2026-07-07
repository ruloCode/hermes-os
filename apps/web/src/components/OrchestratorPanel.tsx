"use client";

import { useEffect, useState } from "react";
import type { ClaudeRunSummary, HermesTask } from "@hermes/shared";
import { hermesGet, hermesPost } from "@/lib/hermes";
import { Panel } from "./Panel";

/**
 * Orquestador multi-proyecto: lista en vivo TODOS los runs de Claude Code
 * (`GET /claude/runs`) de todos los proyectos + las tareas async del SDK
 * (`GET /tasks`, voz/deck). Clic en un run → abre su stream en el terminal
 * central; ✕ cancela un run en curso. El header muestra el gasto real del
 * día en runs (acumulador persistente del agente, vía /stats).
 */

// Segundos → "45s" / "3m 12s" / "1h 04m".
function elapsed(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
}

const statusColor = (s: string) =>
  s === "running" ? "var(--amber)" : s === "error" ? "var(--red)" : "var(--green)";

export function OrchestratorPanel({
  online,
  onOpenRun,
  dailyCostUsd,
  runsToday,
}: {
  online: boolean;
  onOpenRun: (r: { slug: string; runId: string; sessionId: string }) => void;
  /** Gasto acumulado de hoy en runs (de /stats); undefined si el agente es viejo. */
  dailyCostUsd?: number;
  runsToday?: number;
}) {
  const [runs, setRuns] = useState<ClaudeRunSummary[]>([]);
  const [tasks, setTasks] = useState<HermesTask[]>([]);
  // Reloj de 1s: fuerza el recálculo de "elapsed" sin re-pedir datos.
  const [, tick] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [r, t] = await Promise.all([
          hermesGet<ClaudeRunSummary[]>("/claude/runs"),
          hermesGet<HermesTask[]>("/tasks"),
        ]);
        if (!alive) return;
        setRuns(r);
        setTasks(t.filter((x) => x.status === "running"));
      } catch {
        if (alive) {
          setRuns([]);
          setTasks([]);
        }
      }
    };
    void load();
    const poll = setInterval(load, 4000);
    const clock = setInterval(() => tick((n) => n + 1), 1000);
    return () => {
      alive = false;
      clearInterval(poll);
      clearInterval(clock);
    };
  }, []);

  // Cancela un run: optimista en UI; el agente manda SIGTERM (y SIGKILL a 5s).
  const kill = async (id: string) => {
    setRuns((prev) => prev.map((r) => (r.id === id ? { ...r, status: "error" as const } : r)));
    try {
      await hermesPost(`/claude/run/${id}/kill`);
    } catch {
      /* el próximo poll corrige el estado real */
    }
  };

  const activeRuns = runs.filter((r) => r.status === "running").length;
  const empty = runs.length === 0 && tasks.length === 0;

  return (
    <Panel
      title="Orquestador"
      delay={130}
      right={
        <span className="text-[9px] tracking-[0.2em] uppercase" style={{ color: "var(--text-dim)" }}>
          {activeRuns > 0 ? `${activeRuns} corriendo` : "en reposo"}
          {dailyCostUsd != null && runsToday != null && runsToday > 0 && (
            <span style={{ color: "var(--violet)" }}> · hoy ${dailyCostUsd.toFixed(2)}</span>
          )}
        </span>
      }
    >
      <div className="space-y-1.5">
        {!online && (
          <p className="text-[10px] tracking-[0.2em]" style={{ color: "var(--text-dim)" }}>
            AGENTE OFFLINE
          </p>
        )}
        {online && empty && (
          <p className="text-[10px] tracking-[0.2em]" style={{ color: "var(--text-dim)" }}>
            SIN RUNS ACTIVOS — lanza uno desde la consola o el deck
          </p>
        )}

        {/* Runs de Claude Code (clic → stream; ✕ → cancelar). div con role
            button porque una fila <button> no puede anidar el botón de kill. */}
        {runs.map((r) => (
          <div
            key={r.id}
            role="button"
            tabIndex={0}
            onClick={() => onOpenRun({ slug: r.projectSlug, runId: r.id, sessionId: r.sessionId })}
            onKeyDown={(e) => {
              if (e.key === "Enter")
                onOpenRun({ slug: r.projectSlug, runId: r.id, sessionId: r.sessionId });
            }}
            title={r.lastText ? `${r.title}\n→ ${r.lastText}` : r.title}
            className="block w-full cursor-pointer rounded-sm px-2 py-1 text-left transition-colors hover:bg-[rgba(122,132,255,0.1)]"
          >
            <div className="flex items-center justify-between gap-2">
              <span
                className="min-w-0 flex-1 truncate font-display text-[11px] font-semibold tracking-[0.1em] uppercase"
                style={{ color: "var(--cyan)" }}
              >
                {r.projectSlug}
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                <span
                  className="text-[8px] tracking-[0.2em] uppercase"
                  style={{ color: statusColor(r.status), textShadow: `0 0 8px ${statusColor(r.status)}` }}
                >
                  {r.status === "running" ? "● run" : r.status === "error" ? "✕ err" : "✓ done"}
                </span>
                {r.status === "running" && (
                  <button
                    type="button"
                    title="Cancelar este run"
                    aria-label={`Cancelar run de ${r.projectSlug}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      void kill(r.id);
                    }}
                    className="grid h-4 w-4 place-items-center rounded-sm text-[9px] leading-none opacity-60 transition-opacity hover:opacity-100"
                    style={{ color: "var(--red)", border: "1px solid var(--red)" }}
                  >
                    ✕
                  </button>
                )}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 flex-1 truncate text-[10px]" style={{ color: "var(--text-dim)" }}>
                ▸ {r.status !== "running" && r.lastText ? r.lastText : r.title}
              </span>
              <span className="shrink-0 text-[8.5px] tracking-[0.08em]" style={{ color: "var(--text-dim)" }}>
                {r.status === "running"
                  ? `${r.model} · ${r.toolCalls}⚙ · ${elapsed(r.startedAt)}`
                  : [
                      r.costUsd != null ? `$${r.costUsd.toFixed(2)}` : null,
                      r.durationMs != null ? `${Math.round(r.durationMs / 1000)}s` : null,
                      `${r.toolCalls}⚙`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
              </span>
            </div>
          </div>
        ))}

        {/* Tareas async del SDK (voz / deck): solo estado, sin stream propio */}
        {tasks.map((t) => (
          <div key={t.id} className="rounded-sm px-2 py-1" title={t.prompt}>
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 flex-1 truncate text-[10px]" style={{ color: "var(--text-dim)" }}>
                ⚡ {t.prompt}
              </span>
              <span
                className="shrink-0 text-[8px] tracking-[0.2em] uppercase"
                style={{ color: "var(--amber)", textShadow: "0 0 8px var(--amber)" }}
              >
                ● async · {t.toolCalls}⚙
              </span>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}
