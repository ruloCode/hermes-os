import { serve, upgradeWebSocket } from "@hono/node-server";
import { WebSocketServer } from "ws";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import { streamSSE } from "hono/streaming";
import type {
  Currency,
  GoalStatus,
  HabitCadence,
  MeetingSource,
  TaskState,
  TransactionKind,
} from "@hermes/shared";
import { env } from "./env.js";
import { verifySupabaseToken } from "./auth.js";
import { activityHourly, emit, recentEvents, subscribe } from "./events.js";
import { getPresence, listPresence, pushPresence, selfBaseUrl } from "./presence.js";
import { readProjects, resolveProjectRoot } from "./vault/projects.js";
import { readProjectContext } from "./vault/project-context.js";
import { resolveVaultDoc } from "./vault/doc.js";
import { memoriesCount, recentMemories, saveMemory, hasSupabase } from "./memory.js";
import { searchKnowledge, knowledgeStats } from "./knowledge.js";
import { syncVaultKnowledge } from "./vault/knowledge-sync.js";
import { syncVoiceTranscripts } from "./voice-transcripts.js";
import { startSystemSampler, getSystemMetrics } from "./system.js";
import { getWeather } from "./weather.js";
import { getUpcomingCalendar, invalidateCalendarCache } from "./calendar.js";
import * as gcal from "./google-calendar.js";
import { registerJob, listJobs } from "./jobs.js";
import { readCodeGraph3D, updateCodeGraph } from "./code-graph.js";
import {
  getSdkSession,
  getTask,
  listTasks,
  runAgentTurn,
  saveSdkSession,
  startTask,
} from "./agent/session.js";
import {
  openClaudeTerminal,
  startClaudeRun,
  getClaudeRun,
  listClaudeRuns,
  killClaudeRun,
  subscribeClaudeRun,
  type ClaudeLine,
} from "./agent/claude-cli.js";
import { getDailyUsage } from "./usage.js";
import {
  appendTurn,
  getConversation,
  clearConversation,
  archiveConversation,
  listChats,
  restoreChat,
} from "./conversations.js";
import { listChatSessions, readChatSession, resolveChatCwd } from "./agent/chat-history.js";
import {
  listMeetings,
  getMeeting,
  searchMeetings,
  readMeetingMarkdown,
  renderTranscriptTxt,
} from "./meetings/store.js";
import {
  startMeetingJob,
  getMeetingJob,
  listFailedTranscripts,
  retryFailedTranscript,
} from "./meetings/ingest.js";
import {
  startLiveMeeting,
  stopLiveMeeting,
  getLiveMeeting,
  listLiveMeetings,
  renameSpeaker,
  requestSuggestions,
  attachClient,
  detachClient,
  pushAudio,
  handleClientMessage,
  recoverOrphanLiveMeetings,
  LiveConflictError,
  LiveNotConfiguredError,
} from "./meetings/live.js";
import {
  attachGestureClient,
  detachGestureClient,
  handleGestureMessage,
} from "./input/gestures.js";
import { mouseStatus } from "./input/mouse.js";
import { pointerContext, teleportWindowUnderCursor } from "./input/windows.js";
import {
  openInBrowser,
  listTabs,
  switchTab,
  browserCommand,
  ensureCdpChrome,
  BROWSER_COMMANDS,
  type BrowserCommand,
} from "./browser.js";
import { lightsCommand, LIGHT_ACTIONS, type LightAction } from "./lights.js";
import { listExecutions, getExecution } from "./tasks/executions.js";
import { linearEnabled, getLinearIssue } from "./linear.js";
import {
  linearBoard,
  executeLinearIssue,
  setLinearIssueState,
  createIssueFromActionable,
} from "./linear-run.js";
import {
  listTasks as listTrackerTasks,
  createTask,
  getTask as getTrackerTask,
  updateTask,
  setTaskStatus,
  importVaultTasks,
  executeTask,
  continueTask,
  reconcileRunningTasks,
  trackerSummary,
} from "./tasks/store.js";
import {
  createTransaction,
  listTransactions,
  updateTransaction,
  voidTransaction,
  getRecentTransaction,
  listBudgets,
  setBudget,
  deleteBudget,
} from "./finance/store.js";
import { getFinanceSummary, summaryToText, formatAmount } from "./finance/advisor.js";
import { getUsdCopRate } from "./finance/fx.js";
import { listWallets, setWalletBalance, balancesToText } from "./finance/wallets.js";
import {
  createHabit,
  listHabits,
  archiveHabit,
  resolveHabit,
  checkinHabit,
  habitsToday,
} from "./habits/store.js";
import { createGoal, listGoals, resolveGoal, updateGoal } from "./habits/goals.js";
import {
  buildPracticeContext,
  getEnglishSession,
  listEnglishSessions,
  listVocab,
  reviewVocab,
  saveEnglishSession,
  saveVocab,
} from "./english/store.js";
import { generatePracticeReport } from "./english/report.js";
import {
  contentBoard,
  createPiece,
  createSession as createContentSession,
  createSessionFromPieces,
  deleteRef as deleteContentRef,
  getPiece,
  linkPieceToLinear,
  listChatMessages,
  replanOverdue,
  saveRef as saveContentRef,
  updatePiece,
  updateRef as updateContentRef,
  updateSession as updateContentSession,
} from "./content/store.js";
import { getPieceMetrics, hookPerformance, metricsSweep } from "./content/metrics.js";
import { generatePieceKit } from "./content/generate.js";
import {
  attachClips,
  browseClips,
  editAvailable,
  openEditOutput,
  removeClip,
  startEditRun,
  stopEditRun,
} from "./content/edit.js";
import {
  ensurePieceFolder,
  linkFolderMedia,
  revealPieceFolder,
  scanPieceMedia,
  sealMaster,
} from "./content/media.js";
import {
  deleteVoiceover,
  isMediaSubdir,
  pieceMediaFilePath,
  promoteVoiceover,
  saveVoiceover,
} from "./content/voiceover.js";
import {
  providerStatuses,
  publishPiece,
  publishSweep,
  schedulePublications,
} from "./content/publish.js";
import { generatePartVariants } from "./content/variants.js";
import { pieceChatTurn } from "./content/chat.js";
import { buildDailyBrief } from "./brief.js";
import { openInCursor } from "./agent/editor.js";
import {
  listClaudeSessions,
  getClaudeSession,
  deleteClaudeSession,
} from "./agent/claude-sessions.js";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join as joinPath } from "node:path";
import { Readable } from "node:stream";
import { OWNER } from "./owner.js";

const app = new Hono();
const startedAt = Date.now();

const expandHome = (p: string) => (p.startsWith("~") ? joinPath(homedir(), p.slice(1)) : p);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Orígenes permitidos: loopback, IPs privadas de la LAN y nombres mDNS (.local).
// Multi-máquina: el dashboard lo sirve UNA máquina y los browsers del resto de
// la red lo cargan desde http://192.168.x.x:31415 — con el allowlist viejo (solo
// localhost) el preflight moría y no había dashboard desde otro PC.
const LAN_ORIGIN =
  /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|[a-z0-9-]+\.(?:local|ts\.net))(?::\d+)?$/i;

// Private Network Access: Chrome exige que un preflight que va de una IP
// privada a loopback lo autorice explícitamente. Se responde ANTES del cors
// (que corta el OPTIONS) y se escribe sobre c.res, igual que hace el propio
// middleware de Hono.
app.use("*", async (c, next) => {
  await next();
  if (c.req.header("Access-Control-Request-Private-Network")) {
    c.res.headers.set("Access-Control-Allow-Private-Network", "true");
  }
});

app.use(
  "*",
  cors({
    origin: (origin) => (!origin || LAN_ORIGIN.test(origin) ? origin : ""),
    allowHeaders: [
      "Content-Type",
      "Authorization",
      "X-Hermes-Session-Id",
      "X-Hermes-Project",
      "X-Hermes-Resume",
    ],
  }),
);

// Access log a stdout (launchd lo captura en ~/.hermes-os/logs/agent.log).
// Registra mutaciones (POST/PUT/DELETE) y cualquier error (4xx/5xx); los GET
// 2xx de polling se omiten para no inundar el log. Clave para forense de
// uploads del móvil: sin esto, un "Network request failed" del teléfono no
// deja rastro de si el request llegó o no.
app.use("*", async (c, next) => {
  const t0 = Date.now();
  await next();
  const method = c.req.method;
  const status = c.res.status;
  if (method === "OPTIONS" || c.req.path === "/events") return;
  if ((method === "GET" || method === "HEAD") && status < 400) return;
  const len = c.req.header("content-length");
  const size = len ? ` ${(Number(len) / 1024 / 1024).toFixed(1)}MB` : "";
  console.log(
    `[http] ${new Date().toISOString()} ${method} ${c.req.path} → ${status} ${Date.now() - t0}ms${size}`,
  );
});

// Bearer opcional: solo se exige si HERMES_API_KEY está configurada (multi-Mac
// vía Tailscale). Los SSE usan EventSource, que no puede mandar headers → en
// rutas GET se acepta también el token como query ?key=. Además del API key
// estático se acepta un access token de Supabase Auth (login email+contraseña
// de la app móvil, que llega por el túnel cloudflared).
app.use("*", async (c, next) => {
  if (env.HERMES_API_KEY && c.req.path !== "/health") {
    const auth = c.req.header("Authorization") ?? "";
    const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const queryKey = c.req.method === "GET" ? (c.req.query("key") ?? "") : "";
    const staticOk = bearer === env.HERMES_API_KEY || queryKey === env.HERMES_API_KEY;
    if (!staticOk) {
      const userId = await verifySupabaseToken(bearer || queryKey);
      if (!userId) return c.json({ error: "unauthorized" }, 401);
    }
  }
  await next();
});

app.get("/health", (c) =>
  c.json({
    ok: true,
    machine: env.MACHINE_NAME,
    // El selector de máquina sondea /health (sin auth) para saber a quién le
    // está hablando: sin el nombre, dos agentes de la LAN son indistinguibles.
    baseUrl: selfBaseUrl(),
    uptime: (Date.now() - startedAt) / 1000,
  }),
);

