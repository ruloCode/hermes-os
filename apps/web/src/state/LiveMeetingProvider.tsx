"use client";

// Dueño de la junta EN VIVO en el browser: mic → frames PCM16 por WS al
// agente, eventos ↓ → estado (transcript, sugerencias, STT), reconexión con
// backoff, reanudación tras ⌘R (sessionStorage) y cierre → `result` que
// MeetingsPanel consume para abrir el detalle. Vive en el shell (providers.tsx)
// para que la junta sobreviva a la navegación entre vistas y tabs.

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { useConversationStatus } from "@elevenlabs/react";
import type {
  LiveAudioMode,
  LiveCoachMetrics,
  LiveMeetingSnapshot,
  LiveMeetingStatus,
  LiveSegment,
  LiveServerEvent,
  LiveSttState,
  LiveSuggestion,
  LiveSuggestionKind,
} from "@hermes/shared";
import {
  getLiveMeeting,
  liveMeetingWsUrl,
  renameLiveSpeaker,
  startLiveMeeting,
  stopLiveMeeting,
  suggestNowLive,
} from "@/lib/hermes";
import { useLiveMeetingAudio } from "@/hooks/useLiveMeetingAudio";

/**
 * Fases del CLIENTE (el `status` del server se mapea aquí):
 * idle → requesting_mic → connecting → live ⇄ reconnecting → stopping →
 * processing → (result) → idle. `error` es terminal hasta reset().
 */
export type LivePhase =
  | "idle"
  | "requesting_mic"
  | "connecting"
  | "live"
  | "reconnecting"
  | "stopping"
  | "processing"
  | "error";

export interface LiveMeetingValue {
  phase: LivePhase;
  /** Hay junta en curso (toda fase menos idle/error) — chip, guards, comandos. */
  active: boolean;
  liveId: string | null;
  /** Slug del proyecto de la junta (independiente del foco del workspace). */
  project: string | null;
  title: string | null;
  /** Epoch ms — los timers derivan localmente (sin drift). */
  startedAt: number | null;
  /** Turnos en orden de llegada; los parciales se upsertean por id. */
  segments: LiveSegment[];
  /** "A" → "Carlos" (rename en vivo; el server lo aplica al .md final). */
  speakerNames: Record<string, string>;
  /** Labels por orden de primera aparición → "Hablante N" y color estable. */
  speakerOrder: string[];
  suggestions: LiveSuggestion[];
  /** Ids descartados — solo UI, no viajan al server. */
  dismissed: ReadonlySet<string>;
  /** El loop LLM del copiloto está generando (estado real del server). */
  suggesting: boolean;
  /** Sugerencia de la capa rápida streameándose AHORA (tarjeta destacada). */
  streamingSuggestion: { id: string; kind: LiveSuggestionKind; trigger: string; text: string; atMs: number } | null;
  /** La capa rápida está activa en el server (define el modo de "Soplar ahora"). */
  fastCopilot: boolean;
  /** Label del hablante marcado como "yo" (la capa rápida no me responde a mí). */
  selfSpeaker: string | null;
  /** Modo de audio de la junta (del snapshot del server). */
  mode: LiveAudioMode | null;
  /** Remoto: ¿la pestaña compartida sigue aportando audio? (null = no aplica). */
  systemAudio: boolean | null;
  /** Métricas del coach (ratio de habla, WPM, muletillas) — del server cada 5s. */
  coachMetrics: LiveCoachMetrics | null;
  sttState: LiveSttState;
  wsConnected: boolean;
  error: string | null;
  micLevelRef: RefObject<number>;
  /** Junta cerrada e ingestada → MeetingsPanel navega y llama consumeResult(). */
  result: { project: string; meetingId: string } | null;
  /** Sube con requestStopConfirm(): la vista abre su confirmación inline. */
  stopConfirmNonce: number;

