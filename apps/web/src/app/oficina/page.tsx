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
  DEFAULT_OFFICE_MODE,
  GENERAL_PROJECT,
  OFFICE_NPCS,
  PLAN_TOOL,
  ROOFTOP_PAUSE_MS,
  baristaDay,
  baristaScheduled,
  baristaWeather,
  formatCountdown,
  receptionList,
  receptionSummary,
  assignSeats,
  isOfficeMode,
  nextOfficeMode,
  officeModeLabel,
  buildOfficeLayout,
  officeCounts,
  TRIGGER_ON,
  type AgentActivityEvent,
  type NpcLine,
  type OfficeMode as AgentMode,
  type OfficeNpcRole,
  type OfficeProject,
  type OfficeState,
  type OfficeUpdate,
  type OfficeWorker,
  type PadButton,
  type PadState,
  type ScheduledLite,
} from "@hermes/shared";
import { claudeStartRun, hermesGet, hermesPost, sseUrl } from "@/lib/hermes";
import { OWNER } from "@/lib/owner";
import { useTheme } from "@/state/ThemeProvider";
import { useWorkspace } from "@/state/WorkspaceContext";
import { useDashboard } from "@/state/DashboardProvider";
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
import { NpcDialog } from "@/components/oficina/NpcDialog";
import {
  ControllerHelp,
  ControlsHint,
  FloorPicker,
  LookPicker,
  PauseTimer,
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
import { isTyping } from "@/lib/oficina/player";
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
    __hermesOficinaStair?: (i: number) => boolean;
    __hermesOficinaFloor?: (floor: number) => void;
    __hermesOficinaDebug?: () => unknown;
    __hermesOficinaScreenOf?: (hit: OfficeHit) => { x: number; y: number } | null;
    __hermesOficinaFocus?: (hit: OfficeHit) => void;
    __hermesOficinaMode?: (mode: OfficeMode) => void;
    __hermesOficinaWalkTo?: (hit: OfficeHit) => void;
    /** QA sin micrófono: deja `text` como lo dictado (listo para enviar). */
    __hermesOficinaDictate?: (text: string) => void;
    __hermesOficinaTeam?: { say: (text: string) => boolean; debug: () => unknown };
    /** QA: prende/apaga la gente del edificio y siembra su coreografía. */
    __hermesOficinaAmbient?: (opts: { on?: boolean; seed?: number }) => void;
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

/** Modo de los agentes que contratas (localStorage: es una preferencia de este navegador). */
const OFFICE_MODE_KEY = "hermes-office-mode";
/** Interruptor "Ambiente" (prendido por defecto): preferencia de este navegador. */
const AMBIENT_KEY = "hermes-oficina-ambiente";

function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Una pregunta a un NPC: su texto y la respuesta, calculada en vivo con el estado actual. */
interface NpcQuestion {
  id: string;
  label: string;
  answer: () => NpcLine[];
}

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
  // Modo de los agentes que contratas (Auto por defecto, como Claude Code) y el
  // de cada agente al volver a hablarle, por sesión: una conversación que sigue
  // conserva el modo que le pusiste.
  const [officeMode, setOfficeModeState] = useState<AgentMode>(DEFAULT_OFFICE_MODE);
  /** Piso que se ve (0 equipos · 1 café · 2 azotea). */
  const [floor, setFloor] = useState(0);
  const [modeBySession, setModeBySession] = useState<Record<string, AgentMode>>({});
  const [sending, setSending] = useState(false);
  const [deciding, setDeciding] = useState(false);
  // Gente del edificio: interruptor, semilla (QA) y el diálogo con un NPC.
  const [ambient, setAmbientState] = useState(true);
  const [ambientSeed, setAmbientSeed] = useState<number | undefined>(undefined);
  const [npc, setNpc] = useState<OfficeNpcRole | null>(null);
  const [npcQuestion, setNpcQuestion] = useState<string | null>(null);
  const [npcFocus, setNpcFocus] = useState(0);
  const [scheduled, setScheduled] = useState<ScheduledLite[] | null>(null);
  const [pauseUntil, setPauseUntil] = useState<number | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const { snapshot } = useDashboard();
  const sceneRef = useRef<OficinaSceneHandle>(null);
  const hireRef = useRef<HireDialogHandle>(null);
  const seatsRef = useRef<Map<string, string>>(new Map());
  /** Agentes a los que les hablaste: su respuesta se lee en voz alta al terminar. */
  const talkedRef = useRef(new Set<string>());
  const selectedRef = useRef<OfficeHit | null>(null);
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  const spokenRef = useRef(new Set<string>());
  const cycleModeRef = useRef<() => void>(() => {});
  const conversationOpenRef = useRef(false);

  useEffect(() => {
    setLook(loadLook());
    setReplyVoiceState(replyVoiceEnabled());
    try {
      const saved = localStorage.getItem(OFFICE_MODE_KEY);
      if (isOfficeMode(saved)) setOfficeModeState(saved);
      if (localStorage.getItem(AMBIENT_KEY) === "off") setAmbientState(false);
    } catch {
      /* sin storage: queda Auto y el ambiente prendido */
    }
    // ?seed=N siembra la coreografía de la gente (ensayos y QA reproducibles).
    const seed = Number(new URLSearchParams(window.location.search).get("seed"));
    if (Number.isInteger(seed) && seed > 0) setAmbientSeed(seed);
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
  conversationOpenRef.current = conversationOpen;

  const nearLabel = useMemo(() => {
    if (!near) return null;
    if (near.kind === "npc") return `Hablar con ${OFFICE_NPCS[near.id].name}`;
    if (near.kind === "worker") {
      const w = workers.find((x) => x.id === near.id);
      return w ? `Hablar con ${w.name}` : null;
    }
    const d = layout.desks.find((x) => x.id === near.id);
    return d ? (sim ? "Escritorio libre" : `Contratar aquí · ${projectName(d.project)}`) : null;
  }, [near, workers, layout, projectName, sim]);

  // ── Gente del edificio: Recepción, Barista y Respiro ─────────────────
  const npcOpenRef = useRef(false);
  npcOpenRef.current = !!npc;

  const openNpc = useCallback(
    (role: OfficeNpcRole) => {
      voice.cancel();
      stopSpeaking();
      setSelected(null);
      setNpc(role);
      setNpcQuestion(null);
      setNpcFocus(0);
      sceneRef.current?.world()?.setNpcTalking(role);
      // Barista: las tareas programadas se piden al abrir (una vez, sin poll). Si falla, esa pregunta no aparece.
      if (role === "barista") {
        setScheduled(null);
        hermesGet<ScheduledLite[]>("/scheduled")
          .then((t) => setScheduled(Array.isArray(t) ? t : null))
          .catch(() => setScheduled(null));
      }
    },
    [voice],
  );

  const closeNpc = useCallback(() => {
    setNpc(null);
    setNpcQuestion(null);
    sceneRef.current?.world()?.setNpcTalking(null);
  }, []);

  const setAmbient = useCallback(
    (on: boolean) => {
      setAmbientState(on);
      if (!on) closeNpc();
      try {
        localStorage.setItem(AMBIENT_KEY, on ? "on" : "off");
      } catch {
        /* modo privado: dura la visita */
      }
    },
    [closeNpc],
  );

  // La pausa de la azotea: cuenta regresiva real (y la hora que dicen los NPC).
  useEffect(() => {
    if (!pauseUntil && !npc) return;
    const id = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(id);
  }, [pauseUntil, npc]);

  const controlsLines = (padOn: boolean): NpcLine[] =>
    padOn
      ? [
          { text: "Stick izquierdo para caminar y RT para correr; el derecho mueve la cámara." },
          { text: "A habla con quien tengas al lado o contrata en un escritorio libre; X salta y B cancela." },
          { text: "Y llama por voz; LB y RB te llevan de un agente a otro; View cambia a la vista aérea." },
        ]
      : [
          { text: "W A S D para caminar, Shift para correr y Espacio para saltar; arrastra para girar la cámara." },
          { text: "E habla con quien tengas al lado o contrata en un escritorio libre." },
          { text: "V cambia a la vista aérea y 1, 2 o 3 eligen el piso desde arriba." },
        ];

  /** Lo que dice cada NPC y qué se le puede preguntar: todo calculado del estado real, en cada render. */
  const npcView = useMemo((): { greeting: NpcLine[]; questions: NpcQuestion[] } | null => {
    if (!npc) return null;
    const now = new Date(clock);
    if (npc === "reception") {
      const ctx = { connected: feed === "live", simulated: !!sim, projectName };
      return {
        greeting: receptionSummary(workers, ctx),
        questions: [
          { id: "needs_you", label: "¿Quién me necesita?", answer: () => receptionList(workers, "needs_you", ctx) },
          { id: "working", label: "¿Quién está trabajando?", answer: () => receptionList(workers, "working", ctx) },
          { id: "done", label: "¿Qué terminó?", answer: () => receptionList(workers, "done", ctx) },
        ],
      };
    }
    if (npc === "barista") {
      const questions: NpcQuestion[] = [{ id: "day", label: "¿Cómo va el día?", answer: () => baristaDay(snapshot, now) }];
      if (baristaWeather(snapshot).length) questions.push({ id: "weather", label: "¿Qué tal el clima?", answer: () => baristaWeather(snapshot) });
      if (scheduled) questions.push({ id: "scheduled", label: "¿Qué hay programado?", answer: () => baristaScheduled(scheduled, now) });
      return { greeting: baristaDay(snapshot, now), questions };
    }
    const left = pauseUntil ? pauseUntil - clock : 0;
    return {
      greeting: [{ text: pauseUntil ? `Vas en pausa: quedan ${formatCountdown(left)}.` : `Son las ${hhmm(now)}. ¿Te tomas un respiro?` }],
      questions: [
        {
          id: "pause",
          label: pauseUntil ? "Terminar la pausa" : "Pausa de 5 minutos",
          answer: () => [{ text: pauseUntil ? `Listo: quedan ${formatCountdown(left)}. Te aviso cuando se acabe.` : "Pausa terminada." }],
        },
        { id: "controls", label: "¿Cómo me muevo?", answer: () => controlsLines(usingPad) },
      ],
    };
    // controlsLines solo lee su argumento.
  }, [npc, clock, feed, sim, projectName, workers, snapshot, scheduled, pauseUntil, usingPad]);

  const npcLines = npcView ? (npcQuestion ? (npcView.questions.find((q) => q.id === npcQuestion)?.answer() ?? npcView.greeting) : npcView.greeting) : [];

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
  /**
   * Abrir una conversación = el micrófono ya escuchando (salvo en llamada con
   * Hermes, o si el agente espera tu permiso: ahí lo que toca es decidir).
   */
  const openConversation = useCallback(
    (hit: OfficeHit) => {
      setSelected(hit);
      stopSpeaking();
      const asking = hit.kind === "worker" && workers.some((w) => w.id === hit.id && w.approval);
      if (!inCall && !asking) voice.start();
    },
    [inCall, voice, workers],
  );

  const closeConversation = useCallback(() => {
    voice.cancel();
    setSelected(null);
  }, [voice]);

  /** Instrucción a un personaje: continúa su sesión si es un run; si no, trabajo nuevo en su proyecto. */
  const setOfficeMode = useCallback((mode: AgentMode) => {
    setOfficeModeState(mode);
    try {
      localStorage.setItem(OFFICE_MODE_KEY, mode);
    } catch {
      /* sin storage: solo esta visita */
    }
  }, []);

  /** Modo con que correrá lo próximo que le digas a este agente. */
  const modeFor = useCallback(
    (w: OfficeWorker): AgentMode => modeBySession[w.sessionId ?? w.id] ?? w.mode ?? officeMode,
    [modeBySession, officeMode],
  );

  const setWorkerMode = useCallback((w: OfficeWorker, mode: AgentMode) => {
    setModeBySession((prev) => ({ ...prev, [w.sessionId ?? w.id]: mode }));
  }, []);

  const instructWorker = useCallback(
    async (w: OfficeWorker, text: string): Promise<string> => {
      const cfg = { ...ws.claudeConfig, permissionMode: modeFor(w) };
      if (w.source === "run" && w.sessionId) return (await claudeStartRun(text, cfg, w.project, w.sessionId)).runId;
      if (w.project === GENERAL_PROJECT) return (await hermesPost<{ task_id?: string }>("/tasks", { prompt: text })).task_id ?? "";
      return (await claudeStartRun(text, cfg, w.project)).runId;
    },
    [ws.claudeConfig, modeFor],
  );

  const hireAgent = useCallback(
    async (project: string, text: string): Promise<string> => {
      if (project === GENERAL_PROJECT) return (await hermesPost<{ task_id?: string }>("/tasks", { prompt: text })).task_id ?? "";
      return (await claudeStartRun(text, { ...ws.claudeConfig, permissionMode: officeMode }, project)).runId;
    },
    [ws.claudeConfig, officeMode],
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

  // Tu decisión sobre el permiso que pide un agente: el run sigue (o cambia de
  // plan) apenas llega. En simulación solo se baja la mano en pantalla.
  const decideApproval = useCallback(
    async (w: OfficeWorker, allow: boolean) => {
      const a = w.approval;
      if (!a || deciding) return;
      if (sim) {
        setSim((prev) =>
          prev && {
            ...prev,
            workers: prev.workers.map((x) =>
              x.id === w.id
                ? {
                    ...x,
                    approval: undefined,
                    status: "working",
                    mode: allow && a.tool === PLAN_TOOL ? "auto" : x.mode,
                    task: { ...x.task, summary: allow ? "aprobado por ti" : "negado por ti" },
                    lines: [...x.lines, allow ? "✓ aprobado por ti" : "✗ negado por ti"],
                  }
                : x,
            ),
          },
        );
        pad.rumble(allow ? "success" : "tap");
        return;
      }
      setDeciding(true);
      const plan = a.tool === PLAN_TOOL;
      // Lo que dictaste va con tu decisión: el porqué de un "no" o qué cambiar del plan.
      const note = !allow && voice.text.trim() ? voice.text.trim() : undefined;
      const chosen = modeFor(w);
      const mode = plan ? (chosen === "plan" ? "auto" : chosen) : undefined;
      try {
        const r = await hermesPost<{ ok: boolean; error?: string }>(`/office/approvals/${encodeURIComponent(a.id)}/decide`, { allow, note, mode });
        if (!r.ok) toast("error", r.error ?? "No se pudo decidir");
        else {
          if (note) voice.cancel();
          pad.rumble(allow ? "success" : "tap");
          toast(
            allow ? "done" : "error",
            plan
              ? allow
                ? `Plan aprobado: ${w.name} lo ejecuta en ${officeModeLabel(mode ?? "auto")}`
                : `Pediste cambios al plan de ${w.name}`
              : `${allow ? "Aprobado" : "Negado"}: ${a.summary}`,
          );
        }
      } catch (err) {
        toast("error", `No se pudo decidir: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setDeciding(false);
      }
      // `pad` se declara abajo (su rumble lee el control al llamarse).
    },
    [sim, deciding, toast, voice, modeFor],
  );

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

  /** Shift+Tab / View: el siguiente modo del agente abierto (o del que vas a contratar). */
  const cycleMode = () => {
    if (hiring) setOfficeMode(nextOfficeMode(officeMode));
    else if (selectedWorker?.source === "run") setWorkerMode(selectedWorker, nextOfficeMode(modeFor(selectedWorker)));
  };
  cycleModeRef.current = cycleMode;

  const onPadPress = (b: PadButton) => {
    markPad(true);
    const world = sceneRef.current?.world();
    if (helpOpen) {
      if (b === "B" || b === "MENU" || b === "A") setHelpOpen(false);
      return;
    }
    // Diálogo con un NPC: la cruceta recorre las preguntas, A elige, B cierra.
    if (npcOpenRef.current) {
      const n = npcCountRef.current;
      if (b === "B") closeNpc();
      else if (b === "A") pickNpcRef.current(npcFocusRef.current);
      else if ((b === "UP" || b === "DOWN") && n) setNpcFocus((f) => (f + (b === "UP" ? n - 1 : 1)) % n);
      return;
    }
    // Un agente con la mano levantada: A aprueba, B niega (antes que la voz).
    if (conversationOpen && selectedWorker?.approval && (b === "A" || b === "B")) {
      void decideApproval(selectedWorker, b === "A");
      return;
    }
    if (conversationOpen && b === "VIEW") {
      cycleMode();
      pad.rumble("tap");
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
      // Con un NPC abierto la cruceta es del diálogo, no del zoom.
      zoom: npcOpenRef.current ? 0 : s.held.has("UP") ? -1 : s.held.has("DOWN") ? 1 : 0,
    });
  };

  const pad = useGamepad({ onFrame: onPadFrame, onPress: onPadPress });

  /** Elegir una pregunta del NPC: la respuesta queda en vivo y, si "Respuestas" está prendido, se lee. */
  const pickNpc = (i: number) => {
    const q = npcView?.questions[i];
    if (!q) return;
    setNpcFocus(i);
    setNpcQuestion(q.id);
    pad.rumble("tap");
    let say = q.answer().map((l) => l.text).join(" ");
    if (q.id === "pause") {
      const until = pauseUntil ? null : Date.now() + ROOFTOP_PAUSE_MS;
      setPauseUntil(until);
      setClock(Date.now());
      say = until ? "Listo, cinco minutos. Te aviso cuando se acabe." : "Pausa terminada.";
    }
    if (replyVoice && !inCall) speak(say);
  };
  const pickNpcRef = useRef(pickNpc);
  pickNpcRef.current = pickNpc;
  const npcCountRef = useRef(0);
  npcCountRef.current = npcView?.questions.length ?? 0;
  const npcFocusRef = useRef(0);
  npcFocusRef.current = npcFocus;

  // Fin de la pausa: aviso, vibración y (si las respuestas en voz están prendidas) lo dice.
  useEffect(() => {
    if (!pauseUntil || clock < pauseUntil) return;
    setPauseUntil(null);
    toast("done", "☕ Se acabó la pausa");
    pad.rumble("success");
    if (replyVoice && !inCall) speak("Se acabó la pausa. A seguir.");
    // pad.rumble lee el control al llamarse.
  }, [clock, pauseUntil, toast, replyVoice, inCall]);

  useEffect(() => {
    if (selected && npc) closeNpc();
  }, [selected, npc, closeNpc]);

  // ── Avisos: quién llega y quién termina (no al cargar ni en simulación) ──
  const prevRef = useRef<Map<string, OfficeWorker["status"]> | null>(null);
  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = new Map(workers.map((w) => [w.id, w.status]));
    if (!prev || sim || snapshots === 0) return;
    for (const w of workers) {
      const was = prev.get(w.id);
      if (!was && !w.continues) toast("start", `${w.name} llegó a ${projectName(w.project)}`);
      if (w.status === "needs_you" && was !== "needs_you") {
        // Te necesita: aviso, y el control vibra aunque estés en otra parte del piso.
        toast("start", `✋ ${w.name} te pide permiso: ${w.approval?.summary ?? ""}`);
        pad.rumble("alert");
      } else if (was && was !== w.status && !talkedRef.current.has(w.id)) {
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
        closeNpc();
        return;
      }
      if (hit.kind === "npc") openNpc(hit.id);
      else openConversation(hit);
      sceneRef.current?.world()?.focus(hit);
    },
    [openConversation, closeConversation, openNpc, closeNpc],
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
      // Diálogo con un NPC: 1-3 o ↑↓ + Enter eligen, Esc cierra.
      if (npcOpenRef.current && !isTyping(e) && !e.metaKey && !e.ctrlKey) {
        const n = npcCountRef.current;
        if (e.key === "Escape") closeNpc();
        else if (/^Digit[1-9]$/.test(e.code) && Number(e.code.slice(5)) <= n) pickNpcRef.current(Number(e.code.slice(5)) - 1);
        else if ((e.key === "ArrowUp" || e.key === "ArrowDown") && n) setNpcFocus((f) => (f + (e.key === "ArrowUp" ? n - 1 : 1)) % n);
        else if (e.key === "Enter") pickNpcRef.current(npcFocusRef.current);
        else return;
        e.preventDefault();
        return;
      }
      // Shift+Tab cambia de modo, como en Claude Code (solo con una conversación abierta).
      if (e.key === "Tab" && e.shiftKey && conversationOpenRef.current) {
        e.preventDefault();
        cycleModeRef.current();
        return;
      }
      // 1, 2, 3: ver ese piso desde arriba (fuera de una conversación y de un campo de texto).
      if (!conversationOpenRef.current && !isTyping(e) && !e.metaKey && !e.ctrlKey && /^Digit[123]$/.test(e.code)) {
        sceneRef.current?.world()?.setFloorView(Number(e.code.slice(5)) - 1);
        return;
      }
      if (e.key !== "Escape") return;
      closeConversation();
      setLookOpen(false);
      setHelpOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeConversation, closeNpc]);

  const changeLook = (l: OwnerLook) => {
    setLook(l);
    saveLook(l);
  };

  // Seams de QA: simular sin tokens, leer el estado, clics reales, vista, caminar y dictar.
  const teamRef = useRef(team);
  teamRef.current = team;
  const debugRef = useRef({ workers, seats, selected, layout, near, voice, usingPad, npc });
  debugRef.current = { workers, seats, selected, layout, near, voice, usingPad, npc };
  useEffect(() => {
    window.__hermesOficinaSim = (state) => setSim(state === "demo" ? demoOfficeState(live.projects, live.machine || "sim") : state);
    window.__hermesOficinaDebug = () => {
      const d = debugRef.current;
      const world = sceneRef.current?.world();
      return {
        workers: d.workers.map((w) => ({ id: w.id, project: w.project, status: w.status, action: w.action, name: w.name, continues: w.continues, mode: w.mode })),
        seats: Object.fromEntries(d.seats),
        selected: d.selected,
        desks: d.layout.desks.length,
        freeDesks: d.layout.desks.map((x) => x.id),
        deskXZ: d.layout.desks.map((x) => [x.x, x.z]),
        pods: d.layout.pods.length,
        simulated: !!sim,
        voice: { state: d.voice.state, text: d.voice.text, engine: d.voice.engine },
        usingPad: d.usingPad,
        npcDialog: d.npc,
        ...(world?.debug() ?? { fps: 0 }),
      };
    };
    window.__hermesOficinaScreenOf = (hit) => sceneRef.current?.world()?.screenOf(hit) ?? null;
    window.__hermesOficinaFocus = (hit) => sceneRef.current?.world()?.focus(hit);
    window.__hermesOficinaMode = (m) => sceneRef.current?.world()?.setMode(m);
    window.__hermesOficinaWalkTo = (hit) => sceneRef.current?.world()?.walkTo(hit);
    window.__hermesOficinaStair = (i) => sceneRef.current?.world()?.goToStair(i) ?? false;
    window.__hermesOficinaFloor = (f) => sceneRef.current?.world()?.setFloorView(f);
    window.__hermesOficinaTeam = { say: (text: string) => teamRef.current.say(text), debug: () => teamRef.current.debug() };
    window.__hermesOficinaDictate = (text) => {
      voice.cancel();
      voice.edit(text);
    };
    window.__hermesOficinaAmbient = ({ on, seed }) => {
      if (on !== undefined) setAmbient(on);
      if (seed !== undefined) setAmbientSeed(seed);
    };
    return () => {
      delete window.__hermesOficinaSim;
      delete window.__hermesOficinaDebug;
      delete window.__hermesOficinaScreenOf;
      delete window.__hermesOficinaFocus;
      delete window.__hermesOficinaMode;
      delete window.__hermesOficinaWalkTo;
      delete window.__hermesOficinaStair;
      delete window.__hermesOficinaFloor;
      delete window.__hermesOficinaDictate;
      delete window.__hermesOficinaTeam;
      delete window.__hermesOficinaAmbient;
    };
  }, [live.projects, live.machine, sim, voice, setAmbient]);

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
        nearLabel={npc ? null : nearLabel}
        nearKey={pad.connected && usingPad ? "A" : "E"}
        inputEnabled={!hiring && !npc}
        onClick={onClick}
        onNear={setNear}
        onMode={setModeState}
        onFloor={setFloor}
        voices={team.voiceNames}
        speakingProbe={team.speakingWorker}
        ambient={{ on: ambient, sessions: workers.length, seed: ambientSeed }}
      />

      <div className="pointer-events-none absolute inset-x-3 top-3 z-20 flex items-start justify-between gap-3">
        <div className="flex flex-col items-start gap-2">
          <StatusCard title={title} machine={machine} feed={feed} simulated={!!sim} total={workers.length} tally={tally} daylight={daylight} />
          <FloorPicker floor={floor} mode={mode} onPick={(f) => sceneRef.current?.world()?.setFloorView(f)} />
          {pauseUntil ? <PauseTimer left={formatCountdown(pauseUntil - clock)} onStop={() => setPauseUntil(null)} /> : null}
        </div>
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
            ambient={ambient}
            onAmbient={() => setAmbient(!ambient)}
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
          deciding={deciding}
          onDecide={(allow) => void decideApproval(selectedWorker, allow)}
          mode={modeFor(selectedWorker)}
          onModeChange={(m) => setWorkerMode(selectedWorker, m)}
          model={ws.claudeConfig.model}
        />
      ) : null}

      {hiring && selectedDesk ? (
        <HireDialog
          ref={hireRef}
          project={selectedDesk.project}
          projects={projects}
          voice={voice}
          padConnected={pad.connected}
          mode={officeMode}
          onModeChange={setOfficeMode}
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

      {npc && npcView ? (
        <NpcDialog
          name={OFFICE_NPCS[npc].name}
          place={OFFICE_NPCS[npc].place}
          simulated={npc === "reception" && !!sim}
          lines={npcLines}
          options={npcView.questions}
          focus={Math.min(npcFocus, npcView.questions.length - 1)}
          padConnected={pad.connected && usingPad}
          onPick={pickNpc}
          onGo={(id) => {
            closeNpc();
            const hit: OfficeHit = { kind: "worker", id };
            const world = sceneRef.current?.world();
            if (world?.mode === "explore") world.walkTo(hit);
            else world?.focus(hit);
          }}
          onClose={closeNpc}
        />
      ) : null}

      {helpOpen ? <ControllerHelp label={pad.label} onClose={() => setHelpOpen(false)} /> : null}
    </main>
  );
}
