/**
 * Runtime de las juntas EN VIVO (copiloto de reuniones). Una sesión vive en
 * memoria (patrón MeetingJob): recibe audio del browser por WS, lo proxya al
 * STT streaming, mantiene el transcript diarizado con nombres renombrables,
 * corre el loop de sugerencias del copiloto (Agent SDK + tool acotada) y al
 * cerrar entra al MISMO pipeline batch de siempre (ingestMeeting → resumen +
 * 2 accionables + triage).
 *
 * Decisiones que sostienen el diseño:
 * - UNA sola sesión viva global (un solo mic de la Mac y AssemblyAI factura
 *   por socket abierto): el segundo start lanza LiveConflictError.
 * - Controles por REST, WS solo para audio ↑ y push ↓ (sobreviven caídas del
 *   WS y permiten rehidratar tras reload); el WS acepta espejos JSON.
 * - Snapshot a disco cada 15 s (dotfile .live-*.json, invisible al listado):
 *   si el agente muere a mitad de junta, recoverOrphanLiveMeetings() la
 *   ingesta al próximo boot en vez de perderla.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { WSContext } from "hono/ws";
import type {
  LiveAudioMode,
  LiveClientMessage,
  LiveCoachMetrics,
  LiveMeetingSnapshot,
  LiveMeetingStatus,
  LiveSegment,
  LiveServerEvent,
  LiveSttState,
  LiveSuggestion,
  LiveSuggestionKind,
  LiveSuggestionLang,
} from "@hermes/shared";
import { env } from "../env.js";
import { emit } from "../events.js";
import { notifyMac } from "../notify.js";
import { searchKnowledge, knowledgeToText } from "../knowledge.js";
import { getProjectBriefing, readProjects } from "../vault/projects.js";
import { ingestMeeting } from "./ingest.js";
import { computeCoachMetrics } from "./live-coach.js";
import {
  buildFastSystemPrompt,
  COACH_MODES,
  createFastCopilot,
  resolveCoachMode,
  type FastCopilot,
  type FastCopilotEvent,
} from "./live-copilot.js";
import { getLiveSttProvider, type LiveSttConnection, type NormalizedTurn } from "./live-stt.js";
import { OWNER } from "../owner.js";

// ── Constantes de cadencia y umbrales ──────────────────────────────────

const TICK_MS = 5_000;
const HEARTBEAT_MS = 15_000;
const SNAPSHOT_EVERY_TICKS = 3; // 15 s
const SUGGEST_MIN_INTERVAL_MS = 20_000;
const SUGGEST_MIN_NEW_CHARS = 250;
const SUGGEST_MAX_INTERVAL_MS = 45_000;
const SUGGEST_TIMEOUT_MS = 30_000;
const TRANSCRIPT_WINDOW_CHARS = 6_000;
const KNOWLEDGE_QUERY_CHARS = 400;
const PREVIOUS_SUGGESTIONS = 8;
// Juntas abandonadas: cortar el socket (AssemblyAI factura por tiempo abierto).
const NO_CLIENTS_TIMEOUT_MS = 3 * 60_000; // tolera reloads del browser
const NO_AUDIO_TIMEOUT_MS = 10 * 60_000;
const MAX_SESSION_MS = 3 * 60 * 60_000; // cap duro (el de AAI también es 3 h)
const MIN_INGEST_CHARS = 400; // menos que esto no amerita resumen + accionables
const RETAIN_DONE_MS = 10 * 60_000; // el front alcanza a leer el resultado
// Handshake del provider STT: si no abre en este tiempo, el start falla claro
// en vez de dejar la sesión atascada en "connecting" (bloquearía todo start).
const STT_START_TIMEOUT_MS = 15_000;

// ── Estado interno de una sesión ───────────────────────────────────────

interface LiveSession {
  id: string;
  /** slug real del vault (carpeta), resuelto al start. */
  project: string;
  projectName?: string;
  title?: string;
  status: LiveMeetingStatus;
  suggesting: boolean;
  startedAt: number;
  segments: LiveSegment[];
  /** key → índice en segments (los parciales se upsertean por key). */
  segmentIndex: Map<string, number>;
  speakerNames: Record<string, string>;
  suggestions: LiveSuggestion[];
  stt: LiveSttConnection | null;
  sttName: string;
  sttState: LiveSttState;
  clients: Set<WSContext>;
  ticker: NodeJS.Timeout | null;
  heartbeat: NodeJS.Timeout | null;
  ticks: number;
  lastGenAt: number;
  charsAtLastGen: number;
  finalChars: number;
  lastAudioAt: number;
  lastClientAt: number;
  /** query() en vuelo del copiloto — se interrumpe en el stop/timeout. */
  activeQuery: { interrupt: () => Promise<unknown> } | null;
  /** Capa rápida (sesión persistente): null = desactivada o aún inicializando. */
  fastCopilot: FastCopilot | null;
  /** Label del hablante que es el dueño — la capa rápida no dispara sobre él. */
  selfSpeaker?: string;
  mode: LiveAudioMode;
  languages: string[];
  suggestionLang: LiveSuggestionLang;
  /** Key de COACH_MODES ("junta" default; hook para mock-interview futuro). */
  coachMode: string;
  /** Última foto del coach (se computa en el tick; va al ingest al cerrar). */
  coachMetrics: LiveCoachMetrics | null;
  snapshotsDisabled: boolean;
  /** Serializa las escrituras del dotfile: deleteSnapshot espera esta chain
   *  para que ningún writeFile en vuelo recree el archivo tras el unlink. */
  snapshotChain: Promise<void>;
  meetingId?: string;
  error?: string;
}

