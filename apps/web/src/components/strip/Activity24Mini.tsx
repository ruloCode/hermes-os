"use client";

// Mini ACTIVIDAD 24H: área de la serie horaria del agente + total del período.
// Con source "memoria" la serie es parcial (no persiste reinicios) y el título
// lo dice. Se oculta si el agente no expone la serie.

import type { ActivitySeries } from "@hermes/shared";
import { AreaChartMini } from "@/components/ui/AreaChartMini";

export function Activity24Mini({
  activity,
  delay = 0,
}: {
  activity: ActivitySeries | null;
  delay?: number;
}) {
  if (!activity) return null;

  const total = activity.buckets.reduce((acc, b) => acc + b.total, 0);
  const partial = activity.source === "memoria";

  return (
    <div
      className="hud-panel hud-in flex min-h-[92px] flex-col gap-1 p-3"
      style={{ animationDelay: `${delay}ms` }}
    >
      <header className="flex items-center gap-1.5">
        <span aria-hidden className="h-1 w-1 shrink-0 rounded-full bg-violet" />
        <h3 className="min-w-0 truncate text-2xs tracking-label uppercase text-text-dim">
          Actividad 24h{partial ? " (parcial)" : ""}
        </h3>
        <span
          className="ml-auto font-display text-xs tabular-nums text-violet"
          title="Eventos del agente en las últimas 24 horas"
        >
          {total.toLocaleString("es-CO")}
        </span>
      </header>
      <div className="min-h-0 flex-1">
        <AreaChartMini
          data={activity.buckets.map((b) => b.total)}
          height={44}
          tone="violet"
          labels={["-24h", "ahora"]}
          ariaLabel={`Actividad del agente en las últimas 24 horas: ${total} eventos`}
        />
      </div>
    </div>
  );
}
