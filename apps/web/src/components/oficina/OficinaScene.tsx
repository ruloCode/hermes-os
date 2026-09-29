"use client";

// Escena de la Oficina de agentes: crea el mundo three.js UNA vez por tema (el
// padre la re-monta con key={theme.resolved}) y pinta encima las etiquetas
// HTML de cada pod (nombre del proyecto), movidas por ref en cada frame — sin
// re-render de React a 60 fps. Todo objeto three.js nace en el MISMO efecto:
// StrictMode re-monta el componente en dev y un efecto aparte quedaría
// apuntando a un mundo ya destruido (lección de la Sala).

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { OfficeLayout, OfficeWorker } from "@hermes/shared";
import { readOfficePalette } from "@/lib/oficina/palette";
import { OfficeWorld, type OfficeHit, type PodAnchor } from "@/lib/oficina/office-world";

export interface OficinaSceneHandle {
  world: () => OfficeWorld | null;
}

interface Props {
  layout: OfficeLayout;
  workers: OfficeWorker[];
  seats: ReadonlyMap<string, string>;
  selected: OfficeHit | null;
  /** Nombre legible y personajes por pod, para la etiqueta. */
  podInfo: Record<string, { name: string; count: number }>;
  onClick: (hit: OfficeHit | null) => void;
  onHover?: (hit: OfficeHit | null) => void;
}

export const OficinaScene = forwardRef<OficinaSceneHandle, Props>(function OficinaScene(
  { layout, workers, seats, selected, podInfo, onClick, onHover },
  ref,
) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<OfficeWorld | null>(null);
  const labelRefs = useRef(new Map<string, HTMLDivElement>());
  // Los callbacks cambian en cada render del padre: el mundo lee siempre el último.
  const clickRef = useRef(onClick);
  const hoverRef = useRef(onHover);
  clickRef.current = onClick;
  hoverRef.current = onHover;

  useImperativeHandle(ref, () => ({ world: () => worldRef.current }), []);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const onPods = (anchors: PodAnchor[]) => {
      for (const a of anchors) {
        const el = labelRefs.current.get(a.project);
        if (!el) continue;
        el.style.transform = `translate(-50%, -50%) translate(${a.x.toFixed(1)}px, ${a.y.toFixed(1)}px)`;
        el.style.opacity = a.visible ? "1" : "0";
      }
    };
    const world = new OfficeWorld(wrap, readOfficePalette(), {
      onPods,
      onClick: (hit) => clickRef.current(hit),
      onHover: (hit) => hoverRef.current?.(hit),
    });
    worldRef.current = world;
    world.start();
    return () => {
      world.dispose();
      worldRef.current = null;
    };
  }, []);

  // El orden importa: primero la planta (escritorios), luego quién se sienta.
  useEffect(() => {
    worldRef.current?.setLayout(layout);
    worldRef.current?.setWorkers(workers, seats);
  }, [layout, workers, seats]);

  useEffect(() => {
    worldRef.current?.setSelected(selected);
  }, [selected]);

  return (
    <div ref={wrapRef} className="absolute inset-0 overflow-hidden">
      <div className="pointer-events-none absolute inset-0 z-10">
        {layout.pods.map((pod) => {
          const info = podInfo[pod.project];
          return (
            <div
              key={pod.project}
              ref={(el) => {
                if (el) labelRefs.current.set(pod.project, el);
                else labelRefs.current.delete(pod.project);
              }}
              className="absolute top-0 left-0 flex items-center gap-1.5 rounded-md border border-line bg-panel/85 px-2 py-0.5 text-xs whitespace-nowrap text-text-dim opacity-0"
              style={{ willChange: "transform" }}
            >
              <span className="font-medium text-text">{info?.name ?? pod.project}</span>
              {info?.count ? <span className="text-text-faint">· {info.count}</span> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
});
