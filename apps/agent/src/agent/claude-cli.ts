/**
 * Ejecuta el CLI real de Claude Code (`claude`) desde el agent server.
 *
 * Dos modos, ambos con Modelo + Esfuerzo + Modo de permisos configurables:
 *  1. Terminal.app real (interactiva)  → openClaudeTerminal()  vía osascript.
 *  2. Panel embebido (headless stream) → startClaudeRun() spawnea
 *     `claude -p --output-format stream-json` y transmite los eventos por SSE.
 *
 * Seguridad: los tres parámetros se validan contra allowlists y el prompt
 * viaja SIEMPRE como un único argumento (spawn con array, sin shell) o
 * escapado con comillas simples en el script temporal de Terminal.app.
 */
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import type { ClaudeRunSummary } from "@hermes/shared";
import { env } from "../env.js";
import { addRunCost } from "../usage.js";
import { notifyMac } from "../notify.js";
import { emit } from "../events.js";
import { startSession, finishSession, checkpointSession } from "./claude-sessions.js";

// ── Allowlists (rechaza cualquier valor no esperado) ───────────────────
const MODELS = new Set([
  "opus", "sonnet", "haiku", "fable",
  "claude-opus-4-8", "claude-sonnet-5", "claude-haiku-4-5", "claude-fable-5",
]);
const EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);
const PERMISSIONS = new Set(["default", "acceptEdits", "plan", "manual", "auto"]);
// Valores de UI/legacy → modos reales del CLI.
const PERMISSION_CLI_MAP: Record<string, string> = {
  manual: "default",
  auto: "acceptEdits",
};

export interface ClaudeExecOpts {
  prompt: string;
  model?: string;
  effort?: string;
  permissionMode?: string;
  /** Nombre del proyecto en foco → se antepone como contexto al prompt. */
  projectContext?: string;
  /** Directorio donde correr `claude` (repo del proyecto). Default: VAULT_PATH. */
  cwd?: string;
  /** Slug del proyecto para persistir la sesión (o "general"). */
  projectSlug?: string;
  /** Id estable de la sesión Hermes; se pasa como --session-id en corrida nueva. */
  sessionId?: string;
  /** Si se resume: id de sesión del CLI para `claude --resume <id>`. */
  resumeSdkSessionId?: string;
}

function sanitize(opts: ClaudeExecOpts) {
  const model = MODELS.has(opts.model ?? "") ? opts.model! : "sonnet";
  const effort = EFFORTS.has(opts.effort ?? "") ? opts.effort! : "high";
  // Sin modo explícito → "default" (pide permisos / deniega en headless).
  // Los disparos sin humano en el loop (voz, triage de reuniones, tareas)
  // no mandan permissionMode, así que NUNCA heredan acceptEdits solos.
  const requested = PERMISSIONS.has(opts.permissionMode ?? "")
    ? opts.permissionMode!
    : "default";
  const permissionMode = PERMISSION_CLI_MAP[requested] ?? requested;
  let prompt = (opts.prompt ?? "").trim();
  if (opts.projectContext) {
    prompt = `Contexto: enfócate en el proyecto "${opts.projectContext}".\n\n${prompt}`;
  }
  return { model, effort, permissionMode, prompt };
}

// Guardrails espejo de guardrails.ts para el CLI real: deny-list de Bash
// destructivo y lecturas sensibles, aplicada vía --settings en TODA invocación
// (el canUseTool del SDK no cubre esta ruta).
const GUARDRAIL_SETTINGS = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../claude-settings.json",
);

function commonFlags(s: { model: string; effort: string; permissionMode: string }): string[] {
  const flags = [
    "--model", s.model,
    "--effort", s.effort,
    "--permission-mode", s.permissionMode,
  ];
  if (existsSync(GUARDRAIL_SETTINGS)) flags.push("--settings", GUARDRAIL_SETTINGS);
  return flags;
}

