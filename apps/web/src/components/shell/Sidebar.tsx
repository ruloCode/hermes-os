"use client";

// BARRA LATERAL v5: la navegación se lee, no se adivina.
//
// Reemplaza a dos piezas de v4 que repartían el cromo en dos ejes:
//  - SideRail: 15 iconos sin texto en 60px. Dos eran el mismo calendario
//    (Reuniones y Agenda) y saber a dónde ibas exigía pasar el mouse.
//  - TopBar: wordmark + estado + CPU/RAM/SSD + tres máquinas en fila + buscar +
//    tema + reloj de dos líneas. Una franja de 52px sobre CADA vista que no
//    decía en qué vista estabas.
//
// Ahora todo el cromo vive en UNA columna (patrón Linear/Vercel): marca y
// máquina arriba, buscar, los destinos en cuatro grupos con nombre, y al pie la
// voz + el estado. El contenido queda en un lienzo enmarcado a la derecha, y
// cada vista abre con su propio título (ViewHeader).
//
// Colapsable con ⌘B (o el botón de la cabecera) a 56px de iconos con tooltip;
// bajo 1100px de ancho se colapsa sola. La barra NO pinta fondo: el cromo es el
// fondo de la ventana. Eso no es estético — el orbe de voz es un canvas DETRÁS
// de la app (z-1) y su ancla vive al pie de esta barra; un fondo opaco aquí lo
// taparía (ver VoiceDock).

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useWorkspace } from "@/state/WorkspaceContext";
import { useDashboard } from "@/state/DashboardProvider";
import { useHermesData } from "@/hooks/useHermesData";
import { NAV_GROUPS, DESTS, HOTKEY_DESTS, destKey, type Dest } from "./destinations";
import { MachineSelector } from "@/components/MachineSelector";
import { LiveMeetingChip } from "./LiveMeetingChip";
import { GestureChip } from "./GestureChip";
import { UiHandsChip } from "./UiHandsChip";
import { ThemeToggle } from "./ThemeToggle";
import { VoiceDock } from "./VoiceDock";
import { HermesMark } from "./HermesMark";

export const SIDEBAR_W = 236;
export const SIDEBAR_W_COLLAPSED = 56;

/** Ancho real de la ventana bajo el cual la barra se colapsa sola. */
const AUTO_COLLAPSE_PX = 1100;

