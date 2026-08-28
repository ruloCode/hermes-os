"use client";

import { useEffect, useState } from "react";
import { useOrchestrator } from "@/state/OrchestratorProvider";
import { Panel } from "@/components/ui/Panel";
import { PanelState } from "@/components/ui/PanelState";
import { StatBlock } from "@/components/ui/StatBlock";
import { StatusPill } from "@/components/ui/StatusPill";

/**
 * Orquestador multi-proyecto: lista en vivo TODOS los runs de Claude Code
 * de todos los proyectos + las tareas async del SDK (voz/deck), desde el
 * poll compartido de OrchestratorProvider. Clic en un run → abre su stream
 * en el terminal central; ✕ cancela un run en curso. La cabecera muestra el
 * gasto real del día en runs (acumulador persistente del agente, vía /stats).
 */

// Segundos → "45s" / "3m 12s" / "1h 04m".
function elapsed(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
}

// Estado del run → props del StatusPill (tono semántico + label corto).
const RUN_PILL: Record<string, { status: "warn" | "error" | "ok"; label: string }> = {
  running: { status: "warn", label: "RUN" },
  error: { status: "error", label: "ERR" },
  done: { status: "ok", label: "DONE" },
};

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
  const { runs, tasks, kill } = useOrchestrator();
  // Reloj de 1s: fuerza el recálculo de "elapsed" sin re-pedir datos.
  const [, tick] = useState(0);
  useEffect(() => {
    const clock = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(clock);
  }, []);

  const activeRuns = runs.filter((r) => r.status === "running").length;
  const empty = runs.length === 0 && tasks.length === 0;

  return (
    <Panel
      title="Orquestador"
      delay={130}
      right={
        <span className="text-2xs tracking-label text-text-dim uppercase">
          {activeRuns > 0 ? `${activeRuns} corriendo` : "en reposo"}
        </span>
      }
    >
      {/* Cabecera de stats: solo con datos reales de /stats (agente nuevo). */}
      {dailyCostUsd != null && runsToday != null && (
        <div className="mb-2 flex items-end gap-6 border-b border-line pb-2">
          <StatBlock
            label="costo hoy"
            value={`$${dailyCostUsd.toFixed(2)}`}
            tone="violet"
            size="lg"
          />
          <StatBlock label="ejecuciones" value={runsToday} size="lg" />
        </div>
      )}

      {!online && <PanelState kind="offline" compact />}
      {online && empty && (
        <PanelState
          kind="empty"
          compact
          title="Sin runs activos"
          hint="lanza uno desde la consola o el deck"
        />
      )}

      <div className="space-y-1.5">
        {/* Runs de Claude Code (clic → stream; ✕ → cancelar). div con role
            button porque una fila <button> no puede anidar el botón de kill. */}
        {runs.map((r) => {
          const pill = RUN_PILL[r.status] ?? RUN_PILL.done;
          return (
            <div
              key={r.id}
              role="button"
              tabIndex={0}
              onClick={() =>
                onOpenRun({ slug: r.projectSlug, runId: r.id, sessionId: r.sessionId })
              }
              onKeyDown={(e) => {
                if (e.key === "Enter")
                  onOpenRun({ slug: r.projectSlug, runId: r.id, sessionId: r.sessionId });
              }}
              title={r.lastText ? `${r.title}\n→ ${r.lastText}` : r.title}
              className="block w-full cursor-pointer rounded-sm px-2 py-1 text-left transition-colors hover:bg-violet/10"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 flex-1 truncate font-display text-xs font-semibold tracking-label text-cyan uppercase">
                  {r.projectSlug}
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <StatusPill
                    size="sm"
                    status={pill.status}
                    label={pill.label}
                    pulse={r.status === "running"}
                  />
                  {r.status === "running" && (
                    <button
                      type="button"
                      title="Cancelar este run"
                      aria-label={`Cancelar run de ${r.projectSlug}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        void kill(r.id);
                      }}
                      className="grid h-4 w-4 place-items-center rounded-sm border border-red text-2xs leading-none text-red opacity-60 transition-opacity hover:opacity-100"
                    >
                      ✕
                    </button>
                  )}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 flex-1 truncate text-2xs text-text-dim">
                  ▸ {r.status !== "running" && r.lastText ? r.lastText : r.title}
                </span>
                <span className="shrink-0 text-2xs text-text-dim tabular-nums">
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
          );
        })}

        {/* Tareas async del SDK (voz / deck): solo estado, sin stream propio */}
        {tasks.map((t) => (
          <div key={t.id} className="rounded-sm px-2 py-1" title={t.prompt}>
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 flex-1 truncate text-2xs text-text-dim">⚡ {t.prompt}</span>
              <span className="flex shrink-0 items-center gap-1.5">
                <StatusPill size="sm" status="warn" label="ASYNC" pulse />
                <span className="text-2xs text-text-dim tabular-nums">{t.toolCalls}⚙</span>
              </span>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}
