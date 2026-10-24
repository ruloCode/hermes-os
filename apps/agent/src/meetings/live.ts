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
import { mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { WSContext } from "hono/ws";
import {
  CLASS_COACH_MODE,
  classSpeakerNames,
  computeClassMetrics,
  conceptKey,
  conceptText,
  conceptMentioned,
  correctionText,
  detectWeakPhrases,
  foldText,
  parseConcepts,
  parseContribution,
  parseCorrection,
  parseStrategic,
  TEAM_COACH_MODE,
  teamReviewMarkdown,
} from "@hermes/shared";
import type {
  AutoHelpMode,
  LiveAudioMode,
  LiveAudioReport,
  LiveClientKind,
  LiveClientMessage,
  LiveHelpIntent,
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
import { readProjects } from "../vault/projects.js";
import { ingestMeeting } from "./ingest.js";
import { computeCoachMetrics } from "./live-coach.js";
import {
  buildFastSystemPrompt,
  COACH_MODES,
  createFastCopilot,
  createFastEngine,
  resolveCoachMode,
  type FastCopilot,
  type FastCopilotEvent,
  type FastEngine,
} from "./live-copilot.js";
import { getLiveSttProvider, type LiveSttConnection, type NormalizedTurn } from "./live-stt.js";
import { clientsChanged, LiveClientSet, type LiveClientInfo } from "./live-clients.js";
import { recordLiveOutcome } from "./live-index.js";
import { OWNER, soulSection } from "../owner.js";
import {
  loadMeetingContext,
  meetingContextBlocks,
  type MeetingContext,
} from "./meeting-context.js";
import {
  buildTeamConceptsPrompt,
  buildTeamHelpPrompt,
  CONCEPT_ID_PREFIX,
  TEAM_HELP_KINDS,
  TeamCopilotController,
} from "./live-team.js";
import {
  buildCorrectionSystemPrompt,
  buildHelpSystemPrompt,
  ClassCompanionController,
  CORRECTION_ID_PREFIX,
} from "../english/class-companion.js";
import { ingestClass } from "../english/class-ingest.js";
import { hasReadableText, SuggestionStreamGate, type GateOut } from "./stream-gate.js";
import {
  ArticulationCoach,
  buildPolishSystemPrompt,
  POLISH_ID_PREFIX,
} from "./live-articulation.js";
import { loadCompanionKnowledge } from "../english/companion-knowledge.js";
import { isAutoHelp } from "../english/practice-companion.js";

// ── Constantes de cadencia y umbrales ──────────────────────────────────

const TICK_MS = 5_000;
const HEARTBEAT_MS = 15_000;
const SNAPSHOT_EVERY_TICKS = 3; // 15 s
const SUGGEST_MIN_INTERVAL_MS = 20_000;
const SUGGEST_MIN_NEW_CHARS = 250;
const SUGGEST_MAX_INTERVAL_MS = 45_000;
// Equipo: una ventana para aportar despierta al loop estratégico, pero no más
// seguido que esto (cada corrida es un proceso CLI aparte).
const STRATEGIC_WINDOW_FLOOR_MS = 15_000;
// RAG por corrida: si los embeddings tardan más que esto, la sugerencia sale sin él.
const KNOWLEDGE_TIMEOUT_MS = 800;
const DEEP_ID_PREFIX = "deep-";
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
  /** Conexiones WS con rol (un dueño del audio + viewers). */
  clients: LiveClientSet<WSContext>;
  /** Quién arrancó la junta (dashboard o Hermes Phone): va al acta. */
  client: LiveClientKind;
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
  /** Clase de inglés terminada → sesión de english_sessions. */
  englishSessionId?: number;
  /** Clase: qué ayuda sale sola cuando te preguntan (la elige el browser). */
  autoHelp: AutoHelpMode;
  /** Último diagnóstico del audio que mandó el browser (qué mic, cuánta voz entró). */
  audioReport?: LiveAudioReport;
  /** Equipo: conceptos ya explicados (clave plegada) — ninguno sale dos veces. */
  explained: Set<string>;
  /** Nota + tareas + actas anteriores del proyecto (local; se carga una vez al arrancar). */
  context: Promise<MeetingContext>;
  /** Loop estratégico como sesión persistente (null = desactivado → camino viejo por query()). */
  deepEngine: FastEngine | null;
  /** "Dilo más claro" sobre tus intervenciones (null = clase, apagado o sin copiloto). */
  articulation: ArticulationCoach | null;
  /** Segmentos finales que el motor estratégico ya vio (le va solo lo nuevo). */
  deepSeen: Set<string>;
  /** Epoch de la sesión del motor cuando se le mandó lo último (si cambia, va todo). */
  deepEpoch: number;
  deepSeq: number;
  deepStartedAt?: number;
  error?: string;
}

const sessions = new Map<string, LiveSession>();

/** Clase de inglés: otro controller, sin loop estratégico y otro cierre. */
const isClass = (s: Pick<LiveSession, "coachMode">) => s.coachMode === CLASS_COACH_MODE;
/** Reunión de equipo: aportar + entender en lugar del soplo de respuestas. */
const isTeam = (s: Pick<LiveSession, "coachMode">) => s.coachMode === TEAM_COACH_MODE;

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
  autoHelp?: AutoHelpMode;
  /** Quién arranca la junta (default "web"). */
  client?: LiveClientKind;
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
    clients: new LiveClientSet<WSContext>(),
    client: input.client ?? "web",
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
    autoHelp: input.autoHelp ?? "full",
    explained: new Set(),
    // En paralelo con el handshake del STT: cuando llega la primera frase ya está.
    context: loadMeetingContext(project?.slug ?? input.project),
    deepEngine: null,
    articulation: null,
    deepSeen: new Set(),
    deepEpoch: -1,
    deepSeq: 0,
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
    detail: `🔴 junta en vivo: ${session.projectName ?? session.project}${session.client === "phone" ? " (desde el teléfono)" : ""}`,
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

export function requestSuggestions(
  id: string,
  intent?: LiveHelpIntent,
): {
  ok: boolean;
  reason?: "in_flight" | "not_live";
} {
  const s = sessions.get(id);
  if (!s || s.status !== "live") return { ok: false, reason: "not_live" };
  // Con capa rápida activa, "Soplar ahora" responde en segundos por esa vía
  // (streaming); el loop estratégico sigue con su cadencia propia.
  if (s.fastCopilot) {
    s.fastCopilot.triggerNow(undefined, intent);
    return { ok: true };
  }
  // La clase nunca cae al loop estratégico (es de juntas, en español).
  if (isClass(s)) return { ok: false, reason: "not_live" };
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
  s.deepEngine?.destroy();
  s.deepEngine = null;
  s.articulation?.destroy();
  s.articulation = null;

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
    failSession(
      s,
      isClass(s)
        ? "clase demasiado corta — no se guardó la sesión"
        : "junta demasiado corta — no se generó acta",
      { keepSnapshotFile: false },
    );
    return toSnapshot(s);
  }

  s.status = "ingesting";
  broadcast(s, { type: "status", status: "ingesting" });
  void writeSnapshot(s);
  void ingestSession(s);
  return toSnapshot(s);
}