// ── Contrato Hermes: OpenAI-compatible SSE ─────────────────────────────
app.post("/v1/chat/completions", async (c) => {
  const body = await c.req.json<{ messages?: { role: string; content: string }[] }>();
  const clientSession = c.req.header("X-Hermes-Session-Id") ?? "default";
  const focusProject = c.req.header("X-Hermes-Project") || undefined;
  // Resume explícito por tab (uuid de sesión SDK, validado); sin él cae al
  // mapeo legado clientSession → sdkSessionId (voz / clientes viejos).
  const resumeHeader = c.req.header("X-Hermes-Resume");
  const messages = body.messages ?? [];
  const lastUser =
    [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  if (!lastUser) return c.json({ error: "no user message" }, 400);

  // "new" = sesión fresca (tab nuevo); uuid = resume de esa sesión; sin
  // header = mapeo legado (clientes viejos / voz).
  const resume =
    resumeHeader === "new"
      ? undefined
      : resumeHeader && UUID_RE.test(resumeHeader)
        ? resumeHeader
        : await getSdkSession(clientSession);
  // Con proyecto en foco la sesión corre EN su repo (ruta_local): el
  // transcript cae en ~/.claude/projects/<repo> y Cursor ve el mismo chat.
  const cwd = await resolveChatCwd(focusProject);
  const id = `chatcmpl-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);
  const chunk = (delta: string | null, finish: string | null = null) => ({
    id,
    object: "chat.completion.chunk",
    created,
    model: "hermes",
    choices: [
      {
        index: 0,
        delta: delta === null ? {} : { content: delta },
        finish_reason: finish,
      },
    ],
  });

  return streamSSE(c, async (stream) => {
    // Serializamos las escrituras para conservar el orden de los deltas.
    let queue: Promise<unknown> = Promise.resolve();
    const send = (data: unknown) => {
      queue = queue.then(() =>
        stream.writeSSE({ data: typeof data === "string" ? data : JSON.stringify(data) }),
      );
      return queue;
    };

    let assistantText = "";
    const result = await runAgentTurn({
      prompt: lastUser,
      resumeSessionId: resume,
      project: focusProject,
      cwd,
      // Anuncia el session id del SDK apenas nace: el tab lo adopta y los
      // próximos turnos resumen esa MISMA sesión (mismo jsonl en disco).
      onSession: (sessionId) => void send({ hermes: { session_id: sessionId } }),
      // Pasos agénticos del turno: la consola los pinta en el hilo en vez de
      // un "pensando…" opaco. Van por el stream (no por el bus global) para
      // que cada paso quede atado al tab que lo disparó.
      onTool: (step) => void send({ hermes: { tool: step } }),
      onDelta: (t) => {
        assistantText += t;
        void send(chunk(t));
      },
    });

    if (result.sdkSessionId) {
      await saveSdkSession(clientSession, result.sdkSessionId, "text");
    }
    // Persiste el turno en el historial del proyecto en foco (o "general").
    void appendTurn(
      focusProject || "general",
      lastUser,
      assistantText || result.finalText,
      clientSession,
    );
    await send(chunk(null, "stop"));
    await send("[DONE]");
    await queue;
  });
});

// ── Historial de conversaciones por proyecto ──────────────────────────
app.get("/conversations/:project", async (c) => {
  const project = c.req.param("project") || "general";
  const messages = await getConversation(project);
  return c.json(messages.slice(-200)); // últimos 200 mensajes
});

app.delete("/conversations/:project", async (c) => {
  const project = c.req.param("project") || "general";
  await clearConversation(project);
  return c.json({ ok: true });
});

// ── Sesiones de la consola: DIRECTO de ~/.claude/projects ─────────────
// La misma fuente que ve `claude` abierto en el repo del proyecto (Cursor).
app.get("/chat/sessions", async (c) => {
  const cwd = await resolveChatCwd(c.req.query("project") || undefined);
  return c.json(await listChatSessions(cwd));
});

app.get("/chat/sessions/:id", async (c) => {
  const cwd = await resolveChatCwd(c.req.query("project") || undefined);
  const detail = await readChatSession(cwd, c.req.param("id"));
  if (!detail) return c.json({ error: "sesión no encontrada" }, 404);
  return c.json(detail);
});

// Historial de chats: lista de archivados, "nuevo chat" (archiva el activo)
// y restaurar uno viejo como conversación activa.
app.get("/conversations/:project/chats", async (c) =>
  c.json(await listChats(c.req.param("project") || "general")),
);

app.post("/conversations/:project/chats/new", async (c) => {
  await archiveConversation(c.req.param("project") || "general");
  return c.json({ ok: true });
});

app.post("/conversations/:project/chats/:id/restore", async (c) => {
  const msgs = await restoreChat(c.req.param("project") || "general", c.req.param("id"));
  if (!msgs) return c.json({ error: "chat no encontrado" }, 404);
  return c.json(msgs.slice(-200));
});

// ── Tareas async (voz → run_task / check_task) ─────────────────────────
app.post("/tasks", async (c) => {
  const { prompt } = await c.req.json<{ prompt?: string }>();
  if (!prompt) return c.json({ error: "prompt requerido" }, 400);
  const task = startTask(prompt);
  return c.json({ task_id: task.id, status: task.status });
});

app.get("/tasks", (c) => c.json(listTasks().slice(0, 20)));

app.get("/tasks/:id", (c) => {
  const task = getTask(c.req.param("id"));
  if (!task) return c.json({ error: "task no encontrada" }, 404);
  return c.json(task);
});

// ── Reuniones/Juntas por proyecto ──────────────────────────────────────
// Subir audio (o pegar transcripción) → transcribir → resumen + 2 accionables.
// El procesamiento es async (task_id inmediato); el progreso viaja por /events.

// Sube una reunión: multipart con `audio` (File) o `transcript` (texto) +
// `project` + `title?` + `source?` + `durationSec?`.
app.post(
  "/meetings",
  bodyLimit({ maxSize: 150 * 1024 * 1024 }), // 150 MB: cubre juntas largas en opus
  async (c) => {
    const body = await c.req.parseBody();
    const project = String(body.project ?? "").trim();
    if (!project) return c.json({ error: "project requerido" }, 400);
    const title = body.title ? String(body.title) : undefined;
    const durationSec = body.durationSec ? Number(body.durationSec) : null;
    const audio = body.audio;
    const transcript = body.transcript ? String(body.transcript) : undefined;
    const rawSource = String(body.source ?? "");

    if (audio && typeof audio !== "string") {
      const source = (["audio", "upload"].includes(rawSource) ? rawSource : "upload") as MeetingSource;
      const job = startMeetingJob({ project, audio, title, source, durationSec });
      return c.json({ meeting_job_id: job.id, status: job.status });
    }
    if (transcript?.trim()) {
      // Normalmente es texto pegado, pero una transcripción rescatada (p.ej.
      // del historial de Scribe) llega con su source/duración reales: hay que
      // respetarlos o la junta miente sobre su origen.
      const source = (["audio", "upload", "live"].includes(rawSource) ? rawSource : "paste") as MeetingSource;
      const job = startMeetingJob({
        project,
        transcript,
        title,
        source,
        durationSec,
        sttProvider: body.stt ? String(body.stt) : null,
      });
      return c.json({ meeting_job_id: job.id, status: job.status });
    }
    return c.json({ error: "falta `audio` o `transcript`" }, 400);
  },
);

// Estado de un job de ingest (para el spinner del panel; el /events también avisa).
app.get("/meetings/jobs/:id", (c) => {
  const job = getMeetingJob(c.req.param("id"));
  if (!job) return c.json({ error: "job no encontrado" }, 404);
  return c.json(job);
});

// Transcripciones que se salvaron de un análisis fallido: se pueden reintentar
// SIN el audio (que el teléfono ya borró). Antes de /meetings/:project.
app.get("/meetings/transcripciones", async (c) => c.json(await listFailedTranscripts()));

app.post("/meetings/transcripciones/:id/retry", async (c) => {
  try {
    const job = await retryFailedTranscript(c.req.param("id"));
    return c.json({ meeting_job_id: job.id, status: job.status });
  } catch (err) {
    return c.json({ error: String(err) }, 404);
  }
});

// Búsqueda semántica en el historial de reuniones (?q= &project=).
app.get("/meetings/search", async (c) => {
  const q = c.req.query("q") ?? "";
  if (!q.trim()) return c.json([]);
  return c.json(await searchMeetings(q, c.req.query("project") || undefined, 8));
});

// ── Junta EN VIVO (copiloto de reuniones) ──────────────────────────────
// El mic del browser sube PCM16 por WS; el agente proxya al STT streaming y
// empuja transcript + sugerencias. Los CONTROLES van por REST (sobreviven
// caídas del WS y rehidratan tras reload); el WS acepta espejos JSON.
// Registradas ANTES de /meetings/:project (mismo truco que /meetings/jobs/:id)
// para que "live" no se lea como un proyecto.

app.post("/meetings/live/start", async (c) => {
  interface StartLiveBody {
    project?: string;
    title?: string;
    maxSpeakers?: number;
    mode?: string;
    languages?: string[];
    suggestionLang?: string;
    coachMode?: string;
  }
  const b = await c.req.json<StartLiveBody>().catch(() => ({}) as StartLiveBody);
  if (!b.project?.trim()) return c.json({ error: "project requerido" }, 400);
  // Solo valores conocidos: cualquier otra cosa cae al default del runtime.
  const mode = b.mode === "remoto" ? "remoto" : b.mode === "presencial" ? "presencial" : undefined;
  const languages = Array.isArray(b.languages)
    ? b.languages.filter((l): l is "es" | "en" => l === "es" || l === "en")
    : undefined;
  const suggestionLang =
    b.suggestionLang === "es" || b.suggestionLang === "en" || b.suggestionLang === "auto"
      ? b.suggestionLang
      : undefined;
  try {
    const snapshot = await startLiveMeeting({
      project: b.project.trim(),
      title: b.title?.trim() || undefined,
      maxSpeakers: b.maxSpeakers,
      mode,
      languages: languages?.length ? languages : undefined,
      suggestionLang,
      coachMode: typeof b.coachMode === "string" ? b.coachMode : undefined,
    });
    return c.json(snapshot);
  } catch (err) {
    if (err instanceof LiveNotConfiguredError)
      return c.json({ notConfigured: true, error: err.message }, 503);
    // El 409 lleva el snapshot de la activa: el front la reanuda en vez de fallar.
    if (err instanceof LiveConflictError)
      return c.json({ error: err.message, active: err.snapshot }, 409);
    return c.json({ error: String(err).slice(0, 300) }, 500);
  }
});

// Juntas en vivo activas (rehidratación tras reload del dashboard).
app.get("/meetings/live", (c) => c.json(listLiveMeetings()));

// Snapshot de una junta (polling de respaldo si el WS se cae).
app.get("/meetings/live/:id", (c) => {
  const snapshot = getLiveMeeting(c.req.param("id"));
  if (!snapshot) return c.json({ error: "junta no encontrada" }, 404);
  return c.json(snapshot);
});

// Renombra un hablante ("A" → "Carlos"); el broadcast llega a todos los clients.
app.post("/meetings/live/:id/rename", async (c) => {
  const b = await c.req
    .json<{ speaker?: string; name?: string }>()
    .catch(() => ({}) as { speaker?: string; name?: string });
  if (!b.speaker?.trim() || typeof b.name !== "string")
    return c.json({ error: "speaker y name requeridos" }, 400);
  const snapshot = renameSpeaker(c.req.param("id"), b.speaker, b.name);
  if (!snapshot) return c.json({ error: "junta no encontrada" }, 404);
  return c.json(snapshot);
});

// "Soplar ahora": dispara una generación manual; el resultado llega push por WS.
app.post("/meetings/live/:id/suggest", (c) => {
  const id = c.req.param("id");
  if (!getLiveMeeting(id)) return c.json({ error: "junta no encontrada" }, 404);
  const res = requestSuggestions(id);
  if (!res.ok) return c.json(res, 409);
  return c.json(res);
});

// Crítico que sea REST: debe funcionar aunque el WS esté roto. Responde al
// entrar a "ingesting"; el fin real llega por WS `done` o por polling.
app.post("/meetings/live/:id/stop", async (c) => {
  const snapshot = await stopLiveMeeting(c.req.param("id"));
  if (!snapshot) return c.json({ error: "junta no encontrada" }, 404);
  return c.json(snapshot);
});

// WS de la junta: audio PCM16 ↑ (binario) · LiveServerEvent ↓ (JSON). El
// middleware de auth global corre en el upgrade (GET acepta ?key=, mismo
// mecanismo que el SSE /events — el browser no manda headers en un WS).
app.get(
  "/meetings/live/:id/ws",
  upgradeWebSocket((c) => {
    const id = c.req.param("id") ?? "";
    return {
      onOpen(_evt, ws) {
        // attachClient manda el hello {session} (replay completo del estado).
        if (!attachClient(id, ws)) ws.close(4404, "sesión no encontrada");
      },
      onMessage(evt) {
        if (typeof evt.data === "string") handleClientMessage(id, evt.data);
        else if (evt.data instanceof ArrayBuffer) pushAudio(id, evt.data);
      },
      onClose(_evt, ws) {
        detachClient(id, ws);
      },
    };
  }),
);

// ── Control por gestos (mano → cursor) ─────────────────────────────────
// El browser corre MediaPipe con la webcam y manda posiciones/pinza por WS;
// el agente inyecta CGEvents vía robotjs. Requiere permiso de Accessibility
// para el node del LaunchAgent (el status lo dice — sin permiso los eventos
// se descartan EN SILENCIO, por eso el check es empírico y no un flag).

app.get("/input/gestures/status", async (c) => {
  if (!env.GESTURES_ENABLED) return c.json({ enabled: false });
  return c.json({ enabled: true, ...(await mouseStatus()) });
});

// Deixis: dónde está el cursor y qué ventana/app hay debajo. Es lo que hace
// resolvibles los "esto"/"esta ventana" de la voz (tool get_pointer_context).
app.get("/input/pointer", async (c) => {
  if (!env.GESTURES_ENABLED) return c.json({ error: "gestos desactivados" }, 404);
  return c.json(await pointerContext());
});

// Teletransporta la ventana bajo el cursor al siguiente display (helper AX).
// El cursor gestual salta con ella.
app.post("/input/windows/teleport", async (c) => {
  if (!env.GESTURES_ENABLED) return c.json({ error: "gestos desactivados" }, 404);
  const result = await teleportWindowUnderCursor();
  if ("error" in result) return c.json(result, 409);
  emit({ kind: "gestures", detail: `ventana de ${result.app} → display ${result.display}` });
  return c.json(result);
});

// WS de control: JSON ↑ (arm/disarm/move/pinch/scroll/key) · JSON ↓ (hello/status/ping).
// Auth global en el upgrade (?key=, igual que la junta). Cliente único.
app.get(
  "/input/gestures/ws",
  upgradeWebSocket(() => ({
    onOpen(_evt, ws) {
      if (!env.GESTURES_ENABLED) {
        ws.close(4403, "control por gestos desactivado (HERMES_GESTURES=off)");
        return;
      }
      void attachGestureClient(ws);
    },
    onMessage(evt, ws) {
      if (typeof evt.data === "string") void handleGestureMessage(ws, evt.data);
    },
    onClose(_evt, ws) {
      detachGestureClient(ws);
    },
  })),
);

// ── Control del navegador por voz (Chrome real vía AppleScript) ────────
// Respuestas SIEMPRE 200 con { ok, error }: el client tool de la voz relata
// el error tal cual (p.ej. el permiso de "Allow JavaScript from Apple Events").

app.post("/browser/open", async (c) => {
  const body = await c.req.json<{ target?: string }>().catch(() => ({}) as { target?: string });
  const target = body.target?.trim();
  if (!target) return c.json({ ok: false, error: "target requerido" }, 400);
  const res = await openInBrowser(target);
  if (res.ok) emit({ kind: "browser", detail: `abrió ${res.label}` });
  return c.json(res);
});

app.get("/browser/tabs", async (c) => c.json(await listTabs()));

app.post("/browser/tab", async (c) => {
  const body = await c.req.json<{ query?: string }>().catch(() => ({}) as { query?: string });
  const query = body.query?.trim();
  if (!query) return c.json({ ok: false, error: "query requerido" }, 400);
  const res = await switchTab(query);
  if (res.ok) emit({ kind: "browser", detail: `pestaña → ${res.title.slice(0, 60)}` });
  return c.json(res);
});

// Navegación PROFUNDA en lenguaje natural: un agente SDK con las tools de
// chrome-devtools-mcp maneja el Chrome CDP dedicado (visible). Async como
// /tasks: task_id inmediato, la voz reporta con check_task.
app.post("/browser/navigate", async (c) => {
  if (!env.BROWSER_AGENT_ENABLED) {
    return c.json({ ok: false, error: "navegación agéntica desactivada (HERMES_BROWSER_AGENT=off)" });
  }
  const body = await c.req
    .json<{ instruction?: string }>()
    .catch(() => ({}) as { instruction?: string });
  const instruction = body.instruction?.trim();
  if (!instruction) return c.json({ ok: false, error: "instruction requerida" }, 400);
  // Pre-lanza el Chrome dedicado: la ventana aparece YA (feedback visual)
  // mientras arranca la sesión SDK; el guardrail lo re-garantiza por tool.
  void ensureCdpChrome();
  const task = startTask(
    `Eres las manos de ${OWNER} en su navegador. Usa las tools del navegador (mcp__chrome-devtools__*) para cumplir EXACTAMENTE esta instrucción dicha por voz: "${instruction}".

Método: navega a la URL que corresponda; toma un snapshot para VER la página y sus elementos (uids); interactúa (click, llenar, scroll) usando esos uids; verifica con otro snapshot tras cada acción importante. El Chrome es REAL y ${OWNER} lo está VIENDO en pantalla: no cierres pestañas que no abriste tú. Si un sitio pide iniciar sesión, NO intentes credenciales — reporta que ${OWNER} debe iniciar sesión una vez en el perfil "Hermes" y ahí queda guardada. Termina SIEMPRE con un resumen de una o dos frases aptas para voz: dónde quedaste y qué encontraste.`,
  );
  emit({ kind: "browser", detail: `navegando: ${instruction.slice(0, 120)}` });
  return c.json({ ok: true, task_id: task.id });
});

app.post("/browser/command", async (c) => {
  const body = await c.req.json<{ command?: string }>().catch(() => ({}) as { command?: string });
  const command = body.command?.trim() as BrowserCommand | undefined;
  if (!command || !BROWSER_COMMANDS.includes(command)) {
    return c.json({ ok: false, error: `command inválido (${BROWSER_COMMANDS.join("|")})` }, 400);
  }
  const res = await browserCommand(command);
  if (res.ok) emit({ kind: "browser", detail: `navegador · ${command}` });
  return c.json(res);
});

// ── Luces del cuarto (tira Kasa KL400L5 "luz led" en la LAN) ───────────
// Mismo contrato que el navegador: 200 con { ok, detail | error } para que
// la voz relate el resultado (o el error) tal cual.

app.post("/lights/command", async (c) => {
  const body = await c.req
    .json<{ action?: string; value?: string | number }>()
    .catch(() => ({}) as { action?: string; value?: string | number });
  const action = body.action?.trim() as LightAction | undefined;
  if (!action || !LIGHT_ACTIONS.includes(action)) {
    return c.json({ ok: false, error: `action inválida (${LIGHT_ACTIONS.join("|")})` }, 400);
  }
  const res = await lightsCommand(action, body.value == null ? undefined : String(body.value));
  if (res.ok && action !== "status") emit({ kind: "lights", detail: `luces · ${res.detail}` });
  return c.json(res);
});

app.get("/lights/state", async (c) => c.json(await lightsCommand("status")));

// Historial de reuniones de un proyecto.
app.get("/meetings/:project", async (c) => c.json(await listMeetings(c.req.param("project"))));

// Detalle de una reunión (resumen + accionables + transcripción).
app.get("/meetings/:project/:id", async (c) => {
  const meeting = await getMeeting(c.req.param("project"), c.req.param("id"));
  if (!meeting) return c.json({ error: "reunión no encontrada" }, 404);
  return c.json(meeting);
});

// Descarga de la junta. `format=txt` → solo la transcripción; `format=md`
// (default) → el acta completa, o sea el .md del vault tal cual (resumen,
// accionables, sugerencias en vivo, coach y transcripción).
app.get("/meetings/:project/:id/export", async (c) => {
  const project = c.req.param("project");
  const id = c.req.param("id");
  const txt = c.req.query("format") === "txt";

  let body: string | null;
  if (txt) {
    const meeting = await getMeeting(project, id);
    body = meeting ? renderTranscriptTxt(meeting) : null;
  } else {
    body = await readMeetingMarkdown(project, id);
  }
  if (body == null) return c.json({ error: "reunión no encontrada" }, 404);

  const filename = `${id}${txt ? "-transcripcion.txt" : ".md"}`;
  return c.body(body, 200, {
    "Content-Type": `text/${txt ? "plain" : "markdown"}; charset=utf-8`,
    "Content-Disposition": `attachment; filename="${filename}"`,
  });
});

// Triage de un accionable de la junta: crea la tarea según la decisión.
// ejecutar → tarea running + lanza run · pendiente → tarea pending (+ checkbox
// en la nota) · ignorar → tarea dismissed (auditable, no reaparece).
app.post("/meetings/:project/:id/actionables/:idx/triage", async (c) => {
  const project = c.req.param("project");
  const meetingId = c.req.param("id");
  const idx = Number(c.req.param("idx"));
  const { decision } = await c.req.json<{ decision?: string }>().catch(() => ({ decision: undefined }));

  const meeting = await getMeeting(project, meetingId);
  if (!meeting) return c.json({ error: "reunión no encontrada" }, 404);
  const a = meeting.actionables.find((x) => x.idx === idx);
  if (!a) return c.json({ error: "accionable no encontrado" }, 404);

  const base = {
    project,
    title: a.title,
    detail: a.one_liner,
    exec_prompt: a.exec_prompt,
    source: "meeting" as const,
    meetingId,
    meetingIdx: idx,
  };

  if (decision === "ignorar") {
    // Ignoradas NO van a Linear (cero ruido): solo la fila local auditable.
    return c.json({ task: await createTask({ ...base, status: "dismissed" }) });
  }

  // Linear-first: pendiente/ejecutar crean el issue PRIMERO (el exec_prompt
  // del accionable es su Copy prompt); la fila-puente guarda la referencia a
  // la junta para el overlay del MeetingDetail. Sin Linear configurado, cae
  // al flujo local de siempre.
  if (decision === "pendiente" || decision === "ejecutar") {
    if (!linearEnabled()) {
      const task = await createTask({ ...base, status: "pending" });
      if (!task) return c.json({ error: "no se pudo crear la tarea (¿Supabase?)" }, 500);
      if (decision === "pendiente") return c.json({ task });
      const res = await executeTask(task.id);
      if (!res) return c.json({ error: "no se pudo ejecutar la tarea" }, 500);
      return c.json({
        task: { ...task, status: "running", run_id: res.runId },
        run_id: res.runId,
        session_id: res.sessionId,
        slug: res.slug,
      });
    }
    try {
      const { issue, task } = await createIssueFromActionable({
        project,
        title: a.title,
        detail: a.one_liner,
        execPrompt: a.exec_prompt,
        meetingId,
        meetingIdx: idx,
      });
      if (decision === "pendiente") return c.json({ task, issue });
      const res = await executeLinearIssue(issue.identifier);
      if (!res) return c.json({ error: "no se pudo ejecutar la tarea" }, 500);
      return c.json({
        task: { ...res.task, status: "running", run_id: res.runId },
        issue,
        run_id: res.runId,
        session_id: res.sessionId,
        slug: res.slug,
      });
    } catch (err) {
      return c.json({ error: `Linear: ${String(err).slice(0, 200)}` }, 502);
    }
  }
  return c.json({ error: "decisión inválida (ejecutar|pendiente|ignorar)" }, 400);
});

// ── Tracker de tareas por proyecto ─────────────────────────────────────
// Prefijo /tracker para no chocar con /tasks (tareas async del SDK/voz).

app.get("/tracker/tasks", async (c) =>
  c.json(
    await listTrackerTasks({
      project: c.req.query("project") || undefined,
      status: (c.req.query("status") as TaskState) || undefined,
    }),
  ),
);

app.post("/tracker/tasks", async (c) => {
  const { project, title, detail } = await c.req
    .json<{ project?: string; title?: string; detail?: string }>()
    .catch(() => ({ project: undefined, title: undefined, detail: undefined }));
  if (!project || !title?.trim()) return c.json({ error: "project y title requeridos" }, 400);
  return c.json(await createTask({ project, title: title.trim(), detail, source: "manual" }));
});

app.get("/tracker/tasks/:id", async (c) => {
  const task = await getTrackerTask(Number(c.req.param("id")));
  if (!task) return c.json({ error: "tarea no encontrada" }, 404);
  return c.json(task);
});

app.post("/tracker/tasks/:id", async (c) => {
  const patch = await c.req.json<{ title?: string; detail?: string }>().catch(() => ({}));
  return c.json(await updateTask(Number(c.req.param("id")), patch));
});

app.post("/tracker/tasks/:id/status", async (c) => {
  const { status } = await c.req.json<{ status?: TaskState }>().catch(() => ({ status: undefined }));
  if (!status) return c.json({ error: "status requerido" }, 400);
  return c.json(await setTaskStatus(Number(c.req.param("id")), status));
});

app.post("/tracker/tasks/:id/execute", async (c) => {
  const res = await executeTask(Number(c.req.param("id")));
  if (!res) return c.json({ error: "no se pudo ejecutar (sin tarea o sin Supabase)" }, 400);
  return c.json({ run_id: res.runId, session_id: res.sessionId, slug: res.slug });
});

// Continuar/enviar otro prompt: resume la sesión de la tarea con un run nuevo.
app.post("/tracker/tasks/:id/continue", async (c) => {
  const { prompt } = await c.req.json<{ prompt?: string }>().catch(() => ({ prompt: undefined }));
  const res = await continueTask(Number(c.req.param("id")), prompt);
  if (!res) return c.json({ error: "no se pudo continuar (sin tarea o sin Supabase)" }, 400);
  return c.json({ run_id: res.runId, session_id: res.sessionId, slug: res.slug });
});

// Historial de ejecuciones de una tarea (memoria: prompt · análisis · resultado).
app.get("/tracker/tasks/:id/executions", async (c) => {
  const task = await getTrackerTask(Number(c.req.param("id")));
  if (!task) return c.json({ error: "tarea no encontrada" }, 404);
  return c.json(await listExecutions(task.project_slug, task.id));
});

// Documento completo de una ejecución (con markdown para renderizar en la web).
app.get("/tracker/executions/:project/:id", async (c) => {
  const exec = await getExecution(c.req.param("project"), c.req.param("id"));
  if (!exec) return c.json({ error: "ejecución no encontrada" }, 404);
  return c.json(exec);
});

app.post("/tracker/import/:project", async (c) =>
  c.json(await importVaultTasks(c.req.param("project"))),
);

// Arregla tareas 'running' huérfanas (run muerto por reinicio del agente).
app.post("/tracker/reconcile", async (c) => c.json({ fixed: await reconcileRunningTasks() }));

// ── Linear (tablero Linear-first del tab TAREAS) ───────────────────────
// Linear es la verdad de las tareas; aquí solo se proyecta al dashboard y se
// decide qué ejecuta Claude Code. La fila-puente local (linear-run.ts) engancha
// cada issue al motor de runs/stream/ejecuciones existente.

app.get("/linear/board", async (c) => {
  if (!linearEnabled()) return c.json({ available: false, issues: [] });
  try {
    const issues = await linearBoard({ project: c.req.query("project") || undefined });
    return c.json({ available: true, issues });
  } catch (err) {
    return c.json({ available: true, issues: [], error: String(err).slice(0, 200) }, 502);
  }
});

app.get("/linear/issue/:identifier", async (c) => {
  if (!linearEnabled()) return c.json({ error: "Linear no configurado" }, 400);
  try {
    return c.json(await getLinearIssue(c.req.param("identifier")));
  } catch (err) {
    return c.json({ error: String(err).slice(0, 200) }, 404);
  }
});

// Ejecutar el issue con Claude Code (la decisión humana del tablero).
app.post("/linear/issue/:identifier/execute", async (c) => {
  if (!linearEnabled()) return c.json({ error: "Linear no configurado" }, 400);
  const res = await executeLinearIssue(c.req.param("identifier"));
  if (!res) return c.json({ error: "no se pudo ejecutar (¿Supabase?)" }, 500);
  return c.json({
    task_id: res.task.id,
    run_id: res.runId,
    session_id: res.sessionId,
    slug: res.slug,
    identifier: res.identifier,
  });
});

// Cambiar estado del issue (marcar Done tras revisar, reabrir, etc.).
app.post("/linear/issue/:identifier/state", async (c) => {
  if (!linearEnabled()) return c.json({ error: "Linear no configurado" }, 400);
  const { type } = await c.req.json<{ type?: string }>().catch(() => ({ type: undefined }));
  const valid = ["backlog", "unstarted", "started", "completed", "canceled"] as const;
  if (!valid.includes(type as (typeof valid)[number]))
    return c.json({ error: `type requerido: ${valid.join("|")}` }, 400);
  try {
    return c.json(await setLinearIssueState(c.req.param("identifier"), type as (typeof valid)[number]));
  } catch (err) {
    return c.json({ error: String(err).slice(0, 200) }, 502);
  }
});

// Nueva tarea: Hermes la crea en Linear con contexto real + Copy prompt
// (async — el issue aparece en el tablero al terminar el turno del agente).
app.post("/linear/issues", async (c) => {
  if (!linearEnabled()) return c.json({ error: "Linear no configurado" }, 400);
  const { instruction, project } = await c.req
    .json<{ instruction?: string; project?: string }>()
    .catch(() => ({ instruction: undefined, project: undefined }));
  if (!instruction?.trim()) return c.json({ error: "instruction requerida" }, 400);
  const task = startTask(
    `Crea UN issue en Linear con create_linear_issue para esta tarea${project ? ` del proyecto "${project}" (pasa project="${project}")` : ""}: ${instruction.trim()}\n\nJunta primero el contexto real del proyecto (get_project_status / search_knowledge / query_code_graph) y redacta título imperativo, descripción con criterios de aceptación y un prompt autocontenido. No hagas nada más.`,
  );
  return c.json({ task_id: task.id, status: "creating" });
});

// ── Finanzas personales (transacciones + presupuestos + resumen) ───────

app.get("/finance/transactions", async (c) =>
  c.json(
    await listTransactions({
      month: c.req.query("month") || undefined,
      category: c.req.query("category") || undefined,
      kind: (c.req.query("kind") as TransactionKind) || undefined,
      currency: (c.req.query("currency") as Currency) || undefined,
      limit: c.req.query("limit") ? Number(c.req.query("limit")) : undefined,
    }),
  ),
);

interface TxBody {
  kind?: TransactionKind;
  amount?: number;
  currency?: Currency;
  category?: string;
  account?: string;
  note?: string;
  occurred_on?: string;
  allow_duplicate?: boolean;
}

app.post("/finance/transactions", async (c) => {
  const b = await c.req.json<TxBody>().catch(() => ({}) as TxBody);
  if (!b.kind || !b.amount || b.amount <= 0)
    return c.json({ error: "kind y amount (> 0) requeridos" }, 400);
  const res = await createTransaction({
    kind: b.kind,
    amount: b.amount,
    currency: b.currency,
    category: b.category,
    account: b.account,
    note: b.note,
    occurredOn: b.occurred_on,
    source: "web",
    allowDuplicate: b.allow_duplicate,
  });
  if (!res) return c.json({ error: "no se pudo crear (sin Supabase)" }, 500);
  return c.json({ ...res.tx, deduped: res.deduped });
});

app.post("/finance/transactions/:id", async (c) => {
  const patch = await c.req.json<TxBody>().catch(() => ({}) as TxBody);
  const tx = await updateTransaction(Number(c.req.param("id")), patch);
  if (!tx) return c.json({ error: "transacción no encontrada" }, 404);
  return c.json(tx);
});

app.delete("/finance/transactions/:id", async (c) =>
  c.json({ ok: await voidTransaction(Number(c.req.param("id"))) }),
);

app.get("/finance/summary", async (c) =>
  c.json(
    await getFinanceSummary(
      c.req.query("month") || undefined,
      (c.req.query("currency") as Currency) || "COP",
      // combined=1: suma ambas monedas convertidas a `currency` con la TRM.
      { combined: c.req.query("combined") === "1" },
    ),
  ),
);

app.get("/finance/budgets", async (c) => c.json(await listBudgets()));

app.post("/finance/budgets", async (c) => {
  const b = await c.req
    .json<{ category?: string; monthly_limit?: number; currency?: Currency }>()
    .catch(() => ({}) as { category?: string; monthly_limit?: number; currency?: Currency });
  if (!b.category || !b.monthly_limit || b.monthly_limit <= 0)
    return c.json({ error: "category y monthly_limit (> 0) requeridos" }, 400);
  return c.json(await setBudget(b.category, b.monthly_limit, b.currency));
});

app.delete("/finance/budgets/:category", async (c) =>
  c.json({ ok: await deleteBudget(c.req.param("category")) }),
);

// TRM vigente USD→COP — para el total combinado de billeteras en la UI.
app.get("/finance/fx", async (c) => {
  const rate = await getUsdCopRate();
  return c.json(rate ? { usd_cop: rate.rate, as_of: rate.as_of } : null);
});

// Billeteras: saldo actual por cuenta (se ajusta solo con las transacciones).
app.get("/finance/wallets", async (c) => c.json(await listWallets()));

app.post("/finance/wallets", async (c) => {
  const b = await c.req
    .json<{ name?: string; balance?: number; currency?: Currency }>()
    .catch(() => ({}) as Record<string, never>);
  if (!b.name?.trim() || typeof b.balance !== "number")
    return c.json({ error: "name y balance requeridos" }, 400);
  const w = await setWalletBalance(b.name, b.balance, b.currency);
  if (!w) return c.json({ error: "no se pudo guardar (sin Supabase)" }, 500);
  return c.json(w);
});

// ── Práctica de inglés (tutor de voz) ──────────────────────────────────
// Las tools del tutor (browser) pegan aquí; el reporte corre async tras
// guardar y su estado viaja por report_status (reconciliación perezosa).

app.post("/english/sessions", async (c) => {
  interface Body {
    started_at?: string;
    duration_sec?: number;
    topics?: string[];
    fluency?: number;
    errors?: { quote?: string; correction?: string; note_es?: string }[];
    wins?: string[];
    transcript?: string;
    source?: string;
  }
  const b = await c.req.json<Body>().catch(() => ({}) as Body);
  if (!b.started_at) return c.json({ error: "started_at requerido" }, 400);
  const session = await saveEnglishSession({
    startedAt: b.started_at,
    durationSec: typeof b.duration_sec === "number" ? Math.round(b.duration_sec) : null,
    topics: Array.isArray(b.topics) ? b.topics.map(String).slice(0, 10) : [],
    fluency: typeof b.fluency === "number" ? Math.min(5, Math.max(1, Math.round(b.fluency))) : null,
    errors: Array.isArray(b.errors)
      ? b.errors
          .filter((e) => e?.quote && e?.correction)
          .map((e) => ({ quote: String(e.quote), correction: String(e.correction), note_es: e.note_es ? String(e.note_es) : undefined }))
          .slice(0, 12)
      : [],
    wins: Array.isArray(b.wins) ? b.wins.map(String).slice(0, 6) : [],
    transcript: b.transcript ? String(b.transcript) : null,
    source: b.source === "mobile" || b.source === "meeting" ? b.source : "web",
  });
  if (!session) return c.json({ error: "no se pudo guardar (sin Supabase)" }, 500);
  void generatePracticeReport(session.id);
  return c.json(session);
});

app.get("/english/sessions", async (c) =>
  c.json(await listEnglishSessions(Number(c.req.query("limit")) || 20)),
);

app.get("/english/sessions/:id", async (c) => {
  const session = await getEnglishSession(Number(c.req.param("id")));
  if (!session) return c.json({ error: "sesión no encontrada" }, 404);
  return c.json(session);
});

app.post("/english/vocab", async (c) => {
  const b = await c.req
    .json<{ term?: string; meaning_es?: string; example?: string }>()
    .catch(() => ({}) as { term?: string; meaning_es?: string; example?: string });
  // meaning_es es opcional: el tap del transcript en vivo guarda solo el
  // término ("por definir") y el tutor lo completa después con save_vocab.
  if (!b.term?.trim()) return c.json({ error: "term requerido" }, 400);
  const entry = await saveVocab({ term: b.term, meaningEs: b.meaning_es, example: b.example });
  if (!entry) return c.json({ error: "no se pudo guardar (sin Supabase)" }, 500);
  return c.json(entry);
});

app.get("/english/vocab", async (c) =>
  c.json(
    await listVocab({
      due: c.req.query("due") === "true",
      limit: Number(c.req.query("limit")) || 20,
    }),
  ),
);

app.post("/english/vocab/:id/review", async (c) => {
  const entry = await reviewVocab(Number(c.req.param("id")));
  if (!entry) return c.json({ error: "vocab no encontrado" }, 404);
  return c.json(entry);
});

// String para la dynamic var {{practice_context}} del tutor (useVoiceConnect).
app.get("/english/context", async (c) => c.json({ context: await buildPracticeContext() }));

// ── Estudio de contenido (marca RuloCode, tab ESTUDIO) ─────────────────
// Un solo poll para toda la vista; mutaciones finas por pieza/sesión/ref.
// Literales antes de paramétricas (convención de meetings).

app.get("/content/board", async (c) => c.json(await contentBoard()));

app.post("/content/pieces", async (c) => {
  type Body = {
    title?: string;
    pillar?: string;
    platforms?: string[];
    format?: string;
    publish_at?: string;
    week_label?: string;
    hook?: string;
    notes?: string;
    ref_id?: number;
  };
  const b = await c.req.json<Body>().catch(() => ({}) as Body);
  if (!b.title?.trim()) return c.json({ error: "title requerido" }, 400);
  const piece = await createPiece({
    title: b.title,
    pillar: b.pillar as never,
    platforms: b.platforms,
    format: b.format as never,
    publishAt: b.publish_at ?? null,
    weekLabel: b.week_label ?? null,
    hook: b.hook ?? null,
    notes: b.notes ?? null,
    refId: b.ref_id ?? null,
  });
  if (!piece) return c.json({ error: "no se pudo guardar (sin Supabase)" }, 500);
  return c.json(piece);
});

app.patch("/content/pieces/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const patch = await c.req
    .json<Record<string, unknown>>()
    .catch(() => ({}) as Record<string, unknown>);
  // El body llega con las claves del tipo compartido (snake_case de la fila);
  // se traduce al input camelCase del store solo lo editable.
  const piece = await updatePiece(id, {
    title: patch.title as never,
    pillar: patch.pillar as never,
    platforms: patch.platforms as never,
    format: patch.format as never,
    status: patch.status as never,
    publishAt: patch.publish_at as never,
    weekLabel: patch.week_label as never,
    hook: patch.hook as never,
    scriptMd: patch.script_md as never,
    takes: patch.takes as never,
    editPoints: patch.edit_points as never,
    publications: patch.publications as never,
    variants: patch.variants as never,
    notes: patch.notes as never,
    sessionId: patch.session_id as never,
  });
  if (!piece) return c.json({ error: "pieza no encontrada (o sin Supabase)" }, 404);
  return c.json(piece);
});

app.get("/content/pieces/:id", async (c) => {
  const piece = await getPiece(Number(c.req.param("id")));
  if (!piece) return c.json({ error: "pieza no encontrada" }, 404);
  return c.json(piece);
});

// Genera el kit completo con el Agent SDK (guion + hook + plan de tomas +
// edición + copies). Síncrono a propósito: la UI muestra "Generando…" y el
// resultado llega editable (~30-60s). Solo llena tomas/edición/publicación
// si están vacíos — el material grabado real jamás se pisa.
app.post("/content/pieces/:id/generate", async (c) => {
  const b = await c.req
    .json<{ description?: string }>()
    .catch(() => ({}) as { description?: string });
  const piece = await generatePieceKit(Number(c.req.param("id")), b.description);
  if (!piece) return c.json({ error: "no se pudo generar (mira agent.log)" }, 500);
  return c.json(piece);
});

// Variantes de una parte del guion ("hook" o la etiqueta del bloque):
// 3-5 versiones con ángulos distintos que se AGREGAN al pool — elegir cuál
// queda activa es un acto humano en la UI. Síncrono como /generate.
app.post("/content/pieces/:id/variants", async (c) => {
  type VariantsBody = { part?: string; current?: string; brief?: string };
  const b = await c.req.json<VariantsBody>().catch(() => ({}) as VariantsBody);
  if (!b.part?.trim()) return c.json({ error: "part requerido" }, 400);
  const piece = await generatePartVariants(
    Number(c.req.param("id")),
    b.part.trim(),
    b.current,
    b.brief,
  );
  if (!piece) return c.json({ error: "no se pudo generar (mira agent.log)" }, 500);
  return c.json(piece);
});

// ── Crudos + edición automática (OpenMontage) ──────────────────────────
// Los crudos son archivos locales: la web navega el disco del agente con un
// file-picker server-side (el browser no expone rutas absolutas) y vincula
// rutas a la pieza. El run de edición corre DENTRO del repo de OpenMontage.

app.get("/content/clips/browse", async (c) => {
  try {
    return c.json(await browseClips(c.req.query("dir")));
  } catch (err) {
    return c.json({ error: String(err).slice(0, 160) }, 500);
  }
});

app.post("/content/pieces/:id/clips", async (c) => {
  const b = await c.req.json<{ paths?: string[] }>().catch(() => ({}) as { paths?: string[] });
  if (!Array.isArray(b.paths) || !b.paths.length)
    return c.json({ error: "paths requerido (rutas absolutas)" }, 400);
  const piece = await attachClips(Number(c.req.param("id")), b.paths);
  if (!piece) return c.json({ error: "pieza no encontrada" }, 404);
  return c.json(piece);
});

app.delete("/content/pieces/:id/clips/:clipId", async (c) => {
  const piece = await removeClip(Number(c.req.param("id")), c.req.param("clipId"));
  if (!piece) return c.json({ error: "pieza no encontrada" }, 404);
  return c.json(piece);
});

// Dispara la edición automática (async: job "running" de una; el progreso
// llega por el poll del board). 409 si ya hay un run vivo para la pieza.
app.post("/content/pieces/:id/edit-run", async (c) => {
  const b = await c.req.json<{ brief?: string }>().catch(() => ({}) as { brief?: string });
  const result = await startEditRun(Number(c.req.param("id")), b.brief);
  if (result.error)
    return c.json({ error: result.error }, (result.status ?? 500) as 400 | 404 | 409 | 500 | 503);
  return c.json(result.piece);
});

app.post("/content/pieces/:id/edit-run/stop", async (c) => {
  const piece = await stopEditRun(Number(c.req.param("id")));
  if (!piece) return c.json({ error: "pieza no encontrada" }, 404);
  return c.json(piece);
});

// Abre el master en QuickTime (o lo revela en Finder con { reveal: true }).
app.post("/content/pieces/:id/edit-run/open", async (c) => {
  const b = await c.req.json<{ reveal?: boolean }>().catch(() => ({}) as { reveal?: boolean });
  const result = await openEditOutput(Number(c.req.param("id")), Boolean(b.reveal));
  return c.json(result, result.ok ? 200 : 400);
});

app.get("/content/edit/available", (c) =>
  c.json({ available: editAvailable(), path: env.VIDEO_EDIT_PATH }),
);

// ── Carpeta de la pieza en el disco extraíble (ESTUDIO_MEDIA_ROOT) ─────
// El contrato de orden del flujo grabar→editar: <root>/<slug>/{crudos,assets,
// exports}. El checklist del tab Tomas se marca contra estos archivos.

app.get("/content/pieces/:id/media", async (c) => {
  const media = await scanPieceMedia(Number(c.req.param("id")));
  if (!media) return c.json({ error: "pieza no encontrada" }, 404);
  return c.json(media);
});

app.post("/content/pieces/:id/media/folder", async (c) => {
  const result = await ensurePieceFolder(Number(c.req.param("id")));
  if (result.error)
    return c.json({ error: result.error }, (result.status ?? 500) as 404 | 500 | 503);
  return c.json(result.piece);
});

// Vincula los videos de crudos/ + assets/ como raw_clips (para el tab Edición).
app.post("/content/pieces/:id/media/link", async (c) => {
  const { piece, added } = await linkFolderMedia(Number(c.req.param("id")));
  if (!piece) return c.json({ error: "pieza no encontrada" }, 404);
  return c.json({ piece, added });
});

// Abre la carpeta en Finder. `sub` = crudos | assets | exports (sin sub, la
// raíz de la pieza). Si no existe se crea: el botón siempre hace algo.
app.post("/content/pieces/:id/media/reveal", async (c) => {
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const sub = typeof body.sub === "string" && isMediaSubdir(body.sub) ? body.sub : undefined;
  const result = await revealPieceFolder(Number(c.req.param("id")), sub);
  return c.json(result, result.ok ? 200 : 400);
});

// Sirve un archivo de la carpeta de la pieza (el <audio> del dashboard escucha
// las tomas de voz; el fetch va con Bearer y la web lo pasa a blob URL).
app.get("/content/pieces/:id/media/file", async (c) => {
  const subRaw = c.req.query("sub") ?? "assets";
  if (!isMediaSubdir(subRaw)) return c.json({ error: "sub inválido" }, 400);
  const found = await pieceMediaFilePath(
    Number(c.req.param("id")),
    subRaw,
    c.req.query("name") ?? "",
  );
  if (found.error) return c.json({ error: found.error }, (found.status ?? 400) as 400 | 404);
  const { size } = await stat(found.path!);
  return new Response(Readable.toWeb(createReadStream(found.path!)) as ReadableStream, {
    headers: {
      "Content-Type": found.type!,
      "Content-Length": String(size),
      "Cache-Control": "no-store",
    },
  });
});

// ── Voz en off: se graba en el dashboard y aterriza en assets/ ─────────
// multipart con `audio` (blob de MediaRecorder) + `stem` (el bloque del guion,
// ej. "02-3-12s"; el sufijo -vo y el número de toma los pone el servidor).
app.post(
  "/content/pieces/:id/voiceover",
  bodyLimit({ maxSize: 64 * 1024 * 1024 }), // 64 MB: una narración larga en opus cabe de sobra
  async (c) => {
    const body = await c.req.parseBody();
    const audio = body.audio;
    if (!audio || typeof audio === "string") return c.json({ error: "falta `audio`" }, 400);
    const stem = String(body.stem ?? "").trim();
    if (!stem) return c.json({ error: "falta `stem`" }, 400);
    const result = await saveVoiceover(Number(c.req.param("id")), {
      stem,
      bytes: new Uint8Array(await audio.arrayBuffer()),
      sourceExt: audio.name || audio.type,
    });
    if (result.error) return c.json({ error: result.error }, (result.status ?? 500) as 400 | 404 | 500);
    return c.json({ file: result.file, media: result.media, transcoded: result.transcoded });
  },
);

// "▲ Usar esta toma": la asciende a última (renombrando), sin flags nuevos.
app.post("/content/pieces/:id/voiceover/:name/promote", async (c) => {
  const result = await promoteVoiceover(
    Number(c.req.param("id")),
    decodeURIComponent(c.req.param("name")),
  );
  if (result.error) return c.json({ error: result.error }, (result.status ?? 400) as 400 | 404);
  return c.json({ media: result.media, name: result.name });
});

app.delete("/content/pieces/:id/voiceover/:name", async (c) => {
  const result = await deleteVoiceover(
    Number(c.req.param("id")),
    decodeURIComponent(c.req.param("name")),
  );
  if (result.error) return c.json({ error: result.error }, (result.status ?? 400) as 400 | 404);
  return c.json(result.media);
});

// ── Publicación automática (fase 1: YouTube Shorts) ────────────────────

/** Qué providers están listos (la UI pinta el estado de conexión). */
app.get("/content/publish/providers", (c) => c.json({ providers: providerStatuses() }));

// ── Bucle de resultados (migración 022) ────────────────────────────────
// Métricas REALES de las publicaciones: el job content-metrics-sync las trae
// cada 6 h; estas rutas solo leen (y el POST dispara el sync a demanda).

app.get("/content/pieces/:id/metrics", async (c) => {
  const metrics = await getPieceMetrics(Number(c.req.param("id")));
  if (!metrics) return c.json({ error: "pieza no encontrada (o sin Supabase)" }, 404);
  return c.json(metrics);
});

app.get("/content/hooks/performance", async (c) => c.json({ hooks: await hookPerformance() }));

app.post("/content/metrics/sync", async (c) => {
  const result = await metricsSweep();
  if (!result) return c.json({ error: "sin Supabase o sin GOOGLE_OAUTH_* configurado" }, 503);
  return c.json(result);
});

// ── Cola de grabación y calendario ─────────────────────────────────────

// Arma el batch desde piezas concretas (las "listas para grabar" de la UI):
// checklist con una línea por pieza y las que están en guion pasan a grabacion.
app.post("/content/sessions/from-pieces", async (c) => {
  type Body = { piece_ids?: number[]; title?: string; scheduled_at?: string };
  const b = await c.req.json<Body>().catch(() => ({}) as Body);
  if (!Array.isArray(b.piece_ids) || !b.piece_ids.length)
    return c.json({ error: "piece_ids requerido" }, 400);
  const result = await createSessionFromPieces({
    pieceIds: b.piece_ids,
    title: b.title,
    scheduledAt: b.scheduled_at ?? null,
  });
  if (!result.session) return c.json({ error: "no se pudo crear la sesión" }, 500);
  return c.json(result);
});

// Re-fecha las piezas VENCIDAS en un acto (cadencia elegida por el humano).
app.post("/content/replan", async (c) => {
  type Body = { per_week?: number; ids?: number[] };
  const b = await c.req.json<Body>().catch(() => ({}) as Body);
  return c.json(await replanOverdue({ perWeek: b.per_week, ids: b.ids }));
});

/** Re-escanea el disco y sella el master canónico de la pieza. */
app.post("/content/pieces/:id/master", async (c) => {
  const { piece, master } = await sealMaster(Number(c.req.param("id")));
  if (!piece) return c.json({ error: "pieza no encontrada" }, 404);
  return c.json({ piece, master });
});

/** Valida + encola las variantes automáticas (sin subir todavía). */
app.post("/content/pieces/:id/publish/schedule", async (c) => {
  const piece = await schedulePublications(Number(c.req.param("id")));
  if (!piece) return c.json({ error: "pieza no encontrada" }, 404);
  return c.json(piece);
});

/** Sube ya. `only` = id de UNA variante (el botón de la fila). */
app.post("/content/pieces/:id/publish", async (c) => {
  const b = await c.req.json<{ only?: string }>().catch(() => ({}) as { only?: string });
  const result = await publishPiece(Number(c.req.param("id")), {
    only: b.only,
    ignoreBackoff: true, // disparo manual: el humano manda sobre el backoff
  });
  if (result.error)
    return c.json({ error: result.error }, (result.status ?? 500) as 400 | 404 | 409 | 500);
  return c.json(result.piece);
});

// ── Chat por pieza: historial + turno SSE ──────────────────────────────
app.get("/content/pieces/:id/chat", async (c) =>
  c.json({ messages: await listChatMessages(Number(c.req.param("id"))) }),
);

// Un turno del chat de la pieza. SSE propio (no OpenAI): `delta` con el
// texto, `piece` con la pieza tras CADA mutación (la UI se refresca en vivo
// sin esperar el poll) y `done` al cerrar.
app.post("/content/pieces/:id/chat", async (c) => {
  const pieceId = Number(c.req.param("id"));
  const b = await c.req.json<{ message?: string }>().catch(() => ({}) as { message?: string });
  const message = b.message?.trim();
  if (!message) return c.json({ error: "message requerido" }, 400);

  return streamSSE(c, async (stream) => {
    // Serializamos las escrituras para conservar el orden de los deltas.
    let queue: Promise<unknown> = Promise.resolve();
    const send = (data: unknown) => {
      queue = queue.then(() => stream.writeSSE({ data: JSON.stringify(data) }));
      return queue;
    };
    const result = await pieceChatTurn(pieceId, message, {
      onDelta: (text) => void send({ delta: text }),
      // `applied` = qué campos tocó la mutación → la UI lo pinta como tarjeta.
      onPiece: (piece, fields) => void send({ piece, applied: fields }),
      onTool: (name) => void send({ tool: name }),
      // Stop del cliente (o cierre del tab) aborta el turno del SDK de verdad.
      signal: c.req.raw.signal,
    });
    await send({ done: true, error: result.isError || undefined });
    await queue;
  });
});

// Crea (o devuelve) el issue de Linear de la pieza — proyecto RuloCode,
// label "contenido"; el estado local se refleja en el issue al cambiar.
app.post("/content/pieces/:id/linear", async (c) => {
  const piece = await linkPieceToLinear(Number(c.req.param("id")));
  if (!piece) return c.json({ error: "no se pudo enlazar (¿LINEAR_API_KEY?)" }, 500);
  return c.json(piece);
});

app.post("/content/sessions", async (c) => {
  type Body = {
    title?: string;
    scheduled_at?: string;
    checklist?: { label: string; done: boolean }[];
    folder?: string;
    notes?: string;
  };
  const b = await c.req.json<Body>().catch(() => ({}) as Body);
  if (!b.title?.trim()) return c.json({ error: "title requerido" }, 400);
  const session = await createContentSession({
    title: b.title,
    scheduledAt: b.scheduled_at ?? null,
    checklist: b.checklist,
    folder: b.folder ?? null,
    notes: b.notes ?? null,
  });
  if (!session) return c.json({ error: "no se pudo guardar (sin Supabase)" }, 500);
  return c.json(session);
});

app.patch("/content/sessions/:id", async (c) => {
  const patch = await c.req
    .json<Record<string, unknown>>()
    .catch(() => ({}) as Record<string, unknown>);
  const session = await updateContentSession(Number(c.req.param("id")), {
    title: patch.title as never,
    scheduledAt: patch.scheduled_at as never,
    status: patch.status as never,
    checklist: patch.checklist as never,
    folder: patch.folder as never,
    notes: patch.notes as never,
  });
  if (!session) return c.json({ error: "sesión no encontrada (o sin Supabase)" }, 404);
  return c.json(session);
});

app.post("/content/refs", async (c) => {
  type Body = {
    kind?: string;
    title?: string;
    body?: string;
    metric?: string;
    source?: string;
    url?: string;
    apply_status?: string;
    pillar?: string;
  };
  const b = await c.req.json<Body>().catch(() => ({}) as Body);
  // Pegar el link basta: con url el título real se resuelve por oEmbed.
  if (!b.title?.trim() && !b.url?.trim())
    return c.json({ error: "title o url requerido" }, 400);
  const ref = await saveContentRef({
    kind: (b.kind as never) ?? "guardada",
    title: b.title,
    body: b.body ?? null,
    metric: b.metric ?? null,
    source: b.source ?? null,
    url: b.url ?? null,
    applyStatus: (b.apply_status as never) ?? null,
    pillar: (b.pillar as never) ?? null,
  });
  if (!ref) return c.json({ error: "no se pudo guardar (sin Supabase)" }, 500);
  return c.json(ref);
});

// Detalle del radar: la referencia se edita en sitio (estado en el plan,
// pilar, fuente, notas) y se puede borrar cuando deja de servir.
app.patch("/content/refs/:id", async (c) => {
  const patch = await c.req
    .json<Record<string, unknown>>()
    .catch(() => ({}) as Record<string, unknown>);
  const ref = await updateContentRef(Number(c.req.param("id")), {
    kind: patch.kind as never,
    title: patch.title as never,
    body: patch.body as never,
    metric: patch.metric as never,
    source: patch.source as never,
    url: patch.url as never,
    applyStatus: patch.apply_status as never,
    pillar: patch.pillar as never,
  });
  if (!ref) return c.json({ error: "referencia no encontrada (o sin Supabase)" }, 404);
  return c.json(ref);
});

app.delete("/content/refs/:id", async (c) => {
  const ok = await deleteContentRef(Number(c.req.param("id")));
  return c.json({ ok }, ok ? 200 : 500);
});

// ── Hábitos y metas (desarrollo personal) ──────────────────────────────

app.get("/habits", async (c) => c.json(await listHabits(!c.req.query("all"))));

app.post("/habits", async (c) => {
  const b = await c.req
    .json<{ name?: string; cadence?: HabitCadence; times_per_week?: number }>()
    .catch(() => ({}) as { name?: string; cadence?: HabitCadence; times_per_week?: number });
  if (!b.name?.trim()) return c.json({ error: "name requerido" }, 400);
  return c.json(
    await createHabit({ name: b.name, cadence: b.cadence, timesPerWeek: b.times_per_week }),
  );
});

app.post("/habits/:id/archive", async (c) =>
  c.json({ ok: await archiveHabit(Number(c.req.param("id"))) }),
);

app.post("/habits/:id/checkin", async (c) => {
  const b = await c.req
    .json<{ date?: string; done?: boolean; note?: string }>()
    .catch(() => ({}) as { date?: string; done?: boolean; note?: string });
  const checkin = await checkinHabit(Number(c.req.param("id")), { ...b, source: "web" });
  if (!checkin) return c.json({ error: "no se pudo registrar (sin Supabase)" }, 500);
  return c.json(checkin);
});

app.get("/habits/today", async (c) => c.json(await habitsToday()));

app.get("/goals", async (c) =>
  c.json(await listGoals((c.req.query("status") as GoalStatus) || undefined)),
);

app.post("/goals", async (c) => {
  const b = await c.req
    .json<{
      title?: string;
      description?: string;
      target_value?: number;
      unit?: string;
      milestones?: string[];
      due_date?: string;
    }>()
    .catch(() => ({}) as Record<string, never>);
  if (!b.title?.trim()) return c.json({ error: "title requerido" }, 400);
  return c.json(
    await createGoal({
      title: b.title,
      description: b.description,
      targetValue: b.target_value,
      unit: b.unit,
      milestones: b.milestones,
      dueDate: b.due_date,
    }),
  );
});

app.post("/goals/:id", async (c) => {
  const b = await c.req
    .json<{
      current_value?: number;
      delta?: number;
      status?: GoalStatus;
      milestone_done?: string;
      description?: string;
    }>()
    .catch(() => ({}) as Record<string, never>);
  const goal = await updateGoal(Number(c.req.param("id")), {
    currentValue: b.current_value,
    delta: b.delta,
    status: b.status,
    milestoneDone: b.milestone_done,
    description: b.description,
  });
  if (!goal) return c.json({ error: "meta no encontrada" }, 404);
  return c.json(goal);
});

// ── Claude Code (CLI real): Terminal.app + panel embebido ──────────────
interface ClaudeExecBody {
  prompt?: string;
  model?: string;
  effort?: string;
  permissionMode?: string;
  project?: string;
  /** Si viene, se resume esa sesión de Claude Code en vez de crear una nueva. */
  resumeSessionId?: string;
}

// Abre una ventana de Terminal.app real con `claude` interactivo.
app.post("/claude/terminal", async (c) => {
  const b = await c.req.json<ClaudeExecBody>().catch(() => ({}) as ClaudeExecBody);
  if (!b.prompt?.trim()) return c.json({ error: "prompt requerido" }, 400);
  const res = await openClaudeTerminal({
    prompt: b.prompt,
    model: b.model,
    effort: b.effort,
    permissionMode: b.permissionMode,
    projectContext: b.project,
  });
  if (!res.ok) return c.json({ ok: false, error: res.error }, 500);
  emit({ kind: "tool_call", toolName: "claude(terminal)", detail: b.prompt.slice(0, 120) });
  return c.json({ ok: true });
});

// Inicia una corrida headless de `claude -p` y transmite por SSE al panel.
app.post("/claude/run", async (c) => {
  const b = await c.req.json<ClaudeExecBody>().catch(() => ({}) as ClaudeExecBody);
  if (!b.prompt?.trim()) return c.json({ error: "prompt requerido" }, 400);

  const projectSlug = b.project || "general";

  // Resume una sesión existente, o crea una nueva con un id fresco.
  // resumeSessionId viene del cliente → se exige formato uuid antes de pasarlo
  // a `claude --resume` (evita que un valor con "-" se cuele como flag del CLI).
  let sessionId: string;
  let resumeSdkSessionId: string | undefined;
  let existing: Awaited<ReturnType<typeof getClaudeSession>> = null;
  if (b.resumeSessionId && UUID_RE.test(b.resumeSessionId)) {
    sessionId = b.resumeSessionId;
    existing = await getClaudeSession(projectSlug, b.resumeSessionId);
    // sdkSessionId sale del CLI/nuestro uuid; validado también por si acaso.
    const candidate = existing?.sdkSessionId ?? b.resumeSessionId;
    resumeSdkSessionId = UUID_RE.test(candidate) ? candidate : b.resumeSessionId;
  } else {
    sessionId = randomUUID();
  }

  // cwd: al resumir, la MISMA carpeta con que se creó la sesión (así el CLI la
  // encuentra aunque cambie el ruta_local); si no, el repo local del proyecto.
  let cwd: string | undefined = existing?.cwd || undefined;
  if (!cwd && b.project) {
    const p = (await readProjects()).find(
      (x) => x.slug.toLowerCase() === b.project!.toLowerCase(),
    );
    // resolveProjectRoot, no ruta_local a secas: en otra máquina el mismo
    // proyecto vive en otra carpeta (y correr en el cwd equivocado es peor
    // que no correr).
    if (p) cwd = resolveProjectRoot(p) ?? undefined;
  }

  const run = startClaudeRun({
    prompt: b.prompt,
    model: b.model,
    effort: b.effort,
    permissionMode: b.permissionMode,
    projectContext: b.project,
    cwd,
    projectSlug,
    sessionId,
    resumeSdkSessionId,
  });
  emit({
    kind: "task_start",
    taskId: run.id,
    detail: `claude -p${resumeSdkSessionId ? " (resume)" : ""}: ${b.prompt.slice(0, 100)}`,
  });
  return c.json({
    run_id: run.id,
    session_id: sessionId,
    status: run.status,
    model: run.model,
    effort: run.effort,
    permissionMode: run.permissionMode,
  });
});

// Runs de Claude Code vivos (en curso o recién terminados) de TODOS los
// proyectos → panel Orquestador del dashboard.
app.get("/claude/runs", (c) => c.json(listClaudeRuns()));

// Cancela un run en curso (botón ✕ del Orquestador).
app.post("/claude/run/:id/kill", (c) => {
  const res = killClaudeRun(c.req.param("id"));
  if (res.ok) emit({ kind: "tool_call", toolName: "claude(kill)", detail: c.req.param("id") });
  return c.json(res, res.ok ? 200 : 400);
});

// ── Sesiones de Claude Code (CLI) por proyecto: listar · leer · borrar ──
app.get("/claude/sessions/:project", async (c) =>
  c.json(await listClaudeSessions(c.req.param("project"))),
);

app.get("/claude/sessions/:project/:id", async (c) => {
  const session = await getClaudeSession(c.req.param("project"), c.req.param("id"));
  if (!session) return c.json({ error: "sesión no encontrada" }, 404);
  return c.json(session);
});

app.delete("/claude/sessions/:project/:id", async (c) => {
  await deleteClaudeSession(c.req.param("project"), c.req.param("id"));
  return c.json({ ok: true });
});

// SSE del stream de una corrida embebida (replay + live).
app.get("/claude/run/:id/stream", (c) => {
  const id = c.req.param("id");
  const run = getClaudeRun(id);
  if (!run) return c.json({ error: "run no encontrada" }, 404);

  return streamSSE(c, async (stream) => {
    let queue: Promise<unknown> = Promise.resolve();
    const send = (event: string, data: unknown) => {
      queue = queue.then(() =>
        stream.writeSSE({ event, data: typeof data === "string" ? data : JSON.stringify(data) }),
      );
      return queue;
    };

    let ended = false;
    const finish = async () => {
      if (ended) return;
      ended = true;
      const cur = getClaudeRun(id) ?? run;
      await send("status", { status: cur.status, exitCode: cur.exitCode });
      await send("end", "[DONE]");
    };
    const isTerminal = (line: ClaudeLine) =>
      (line.kind === "done" || line.kind === "error") && line.text.includes("finalizó");

    // Snapshot del buffer + suscripción en el MISMO tick (sin await entre medias)
    // → ni el shift() del buffer ni la ventana de replay pierden líneas.
    const snapshot = [...run.lines];
    const pending: ClaudeLine[] = [];
    let replaying = true;
    let unsub: (() => void) | null = null;

    await new Promise<void>((resolve) => {
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        unsub?.();
        resolve();
      };
      const handle = (line: ClaudeLine) => {
        void send("line", line);
        if (isTerminal(line)) void finish().then(settle);
      };

      unsub = subscribeClaudeRun(id, (line) => {
        if (replaying) pending.push(line);
        else handle(line);
      });
      c.req.raw.signal.addEventListener("abort", settle);

      void (async () => {
        for (const line of snapshot) await send("line", line);
        replaying = false;
        for (const line of pending) handle(line);
        pending.length = 0;
        // Si sigue viva, el subscriber cerrará al ver la línea terminal.
        const cur = getClaudeRun(id) ?? run;
        if (cur.status === "running") return;
        await finish(); // idempotente
        settle();
      })();
    });
    await finish();
  });
});

// ── Endpoints directos para los client tools de voz (baja latencia) ────
app.post("/tools/get_project_status", async (c) => {
  const { project } = await c.req.json<{ project?: string }>().catch(() => ({ project: undefined }));
  const projects = await readProjects();
  const filtered = project
    ? projects.filter((p) => p.slug.toLowerCase() === String(project).toLowerCase())
    : projects.filter((p) => p.estado === "activo");
  return c.json(
    filtered.map((p) => ({
      slug: p.slug,
      name: p.name,
      estado: p.estado,
      estado_actual: p.estado_actual.slice(0, 600),
      tareas_pendientes: p.tareas_pendientes.slice(0, 5),
    })),
  );
});

// La voz busca en TODO el conocimiento (memorias, reuniones, ejecuciones,
// chats pasados y vault), no solo en memories. Mantiene el shape del client
// tool de ElevenLabs; si el RPC unificado no existe aún, degrada a memorias.
app.post("/tools/search_memory", async (c) => {
  const { query } = await c.req.json<{ query?: string }>();
  if (!query) return c.json([]);
  const hits = await searchKnowledge(query, { limit: 5 });
  return c.json(
    hits.map((h) => ({
      type: h.source,
      content: `${h.title}: ${h.content}`.slice(0, 400),
      project: h.project_slug,
      fecha: h.created_at?.slice(0, 10) ?? "",
    })),
  );
});

// Búsqueda unificada para el dashboard / debugging (mismos filtros que la tool).
app.post("/knowledge/search", async (c) => {
  type KnowledgeSearchBody = { query?: string; sources?: string[]; project?: string; limit?: number };
  const body = await c.req.json<KnowledgeSearchBody>().catch(() => ({}) as KnowledgeSearchBody);
  if (!body.query) return c.json({ error: "query requerido" }, 400);
  const hits = await searchKnowledge(body.query, {
    sources: body.sources as never,
    project: body.project,
    limit: body.limit,
  });
  return c.json(hits);
});

app.post("/tools/save_memory", async (c) => {
  const { content, type } = await c.req.json<{ content?: string; type?: string }>();
  if (!content) return c.json({ ok: false, error: "content requerido" }, 400);
  const validTypes = ["user", "feedback", "project", "reference", "daily", "agent"];
  const result = await saveMemory({
    content,
    type: (validTypes.includes(type ?? "") ? type : "agent") as never,
    source: "voice",
  });
  emit({ kind: "tool_call", toolName: "save_memory(voz)", detail: content.slice(0, 120) });
  return c.json({ ok: true, result });
});

// Brief unificado: proyectos + finanzas del mes + hábitos de hoy (src/brief.ts).
app.post("/tools/get_daily_brief", async (c) => c.json({ brief: await buildDailyBrief() }));

// ── Client tools de voz: finanzas y hábitos (baja latencia) ────────────

app.post("/tools/log_transaction", async (c) => {
  const b = await c.req.json<TxBody>().catch(() => ({}) as TxBody);
  if (!b.amount || b.amount <= 0) return c.json({ ok: false, error: "amount requerido" }, 400);
  const res = await createTransaction({
    kind: b.kind ?? "expense",
    amount: b.amount,
    currency: b.currency,
    category: b.category,
    account: b.account,
    note: b.note,
    occurredOn: b.occurred_on,
    source: "voice",
    allowDuplicate: b.allow_duplicate,
  });
  if (!res) return c.json({ ok: false, error: "sin Supabase" }, 500);
  const verb = res.tx.kind === "income" ? "Ingreso" : "Gasto";
  let confirmation = `${verb}: ${formatAmount(res.tx.amount, res.tx.currency)} en ${res.tx.category}, ${res.tx.occurred_on}.`;
  if (res.wallet)
    confirmation += ` ${res.wallet.name}: queda ${formatAmount(res.wallet.balance, res.wallet.currency)}.`;
  emit({
    kind: "tool_call",
    toolName: "log_transaction(voz)",
    detail: `${confirmation}${res.deduped ? " (dedup)" : ""}`,
  });
  return c.json({ ok: true, deduped: res.deduped, tx_id: res.tx.id, confirmation });
});

// Saldo actual total y por billetera ("¿cuánto tengo?").
app.post("/tools/get_balance", async (c) => {
  const text = await balancesToText();
  return c.json({
    text: text ?? "No hay billeteras registradas aún. Dime cuánto tienes en cada una.",
    wallets: await listWallets(),
  });
});

// Fija el saldo de una billetera ("tengo 55 mil en nequi").
app.post("/tools/set_wallet_balance", async (c) => {
  const b = await c.req
    .json<{ wallet?: string; balance?: number; currency?: Currency }>()
    .catch(() => ({}) as Record<string, never>);
  if (!b.wallet?.trim() || typeof b.balance !== "number")
    return c.json({ ok: false, error: "wallet y balance requeridos" }, 400);
  const w = await setWalletBalance(b.wallet, b.balance, b.currency);
  if (!w) return c.json({ ok: false, error: "sin Supabase" }, 500);
  const confirmation = `${w.name}: ${formatAmount(w.balance, w.currency)}.`;
  emit({ kind: "tool_call", toolName: "set_wallet_balance(voz)", detail: confirmation });
  return c.json({ ok: true, confirmation });
});

app.post("/tools/correct_last_transaction", async (c) => {
  const b = await c.req
    .json<TxBody & { void?: boolean }>()
    .catch(() => ({}) as TxBody & { void?: boolean });
  const last = await getRecentTransaction(15);
  if (!last)
    return c.json({ ok: false, error: "No hay transacciones recientes (últimos 15 min)." });
  if (b.void) {
    await voidTransaction(last.id);
    emit({ kind: "tool_call", toolName: "correct_last_transaction(voz)", detail: "anulada" });
    return c.json({
      ok: true,
      confirmation: `Anulada: ${formatAmount(last.amount, last.currency)} en ${last.category}.`,
    });
  }
  const tx = await updateTransaction(last.id, {
    amount: b.amount,
    currency: b.currency,
    category: b.category,
    note: b.note,
    kind: b.kind,
  });
  if (!tx) return c.json({ ok: false, error: "no se pudo corregir" }, 500);
  const confirmation = `Corregida: ${formatAmount(tx.amount, tx.currency)} en ${tx.category}.`;
  emit({ kind: "tool_call", toolName: "correct_last_transaction(voz)", detail: confirmation });
  return c.json({ ok: true, confirmation });
});

app.post("/tools/get_finance_summary", async (c) => {
  const { month, currency } = await c.req
    .json<{ month?: string; currency?: Currency }>()
    .catch(() => ({}) as { month?: string; currency?: Currency });
  const summary = await getFinanceSummary(month, currency ?? "COP");
  const saldo = await balancesToText();
  const text = saldo ? `${saldo}\n${summaryToText(summary)}` : summaryToText(summary);
  return c.json({ text, summary });
});

app.post("/tools/log_habit", async (c) => {
  const b = await c.req
    .json<{ habit?: string; done?: boolean; note?: string }>()
    .catch(() => ({}) as Record<string, never>);
  if (!b.habit?.trim()) return c.json({ ok: false, error: "habit requerido" }, 400);
  const habit = await resolveHabit(b.habit);
  if (!habit) {
    const names = (await listHabits(true)).map((h) => h.name);
    return c.json({
      ok: false,
      error: `No encontré el hábito "${b.habit}". Activos: ${names.join(", ") || "ninguno"}.`,
    });
  }
  const checkin = await checkinHabit(habit.id, { done: b.done, note: b.note, source: "voice" });
  if (!checkin) return c.json({ ok: false, error: "sin Supabase" }, 500);
  const today = (await habitsToday()).find((h) => h.id === habit.id);
  const unidad = habit.cadence === "weekly" ? "semanas" : "días";
  const confirmation = `${habit.name} ✓ — racha de ${today?.streak ?? 1} ${unidad}.`;
  emit({ kind: "tool_call", toolName: "log_habit(voz)", detail: confirmation });
  return c.json({ ok: true, confirmation, streak: today?.streak ?? 1 });
});

app.post("/tools/get_habits_today", async (c) => {
  const habits = await habitsToday();
  const goals = await listGoals("active");
  return c.json({
    habits: habits.map((h) => ({
      name: h.name,
      done_today: h.done_today,
      streak: h.streak,
      cadence: h.cadence,
      week_count: h.week_count,
      times_per_week: h.times_per_week,
    })),
    goals: goals.map((g) => ({
      title: g.title,
      progress:
        g.target_value != null
          ? `${g.current_value}/${g.target_value}${g.unit ? ` ${g.unit}` : ""}`
          : `${g.milestones.filter((m) => m.done).length}/${g.milestones.length} hitos`,
    })),
  });
});

app.post("/tools/update_goal", async (c) => {
  const b = await c.req
    .json<{ goal?: string; progress?: number; delta?: number; milestone?: string }>()
    .catch(() => ({}) as Record<string, never>);
  if (!b.goal?.trim()) return c.json({ ok: false, error: "goal requerido" }, 400);
  const goal = await resolveGoal(b.goal);
  if (!goal) {
    const titles = (await listGoals("active")).map((g) => g.title);
    return c.json({
      ok: false,
      error: `No encontré la meta "${b.goal}". Activas: ${titles.join(", ") || "ninguna"}.`,
    });
  }
  const updated = await updateGoal(goal.id, {
    currentValue: b.progress,
    delta: b.delta,
    milestoneDone: b.milestone,
  });
  if (!updated) return c.json({ ok: false, error: "no se pudo actualizar" }, 500);
  const progress =
    updated.target_value != null
      ? `${updated.current_value}/${updated.target_value}${updated.unit ? ` ${updated.unit}` : ""}`
      : `${updated.milestones.filter((m) => m.done).length}/${updated.milestones.length} hitos`;
  const confirmation =
    updated.status === "done"
      ? `¡Meta cumplida! ${updated.title} (${progress}).`
      : `${updated.title}: ${progress}.`;
  emit({ kind: "tool_call", toolName: "update_goal(voz)", detail: confirmation });
  return c.json({ ok: true, confirmation });
});

// ── Calendario: crear / mover / borrar eventos por voz (Google Calendar API) ──
// La voz confirma con el dueño ANTES de escribir (regla en el system prompt); estos
// endpoints ejecutan y devuelven una confirmación hablada. Cada escritura
// invalida el cache de lectura para que la agenda del dashboard salga fresca.
const CAL_DT_FMT = new Intl.DateTimeFormat("es-CO", {
  weekday: "long",
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: env.GOOGLE_CALENDAR_TZ,
});
const CAL_DATE_FMT = new Intl.DateTimeFormat("es-CO", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: env.GOOGLE_CALENDAR_TZ,
});

/** "el jueves 10 de julio a las 15:00" · "el jueves 10 de julio (todo el día)". */
function describeWhen(ev: { start: string; allDay: boolean }): string {
  const d = new Date(ev.start);
  return ev.allDay ? `${CAL_DATE_FMT.format(d)} (todo el día)` : CAL_DT_FMT.format(d);
}

interface CreateEventBody {
  title?: string;
  start?: string;
  end?: string;
  duration_min?: number;
  all_day?: boolean;
  description?: string;
  location?: string;
}
app.post("/tools/create_event", async (c) => {
  if (!gcal.isConfigured())
    return c.json({ ok: false, error: "Google Calendar no está conectado (falta el OAuth)." });
  const b = await c.req.json<CreateEventBody>().catch(() => ({}) as CreateEventBody);
  if (!b.title?.trim() || !b.start?.trim())
    return c.json({ ok: false, error: "Necesito al menos un título y una fecha/hora." }, 400);
  try {
    const ev = await gcal.createEvent({
      title: b.title,
      start: b.start,
      end: b.end,
      durationMin: b.duration_min,
      allDay: b.all_day,
      description: b.description,
      location: b.location,
    });
    invalidateCalendarCache();
    const confirmation = `Listo, agendé «${ev.title}» ${describeWhen(ev)}.`;
    emit({ kind: "tool_call", toolName: "create_event(voz)", detail: confirmation });
    return c.json({ ok: true, event_id: ev.id, confirmation });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[hermes] create_event", msg);
    return c.json({ ok: false, error: "No pude crear el evento en Google Calendar." });
  }
});

interface UpdateEventBody {
  event_id?: string;
  title?: string;
  start?: string;
  end?: string;
  duration_min?: number;
  all_day?: boolean;
  description?: string;
  location?: string;
}
app.post("/tools/update_event", async (c) => {
  if (!gcal.isConfigured())
    return c.json({ ok: false, error: "Google Calendar no está conectado (falta el OAuth)." });
  const b = await c.req.json<UpdateEventBody>().catch(() => ({}) as UpdateEventBody);
  if (!b.event_id?.trim())
    return c.json({ ok: false, error: "Falta el event_id (búscalo antes con find_events)." }, 400);
  try {
    const ev = await gcal.updateEvent(b.event_id, {
      title: b.title,
      start: b.start,
      end: b.end,
      durationMin: b.duration_min,
      allDay: b.all_day,
      description: b.description,
      location: b.location,
    });
    invalidateCalendarCache();
    const confirmation = `Actualicé «${ev.title}»: ahora es ${describeWhen(ev)}.`;
    emit({ kind: "tool_call", toolName: "update_event(voz)", detail: confirmation });
    return c.json({ ok: true, event_id: ev.id, confirmation });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[hermes] update_event", msg);
    return c.json({ ok: false, error: "No pude modificar el evento." });
  }
});

app.post("/tools/cancel_event", async (c) => {
  if (!gcal.isConfigured())
    return c.json({ ok: false, error: "Google Calendar no está conectado (falta el OAuth)." });
  const b = await c.req
    .json<{ event_id?: string; title?: string }>()
    .catch(() => ({}) as { event_id?: string; title?: string });
  if (!b.event_id?.trim())
    return c.json({ ok: false, error: "Falta el event_id (búscalo antes con find_events)." }, 400);
  try {
    await gcal.deleteEvent(b.event_id);
    invalidateCalendarCache();
    const confirmation = b.title ? `Cancelé «${b.title}».` : "Evento cancelado.";
    emit({ kind: "tool_call", toolName: "cancel_event(voz)", detail: confirmation });
    return c.json({ ok: true, confirmation });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[hermes] cancel_event", msg);
    return c.json({ ok: false, error: "No pude cancelar el evento." });
  }
});

app.post("/tools/find_events", async (c) => {
  if (!gcal.isConfigured())
    return c.json({ ok: false, error: "Google Calendar no está conectado (falta el OAuth)." });
  const b = await c.req
    .json<{ query?: string; days_ahead?: number }>()
    .catch(() => ({}) as { query?: string; days_ahead?: number });
  try {
    const daysAhead = b.days_ahead && b.days_ahead > 0 ? b.days_ahead : 30;
    const events = await gcal.findEvents(b.query?.trim() ?? "", {
      timeMax: new Date(Date.now() + daysAhead * 24 * 60 * 60_000),
    });
    return c.json({
      ok: true,
      count: events.length,
      events: events.map((ev) => ({
        event_id: ev.id,
        title: ev.title,
        when: describeWhen(ev),
        location: ev.location ?? undefined,
      })),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[hermes] find_events", msg);
    return c.json({ ok: false, error: "No pude buscar en el calendario." });
  }
});

// ── Token efímero de ElevenLabs (app móvil) ────────────────────────────
// La app React Native no puede tener la xi-api-key embebida; pide aquí un
// token efímero (WebRTC preferido, WebSocket de fallback) — igual que la ruta
// /api/elevenlabs/token del dashboard, pero servida por el agente para que el
// celular hable con los MISMOS agentes de voz sin exponer secretos.
// `?agent=tutor` = tutor de inglés; sin query = Hermes.
app.get("/elevenlabs/token", async (c) => {
  const apiKey = env.ELEVENLABS_API_KEY;
  const which = c.req.query("agent");
  const agentId = which === "tutor" ? env.ELEVENLABS_TUTOR_AGENT_ID : env.ELEVENLABS_AGENT_ID;
  if (!apiKey || !agentId) {
    return c.json(
      {
        notConfigured: true,
        error:
          which === "tutor"
            ? "Configura NEXT_PUBLIC_ELEVENLABS_TUTOR_AGENT_ID en .env (pnpm setup:elevenlabs lo crea)"
            : "Configura ELEVENLABS_API_KEY y NEXT_PUBLIC_ELEVENLABS_AGENT_ID en .env",
      },
      503,
    );
  }
  const headers = { "xi-api-key": apiKey };

  // WebRTC token (latencia más baja).
  const tokenRes = await fetch(
    `https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=${agentId}`,
    { headers },
  );
  if (tokenRes.ok) {
    const { token } = (await tokenRes.json()) as { token: string };
    return c.json({ conversationToken: token });
  }

  // Fallback WebSocket (signed url).
  const signedRes = await fetch(
    `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${agentId}`,
    { headers },
  );
  if (signedRes.ok) {
    const { signed_url } = (await signedRes.json()) as { signed_url: string };
    return c.json({ signedUrl: signed_url });
  }

  return c.json(
    { error: `ElevenLabs rechazó ambos métodos (${tokenRes.status}/${signedRes.status})` },
    502,
  );
});

// ── Stream de actividad en vivo (dashboard) ────────────────────────────
app.get("/events", (c) =>
  streamSSE(c, async (stream) => {
    for (const ev of recentEvents().slice(-30)) {
      await stream.writeSSE({ data: JSON.stringify(ev) });
    }
    let open = true;
    const unsubscribe = subscribe((ev) => {
      if (open) void stream.writeSSE({ data: JSON.stringify(ev) });
    });
    stream.onAbort(() => {
      open = false;
      unsubscribe();
    });
    // Heartbeat para mantener viva la conexión
    while (open) {
      await new Promise((r) => setTimeout(r, 15000));
      if (open) await stream.writeSSE({ event: "ping", data: String(Date.now()) });
    }
  }),
);

// ── Vitals para el dashboard ───────────────────────────────────────────
app.get("/stats", async (c) => {
  const projects = await readProjects();
  const tasks = listTasks();
  const today = new Date().toISOString().slice(0, 10);
  const dailyUsage = await getDailyUsage();
  return c.json({
    memories: await memoriesCount(),
    activeProjects: projects.filter((p) => p.estado === "activo").length,
    totalProjects: projects.length,
    sessionsToday: tasks.filter((t) => t.startedAt.startsWith(today)).length,
    tasksToday: tasks.filter((t) => t.startedAt.startsWith(today)).length,
    // Gasto real del día en runs de Claude Code (acumulador persistente).
    dailyRunCostUsd: dailyUsage.costUsd,
    runsToday: dailyUsage.runs,
    machine: env.MACHINE_NAME,
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    supabase: hasSupabase(),
    presence: getPresence(),
  });
});

app.get("/projects", async (c) => c.json(await readProjects()));

// Resuelve un .md del vault desde una referencia (wikilink `[[x]]` o ruta `x.md`)
// para el visor tipo Notion del dashboard. `project` desambigua nombres repetidos.
app.get("/vault/doc", async (c) =>
  c.json(await resolveVaultDoc(c.req.query("ref") ?? "", c.req.query("project") || undefined)),
);

// Contexto operativo de un proyecto (skills · MCP · tools · comandos).
app.get("/projects/:slug/context", async (c) =>
  c.json(await readProjectContext(c.req.param("slug"))),
);

// Abre el repo local del proyecto en Cursor (la ruta se resuelve en el server).
app.post("/projects/:slug/open-editor", async (c) => {
  const slug = c.req.param("slug");
  const project = (await readProjects()).find(
    (p) => p.slug.toLowerCase() === slug.toLowerCase(),
  );
  if (!project?.ruta_local) {
    return c.json({ ok: false, error: "el proyecto no tiene ruta_local en el vault" }, 400);
  }
  const res = await openInCursor(project.ruta_local);
  if (res.ok) emit({ kind: "tool_call", toolName: "open(cursor)", detail: project.name });
  return c.json(res, res.ok ? 200 : 500);
});

app.get("/memories/recent", async (c) => c.json(await recentMemories(12)));

// ── Datos del dashboard (rediseño) ─────────────────────────────────────
// Regla: nunca 500 — cada fuente degrada a su fallback y el panel del front
// se auto-oculta o muestra su CTA.

// Métricas del Mac local (CPU/RAM/disco/uptime).
app.get("/system", async (c) =>
  c.json(await getSystemMetrics(Math.floor((Date.now() - startedAt) / 1000))),
);

// Presencia de TODAS las Macs (agent_presence + estado local exacto).
app.get("/presence", async (c) => c.json(await listPresence()));

// Máquinas de la red interna: la misma presencia, pero pensada para el selector
// del dashboard (quién está vivo, cómo se le habla y qué puede hacer). Es una
// ruta propia porque el selector la pide antes de que cargue nada más.
app.get("/machines", async (c) => c.json({ machines: await listPresence() }));

// Conteos reales de la base de conocimiento (panel MEMORIA ACTIVA).
app.get("/knowledge/stats", async (c) => c.json(await knowledgeStats()));

// Grafo de código de graphify listo para el render 3D (tab MEMORIA).
app.get("/code-graph/graph", async (c) =>
  c.json(await readCodeGraph3D(c.req.query("project") || undefined)),
);

// Conteos del tracker por estado (+ ?project= y ?byProject=1).
app.get("/tracker/summary", async (c) =>
  c.json(
    await trackerSummary({
      project: c.req.query("project") || undefined,
      byProject: c.req.query("byProject") === "1",
    }),
  ),
);

// Clima (Open-Meteo, cache 20 min). 503 solo si nunca hubo un fetch exitoso.
app.get("/weather", async (c) => {
  const report = await getWeather();
  if (!report) return c.json({ error: "clima no disponible" }, 503);
  return c.json(report);
});

// Próximas reuniones (feed ICS privado de Google Calendar, cache 5 min).
// `back` (días hacia atrás) lo usa la página AGENDA para navegar a meses/
// semanas pasadas; sin él, la ventana hacia atrás es el lookback corto de 6h.
app.get("/calendar/upcoming", async (c) => {
  const back = c.req.query("back");
  return c.json(
    await getUpcomingCalendar(
      Number(c.req.query("days")) || 7,
      Number(c.req.query("limit")) || 10,
      back != null ? Number(back) : undefined,
    ),
  );
});

// Estado de los jobs periódicos (panel AUTOMATIZACIONES).
app.get("/jobs", (c) => c.json(listJobs()));

// Serie horaria de actividad (área chart 24h).
app.get("/activity/hourly", async (c) =>
  c.json(await activityHourly(Math.min(Number(c.req.query("hours")) || 24, 168))),
);

// Agregador: UN solo poll para todo el strip inferior + presencia. Cada
// sección es independiente (allSettled): si una fuente falla, llega null o
// su fallback y el resto vive.
app.get("/dashboard", async (c) => {
  const uptimeAgent = Math.floor((Date.now() - startedAt) / 1000);
  const [system, presence, knowledge, tracker, activity, weather, calendar, usage] =
    await Promise.allSettled([
      getSystemMetrics(uptimeAgent),
      listPresence(),
      knowledgeStats(),
      trackerSummary(),
      activityHourly(24),
      getWeather(),
      getUpcomingCalendar(),
      getDailyUsage(),
    ]);
  const val = <T,>(r: PromiseSettledResult<T>, fallback: T): T =>
    r.status === "fulfilled" ? r.value : fallback;
  return c.json({
    generatedAt: new Date().toISOString(),
    machine: env.MACHINE_NAME,
    system: val(system, {
      cpuPct: 0,
      loadAvg1: 0,
      memUsedPct: 0,
      memTotalBytes: 0,
      memUsedBytes: 0,
      diskUsedPct: 0,
      diskTotalBytes: 0,
      diskFreeBytes: 0,
      uptimeOsSeconds: 0,
      uptimeAgentSeconds: uptimeAgent,
    }),
    presence: val(presence, []),
    knowledge: val(knowledge, {
      available: false,
      total: 0,
      memories: 0,
      vaultDocs: 0,
      meetings: 0,
      executions: 0,
      conversationText: 0,
      conversationVoice: 0,
    }),
    tracker: val(tracker, {
      available: false,
      pending: 0,
      running: 0,
      done: 0,
      dismissed: 0,
    }),
    jobs: listJobs(),
    activity: val(activity, null),
    weather: val(weather, null),
    calendar: val(calendar, { configured: false, fetchedAt: null, stale: false, events: [] }),
    usage: val(usage, { costUsd: 0, runs: 0 }),
  });
});

// ── Boot ───────────────────────────────────────────────────────────────
startSystemSampler(); // sampler de CPU (5s) para GET /system
void readProjects(); // primer parse + sync a projects_cache
void reconcileRunningTasks(); // arregla tareas 'running' huérfanas de un reinicio
void recoverOrphanLiveMeetings(); // ingesta juntas en vivo que un reinicio dejó a medias

// Jobs periódicos con estado observable (GET /jobs → panel AUTOMATIZACIONES).
// Presencia: latido para que otras Macs sepan que estamos vivos.
registerJob("presence-heartbeat", 30_000, pushPresence, () =>
  hasSupabase() ? "latido enviado" : null,
);
// Índice semántico del vault: por hash — si nada cambió, 0 llamadas a OpenAI.
registerJob("vault-knowledge-sync", 10 * 60_000, syncVaultKnowledge, (r) =>
  r ? `${r.indexed} notas vectorizadas, ${r.removed} eliminadas (${r.scanned} escaneadas)` : null,
);
// Transcripts de voz de ElevenLabs → conversation_messages.
registerJob("voice-transcripts", 5 * 60_000, syncVoiceTranscripts, (r) =>
  r ? `${r.mirrored} conversaciones espejadas (${r.turns} turnos de ${r.checked})` : null,
);
// Publicación del Estudio: sube lo pendiente y verifica lo ya programado.
// La cola vive en Postgres a propósito — este registro se resetea en cada
// reinicio, así que el barrido tiene que ser "escanea y actúa" (self-healing).
registerJob("content-publish", 5 * 60_000, publishSweep, (r) =>
  r && (r.launched || r.verified)
    ? `${r.launched} subida(s) lanzada(s), ${r.verified} verificada(s) en vivo (${r.scanned} piezas)`
    : null,
);
// Bucle de resultados del Estudio: métricas reales de lo publicado (Data API
// hoy; Analytics API con retención cuando el token tenga el scope). Upsert por
// (remote_id, source, day) — idempotente entre corridas y reinicios.
registerJob("content-metrics-sync", 6 * 60 * 60_000, metricsSweep, (r) =>
  r
    ? `${r.videos} video(s): ${r.rows} fila(s) de métricas, ${r.retentionPoints} puntos de retención${r.dataError ? ` · Data API: ${r.dataError}` : ""}${r.analyticsSkipped ? ` · Analytics: ${r.analyticsSkipped}` : ""}`
    : null,
);
// Grafo de código (graphify): refresca hermes-os + proyectos activos con repo git.
registerJob("code-graph-update", 6 * 60 * 60_000, updateCodeGraph, (r) =>
  r
    ? `${r.total} repos: ${r.updated} actualizados, ${r.built} nuevos${r.failed ? `, ${r.failed} con error` : ""}`
    : null,
);

// Bind explícito: sin API key SOLO loopback (antes escuchaba en todas las
// interfaces con la LAN sin auth); con key se abre a 0.0.0.0 para que otra
// Mac llegue por Tailscale con Bearer/?key=.
const hostname = env.HERMES_API_KEY ? "0.0.0.0" : "127.0.0.1";
// WS nativo de @hono/node-server v2: el server de `ws` va en noServer y el
// adapter le enruta los upgrades que pasaron por la app (auth incluida).
const wss = new WebSocketServer({ noServer: true });
serve({ fetch: app.fetch, port: env.PORT, hostname, websocket: { server: wss } }, (info) => {
  console.log(`\n⚡ Hermes agent server → http://localhost:${info.port}`);
  console.log(
    env.HERMES_API_KEY
      ? "   modo: RED (0.0.0.0) con HERMES_API_KEY — accesible vía Tailscale"
      : "   modo: solo esta máquina (127.0.0.1)",
  );
  console.log(`   vault: ${env.VAULT_PATH || "(sin configurar)"}`);
  console.log(`   supabase: ${hasSupabase() ? "conectado" : "no configurado"}`);
});
