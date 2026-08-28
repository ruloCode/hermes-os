/**
 * Memoria de ejecuciones del tracker (Control de Misión). Por cada Ejecutar /
 * Continuar de una tarea se genera un documento {prompt · análisis · resultado}.
 * Fuente de verdad: markdown en el vault (projects/<slug>/ejecuciones/<id>.md);
 * espejo best-effort en Supabase (task_executions) para historial/consulta.
 *
 * El "análisis" lo redacta Claude vía el Agent SDK (mismo patrón que ingest de
 * reuniones: tool MCP acotada `record_execution_analysis`), y se acompaña del
 * trace de pasos/herramientas del run. Sin Supabase, todo degrada a solo-vault.
 */
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import matter from "gray-matter";
import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type {
  RunTokenUsage,
  Task,
  TaskExecution,
  TaskExecutionKind,
  TaskExecutionStatus,
  TaskExecutionSummary,
} from "@hermes/shared";
import { env } from "../env.js";
import { supabase } from "../supabase.js";
import { embed } from "../embeddings.js";
import { safeName } from "../conversations.js";
import { extractSection, readProjects } from "../vault/projects.js";
import type { ClaudeLine } from "../agent/claude-cli.js";
import { OWNER } from "../owner.js";

// ── Entrada desde el punto de captura (launch en tasks/store.ts) ────────

export interface SaveExecutionInput {
  task: Task;
  /** prompt de intención que se envió (exec_prompt o el de continuar). */
  prompt: string;
  kind: TaskExecutionKind;
  runId: string;
  sessionId: string;
  /** slug real del proyecto (carpeta del vault). */
  slug: string;
  status: TaskExecutionStatus;
  /** transcript del run (run.lines), fuente del trace y del pase LLM. */
  lines: ClaudeLine[];
  model: string;
  effort: string;
  costUsd?: number;
  durationMs?: number;
  numTurns?: number;
  /** Tokens del run (evento result del CLI); se espejan en task_executions. */
  usage?: RunTokenUsage;
}

// ── Helpers de ruta / id / idempotencia ────────────────────────────────

async function realSlug(slug: string): Promise<string> {
  const p = (await readProjects()).find((x) => x.slug.toLowerCase() === slug.toLowerCase());
  return p?.slug ?? slug;
}

function executionsDir(realProjectSlug: string): string {
  return join(env.VAULT_PATH, "projects", realProjectSlug, "ejecuciones");
}

/** id = 2026-07-07-1830-a1b2c3d4 (fecha + run acortado; nombre del .md sin ext). */
function makeExecutionId(fecha: Date, runId: string): string {
  const iso = fecha.toISOString();
  const day = iso.slice(0, 10);
  const hm = iso.slice(11, 16).replace(":", "");
  const rid = runId.replace(/[^a-z0-9]/gi, "").slice(0, 8) || "run";
  return `${day}-${hm}-${rid}`;
}

function execLocalKey(slug: string, runId: string): string {
  return createHash("sha1").update(`${safeName(slug)}|${runId}`).digest("hex");
}

function toIso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return v ? String(v) : "";
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

// ── Formateo del transcript / trace / resultado ────────────────────────

/** El resultado = último texto del asistente que no es el eco "❯ prompt". */
function finalText(lines: ClaudeLine[]): string {
  const last = [...lines].reverse().find((l) => l.kind === "text" && !l.text.startsWith("❯ "));
  return last?.text.trim() ?? "";
}

/** Trace legible de pasos: herramientas usadas, narración y errores. */
function formatTrace(lines: ClaudeLine[]): string {
  const rows: string[] = [];
  for (const l of lines) {
    if (l.kind === "tool") {
      rows.push(`- 🔧 ${l.text}`);
    } else if (l.kind === "error") {
      rows.push(`- ⚠️ ${l.text}`);
    } else if (l.kind === "text" && !l.text.startsWith("❯ ")) {
      const t = l.text.replace(/\s+/g, " ").trim();
      if (t) rows.push(`- 💬 ${t.length > 240 ? t.slice(0, 240) + "…" : t}`);
    }
  }
  return rows.length ? rows.join("\n") : "_(sin pasos registrados)_";
}

