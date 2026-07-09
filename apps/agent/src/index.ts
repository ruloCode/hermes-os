import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import { streamSSE } from "hono/streaming";
import type { MeetingSource, TaskState } from "@hermes/shared";
import { env } from "./env.js";
import { emit, recentEvents, subscribe } from "./events.js";
import { getPresence, startHeartbeat } from "./presence.js";
import { readProjects } from "./vault/projects.js";
import { readProjectContext } from "./vault/project-context.js";
import { resolveVaultDoc } from "./vault/doc.js";
import { memoriesCount, recentMemories, saveMemory, searchMemory, hasSupabase } from "./memory.js";
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
import { listMeetings, getMeeting, searchMeetings } from "./meetings/store.js";
import { startMeetingJob, getMeetingJob } from "./meetings/ingest.js";
import { listExecutions, getExecution } from "./tasks/executions.js";
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
} from "./tasks/store.js";
import { openInCursor } from "./agent/editor.js";
import {
  listClaudeSessions,
  getClaudeSession,
  deleteClaudeSession,
} from "./agent/claude-sessions.js";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join as joinPath } from "node:path";

const app = new Hono();
const startedAt = Date.now();

const expandHome = (p: string) => (p.startsWith("~") ? joinPath(homedir(), p.slice(1)) : p);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

app.use(
  "*",
  cors({
    origin: (origin) =>
      !origin || /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin) ? origin : "",
    allowHeaders: [
      "Content-Type",
      "Authorization",
      "X-Hermes-Session-Id",
      "X-Hermes-Project",
      "X-Hermes-Resume",
    ],
  }),
);

// Bearer opcional: solo se exige si HERMES_API_KEY está configurada (multi-Mac
// vía Tailscale). Los SSE usan EventSource, que no puede mandar headers → en
// rutas GET se acepta también el token como query ?key=.
app.use("*", async (c, next) => {
  if (env.HERMES_API_KEY && c.req.path !== "/health") {
    const auth = c.req.header("Authorization") ?? "";
    const queryKey = c.req.method === "GET" ? (c.req.query("key") ?? "") : "";
    if (auth !== `Bearer ${env.HERMES_API_KEY}` && queryKey !== env.HERMES_API_KEY) {
      return c.json({ error: "unauthorized" }, 401);
    }
  }
  await next();
});

app.get("/health", (c) =>
  c.json({ ok: true, machine: env.MACHINE_NAME, uptime: (Date.now() - startedAt) / 1000 }),
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
      const job = startMeetingJob({ project, transcript, title, source: "paste" });
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

// Búsqueda semántica en el historial de reuniones (?q= &project=).
app.get("/meetings/search", async (c) => {
  const q = c.req.query("q") ?? "";
  if (!q.trim()) return c.json([]);
  return c.json(await searchMeetings(q, c.req.query("project") || undefined, 8));
});

// Historial de reuniones de un proyecto.
app.get("/meetings/:project", async (c) => c.json(await listMeetings(c.req.param("project"))));

// Detalle de una reunión (resumen + accionables + transcripción).
app.get("/meetings/:project/:id", async (c) => {
  const meeting = await getMeeting(c.req.param("project"), c.req.param("id"));
  if (!meeting) return c.json({ error: "reunión no encontrada" }, 404);
  return c.json(meeting);
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
    return c.json({ task: await createTask({ ...base, status: "dismissed" }) });
  }
  if (decision === "pendiente") {
    return c.json({ task: await createTask({ ...base, status: "pending" }) });
  }
  if (decision === "ejecutar") {
    const task = await createTask({ ...base, status: "pending" });
    if (!task) return c.json({ error: "no se pudo crear la tarea (¿Supabase?)" }, 500);
    const res = await executeTask(task.id);
    if (!res) return c.json({ error: "no se pudo ejecutar la tarea" }, 500);
    return c.json({
      task: { ...task, status: "running", run_id: res.runId },
      run_id: res.runId,
      session_id: res.sessionId,
      slug: res.slug,
    });
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
    if (p?.ruta_local) cwd = expandHome(p.ruta_local);
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

app.post("/tools/search_memory", async (c) => {
  const { query } = await c.req.json<{ query?: string }>();
  if (!query) return c.json([]);
  const results = await searchMemory(query, undefined, 5);
  return c.json(
    results.map((m) => ({
      type: m.type,
      content: m.content.slice(0, 400),
      project: m.project_slug,
      fecha: m.created_at.slice(0, 10),
    })),
  );
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

app.post("/tools/get_daily_brief", async (c) => {
  const projects = (await readProjects()).filter((p) => p.estado === "activo");
  const brief = projects
    .map(
      (p) =>
        `${p.name}: ${p.estado_actual.split("\n")[0]?.slice(0, 150) || "sin estado"}. Próximo: ${p.tareas_pendientes[0] ?? "nada pendiente"}.`,
    )
    .join(" \n");
  return c.json({ brief: brief || "No hay proyectos activos en el vault." });
});

// ── Token efímero de ElevenLabs (app móvil) ────────────────────────────
// La app React Native no puede tener la xi-api-key embebida; pide aquí un
// token efímero (WebRTC preferido, WebSocket de fallback) — igual que la ruta
// /api/elevenlabs/token del dashboard, pero servida por el agente para que el
// celular hable con el MISMO agente de voz "Hermes" sin exponer secretos.
app.get("/elevenlabs/token", async (c) => {
  const apiKey = env.ELEVENLABS_API_KEY;
  const agentId = env.ELEVENLABS_AGENT_ID;
  if (!apiKey || !agentId) {
    return c.json(
      {
        notConfigured: true,
        error: "Configura ELEVENLABS_API_KEY y NEXT_PUBLIC_ELEVENLABS_AGENT_ID en .env",
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

// ── Boot ───────────────────────────────────────────────────────────────
startHeartbeat();
void readProjects(); // primer parse + sync a projects_cache
void reconcileRunningTasks(); // arregla tareas 'running' huérfanas de un reinicio

// Bind explícito: sin API key SOLO loopback (antes escuchaba en todas las
// interfaces con la LAN sin auth); con key se abre a 0.0.0.0 para que otra
// Mac llegue por Tailscale con Bearer/?key=.
const hostname = env.HERMES_API_KEY ? "0.0.0.0" : "127.0.0.1";
serve({ fetch: app.fetch, port: env.PORT, hostname }, (info) => {
  console.log(`\n⚡ Hermes agent server → http://localhost:${info.port}`);
  console.log(
    env.HERMES_API_KEY
      ? "   modo: RED (0.0.0.0) con HERMES_API_KEY — accesible vía Tailscale"
      : "   modo: solo esta máquina (127.0.0.1)",
  );
  console.log(`   vault: ${env.VAULT_PATH || "(sin configurar)"}`);
  console.log(`   supabase: ${hasSupabase() ? "conectado" : "no configurado"}`);
});
