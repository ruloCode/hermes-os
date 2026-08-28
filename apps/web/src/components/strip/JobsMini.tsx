"use client";

// Mini JOBS: estado real de los jobs periódicos del agente. Errores primero
// (que un fallo no quede fuera del corte de 3), sin toggles — no existe
// endpoint para apagar jobs y aquí nada se simula. Se oculta sin jobs.

import type { JobStatus } from "@hermes/shared";
import { StatusPill } from "@/components/ui/StatusPill";

/** Mapa resultado → status del pill; null y "skipped" caen en idle. */
const pillStatus = (job: JobStatus): "ok" | "error" | "idle" =>
  job.lastResult === "error" ? "error" : job.lastResult === "ok" ? "ok" : "idle";

export function JobsMini({ jobs, delay = 0 }: { jobs: JobStatus[]; delay?: number }) {
  if (jobs.length === 0) return null;

  // Orden estable con errores al frente: sort es estable en V8.
  const visible = [...jobs]
    .sort((a, b) => Number(b.lastResult === "error") - Number(a.lastResult === "error"))
    .slice(0, 3);

  return (
    <div
      className="hud-panel hud-in flex min-h-[92px] flex-col gap-1.5 p-3"
      style={{ animationDelay: `${delay}ms` }}
    >
      <header className="flex items-center gap-1.5">
        <span aria-hidden className="h-1 w-1 shrink-0 rounded-full bg-green" />
        <h3 className="text-2xs tracking-label uppercase text-text-dim">Jobs</h3>
      </header>
      <ul className="flex min-h-0 flex-1 flex-col justify-center gap-1">
        {visible.map((job) => {
          // El detalle completo (o el error) viaja en el title del row.
          const detail = job.lastResult === "error" ? job.lastError : job.lastDetail;
          return (
            <li
              key={job.name}
              className="flex min-w-0 items-center gap-2"
              title={detail ?? undefined}
            >
              <span className="shrink-0 text-xs text-text">{job.name}</span>
              <span className="min-w-0 flex-1 truncate text-2xs text-text-dim">{detail}</span>
              <span className="shrink-0">
                <StatusPill size="sm" status={pillStatus(job)} />
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