const sessions = new Map<string, LiveSession>();

/** Segundo start con una junta viva: el 409 lleva el snapshot para reanudarla. */
export class LiveConflictError extends Error {
  constructor(readonly snapshot: LiveMeetingSnapshot) {
    super("ya hay una junta en vivo");
  }
}

export class LiveNotConfiguredError extends Error {
  constructor() {
    super("Configura ASSEMBLYAI_API_KEY en el .env (o HERMES_LIVE_STT=fake para probar)");
  }
}

// ── API pública (REST + puente WS) ─────────────────────────────────────

export async function startLiveMeeting(input: {
  project: string;
  title?: string;
  maxSpeakers?: number;
  /** presencial (default) = mic de la sala · remoto = mic + pestaña de Meet. */
  mode?: LiveAudioMode;
  /** Bias de idioma del STT (default ["es"]; ["es","en"] = code-switching). */
  languages?: string[];
  suggestionLang?: LiveSuggestionLang;
  coachMode?: string;
}): Promise<LiveMeetingSnapshot> {
  // readProjects va ANTES del guard de sesión única: entre el find de activas
  // y el sessions.set no puede colarse ningún await, o dos POST start
  // concurrentes pasarían ambos el guard y abrirían DOS sockets AAI.
  const project = (await readProjects()).find(
    (p) => p.slug.toLowerCase() === input.project.toLowerCase(),
  );
  const active = [...sessions.values()].find((s) => s.status !== "done" && s.status !== "error");
  if (active) throw new LiveConflictError(toSnapshot(active));
  const provider = getLiveSttProvider();
  if (!provider) throw new LiveNotConfiguredError();
  const now = Date.now();
  const session: LiveSession = {
    id: randomUUID().slice(0, 8),
    project: project?.slug ?? input.project,
    projectName: project?.name,
    title: input.title,
    status: "connecting",
    suggesting: false,
    startedAt: now,
    segments: [],
    segmentIndex: new Map(),
    speakerNames: {},
    suggestions: [],
    stt: null,
    sttName: provider.name,
    sttState: "connected",
    clients: new Set(),
    ticker: null,
    heartbeat: null,
    ticks: 0,
    lastGenAt: now,
    charsAtLastGen: 0,
    finalChars: 0,
    lastAudioAt: now,
    lastClientAt: now,
    activeQuery: null,
    fastCopilot: null,
    mode: input.mode ?? "presencial",
    languages: input.languages?.length ? input.languages : ["es"],
    suggestionLang: input.suggestionLang ?? "auto",
    coachMode: resolveCoachMode(input.coachMode),
    coachMetrics: null,
    snapshotsDisabled: false,
    snapshotChain: Promise.resolve(),
  };
  sessions.set(session.id, session);

  let conn: LiveSttConnection;
  try {
    const startPromise = provider.start({
      sampleRate: 16000,
      languageBias: session.languages,
      maxSpeakers: input.maxSpeakers,
      onTurn: (turn) => handleTurn(session, turn),
      onSpeakerRevision: (changes) => applySpeakerRevision(session, changes),
      onStatus: (state, detail) => {
        session.sttState = state;
        broadcast(session, { type: "stt_status", state, detail });
      },
      // fatal del provider = STT rendido; la SESIÓN sigue viva (fatal:false
      // hacia el front): queda lo transcrito y el stop→ingesta funciona igual.
      onError: (message, _fatal) => {
        broadcast(session, { type: "error", message, fatal: false });
      },
    });
    // Timeout del handshake: un provider.start colgado dejaría la sesión en
    // "connecting" para siempre y bloquearía todo start nuevo. Si el timeout
    // gana el race, la conexión que llegue tarde se destruye sola para no
    // dejar un socket AAI abierto facturando.
    conn = await Promise.race([
      startPromise,
      new Promise<never>((_, reject) => {
        const timer = setTimeout(() => {
          startPromise.then((c) => c.destroy()).catch(() => undefined);
          reject(new Error(`el STT no completó el handshake en ${STT_START_TIMEOUT_MS / 1000} s`));
        }, STT_START_TIMEOUT_MS);
        void startPromise.finally(() => clearTimeout(timer)).catch(() => undefined);
      }),
    ]);
  } catch (err) {
    sessions.delete(session.id);
    throw new Error(`No se pudo conectar el STT: ${String(err).slice(0, 200)}`);
  }

  // Defensa doble tras el await: un stop (o cualquier cierre) durante el
  // handshake ya resolvió esta sesión — asignar stt/status aquí la
  // resucitaría como zombie "live" con el socket abierto.
  if (sessions.get(session.id) !== session || session.status !== "connecting") {
    conn.destroy();
    return toSnapshot(session);
  }

  session.stt = conn;
  session.status = "live";
  session.ticker = setInterval(() => void tick(session), TICK_MS);
  session.heartbeat = setInterval(
    () => broadcast(session, { type: "ping", ts: Date.now() }),
    HEARTBEAT_MS,
  );
  // La capa rápida arranca en background (briefing + knowledge + warm-up del
  // proceso CLI): no retrasa el start y si falla la junta sigue como siempre.
  void initFastCopilot(session);
  emit({
    kind: "meeting_live",
    taskId: session.id,
    detail: `🔴 junta en vivo: ${session.projectName ?? session.project}`,
  });
  return toSnapshot(session);
}

