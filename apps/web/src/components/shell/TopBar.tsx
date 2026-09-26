"use client";

// Topbar: UNA línea, en frase normal. Wordmark · estado de la voz · chips de
// contexto (junta en vivo, gestos, manos) · vitales del sistema · máquina ·
// buscar (⌘K) · apariencia · reloj.
//
// Regla de oro: dato real o nada. Cada pieza se omite si su fuente no responde.

import { useDashboard } from "@/state/DashboardProvider";
import { useHermesData } from "@/hooks/useHermesData";
import { useWorkspace } from "@/state/WorkspaceContext";
import { Clock } from "@/components/Clock";
import { LiveMeetingChip } from "./LiveMeetingChip";
import { GestureChip } from "./GestureChip";
import { UiHandsChip } from "./UiHandsChip";
import { ThemeToggle } from "./ThemeToggle";
import { MachineSelector } from "@/components/MachineSelector";

function Vital({ label, pct }: { label: string; pct: number }) {
  const warn = pct >= 90;
  return (
    <div className="flex items-center gap-1.5 text-2xs text-text-faint" title={`${label} ${Math.round(pct)}%`}>
      <span>{label}</span>
      <span className="h-1 w-7 overflow-hidden rounded-full bg-line">
        <span
          className={`block h-full rounded-full ${warn ? "bg-amber" : "bg-text-faint"}`}
          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
        />
      </span>
      <b className={`font-medium tabular-nums ${warn ? "text-amber" : "text-text-dim"}`}>{Math.round(pct)}%</b>
    </div>
  );
}

export function TopBar() {
  const { snapshot } = useDashboard();
  const { online } = useHermesData();
  const ws = useWorkspace();
  const sys = snapshot?.system;

  return (
    <header className="flex h-13 shrink-0 items-center justify-between border-b border-line px-5">
      <div className="flex items-center gap-3">
        <h1 className="text-md font-semibold text-text">Hermes</h1>
        {/* Solo el estado del AGENTE. El de la voz lo dice la PresenceBar del
            pie: tenerlo en dos sitios obligaba a mirar cuál de los dos manda. */}
        <span className="flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-2xs text-text-dim">
          <span className={`h-1.5 w-1.5 rounded-full ${online ? "bg-green" : "bg-red"}`} />
          {online ? "Conectado" : "Desconectado"}
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

      <div className="flex items-center gap-4">
        {sys && (
          <div className="hidden items-center gap-4 lg:flex">
            <Vital label="CPU" pct={sys.cpuPct} />
            <Vital label="RAM" pct={sys.memUsedPct} />
            <Vital label="SSD" pct={sys.diskUsedPct} />
          </div>
        )}
        <MachineSelector />
        <button
          type="button"
          onClick={() => ws.setPaletteOpen(true)}
          title="Buscar y comandos (⌘K)"
          className="hidden cursor-pointer items-center gap-2 rounded-sm border border-line bg-panel px-2.5 py-1 text-xs text-text-dim transition-colors hover:border-line-2 hover:text-text md:flex"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <span>Buscar</span>
          <kbd className="rounded-xs border border-line px-1 font-sans text-2xs text-text-faint">⌘K</kbd>
        </button>
        <ThemeToggle />
        <Clock />
      </div>
    </header>
  );
}