// Ubica el binario `claude` (el server puede no tener ~/.local/bin en PATH).
let cachedBin: string | null = null;
function resolveClaudeBin(): string {
  if (cachedBin) return cachedBin;
  const candidates = [
    process.env.CLAUDE_BIN,
    join(process.env.HOME ?? "", ".local/bin/claude"),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
  ].filter(Boolean) as string[];
  for (const c of candidates) {
    try {
      if (existsSync(c)) return (cachedBin = c);
    } catch {
      /* sigue */
    }
  }
  return (cachedBin = "claude"); // fallback a PATH
}

const sq = (s: string) => `'${String(s).replace(/'/g, `'\\''`)}'`;

// ── Modo 1: Terminal.app real (interactiva) ────────────────────────────
export async function openClaudeTerminal(
  opts: ClaudeExecOpts,
): Promise<{ ok: boolean; error?: string }> {
  const s = sanitize(opts);
  if (!s.prompt) return { ok: false, error: "prompt vacío" };
  const bin = resolveClaudeBin();
  const cwd = env.VAULT_PATH || process.cwd();
  const flags = commonFlags(s).map(sq).join(" ");

  // Script temporal: evita el infierno de comillas anidadas de AppleScript y
  // mantiene el prompt fuera del shell (escapado con comillas simples).
  const script = `#!/bin/bash
cd ${sq(cwd)} || exit 1
echo "▸ Hermes → Claude Code (${s.model} · ${s.effort} · ${s.permissionMode})"
${sq(bin)} ${flags} -- ${sq(s.prompt)}
`;
  const file = join(tmpdir(), `hermes-claude-${randomUUID().slice(0, 8)}.sh`);
  await writeFile(file, script, { mode: 0o700 });

  const osa = `tell application "Terminal"
  activate
  do script "/bin/bash ${file}"
