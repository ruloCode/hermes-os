"use client";

// Escena de la Sala de Agentes: crea el mundo three.js UNA vez por tema y
// pinta encima las tarjetas HTML de cada agente (nombre · proyecto · estado
// real · retrato si existe) siguiendo su figura frame a frame — por REF, sin
// re-render de React a 60 fps. Las fases siguientes (marioneta, señalar, voz)
// hablan con el mundo a través del ref `worldRef` que expone este componente.

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { SalaAgentPublic } from "@hermes/shared";
import { readToken } from "@/components/ui/tones";
import { getHermesKey, getHermesUrl } from "@/lib/hermes";
import { SalaWorld, type LabelAnchor } from "@/lib/sala/world";
import { PuppetMesh } from "@/lib/sala/puppet-mesh";

export interface SalaSceneHandle {
  world: () => SalaWorld | null;
  /** La marioneta del humano: vive y muere con el mundo (misma vida que el canvas). */
  puppet: () => PuppetMesh | null;
}

interface Props {
  agents: SalaAgentPublic[];
  /** Agente seleccionado (tarjeta encendida). */
  selectedKey?: string | null;
  /** Agente que está cargando el dwell (tarjeta subrayada). */
  aimingKey?: string | null;
}

/** URL del retrato: un <img> no manda el Bearer, así que va con ?key= (como los SSE). */
function portraitUrl(key: string): string {
  const k = getHermesKey();
  return `${getHermesUrl()}/sala/portrait/${encodeURIComponent(key)}${k ? `?key=${encodeURIComponent(k)}` : ""}`;
}

export const SalaScene = forwardRef<SalaSceneHandle, Props>(function SalaScene(
  { agents, selectedKey = null, aimingKey = null },
  ref,
) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<SalaWorld | null>(null);
  const puppetRef = useRef<PuppetMesh | null>(null);
  const labelRefs = useRef(new Map<string, HTMLDivElement>());

  useImperativeHandle(
    ref,
    () => ({ world: () => worldRef.current, puppet: () => puppetRef.current }),
    [],
  );

  // Mundo + marioneta: viven mientras el componente viva (el padre lo re-monta
  // con key=tema). TODO objeto three.js se crea AQUÍ, en el mismo efecto: un
  // efecto del padre que metiera cosas al mundo se quedaría apuntando a un
  // mundo viejo cuando este se re-crea solo (StrictMode en dev lo hace).
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const onLabels = (anchors: LabelAnchor[]) => {
      for (const a of anchors) {
        const el = labelRefs.current.get(a.key);
        if (!el) continue;
        el.style.transform = `translate(-50%, -100%) translate(${a.x.toFixed(1)}px, ${a.y.toFixed(1)}px)`;
        el.style.opacity = a.visible ? "1" : "0";
      }
    };
    const world = new SalaWorld(
      wrap,
      {
        bg: readToken("--color-bg", "#121110"),
        floor: readToken("--color-panel", "#1a1917"),
        grid: readToken("--color-text-faint", "#8f8a80"),
        accent: readToken("--color-accent", "#d97757"),
        text: readToken("--color-text", "#f0ede6"),
      },
      { onLabels },
    );
    const puppet = new PuppetMesh(readToken("--color-text", "#f0ede6"));
    world.stage.add(puppet.group);
    worldRef.current = world;
    puppetRef.current = puppet;
    world.start();
    return () => {
      world.stage.remove(puppet.group);
      puppet.dispose();
      puppetRef.current = null;
      world.dispose();
      worldRef.current = null;
    };
  }, []);

  useEffect(() => {
    worldRef.current?.setAgents(agents);
  }, [agents]);

  useEffect(() => {
    const world = worldRef.current;
    if (!world) return;
    for (const f of world.figures) f.setSelected(f.key === selectedKey);
  }, [selectedKey, agents]);

  return (
    <div ref={wrapRef} className="absolute inset-0 overflow-hidden">
      {/* Tarjetas de nombre: posicionadas por el loop del mundo (transform). */}
      <div className="pointer-events-none absolute inset-0 z-10">
        {agents.map((a) => {
          const selected = a.key === selectedKey;
          const aiming = a.key === aimingKey;
          return (
            <div
              key={a.key}
              ref={(el) => {
                if (el) labelRefs.current.set(a.key, el);
                else labelRefs.current.delete(a.key);
              }}
              className={`absolute top-0 left-0 flex items-center gap-2 rounded-md border px-2.5 py-1.5 opacity-0 transition-[border-color,background-color] duration-200 ${
                selected
                  ? "border-accent bg-panel"
                  : aiming
                    ? "border-line-2 bg-panel/90"
                    : "border-line bg-panel/80"
              }`}
              style={{ willChange: "transform" }}
            >
              {a.portrait ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={portraitUrl(a.key)}
                  alt=""
                  className="h-9 w-9 shrink-0 rounded-full object-cover"
                  style={{ boxShadow: `0 0 0 2px ${a.color}` }}
                />
              ) : (
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: a.color }}
                />
              )}
              <div className="leading-tight">
                <div className="text-sm font-medium text-text">{a.name}</div>
                <div className="text-xs text-text-dim">
                  {a.project_name ?? a.project}
                  {a.project_estado ? <span className="text-text-faint"> · {a.project_estado}</span> : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});