export function getLiveMeeting(id: string): LiveMeetingSnapshot | undefined {
  const s = sessions.get(id);
  return s ? toSnapshot(s) : undefined;
}

export function listLiveMeetings(): LiveMeetingSnapshot[] {
  return [...sessions.values()].map(toSnapshot);
}

export function renameSpeaker(
  id: string,
  speaker: string,
  name: string,
): LiveMeetingSnapshot | undefined {
  const s = sessions.get(id);
  if (!s) return undefined;
  const label = speaker.trim();
  if (label) {
    const clean = name.trim();
    if (clean) s.speakerNames[label] = clean;
    else delete s.speakerNames[label]; // vaciar el nombre = volver a "Hablante N"
    broadcast(s, { type: "speakers_renamed", speakerNames: { ...s.speakerNames } });
  }
  return toSnapshot(s);
}

export function requestSuggestions(id: string): {
  ok: boolean;
  reason?: "in_flight" | "not_live";
} {
  const s = sessions.get(id);
  if (!s || s.status !== "live") return { ok: false, reason: "not_live" };
  // Con capa rápida activa, "Soplar ahora" responde en segundos por esa vía
  // (streaming); el loop estratégico sigue con su cadencia propia.
  if (s.fastCopilot) {
    s.fastCopilot.triggerNow();
    return { ok: true };
  }
  if (s.suggesting) return { ok: false, reason: "in_flight" };
  void generateSuggestions(s, true);
  return { ok: true };
}

/** Marca qué hablante es el dueño (vacío = desmarcar). La capa rápida no le responde a él. */
export function markSelf(id: string, speaker: string): LiveMeetingSnapshot | undefined {
  const s = sessions.get(id);
  if (!s) return undefined;
  s.selfSpeaker = speaker.trim() || undefined;
  broadcast(s, { type: "self_marked", speaker: s.selfSpeaker });
  return toSnapshot(s);
}

/** Resuelve al entrar a "ingesting"; la ingesta sigue async (fin por WS done / polling). */
export async function stopLiveMeeting(id: string): Promise<LiveMeetingSnapshot | undefined> {
  const s = sessions.get(id);
  if (!s) return undefined;
  if (s.status !== "connecting" && s.status !== "live") return toSnapshot(s); // idempotente
  s.status = "stopping";
  broadcast(s, { type: "stop_ack" });
  broadcast(s, { type: "status", status: "stopping" });

  // Una generación in-flight ya no aporta y puede colgar el cierre 30 s.
  if (s.activeQuery) void s.activeQuery.interrupt().catch(() => undefined);
  // La capa rápida muere aquí: ni los Turns del drain ni el cierre disparan soplos.
  s.fastCopilot?.destroy();
  s.fastCopilot = null;

  // Drena el STT: Terminate flushea los Turns finales y la SpeakerRevision
  // retroactiva (mejora la diarización del .md gratis).
  try {
    await s.stt?.finish();
  } catch (err) {
    console.error("[live] finish STT:", String(err).slice(0, 200));
  }
  s.stt = null;

  // La cola parcial es lo último dicho: se promueve si tiene texto.
  for (let i = 0; i < s.segments.length; i++) {
    const seg = s.segments[i];
    if (!seg.final && seg.text.trim()) {
      s.segments[i] = { ...seg, final: true };
      s.finalChars += seg.text.length;
      broadcast(s, { type: "transcript_final", segment: s.segments[i] });
    }
  }

  // Junta demasiado corta: no hay nada que resumir ni acta que generar, así
  // que ni entramos a la ingesta (que fallaría con un error críptico y un
  // dotfile huérfano). Verificado en apps/web/src/state/LiveMeetingProvider.tsx:
  // el front NO resuelve un "done" sin meetingId (ni por evento status ni por
  // done con id vacío) — su poll de cierre solo acepta done+meetingId y se
  // quedaría ~6 min en "processing" antes de un failFatal genérico. La única
  // señal terminal inmediata sin tocar apps/web es el mismo patrón del
  // auto-cierre: error{fatal} con mensaje claro y limpieza SIN dotfile.
  if (s.finalChars < MIN_INGEST_CHARS) {
    failSession(s, "junta demasiado corta — no se generó acta", { keepSnapshotFile: false });
    return toSnapshot(s);
  }

  s.status = "ingesting";
  broadcast(s, { type: "status", status: "ingesting" });
  void writeSnapshot(s);
  void ingestSession(s);
  return toSnapshot(s);
}

/** false = sesión inexistente (el caller cierra el WS con 4404). */
export function attachClient(id: string, ws: WSContext): boolean {
  const s = sessions.get(id);
  if (!s) return false;
  // Un solo dueño del mic: la conexión nueva desplaza a las anteriores (el
  // front muestra "la junta se abrió en otra pestaña" al recibir el 4001).
  for (const old of s.clients) {
    try {
      old.close(4001, "otra pestaña tomó la junta");
    } catch {
      /* ya estaba muerto */
    }
  }
  s.clients.clear();
  s.clients.add(ws);
  s.lastClientAt = Date.now();
  send(ws, { type: "hello", session: toSnapshot(s) });
  return true;
}

export function detachClient(id: string, ws: WSContext): void {
  const s = sessions.get(id);
  if (!s) return;
  s.clients.delete(ws);
  // Desde aquí corre el timeout "sin navegador": tolera reloads, corta zombies.
  if (s.clients.size === 0) s.lastClientAt = Date.now();
}

