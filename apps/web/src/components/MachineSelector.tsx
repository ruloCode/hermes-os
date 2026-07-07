"use client";

import { useEffect, useState } from "react";
import { getHermesKey, getHermesUrl, setHermesUrl } from "@/lib/hermes";

/**
 * Selector de máquina (multi-Mac vía Tailscale): permite apuntar el dashboard
 * al agente de otra Mac. Registry por env:
 *   NEXT_PUBLIC_HERMES_AGENTS="mini=http://100.x.y.z:8650|portatil=http://localhost:8650"
 * Sin esa env el componente no renderiza nada (setup local de una sola Mac).
 * Elegir máquina escribe el override en localStorage y recarga la página:
 * recablear en vivo todos los SSE/polls no vale la complejidad.
 */

interface AgentEntry {
  name: string;
  url: string;
}

function parseAgents(): AgentEntry[] {
  const raw = process.env.NEXT_PUBLIC_HERMES_AGENTS || "";
  return raw
    .split("|")
    .map((part) => {
      const eq = part.indexOf("=");
      if (eq === -1) return null;
      const name = part.slice(0, eq).trim();
      const url = part.slice(eq + 1).trim().replace(/\/$/, "");
      return name && url ? { name, url } : null;
    })
    .filter((a): a is AgentEntry => a !== null);
}

export function MachineSelector() {
  const [agents] = useState<AgentEntry[]>(parseAgents);
  // Salud por URL: undefined = probando, true/false = resultado del /health.
  const [health, setHealth] = useState<Record<string, boolean>>({});
  // URL activa: se resuelve tras montar (localStorage no existe en SSR).
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    if (!agents.length) return;
    setActive(getHermesUrl());
    let alive = true;
    const check = async () => {
      const key = getHermesKey();
      const results = await Promise.all(
        agents.map(async (a) => {
          try {
            const res = await fetch(`${a.url}/health${key ? `?key=${encodeURIComponent(key)}` : ""}`, {
              signal: AbortSignal.timeout(3000),
            });
            return [a.url, res.ok] as const;
          } catch {
            return [a.url, false] as const;
          }
        }),
      );
      if (alive) setHealth(Object.fromEntries(results));
    };
    void check();
    const interval = setInterval(check, 15_000);
    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, [agents]);

  if (!agents.length) return null;

  const select = (url: string) => {
    if (url === active) return;
    setHermesUrl(url);
    location.reload(); // el agente activo cambia para TODOS los paneles
  };

  return (
    <div
      className="flex items-center gap-3 text-[9px] tracking-[0.25em] uppercase"
      role="radiogroup"
      aria-label="Máquina activa"
    >
      {agents.map((a) => {
        const isActive = active === a.url;
        const ok = health[a.url];
        return (
          <button
            key={a.url}
            type="button"
            role="radio"
            aria-checked={isActive}
            title={`${a.url}${ok === false ? " (sin respuesta)" : ""}`}
            onClick={() => select(a.url)}
            className="flex items-center gap-1.5 transition-colors"
            style={{ color: isActive ? "var(--cyan)" : "var(--text-dim)" }}
          >
            <span
              style={{
                color: ok === false ? "var(--red)" : ok ? "var(--green)" : "var(--text-dim)",
                textShadow: ok ? "0 0 8px var(--green)" : undefined,
              }}
            >
              ●
            </span>
            {a.name}
          </button>
        );
      })}
    </div>
  );
}
