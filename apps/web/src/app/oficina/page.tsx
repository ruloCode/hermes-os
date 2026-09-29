"use client";

// OFICINA DE AGENTES — página suelta a pantalla completa (fuera del shell,
// hermana de /sala): una oficina 3D donde cada sesión VIVA del Agent SDK o run
// de claude -p es un personaje en su escritorio, agrupado por proyecto, y el
// dueño camina entre ellos en tercera persona (WASD, Shift, Espacio, E, V).
//
// La verdad vive en el agente (apps/agent/src/office/state.ts): esta página
// escucha GET /office/events (snapshot al conectar + un mensaje por cambio) y
// dibuja. La TV de la sala muestra el feed real de /events. Inspirada en
// agent-office (AgentSystemLabs, MIT). Guía: docs/oficina-de-agentes.md.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  GENERAL_PROJECT,
  assignSeats,
  buildOfficeLayout,
  officeCounts,
  type AgentActivityEvent,
  type OfficeProject,
  type OfficeState,
  type OfficeUpdate,
  type OfficeWorker,
} from "@hermes/shared";
import { sseUrl } from "@/lib/hermes";
import { OWNER } from "@/lib/owner";
import { useTheme } from "@/state/ThemeProvider";
import { useAgentEvents } from "@/hooks/useAgentEvents";
import { OficinaScene, type OficinaSceneHandle } from "@/components/oficina/OficinaScene";
import { WorkerDrawer } from "@/components/oficina/WorkerDrawer";
import { HireDialog } from "@/components/oficina/HireDialog";
import { ControlsHint, LookPicker, StatusCard, TeamRoster, Toasts, Toolbar, type Feed, type Toast } from "@/components/oficina/OficinaHud";
import { demoOfficeState } from "@/lib/oficina/sim";
import { DEFAULT_LOOK, loadLook, saveLook, type OwnerLook } from "@/lib/oficina/look";
import { daylightAt, type FeedLine } from "@/lib/oficina/room";
import type { OfficeHit, OfficeMode } from "@/lib/oficina/office-world";

interface Live {
  workers: Map<string, OfficeWorker>;
  projects: OfficeProject[];
  machine: string;
}

declare global {
  interface Window {
    __hermesOficinaSim?: (state: OfficeState | "demo" | null) => void;
    __hermesOficinaDebug?: () => unknown;
    __hermesOficinaScreenOf?: (hit: OfficeHit) => { x: number; y: number } | null;
    __hermesOficinaFocus?: (hit: OfficeHit) => void;
    __hermesOficinaMode?: (mode: OfficeMode) => void;
    __hermesOficinaWalkTo?: (hit: OfficeHit) => void;
  }
}

/** Canal vivo de la oficina. EventSource reconecta solo y cada conexión trae su snapshot. */
function useOfficeFeed(): { live: Live; feed: Feed; snapshots: number } {
  const [live, setLive] = useState<Live>({ workers: new Map(), projects: [], machine: "" });
  const [feed, setFeed] = useState<Feed>("connecting");
  const [snapshots, setSnapshots] = useState(0);
  useEffect(() => {
    const es = new EventSource(sseUrl("/office/events"));
    es.onopen = () => setFeed("live");
    es.onerror = () => setFeed("offline");
    es.onmessage = (e) => {
      let u: OfficeUpdate;
      try {
        u = JSON.parse(e.data) as OfficeUpdate;
      } catch {
        return;
      }
      setFeed("live");
      if (u.type === "snapshot") setSnapshots((n) => n + 1);
      setLive((prev) => {
        if (u.type === "snapshot") {
          return { workers: new Map(u.state.workers.map((w) => [w.id, w])), projects: u.state.projects, machine: u.state.machine };
        }
        const workers = new Map(prev.workers);
        if (u.type === "worker") workers.set(u.worker.id, u.worker);
        else workers.delete(u.id);
        return { ...prev, workers };
      });
    };
    return () => es.close();
  }, []);
  return { live, feed, snapshots };
}