/**
 * false = sesión inexistente (el caller cierra el WS con 4404). Un `audio`
 * nuevo desplaza SOLO al audio anterior (4001: "la junta se abrió en otra
 * pestaña/dispositivo"); un `viewer` nunca desplaza a nadie.
 */
export function attachClient(
  id: string,
  ws: WSContext,
  info: LiveClientInfo = { role: "audio", client: "web" },
): boolean {
  const s = sessions.get(id);
  if (!s) return false;
  const before = s.clients.summary();
  const displaced = s.clients.add(ws, info);
  for (const old of displaced) {
    try {
      old.close(
        4001,
        info.client === "phone" ? "el teléfono tomó el audio de la junta" : "otra pestaña tomó la junta",
      );
    } catch {
      /* ya estaba muerto */
    }
  }
  s.lastClientAt = Date.now();
  send(ws, { type: "hello", session: toSnapshot(s) });
  announceClients(s, before);
  return true;
}

export function detachClient(id: string, ws: WSContext): void {
  const s = sessions.get(id);
  if (!s) return;
  const before = s.clients.summary();
  if (!s.clients.remove(ws)) return; // un desplazado ya había salido del set
  // Desde aquí corre el timeout "sin clientes" (cualquier rol): tolera
  // reloads, corta zombies.
  if (s.clients.size === 0) s.lastClientAt = Date.now();
  announceClients(s, before);
}

/** Evento `clients` solo si cambió el dueño del audio o el número de viewers. */
function announceClients(s: LiveSession, before: ReturnType<LiveClientSet<WSContext>["summary"]>): void {
  const now = s.clients.summary();
  if (!clientsChanged(before, now)) return;
  broadcast(s, { type: "clients", audioClient: now.audioClient, viewers: now.viewers });
}

/** `ws` = quien manda: solo el dueño vigente del audio alimenta el STT (un viewer se ignora). */
export function pushAudio(id: string, chunk: ArrayBuffer, ws?: WSContext): void {
  const s = sessions.get(id);
  if (!s || s.status !== "live" || !s.stt) return;
  if (ws && !s.clients.canSendAudio(ws)) return;
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
  else if (msg.type === "suggest_now") requestSuggestions(id, parseHelpIntent(msg.intent));
  else if (msg.type === "mark_self" && typeof msg.speaker === "string") markSelf(id, msg.speaker);
  else if (msg.type === "auto_help" && isAutoHelp(msg.mode)) setAutoHelp(id, msg.mode);
  else if (msg.type === "audio_report") setAudioReport(id, msg.report);
}

/** Diagnóstico del audio del browser: se loguea y va a la cabecera del transcript de la clase. */
function setAudioReport(id: string, r: unknown): void {
  const s = sessions.get(id);
  if (!s || !r || typeof r !== "object") return;
  const o = r as Record<string, unknown>;
  const frac = (x: unknown) => (typeof x === "number" && x >= 0 && x <= 1 ? x : 0);
  const report: LiveAudioReport = {
    mic: typeof o.mic === "string" ? o.mic.slice(0, 120) : "?",
    micVoice: frac(o.micVoice),
    tabVoice: frac(o.tabVoice),
    silentWarned: o.silentWarned === true,
  };
  s.audioReport = report;
  // Una línea por minuto: con esto la próxima clase se diagnostica con datos, no con suposiciones.
  console.log(
      `[audio] mic="${report.mic}" voz mic ${Math.round(report.micVoice * 100)}% · llamada ${Math.round(report.tabVoice * 100)}%${report.silentWarned ? " · AVISO mic mudo" : ""}`,
    );
}

/** Clase: cambia en caliente qué ayuda sale sola cuando te preguntan. */
export function setAutoHelp(id: string, mode: AutoHelpMode): LiveMeetingSnapshot | undefined {
  const s = sessions.get(id);
  if (!s) return undefined;
  s.autoHelp = mode;
  if (s.fastCopilot instanceof ClassCompanionController) s.fastCopilot.setAutoHelp(mode);
  return toSnapshot(s);
}