function useNarrow() {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${AUTO_COLLAPSE_PX - 1}px)`);
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return narrow;
}

export function useSidebarCollapsed() {
  const ws = useWorkspace();
  const narrow = useNarrow();
  return !ws.sidebarOpen || narrow;
}

function Vital({ label, pct }: { label: string; pct: number }) {
  const warn = pct >= 90;
  return (
    <span title={`${label} ${Math.round(pct)}%`} className={warn ? "text-amber" : ""}>
      {label} <b className="font-medium tabular-nums">{Math.round(pct)}%</b>
    </span>
  );
}

export function Sidebar({
  anchorRef,
}: {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const pathname = usePathname();
  const ws = useWorkspace();
  const { online } = useHermesData();
  const { snapshot } = useDashboard();
  const collapsed = useSidebarCollapsed();
  const sys = snapshot?.system;
  const inHome = pathname === "/";

  const isActive = (d: Dest) =>
    d.kind === "route"
      ? // "/" además exige que el centro esté en la consola: si estás en un tab
        // del workspace, el encendido es de ESE tab, no de Inicio.
        pathname === d.href && (d.href !== "/" || ws.tab === "consola")
      : inHome && ws.tab === d.tab;

  const item = (d: Dest) => {
    const active = isActive(d);
    const idx = DESTS.indexOf(d);
    const hotkey = idx > -1 && idx < HOTKEY_DESTS ? `⌘${idx + 1}` : null;
    const cls = `group relative flex h-8 w-full cursor-pointer items-center rounded-sm text-sm transition-colors ${
      collapsed ? "justify-center" : "gap-2.5 px-2.5"
    } ${
      active
        ? "bg-selected font-medium text-text"
        : "text-text-dim hover:bg-hover hover:text-text"
    }`;
    const inner = (
      <>
        <span className={`shrink-0 ${active ? "text-text" : "text-text-faint group-hover:text-text-dim"}`}>
          {d.icon}
        </span>
        {!collapsed && <span className="min-w-0 flex-1 truncate text-left">{d.label}</span>}
        {!collapsed && hotkey && (
          <kbd className="font-sans text-2xs text-text-faint opacity-0 transition-opacity group-hover:opacity-100">
            {hotkey}
          </kbd>
        )}
        {collapsed && (
          <span className="pointer-events-none absolute left-full z-40 ml-2 flex -translate-x-1 items-center gap-2 rounded-sm border border-line bg-panel px-2 py-1 text-xs whitespace-nowrap text-text opacity-0 shadow-[var(--shadow-pop)] transition group-hover:translate-x-0 group-hover:opacity-100">
            {d.label}
            {hotkey && <kbd className="font-sans text-2xs text-text-faint">{hotkey}</kbd>}
          </span>
        )}
      </>
    );
    return d.kind === "route" ? (
      <Link
        key={destKey(d)}
        href={d.href}
        // Link ya navega; aquí solo se devuelve el centro a Inicio (showPanel
        // empujaría la ruta una segunda vez).
        onClick={() => d.href === "/" && ws.setTab("consola")}
        className={cls}
        aria-current={active ? "page" : undefined}
        aria-label={collapsed ? d.label : undefined}
      >
        {inner}
      </Link>
    ) : (
      <button
        key={destKey(d)}
        type="button"
        onClick={() => ws.showPanel(d.tab)}
        className={cls}
        aria-current={active ? "page" : undefined}
        aria-label={collapsed ? d.label : undefined}
      >
        {inner}
      </button>
    );
  };

  return (
    <nav
      aria-label="Navegación"
      style={{ width: collapsed ? SIDEBAR_W_COLLAPSED : SIDEBAR_W }}
      className="flex h-full shrink-0 flex-col transition-[width] duration-200 ease-out"
    >
      {/* ── Marca + máquina ─────────────────────────────────────── */}
      <div className={`flex shrink-0 flex-col gap-1 pt-3 ${collapsed ? "items-center px-2" : "px-3"}`}>
        <div className={`flex h-9 items-center ${collapsed ? "justify-center" : "gap-2.5 pl-1"}`}>
          <button
            type="button"
            onClick={collapsed ? ws.toggleSidebar : undefined}
            title={collapsed ? "Expandir barra (⌘B)" : undefined}
            className={`shrink-0 rounded-sm ${collapsed ? "cursor-pointer" : "cursor-default"}`}
            tabIndex={collapsed ? 0 : -1}
          >
            <HermesMark />
          </button>
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1 truncate text-md font-semibold text-text">Hermes</span>
              <ThemeToggle />
              <button
                type="button"
                onClick={ws.toggleSidebar}
                title="Colapsar barra (⌘B)"
                aria-label="Colapsar barra lateral"
                className="grid h-7 w-7 shrink-0 cursor-pointer place-items-center rounded-xs text-text-faint transition-colors hover:bg-hover hover:text-text"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
                  <path d="M9.5 4.5v15" />
                </svg>
              </button>
            </>
          )}
        </div>
        {!collapsed && <MachineSelector />}
      </div>

      {/* ── Buscar (⌘K) ─────────────────────────────────────────── */}
      <div className={`shrink-0 pt-2 pb-1 ${collapsed ? "px-2" : "px-3"}`}>
        <button
          type="button"
          onClick={() => ws.setPaletteOpen(true)}
          title="Buscar y comandos (⌘K)"
          aria-label="Buscar y comandos"
          className={`flex h-8 w-full cursor-pointer items-center rounded-sm border border-line bg-panel text-sm text-text-faint shadow-[var(--shadow-card)] transition-colors hover:border-line-2 hover:text-text-dim ${
            collapsed ? "justify-center" : "gap-2 px-2.5"
          }`}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          {!collapsed && (
            <>
              <span className="flex-1 text-left">Buscar o pedir…</span>
              <kbd className="rounded-xs border border-line px-1 font-sans text-2xs text-text-faint">⌘K</kbd>
            </>
          )}
        </button>
      </div>

      {/* ── En curso: cámara, junta, manos. Siempre visibles. ───── */}
      {!collapsed && (
        <div className="flex shrink-0 flex-col gap-1 px-3 pt-1 empty:hidden [&>div:empty]:hidden">
          <div>
            <LiveMeetingChip />
          </div>
          <div>
            <GestureChip />
          </div>
          <div>
            <UiHandsChip />
          </div>
        </div>
      )}

      {/* ── Destinos ────────────────────────────────────────────── */}
      <div className={`min-h-0 flex-1 overflow-y-auto pt-3 pb-3 hud-scroll-hide ${collapsed ? "px-2" : "px-3"}`}>
        {NAV_GROUPS.map((g, i) => (
          <div key={g.label} className={i ? (collapsed ? "mt-2 border-t border-line pt-2" : "mt-5") : ""}>
            {!collapsed && (
              <div className="mb-1 px-2.5 text-2xs font-medium text-text-faint">{g.label}</div>
            )}
            <div className="flex flex-col gap-px">{g.items.map(item)}</div>
          </div>
        ))}
      </div>

      {/* ── Pie: voz + estado ───────────────────────────────────── */}
      <div className={`shrink-0 border-t border-line pt-2 pb-3 ${collapsed ? "px-2" : "px-3"}`}>
        <VoiceDock anchorRef={anchorRef} collapsed={collapsed} sidebarWidth={collapsed ? SIDEBAR_W_COLLAPSED : SIDEBAR_W} />
        <div className={`mt-1.5 flex items-center ${collapsed ? "flex-col gap-1" : "gap-1 pl-1.5"}`}>
          <span
            title={online ? "Agente conectado" : "Agente desconectado"}
            className={`flex min-w-0 flex-1 items-center gap-2 text-2xs text-text-faint ${collapsed ? "justify-center" : ""}`}
          >
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${online ? "bg-green" : "bg-red"}`} />
            {!collapsed &&
              (sys ? (
                <span className="flex min-w-0 gap-2.5 truncate">
                  <Vital label="CPU" pct={sys.cpuPct} />
                  <Vital label="RAM" pct={sys.memUsedPct} />
                  <Vital label="SSD" pct={sys.diskUsedPct} />
                </span>
              ) : (
                <span>{online ? "Conectado" : "Desconectado"}</span>
              ))}
          </span>
          {collapsed && <ThemeToggle />}
        </div>
      </div>

      {/* Colapsada: los chips de "en curso" flotan junto a la barra — una
          cámara moviendo tu cursor jamás puede quedar invisible. */}
      {collapsed && (
        <div
          className="fixed bottom-3 z-30 flex flex-col gap-1 [&>div:empty]:hidden"
          style={{ left: SIDEBAR_W_COLLAPSED + 12 }}
        >
          <div>
            <LiveMeetingChip />
          </div>
          <div>
            <GestureChip />
          </div>
          <div>
            <UiHandsChip />
          </div>
        </div>
      )}
    </nav>
  );
}