const KIND_LABEL: Partial<Record<AgentActivityEvent["kind"], string>> = {
  task_start: "inicio",
  session_start: "sesión",
  tool_call: "tool",
  text: "texto",
  task_done: "listo",
  error: "error",
  scheduled: "programada",
  meeting_live: "junta",
};

/** El feed REAL del agente, en líneas para la TV de la sala. */
function toFeedLines(events: AgentActivityEvent[]): FeedLine[] {
  return events
    .filter((e) => KIND_LABEL[e.kind])
    .slice(-12)
    .map((e) => {
      const d = new Date(e.ts);
      const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      const text = [e.toolName, e.detail?.replace(/\s+/g, " ")].filter(Boolean).join(" · ").slice(0, 140);
      const tone: FeedLine["tone"] =
        e.kind === "tool_call"
          ? "tool"
          : e.kind === "task_done"
            ? "done"
            : e.kind === "error"
              ? "error"
              : e.kind === "task_start" || e.kind === "session_start"
                ? "start"
                : "text";
      return { time, kind: KIND_LABEL[e.kind] ?? e.kind, text, tone };
    });
}

export default function OficinaPage() {
  const theme = useTheme();
  const { live, feed, snapshots } = useOfficeFeed();
  const { events } = useAgentEvents();
  const [sim, setSim] = useState<OfficeState | null>(null);
  const [selected, setSelected] = useState<OfficeHit | null>(null);
  const [pendingFocus, setPendingFocus] = useState<string | null>(null);
  const [mode, setModeState] = useState<OfficeMode>("explore");
  const [near, setNear] = useState<OfficeHit | null>(null);
  const [look, setLook] = useState<OwnerLook>(DEFAULT_LOOK);
  const [lookOpen, setLookOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [daylight, setDaylight] = useState("");
  const sceneRef = useRef<OficinaSceneHandle>(null);
  const seatsRef = useRef<Map<string, string>>(new Map());

  useEffect(() => setLook(loadLook()), []);
  useEffect(() => {
    const tick = () => setDaylight(daylightAt(new Date()).label);
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  const workers = useMemo<OfficeWorker[]>(
    () => (sim ? sim.workers : [...live.workers.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt))),
    [sim, live.workers],
  );
  const projects = sim ? sim.projects : live.projects;
  const machine = sim ? sim.machine : live.machine;

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const w of workers) c[w.project] = (c[w.project] ?? 0) + 1;
    return c;
  }, [workers]);

  // Pods: la oficina crece con la gente (orden de llegada, estable en la sesión).
  const podOrderRef = useRef<{ sim: boolean; order: string[] }>({ sim: false, order: [] });
  if (podOrderRef.current.sim !== !!sim) podOrderRef.current = { sim: !!sim, order: [] };
  const order = podOrderRef.current.order;
  for (const w of workers) if (w.project !== GENERAL_PROJECT && !order.includes(w.project)) order.push(w.project);
  const podSlugs = showAll ? [...order, ...projects.map((p) => p.slug).filter((s) => !order.includes(s))] : [...order];
  const podKey = podSlugs.join(",");
  const countsKey = JSON.stringify(counts);
  const layout = useMemo(
    () => buildOfficeLayout(podSlugs.map((slug) => ({ slug, name: projects.find((p) => p.slug === slug)?.name ?? slug })), counts),
    // podSlugs/counts se leen por su clave estable.
    [podKey, countsKey, projects],
  );

  const seats = useMemo(() => {
    const { seats } = assignSeats(workers, layout.desks, seatsRef.current);
    seatsRef.current = seats;
    return seats;
  }, [workers, layout]);

  const projectName = useCallback(
    (slug: string) => (slug === GENERAL_PROJECT ? "General" : (projects.find((p) => p.slug === slug)?.name ?? slug)),
    [projects],
  );

  const podInfo = useMemo(() => {
    const names: Record<string, { name: string; count: number }> = {};
    for (const pod of layout.pods) names[pod.project] = { name: projectName(pod.project), count: counts[pod.project] ?? 0 };
    return names;
  }, [layout, counts, projectName]);

  const feedLines = useMemo(() => toFeedLines(events), [events]);
  const tally = useMemo(() => officeCounts(workers), [workers]);
  // La pizarra de la sala: los mismos conteos reales del HUD.
  const board = useMemo(
    () => [
      { label: "Trabajando", value: tally.working + tally.starting, color: "#e7b04e" },
      { label: "Pensando", value: tally.thinking, color: "#7fc4d4" },
      { label: "Bloqueados", value: tally.blocked, color: "#f07070" },
      { label: "Listos", value: tally.done, color: "#6ccb8f" },
      { label: "Pods", value: layout.pods.length, color: "#d97757" },
    ],
    [tally, layout.pods.length],
  );
  const selectedWorker = selected?.kind === "worker" ? workers.find((w) => w.id === selected.id) : undefined;
  const selectedDesk = selected?.kind === "desk" ? layout.desks.find((d) => d.id === selected.id) : undefined;
  const hiring = !!selectedDesk && !sim;

  const nearLabel = useMemo(() => {
    if (!near) return null;
    if (near.kind === "worker") {
      const w = workers.find((x) => x.id === near.id);
      return w ? `Ver a ${w.name}` : null;
    }
    const d = layout.desks.find((x) => x.id === near.id);
    return d ? (sim ? "Escritorio libre" : `Contratar aquí · ${projectName(d.project)}`) : null;
  }, [near, workers, layout, projectName, sim]);

  // Avisos: quién llega y quién termina (no al cargar la página ni en simulación).
  const prevRef = useRef<Map<string, OfficeWorker["status"]> | null>(null);
  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = new Map(workers.map((w) => [w.id, w.status]));
    if (!prev || sim || snapshots === 0) return;
    const add: Toast[] = [];
    for (const w of workers) {
      const was = prev.get(w.id);
      if (!was) add.push({ id: Math.random(), tone: "start", text: `${w.name} llegó a ${projectName(w.project)}` });
      else if (was !== w.status && w.status === "done") add.push({ id: Math.random(), tone: "done", text: `${w.name} terminó` });
      else if (was !== w.status && w.status === "error") add.push({ id: Math.random(), tone: "error", text: `${w.name} falló` });
    }
    if (!add.length) return;
    setToasts((t) => [...t, ...add].slice(-4));
    const ids = new Set(add.map((a) => a.id));
    setTimeout(() => setToasts((t) => t.filter((x) => !ids.has(x.id))), 4500);
  }, [workers, sim, snapshots, projectName]);

  useEffect(() => {
    if (selected?.kind === "worker" && !selectedWorker) setSelected(null);
  }, [selected, selectedWorker]);

  useEffect(() => {
    if (!pendingFocus || !workers.some((w) => w.id === pendingFocus)) return;
    const hit: OfficeHit = { kind: "worker", id: pendingFocus };
    setSelected(hit);
    setPendingFocus(null);
    requestAnimationFrame(() => sceneRef.current?.world()?.focus(hit));
  }, [pendingFocus, workers]);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const w = sceneRef.current?.world();
      if (w?.mode === "aerial") w.frameAll(false);
    });
    return () => cancelAnimationFrame(id);
  }, [snapshots, sim, theme.resolved, showAll]);

  const setMode = useCallback((m: OfficeMode) => sceneRef.current?.world()?.setMode(m), []);

  const onClick = useCallback((hit: OfficeHit | null) => {
    setSelected(hit);
    if (hit) sceneRef.current?.world()?.focus(hit);
  }, []);

  const pickFromRoster = useCallback((w: OfficeWorker) => {
    const hit: OfficeHit = { kind: "worker", id: w.id };
    setSelected(hit);
    const world = sceneRef.current?.world();
    if (world?.mode === "explore") world.walkTo(hit);
    else world?.focus(hit);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setSelected(null);
      setLookOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const changeLook = (l: OwnerLook) => {
    setLook(l);
    saveLook(l);
  };

  // Seams de QA: simular sin gastar tokens, leer el estado, clics reales, vista y caminar.
  const debugRef = useRef({ workers, seats, selected, layout, near });
  debugRef.current = { workers, seats, selected, layout, near };
  useEffect(() => {
    window.__hermesOficinaSim = (state) => setSim(state === "demo" ? demoOfficeState(live.projects, live.machine || "sim") : state);
    window.__hermesOficinaDebug = () => {
      const d = debugRef.current;
      const world = sceneRef.current?.world();
      return {
        workers: d.workers.map((w) => ({ id: w.id, project: w.project, status: w.status, action: w.action, name: w.name })),
        seats: Object.fromEntries(d.seats),
        selected: d.selected,
        desks: d.layout.desks.length,
        freeDesks: d.layout.desks.map((x) => x.id),
        pods: d.layout.pods.length,
        simulated: !!sim,
        ...(world?.debug() ?? { fps: 0 }),
      };
    };
    window.__hermesOficinaScreenOf = (hit) => sceneRef.current?.world()?.screenOf(hit) ?? null;
    window.__hermesOficinaFocus = (hit) => sceneRef.current?.world()?.focus(hit);
    window.__hermesOficinaMode = (m) => sceneRef.current?.world()?.setMode(m);
    window.__hermesOficinaWalkTo = (hit) => sceneRef.current?.world()?.walkTo(hit);
    return () => {
      delete window.__hermesOficinaSim;
      delete window.__hermesOficinaDebug;
      delete window.__hermesOficinaScreenOf;
      delete window.__hermesOficinaFocus;
      delete window.__hermesOficinaMode;
      delete window.__hermesOficinaWalkTo;
    };
  }, [live.projects, live.machine, sim]);

  const title = OWNER ? `Oficina de ${OWNER}` : "Oficina de agentes";

  return (
    <main className="fixed inset-0 overflow-hidden bg-bg text-text">
      <OficinaScene
        key={theme.resolved}
        ref={sceneRef}
        layout={layout}
        workers={workers}
        seats={seats}
        selected={selected}
        podInfo={podInfo}
        ownerName={OWNER}
        look={look}
        feed={feedLines}
        board={board}
        nearLabel={nearLabel}
        inputEnabled={!hiring}
        onClick={onClick}
        onNear={setNear}
        onMode={setModeState}
      />

      <div className="pointer-events-none absolute inset-x-3 top-3 z-20 flex items-start justify-between gap-3">
        <StatusCard title={title} machine={machine} feed={feed} simulated={!!sim} total={workers.length} tally={tally} daylight={daylight} />
        <div className="flex flex-col items-end gap-2">
          <Toolbar
            mode={mode}
            onMode={setMode}
            showAll={showAll}
            onShowAll={() => setShowAll((v) => !v)}
            onFrame={() => sceneRef.current?.world()?.frameAll()}
            lookOpen={lookOpen}
            onLook={() => setLookOpen((v) => !v)}
            themeIcon={theme.resolved === "dark" ? "☾" : "☀"}
            onTheme={theme.cycle}
          />
          {lookOpen ? <LookPicker look={look} onChange={changeLook} onClose={() => setLookOpen(false)} /> : null}
          {!selectedWorker && !lookOpen ? (
            <TeamRoster
              workers={workers}
              projectName={projectName}
              selectedId={selected?.kind === "worker" ? selected.id : null}
              onPick={pickFromRoster}
            />
          ) : null}
        </div>
      </div>

      <Toasts toasts={toasts} />

      <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center px-3">
        <ControlsHint mode={mode} />
      </div>

      {selectedWorker ? (
        <WorkerDrawer
          worker={selectedWorker}
          projectName={projectName(selectedWorker.project)}
          simulated={!!sim}
          onClose={() => setSelected(null)}
        />
      ) : null}

      {hiring && selectedDesk ? (
        <HireDialog
          project={selectedDesk.project}
          projects={projects}
          onClose={() => setSelected(null)}
          onLaunched={(id) => {
            setSelected(null);
            if (id) setPendingFocus(id);
          }}
        />
      ) : null}
    </main>
  );
}