/** Transcript plano para alimentar el pase LLM (recorta a la cola si es largo). */
function transcriptForLlm(lines: ClaudeLine[], maxChars = 16_000): string {
  const parts: string[] = [];
  for (const l of lines) {
    if (l.kind === "tool") parts.push(`[TOOL] ${l.text}`);
    else if (l.kind === "result") parts.push(`[RESULTADO_TOOL] ${l.text}`);
    else if (l.kind === "error") parts.push(`[ERROR] ${l.text}`);
    else if (l.kind === "text" && !l.text.startsWith("❯ ")) parts.push(`[ASISTENTE] ${l.text}`);
  }
  const full = parts.join("\n");
  return full.length > maxChars ? "…\n" + full.slice(-maxChars) : full;
}

// ── Pase LLM: narrativa del análisis (Agent SDK + tool acotada) ─────────

interface Narration {
  narrative: string;
  resultSummary: string;
}

/**
 * Redacta "qué se hizo, por qué y qué se logró" a partir del transcript. Mismo
 * patrón que el ingest de reuniones: fuerza una tool MCP acotada. Best-effort:
 * devuelve null si el transcript es mínimo o el modelo no coopera (el caller cae
 * a trace + resultado crudo).
 */
async function narrateExecution(input: {
  taskTitle: string;
  projectSlug: string;
  prompt: string;
  transcript: string;
  status: TaskExecutionStatus;
}): Promise<Narration | null> {
  if (input.transcript.trim().length < 40) return null; // nada que analizar

  let captured: Narration | null = null;
  const recordTool = tool(
    "record_execution_analysis",
    "Registra el análisis de la ejecución: una narrativa y un resumen del resultado. Llámala una sola vez.",
    {
      narrative: z
        .string()
        .describe(
          "Narrativa en español (4-10 líneas): qué se hizo, por qué, qué se cambió/encontró y en qué estado quedó. Sin relleno.",
        ),
      result_summary: z
        .string()
        .describe("El resultado concreto en 1-3 líneas (qué se logró o por qué falló)."),
    },
    async (args) => {
      captured = { narrative: args.narrative, resultSummary: args.result_summary };
      return { content: [{ type: "text" as const, text: "Registrado." }] };
    },
  );
  const server = createSdkMcpServer({
    name: "execanalysis",
    version: "0.1.0",
    tools: [recordTool],
  });

  const systemPrompt = `# Hermes — Analista de ejecuciones

Eres **Hermes**, el AI OS de ${OWNER}. Acabas de ejecutar una tarea con Claude Code en el repo del proyecto **${input.projectSlug}** y debes documentar QUÉ pasó, para dejar memoria de la ejecución.

La ejecución terminó con estado: **${input.status === "done" ? "éxito" : "error/fallo"}**.

## Reglas
- Analiza el transcript (prompt + pasos + herramientas + salida) y produce (1) una NARRATIVA clara y (2) un RESUMEN del resultado.
- Enfócate en lo sustantivo: archivos tocados, decisiones, comandos, hallazgos, y en qué estado quedó la tarea.
- Si falló, explica la causa probable a partir de los errores del transcript.
- Responde SIEMPRE llamando a la tool \`record_execution_analysis\` UNA sola vez. No escribas texto libre.`;

  const userPrompt = `Tarea: ${input.taskTitle}

Prompt que se ejecutó:
"""
${input.prompt}
"""

Transcript de la ejecución:
"""
${input.transcript}
"""

Analiza la ejecución y llama a record_execution_analysis.`;

  try {
    const q = query({
      prompt: userPrompt,
      options: {
        cwd: env.VAULT_PATH || process.cwd(),
        systemPrompt,
        model: process.env.HERMES_MODEL || undefined,
        maxTurns: 4,
        settingSources: [],
        mcpServers: { execanalysis: server },
        allowedTools: ["mcp__execanalysis__record_execution_analysis"],
        permissionMode: "default",
      },
    });
    // Solo nos interesa el efecto de la tool (captured). Drenamos el stream.
    for await (const message of q) void message;
  } catch (err) {
    console.error("[executions] narrar:", String(err).slice(0, 200));
    return null;
  }
  return captured;
}

