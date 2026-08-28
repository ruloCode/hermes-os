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

  return (
    <div
      className="flex items-center gap-3 text-2xs tracking-label uppercase"
      role="radiogroup"
      aria-label="Máquina activa"
    >
      {entries.map((e) => {
        const dot = e.self
          ? "text-green glow-text-green"
          : e.reachable === undefined
            ? "text-text-dim"
            : e.reachable
              ? "text-green"
              : e.online
                ? "text-amber" // late: hay heartbeat pero este browser no llega
                : "text-red";
        const title = [
          e.baseUrl ?? "sin dirección publicada",
          e.os ?? null,
          e.self ? "esta es la máquina que responde" : null,
          !e.self && e.reachable === false && e.online
            ? "late en Supabase pero no responde desde este navegador"
            : null,
          !e.self && !e.online ? "sin heartbeat (offline)" : null,
          e.currentTask,
        ]
          .filter(Boolean)
          .join(" · ");
        return (
          <button
            key={e.machine}
            type="button"
            role="radio"
            aria-checked={e.self}
            title={title}
            disabled={!e.baseUrl || e.self}
            onClick={() => select(e)}
            className={`flex items-center gap-1.5 transition-colors ${
              e.self ? "text-cyan" : "text-text-dim enabled:hover:text-text"
            }`}
          >
            <span className={dot}>●</span>
            {e.machine}
          </button>
        );
      })}

      {/* Salida de emergencia: el agente elegido no contesta y sin esto el
          override de localStorage deja el dashboard ciego para siempre. */}
      {activeDown && overrideRef.current && (
        <button
          type="button"
          onClick={() => {
            setHermesUrl(null);
            location.reload();
          }}
          className="text-amber transition-colors hover:text-text"
          title={`${getHermesUrl()} no responde — volver al agente por defecto`}
        >
          ↺ local
        </button>
      )}
    </div>
  );
}
