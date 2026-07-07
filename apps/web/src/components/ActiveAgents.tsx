"use client";

import { Panel } from "./Panel";
import type { Stats } from "@/hooks/useHermesData";

export function ActiveAgents({ stats, online }: { stats: Stats | null; online: boolean }) {
  const presence = stats?.presence;
  const status = !online ? "offline" : presence?.status ?? "idle";
  const color =
    status === "working" || status === "thinking"
      ? "var(--amber)"
      : status === "offline"
        ? "var(--red)"
        : "var(--green)";

  return (
    <Panel title="Active Agents" delay={120}>
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className={status !== "idle" ? "pulse-dot" : ""}
              style={{ color, textShadow: `0 0 8px ${color}` }}
            >
              ●
            </span>
            <span className="font-display text-sm font-semibold tracking-[0.15em]">HERMES</span>
          </div>
          <span className="text-[9px] tracking-[0.2em] uppercase" style={{ color }}>
            {status}
          </span>
        </div>
        {presence?.currentTask && (
          <p className="truncate text-[10px]" style={{ color: "var(--text-dim)" }}>
            ▸ {presence.currentTask}
          </p>
        )}
        <div className="flex items-center justify-between text-[9px] tracking-[0.18em]" style={{ color: "var(--text-dim)" }}>
          <span>CLAUDE AGENT SDK</span>
          <span>{stats?.machine?.toUpperCase() ?? "—"}</span>
        </div>
      </div>
    </Panel>
  );
}