export function parseHelpIntent(v: unknown): LiveHelpIntent | undefined {
  return v === "scaffold" || v === "explain" || v === "full" || v === "question" ? v : undefined;
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
  if (s.status === "live") {
    s.fastCopilot?.onTurn(turn, s.selfSpeaker);
    s.articulation?.onTurn(turn, s.selfSpeaker);
  }
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
    s.coachMetrics = coachMetricsOf(s, now - s.startedAt);
    broadcast(s, { type: "coach_metrics", metrics: s.coachMetrics });
  }

  if (isClass(s) || s.suggesting) return;
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
  if (isClass(s)) return initClassCompanion(s);
  initArticulation(s);
  if (isTeam(s)) return initTeamCopilot(s);
  try {
    const [context, hits] = await Promise.all([
      s.context,
      searchKnowledge(`${s.title ?? ""} ${s.projectName ?? s.project}`.trim(), {
        project: s.project,
        limit: 4,
      }).catch(() => []),
    ]);
    // Un stop pudo llegar durante los awaits: no arrancar un proceso huérfano.
    if (s.status !== "live" || sessions.get(s.id) !== s) return;
    const systemStatic = buildFastSystemPrompt({
      slug: s.project,
      name: context.name ?? s.projectName,
      contextBlocks: meetingContextBlocks(context, hits.length ? knowledgeToText(hits) : ""),
      suggestionLang: s.suggestionLang,
      coachMode: s.coachMode,
    });
    s.fastCopilot = createFastCopilot({
      systemStatic,
      getWindow: () => buildRecentWindow(s),
      onEvent: (ev) => handleFastEvent(s, ev),
    });
    initDeepEngine(s, context, hits.length ? knowledgeToText(hits) : "");
  } catch (err) {
    console.error("[copilot] init:", String(err).slice(0, 200));
  }
}

/**
 * "Dilo más claro" (junta y equipo): motor en COLA que reescribe tus
 * intervenciones con el punto primero. La clase no lo usa: su corrector ya
 * corrige articulación además de gramática.
 */
function initArticulation(s: LiveSession): void {
  if (env.ARTICULATION === "off" || s.articulation) return;
  const engine = createFastEngine(buildPolishSystemPrompt(), (ev) => handleFastEvent(s, ev), {
    interrupt: false,
    maxQueue: 1,
    warmup: 'Reunión iniciada. Responde únicamente "—".',
  });
  if (!engine) return;
  s.articulation = new ArticulationCoach(engine, {
    nameOf: (label) => s.speakerNames[label]?.trim() || `Hablante ${label}`,
  });
}

/**
 * Clase de inglés: dos motores con su propio prompt — correcciones en cola
 * (sin interrumpir) y ayuda interrumpible — priorizando los errores que ya se
 * repiten en las sesiones anteriores.
 */
async function initClassCompanion(s: LiveSession): Promise<void> {
  try {
    const knowledge = await loadCompanionKnowledge();
    if (s.status !== "live" || sessions.get(s.id) !== s) return;
    const onEvent = (ev: FastCopilotEvent) => handleFastEvent(s, ev);
    const correct = createFastEngine(buildCorrectionSystemPrompt(knowledge), onEvent, {
      interrupt: false,
      maxQueue: 2,
      warmup: 'Clase iniciada. Responde únicamente "—".',
    });
    const help = createFastEngine(buildHelpSystemPrompt(knowledge), onEvent, {
      warmup: 'Clase iniciada. Responde únicamente "OK".',
    });
    if (!correct || !help) {
      correct?.destroy();
      help?.destroy();
      return;
    }
    s.fastCopilot = new ClassCompanionController(correct, help, {
      autoHelp: s.autoHelp,
      otherName: "Profe",
    });
  } catch (err) {
    console.error("[clase] init:", String(err).slice(0, 200));
  }
}

/**
 * Reunión de equipo: motor de aportes (interrumpible: la ventana más reciente
 * gana) + glosario en cola. Ambos con el proyecto, sus tareas, el historial
 * relevante y quién eres (SOUL "Quién soy") congelados al arrancar.
 */
async function initTeamCopilot(s: LiveSession): Promise<void> {
  try {
    const [context, hits] = await Promise.all([
      s.context,
      searchKnowledge(`${s.title ?? ""} ${s.projectName ?? s.project}`.trim(), {
        project: s.project,
        limit: 5,
      }).catch(() => []),
    ]);
    if (s.status !== "live" || sessions.get(s.id) !== s) return;
    const ctx = {
      slug: s.project,
      name: context.name ?? s.projectName,
      about: soulSection("Quién soy"),
      context,
      knowledge: hits.length ? knowledgeToText(hits) : "",
      suggestionLang: s.suggestionLang,
    };
    const onEvent = (ev: FastCopilotEvent) => handleFastEvent(s, ev);
    // El warm-up NO es "—": la sesión recuerda su primer turno, y uno que
    // practica el silencio dejaba callado al motor en las primeras ventanas.
    const help = createFastEngine(buildTeamHelpPrompt(ctx), onEvent, {
      model: env.COPILOT_TEAM_MODEL,
      warmup: 'Reunión iniciada; aún no hay conversación. Responde únicamente "OK".',
    });
    if (!help) return;
    // Sin glosario el aporte sigue: el concepto es un extra, no un requisito.
    const concepts = createFastEngine(buildTeamConceptsPrompt(ctx), onEvent, {
      interrupt: false,
      maxQueue: 2,
      warmup: 'Reunión iniciada; aún no hay conversación. Responde únicamente "OK".',
    });
    s.fastCopilot = new TeamCopilotController(help, concepts, {
      nameOf: (label) => s.speakerNames[label]?.trim() || `Hablante ${label}`,
      ownerNames: [OWNER, ...env.OWNER_ALIASES],
      // Cada ventana también despierta al loop estratégico (dato/rumbo con RAG
      // fresco) en vez de esperar su cadencia de 20-45 s.
      onWindow: () => kickStrategic(s),
    });
    initDeepEngine(s, context, ctx.knowledge);
  } catch (err) {
    console.error("[equipo] init:", String(err).slice(0, 200));
  }
}

