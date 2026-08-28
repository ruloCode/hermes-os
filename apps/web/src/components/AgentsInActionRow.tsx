"use client";

// "AGENTES EN ACCIÓN" (referencia): chips de los runs de Claude Code REALMENTE
// en curso. Clic → abre su stream en el tab Claude Code. Sin runs, no se
// renderiza nada (cero chips fantasma).

import { useOrchestrator } from "@/state/OrchestratorProvider";
import { useWorkspace } from "@/state/WorkspaceContext";

export function AgentsInActionRow() {
  const { runs } = useOrchestrator();
  const ws = useWorkspace();
  const running = runs.filter((r) => r.status === "running");
  if (!running.length) return null;

  return (
    <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-t border-line pt-2">
      <span className="shrink-0 text-2xs tracking-label text-text-dim uppercase">
        ◍ agentes en acción
      </span>
      {running.map((r) => (
        <button
          key={r.id}
          type="button"
          onClick={() => ws.openRun({ slug: r.projectSlug, runId: r.id, sessionId: r.sessionId })}
          title={r.title}
          className="flex shrink-0 items-center gap-1.5 border border-line px-2 py-1 text-2xs tracking-label text-cyan uppercase transition-colors hover:border-cyan"
        >
          <span aria-hidden className="pulse-dot h-1.5 w-1.5 bg-amber" />
          {r.projectSlug}
          <span className="text-text-dim normal-case tabular-nums">{r.toolCalls}⚙</span>
        </button>
      ))}
    </div>
  );
}