  start(opts: {
    project: string;
    title?: string;
    mode?: "presencial" | "remoto";
    languages?: ("es" | "en")[];
  }): Promise<void>;
  /** Cierre confirmado por la UI (la confirmación vive en LiveMeetingView). */
  stop(): Promise<void>;
  /** Pide abrir la confirmación de cierre (⌘K "terminar junta"): NO corta en seco. */
  requestStopConfirm(): void;
  renameSpeaker(speaker: string, name: string): void;
  /** Marca/desmarca un hablante como "yo" (toggle si ya lo era). */
  markSelf(speaker: string): void;
  /** Remoto: re-compartir la pestaña de la llamada (requiere click). */
  retrySystemAudio(): Promise<void>;
  dismissSuggestion(id: string): void;
  suggestNow(): void;
  /** MeetingsPanel ya navegó al detalle: limpia todo y vuelve a idle. */
  consumeResult(): void;
  /** Desde phase error: limpia todo y vuelve a idle. */
  reset(): void;
}

const LiveMeetingContext = createContext<LiveMeetingValue | null>(null);

const STORAGE_KEY = "hermes_live_meeting";
const MAX_SUGGESTIONS = 50;
/** Backpressure del WS: por encima se descarta el frame (hueco honesto). */
const MAX_BUFFERED_BYTES = 256_000;
/** El server manda ping cada 15 s → 20 s sin mensajes = conexión muerta. */
const WATCHDOG_MS = 20_000;

/** Nombre visible de un label del provider ("A".."J" | "UNKNOWN"). */
export function liveSpeakerName(
  label: string,
  names: Record<string, string>,
  order: string[],
): string {
  const named = names[label];
  if (named) return named;
  if (label === "UNKNOWN") return "Hablante ?";
  const idx = order.indexOf(label);
  return idx === -1 ? "Hablante ?" : `Hablante ${idx + 1}`;
}

/** mm:ss (o h:mm:ss) desde milisegundos — timers y marcas del transcript. */
export function fmtLiveClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function saveStorage(id: string): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* sin sessionStorage */
  }
}
function readStorage(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}
function clearStorage(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* noop */
  }
}