/**
 * Loop estratégico como sesión persistente del Agent SDK (como la capa
 * rápida): el CLI vive toda la junta, cada corrida manda solo lo nuevo y la
 * respuesta es texto «tipo | sugerencia | por qué». Con query() + tool cada
 * corrida era un proceso nuevo más dos vueltas del modelo: 11-16 s.
 */
function initDeepEngine(s: LiveSession, context: MeetingContext, knowledge: string): void {
  if (s.status !== "live" || s.deepEngine) return;
  s.deepEngine = createFastEngine(
    buildCoachPrompt({
      slug: s.project,
      name: context.name ?? s.projectName,
      contextBlocks: meetingContextBlocks(context, knowledge),
      previous: [],
      fastLayerActive: s.fastCopilot != null,
      coachMode: s.coachMode,
      format: "text",
    }),
    (ev) => handleFastEvent(s, ev),
    {
      model: env.COPILOT_DEEP_MODEL,
      warmup: 'Junta iniciada; aún no hay conversación. Responde únicamente "OK".',
    },
  );
  console.log(`[live] estratégico persistente ${s.deepEngine ? `listo (${env.COPILOT_DEEP_MODEL})` : "apagado"}`);
}

/** Lo que el motor estratégico aún no vio (todo, si su sesión es nueva). */
function deepDelta(s: LiveSession, engine: FastEngine): string {
  const epoch = engine.epoch?.() ?? 0;
  const fresh = epoch !== s.deepEpoch;
  s.deepEpoch = epoch;
  if (fresh) s.deepSeen.clear();
  const names = displayNames(s);
  const finals = s.segments
    .filter((seg) => seg.final && seg.text.trim() && !s.deepSeen.has(seg.id))
    .sort((a, b) => a.startMs - b.startMs);
  for (const seg of finals) s.deepSeen.add(seg.id);
  const lines = finals.map(
    (seg) =>
      `${seg.speaker === s.selfSpeaker ? `${OWNER} (yo)` : names[seg.speaker]?.trim() || `Hablante ${seg.speaker}`}: ${seg.text.trim()}`,
  );
  let body = lines.join("\n");
  if (body.length > TRANSCRIPT_WINDOW_CHARS) body = body.slice(-TRANSCRIPT_WINDOW_CHARS);
  if (!body) return "(Sin líneas nuevas desde tu último mensaje.)";
  return fresh
    ? `Transcripción hasta ahora (el final es lo que se está diciendo):\n"""\n${body}\n"""`
    : `Líneas nuevas desde tu último mensaje:\n"""\n${body}\n"""`;
}

/** RAG fresco para el momento, con tope: si los embeddings no responden, se sigue sin él. */
async function momentKnowledge(s: LiveSession): Promise<string> {
  const text = s.segments
    .filter((seg) => seg.final)
    .slice(-6)
    .map((seg) => seg.text)
    .join(" ")
    .slice(-KNOWLEDGE_QUERY_CHARS);
  if (!text.trim()) return "";
  const hits = await Promise.race([
    searchKnowledge(text, { project: s.project, limit: 3 }).catch(() => []),
    new Promise<[]>((resolve) => setTimeout(() => resolve([]), KNOWLEDGE_TIMEOUT_MS).unref()),
  ]);
  return hits.length ? knowledgeToText(hits) : "";
}

/** Una corrida del loop estratégico por la sesión persistente. */
async function generateViaEngine(s: LiveSession, engine: FastEngine, manual: boolean): Promise<void> {
  s.suggesting = true;
  s.deepStartedAt = Date.now();
  broadcast(s, { type: "suggesting", inFlight: true });
  const knowledge = await momentKnowledge(s);
  if (s.status !== "live" || s.deepEngine !== engine) return finishDeep(s);
  // Lo que otras capas ya soplaron (la sesión solo recuerda lo suyo).
  const others = s.suggestions
    .filter((x) => x.source === "fast")
    .slice(-4)
    .map((x) => `- [${x.kind}] ${x.text.replace(/\n+/g, " ")}`)
    .join("\n");
  s.deepSeq += 1;
  engine.generate({
    id: `${DEEP_ID_PREFIX}${s.deepSeq}`,
    trigger: manual ? "manual" : "estratégico",
    manual,
    kind: "dato",
    prompt: [
      deepDelta(s, engine),
      knowledge ? `Conocimiento relevante para este momento:\n${knowledge}` : "",
      others ? `Ya se le sopló a ${OWNER} (no lo repitas):\n${others}` : "",
      manual
        ? `${OWNER} pidió apoyo AHORA: da al menos una sugerencia.`
        : "Evalúa el momento actual. Formato: una línea por sugerencia «tipo | sugerencia | por qué», o — si no hay nada valioso.",
    ]
      .filter(Boolean)
      .join("\n\n"),
  });
}

function finishDeep(s: LiveSession): void {
  s.lastGenAt = Date.now();
  s.charsAtLastGen = s.finalChars;
  s.suggesting = false;
  broadcast(s, { type: "suggesting", inFlight: false });
}

