"use client";

// Escena de la Oficina de agentes: crea el mundo three.js UNA vez por tema (el
// padre la re-monta con key={theme.resolved}) y pinta encima, movidas por ref
// en cada frame (sin re-render de React a 60 fps): las etiquetas de los pods,
// el nombre del dueño sobre su cabeza y el aviso "E" sobre lo que tiene al
// alcance. Todo objeto three.js nace en el MISMO efecto (StrictMode: lección
// de la Sala).

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { OFFICE_NPCS, type OfficeBoards, type OfficeLayout, type OfficeNpcRole, type OfficeSpend, type OfficeWorker, type PlanUsage, type QueueState, type UpcomingCalendar } from "@hermes/shared";
import { readOfficePalette } from "@/lib/oficina/palette";
import { OfficeWorld, type OfficeHit, type OfficeMode, type PodAnchor, type ScreenAnchor } from "@/lib/oficina/office-world";
import type { GameEvent, GameHud } from "@/lib/oficina/games";
import type * as THREE from "three";
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
  /** Tecla que muestra el aviso: "E" (teclado) o "A" (control). */
  nearKey: "E" | "A";
  inputEnabled: boolean;
  onClick: (hit: OfficeHit | null) => void;
  onNear: (hit: OfficeHit | null) => void;
  onMode: (mode: OfficeMode) => void;
  /** El piso que se ve (0 equipos · 1 café · 2 azotea). */
  onFloor?: (floor: number) => void;
  /** Nombre de la voz que presta cada personaje en la llamada del equipo. */
  voices?: ReadonlyMap<string, string>;
  /** Quién suena ahora en esa llamada (lo lee el mundo cada frame). */
  speakingProbe?: () => { id: string; level: number } | null;
  /** Interruptor "Ambiente": gente del edificio; `sessions` (vivas) decide cuánta; `seed` la coreografía. */
  ambient: { on: boolean; sessions: number; seed?: number };
  /** Datos de los tableros de pared (GET /office/boards). */
  boards: OfficeBoards | null;
  /** Apodo de cada personaje (assignNicknames). */
  nicks?: ReadonlyMap<string, string>;
  /** Dibujo de la pizarra libre (data URL PNG, o null = limpia). */
  whiteboard?: string | null;
  /** La cola real (undefined = cargando, null = sin respuesta del agente). */
  queue?: QueueState | null;
  /** Gasto de tokens (GET /office/spend; undefined = cargando, null = sin respuesta). */
  spend?: OfficeSpend | null;
  /** Uso del plan de Claude (GET /office/plan-usage). */
  plan?: PlanUsage | null;
  /** Nombre de cada proyecto (para tableros y pantallas). */
  projectName?: (slug: string) => string;
  /** Minijuego: su HUD (null = se salió) y lo que suena en él. */
  onGame?: (hud: GameHud | null) => void;
  onGameEvent?: (ev: GameEvent, at: THREE.Vector3) => void;
  /** Modo CEO (sentado en la oficina privada). */
  onCeo?: (on: boolean) => void;
  /** Agenda real para la pantalla de la oficina de CEO (snapshot.calendar). */
  calendar?: UpcomingCalendar | null;
}

const NPC_ROLES = Object.keys(OFFICE_NPCS) as OfficeNpcRole[];

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
  { layout, workers, seats, selected, podInfo, ownerName, look, feed, board, nearLabel, nearKey, inputEnabled, onClick, onNear, onMode, onFloor, voices, speakingProbe, ambient, boards, nicks, whiteboard, queue, spend, plan, projectName, onGame, onGameEvent, onCeo, calendar },
  ref,
) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<OfficeWorld | null>(null);
  const labelRefs = useRef(new Map<string, HTMLDivElement>());
  const headRef = useRef<HTMLDivElement>(null);
  const nearRef = useRef<HTMLDivElement>(null);
  const npcRefs = useRef(new Map<OfficeNpcRole, HTMLDivElement>());
  const cb = useRef({ onClick, onNear, onMode, onFloor, onGame, onGameEvent, onCeo });
  cb.current = { onClick, onNear, onMode, onFloor, onGame, onGameEvent, onCeo };
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
        onFloor: (floor) => cb.current.onFloor?.(floor),
        onGame: (hud) => cb.current.onGame?.(hud),
        onGameEvent: (ev, at) => cb.current.onGameEvent?.(ev, at),
        onCeo: (on) => cb.current.onCeo?.(on),
        onNpcs: (anchors) => {
          for (const role of NPC_ROLES) place(npcRefs.current.get(role) ?? null, anchors.find((a) => a.role === role) ?? null);
        },
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
    worldRef.current?.setWorkers(workers, seats, voices, nicks);
  }, [layout, workers, seats, voices, nicks]);

  useEffect(() => {
    if (worldRef.current) worldRef.current.speakingProbe = speakingProbe ?? null;
  }, [speakingProbe]);

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

  useEffect(() => {
    worldRef.current?.setAmbient(ambient.on, ambient.sessions, ambient.seed);
  }, [ambient.on, ambient.sessions, ambient.seed]);

  useEffect(() => {
    worldRef.current?.setBoardsData(boards);
  }, [boards]);

  useEffect(() => {
    worldRef.current?.setWhiteboard(whiteboard ?? null);
  }, [whiteboard]);

  useEffect(() => {
    worldRef.current?.setQueue(queue);
  }, [queue]);

  useEffect(() => {
    if (projectName) worldRef.current?.setProjectNamer(projectName);
  }, [projectName]);

  useEffect(() => {
    worldRef.current?.setSpend(spend);
  }, [spend]);

  useEffect(() => {
    worldRef.current?.setPlanUsage(plan);
  }, [plan]);

  useEffect(() => {
    worldRef.current?.setCalendar(calendar ?? null);
  }, [calendar]);

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

        {/* El rol de cada NPC sobre su cabeza (solo con el ambiente prendido y de cerca). */}
        {NPC_ROLES.map((role) => (
          <div
            key={role}
            ref={(el) => {
              if (el) npcRefs.current.set(role, el);
              else npcRefs.current.delete(role);
            }}
            className="absolute top-0 left-0 rounded-full border border-line bg-panel/90 px-2 py-0.5 text-xs whitespace-nowrap text-text-dim opacity-0 shadow-sm"
            style={{ willChange: "transform" }}
          >
            {OFFICE_NPCS[role].name}
          </div>
        ))}

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
          {nearKey === "A" ? (
            <span className="grid h-6 w-6 place-items-center rounded-full bg-[#5cb85c] font-mono text-xs font-bold text-white">A</span>
          ) : (
            <kbd className="grid h-6 w-6 place-items-center rounded-md border border-line-2 bg-panel-2 font-mono text-xs font-semibold text-accent">
              E
            </kbd>
          )}
          {nearLabel}
        </div>
      </div>
    </div>
  );
});
