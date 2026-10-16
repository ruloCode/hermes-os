"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MachinePresence } from "@hermes/shared";
import { getHermesUrl, listMachines, probeMachine, setHermesUrl } from "@/lib/hermes";

/**
 * Selector de máquina (multi-PC en la red interna).
 *
 * El dashboard lo sirve UNA máquina y lo abren varias; lo que cambia por
 * browser es a QUÉ agente le habla (override en localStorage, que ya es
 * por-máquina). Cada PC ejecuta en su propio disco: la Mac queda en su agente,
 * el otro PC en el suyo, y cruzar es un clic.
 *
 * La lista NO se hornea en una env: cada agente publica su URL LAN en el
 * heartbeat (agent_presence) y aquí se pide con GET /machines. La máquina que
 * viene con `self: true` es la que está respondiendo — por eso se marca por
 * NOMBRE y no comparando URLs (localhost y la IP LAN son el mismo agente).
 *
 * NEXT_PUBLIC_HERMES_AGENTS sigue soportada como registry manual para una
 * máquina que no esté en Supabase (o cuando el agente activo no responde).
 */

interface Entry {
  machine: string;
  baseUrl: string | null;
  os: string | null;
  status: MachinePresence["status"];
  online: boolean;
  self: boolean;
  currentTask: string | null;
  /** Contestó /health desde ESTE browser: undefined = probando. */
  reachable?: boolean;
}

const CACHE_KEY = "hermes_machines_cache";

/** Registry manual (fallback): "mini=http://…|portatil=http://…". */
function envEntries(): Entry[] {
  return (process.env.NEXT_PUBLIC_HERMES_AGENTS || "")
    .split("|")
    .map((part): Entry | null => {
      const eq = part.indexOf("=");
      if (eq === -1) return null;
      const machine = part.slice(0, eq).trim();
      const baseUrl = part.slice(eq + 1).trim().replace(/\/$/, "");
      if (!machine || !baseUrl) return null;
      return {
        machine,
        baseUrl,
        os: null,
        status: "idle",
        online: true,
        self: false,
        currentTask: null,
      };
    })
    .filter((e): e is Entry => e !== null);
}

function readCache(): Entry[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as Entry[]) : [];
  } catch {
    return [];
  }
}

function fromPresence(m: MachinePresence): Entry {
  return {
    machine: m.machine,
    baseUrl: m.baseUrl,
    os: m.os,
    status: m.status,
    online: m.online,
    self: m.self,
    currentTask: m.currentTask,
  };
}

/** Une descubrimiento + registry manual sin duplicar (manda lo descubierto). */
function merge(discovered: Entry[], extra: Entry[]): Entry[] {
  const out = [...discovered];
  for (const e of extra) {
    if (!out.some((d) => d.machine.toLowerCase() === e.machine.toLowerCase())) out.push(e);
  }
  return out;
}

