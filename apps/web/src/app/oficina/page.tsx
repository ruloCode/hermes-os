"use client";

// OFICINA DE AGENTES — página suelta a pantalla completa (fuera del shell,
// hermana de /sala): una oficina 3D donde cada sesión VIVA del Agent SDK o run
// de claude -p es un personaje en su escritorio, agrupado por proyecto, y el
// dueño camina entre ellos en tercera persona — con teclado (WASD, Shift,
// Espacio, E, V) o con un control de juego (Xbox Wireless Controller por
// Bluetooth: stick, RT, A, X, B, Y, LB/RB, View, Menu).
//
// Hablarle a un agente es por VOZ: A (o E) abre la conversación con el
// micrófono ya escuchando; la instrucción continúa la sesión del run (o
// contrata uno nuevo), y cuando termina su respuesta se lee en voz alta. Y
// llama a Hermes (ElevenLabs), que también puede lanzar agentes.
//
// La verdad vive en el agente (apps/agent/src/office/state.ts): esta página
// escucha GET /office/events y dibuja. Guía: docs/oficina-de-agentes.md.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  GENERAL_PROJECT,
  assignSeats,
  buildOfficeLayout,
  officeCounts,
  TRIGGER_ON,
  type AgentActivityEvent,
  type OfficeProject,
  type OfficeState,
  type OfficeUpdate,
  type OfficeWorker,
  type PadButton,
  type PadState,
} from "@hermes/shared";
import { claudeStartRun, hermesPost, sseUrl } from "@/lib/hermes";
import { OWNER } from "@/lib/owner";
import { useTheme } from "@/state/ThemeProvider";
import { useWorkspace } from "@/state/WorkspaceContext";
import { useAgentEvents } from "@/hooks/useAgentEvents";
import { useHermesData } from "@/hooks/useHermesData";
import { useVoiceConnect } from "@/hooks/useVoiceConnect";
import { useOfficeCast } from "@/hooks/useOfficeCast";
import { useGamepad } from "@/hooks/useGamepad";
import { useOfficeDictation } from "@/hooks/useOfficeDictation";
import { VoiceClientTools } from "@/components/VoiceClientTools";
import { VoiceEventsBridge } from "@/components/VoiceEventsBridge";
import { OficinaScene, type OficinaSceneHandle } from "@/components/oficina/OficinaScene";
import { WorkerDrawer } from "@/components/oficina/WorkerDrawer";
import { HireDialog, type HireDialogHandle } from "@/components/oficina/HireDialog";
import {
  ControllerHelp,
  ControlsHint,
  LookPicker,
  StatusCard,
  TeamRoster,
  Toasts,
  Toolbar,
  type Feed,
  type Toast,
} from "@/components/oficina/OficinaHud";
import { demoOfficeState } from "@/lib/oficina/sim";
import { DEFAULT_LOOK, loadLook, saveLook, type OwnerLook } from "@/lib/oficina/look";
import { daylightAt, type FeedLine } from "@/lib/oficina/room";
import { replyVoiceEnabled, setReplyVoice, speak, stopSpeaking } from "@/lib/oficina/speech";
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
    /** QA sin micrófono: deja `text` como lo dictado (listo para enviar). */
    __hermesOficinaDictate?: (text: string) => void;
    __hermesOficinaTeam?: { say: (text: string) => boolean; debug: () => unknown };
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

/** En simulación no hay llamada con el equipo: esos runs no existen. */
const NO_WORKERS: OfficeWorker[] = [];

/** Lo que Hermes sabe de dónde estás cuando lo llamas desde la Oficina. */
const HERMES_SCOPE =
  "El usuario está en la Oficina de agentes 3D, caminando entre sus agentes con un control. Si pide trabajo en un proyecto, usa work_on_project con ese proyecto: el agente aparece en su escritorio. Si pide algo general, run_task. Responde corto.";

