"use client";

// SALA DE AGENTES 3D — página suelta a pantalla completa (fuera del shell,
// hermana de /dev/terminator): cinco agentes de pie, cada uno dueño de un
// proyecto REAL del vault, con su color, su nombre y su estado. Los
// personajes salen de ~/.hermes-os/sala.json vía GET /sala/agents; nada aquí
// está escrito a mano. Plan y decisiones: docs/sala-de-agentes-3d.md.

import { useEffect, useRef, useState } from "react";
import type { SalaAgentPublic } from "@hermes/shared";
import { hermesGet } from "@/lib/hermes";
import { useTheme } from "@/state/ThemeProvider";
import { SalaScene, type SalaSceneHandle } from "@/components/sala/SalaScene";

type Load =
  | { kind: "loading" }
  | { kind: "offline"; error: string }
  | { kind: "invalid"; error: string; path: string }
  | { kind: "empty"; path: string }
  | { kind: "ready"; agents: SalaAgentPublic[] };

export default function SalaPage() {
  const theme = useTheme();
  const sceneRef = useRef<SalaSceneHandle>(null);
  const [load, setLoad] = useState<Load>({ kind: "loading" });

  useEffect(() => {
    let alive = true;
    hermesGet<{ agents?: SalaAgentPublic[]; path: string; error?: string }>("/sala/agents")
      .then((r) => {
        if (!alive) return;
        if (r.error) setLoad({ kind: "invalid", error: r.error, path: r.path });
        else if (!r.agents?.length) setLoad({ kind: "empty", path: r.path });
        else setLoad({ kind: "ready", agents: r.agents });
      })
      .catch((err: unknown) => {
        if (alive) setLoad({ kind: "offline", error: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      alive = false;
    };
  }, []);

  const agents = load.kind === "ready" ? load.agents : [];
  const ready = agents.filter((a) => a.ready).length;

  return (
    <main className="fixed inset-0 overflow-hidden bg-bg text-text">
      {load.kind === "ready" && (
        // key=tema: el mundo lee los tokens al montar (bg, piso, grilla).
        <SalaScene key={theme.resolved} ref={sceneRef} agents={agents} />
      )}

      {/* HUD: contexto arriba a la izquierda, sin tarjeta (lo que se lee va sin marco). */}
      <header className="pointer-events-none absolute top-5 left-6 z-20">
        <h1 className="text-lg font-medium">Sala de agentes</h1>
        <p className="mt-0.5 text-sm text-text-dim">
          {load.kind === "ready"
            ? `${agents.length} agentes · ${ready} con voz`
            : load.kind === "loading"
              ? "Cargando…"
              : "Sin agentes"}
        </p>
      </header>

      {load.kind !== "ready" && load.kind !== "loading" && (
        <section className="absolute inset-0 z-20 grid place-items-center px-6">
          <div className="max-w-[520px] text-center">
            <p className="text-base font-medium">
              {load.kind === "offline"
                ? "El agente no responde"
                : load.kind === "invalid"
                  ? "sala.json no pasa la validación"
                  : "La sala está vacía"}
            </p>
            <p className="mt-2 text-sm text-text-dim">
              {load.kind === "offline"
                ? load.error
                : load.kind === "invalid"
                  ? load.error
                  : `Crea ${load.path} con tus agentes (plantilla en docs/sala.example.json) y recarga.`}
            </p>
          </div>
        </section>
      )}
    </main>
  );
}