export function MachineSelector() {
  const [entries, setEntries] = useState<Entry[]>([]);
  // ¿El agente activo contestó? Si no, el dashboard está ciego y hay que
  // ofrecer la salida (volver al agente por defecto).
  const [activeDown, setActiveDown] = useState(false);
  const overrideRef = useRef(false);

  const refresh = useCallback(async () => {
    const machines = await listMachines();
    const discovered = machines.map(fromPresence);
    setActiveDown(discovered.length === 0);
    // Sin respuesta del agente activo: lo último que se supo (más el registry
    // manual) para no quedarse sin forma de cambiar de máquina.
    const base = discovered.length ? discovered : readCache();
    const list = merge(base, envEntries());
    if (discovered.length) {
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(discovered));
      } catch {
        /* cuota / modo privado: el cache es un lujo, no un requisito */
      }
    }
    setEntries(list);

    // Alcanzabilidad real desde este browser: un heartbeat fresco en Supabase
    // no prueba que haya ruta (otra subred, firewall, PC dormido).
    const probes = await Promise.all(
      list.map(async (e) => {
        if (!e.baseUrl) return [e.machine, false] as const;
        const r = await probeMachine(e.baseUrl);
        return [e.machine, r.ok] as const;
      }),
    );
    const byMachine = Object.fromEntries(probes);
    setEntries((prev) => prev.map((e) => ({ ...e, reachable: byMachine[e.machine] })));
  }, []);

  useEffect(() => {
    try {
      overrideRef.current = Boolean(localStorage.getItem("hermes_agent_url"));
    } catch {
      overrideRef.current = false;
    }
    void refresh();
    const id = setInterval(() => void refresh(), 15_000);
    return () => clearInterval(id);
  }, [refresh]);

  const select = (e: Entry) => {
    if (e.self || !e.baseUrl) return;
    setHermesUrl(e.baseUrl);
    location.reload(); // el agente activo cambia para TODOS los paneles
  };

  // Una sola máquina y todo en orden: no hay nada que elegir.
  if (entries.length < 2 && !activeDown) return null;

  const current = entries.find((e) => e.self);
  const dotCls = (e: Entry) =>
    e.self
      ? "bg-green"
      : e.reachable === undefined
        ? "bg-text-faint"
        : e.reachable
          ? "bg-green"
          : e.online
            ? "bg-amber" // late: hay heartbeat pero este browser no llega
            : "bg-red";
  const titleOf = (e: Entry) =>
    [
      e.baseUrl ?? "sin dirección publicada",
      e.os ?? null,
      e.self ? "esta es la máquina que responde" : null,
      !e.self && e.reachable === false && e.online
        ? "hay heartbeat pero este navegador no llega"
        : null,
      !e.self && !e.online ? "sin heartbeat (offline)" : null,
      e.currentTask,
    ]
      .filter(Boolean)
      .join(" · ");

  return (
    <MachineMenu
      label={current?.machine ?? (activeDown ? "Agente sin respuesta" : "Elegir máquina")}
      warn={activeDown}
    >
      {(close) => (
        <>
          <div className="px-2 pt-1 pb-1.5 text-2xs text-text-faint">Máquina activa</div>
          {entries.map((e) => (
            <button
              key={e.machine}
              type="button"
              role="menuitemradio"
              aria-checked={e.self}
              title={titleOf(e)}
              disabled={!e.baseUrl || e.self}
              onClick={() => {
                close();
                select(e);
              }}
              className="flex w-full items-center gap-2 rounded-xs px-2 py-1.5 text-left text-sm text-text transition-colors enabled:cursor-pointer enabled:hover:bg-hover disabled:cursor-default"
            >
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotCls(e)}`} />
              <span className="min-w-0 flex-1 truncate">{e.machine}</span>
              <span className="shrink-0 text-2xs text-text-faint">
                {e.self ? "✓ aquí" : !e.online ? "offline" : (e.os ?? "")}
              </span>
            </button>
          ))}
          {/* Salida de emergencia: el agente elegido no contesta y sin esto el
              override de localStorage deja el dashboard ciego para siempre. */}
          {activeDown && overrideRef.current && (
            <button
              type="button"
              onClick={() => {
                setHermesUrl(null);
                location.reload();
              }}
              className="mt-1 flex w-full cursor-pointer items-center gap-2 rounded-xs border-t border-line px-2 pt-2 pb-1.5 text-left text-sm text-amber transition-colors hover:bg-hover"
              title={`${getHermesUrl()} no responde — volver al agente por defecto`}
            >
              ↺ Volver al agente local
            </button>
          )}
        </>
      )}
    </MachineMenu>
  );
}

/** Botón + menú desplegable (cierra con clic fuera o Esc). */
function MachineMenu({
  label,
  warn,
  children,
}: {
  label: string;
  warn: boolean;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex h-7 w-full cursor-pointer items-center gap-2 rounded-xs pr-1.5 pl-2 text-xs transition-colors hover:bg-hover ${
          warn ? "text-amber" : "text-text-dim hover:text-text"
        }`}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0 text-text-faint">
          <rect x="3" y="4" width="18" height="12" rx="2" />
          <path d="M8 20h8M12 16v4" />
        </svg>
        <span className="min-w-0 flex-1 truncate text-left">{label}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0 text-text-faint">
          <path d="m7 10 5 5 5-5" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute top-full right-0 left-0 z-40 mt-1 rounded-sm border border-line bg-panel p-1 shadow-[var(--shadow-pop)]"
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
