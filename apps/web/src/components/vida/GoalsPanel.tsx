"use client";

import type { Goal } from "@hermes/shared";
import { BarMeter } from "@/components/ui/BarMeter";
import { CmdButton } from "@/components/ui/CmdButton";
import { PanelState } from "@/components/ui/PanelState";

/**
 * Metas activas: BarMeter continuo current/target (o hitos como checklist
 * con dot para metas cualitativas) con +1 rápido para las numéricas.
 */
export function GoalsPanel({
  goals,
  onBump,
  onMilestone,
}: {
  goals: Goal[];
  onBump: (id: number, delta: number) => Promise<unknown>;
  onMilestone: (id: number, milestone: string) => Promise<unknown>;
}) {
  if (!goals.length) {
    return (
      <PanelState
        kind="empty"
        compact
        title="Sin metas activas"
        hint="Díselo a Hermes: “mi meta es leer 12 libros este año”."
      />
    );
  }

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto pr-1">
      {goals.map((g) => {
        const doneMilestones = g.milestones.filter((m) => m.done).length;
        // Progreso real: numérico (current/target) o por hitos completados.
        const numeric = g.target_value != null && g.target_value > 0;
        const value = numeric ? g.current_value : doneMilestones;
        const max = numeric ? (g.target_value as number) : g.milestones.length || 1;
        const pct = Math.min(value / max, 1);

        return (
          <div key={g.id} className="rounded-sm border border-line px-2.5 py-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate text-xs text-text">{g.title}</span>
              <span className="shrink-0 font-display text-2xs text-cyan tabular-nums">
                {g.target_value != null
                  ? `${g.current_value}/${g.target_value}${g.unit ? ` ${g.unit}` : ""}`
                  : `${doneMilestones}/${g.milestones.length} hitos`}
                {g.due_date && <span className="ml-1 text-text-dim">· {g.due_date.slice(5)}</span>}
              </span>
            </div>

            {/* Barra de progreso con % real */}
            <div className="mt-1.5 flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <BarMeter
                  value={value}
                  max={max}
                  segments={0}
                  height={5}
                  tone={pct >= 1 ? "green" : "violet"}
                />
              </div>
              {g.target_value != null && (
                /* Wrapper shrink-0: .cmd-btn trae width:100% y aquí va inline */
                <div className="shrink-0">
                  <CmdButton size="sm" onClick={() => void onBump(g.id, 1)} title="Sumar 1 al progreso">
                    +1
                  </CmdButton>
                </div>
              )}
            </div>

            {/* Hitos como checklist con dot */}
            {g.milestones.length > 0 && (
              <div className="mt-1.5 space-y-0.5">
                {g.milestones.map((m) => (
                  <button
                    key={m.title}
                    type="button"
                    disabled={m.done}
                    onClick={() => void onMilestone(g.id, m.title)}
                    className="group flex w-full items-center gap-1.5 text-left text-2xs disabled:cursor-default"
                  >
                    <span
                      aria-hidden
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        m.done ? "bg-green" : "border border-line-2 group-hover:border-green"
                      }`}
                    />
                    <span
                      className={
                        m.done
                          ? "text-green line-through opacity-70"
                          : "text-text-dim transition-colors group-hover:text-text"
                      }
                    >
                      {m.title}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