end tell`;

  return new Promise((resolve) => {
    execFile("osascript", ["-e", osa], (err) => {
      if (err) resolve({ ok: false, error: err.message });
      else resolve({ ok: true });
    });
  });
}

// ── Modo 2: panel embebido (headless, stream-json → SSE) ───────────────
export interface ClaudeLine {
  t: number;
  kind: "init" | "text" | "tool" | "result" | "done" | "error" | "raw";
  text: string;
}
interface ClaudeRun {
  id: string;
  status: "running" | "done" | "error";
  startedAt: string;
  model: string;
  effort: string;
  permissionMode: string;
  /** Prompt recortado, como etiqueta en el panel Orquestador. */
  title: string;
  exitCode?: number;
  /** Métricas del evento result del CLI (solo al terminar). */
  costUsd?: number;
  durationMs?: number;
  numTurns?: number;
  /** true si el run murió por killClaudeRun (para reportarlo distinto). */
  cancelled?: boolean;
  lines: ClaudeLine[];
  subscribers: Set<(line: ClaudeLine) => void>;
  proc?: ChildProcess;
  /** Id estable de la sesión Hermes (persistencia + UI). */
  sessionId: string;
  projectSlug: string;
  /** Id de sesión del CLI para el próximo `--resume` (se actualiza en init). */
  sdkSessionId?: string;
  /** Cuántas de run.lines ya se checkpointearon al disco (cursor). */
  persistedCount: number;
}

const runs = new Map<string, ClaudeRun>();
const MAX_LINES = 800;
const RUN_EVICT_MS = 5 * 60 * 1000; // evicta runs terminadas tras 5 min

function pushLine(run: ClaudeRun, line: ClaudeLine) {
  run.lines.push(line);
  if (run.lines.length > MAX_LINES) run.lines.shift();
  for (const fn of run.subscribers) {
    try {
      fn(line);
    } catch {
      /* subscriber caído */
    }
  }
}

// Vuelca al disco la cola de líneas aún no persistida (checkpoint). Mantiene la
// sesión "running": si el run se corta a mitad (crash/reinicio del agente), su
// transcript parcial ya quedó en disco y se puede ver/continuar.
function checkpointRun(run: ClaudeRun) {
  const tail = run.lines.slice(run.persistedCount);
  if (!tail.length) return;
  run.persistedCount = run.lines.length;
  void checkpointSession({
    id: run.sessionId,
    projectSlug: run.projectSlug,
    appendLines: tail,
    sdkSessionId: run.sdkSessionId,
  });
}

// Traduce un evento stream-json del CLI a una línea de terminal legible.
function eventToLines(ev: Record<string, unknown>): ClaudeLine[] {
  const now = Date.now();
  const out: ClaudeLine[] = [];
  const type = ev.type as string;
  if (type === "system" && (ev.subtype as string) === "init") {
    out.push({ t: now, kind: "init", text: `session ${String(ev.session_id ?? "").slice(0, 8)} lista` });
  } else if (type === "assistant") {
    const msg = (ev.message as Record<string, unknown>) ?? {};
    const content = (msg.content as Array<Record<string, unknown>>) ?? [];
    for (const block of Array.isArray(content) ? content : []) {
      if (block.type === "text" && block.text) {
        out.push({ t: now, kind: "text", text: String(block.text) });
      } else if (block.type === "tool_use") {
        // El plan de 'plan mode' viaja en el input de ExitPlanMode → mostrarlo completo.
        const inp = block.input as Record<string, unknown> | undefined;
        if (block.name === "ExitPlanMode" && inp && typeof inp.plan === "string") {
          out.push({ t: now, kind: "text", text: inp.plan });
          continue;
        }
        const input = JSON.stringify(block.input ?? {});
        out.push({
          t: now,
          kind: "tool",
          text: `${block.name} ${input.length > 160 ? input.slice(0, 160) + "…" : input}`,
        });
      }
    }
  } else if (type === "user") {
    const msg = (ev.message as Record<string, unknown>) ?? {};
    const content = (msg.content as Array<Record<string, unknown>>) ?? [];
    for (const block of Array.isArray(content) ? content : []) {
      if (block.type === "tool_result") {
        const raw =
          typeof block.content === "string" ? block.content : JSON.stringify(block.content ?? "");
        out.push({ t: now, kind: "result", text: raw.slice(0, 200) });
      }
    }
  } else if (type === "result") {
    const dur = ev.duration_ms ? `${Math.round((ev.duration_ms as number) / 100) / 10}s` : "";
    const turns = ev.num_turns != null ? `${ev.num_turns} turnos` : "";
    const meta = [turns, dur].filter(Boolean).join(" · ");
    out.push({ t: now, kind: "done", text: `terminado${meta ? ` (${meta})` : ""}` });
  }
  return out;
}

export function startClaudeRun(opts: ClaudeExecOpts): ClaudeRun {
  const s = sanitize(opts);
  const bin = resolveClaudeBin();
  const cwd = opts.cwd || env.VAULT_PATH || process.cwd();
  const projectSlug = opts.projectSlug || "general";
  const sessionId = opts.sessionId || randomUUID();
  const isResume = !!opts.resumeSdkSessionId;
  const sdk = opts.resumeSdkSessionId || sessionId;
  const run: ClaudeRun = {
    id: randomUUID().slice(0, 8),
    status: "running",
    startedAt: new Date().toISOString(),
    model: s.model,
    effort: s.effort,
    permissionMode: s.permissionMode,
    title: s.prompt.slice(0, 120),
    lines: [],
    subscribers: new Set(),
    sessionId,
    projectSlug,
    sdkSessionId: sdk,
    persistedCount: 0,
  };
  runs.set(run.id, run);

  pushLine(run, {
    t: Date.now(),
    kind: "init",
    text: `claude -p · ${s.model} · esfuerzo ${s.effort} · ${s.permissionMode}${isResume ? " · resume" : ""}`,
  });
  // Eco del prompt en el transcript → al reabrir la sesión se reconoce.
  pushLine(run, { t: Date.now(), kind: "text", text: `❯ ${s.prompt.slice(0, 300)}` });

  // Registra/toca la sesión en disco (aparece en la lista aun mientras corre).
  void startSession({
    id: sessionId,
    projectSlug,
    title: s.prompt,
    model: s.model,
    effort: s.effort,
    permissionMode: s.permissionMode,
    cwd,
    sdkSessionId: sdk,
    isResume,
  });

  const args = [
    ...commonFlags(s),
    "-p",
    "--output-format", "stream-json",
    "--verbose",
  ];
  // Resume por id previo, o asigna un id nuevo a esta sesión.
  if (opts.resumeSdkSessionId) args.push("--resume", opts.resumeSdkSessionId);
  else args.push("--session-id", sessionId);
  // `--` cierra las opciones: un prompt que empiece con "-" no se lee como flag.
  args.push("--", s.prompt);

  let proc: ChildProcess;
  try {
    // stdin cerrado ('ignore') → claude -p no espera 3s por datos por tubería.
    proc = spawn(bin, args, { cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    run.status = "error";
    pushLine(run, { t: Date.now(), kind: "error", text: `no se pudo iniciar claude: ${String(err)}` });
    void finishSession({
      id: run.sessionId,
      projectSlug: run.projectSlug,
      newLines: run.lines.slice(run.persistedCount),
      status: "error",
      sdkSessionId: run.sdkSessionId,
    });
    return run;
  }
  run.proc = proc;

  // setEncoding('utf8') → los chunks llegan ya decodificados y un carácter
  // multibyte (á, ñ, emoji) partido entre chunks no se corrompe.
  proc.stdout?.setEncoding("utf8");
  proc.stderr?.setEncoding("utf8");

  let buffer = "";
  proc.stdout?.on("data", (chunk: string) => {
    buffer += chunk;
    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const raw = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!raw) continue;
      try {
        const ev = JSON.parse(raw);
        // El init reporta el session_id real del CLI → lo adoptamos para resume
        // (cubre el caso en que el CLI forkee a un id distinto del asignado).
        if (ev?.type === "system" && ev?.subtype === "init" && typeof ev.session_id === "string") {
          run.sdkSessionId = ev.session_id;
        }
        // Métricas reales del run (costo/duración/turnos) → Orquestador y
        // acumulado diario. El CLI las reporta solo en el evento result final.
        if (ev?.type === "result") {
          if (typeof ev.total_cost_usd === "number") run.costUsd = ev.total_cost_usd;
          if (typeof ev.duration_ms === "number") run.durationMs = ev.duration_ms;
          if (typeof ev.num_turns === "number") run.numTurns = ev.num_turns;
        }
        for (const line of eventToLines(ev)) pushLine(run, line);
      } catch {
        pushLine(run, { t: Date.now(), kind: "raw", text: raw.slice(0, 200) });
      }
    }
    // Checkpoint periódico: un run cortado a mitad conserva su transcript.
    if (run.lines.length - run.persistedCount >= 12) checkpointRun(run);
  });
  proc.stderr?.on("data", (chunk: string) => {
    const text = chunk.trim();
    if (text) pushLine(run, { t: Date.now(), kind: "error", text: text.slice(0, 200) });
  });
  proc.on("error", (err) => {
    run.status = "error";
    pushLine(run, { t: Date.now(), kind: "error", text: String(err.message) });
  });
  // Checkpoint por tiempo: aunque el run sea corto, su transcript queda en disco
  // a los pocos segundos (un corte/reinicio pierde a lo sumo ~3s de líneas).
  const ckptTimer = setInterval(() => checkpointRun(run), 3000);
  proc.on("close", (code) => {
    clearInterval(ckptTimer);
    run.exitCode = code ?? undefined;
    if (run.status !== "error") run.status = code === 0 ? "done" : "error";
    pushLine(run, {
      t: Date.now(),
      kind: run.status === "done" ? "done" : "error",
      text: `proceso finalizó (código ${code ?? "?"})`,
    });
    // Cierra el loop: suma al gasto del día y avisa aunque nadie mire el dashboard.
    addRunCost(run.costUsd);
    const meta = [
      run.costUsd != null ? `$${run.costUsd.toFixed(2)}` : null,
      run.durationMs != null ? `${Math.round(run.durationMs / 1000)}s` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    notifyMac(
      run.projectSlug,
      run.cancelled
        ? `⏹ run cancelado: ${run.title.slice(0, 80)}`
        : run.status === "done"
          ? `✅ terminó${meta ? ` (${meta})` : ""}: ${run.title.slice(0, 80)}`
          : `❌ falló (código ${code ?? "?"}): ${run.title.slice(0, 80)}`,
    );
    // Cierre en el bus de actividad → Toasts del dashboard y anuncio por voz
    // (VoiceEventsBridge). Antes solo las tareas del SDK emitían task_done, así
    // que un run de Claude Code terminaba en silencio para la UI y la voz.
    const preview =
      [...run.lines]
        .reverse()
        .find((l) => l.kind === "text" && !l.text.startsWith("❯ "))
        ?.text.slice(0, 200) ?? run.title.slice(0, 120);
    emit({
      kind: run.status === "done" ? "task_done" : "error",
      taskId: run.id,
      toolName: `claude(${run.projectSlug})`,
      detail: run.cancelled
        ? `cancelado: ${run.title.slice(0, 100)}`
        : run.status === "done"
          ? `${meta ? `${meta} · ` : ""}${preview}`
          : `falló (código ${code ?? "?"}): ${run.title.slice(0, 100)}`,
    });
    // Persiste el transcript en la sesión (para reabrirla/listarla luego).
    void finishSession({
      id: run.sessionId,
      projectSlug: run.projectSlug,
      newLines: run.lines.slice(run.persistedCount),
      status: run.status === "done" ? "done" : "error",
      sdkSessionId: run.sdkSessionId,
    });
    // Libera el handle muerto y programa la evicción (deja ventana para que
    // una reconexión SSE tardía todavía pueda re-transmitir el historial).
    run.proc = undefined;
    setTimeout(() => runs.delete(run.id), RUN_EVICT_MS);
  });

  return run;
}

export function getClaudeRun(id: string): ClaudeRun | undefined {
  return runs.get(id);
}

/**
 * Resumen de todos los runs vivos (en curso o terminados hace <5 min, ver
 * RUN_EVICT_MS), ordenados del más reciente al más antiguo. Alimenta el panel
 * Orquestador del dashboard (GET /claude/runs).
 */
export function listClaudeRuns(): ClaudeRunSummary[] {
  return [...runs.values()]
    .map((run) => ({
      id: run.id,
      sessionId: run.sessionId,
      projectSlug: run.projectSlug,
      title: run.title,
      status: run.status,
      startedAt: run.startedAt,
      model: run.model,
      effort: run.effort,
      toolCalls: run.lines.filter((l) => l.kind === "tool").length,
      exitCode: run.exitCode,
      costUsd: run.costUsd,
      durationMs: run.durationMs,
      numTurns: run.numTurns,
      // Último texto del asistente como preview del resultado (sin el eco
      // "❯ prompt" que también es kind text).
      lastText: [...run.lines]
        .reverse()
        .find((l) => l.kind === "text" && !l.text.startsWith("❯ "))
        ?.text.slice(0, 160),
    }))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/**
 * Cancela un run en curso: SIGTERM y, si el proceso sigue vivo a los 5s,
 * SIGKILL. El handler `close` existente se encarga de persistir la sesión,
 * sumar el gasto y notificar.
 */
export function killClaudeRun(id: string): { ok: boolean; error?: string } {
  const run = runs.get(id);
  if (!run) return { ok: false, error: "run no encontrada" };
  if (run.status !== "running" || !run.proc) {
    return { ok: false, error: "el run ya no está corriendo" };
  }
  run.cancelled = true;
  run.status = "error"; // close respeta un status error ya fijado
  pushLine(run, { t: Date.now(), kind: "error", text: "cancelado por el usuario" });
  const proc = run.proc;
  try {
    proc.kill("SIGTERM");
  } catch (err) {
    return { ok: false, error: String(err).slice(0, 200) };
  }
  // proc.killed solo indica que YA se le envió una señal (el SIGTERM de
  // arriba), no que murió: la señal de vida real es exitCode === null.
  const hardKill = setTimeout(() => {
    try {
      if (proc.exitCode === null) proc.kill("SIGKILL");
    } catch {
      /* ya murió */
    }
  }, 5000);
  proc.once("close", () => clearTimeout(hardKill));
  return { ok: true };
}

export function subscribeClaudeRun(
  id: string,
  onLine: (line: ClaudeLine) => void,
): (() => void) | null {
  const run = runs.get(id);
  if (!run) return null;
  run.subscribers.add(onLine);
  return () => run.subscribers.delete(onLine);
}
