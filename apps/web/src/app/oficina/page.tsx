"use client";

// OFICINA DE AGENTES — página suelta a pantalla completa (fuera del shell,
// hermana de /sala): una oficina 3D con un pod de escritorios por proyecto
// activo del vault y un personaje por cada sesión VIVA del Agent SDK o run de
// claude -p. El personaje actúa su tool real, su bombilla dice su estado y su
// laptop muestra sus últimas líneas. Clic en un "+" contrata; clic en un
// personaje abre su salida.
//
// La verdad vive en el agente (apps/agent/src/office/state.ts): esta página
// solo escucha GET /office/events (snapshot al conectar + un mensaje por
// cambio) y dibuja. Inspirada en agent-office (AgentSystemLabs, MIT).

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  GENERAL_PROJECT,
  assignSeats,
  buildOfficeLayout,
  officeCounts,
  type OfficeProject,
  type OfficeState,
  type OfficeUpdate,
  type OfficeWorker,
} from "@hermes/shared";
import { sseUrl } from "@/lib/hermes";
import { useTheme } from "@/state/ThemeProvider";
import { OficinaScene, type OficinaSceneHandle } from "@/components/oficina/OficinaScene";
import { WorkerDrawer } from "@/components/oficina/WorkerDrawer";
import { HireDialog } from "@/components/oficina/HireDialog";
import { demoOfficeState } from "@/lib/oficina/sim";
import type { OfficeHit } from "@/lib/oficina/office-world";

type Feed = "connecting" | "live" | "offline";

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
          return {
            workers: new Map(u.state.workers.map((w) => [w.id, w])),
            projects: u.state.projects,
            machine: u.state.machine,
          };
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

const COUNT_STYLE = [
  { key: "working", label: "trabajando", dot: "bg-amber" },
  { key: "thinking", label: "pensando", dot: "bg-cyan" },
  { key: "blocked", label: "bloqueados", dot: "bg-red" },
  { key: "done", label: "listos", dot: "bg-green" },
  { key: "error", label: "con error", dot: "bg-red" },
  { key: "starting", label: "arrancando", dot: "bg-text-faint" },
] as const;