/** Respuesta del motor estratégico: tarjetas enteras (sin streaming), o nada. */
function handleDeepEvent(s: LiveSession, ev: FastCopilotEvent): void {
  if (ev.type === "done") {
    const items = parseStrategic(ev.text);
    const elapsed = s.deepStartedAt ? Date.now() - s.deepStartedAt : ev.elapsedMs;
    console.log(`[live] estratégico en ${elapsed}ms (modelo ${ev.elapsedMs}ms) → ${items.length} sugerencia(s)`);
    const atMs = Date.now() - s.startedAt;
    for (const it of items) {
      const suggestion: LiveSuggestion = {
        id: randomUUID().slice(0, 8),
        kind: it.kind,
        text: it.text,
        why: it.why,
        atMs,
        manual: ev.manual || undefined,
      };
      s.suggestions.push(suggestion);
      broadcast(s, { type: "suggestion", suggestion });
    }
    if (items.length)
      emit({
        kind: "meeting_live",
        taskId: s.id,
        detail: `💡 sugerencia [${items[0].kind}]: ${items[0].text.slice(0, 100)}`,
      });
    finishDeep(s);
  } else if (ev.type === "aborted") {
    finishDeep(s);
  }
}

/** Equipo: una ventana dispara el loop estratégico si está libre y pasó el piso. */
function kickStrategic(s: LiveSession): void {
  if (s.status !== "live" || s.suggesting) return;
  if (Date.now() - s.lastGenAt < STRATEGIC_WINDOW_FLOOR_MS) return;
  void generateSuggestions(s, false);
}

/** Métricas del coach; en clase: muletillas solo en inglés + métricas de speaking. */
function coachMetricsOf(s: LiveSession, atMs: number): LiveCoachMetrics {
  if (!isClass(s)) return computeCoachMetrics(s.segments, s.selfSpeaker, atMs);
  const metrics = computeCoachMetrics(s.segments, s.selfSpeaker, atMs, { fillers: "en" });
  const corrections = s.suggestions.filter((x) => x.kind === "corregir").length;
  const cls = computeClassMetrics(s.segments, s.selfSpeaker, corrections);
  return cls ? { ...metrics, class: cls } : metrics;
}

/** Nombres visibles: en clase, tú = "Yo" y el resto = "Profe" (salvo nombre puesto a mano). */
function displayNames(s: Pick<LiveSession, "coachMode" | "segments" | "selfSpeaker" | "speakerNames">) {
  return isClass(s)
    ? classSpeakerNames(s.segments, s.selfSpeaker, s.speakerNames)
    : s.speakerNames;
}

/** Ventana para la capa rápida: últimos turnos CON parciales (lo que se está diciendo). */
function buildRecentWindow(s: LiveSession): string {
  const names = displayNames(s);
  const named = (label: string) => names[label]?.trim() || `Hablante ${label}`;
  const parts: string[] = [];
  for (const seg of s.segments.slice(-30)) {
    const text = seg.text.trim();
    if (!text) continue;
    parts.push(`${named(seg.speaker)}: ${text}${seg.final ? "" : " …"}`);
  }
  return parts.join("\n");
}

const streamGates = new WeakMap<LiveSession, SuggestionStreamGate<LiveServerEvent>>();
function streamGateOf(s: LiveSession): SuggestionStreamGate<LiveServerEvent> {
  let g = streamGates.get(s);
  if (!g) streamGates.set(s, (g = new SuggestionStreamGate<LiveServerEvent>()));
  return g;
}

function emitGated(s: LiveSession, id: string, out: GateOut<LiveServerEvent>[]): void {
  for (const o of out) {
    if (o.type === "start") broadcast(s, o.start);
    else if (o.type === "delta") broadcast(s, { type: "suggestion_delta", id, text: o.text });
    else broadcast(s, { type: "suggestion_aborted", id });
  }
}