export function pushAudio(id: string, chunk: ArrayBuffer): void {
  const s = sessions.get(id);
  if (!s || s.status !== "live" || !s.stt) return;
  s.lastAudioAt = Date.now();
  s.stt.sendAudio(new Uint8Array(chunk));
}

/** Espejos JSON de los controles REST (mismo efecto, menos latencia). */
export function handleClientMessage(id: string, raw: string): void {
  let msg: LiveClientMessage;
  try {
    msg = JSON.parse(raw) as LiveClientMessage;
  } catch {
    return;
  }
  if (msg.type === "stop") void stopLiveMeeting(id);
  else if (msg.type === "rename" && typeof msg.speaker === "string" && typeof msg.name === "string")
    renameSpeaker(id, msg.speaker, msg.name);
  else if (msg.type === "suggest_now") requestSuggestions(id);
  else if (msg.type === "mark_self" && typeof msg.speaker === "string") markSelf(id, msg.speaker);
}

// ── Transcript final ───────────────────────────────────────────────────

/**
 * Fusiona segments finales consecutivos del mismo hablante en párrafos
 * `**Nombre:** texto` (formato idéntico al transcriptWithSpeakers del batch:
 * el .md de la junta en vivo queda igual al de una subida).
 */
export function buildFinalTranscript(
  segments: LiveSegment[],
  names: Record<string, string>,
): string {
  const finals = segments
    .filter((seg) => seg.final && seg.text.trim())
    .sort((a, b) => a.startMs - b.startMs);
  const order: string[] = [];
  for (const seg of finals) {
    if (seg.speaker !== "UNKNOWN" && !order.includes(seg.speaker)) order.push(seg.speaker);
  }
  const nameOf = (label: string): string => {
    const custom = names[label]?.trim();
    if (custom) return custom;
    if (label === "UNKNOWN") return "Hablante ?";
    const i = order.indexOf(label);
    return `Hablante ${i === -1 ? "?" : i + 1}`;
  };
  const merged: { speaker: string; text: string }[] = [];
  for (const seg of finals) {
    const last = merged[merged.length - 1];
    if (last && last.speaker === seg.speaker) last.text += ` ${seg.text.trim()}`;
    else merged.push({ speaker: seg.speaker, text: seg.text.trim() });
  }
  return merged.map((t) => `**${nameOf(t.speaker)}:** ${t.text}`).join("\n\n");
}

// ── Turnos del STT ─────────────────────────────────────────────────────

function handleTurn(s: LiveSession, turn: NormalizedTurn): void {
  // "stopping" también acepta: son los Turns que flushea el Terminate.
  if (s.status !== "live" && s.status !== "stopping") return;
  const seg: LiveSegment = {
    id: turn.key,
    speaker: turn.speaker,
    text: turn.text,
    startMs: turn.startMs,
    endMs: turn.endMs,
    final: turn.final,
  };
  const idx = s.segmentIndex.get(turn.key);
  const wasFinal = idx != null && s.segments[idx].final;
  if (idx != null) s.segments[idx] = seg;
  else {
    s.segmentIndex.set(turn.key, s.segments.length);
    s.segments.push(seg);
  }
  if (turn.final && !wasFinal) {
    s.finalChars += turn.text.length;
    void writeSnapshot(s); // cada final también persiste (json chico, barato)
  }
  broadcast(s, { type: turn.final ? "transcript_final" : "transcript_partial", segment: seg });
  // Capa rápida: el gatillo vive en cada turno (parciales incluidos — el
  // end_of_turn crudo llega antes que el final formateado). Solo en vivo:
  // los Turns que flushea el Terminate del stop ya no ameritan soplo.
  if (s.status === "live") s.fastCopilot?.onTurn(turn, s.selfSpeaker);
}

function applySpeakerRevision(
  s: LiveSession,
  changes: { turnKey: string; speaker: string }[],
): void {
  const applied: { segmentId: string; speaker: string }[] = [];
  for (const ch of changes) {
    const idx = s.segmentIndex.get(ch.turnKey);
    if (idx == null || s.segments[idx].speaker === ch.speaker) continue;
    s.segments[idx] = { ...s.segments[idx], speaker: ch.speaker };
    applied.push({ segmentId: ch.turnKey, speaker: ch.speaker });
  }
  if (applied.length) broadcast(s, { type: "speaker_revision", changes: applied });
}

// ── Ticker: sugerencias + abandono + snapshot ──────────────────────────

async function tick(s: LiveSession): Promise<void> {
  s.ticks += 1;
  if (s.ticks % SNAPSHOT_EVERY_TICKS === 0) void writeSnapshot(s);
  if (s.status !== "live") return;

  const now = Date.now();
  const noClients = s.clients.size === 0 && now - s.lastClientAt > NO_CLIENTS_TIMEOUT_MS;
  const noAudio = now - s.lastAudioAt > NO_AUDIO_TIMEOUT_MS;
  const tooLong = now - s.startedAt > MAX_SESSION_MS;
  if (noClients || noAudio || tooLong) {
    const reason = tooLong
      ? "tope de 3 horas"
      : noClients
        ? "sin navegador hace 3 min"
        : "sin audio hace 10 min";
    emit({ kind: "meeting_live", taskId: s.id, detail: `⏹ auto-cierre: ${reason}` });
    if (s.finalChars >= MIN_INGEST_CHARS) {
      s.title = `${s.title ?? "Junta en vivo"} (cierre automático)`;
      void stopLiveMeeting(s.id);
    } else {
      failSession(s, `junta abandonada (${reason}) sin transcripción suficiente`, {
        keepSnapshotFile: false,
      });
    }
    return;
  }

  // Coach: métricas puras del transcript (barato; solo si hay finales).
  if (s.finalChars > 0) {
    s.coachMetrics = computeCoachMetrics(s.segments, s.selfSpeaker, now - s.startedAt);
    broadcast(s, { type: "coach_metrics", metrics: s.coachMetrics });
  }

  if (s.suggesting) return;
  const newChars = s.finalChars - s.charsAtLastGen;
  const since = now - s.lastGenAt;
  if (
    (since >= SUGGEST_MIN_INTERVAL_MS && newChars >= SUGGEST_MIN_NEW_CHARS) ||
    (since >= SUGGEST_MAX_INTERVAL_MS && newChars > 0)
  ) {
    await generateSuggestions(s, false);
  }
}