export default function OficinaPage() {
  const theme = useTheme();
  const { live, feed, snapshots } = useOfficeFeed();
  const [sim, setSim] = useState<OfficeState | null>(null);
  const [selected, setSelected] = useState<OfficeHit | null>(null);
  const [pendingFocus, setPendingFocus] = useState<string | null>(null);
  const sceneRef = useRef<OficinaSceneHandle>(null);
  const seatsRef = useRef<Map<string, string>>(new Map());

  const workers = useMemo<OfficeWorker[]>(
    () =>
      sim ? sim.workers : [...live.workers.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt)),
    [sim, live.workers],
  );
  const projects = sim ? sim.projects : live.projects;
  const machine = sim ? sim.machine : live.machine;

  // La planta solo cambia cuando cambian los proyectos o cuántos hay por pod.
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const w of workers) c[w.project] = (c[w.project] ?? 0) + 1;
    return c;
  }, [workers]);

  // Pods: la oficina crece con la gente. Un proyecto abre su pod cuando llega
  // su primer agente y ya no se mueve en toda la sesión (orden de llegada), así
  // nada salta. "Todos" muestra además los proyectos activos sin nadie.
  const [showAll, setShowAll] = useState(false);
  const podOrderRef = useRef<{ sim: boolean; order: string[] }>({ sim: false, order: [] });
  if (podOrderRef.current.sim !== !!sim) podOrderRef.current = { sim: !!sim, order: [] };
  const order = podOrderRef.current.order;
  for (const w of workers) if (w.project !== GENERAL_PROJECT && !order.includes(w.project)) order.push(w.project);
  const podSlugs = showAll ? [...order, ...projects.map((p) => p.slug).filter((s) => !order.includes(s))] : [...order];
  const podKey = podSlugs.join(",");
  const countsKey = JSON.stringify(counts);
  const layout = useMemo(
    () =>
      buildOfficeLayout(
        podSlugs.map((slug) => ({ slug, name: projects.find((p) => p.slug === slug)?.name ?? slug })),
        counts,
      ),
    // podSlugs/counts se leen por su clave estable.
    [podKey, countsKey, projects],
  );

  const seats = useMemo(() => {
    const { seats } = assignSeats(workers, layout.desks, seatsRef.current);
    seatsRef.current = seats;
    return seats;
  }, [workers, layout]);

  const podInfo = useMemo(() => {
    const names: Record<string, { name: string; count: number }> = {
      [GENERAL_PROJECT]: { name: "General", count: counts[GENERAL_PROJECT] ?? 0 },
    };
    for (const p of projects) names[p.slug] = { name: p.name, count: counts[p.slug] ?? 0 };
    return names;
  }, [projects, counts]);

  const tally = useMemo(() => officeCounts(workers), [workers]);
  const selectedWorker = selected?.kind === "worker" ? workers.find((w) => w.id === selected.id) : undefined;
  const selectedDesk = selected?.kind === "desk" ? layout.desks.find((d) => d.id === selected.id) : undefined;

  // Si el personaje seleccionado se fue, se cierra su panel.
  useEffect(() => {
    if (selected?.kind === "worker" && !selectedWorker) setSelected(null);
  }, [selected, selectedWorker]);

  // Recién contratado: en cuanto aparece, se selecciona y la cámara va a él.
  useEffect(() => {
    if (!pendingFocus || !workers.some((w) => w.id === pendingFocus)) return;
    const hit: OfficeHit = { kind: "worker", id: pendingFocus };
    setSelected(hit);
    setPendingFocus(null);
    requestAnimationFrame(() => sceneRef.current?.world()?.focus(hit));
  }, [pendingFocus, workers]);

  // Encuadre: cuando llega el estado real (o entra/sale la simulación), la
  // cámara va a donde hay gente trabajando.
  useEffect(() => {
    const id = requestAnimationFrame(() => sceneRef.current?.world()?.frameAll(false));
    return () => cancelAnimationFrame(id);
  }, [snapshots, sim, theme.resolved, showAll]);

  const onClick = useCallback((hit: OfficeHit | null) => {
    setSelected(hit);
    if (hit) sceneRef.current?.world()?.focus(hit);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Seams de QA: simular una oficina sin gastar tokens y leer el estado.
  const debugRef = useRef({ workers, seats, selected, layout });
  debugRef.current = { workers, seats, selected, layout };
  useEffect(() => {
    window.__hermesOficinaSim = (state) =>
      setSim(state === "demo" ? demoOfficeState(live.projects, live.machine || "sim") : state);
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
        fps: world?.fps ?? 0,
        simulated: !!sim,
      };
    };
    window.__hermesOficinaScreenOf = (hit) => sceneRef.current?.world()?.screenOf(hit) ?? null;
    window.__hermesOficinaFocus = (hit) => sceneRef.current?.world()?.focus(hit);
    return () => {
      delete window.__hermesOficinaSim;
      delete window.__hermesOficinaDebug;
      delete window.__hermesOficinaScreenOf;
      delete window.__hermesOficinaFocus;
    };
  }, [live.projects, live.machine, sim]);

  const projectName = (slug: string) =>
    slug === GENERAL_PROJECT ? "General" : (projects.find((p) => p.slug === slug)?.name ?? slug);

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
        onClick={onClick}
      />

      {/* HUD: qué hay, con datos reales (o la marca de simulación). */}
      <header className="pointer-events-none absolute top-3 left-3 z-20 flex max-w-[calc(100vw-24px)] flex-col gap-2">
        <div className="pointer-events-auto rounded-lg border border-line bg-panel/90 px-3.5 py-2.5 shadow-sm backdrop-blur">
          <div className="flex items-center gap-2">
            <h1 className="text-base font-medium">Oficina de agentes</h1>
            {sim ? (
              <span className="rounded-sm bg-amber/20 px-1.5 py-0.5 text-xs text-amber">simulación</span>
            ) : (
              <span
                className={`h-2 w-2 rounded-full ${feed === "live" ? "bg-green" : feed === "connecting" ? "bg-amber" : "bg-red"}`}
                title={feed === "live" ? "conectado al agente" : feed === "connecting" ? "conectando…" : "sin conexión con el agente"}
              />
            )}
          </div>
          <p className="mt-0.5 text-xs text-text-dim">
            {machine ? `${machine} · ` : ""}
            {workers.length === 0
              ? feed === "offline" && !sim
                ? "sin conexión con el agente"
                : "nadie trabajando ahora"
              : `${workers.length} ${workers.length === 1 ? "sesión" : "sesiones"} en la oficina`}
          </p>
          {workers.length ? (
            <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-text-dim">
              {COUNT_STYLE.filter((c) => tally[c.key] > 0).map((c) => (
                <li key={c.key} className="flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-full ${c.dot}`} />
                  <span className="tabular-nums text-text">{tally[c.key]}</span> {c.label}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </header>

      <nav className="absolute top-3 right-3 z-20 flex gap-2">
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className={`rounded-md border px-2.5 py-1.5 text-sm backdrop-blur ${
            showAll ? "border-accent bg-panel text-text" : "border-line bg-panel/90 text-text-dim hover:text-text"
          }`}
          title="Mostrar también los proyectos activos donde no hay nadie"
        >
          Todos los proyectos
        </button>
        <button
          type="button"
          onClick={() => sceneRef.current?.world()?.frameAll()}
          className="rounded-md border border-line bg-panel/90 px-2.5 py-1.5 text-sm text-text-dim backdrop-blur hover:text-text"
        >
          Encuadrar
        </button>
        <button
          type="button"
          onClick={theme.cycle}
          className="rounded-md border border-line bg-panel/90 px-2.5 py-1.5 text-sm text-text-dim backdrop-blur hover:text-text"
          title="Cambiar apariencia"
        >
          {theme.resolved === "dark" ? "☾" : "☀"}
        </button>
        <Link
          href="/"
          className="rounded-md border border-line bg-panel/90 px-2.5 py-1.5 text-sm text-text-dim backdrop-blur hover:text-text"
        >
          ← Dashboard
        </Link>
      </nav>

      <p className="pointer-events-none absolute bottom-3 left-3 z-20 rounded-md bg-panel/70 px-2.5 py-1 text-xs text-text-faint backdrop-blur">
        Clic en un <span className="text-accent">+</span> para contratar · clic en un agente para ver su salida · arrastra para
        orbitar · Esc cierra
      </p>

      {selectedWorker ? (
        <WorkerDrawer
          worker={selectedWorker}
          projectName={projectName(selectedWorker.project)}
          simulated={!!sim}
          onClose={() => setSelected(null)}
        />
      ) : null}

      {selectedDesk && !sim ? (
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