export function LiveMeetingProvider({ children }: { children: ReactNode }) {
  const audio = useLiveMeetingAudio();
  // Guard de mic compartido: no iniciar junta con la llamada de voz conectada.
  const { status: voiceStatus } = useConversationStatus();
  const voiceStatusRef = useRef(voiceStatus);
  voiceStatusRef.current = voiceStatus;

  const [phase, setPhaseState] = useState<LivePhase>("idle");
  const [liveId, setLiveIdState] = useState<string | null>(null);
  const [project, setProjectState] = useState<string | null>(null);
  const [title, setTitleState] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [segments, setSegments] = useState<LiveSegment[]>([]);
  const [speakerNames, setSpeakerNames] = useState<Record<string, string>>({});
  const [suggestions, setSuggestions] = useState<LiveSuggestion[]>([]);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const [suggesting, setSuggesting] = useState(false);
  const [streamingSuggestion, setStreamingSuggestion] = useState<
    LiveMeetingValue["streamingSuggestion"]
  >(null);
  const [fastCopilot, setFastCopilot] = useState(false);
  const [selfSpeaker, setSelfSpeaker] = useState<string | null>(null);
  const [mode, setMode] = useState<LiveAudioMode | null>(null);
  const [systemAudio, setSystemAudio] = useState<boolean | null>(null);
  const [coachMetrics, setCoachMetrics] = useState<LiveCoachMetrics | null>(null);
  const [sttState, setSttState] = useState<LiveSttState>("connected");
  const [wsConnected, setWsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ project: string; meetingId: string } | null>(null);
  const [stopConfirmNonce, setStopConfirmNonce] = useState(0);

  // Espejos mutables para los handlers del WS/timers (evitan closures viejos).
  const phaseRef = useRef<LivePhase>("idle");
  const liveIdRef = useRef<string | null>(null);
  const projectRef = useRef<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const doneRef = useRef(false);
  const aliveRef = useRef(true);

  function setPhase(p: LivePhase): void {
    phaseRef.current = p;
    setPhaseState(p);
  }

  // ── Timers/WS ─────────────────────────────────────────────────────────
  function clearReconnect(): void {
    if (retryRef.current) {
      clearTimeout(retryRef.current);
      retryRef.current = null;
    }
  }
  function clearWatchdog(): void {
    if (watchdogRef.current) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  }
  function stopDonePoll(): void {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }
  function closeWs(): void {
    const ws = wsRef.current;
    wsRef.current = null;
    if (!ws) return;
    ws.onopen = null;
    ws.onmessage = null;
    ws.onclose = null;
    ws.onerror = null;
    try {
      ws.close();
    } catch {
      /* ya cerrado */
    }
  }

  // ── Estado desde snapshots/eventos del server ─────────────────────────
  function applySnapshot(snap: LiveMeetingSnapshot): void {
    liveIdRef.current = snap.id;
    projectRef.current = snap.project;
    setLiveIdState(snap.id);
    setProjectState(snap.project);
    setTitleState(snap.title ?? null);
    const started = Date.parse(snap.startedAt);
    setStartedAt(Number.isFinite(started) ? started : Date.now());
    setSegments(snap.segments);
    setSpeakerNames(snap.speakerNames);
    setSuggestions(snap.suggestions.slice(-MAX_SUGGESTIONS));
    setSuggesting(snap.suggesting);
    // El replay no retoma un stream a medias: la tarjeta streaming se limpia
    // (si la sugerencia terminó, viene completa en snap.suggestions).
    setStreamingSuggestion(null);
    setFastCopilot(Boolean(snap.fastCopilot));
    setSelfSpeaker(snap.selfSpeaker ?? null);
    setMode(snap.mode ?? "presencial");
    setSttState(snap.sttState);
  }

  function upsertSegment(seg: LiveSegment): void {
    setSegments((prev) => {
      // Camino rápido: los parciales casi siempre pisan el último turno.
      const last = prev.length - 1;
      if (last >= 0 && prev[last].id === seg.id) {
        const next = prev.slice();
        next[last] = seg;
        return next;
      }
      const i = prev.findIndex((s) => s.id === seg.id);
      if (i === -1) return [...prev, seg];
      const next = prev.slice();
      next[i] = seg;
      return next;
    });
  }

  /** Junta cerrada e ingestada: teardown + result (idempotente vía doneRef). */
  function handleDone(meetingId: string | null): void {
    if (doneRef.current) return;
    if (!meetingId) {
      // done sin id (no debería pasar): el poll de cierre lo rescata.
      setPhase("processing");
      startDonePoll();
      return;
    }
    doneRef.current = true;
    clearReconnect();
    clearWatchdog();
    stopDonePoll();
    closeWs();
    audio.stop();
    clearStorage();
    setWsConnected(false);
    setPhase("processing");
    setResult({ project: projectRef.current ?? "", meetingId });
  }

  /** Error terminal: suelta todo y deja el mensaje para la vista. */
  function failFatal(message: string): void {
    clearReconnect();
    clearWatchdog();
    stopDonePoll();
    closeWs();
    audio.stop();
    clearStorage();
    setWsConnected(false);
    setError(message);
    setPhase("error");
  }

  /** Mapea el status del server a la fase del cliente. */
  function syncServerStatus(status: LiveMeetingStatus, snap?: LiveMeetingSnapshot): void {
    switch (status) {
      case "connecting":
      case "live": {
        const p = phaseRef.current;
        // No degradar un cierre en vuelo (nuestro REST stop pudo cruzarse).
        if (p === "connecting" || p === "reconnecting" || p === "live") setPhase("live");
        break;
      }
      case "stopping":
      case "ingesting":
        // El server ya está cerrando (stop nuestro o auto-stop por timeout).
        audio.stop();
        setPhase("processing");
        startDonePoll();
        break;
      case "done":
        handleDone(snap?.meetingId ?? null);
        break;
      case "error":
        failFatal(snap?.error ?? "La junta terminó con error en el agente.");
        break;
    }
  }

  function handleServerEvent(ev: LiveServerEvent): void {
    switch (ev.type) {
      case "hello":
        // Replay al (re)conectar: el server es la fuente de verdad. Recién
        // aquí la conexión cuenta como sana → se resetea el backoff.
        attemptRef.current = 0;
        setError(null);
        applySnapshot(ev.session);
        syncServerStatus(ev.session.status, ev.session);
        break;
      case "status":
        syncServerStatus(ev.status);
        break;
      case "suggesting":
        setSuggesting(ev.inFlight);
        break;
      case "transcript_partial":
      case "transcript_final":
        upsertSegment(ev.segment);
        break;
      case "speakers_renamed":
        setSpeakerNames(ev.speakerNames);
        break;
      case "speaker_revision": {
        const map = new Map(ev.changes.map((c) => [c.segmentId, c.speaker]));
        setSegments((prev) =>
          prev.map((s) => {
            const speaker = map.get(s.id);
            return speaker ? { ...s, speaker } : s;
          }),
        );
        break;
      }
      case "suggestion":
        setSuggestions((prev) => [...prev, ev.suggestion].slice(-MAX_SUGGESTIONS));
        break;
      // Capa rápida: la sugerencia llega streameada a la tarjeta destacada.
      case "suggestion_start":
        setFastCopilot(true); // llegó un stream = la capa está viva
        setStreamingSuggestion({ id: ev.id, kind: ev.kind, trigger: ev.trigger, text: "", atMs: ev.atMs });
        break;
      case "suggestion_delta":
        setStreamingSuggestion((prev) =>
          prev && prev.id === ev.id ? { ...prev, text: prev.text + ev.text } : prev,
        );
        break;
      case "suggestion_done":
        setSuggestions((prev) => [...prev, ev.suggestion].slice(-MAX_SUGGESTIONS));
        setStreamingSuggestion((prev) => (prev && prev.id === ev.suggestion.id ? null : prev));
        break;
      case "suggestion_aborted":
        setStreamingSuggestion((prev) => (prev && prev.id === ev.id ? null : prev));
        break;
      case "self_marked":
        setSelfSpeaker(ev.speaker ?? null);
        break;
      case "coach_metrics":
        setCoachMetrics(ev.metrics);
        break;
      case "stt_status":
        setSttState(ev.state);
        break;
      case "stop_ack":
        if (phaseRef.current === "live" || phaseRef.current === "reconnecting") {
          setPhase("stopping");
        }
        break;
      case "done":
        handleDone(ev.meetingId);
        break;
      case "error":
        if (ev.fatal) failFatal(ev.message);
        else setError(ev.message);
        break;
      case "ping":
        // Solo alimenta el watchdog (se rearma con CUALQUIER mensaje).
        break;
    }
  }

  // ── WS: conexión + reconexión exponencial + watchdog ──────────────────
  function armWatchdog(id: string): void {
    clearWatchdog();
    watchdogRef.current = setTimeout(() => {
      // Nada en 20 s con el server pingueando cada 15 s: conexión zombie.
      const ws = wsRef.current;
      if (ws) {
        try {
          ws.close();
        } catch {
          /* noop */
        }
      } else if (aliveRef.current) {
        scheduleReconnect(id);
      }
    }, WATCHDOG_MS);
  }

  function scheduleReconnect(id: string): void {
    if (retryRef.current) return;
    const attempt = attemptRef.current++;
    const delay = Math.min(8000, 500 * 2 ** Math.min(attempt, 4)); // 0.5s → 8s, infinita
    retryRef.current = setTimeout(() => {
      retryRef.current = null;
      const p = phaseRef.current;
      if (!aliveRef.current || p === "idle" || p === "error" || doneRef.current) return;
      connectWs(id);
    }, delay);
  }

  function connectWs(id: string): void {
    closeWs();
    let ws: WebSocket;
    try {
      ws = new WebSocket(liveMeetingWsUrl(id));
    } catch {
      scheduleReconnect(id);
      return;
    }
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;
    ws.onopen = () => {
      // OJO: el backoff NO se resetea aquí sino al recibir el primer `hello`
      // — un server que acepta el upgrade y cierra en seco no debe reiniciarlo.
      setWsConnected(true);
      armWatchdog(id); // el hello del server llega enseguida
    };
    ws.onmessage = (ev: MessageEvent) => {
      armWatchdog(id);
      if (typeof ev.data !== "string") return; // la bajada es siempre JSON
      let parsed: LiveServerEvent;
      try {
        parsed = JSON.parse(ev.data) as LiveServerEvent;
      } catch {
        return;
      }
      handleServerEvent(parsed);
    };
    ws.onclose = (ev: CloseEvent) => {
      if (wsRef.current !== ws) return; // lo desplazó una conexión nueva
      wsRef.current = null;
      setWsConnected(false);
      clearWatchdog();
      const p = phaseRef.current;
      if (!aliveRef.current || p === "idle" || p === "error" || doneRef.current) return;
      if (p === "processing") {
        // El done vendrá por el poll de cierre; no reconectamos el WS.
        startDonePoll();
        return;
      }
      // 4000-4999 = cierre DELIBERADO de la aplicación (el server aceptó el
      // upgrade y decidió cortar): reconectar sería un bucle infinito.
      if (ev.code >= 4000 && ev.code <= 4999) {
        if (ev.code === 4001) {
          // Otra pestaña tomó la junta: rendirse aquí SIN tocar la sesión del
          // server ni el storage — la pestaña nueva es ahora la dueña del mic.
          clearReconnect();
          audio.stop();
          setError("La junta se abrió en otra pestaña.");
          setPhase("error");
          return;
        }
        // 4404: el agente ya no tiene la sesión (reinició; el recover la
        // ingesta como reunión). Otros códigos → error genérico sin bucle.
        failFatal(
          ev.code === 4404
            ? "La junta se perdió en el agente (¿reinició?). El transcript se guardó como reunión — revisa el historial."
            : "El agente cerró la conexión de la junta.",
        );
        return;
      }
      if (p !== "stopping") setPhase("reconnecting");
      scheduleReconnect(id);
    };
    ws.onerror = () => {
      try {
        ws.close();
      } catch {
        /* noop */
      }
    };
  }

  /** El worklet entrega un frame: al WS si está sano; si no, se descarta
   *  (reenviar audio viejo desalinea timestamps — el hueco queda honesto). */
  function handleFrame(frame: ArrayBuffer): void {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN && ws.bufferedAmount < MAX_BUFFERED_BYTES) {
      ws.send(frame);
    }
  }

  // ── Poll de cierre (fallback del `done` por WS, misma cadencia que
  //    trackJob de MeetingsPanel: 2 s con tolerancia a 404 transitorios) ──
  function startDonePoll(): void {
    if (pollRef.current || doneRef.current) return;
    let ticks = 0;
    let misses = 0;
    pollRef.current = setInterval(async () => {
      const id = liveIdRef.current;
      if (!id || doneRef.current || !aliveRef.current) {
        stopDonePoll();
        return;
      }
      ticks += 1;
      if (ticks > 180) {
        // ~6 min: corta; la ingesta puede completarse igual → historial.
        stopDonePoll();
        failFatal("El cierre está tardando más de lo normal. Revisa el historial en un momento.");
        return;
      }
      const snap = await getLiveMeeting(id);
      if (!snap) {
        if (++misses < 6) return; // 404/red transitorio
        stopDonePoll();
        failFatal("Perdí el rastro del cierre (¿reinició el agente?). Mira el historial en un momento.");
        return;
      }
      misses = 0;
      if (snap.status === "done" && snap.meetingId) {
        stopDonePoll();
        handleDone(snap.meetingId);
      } else if (snap.status === "error") {
        stopDonePoll();
        failFatal(snap.error ?? "La ingesta de la junta falló.");
      }
    }, 2000);
  }

  // ── Acciones ──────────────────────────────────────────────────────────
  function resetAll(): void {
    clearReconnect();
    clearWatchdog();
    stopDonePoll();
    closeWs();
    audio.stop();
    clearStorage();
    doneRef.current = false;
    attemptRef.current = 0;
    liveIdRef.current = null;
    projectRef.current = null;
    setLiveIdState(null);
    setProjectState(null);
    setTitleState(null);
    setStartedAt(null);
    setSegments([]);
    setSpeakerNames({});
    setSuggestions([]);
    setDismissed(new Set());
    setSuggesting(false);
    setStreamingSuggestion(null);
    setFastCopilot(false);
    setSelfSpeaker(null);
    setMode(null);
    setSystemAudio(null);
    setCoachMetrics(null);
    setSttState("connected");
    setWsConnected(false);
    setError(null);
    setResult(null);
    setPhase("idle");
  }

  async function start({
    project: slug,
    title: t,
    mode,
    languages,
  }: {
    project: string;
    title?: string;
    mode?: "presencial" | "remoto";
    languages?: ("es" | "en")[];
  }) {
    if (phaseRef.current !== "idle" && phaseRef.current !== "error") return;
    resetAll();
    if (voiceStatusRef.current === "connected" || voiceStatusRef.current === "connecting") {
      // Guard de mic (también mientras la voz negocia): mensaje explícito,
      // sin auto-cortar la llamada.
      setError("Termina la llamada de voz antes de iniciar la junta (comparten micrófono).");
      return;
    }
    // Mic PRIMERO: si no hay permiso, nunca se crea la sesión server-side.
    // En remoto también pide la pestaña (mismo gesto del click de inicio).
    setPhase("requesting_mic");
    try {
      const res = await audio.start(handleFrame, {
        mode,
        onSystemAudioEnded: () => setSystemAudio(false),
      });
      setSystemAudio(mode === "remoto" ? res.systemAudio : null);
    } catch {
      setPhase("error");
      setError("No se pudo acceder al micrófono. Revisa el permiso (requiere HTTPS fuera de localhost).");
      return;
    }
    setPhase("connecting");
    try {
      // 409 → startLiveMeeting devuelve el snapshot de la activa: se reanuda ESA.
      const snap = await startLiveMeeting({ project: slug, title: t, mode, languages });
      if (!aliveRef.current) return;
      applySnapshot(snap);
      saveStorage(snap.id);
      if (snap.status === "stopping" || snap.status === "ingesting") {
        audio.stop();
        setPhase("processing");
        startDonePoll();
      } else if (snap.status === "done" && snap.meetingId) {
        audio.stop();
        handleDone(snap.meetingId);
      } else if (snap.status === "error") {
        failFatal(snap.error ?? "La junta activa terminó con error.");
      } else {
        connectWs(snap.id); // el hello pone la fase en "live"
      }
    } catch (err) {
      audio.stop();
      setPhase("error");
      setError(
        err instanceof Error ? err.message : "No se pudo iniciar la junta. ¿Está el agente en línea?",
      );
    }
  }

  async function stop(): Promise<void> {
    const id = liveIdRef.current;
    const p = phaseRef.current;
    if (!id || (p !== "live" && p !== "reconnecting")) return;
    // Un stop desde reconnecting dejaría un reconnect programado que abriría
    // un WS extra durante "processing": mátalo (y al watchdog) desde ya.
    clearReconnect();
    clearWatchdog();
    setPhase("stopping");
    try {
      await stopLiveMeeting(id);
    } catch {
      // El agente no recibió el stop → la junta sigue viva: no soltar el mic.
      setPhase(p);
      setError("No se pudo terminar la junta. ¿Está el agente en línea?");
      // Si veníamos de reconnecting, el timer que matamos era el único camino
      // de vuelta: reprográmalo para no quedar varados sin WS.
      if (p === "reconnecting") scheduleReconnect(id);
      return;
    }
    audio.stop();
    setPhase("processing");
    startDonePoll(); // el `done` puede llegar antes por WS: handleDone es idempotente
  }

  function renameSpeaker(speaker: string, name: string): void {
    const id = liveIdRef.current;
    const clean = name.trim();
    if (!id || !clean) return;
    // Optimista: el server confirma con speakers_renamed y lo aplica al .md final.
    setSpeakerNames((prev) => ({ ...prev, [speaker]: clean }));
    void renameLiveSpeaker(id, speaker, clean).catch(() =>
      setError("No se pudo renombrar al hablante en el agente."),
    );
  }

  async function retrySystemAudio(): Promise<void> {
    const ok = await audio.enableSystemAudio();
    setSystemAudio(ok);
  }

  function markSelf(speaker: string): void {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    // Toggle: volver a marcar al mismo hablante lo desmarca.
    const next = selfSpeaker === speaker ? "" : speaker;
    setSelfSpeaker(next || null); // optimista; el server confirma con self_marked
    ws.send(JSON.stringify({ type: "mark_self", speaker: next }));
  }

  function dismissSuggestion(id: string): void {
    setDismissed((prev) => new Set(prev).add(id));
  }

  function suggestNow(): void {
    const id = liveIdRef.current;
    if (!id || phaseRef.current !== "live") return;
    // Con capa rápida el feedback es la tarjeta streaming (suggestion_start
    // llega enseguida); el flag `suggesting` es solo del loop estratégico.
    if (!fastCopilot) setSuggesting(true); // optimista; el server confirma con suggesting{inFlight}
    // 409 (false) = ya hay una tanda en vuelo: el flag ya está bien puesto.
    void suggestNowLive(id).catch(() => {
      setSuggesting(false);
      setError("No se pudo pedir la sugerencia. ¿Sigue el agente en línea?");
    });
  }

  // ── Ciclo de vida del provider ────────────────────────────────────────
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      clearReconnect();
      clearWatchdog();
      stopDonePoll();
      closeWs();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reanudación tras ⌘R: si sessionStorage apunta a una sesión que el agente
  // aún tiene, se reengancha sola (mismo id → mismo transcript vía hello).
  useEffect(() => {
    const id = readStorage();
    if (!id) return;
    let cancelled = false;
    void (async () => {
      const snap = await getLiveMeeting(id);
      if (cancelled || !aliveRef.current) return;
      if (!snap) {
        clearStorage(); // el agente ya no la tiene (reinició o expiró)
        return;
      }
      if (snap.status === "connecting" || snap.status === "live") {
        setPhase("requesting_mic");
        try {
          // Tras ⌘R no hay gesto de usuario: en remoto getDisplayMedia falla
          // y la junta reanuda solo con mic (el banner ofrece re-compartir).
          const res = await audio.start(handleFrame, {
            mode: snap.mode ?? "presencial",
            onSystemAudioEnded: () => setSystemAudio(false),
          });
          setSystemAudio((snap.mode ?? "presencial") === "remoto" ? res.systemAudio : null);
        } catch {
          // La sesión sigue viva en el agente: no borres el storage, otro
          // ⌘R con el permiso concedido puede reengancharla.
          setPhase("error");
          setError("La junta sigue viva en el agente pero no pude reabrir el micrófono.");
          return;
        }
        if (cancelled) return;
        setPhase("connecting");
        applySnapshot(snap);
        connectWs(snap.id);
      } else if (snap.status === "stopping" || snap.status === "ingesting") {
        applySnapshot(snap);
        setPhase("processing");
        startDonePoll();
      } else if (snap.status === "done" && snap.meetingId) {
        applySnapshot(snap);
        handleDone(snap.meetingId);
      } else {
        clearStorage();
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const active = phase !== "idle" && phase !== "error";

  // Aviso nativo del browser antes de cerrar la pestaña con junta en curso.
  useEffect(() => {
    if (!active) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = ""; // Chrome exige returnValue para mostrar el diálogo
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [active]);

  const speakerOrder = useMemo(() => {
    const order: string[] = [];
    for (const s of segments) {
      if (s.speaker !== "UNKNOWN" && !order.includes(s.speaker)) order.push(s.speaker);
    }
    return order;
  }, [segments]);

  const value = useMemo<LiveMeetingValue>(
    () => ({
      phase,
      active,
      liveId,
      project,
      title,
      startedAt,
      segments,
      speakerNames,
      speakerOrder,
      suggestions,
      dismissed,
      suggesting,
      streamingSuggestion,
      fastCopilot,
      selfSpeaker,
      mode,
      systemAudio,
      coachMetrics,
      sttState,
      wsConnected,
      error,
      micLevelRef: audio.levelRef,
      result,
      stopConfirmNonce,
      start,
      stop,
      requestStopConfirm: () => setStopConfirmNonce((n) => n + 1),
      renameSpeaker,
      markSelf,
      retrySystemAudio,
      dismissSuggestion,
      suggestNow,
      consumeResult: resetAll,
      reset: resetAll,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      phase,
      active,
      liveId,
      project,
      title,
      startedAt,
      segments,
      speakerNames,
      speakerOrder,
      suggestions,
      dismissed,
      suggesting,
      streamingSuggestion,
      fastCopilot,
      selfSpeaker,
      mode,
      systemAudio,
      coachMetrics,
      sttState,
      wsConnected,
      error,
      result,
      stopConfirmNonce,
    ],
  );

  return <LiveMeetingContext.Provider value={value}>{children}</LiveMeetingContext.Provider>;
}

export function useLiveMeeting(): LiveMeetingValue {
  const ctx = useContext(LiveMeetingContext);
  if (!ctx) throw new Error("useLiveMeeting requiere <LiveMeetingProvider> en el árbol");
  return ctx;
}
