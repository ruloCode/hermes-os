"use client";

// AGENTES ACTIVOS — versión honesta del panel de la referencia: en vez de 5
// agentes inventados, lista lo que REALMENTE está vivo: el núcleo HERMES
// (presencia local) + cada run de Claude Code en curso + las tareas async del
// SDK. Las sparklines son deltas reales de toolCalls entre polls (un run
// recién visto no tiene curva todavía — nunca se dibuja una falsa).

import type { Stats } from "@/hooks/useHermesData";
import { useOrchestrator } from "@/state/OrchestratorProvider";
import { Panel } from "@/components/ui/Panel";
import { StatusPill } from "@/components/ui/StatusPill";
import { Sparkline } from "@/components/ui/Sparkline";

function elapsed(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
}

export function ActiveAgentsList({ stats, online }: { stats: Stats | null; online: boolean }) {
  const { runs, tasks, sparkFor } = useOrchestrator();
  const runningRuns = runs.filter((r) => r.status === "running");
  const working =
    stats?.presence?.status === "working" || stats?.presence?.status === "thinking";
  const count = online ? 1 + runningRuns.length + tasks.length : 0;

  return (
    <Panel
      title="Agentes activos"
      delay={110}
      right={
        <span className="font-display text-xs tabular-nums text-violet">{count}</span>
      }
    >
      <div className="space-y-2">
        {/* Núcleo HERMES: presencia real del agente local */}
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="font-display text-xs font-semibold tracking-label text-text uppercase">
              Hermes
            </p>
            <p className="truncate text-2xs text-text-dim">
              {!online
                ? "agente local sin conexión"
                : (stats?.presence?.currentTask ?? "núcleo · esperando órdenes")}
            </p>
          </div>
          <StatusPill
            status={!online ? "offline" : working ? "warn" : "ok"}
            label={!online ? "OFFLINE" : working ? "WORKING" : "ONLINE"}
            pulse={online && working}
            size="sm"
          />
        </div>

        {/* Un renglón por run de Claude Code en curso */}
        {runningRuns.map((r) => {
          const spark = sparkFor(r.id);
          return (
            <div key={r.id} className="flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-xs font-semibold tracking-label text-cyan uppercase">
                  {r.projectSlug}
                </p>
                <p className="truncate text-2xs text-text-dim">
                  claude · {r.model} · {r.toolCalls}⚙ · {elapsed(r.startedAt)}
                </p>
              </div>
              {spark.length >= 2 ? (
                <Sparkline data={spark} width={64} height={18} tone="cyan" />
              ) : (
                <StatusPill status="warn" label="RUN" pulse size="sm" />
              )}
            </div>
          );
        })}

        {/* Tareas async del SDK (voz / deck) */}
        {tasks.map((t) => (
          <div key={t.id} className="flex items-center justify-between gap-2" title={t.prompt}>
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-xs font-semibold tracking-label text-violet uppercase">
                task
              </p>
              <p className="truncate text-2xs text-text-dim">
                ⚡ {t.prompt} · {t.toolCalls}⚙
              </p>
            </div>
            <StatusPill status="warn" label="ASYNC" pulse size="sm" />
          </div>
        ))}
      </div>
    </Panel>
  );
}