// ── Capa rápida (live-copilot.ts): pregunta detectada → respuesta streaming ──

/**
 * Construye el system prompt estático (briefing + knowledge congelados) y
 * arranca la sesión persistente. Corre en background tras el start: si falla,
 * la junta sigue exactamente como antes (solo el loop estratégico).
 */
async function initFastCopilot(s: LiveSession): Promise<void> {
  if (env.COPILOT_PROVIDER === "off") return;
  try {
    const [briefing, projects, hits] = await Promise.all([
      getProjectBriefing(s.project),
      readProjects(),
      searchKnowledge(`${s.title ?? ""} ${s.projectName ?? s.project}`.trim(), {
        project: s.project,
        limit: 4,
      }).catch(() => []),
    ]);
    // Un stop pudo llegar durante los awaits: no arrancar un proceso huérfano.
    if (s.status !== "live" || sessions.get(s.id) !== s) return;
    const project = projects.find((p) => p.slug.toLowerCase() === s.project.toLowerCase());
    const systemStatic = buildFastSystemPrompt({
      slug: s.project,
      name: project?.name ?? s.projectName,
      briefing,
      estadoActual: project?.estado_actual,
      knowledge: hits.length ? knowledgeToText(hits) : "",
      suggestionLang: s.suggestionLang,
      coachMode: s.coachMode,
    });
    s.fastCopilot = createFastCopilot({
      systemStatic,
      getWindow: () => buildRecentWindow(s),
      onEvent: (ev) => handleFastEvent(s, ev),
    });
  } catch (err) {
    console.error("[copilot] init:", String(err).slice(0, 200));
  }
}

/** Ventana para la capa rápida: últimos turnos CON parciales (lo que se está diciendo). */
function buildRecentWindow(s: LiveSession): string {
  const named = (label: string) => s.speakerNames[label]?.trim() || `Hablante ${label}`;
  const parts: string[] = [];
  for (const seg of s.segments.slice(-30)) {
    const text = seg.text.trim();
    if (!text) continue;
    parts.push(`${named(seg.speaker)}: ${text}${seg.final ? "" : " …"}`);
  }
  return parts.join("\n");
}

function handleFastEvent(s: LiveSession, ev: FastCopilotEvent): void {
  // Guard contra callbacks tardíos (stream que termina después del stop).
  if (s.status !== "live") return;
  if (ev.type === "start") {
    broadcast(s, {
      type: "suggestion_start",
      id: ev.id,
      kind: "decir",
      trigger: ev.trigger,
      atMs: Date.now() - s.startedAt,
    });
  } else if (ev.type === "delta") {
    broadcast(s, { type: "suggestion_delta", id: ev.id, text: ev.text });
  } else if (ev.type === "aborted") {
    broadcast(s, { type: "suggestion_aborted", id: ev.id });
  } else if (ev.type === "done") {
    const text = ev.text.trim();
    // "—" es la señal de silencio del modelo: este momento no ameritaba soplo.
    if (!text || text === "—") {
      console.log(`[copilot] silencio del modelo en ${ev.elapsedMs}ms (${ev.trigger.slice(0, 80)})`);
      broadcast(s, { type: "suggestion_aborted", id: ev.id });
      return;
    }
    const suggestion: LiveSuggestion = {
      id: ev.id,
      kind: "decir",
      text,
      why: ev.trigger,
      atMs: Date.now() - s.startedAt,
      manual: ev.manual || undefined,
      source: "fast",
    };
    s.suggestions.push(suggestion);
    broadcast(s, { type: "suggestion_done", suggestion });
    console.log(`[copilot] sugerencia en ${ev.elapsedMs}ms (${ev.trigger.slice(0, 80)})`);
    emit({ kind: "meeting_live", taskId: s.id, detail: `⚡ soplo rápido: ${text.slice(0, 100)}` });
  } else if (ev.type === "error") {
    console.error("[copilot]", ev.message);
  }
}

// ── Loop de sugerencias (Agent SDK + tool acotada, patrón ingest.ts) ────