function handleFastEvent(s: LiveSession, ev: FastCopilotEvent): void {
  // Guard contra callbacks tardíos (stream que termina después del stop).
  if (s.status !== "live") return;
  // Correcciones de la clase: SIN streaming (corren en paralelo con la ayuda
  // y la UI tiene un solo carril de streaming) — llegan enteras al final.
  if ("id" in ev && ev.id.startsWith(CORRECTION_ID_PREFIX)) {
    if (ev.type === "done") handleCorrection(s, ev.id, ev.text, ev.elapsedMs, ev.trigger);
    return;
  }
  // "Dilo más claro": igual que las correcciones — entero, sin streaming.
  if ("id" in ev && ev.id.startsWith(POLISH_ID_PREFIX)) {
    if (ev.type === "done") handlePolish(s, ev.id, ev.text, ev.elapsedMs, ev.trigger);
    return;
  }
  // Loop estratégico persistente: tarjetas enteras, sin streaming.
  if ("id" in ev && ev.id.startsWith(DEEP_ID_PREFIX)) return handleDeepEvent(s, ev);
  // Conceptos de la reunión de equipo: igual, enteros y sin streaming.
  if ("id" in ev && ev.id.startsWith(CONCEPT_ID_PREFIX)) {
    if (ev.type === "done") handleConcepts(s, ev.id, ev.text, ev.elapsedMs);
    return;
  }
  // La tarjeta no se abre hasta que hay texto legible (stream-gate.ts): un
  // "—" ya no pinta "cargando…" para desaparecer a los 2 s.
  const gate = streamGateOf(s);
  if (ev.type === "start") {
    gate.start(ev.id, {
      type: "suggestion_start",
      id: ev.id,
      kind: ev.kind ?? "decir",
      trigger: ev.trigger,
      atMs: Date.now() - s.startedAt,
    });
  } else if (ev.type === "delta") {
    emitGated(s, ev.id, gate.delta(ev.id, ev.text));
  } else if (ev.type === "aborted") {
    emitGated(s, ev.id, gate.aborted(ev.id));
  } else if (ev.type === "done") {
    const text = ev.text.trim();
    const shown = gate.done(ev.id);
    // "—" es la señal de silencio del modelo: este momento no ameritaba soplo.
    if (!hasReadableText(text)) {
      console.log(`[copilot] silencio del modelo en ${ev.elapsedMs}ms (${ev.trigger.slice(0, 80)})`);
      if (shown) broadcast(s, { type: "suggestion_aborted", id: ev.id });
      return;
    }
    // Aporte de equipo: «ángulo ⏎ frase». Sin frase legible = silencio.
    const team = isTeam(s) && ev.kind && TEAM_HELP_KINDS.has(ev.kind) && ev.kind !== "entender";
    const contribution = team ? parseContribution(text) : null;
    if (team && !contribution) {
      console.log(`[equipo] silencio del modelo en ${ev.elapsedMs}ms (${ev.trigger})`);
      broadcast(s, { type: "suggestion_aborted", id: ev.id });
      return;
    }
    const suggestion: LiveSuggestion = {
      id: ev.id,
      kind: ev.kind ?? "decir",
      text: contribution?.text ?? text,
      why: ev.trigger,
      atMs: Date.now() - s.startedAt,
      manual: ev.manual || undefined,
      source: "fast",
      ...(contribution?.angle ? { angle: contribution.angle } : {}),
    };
    s.suggestions.push(suggestion);
    broadcast(s, { type: "suggestion_done", suggestion });
    console.log(`[copilot] sugerencia en ${ev.elapsedMs}ms (${ev.trigger.slice(0, 80)})`);
    // La frase de la clase nace articulada (articulationRules en el prompt): si aun así
    // trae una señal débil, queda en el log para medir si el prompt se cumple.
    if (isClass(s) && (ev.kind === "decir" || ev.kind === "andamio")) {
      const weak = detectWeakPhrases(text, "en");
      if (weak.length) console.log(`[clase] sugerencia con señal débil (${weak.map((w) => w.match).join(", ")}): ${text.slice(0, 100)}`);
    }
    emit({ kind: "meeting_live", taskId: s.id, detail: `⚡ soplo rápido: ${text.slice(0, 100)}` });
  } else if (ev.type === "error") {
    console.error("[copilot]", ev.message);
  }
}

/** Glosario de la reunión: una tarjeta por concepto nuevo (los repetidos se callan). */
function handleConcepts(s: LiveSession, id: string, raw: string, elapsedMs: number): void {
  // Solo lo que se DIJO: el modelo a veces "explica" un término que sacó del
  // contexto del proyecto y que nadie mencionó (ruido en plena reunión).
  const said = foldText(
    s.segments
      .slice(-40)
      .map((seg) => seg.text)
      .join(" "),
  );
  const fresh = parseConcepts(raw).filter(
    (c) => !s.explained.has(conceptKey(c.term)) && conceptMentioned(c.term, said),
  );
  if (!fresh.length) {
    console.log(`[equipo] sin conceptos nuevos en ${elapsedMs}ms`);
    return;
  }
  const atMs = Date.now() - s.startedAt;
  fresh.forEach((c, i) => {
    s.explained.add(conceptKey(c.term));
    const suggestion: LiveSuggestion = {
      id: `${id}-${i}`,
      kind: "entender",
      text: conceptText(c),
      why: "acaba de salir en la reunión",
      atMs,
      source: "fast",
    };
    s.suggestions.push(suggestion);
    broadcast(s, { type: "suggestion", suggestion });
  });
  console.log(`[equipo] ${fresh.length} concepto(s) en ${elapsedMs}ms: ${fresh.map((c) => c.term).join(", ")}`);
}

/** Una corrección del motor en cola: parsea «dijo → mejor | regla» o la descarta. */
function handleCorrection(
  s: LiveSession,
  id: string,
  raw: string,
  elapsedMs: number,
  said: string,
): void {
  const e = parseCorrection(raw, said);
  if (!e) {
    console.log(`[clase] sin corrección en ${elapsedMs}ms: ${raw.slice(0, 160).replace(/\n/g, " ⏎ ")}`);
    return;
  }
  const suggestion: LiveSuggestion = {
    id,
    kind: "corregir",
    text: correctionText(e),
    why: e.note_es ?? "",
    atMs: Date.now() - s.startedAt,
    source: "fast",
  };
  s.suggestions.push(suggestion);
  broadcast(s, { type: "suggestion", suggestion });
  console.log(`[clase] corrección en ${elapsedMs}ms: ${suggestion.text.slice(0, 100)}`);
}

/** Tu intervención dicha más claro: «fragmento → mejor | principio» (mismo formato que la clase). */
function handlePolish(s: LiveSession, id: string, raw: string, elapsedMs: number, said: string): void {
  const e = parseCorrection(raw, said);
  if (!e) {
    console.log(`[articulación] ya estaba claro (${elapsedMs}ms)`);
    return;
  }
  const suggestion: LiveSuggestion = {
    id,
    kind: "pulir",
    text: correctionText(e),
    why: e.note_es ?? "",
    atMs: Date.now() - s.startedAt,
    source: "fast",
  };
  s.suggestions.push(suggestion);
  broadcast(s, { type: "suggestion", suggestion });
  console.log(`[articulación] en ${elapsedMs}ms: ${suggestion.text.slice(0, 100)}`);
}

// ── Loop de sugerencias (Agent SDK + tool acotada, patrón ingest.ts) ────