// ── Escritura: documento en el vault + espejo en Supabase ──────────────

/**
 * Genera el documento de la ejecución (pase LLM + trace), lo escribe como .md en
 * el vault y lo espeja a Supabase. Idempotente por local_key (un run = un doc).
 */
export async function saveExecution(input: SaveExecutionInput): Promise<TaskExecution | null> {
  const slug = await realSlug(input.slug);
  const fecha = new Date();
  const id = makeExecutionId(fecha, input.runId);

  const result = finalText(input.lines) || "_(sin salida de texto del asistente)_";
  const trace = formatTrace(input.lines);
  const transcript = transcriptForLlm(input.lines);

  const narration = await narrateExecution({
    taskTitle: input.task.title,
    projectSlug: slug,
    prompt: input.prompt,
    transcript,
    status: input.status,
  });

  // Análisis = narrativa (LLM) o, si no hubo, una nota neutra. El trace va debajo.
  const narrative =
    narration?.narrative?.trim() ||
    (input.status === "done"
      ? "_(sin narrativa; ver los pasos y el resultado)_"
      : "_(la ejecución falló antes de producir un análisis; ver los pasos)_");
  // Resultado: el texto final crudo, o el resumen del LLM si no hubo texto.
  const finalResult =
    result !== "_(sin salida de texto del asistente)_"
      ? result
      : narration?.resultSummary?.trim() || result;
  const snippet = finalResult.replace(/\s+/g, " ").trim().slice(0, 180);

  const dir = executionsDir(slug);
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${id}.md`);

  const frontmatter = {
    tipo: "ejecucion",
    proyecto: slug,
    tarea_id: input.task.id,
    tarea_titulo: input.task.title,
    run_id: input.runId,
    session_id: input.sessionId,
    tipo_ejecucion: input.kind,
    estado: input.status,
    modelo: input.model,
    esfuerzo: input.effort,
    costo_usd: numOrNull(input.costUsd),
    duracion_ms: numOrNull(input.durationMs),
    turnos: numOrNull(input.numTurns),
    fecha: fecha.toISOString(),
    maquina: env.MACHINE_NAME,
    resultado_snippet: snippet,
    tags: ["ejecucion"],
  };

  const kindLabel = input.kind === "continue" ? "Continuación" : "Ejecución";
  const body = `# ${input.task.title} — ${kindLabel}

## Prompt
${input.prompt.trim()}

## Análisis
${narrative}

#### Pasos
${trace}

## Resultado
${finalResult.trim()}
`;

  await writeFile(path, matter.stringify(body, frontmatter), "utf8");

  const execution: TaskExecution = {
    id,
    task_id: input.task.id,
    project_slug: slug,
    run_id: input.runId,
    session_id: input.sessionId,
    kind: input.kind,
    status: input.status,
    prompt: input.prompt.trim(),
    analysis: `${narrative}\n\n#### Pasos\n${trace}`,
    result: finalResult.trim(),
    markdown: body,
    result_snippet: snippet,
    model: input.model,
    effort: input.effort,
    cost_usd: numOrNull(input.costUsd),
    duration_ms: numOrNull(input.durationMs),
    num_turns: numOrNull(input.numTurns),
    machine: env.MACHINE_NAME,
    vault_path: path,
    created_at: fecha.toISOString(),
    finished_at: fecha.toISOString(),
  };

  void mirrorExecution(execution, input.usage);
  return execution;
}