async function generateSuggestions(s: LiveSession, manual: boolean): Promise<void> {
  // La bandera ES el candado anti-concurrencia (y lo que deshabilita el botón).
  s.suggesting = true;
  broadcast(s, { type: "suggesting", inFlight: true });
  try {
    const transcript = buildFinalTranscript(s.segments, s.speakerNames);
    const windowText = transcript.slice(-TRANSCRIPT_WINDOW_CHARS);
    if (!windowText.trim()) return;

    const captured: { kind: LiveSuggestionKind; text: string; why: string }[] = [];
    const recordTool = tool(
      "record_live_suggestions",
      "Registra las sugerencias del copiloto para este momento de la junta (0 a 3). Llámala UNA sola vez.",
      {
        suggestions: z
          .array(
            z.object({
              kind: z
                .enum(["decir", "preguntar", "dato", "rumbo"])
                .describe(
                  "decir=algo que conviene decir ya · preguntar=pregunta que destraba · dato=dato del contexto/historial que aporta · rumbo=la junta se desvía, cómo redirigirla.",
                ),
              text: z
                .string()
                .describe("La sugerencia, lista para decirse en voz alta (1-2 frases, en español)."),
              why: z
                .string()
                .describe("Por qué ahora, en UNA línea (se muestra pequeño bajo la tarjeta)."),
            }),
          )
          .max(3)
          .describe("0 a 3 sugerencias. Array vacío si no hay nada valioso que soplar."),
      },
      async (args) => {
        captured.push(...args.suggestions);
        return { content: [{ type: "text" as const, text: "Registrado." }] };
      },
    );
    const server = createSdkMcpServer({ name: "livecoach", version: "0.1.0", tools: [recordTool] });

    const [briefing, projects, hits] = await Promise.all([
      getProjectBriefing(s.project),
      readProjects(), // cache 60 s: gratis
      searchKnowledge(windowText.slice(-KNOWLEDGE_QUERY_CHARS), {
        project: s.project,
        limit: 4,
      }).catch(() => []),
    ]);
    // Un stop pudo llegar durante los awaits de contexto: cortar aquí antes
    // de arrancar un query que nadie va a interrumpir (activeQuery se asigna
    // recién después de crearlo).
    if (s.status !== "live") return;
    const project = projects.find((p) => p.slug.toLowerCase() === s.project.toLowerCase());
    const systemPrompt = buildCoachPrompt({
      slug: s.project,
      name: project?.name,
      briefing,
      estadoActual: project?.estado_actual,
      tareas: project?.tareas_pendientes,
      knowledge: hits.length ? knowledgeToText(hits) : "",
      previous: s.suggestions.slice(-PREVIOUS_SUGGESTIONS),
      fastLayerActive: s.fastCopilot != null,
      coachMode: s.coachMode,
    });

    // Última verificación síncrona antes de arrancar el CLI (defensa doble
    // por si se agrega otro await entre el contexto y este punto).
    if (s.status !== "live") return;
    const q = query({
      prompt: `Transcripción en vivo (ventana reciente, el final es lo que se está diciendo ahora):
"""
${windowText}
"""

Evalúa el momento actual y llama a record_live_suggestions.`,
      options: {
        cwd: env.VAULT_PATH || process.cwd(),
        systemPrompt,
        model: process.env.HERMES_MODEL || undefined,
        maxTurns: 3,
        settingSources: [],
        mcpServers: { livecoach: server },
        allowedTools: ["mcp__livecoach__record_live_suggestions"],
        permissionMode: "default",
      },
    });
    s.activeQuery = q;
    // Timeout duro: una sugerencia que llega tarde ya no es una sugerencia.
    const timer = setTimeout(() => void q.interrupt().catch(() => undefined), SUGGEST_TIMEOUT_MS);
    try {
      // Solo importa el efecto de la tool (captured): drenamos el stream.
      for await (const message of q) void message;
    } finally {
      clearTimeout(timer);
      s.activeQuery = null;
    }

    // Sin fallback JSON: si no llamó la tool, esta vuelta no sopla nada
    // (best-effort; la transcripción nunca se ve afectada).
    if (captured.length && s.status === "live") {
      const batch = captured.slice(0, 3);
      const atMs = Date.now() - s.startedAt;
      for (const c of batch) {
        const suggestion: LiveSuggestion = {
          id: randomUUID().slice(0, 8),
          kind: c.kind,
          text: c.text,
          why: c.why,
          atMs,
          manual: manual || undefined,
        };
        s.suggestions.push(suggestion);
        broadcast(s, { type: "suggestion", suggestion });
      }
      emit({
        kind: "meeting_live",
        taskId: s.id,
        detail: `💡 sugerencia [${batch[0].kind}]: ${batch[0].text.slice(0, 100)}`,
      });
    }
  } catch (err) {
    console.error("[live] sugerencias:", String(err).slice(0, 200));
  } finally {
    s.lastGenAt = Date.now();
    s.charsAtLastGen = s.finalChars;
    s.suggesting = false;
    broadcast(s, { type: "suggesting", inFlight: false });
  }
}

