"use client";

import { Panel } from "./Panel";
import type { Stats } from "@/hooks/useHermesData";

function Vital({
  label,
  value,
  accent = "var(--violet)",
  hint,
}: {
  label: string;
  value: string | number;
  accent?: string;
  hint?: string;
}) {
  return (
    <div className="border-b py-2.5 last:border-b-0" style={{ borderColor: "var(--line)" }}>
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] tracking-[0.22em] uppercase" style={{ color: "var(--text-dim)" }}>
          {label}
        </span>
        {hint && (
          <span className="text-[9px] tracking-widest" style={{ color: "var(--text-dim)" }}>
            {hint}
          </span>
        )}
      </div>
      <div
        className="font-display mt-1 text-2xl font-bold tracking-wider"
        style={{ color: accent, textShadow: `0 0 16px ${accent}55` }}
      >
        {value}
      </div>
    </div>
  );
}

export function SystemVitals({ stats, online }: { stats: Stats | null; online: boolean }) {
  const uptime = stats
    ? `${Math.floor(stats.uptimeSeconds / 3600)}h ${Math.floor((stats.uptimeSeconds % 3600) / 60)}m`
    : "—";
  return (
    <Panel
      title="System Vitals"
      delay={60}
      right={
        <span
          className={`text-[9px] tracking-[0.2em] ${online ? "" : "pulse-dot"}`}
          style={{ color: online ? "var(--green)" : "var(--red)" }}
        >
          {online ? "● ONLINE" : "○ OFFLINE"}
        </span>
      }
    >
      <Vital label="Memorias" value={stats?.memories ?? "—"} accent="var(--violet)" hint="NODOS" />
      <Vital
        label="Proyectos activos"
        value={stats ? `${stats.activeProjects}/${stats.totalProjects}` : "—"}
        accent="var(--cyan)"
      />
      <Vital label="Tareas hoy" value={stats?.tasksToday ?? "—"} accent="var(--blue)" />
      <Vital label="Uptime agente" value={uptime} accent="var(--green)" />
      <div className="mt-2 flex items-center justify-between text-[9px] tracking-[0.18em]" style={{ color: "var(--text-dim)" }}>
        <span>DB {stats?.supabase ? "SYNC" : "LOCAL"}</span>
        <span>{stats?.machine?.toUpperCase() ?? ""}</span>
      </div>
    </Panel>
  );
}
