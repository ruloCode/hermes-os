"use client";

// Escena de la Oficina de agentes: crea el mundo three.js UNA vez por tema (el
// padre la re-monta con key={theme.resolved}) y pinta encima, movidas por ref
// en cada frame (sin re-render de React a 60 fps): las etiquetas de los pods,
// el nombre del dueño sobre su cabeza y el aviso "E" sobre lo que tiene al
// alcance. Todo objeto three.js nace en el MISMO efecto (StrictMode: lección
// de la Sala).

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { OfficeLayout, OfficeWorker } from "@hermes/shared";
import { readOfficePalette } from "@/lib/oficina/palette";
import { OfficeWorld, type OfficeHit, type OfficeMode, type PodAnchor, type ScreenAnchor } from "@/lib/oficina/office-world";
import type { BoardStat, FeedLine } from "@/lib/oficina/room";
import type { OwnerLook } from "@/lib/oficina/look";

export interface OficinaSceneHandle {
  world: () => OfficeWorld | null;
}

interface Props {
  layout: OfficeLayout;
  workers: OfficeWorker[];
  seats: ReadonlyMap<string, string>;
  selected: OfficeHit | null;
  podInfo: Record<string, { name: string; count: number }>;
  ownerName: string;
  look: OwnerLook;
  feed: FeedLine[];
  board: BoardStat[];
  /** Texto del aviso sobre lo que el dueño tiene al alcance ("Contratar aquí", "Ver a X"). */
  nearLabel: string | null;
  inputEnabled: boolean;
  onClick: (hit: OfficeHit | null) => void;
  onNear: (hit: OfficeHit | null) => void;
  onMode: (mode: OfficeMode) => void;
}

function place(el: HTMLElement | null, a: ScreenAnchor | null, anchor = "translate(-50%, -100%)") {
  if (!el) return;
  if (!a || !a.visible) {
    el.style.opacity = "0";
    return;
  }
  el.style.transform = `${anchor} translate(${a.x.toFixed(1)}px, ${a.y.toFixed(1)}px)`;
  el.style.opacity = "1";
}

export const OficinaScene = forwardRef<OficinaSceneHandle, Props>(function OficinaScene(
  { layout, workers, seats, selected, podInfo, ownerName, look, feed, board, nearLabel, inputEnabled, onClick, onNear, onMode },
  ref,
) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<OfficeWorld | null>(null);
  const labelRefs = useRef(new Map<string, HTMLDivElement>());
  const headRef = useRef<HTMLDivElement>(null);
  const nearRef = useRef<HTMLDivElement>(null);
  const cb = useRef({ onClick, onNear, onMode });
  cb.current = { onClick, onNear, onMode };
  const initial = useRef({ ownerName, look });

  useImperativeHandle(ref, () => ({ world: () => worldRef.current }), []);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const onPods = (anchors: PodAnchor[]) => {
      for (const a of anchors) place(labelRefs.current.get(a.project) ?? null, a, "translate(-50%, -50%)");
    };
    const world = new OfficeWorld(
      wrap,
      readOfficePalette(),
      {
        onPods,
        onPlayer: (head, near) => {
          place(headRef.current, head);
          place(nearRef.current, near);
        },
        onNear: (hit) => cb.current.onNear(hit),
        onClick: (hit) => cb.current.onClick(hit),
        onMode: (mode) => cb.current.onMode(mode),
      },
      initial.current,
    );
    worldRef.current = world;
    world.start();
    return () => {
      world.dispose();
      worldRef.current = null;
    };
  }, []);

  useEffect(() => {
    worldRef.current?.setLayout(layout);
    worldRef.current?.setWorkers(workers, seats);
  }, [layout, workers, seats]);

  useEffect(() => {
    worldRef.current?.setSelected(selected);
  }, [selected]);

  useEffect(() => {
    worldRef.current?.setLook(look);
  }, [look]);

  useEffect(() => {
    worldRef.current?.setFeed(feed);
  }, [feed]);

  useEffect(() => {
    worldRef.current?.setBoard(board);
  }, [board]);

  useEffect(() => {
    worldRef.current?.setInputEnabled(inputEnabled);
  }, [inputEnabled]);

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
              className="absolute top-0 left-0 flex items-center gap-1.5 rounded-full border border-line bg-panel/90 px-2.5 py-0.5 text-xs whitespace-nowrap text-text-dim opacity-0 shadow-sm"
              style={{ willChange: "transform" }}
            >
              <span className="font-medium text-text">{info?.name ?? pod.project}</span>
              {info?.count ? <span className="tabular-nums text-text-faint">· {info.count}</span> : null}
            </div>
          );
        })}

        {/* Nombre del dueño sobre su cabeza. */}
        <div
          ref={headRef}
          className="absolute top-0 left-0 rounded-full bg-accent px-2.5 py-0.5 text-xs font-medium whitespace-nowrap text-white opacity-0 shadow-md"
          style={{ willChange: "transform" }}
        >
          {ownerName || "Tú"}
        </div>

        {/* Lo que tiene al alcance: "E · Contratar aquí". */}
        <div
          ref={nearRef}
          className="absolute top-0 left-0 flex items-center gap-2 rounded-lg border border-line bg-panel/95 py-1 pr-3 pl-1 text-sm whitespace-nowrap text-text opacity-0 shadow-lg"
          style={{ willChange: "transform", display: nearLabel ? "flex" : "none" }}
        >
          <kbd className="grid h-6 w-6 place-items-center rounded-md border border-line-2 bg-panel-2 font-mono text-xs font-semibold text-accent">
            E
          </kbd>
          {nearLabel}
        </div>
      </div>
    </div>
  );
});
