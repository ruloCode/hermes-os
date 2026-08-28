"use client";

// Mini SISTEMA: CPU / RAM / DISCO del Mac local en tres BarMeter compactos.
// La fila de disco se omite cuando diskTotalBytes = 0 (statfs no disponible).

import type { SystemMetrics } from "@hermes/shared";
import { BarMeter } from "@/components/ui/BarMeter";

const THRESHOLDS = { warn: 75, danger: 90 };

export function SystemMini({ system, delay = 0 }: { system: SystemMetrics; delay?: number }) {
  return (
    <div
      className="hud-panel hud-in flex min-h-[92px] flex-col gap-1.5 p-3"
      style={{ animationDelay: `${delay}ms` }}
    >
      <header className="flex items-center gap-1.5">
        <span aria-hidden className="h-1 w-1 shrink-0 rounded-full bg-cyan" />
        <h3 className="text-2xs tracking-label uppercase text-text-dim">Sistema</h3>
      </header>
      <div className="flex min-h-0 flex-1 flex-col justify-center gap-1.5">
        <BarMeter label="CPU" value={system.cpuPct} thresholds={THRESHOLDS} height={6} tone="cyan" />
        <BarMeter label="RAM" value={system.memUsedPct} thresholds={THRESHOLDS} height={6} tone="cyan" />
        {system.diskTotalBytes > 0 && (
          <BarMeter
            label="DISCO"
            value={system.diskUsedPct}
            thresholds={THRESHOLDS}
            height={6}
            tone="cyan"
          />
        )}
      </div>
    </div>
  );
}