function buildCoachPrompt(p: {
  slug: string;
  name?: string;
  briefing?: string;
  estadoActual?: string;
  tareas?: string[];
  knowledge?: string;
  previous: LiveSuggestion[];
  /** true = la capa rápida ya cubre el "qué responder" inmediato. */
  fastLayerActive?: boolean;
  coachMode?: string;
}): string {
  const parts = [
    `# Hermes — Copiloto de junta EN VIVO

Eres **Hermes**, el AI OS de ${OWNER}. ${OWNER} está EN ESTE MOMENTO en una junta del proyecto **${p.name ?? p.slug}** (\`${p.slug}\`) y tú escuchas la transcripción en vivo. Tu único trabajo: soplarle al oído — darle de 0 a 3 sugerencias cortas, concretas y oportunas para lo que está pasando AHORA en la conversación.

Eres un coach de junta, no un acta: no resumas, no narres lo que ya pasó. Cada sugerencia debe darle a ${OWNER} una ventaja en los próximos 2 minutos de la conversación.

## Tipos de sugerencia
- \`decir\`: algo que a ${OWNER} le conviene decir ya — un compromiso que debe amarrar, una aclaración, una posición.
- \`preguntar\`: la pregunta que destraba, precisa o expone lo que quedó ambiguo o sin dueño.
- \`dato\`: un dato del proyecto o del historial que aporta al tema actual (una cifra, una decisión pasada, el estado real de algo que se está discutiendo a ciegas).
- \`rumbo\`: la junta se está desviando del objetivo o dando vueltas — cómo redirigirla en una frase.`,
  ];
  if (p.fastLayerActive)
    parts.push(
      `## División de trabajo\nOtra capa (más rápida) ya le sopla a ${OWNER} QUÉ RESPONDER cuando le preguntan algo. Tú eres la capa estratégica: prioriza \`dato\`, \`rumbo\` y \`preguntar\` — usa \`decir\` solo para compromisos/posiciones que amerite amarrar, no para responder preguntas puntuales.`,
    );
  const deepExtra = p.coachMode ? COACH_MODES[resolveCoachMode(p.coachMode)]?.deepExtra : undefined;
  if (deepExtra) parts.push(deepExtra);
  if (p.briefing?.trim()) parts.push(`## Briefing del proyecto (síguelo)\n${p.briefing.trim()}`);
  if (p.estadoActual?.trim())
    parts.push(`## Estado actual del proyecto\n${p.estadoActual.slice(0, 800)}`);
  if (p.tareas?.length)
    parts.push(
      `## Tareas ya pendientes\n${p.tareas.slice(0, 6).map((t) => `- ${t}`).join("\n")}`,
    );
  if (p.knowledge?.trim())
    parts.push(`## Conocimiento relevante del historial de Hermes\n${p.knowledge.trim()}`);
  if (p.previous.length)
    parts.push(
      `## Sugerencias que ya diste (NO las repitas ni las reformules)\n${p.previous
        .map((x) => `- [${x.kind}] ${x.text}`)
        .join("\n")}`,
    );
  parts.push(`## Reglas
- Sugerencias en español, 1-2 frases, listas para decirse en voz alta tal cual. \`why\` en una línea.
- El tema vivo es el FINAL de la transcripción: sugiere para ese momento, no para el principio.
- El silencio vale más que el ruido: si no hay nada valioso que soplar, llama la tool con \`suggestions: []\`. No inventes por llenar.
- No repitas lo que ya se dijo en la junta ni tus sugerencias previas.
- No inventes datos: cifras, fechas y decisiones solo si salen del contexto o del conocimiento de arriba.
- Máximo 3 sugerencias; normalmente 1-2. Calidad sobre cantidad.
- Responde SIEMPRE llamando a la tool \`record_live_suggestions\` UNA sola vez. No escribas texto libre.`);
  return parts.join("\n\n");
}

// ── Cierre e ingesta ───────────────────────────────────────────────────

async function ingestSession(s: LiveSession): Promise<void> {
  try {
    const transcript = buildFinalTranscript(s.segments, s.speakerNames);
    const maxEndMs = s.segments.reduce((m, seg) => Math.max(m, seg.endMs), 0);
    const meeting = await ingestMeeting({
      project: s.project,
      transcript,
      title: s.title,
      source: "live",
      sttProvider: s.sttName,
      durationSec: Math.round((maxEndMs || Date.now() - s.startedAt) / 1000),
      taskId: s.id,
      liveSuggestions: s.suggestions,
      // Foto final del coach (los Turns del drain ya entraron a segments).
      coachMetrics: s.finalChars
        ? computeCoachMetrics(s.segments, s.selfSpeaker, Date.now() - s.startedAt)
        : s.coachMetrics,
    });
    s.status = "done";
    s.meetingId = meeting.id;
    s.title = meeting.title;
    broadcast(s, { type: "status", status: "done" });
    broadcast(s, { type: "done", meetingId: meeting.id, title: meeting.title });
    notifyMac("junta en vivo", `✅ ${meeting.title}: ${meeting.actionables.length} accionables`);
    cleanupSession(s, { keepSnapshotFile: false });
  } catch (err) {
    // El snapshot queda en disco: recoverOrphanLiveMeetings() reintenta al
    // próximo boot en vez de perder la junta.
    failSession(s, `la ingesta falló: ${String(err).slice(0, 200)}`, { keepSnapshotFile: true });
    notifyMac("junta en vivo", `❌ falló: ${String(err).slice(0, 80)}`);
  }
}

function failSession(
  s: LiveSession,
  message: string,
  opts: { keepSnapshotFile: boolean },
): void {
  s.status = "error";
  s.error = message;
  broadcast(s, { type: "status", status: "error", detail: message });
  broadcast(s, { type: "error", message, fatal: true });
  emit({ kind: "error", taskId: s.id, detail: `junta en vivo: ${message}` });
  cleanupSession(s, opts);
}

function cleanupSession(s: LiveSession, opts: { keepSnapshotFile: boolean }): void {
  if (s.ticker) clearInterval(s.ticker);
  s.ticker = null;
  if (s.heartbeat) clearInterval(s.heartbeat);
  s.heartbeat = null;
  if (s.activeQuery) void s.activeQuery.interrupt().catch(() => undefined);
  s.activeQuery = null;
  s.fastCopilot?.destroy();
  s.fastCopilot = null;
  s.stt?.destroy();
  s.stt = null;
  s.snapshotsDisabled = true; // ninguna escritura tardía resucita el dotfile
  if (!opts.keepSnapshotFile) void deleteSnapshot(s);
  for (const ws of s.clients) {
    try {
      ws.close(1000, "junta terminada");
    } catch {
      /* ya estaba muerto */
    }
  }
  s.clients.clear();
  // La sesión queda legible 10 min (GET del resultado) y luego se borra.
  setTimeout(() => sessions.delete(s.id), RETAIN_DONE_MS).unref();
}