async function mirrorExecution(e: TaskExecution, usage?: RunTokenUsage): Promise<void> {
  if (!supabase) return;
  // Se embebe prompt + análisis + resultado: así las ejecuciones pasadas son
  // recuperables por match_knowledge ("¿qué hicimos con el login de X?").
  const embedding = await embed(
    [e.prompt, e.analysis, e.result].filter(Boolean).join("\n"),
  );
  const { error } = await supabase.from("task_executions").upsert(
    {
      local_key: execLocalKey(e.project_slug, e.run_id ?? e.id),
      embedding,
      execution_id: e.id,
      task_id: e.task_id,
      project_slug: safeName(e.project_slug),
      run_id: e.run_id,
      session_id: e.session_id,
      kind: e.kind,
      status: e.status,
      prompt: e.prompt,
      analysis: e.analysis,
      result: e.result,
      model: e.model,
      effort: e.effort,
      cost_usd: e.cost_usd,
      duration_ms: e.duration_ms,
      num_turns: e.num_turns,
      input_tokens: usage?.inputTokens ?? null,
      output_tokens: usage?.outputTokens ?? null,
      cache_creation_tokens: usage?.cacheCreationTokens ?? null,
      cache_read_tokens: usage?.cacheReadTokens ?? null,
      machine: e.machine ?? null,
      vault_path: e.vault_path ?? null,
      finished_at: e.finished_at ?? null,
    },
    { onConflict: "local_key" },
  );
  if (error) console.error("[executions] espejo:", error.message);
}

// ── Lectura desde el vault ─────────────────────────────────────────────

function summaryFromFrontmatter(
  id: string,
  slug: string,
  data: Record<string, unknown>,
): TaskExecutionSummary {
  const kind = data.tipo_ejecucion === "continue" ? "continue" : "execute";
  const status = data.estado === "error" ? "error" : "done";
  return {
    id,
    task_id: typeof data.tarea_id === "number" ? data.tarea_id : null,
    project_slug: slug,
    kind,
    status,
    result_snippet: data.resultado_snippet ? String(data.resultado_snippet) : "",
    cost_usd: numOrNull(data.costo_usd),
    duration_ms: numOrNull(data.duracion_ms),
    created_at: toIso(data.fecha),
  };
}

/**
 * Historial de ejecuciones de un proyecto (más recientes primero). Si se pasa
 * taskId, filtra las de esa tarea. Lee del vault → funciona sin Supabase.
 */
export async function listExecutions(
  slugIn: string,
  taskId?: number,
): Promise<TaskExecutionSummary[]> {
  const slug = await realSlug(slugIn);
  let files: string[];
  try {
    files = (await readdir(executionsDir(slug))).filter((f) => f.endsWith(".md"));
  } catch {
    return []; // sin ejecuciones todavía
  }
  const out: TaskExecutionSummary[] = [];
  for (const f of files) {
    try {
      const { data } = matter(await readFile(join(executionsDir(slug), f), "utf8"));
      const s = summaryFromFrontmatter(f.replace(/\.md$/, ""), slug, data);
      if (taskId != null && s.task_id !== taskId) continue;
      out.push(s);
    } catch {
      /* archivo corrupto: lo salteamos */
    }
  }
  return out.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

/** Documento completo de una ejecución (con markdown para renderizar). */
export async function getExecution(slugIn: string, id: string): Promise<TaskExecution | null> {
  const slug = await realSlug(slugIn);
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safeId) return null;
  const path = join(executionsDir(slug), `${safeId}.md`);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return null;
  }
  const { data, content } = matter(raw);
  const prompt = extractSection(content, /^##\s+Prompt/i);
  const analysis = extractSection(content, /^##\s+An[aá]lisis/i);
  const result = extractSection(content, /^##\s+Resultado/i);
  return {
    ...summaryFromFrontmatter(safeId, slug, data),
    run_id: data.run_id ? String(data.run_id) : null,
    session_id: data.session_id ? String(data.session_id) : null,
    prompt,
    analysis,
    result,
    markdown: content.trim(),
    model: data.modelo ? String(data.modelo) : "",
    effort: data.esfuerzo ? String(data.esfuerzo) : "",
    num_turns: numOrNull(data.turnos),
    machine: data.maquina ? String(data.maquina) : null,
    vault_path: path,
    finished_at: data.fecha ? toIso(data.fecha) : null,
  };
}
