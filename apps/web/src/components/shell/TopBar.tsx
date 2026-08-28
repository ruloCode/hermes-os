"use client";

// Topbar: UNA línea. Las métricas son texto inline, no paneles.
//
// Antes CPU/RAM/DISCO tenían un panel con título y barras, y Claude Usage un
// gauge radial + 5 modelos + sparkline — para 8 ejecuciones históricas. Aquí
// siguen visibles pero dejan de competir con la consola: dato crudo + micro-barra.
//
// Regla de oro: dato real o nada. Cada pieza se omite si su fuente no responde.

import { useDashboard } from "@/state/DashboardProvider";
import { useHermesData } from "@/hooks/useHermesData";
import { useWorkspace } from "@/state/WorkspaceContext";
import { useOrbState } from "@/components/voice/orbState";
import { Clock } from "@/components/Clock";
import { LiveMeetingChip } from "./LiveMeetingChip";
import { GestureChip } from "./GestureChip";
import { UiHandsChip } from "./UiHandsChip";
import { MachineSelector } from "@/components/MachineSelector";

const ESTADO: Record<string, { txt: string; dot: string }> = {
  na: { txt: "Voz N/A", dot: "bg-text-dim" },
  off: { txt: "En reposo", dot: "bg-green shadow-[0_0_8px_var(--color-green)]" },
  connecting: { txt: "Conectando", dot: "bg-amber shadow-[0_0_8px_var(--color-amber)]" },
  listening: { txt: "Escuchando", dot: "bg-cyan shadow-[0_0_8px_var(--color-cyan)]" },
  speaking: { txt: "Hablando", dot: "bg-violet shadow-[0_0_8px_var(--color-violet)]" },
  exec: { txt: "Ejecutando", dot: "bg-cyan shadow-[0_0_8px_var(--color-cyan)]" },
};

function Vital({ label, pct }: { label: string; pct: number }) {
  const warn = pct >= 90;
  return (
    <div className="flex items-center gap-1.5 text-2xs text-text-faint">
      <span>{label}</span>
      <span className="h-0.5 w-6.5 overflow-hidden rounded-xs bg-violet/16">
        <span
          className={`block h-full ${warn ? "bg-amber" : "bg-violet/75"}`}
          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
        />
      </span>
      <b className={`font-normal ${warn ? "text-amber" : "text-text-dim"}`}>{Math.round(pct)}%</b>
    </div>
  );
}

export function TopBar() {
  const { snapshot } = useDashboard();
  const { online } = useHermesData();
  const ws = useWorkspace();
  const { state } = useOrbState();
  const sys = snapshot?.system;
  const e = ESTADO[state] ?? ESTADO.off;

  return (
    <header className="flex h-13 shrink-0 items-center justify-between border-b border-line px-5">
      <div className="flex items-center gap-3">
        <h1 className="text-xs font-semibold tracking-hero uppercase">
          Hermes<span className="text-violet"> OS</span>
        </h1>
        <span className="flex items-center gap-1.5 text-2xs tracking-label text-text-dim uppercase">
          <span className={`h-1.5 w-1.5 rounded-full ${online ? e.dot : "bg-red"}`} />
          {online ? e.txt : "Desconectado"}
        </span>
        <div className="empty:hidden">
          <LiveMeetingChip />
        </div>
        {/* Control por gestos: cámara moviendo el cursor = SIEMPRE visible */}
        <div className="empty:hidden">
          <GestureChip />
        </div>
        {/* Manos sobre la UI: misma regla — cámara encendida, chip visible */}
        <div className="empty:hidden">
          <UiHandsChip />
        </div>
      </div>

      <div className="flex items-center gap-5">
        {sys && (
          <div className="hidden items-center gap-5 lg:flex">
            <Vital label="CPU" pct={sys.cpuPct} />
            <Vital label="RAM" pct={sys.memUsedPct} />
            <Vital label="SSD" pct={sys.diskUsedPct} />
          </div>
        )}
        <MachineSelector />
        <button
          type="button"
          onClick={() => ws.setPaletteOpen(true)}
          title="Paleta de comandos (⌘K)"
          className="hidden cursor-pointer items-center gap-1.5 rounded-sm border border-line px-2 py-1 text-2xs tracking-label text-text-faint uppercase transition-colors hover:border-line-2 hover:text-text-dim md:flex"
        >
          <span>Buscar</span>
          <span className="text-violet">⌘K</span>
        </button>
        <Clock />
      </div>
    </header>
  );
}