// ── Snapshot anti-reinicio + recuperación en el boot ───────────────────

function snapshotPath(s: Pick<LiveSession, "project" | "id">): string {
  // Dotfile: listMeetings solo lee *.md, así que es invisible al historial.
  return join(env.VAULT_PATH, "projects", s.project, "reuniones", `.live-${s.id}.json`);
}

async function writeSnapshot(s: LiveSession): Promise<void> {
  if (!env.VAULT_PATH || s.snapshotsDisabled) return;
  // Encadenado por sesión: serializa las escrituras entre sí y contra el
  // unlink de deleteSnapshot (un writeFile en vuelo ya no puede recrear el
  // dotfile después del borrado → sin re-ingesta duplicada al próximo boot).
  s.snapshotChain = s.snapshotChain.then(async () => {
    if (s.snapshotsDisabled) return; // el cleanup ganó la carrera en la cola
    try {
      await mkdir(join(env.VAULT_PATH, "projects", s.project, "reuniones"), { recursive: true });
      await writeFile(
        snapshotPath(s),
        JSON.stringify({ ...toSnapshot(s), sttName: s.sttName }),
        "utf8",
      );
    } catch (err) {
      console.error("[live] snapshot:", String(err).slice(0, 120));
    }
  });
  return s.snapshotChain;
}

async function deleteSnapshot(
  s: Pick<LiveSession, "project" | "id" | "snapshotChain">,
): Promise<void> {
  // Espera las escrituras en vuelo: el unlink tiene que ser lo ÚLTIMO que
  // toque el dotfile (snapshotsDisabled ya frena las escrituras nuevas).
  await s.snapshotChain.catch(() => undefined);
  try {
    await unlink(snapshotPath(s));
  } catch {
    /* nunca se escribió */
  }
}

/**
 * Al boot: ingesta las juntas que un reinicio del agente dejó huérfanas
 * (el .live-*.json es lo último que se supo de ellas). Con menos de 400
 * chars no hay nada que resumir y el dotfile solo se limpia.
 */
export async function recoverOrphanLiveMeetings(): Promise<void> {
  if (!env.VAULT_PATH) return;
  let slugs: string[] = [];
  try {
    slugs = (await readdir(join(env.VAULT_PATH, "projects"), { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return;
  }
  for (const slug of slugs) {
    const dir = join(env.VAULT_PATH, "projects", slug, "reuniones");
    let files: string[] = [];
    try {
      files = (await readdir(dir)).filter((f) => f.startsWith(".live-") && f.endsWith(".json"));
    } catch {
      continue; // el proyecto no tiene reuniones
    }
    for (const f of files) {
      const path = join(dir, f);
      try {
        const snap = JSON.parse(await readFile(path, "utf8")) as LiveMeetingSnapshot & {
          sttName?: string;
        };
        if (snap.status !== "done") {
          const transcript = buildFinalTranscript(snap.segments ?? [], snap.speakerNames ?? {});
          if (transcript.length >= MIN_INGEST_CHARS) {
            emit({
              kind: "meeting_live",
              taskId: snap.id,
              detail: `♻️ recuperando junta interrumpida: ${slug}`,
            });
            const maxEndMs = (snap.segments ?? []).reduce((m, seg) => Math.max(m, seg.endMs), 0);
            await ingestMeeting({
              project: snap.project || slug,
              transcript,
              title: `${snap.title ?? "Junta en vivo"} (interrumpida)`,
              source: "live",
              sttProvider: snap.sttName ?? null,
              durationSec: maxEndMs ? Math.round(maxEndMs / 1000) : null,
              taskId: snap.id,
              liveSuggestions: snap.suggestions ?? [],
              // El coach se recomputa del snapshot (función pura sobre segments).
              coachMetrics: snap.segments?.length
                ? computeCoachMetrics(snap.segments, snap.selfSpeaker, maxEndMs)
                : null,
            });
          }
        }
        await unlink(path); // si la ingesta lanzó, el dotfile queda para reintentar
      } catch (err) {
        console.error(`[live] recover ${f}:`, String(err).slice(0, 200));
      }
    }
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

function toSnapshot(s: LiveSession): LiveMeetingSnapshot {
  return {
    id: s.id,
    project: s.project,
    title: s.title,
    status: s.status,
    suggesting: s.suggesting,
    startedAt: new Date(s.startedAt).toISOString(),
    segments: [...s.segments],
    speakerNames: { ...s.speakerNames },
    suggestions: [...s.suggestions],
    sttState: s.sttState,
    meetingId: s.meetingId,
    error: s.error,
    mode: s.mode,
    languages: [...s.languages],
    selfSpeaker: s.selfSpeaker,
    suggestionLang: s.suggestionLang,
    fastCopilot: s.fastCopilot != null || undefined,
  };
}

function send(ws: WSContext, ev: LiveServerEvent): void {
  try {
    ws.send(JSON.stringify(ev));
  } catch {
    /* cliente roto: su close lo saca del set */
  }
}

function broadcast(s: LiveSession, ev: LiveServerEvent): void {
  const data = JSON.stringify(ev);
  for (const ws of s.clients) {
    try {
      ws.send(data);
    } catch {
      /* cliente roto: su close lo saca del set */
    }
  }
}