export default function OficinaPage() {
  const theme = useTheme();
  const ws = useWorkspace();
  const { projects: vaultProjects } = useHermesData();
  const { live, feed, snapshots } = useOfficeFeed();
  const { events } = useAgentEvents();
  const hermes = useVoiceConnect();
  const voice = useOfficeDictation();
  const [sim, setSim] = useState<OfficeState | null>(null);
  const [selected, setSelected] = useState<OfficeHit | null>(null);
  const [pendingFocus, setPendingFocus] = useState<string | null>(null);
  const [mode, setModeState] = useState<OfficeMode>("explore");
  const [near, setNear] = useState<OfficeHit | null>(null);
  const [look, setLook] = useState<OwnerLook>(DEFAULT_LOOK);
  const [lookOpen, setLookOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [daylight, setDaylight] = useState("");
  const [usingPad, setUsingPad] = useState(false);
  const [replyVoice, setReplyVoiceState] = useState(true);
  const [sending, setSending] = useState(false);
  const sceneRef = useRef<OficinaSceneHandle>(null);
  const hireRef = useRef<HireDialogHandle>(null);
  const seatsRef = useRef<Map<string, string>>(new Map());
  /** Agentes a los que les hablaste: su respuesta se lee en voz alta al terminar. */
  const talkedRef = useRef(new Set<string>());
  const selectedRef = useRef<OfficeHit | null>(null);
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  const spokenRef = useRef(new Set<string>());

  useEffect(() => {
    setLook(loadLook());
    setReplyVoiceState(replyVoiceEnabled());
  }, []);
  useEffect(() => {
    const tick = () => setDaylight(daylightAt(new Date()).label);
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  const toast = useCallback((tone: Toast["tone"], text: string) => {
    const id = Math.random();
    setToasts((t) => [...t, { id, tone, text }].slice(-4));
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
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
  selectedRef.current = selected;
  const selectedWorker = selected?.kind === "worker" ? workers.find((w) => w.id === selected.id) : undefined;
  const selectedDesk = selected?.kind === "desk" ? layout.desks.find((d) => d.id === selected.id) : undefined;
  const hiring = !!selectedDesk && !sim;
  const conversationOpen = hiring || !!selectedWorker;

  const nearLabel = useMemo(() => {
    if (!near) return null;
    if (near.kind === "worker") {
      const w = workers.find((x) => x.id === near.id);
      return w ? `Hablar con ${w.name}` : null;
    }
    const d = layout.desks.find((x) => x.id === near.id);
    return d ? (sim ? "Escritorio libre" : `Contratar aquí · ${projectName(d.project)}`) : null;
  }, [near, workers, layout, projectName, sim]);

  // ── Control de juego ──────────────────────────────────────────────────
  const usingPadRef = useRef(false);
  const markPad = (on: boolean) => {
    if (usingPadRef.current === on) return;
    usingPadRef.current = on;
    setUsingPad(on);
  };
  useEffect(() => {
    const onKey = () => markPad(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── Voz con Hermes (Y) ────────────────────────────────────────────────
  const hermesCall: "off" | "connecting" | "on" | "unavailable" = !hermes.configured
    ? "unavailable"
    : hermes.connected
      ? "on"
      : hermes.connecting
        ? "connecting"
        : "off";
  const toggleHermes = useCallback(() => {
    if (!hermes.configured) return;
    if (hermes.connected || hermes.connecting) void hermes.disconnect();
    else {
      voice.cancel();
      stopSpeaking();
      void hermes.connect({ scopePrompt: HERMES_SCOPE });
    }
  }, [hermes, voice]);

  // ── Voz con el equipo (elenco multi-voz: cada agente con su voz) ────────
  // Las tools del elenco llaman a estas funciones (definidas más abajo) por ref.
  const instructRef = useRef<(w: OfficeWorker, text: string) => Promise<string>>(async () => "");
  const hireAgentRef = useRef<(project: string, text: string) => Promise<string>>(async () => "");
  const team = useOfficeCast({
    workers: sim ? NO_WORKERS : workers,
    projects,
    projectName,
    owner: OWNER,
    instruct: (w, text) => instructRef.current(w, text),
    hire: (project, text) => hireAgentRef.current(project, text),
  });
  const inCall = hermes.connected || team.status === "on";
  /** Y: si existe el elenco de la oficina llama al equipo; si no, a Hermes. */
  const toggleCall = useCallback(() => {
    if (!team.available) return toggleHermes();
    if (team.status === "on" || team.status === "connecting") void team.hangup();
    else {
      voice.cancel();
      stopSpeaking();
      if (hermes.connected || hermes.connecting) void hermes.disconnect();
      void team.connect();
    }
  }, [team, toggleHermes, voice, hermes]);

  // ── Conversación con un agente ────────────────────────────────────────
  /** Abrir una conversación = el micrófono ya escuchando (salvo en llamada con Hermes). */
  const openConversation = useCallback(
    (hit: OfficeHit) => {
      setSelected(hit);
      stopSpeaking();
      if (!inCall) voice.start();
    },
    [inCall, voice],
  );

  const closeConversation = useCallback(() => {
    voice.cancel();
    setSelected(null);
  }, [voice]);

  /** Instrucción a un personaje: continúa su sesión si es un run; si no, trabajo nuevo en su proyecto. */
  const instructWorker = useCallback(
    async (w: OfficeWorker, text: string): Promise<string> => {
      if (w.source === "run" && w.sessionId) return (await claudeStartRun(text, ws.claudeConfig, w.project, w.sessionId)).runId;
      if (w.project === GENERAL_PROJECT) return (await hermesPost<{ task_id?: string }>("/tasks", { prompt: text })).task_id ?? "";
      return (await claudeStartRun(text, ws.claudeConfig, w.project)).runId;
    },
    [ws.claudeConfig],
  );

  const hireAgent = useCallback(
    async (project: string, text: string): Promise<string> => {
      if (project === GENERAL_PROJECT) return (await hermesPost<{ task_id?: string }>("/tasks", { prompt: text })).task_id ?? "";
      return (await claudeStartRun(text, ws.claudeConfig, project)).runId;
    },
    [ws.claudeConfig],
  );

  instructRef.current = instructWorker;
  hireAgentRef.current = hireAgent;

  const sendToWorker = useCallback(async () => {
    const w = selectedWorker;
    const text = voice.text.trim();
    if (!w || !text || sim || sending || voice.state !== "ready") return;
    if (w.source === "run" && w.status !== "done" && w.status !== "error") return;
    setSending(true);
    try {
      const id = await instructWorker(w, text);
      if (id) {
        talkedRef.current.add(id);
        setPendingFocus(id);
      }
      voice.cancel();
      pad.rumble("success");
      toast("start", `Instrucción enviada a ${w.name}`);
    } catch (err) {
      toast("error", `No se pudo enviar: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSending(false);
    }
    // `pad` se declara abajo (su rumble lee el control al llamarse).
  }, [selectedWorker, voice, sim, sending, instructWorker, toast]);

  // La respuesta del agente al que le hablaste, en voz alta (y el control vibra).
  useEffect(() => {
    for (const w of workers) {
      if (!talkedRef.current.has(w.id) || spokenRef.current.has(w.id)) continue;
      if (w.status !== "done" && w.status !== "error") continue;
      spokenRef.current.add(w.id);
      pad.rumble(w.status === "done" ? "success" : "alert");
      toast(w.status === "done" ? "done" : "error", w.status === "done" ? `🔊 ${w.name} respondió` : `${w.name} falló`);
      if (replyVoice && !inCall) {
        speak(w.status === "done" ? (w.lastText ?? w.task.summary) : `No pude terminar: ${w.task.summary}`, () => {
          // Ida y vuelta: si sigues en su panel, el micrófono vuelve a escucharte.
          const sel = selectedRef.current;
          if (sel?.kind === "worker" && sel.id === w.id && voiceRef.current.state === "idle") voiceRef.current.start();
        });
      }
    }
  }, [workers, replyVoice, inCall, toast]);

  const cycleAgent = useCallback(
    (dir: 1 | -1) => {
      if (!workers.length) return;
      const current = selected?.kind === "worker" ? selected.id : near?.kind === "worker" ? near.id : null;
      const i = current ? workers.findIndex((w) => w.id === current) : -1;
      const next = workers[(i + dir + workers.length) % workers.length];
      const hit: OfficeHit = { kind: "worker", id: next.id };
      const world = sceneRef.current?.world();
      if (world?.mode === "explore") world.walkTo(hit);
      else world?.focus(hit);
      if (selected?.kind === "worker") {
        voice.cancel();
        setSelected(hit);
      }
    },
    [workers, selected, near, voice],
  );

  const onPadPress = (b: PadButton) => {
    markPad(true);
    const world = sceneRef.current?.world();
    if (helpOpen) {
      if (b === "B" || b === "MENU" || b === "A") setHelpOpen(false);
      return;
    }
    if (conversationOpen) {
      if (b === "A") {
        pad.rumble("tap");
        if (voice.state === "listening") voice.stop();
        else if (voice.state === "ready") {
          if (hiring) hireRef.current?.submit();
          else void sendToWorker();
        } else if (voice.state !== "transcribing") voice.start();
        return;
      }
      if (b === "X") {
        voice.start();
        return;
      }
      if (b === "B") {
        if (voice.state === "listening" || voice.state === "transcribing") voice.cancel();
        else closeConversation();
        return;
      }
      if (hiring) return;
    }
    switch (b) {
      case "A":
        if (world?.interact()) pad.rumble("tap");
        break;
      case "X":
        world?.jump();
        break;
      case "B":
        closeConversation();
        setLookOpen(false);
        break;
      case "Y":
        toggleCall();
        break;
      case "VIEW":
        world?.setMode(world.mode === "explore" ? "aerial" : "explore");
        break;
      case "MENU":
        setHelpOpen((v) => !v);
        break;
      case "LB":
      case "LEFT":
        cycleAgent(-1);
        break;
      case "RB":
      case "RIGHT":
        cycleAgent(1);
        break;
      case "LT":
      case "RS":
        world?.recenter();
        break;
    }
  };

  const onPadFrame = (s: PadState | null) => {
    const world = sceneRef.current?.world();
    if (!world) return;
    if (!s) {
      world.setPad({ move: { x: 0, y: 0 }, look: { x: 0, y: 0 }, run: false, zoom: 0 });
      return;
    }
    const active = s.move.x || s.move.y || s.look.x || s.look.y || s.held.size;
    if (active) markPad(true);
    world.setPad({
      move: s.move,
      look: s.look,
      run: s.rt >= TRIGGER_ON,
      zoom: s.held.has("UP") ? -1 : s.held.has("DOWN") ? 1 : 0,
    });
  };

  const pad = useGamepad({ onFrame: onPadFrame, onPress: onPadPress });

  // ── Avisos: quién llega y quién termina (no al cargar ni en simulación) ──
  const prevRef = useRef<Map<string, OfficeWorker["status"]> | null>(null);
  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = new Map(workers.map((w) => [w.id, w.status]));
    if (!prev || sim || snapshots === 0) return;
    for (const w of workers) {
      const was = prev.get(w.id);
      if (!was && !w.continues) toast("start", `${w.name} llegó a ${projectName(w.project)}`);
      else if (was && was !== w.status && !talkedRef.current.has(w.id)) {
        if (w.status === "done") toast("done", `${w.name} terminó`);
        else if (w.status === "error") toast("error", `${w.name} falló`);
      }
    }
  }, [workers, sim, snapshots, projectName, toast]);

  useEffect(() => {
    if (selected?.kind === "worker" && !selectedWorker && !pendingFocus) setSelected(null);
  }, [selected, selectedWorker, pendingFocus]);

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

  // Clic o E/A sobre el mundo: abre la conversación (y en aérea, la cámara va ahí).
  const onClick = useCallback(
    (hit: OfficeHit | null) => {
      if (!hit) {
        closeConversation();
        return;
      }
      openConversation(hit);
      sceneRef.current?.world()?.focus(hit);
    },
    [openConversation, closeConversation],
  );

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
      closeConversation();
      setLookOpen(false);
      setHelpOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeConversation]);

  const changeLook = (l: OwnerLook) => {
    setLook(l);
    saveLook(l);
  };

  // Seams de QA: simular sin tokens, leer el estado, clics reales, vista, caminar y dictar.
  const teamRef = useRef(team);
  teamRef.current = team;
  const debugRef = useRef({ workers, seats, selected, layout, near, voice, usingPad });
  debugRef.current = { workers, seats, selected, layout, near, voice, usingPad };
  useEffect(() => {
    window.__hermesOficinaSim = (state) => setSim(state === "demo" ? demoOfficeState(live.projects, live.machine || "sim") : state);
    window.__hermesOficinaDebug = () => {
      const d = debugRef.current;
      const world = sceneRef.current?.world();
      return {
        workers: d.workers.map((w) => ({ id: w.id, project: w.project, status: w.status, action: w.action, name: w.name, continues: w.continues })),
        seats: Object.fromEntries(d.seats),
        selected: d.selected,
        desks: d.layout.desks.length,
        freeDesks: d.layout.desks.map((x) => x.id),
        pods: d.layout.pods.length,
        simulated: !!sim,
        voice: { state: d.voice.state, text: d.voice.text, engine: d.voice.engine },
        usingPad: d.usingPad,
        ...(world?.debug() ?? { fps: 0 }),
      };
    };
    window.__hermesOficinaScreenOf = (hit) => sceneRef.current?.world()?.screenOf(hit) ?? null;
    window.__hermesOficinaFocus = (hit) => sceneRef.current?.world()?.focus(hit);
    window.__hermesOficinaMode = (m) => sceneRef.current?.world()?.setMode(m);
    window.__hermesOficinaWalkTo = (hit) => sceneRef.current?.world()?.walkTo(hit);
    window.__hermesOficinaTeam = { say: (text: string) => teamRef.current.say(text), debug: () => teamRef.current.debug() };
    window.__hermesOficinaDictate = (text) => {
      voice.cancel();
      voice.edit(text);
    };
    return () => {
      delete window.__hermesOficinaSim;
      delete window.__hermesOficinaDebug;
      delete window.__hermesOficinaScreenOf;
      delete window.__hermesOficinaFocus;
      delete window.__hermesOficinaMode;
      delete window.__hermesOficinaWalkTo;
      delete window.__hermesOficinaDictate;
      delete window.__hermesOficinaTeam;
    };
  }, [live.projects, live.machine, sim, voice]);

  const title = OWNER ? `Oficina de ${OWNER}` : "Oficina de agentes";

  return (
    <main className="fixed inset-0 overflow-hidden bg-bg text-text">
      {/* La página vive fuera del shell: las tools de la voz de Hermes y sus avisos se montan aquí. */}
      <VoiceClientTools projects={vaultProjects} onFocusProject={ws.focusProject} onShowPanel={ws.showPanel} onWork={ws.launchClaudeRun} />
      <VoiceEventsBridge events={events} />

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
        nearKey={pad.connected && usingPad ? "A" : "E"}
        inputEnabled={!hiring}
        onClick={onClick}
        onNear={setNear}
        onMode={setModeState}
        voices={team.voiceNames}
        speakingProbe={team.speakingWorker}
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
            pad={{ connected: pad.connected, label: pad.label }}
            replyVoice={replyVoice}
            onReplyVoice={() => {
              const next = !replyVoice;
              setReplyVoiceState(next);
              setReplyVoice(next);
              if (!next) stopSpeaking();
            }}
            hermesCall={team.available ? (team.status === "on" ? "on" : team.status === "connecting" ? "connecting" : team.status === "unavailable" ? "unavailable" : "off") : hermesCall}
            callLabel={team.available ? "Equipo" : "Hermes"}
            onHermesCall={toggleCall}
          />
          {hermes.error ? <p className="pointer-events-auto rounded-lg bg-panel px-3 py-1.5 text-xs text-red">{hermes.error}</p> : null}
          {team.error ? <p className="pointer-events-auto max-w-sm rounded-lg bg-panel px-3 py-1.5 text-xs text-red">{team.error}</p> : null}
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

      {team.status === "on" ? (
        <div className="pointer-events-none absolute bottom-20 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full border border-accent/50 bg-panel/90 px-4 py-2 text-sm shadow-lg backdrop-blur">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inset-0 animate-ping rounded-full bg-accent opacity-60" />
            <span className="relative h-2.5 w-2.5 rounded-full bg-accent" />
          </span>
          En llamada con el equipo · háblale a cada uno por su voz o a todos a la vez
          {pad.connected ? <span className="ml-1 text-xs text-text-faint">(Y cuelga)</span> : null}
        </div>
      ) : null}

      {hermesCall === "on" ? (
        <div className="pointer-events-none absolute top-20 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full border border-accent/50 bg-panel/90 px-4 py-2 text-sm shadow-lg backdrop-blur">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inset-0 animate-ping rounded-full bg-accent opacity-60" />
            <span className="relative h-2.5 w-2.5 rounded-full bg-accent" />
          </span>
          En llamada con Hermes · pídele trabajo en voz alta
          {pad.connected ? (
            <span className="ml-1 text-xs text-text-faint">(Y cuelga)</span>
          ) : null}
        </div>
      ) : null}

      <Toasts toasts={toasts} />

      <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center px-3">
        <ControlsHint mode={mode} pad={pad.connected && usingPad} padConnected={pad.connected} />
      </div>

      {selectedWorker ? (
        <WorkerDrawer
          worker={selectedWorker}
          projectName={projectName(selectedWorker.project)}
          simulated={!!sim}
          onClose={closeConversation}
          voice={voice}
          padConnected={pad.connected}
          sending={sending}
          onSend={() => void sendToWorker()}
        />
      ) : null}

      {hiring && selectedDesk ? (
        <HireDialog
          ref={hireRef}
          project={selectedDesk.project}
          projects={projects}
          voice={voice}
          padConnected={pad.connected}
          onClose={closeConversation}
          onLaunched={(id) => {
            voice.cancel();
            setSelected(null);
            pad.rumble("success");
            if (id) {
              talkedRef.current.add(id);
              setPendingFocus(id);
            }
          }}
        />
      ) : null}

      {helpOpen ? <ControllerHelp label={pad.label} onClose={() => setHelpOpen(false)} /> : null}
    </main>
  );
}
