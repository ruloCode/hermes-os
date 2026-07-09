"use client";

import { useState } from "react";
import Link from "next/link";
import type { Task } from "@hermes/shared";
import { useHermesData } from "@/hooks/useHermesData";
import type { RunRef } from "@/lib/hermes";
import { Panel } from "@/components/Panel";
import { Clock } from "@/components/Clock";
import { OrchestratorPanel } from "@/components/OrchestratorPanel";
import { TaskBoard } from "@/components/TaskBoard";
import { TaskDetail, type DetailTarget } from "@/components/TaskDetail";

/**
 * Página de Control de Misión: ejecuciones en vivo (todos los proyectos) +
 * tablero de tareas por estado con filtro por proyecto + detalle/stream de la
 * ejecución seleccionada. Reutiliza OrchestratorPanel y ClaudeTerminal.
 */
export default function OrquestadorPage() {
  const { projects, stats, online } = useHermesData();
  const [detail, setDetail] = useState<DetailTarget | null>(null);

  const selectTask = (task: Task) =>
    setDetail({
      project: task.project_slug,
      runId: task.status === "running" ? task.run_id ?? null : null,
      sessionId: task.session_id ?? null,
      task,
    });
  const openRunFromTask = (task: Task, run: RunRef) =>
    setDetail({ project: run.slug, runId: run.runId, sessionId: run.sessionId, task });
  const openRun = ({ slug, runId, sessionId }: { slug: string; runId: string; sessionId: string }) =>
    setDetail({ project: slug, runId, sessionId, task: null });

  return (
    <main className="mx-auto flex h-screen max-w-[1700px] flex-col gap-3 p-3 lg:p-4">
      {/* Header + nav */}
      <header className="hud-in flex items-end justify-between px-1">
        <div className="flex items-end gap-4">
          <h1 className="font-display text-2xl font-bold tracking-[0.3em] glow-violet">
            CONTROL DE <span style={{ color: "var(--violet)" }}>MISIÓN</span>
          </h1>
          <nav className="flex gap-4 pb-1 text-[10px] tracking-[0.3em] uppercase">
            <Link href="/" style={{ color: "var(--text-dim)" }} className="transition-colors hover:opacity-100">
              ← Dashboard
            </Link>
            <span style={{ color: "var(--violet)" }}>Orquestador</span>
          </nav>
        </div>
        <div className="flex items-end gap-4">
          <span className="pb-1 text-[9px] tracking-[0.25em] uppercase" style={{ color: online ? "var(--green)" : "var(--red)" }}>
            {online ? "● operativo" : "○ offline"}
          </span>
          <Clock />
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-12 gap-3">
        {/* Izquierda: runs vivos + tablero de tareas */}
        <div className="col-span-8 flex min-h-0 flex-col gap-3">
          <div className="max-h-[32vh] shrink-0 overflow-y-auto">
            <OrchestratorPanel
              online={online}
              onOpenRun={openRun}
              dailyCostUsd={stats?.dailyRunCostUsd}
              runsToday={stats?.runsToday}
            />
          </div>
          <Panel title="Tareas por proyecto" delay={90} className="min-h-0 flex-1">
            <TaskBoard
              projects={projects}
              selectedTaskId={detail?.task?.id ?? null}
              onSelect={selectTask}
              onRun={openRunFromTask}
            />
          </Panel>
        </div>

        {/* Derecha: detalle/stream de la ejecución */}
        <div className="col-span-4 flex min-h-0 flex-col">
          <Panel title="Detalle de ejecución" delay={140} className="min-h-0 flex-1">
            <TaskDetail target={detail} />
          </Panel>
        </div>
      </div>
    </main>
  );
}