async function generateSuggestions(s: LiveSession, manual: boolean): Promise<void> {
  if (s.deepEngine) return generateViaEngine(s, s.deepEngine, manual);
  // Respaldo (HERMES_COPILOT=off): una corrida de query() con tool acotada.
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

    const startedAt = Date.now();
    const [context, hits] = await Promise.all([
      s.context,
      searchKnowledge(windowText.slice(-KNOWLEDGE_QUERY_CHARS), {
        project: s.project,
        limit: 4,
      }).catch(() => []),
    ]);
    // Un stop pudo llegar durante los awaits de contexto: cortar aquí antes
    // de arrancar un query que nadie va a interrumpir (activeQuery se asigna
    // recién después de crearlo).
    if (s.status !== "live") return;
    const systemPrompt = buildCoachPrompt({
      slug: s.project,
      name: context.name,
      contextBlocks: meetingContextBlocks(context, hits.length ? knowledgeToText(hits) : ""),
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
        model: env.COPILOT_DEEP_MODEL,
        // Sin razonamiento extendido: una sugerencia que llega tarde ya no sirve.
        thinking: { type: "disabled" },
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
    console.log(
      `[live] estratégico en ${Date.now() - startedAt}ms → ${captured.length} sugerencia(s)${manual ? " (manual)" : ""}`,
    );
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
  /** Nota, tareas, actas anteriores e historial (meetingContextBlocks). */
  contextBlocks: string[];
  previous: LiveSuggestion[];
  /** true = la capa rápida ya cubre el "qué responder" inmediato. */
  fastLayerActive?: boolean;
  coachMode?: string;
  /** "text" = sesión persistente (líneas «tipo | texto | por qué») · default "tool". */
  format?: "tool" | "text";
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
  parts.push(...p.contextBlocks);
  if (p.previous.length)
    parts.push(
      `## Sugerencias que ya diste (NO las repitas ni las reformules)\n${p.previous
        .map((x) => `- [${x.kind}] ${x.text}`)
        .join("\n")}`,
    );
  const text = p.format === "text";
  parts.push(`## Reglas
- Sugerencias en español, 1-2 frases, listas para decirse en voz alta tal cual. El porqué en una línea.
- \`decir\` y \`preguntar\` siguen la articulación: el punto o la pregunta en la primera frase, verbo firme, sin pedir permiso ni disculparse, sin "pero" que borre lo anterior, sin "obviamente".
- El tema vivo es el FINAL de la transcripción: sugiere para ese momento, no para el principio.
- El silencio vale más que el ruido: si no hay nada valioso que soplar, ${text ? "responde EXACTAMENTE: —" : "llama la tool con `suggestions: []`"}. No inventes por llenar.
- No repitas lo que ya se dijo en la junta ni lo que ya se sopló.
- No inventes datos: cifras, fechas y decisiones solo si salen del contexto o del conocimiento de arriba.
- Lo más valioso suele ser la CONTINUIDAD: lo que se decidió o quedó pendiente en las reuniones anteriores y las tareas abiertas, cuando la conversación lo toca.
- Máximo 3 sugerencias; normalmente 1-2. Calidad sobre cantidad.
${
  text
    ? `- Formato: una línea por sugerencia, EXACTAMENTE «tipo | sugerencia | por qué», con tipo = decir · preguntar · dato · rumbo. Nada más (sin markdown ni preámbulo). Ejemplo literal:
dato | El 7 de octubre quedó pendiente validar el backfill antes de tocar los constraints. | están decidiendo el orden sin ese pendiente`
    : "- Responde SIEMPRE llamando a la tool `record_live_suggestions` UNA sola vez. No escribas texto libre."
}`);
  return parts.join("\n\n");
}

// ── Cierre e ingesta ───────────────────────────────────────────────────

async function ingestSession(s: LiveSession): Promise<void> {
  if (isClass(s)) return ingestClassSession(s);
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
      review: isTeam(s) ? teamReviewMarkdown(s.suggestions, s.segments, s.selfSpeaker) : undefined,
      // Foto final del coach (los Turns del drain ya entraron a segments).
      coachMetrics: s.finalChars
        ? computeCoachMetrics(s.segments, s.selfSpeaker, Date.now() - s.startedAt)
        : s.coachMetrics,
      client: s.client,
    });
    s.status = "done";
    s.meetingId = meeting.id;
    s.title = meeting.title;
    // Antes del done: el teléfono que suba el archivo completo encuentra el acta.
    await recordLiveOutcome(s.id, {
      status: "done",
      meetingId: meeting.id,
      project: meeting.project_slug,
      coachMode: s.coachMode,
      client: s.client,
    });
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

/** Clase de inglés: english_sessions + reporte, no acta de junta. */
async function ingestClassSession(s: LiveSession): Promise<void> {
  try {
    const maxEndMs = s.segments.reduce((m, seg) => Math.max(m, seg.endMs), 0);
    const session = await ingestClass({
      startedAt: new Date(s.startedAt).toISOString(),
      durationSec: Math.round((maxEndMs || Date.now() - s.startedAt) / 1000),
      transcript: buildFinalTranscript(s.segments, displayNames(s)),
      segments: s.segments,
      selfSpeaker: s.selfSpeaker,
      suggestions: s.suggestions,
      audio: s.audioReport,
    });
    s.status = "done";
    s.englishSessionId = session.id;
    // El front resuelve el cierre con done+meetingId: aquí va la sesión de inglés.
    s.meetingId = `english-${session.id}`;
    s.title = s.title ?? "Clase de inglés";
    await recordLiveOutcome(s.id, {
      status: "done",
      meetingId: s.meetingId,
      project: s.project,
      coachMode: s.coachMode,
      client: s.client,
    });
    broadcast(s, { type: "status", status: "done" });
    broadcast(s, {
      type: "done",
      meetingId: s.meetingId,
      title: s.title,
      englishSessionId: session.id,
    });
    notifyMac("clase de inglés", `✅ guardada: ${session.errors.length} correcciones al reporte`);
    cleanupSession(s, { keepSnapshotFile: false });
  } catch (err) {
    failSession(s, `no se pudo guardar la clase: ${String(err).slice(0, 200)}`, {
      keepSnapshotFile: true,
    });
    notifyMac("clase de inglés", `❌ falló: ${String(err).slice(0, 80)}`);
  }
}

function failSession(
  s: LiveSession,
  message: string,
  opts: { keepSnapshotFile: boolean },
): void {
  s.status = "error";
  s.error = message;
  // pending = el snapshot quedó para el recover del boot (el acta aún puede salir).
  void recordLiveOutcome(s.id, {
    status: opts.keepSnapshotFile ? "pending" : "error",
    project: s.project,
    coachMode: s.coachMode,
    client: s.client,
    error: message,
  });
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
  s.deepEngine?.destroy();
  s.deepEngine = null;
  s.articulation?.destroy();
  s.articulation = null;
  s.stt?.destroy();
  s.stt = null;
  s.snapshotsDisabled = true; // ninguna escritura tardía resucita el dotfile
  if (!opts.keepSnapshotFile) void deleteSnapshot(s);
  for (const ws of s.clients.all()) {
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
        if (snap.status !== "done" && snap.coachMode === CLASS_COACH_MODE) {
          // Clase interrumpida: al pipeline de inglés, igual que un cierre normal.
          const segs = snap.segments ?? [];
          const names = classSpeakerNames(segs, snap.selfSpeaker, snap.speakerNames ?? {});
          const transcript = buildFinalTranscript(segs, names);
          if (transcript.length >= MIN_INGEST_CHARS) {
            const maxEndMs = segs.reduce((m, seg) => Math.max(m, seg.endMs), 0);
            const english = await ingestClass({
              startedAt: snap.startedAt,
              durationSec: maxEndMs ? Math.round(maxEndMs / 1000) : null,
              transcript,
              segments: segs,
              selfSpeaker: snap.selfSpeaker,
              suggestions: snap.suggestions ?? [],
            });
            await recordLiveOutcome(snap.id, {
              status: "done",
              meetingId: `english-${english.id}`,
              project: snap.project || slug,
              coachMode: snap.coachMode,
              client: snap.client,
            });
          } else {
            await recordLiveOutcome(snap.id, {
              status: "error",
              project: snap.project || slug,
              coachMode: snap.coachMode,
              client: snap.client,
              error: "clase interrumpida sin transcripción suficiente",
            });
          }
        } else if (snap.status !== "done") {
          const transcript = buildFinalTranscript(snap.segments ?? [], snap.speakerNames ?? {});
          if (transcript.length >= MIN_INGEST_CHARS) {
            emit({
              kind: "meeting_live",
              taskId: snap.id,
              detail: `♻️ recuperando junta interrumpida: ${slug}`,
            });
            const maxEndMs = (snap.segments ?? []).reduce((m, seg) => Math.max(m, seg.endMs), 0);
            const meeting = await ingestMeeting({
              project: snap.project || slug,
              transcript,
              title: `${snap.title ?? "Junta en vivo"} (interrumpida)`,
              source: "live",
              sttProvider: snap.sttName ?? null,
              durationSec: maxEndMs ? Math.round(maxEndMs / 1000) : null,
              taskId: snap.id,
              liveSuggestions: snap.suggestions ?? [],
              review:
                snap.coachMode === TEAM_COACH_MODE
                  ? teamReviewMarkdown(snap.suggestions ?? [], snap.segments ?? [], snap.selfSpeaker)
                  : undefined,
              // El coach se recomputa del snapshot (función pura sobre segments).
              coachMetrics: snap.segments?.length
                ? computeCoachMetrics(snap.segments, snap.selfSpeaker, maxEndMs)
                : null,
              client: snap.client ?? "web",
            });
            await recordLiveOutcome(snap.id, {
              status: "done",
              meetingId: meeting.id,
              project: meeting.project_slug,
              coachMode: snap.coachMode,
              client: snap.client ?? "web",
            });
          } else {
            await recordLiveOutcome(snap.id, {
              status: "error",
              project: snap.project || slug,
              coachMode: snap.coachMode,
              client: snap.client,
              error: "junta interrumpida sin transcripción suficiente",
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

/**
 * Ruta del snapshot anti-reinicio de una sesión si sigue en el vault (la
 * ingesta falló o el agente murió a mitad): el recover del boot la va a
 * ingestar. La usa el job que completa la junta con el archivo del teléfono.
 */
export async function findLiveSnapshotFile(id: string): Promise<string | null> {
  if (!env.VAULT_PATH || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
  let slugs: string[] = [];
  try {
    slugs = (await readdir(join(env.VAULT_PATH, "projects"), { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return null;
  }
  for (const slug of slugs) {
    const path = join(env.VAULT_PATH, "projects", slug, "reuniones", `.live-${id}.json`);
    try {
      await stat(path);
      return path;
    } catch {
      /* no está en este proyecto */
    }
  }
  return null;
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
    coachMode: s.coachMode,
    englishSessionId: s.englishSessionId,
    client: s.client,
    ...s.clients.summary(),
    autoHelp: s.autoHelp,
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
  for (const ws of s.clients.all()) {
    try {
      ws.send(data);
    } catch {
      /* cliente roto: su close lo saca del set */
    }
  }
}
