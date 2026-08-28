"use client";

// "ESTADO DEL PROYECTO" (referencia) — versión determinista y honesta: el
// gauge de progreso sale del tracker (done vs total REALES), el git del repo
// local y las prioridades de las tareas pendientes. Nada lo redacta un LLM y
// nada se inventa: si una fuente falta, su bloque se omite.

import { useEffect, useState } from "react";
import type { ProjectContext, Task, TrackerSummary } from "@hermes/shared";
import { getProjectContext, getTrackerSummary, listTasks } from "@/lib/hermes";
import { useOrchestrator } from "@/state/OrchestratorProvider";
import { Panel } from "./ui/Panel";
import { RadialGauge } from "./ui/RadialGauge";
import { DataRow } from "./ui/DataRow";
import { Badge } from "./ui/Badge";
import type { Tone } from "./ui/tones";

// Prioridad honesta por origen: lo que salió de una junta pesa más que lo
// importado del vault. No hay campo "prioridad" en la tabla — no se finge.
const SOURCE_PRIORITY: Record<string, { label: string; tone: Tone }> = {
  meeting: { label: "Alta", tone: "red" },
  voice: { label: "Media", tone: "amber" },
  manual: { label: "Media", tone: "amber" },
  vault: { label: "Baja", tone: "blue" },
};

function relTime(epochMs: number): string {
  const mins = Math.max(0, Math.round((Date.now() - epochMs) / 60_000));
  if (mins < 60) return `hace ${mins} min`;
  const h = Math.round(mins / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} días`;
}

export function ProjectStatusCard({ slug, name }: { slug: string; name?: string }) {
  const { runs } = useOrchestrator();
  const [ctx, setCtx] = useState<ProjectContext | null>(null);
  const [tracker, setTracker] = useState<TrackerSummary | null>(null);
  const [pending, setPending] = useState<Task[]>([]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const [c, t, p] = await Promise.allSettled([
        getProjectContext(slug),
        getTrackerSummary(slug),
        listTasks({ project: slug, status: "pending" }),
      ]);
      if (!alive) return;
      setCtx(c.status === "fulfilled" ? c.value : null);
      setTracker(t.status === "fulfilled" ? t.value : null);
      setPending(p.status === "fulfilled" ? p.value : []);
    };
    void load();
    const t = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [slug]);

  const total = tracker?.available
    ? tracker.done + tracker.pending + tracker.running
    : 0;
  const progress = total > 0 ? Math.round(((tracker?.done ?? 0) / total) * 100) : null;
  const activeHere = runs.filter((r) => r.projectSlug === slug && r.status === "running").length;
  const git = ctx?.git ?? null;

  return (
    <Panel title="Estado del proyecto" variant="hero" tone="cyan" delay={60} className="shrink-0">
      <div className="flex items-start gap-4">
        {/* Progreso real del tracker (done / total); sin tareas no hay gauge. */}
        {progress != null ? (
          <RadialGauge value={progress} size={84} tone="cyan" label="progreso" />
        ) : (
          <div className="grid h-[78px] w-[78px] shrink-0 place-items-center border border-line text-center text-2xs tracking-label text-text-faint uppercase">
            sin tareas
          </div>
        )}
        <div className="min-w-0 flex-1">
          {git && (
            <>
              <DataRow label="Rama" value={git.rama} tone="cyan" />
              <DataRow label="Último commit" value={relTime(git.commitAt)} />
              <DataRow
                label="Sin commitear"
                value={git.archivosCambiados}
                tone={git.archivosCambiados > 0 ? "amber" : "green"}
              />
            </>
          )}
          <DataRow label="Runs activos aquí" value={activeHere} tone={activeHere ? "amber" : "neutral"} />
          {tracker?.available && total > 0 && (
            <DataRow label="Tareas" value={`${tracker.done}/${total} hechas`} tone="cyan" />
          )}
        </div>
      </div>

      {/* Prioridades de hoy: tareas pending reales del tracker. */}
      {pending.length > 0 && (
        <div className="mt-3 border-t border-line pt-2">
          <p className="mb-1.5 text-2xs tracking-label text-text-dim uppercase">
            Tus prioridades — {name ?? slug}
          </p>
          <ol className="space-y-1">
            {pending.slice(0, 4).map((t, i) => {
              const pri = SOURCE_PRIORITY[t.source] ?? SOURCE_PRIORITY.manual;
              return (
                <li key={t.id} className="flex items-baseline gap-2">
                  <span className="shrink-0 font-display text-xs text-violet tabular-nums">
                    {i + 1}.
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs text-text" title={t.title}>
                    {t.title}
                  </span>
                  <Badge tone={pri.tone} variant="solid" size="sm">
                    {pri.label}
                  </Badge>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </Panel>
  );
}
