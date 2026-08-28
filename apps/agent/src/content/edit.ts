/**
 * Crudos + edición automática de piezas (OpenMontage, VIDEO_EDIT_PATH).
 *
 * Los crudos son archivos LOCALES del disco del agente: la web no sube nada —
 * navega carpetas vía GET /content/clips/browse (patrón file-picker server-side,
 * porque el browser no expone rutas absolutas) y vincula rutas a la pieza con
 * metadata real de ffprobe.
 *
 * La edición automática es un run agéntico DENTRO del repo de OpenMontage
 * (cwd = VIDEO_EDIT_PATH, settingSources ["project"] para que su CLAUDE.md →
 * AGENT_GUIDE.md dirijan el pipeline). El guion + puntos de edición de la
 * pieza viajan como brief; dos tools MCP acotadas reportan progreso y
 * resultado (patrón ingest: captured-aunque-lance). El estado vive en la
 * columna edit_job (jsonb) y el board lo trae con el poll de 10s.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type {
  ClipBrowse,
  ContentEditJob,
  ContentPiece,
  ContentRawClip,
  PieceMediaFile,
} from "@hermes/shared";
import { latestVoTakes, voBaseOf } from "@hermes/shared";
import { checkTool } from "../agent/guardrails.js";
import { emit } from "../events.js";
import { env } from "../env.js";
import { getPiece, updatePiece } from "./store.js";
import { OWNER } from "../owner.js";

const execFileAsync = promisify(execFile);
const uid = () => Math.random().toString(36).slice(2, 9);

export const VIDEO_EXTS = new Set([".mp4", ".mov", ".webm", ".avi", ".mkv", ".m4v"]);
// El picker solo navega el home y los discos externos (archivo frío en /Volumes).
const BROWSE_ROOTS = [homedir(), "/Volumes"];

/** ¿Está el repo de OpenMontage en su sitio? (guard de todas las rutas). */
export function editAvailable(): boolean {
  return existsSync(join(env.VIDEO_EDIT_PATH, "AGENT_GUIDE.md"));
}

function insideRoots(abs: string): boolean {
  return BROWSE_ROOTS.some((root) => abs === root || abs.startsWith(root + "/"));
}

// ── File picker server-side ────────────────────────────────────────────

/** Lista carpetas + videos de un directorio local (para elegir crudos). */
export async function browseClips(dirIn?: string): Promise<ClipBrowse> {
  const fallback = existsSync(join(homedir(), "Movies")) ? join(homedir(), "Movies") : homedir();
  let dir = resolve(dirIn?.trim() ? dirIn.trim().replace(/^~/, homedir()) : fallback);
  if (!insideRoots(dir) || !existsSync(dir)) dir = fallback;

  const entries = await readdir(dir, { withFileTypes: true });
  const dirs: ClipBrowse["dirs"] = [];
  const files: ClipBrowse["files"] = [];
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const path = join(dir, e.name);
    if (e.isDirectory()) {
      dirs.push({ name: e.name, path });
    } else if (VIDEO_EXTS.has(extname(e.name).toLowerCase())) {
      try {
        const s = await stat(path);
        files.push({ name: e.name, path, size_bytes: s.size, mtime: s.mtime.toISOString() });
      } catch {
        /* archivo que desapareció entre readdir y stat */
      }
    }
  }
  dirs.sort((a, b) => a.name.localeCompare(b.name));
  // Lo más reciente arriba: los crudos de hoy son los que se buscan.
  files.sort((a, b) => b.mtime.localeCompare(a.mtime));
  const parent = dirname(dir);
  return {
    dir,
    parent: parent !== dir && insideRoots(parent) ? parent : null,
    dirs,
    files,
  };
}

// ── Probe + vinculación de crudos ──────────────────────────────────────

/** ffprobe por ruta absoluta (launchd corre con PATH mínimo, como graphify). */
const FFPROBE = existsSync("/opt/homebrew/bin/ffprobe") ? "/opt/homebrew/bin/ffprobe" : "ffprobe";

export async function probeClip(
  path: string,
): Promise<{ duration_sec: number | null; resolution: string | null }> {
  try {
    const { stdout } = await execFileAsync(
      FFPROBE,
      ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", path],
      { timeout: 15_000 },
    );
    const data = JSON.parse(stdout) as {
      format?: { duration?: string };
      streams?: { codec_type?: string; width?: number; height?: number }[];
    };
    const video = data.streams?.find((s) => s.codec_type === "video");
    const duration = Number(data.format?.duration ?? 0);
    return {
      duration_sec: duration > 0 ? Math.round(duration * 10) / 10 : null,
      resolution: video?.width && video?.height ? `${video.width}x${video.height}` : null,
    };
  } catch {
    return { duration_sec: null, resolution: null };
  }
}

/** Vincula rutas locales a la pieza (dedup por ruta; metadata de ffprobe). */
export async function attachClips(
  pieceId: number,
  paths: string[],
): Promise<ContentPiece | null> {
  const piece = await getPiece(pieceId);
  if (!piece) return null;
  const known = new Set(piece.raw_clips.map((c) => c.path));
  const added: ContentRawClip[] = [];
  for (const raw of paths) {
    const path = resolve(raw.replace(/^~/, homedir()));
    if (known.has(path) || !insideRoots(path) || !existsSync(path)) continue;
    if (!VIDEO_EXTS.has(extname(path).toLowerCase())) continue;
    const s = await stat(path);
    const probe = await probeClip(path);
    added.push({
      id: uid(),
      path,
      name: basename(path),
      size_bytes: s.size,
      duration_sec: probe.duration_sec,
      resolution: probe.resolution,
      added_at: new Date().toISOString(),
    });
    known.add(path);
  }
  if (!added.length) return piece;
  return updatePiece(pieceId, { rawClips: [...piece.raw_clips, ...added] });
}

export async function removeClip(pieceId: number, clipId: string): Promise<ContentPiece | null> {
  const piece = await getPiece(pieceId);
  if (!piece) return null;
  return updatePiece(pieceId, { rawClips: piece.raw_clips.filter((c) => c.id !== clipId) });
}

// ── Run de edición automática ──────────────────────────────────────────

/** Un run vivo por pieza; el AbortController hace el ⏹ Detener real. */
const runningEdits = new Map<number, AbortController>();

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "pieza"
  );
}

const fmtDur = (sec: number | null): string => {
  if (sec == null) return "¿?";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
};

function buildEditPrompt(
  piece: ContentPiece,
  brief?: string,
  voice: PieceMediaFile[] = [],
): string {
  const clips = piece.raw_clips
    .map(
      (c) =>
        `- ${c.path} (${fmtDur(c.duration_sec)}${c.resolution ? `, ${c.resolution}` : ""})`,
    )
    .join("\n");
  // La voz en off grabada en Hermes: el nombre dice a qué bloque pertenece
  // ("02-3-12s-vo" → bloque [3-12s]) y la última toma de cada bloque manda.
  const voiceLines = voice
    .map((f) => `- ${f.path} (${fmtDur(f.duration_sec)}) → bloque ${voBaseOf(f.stem)?.replace(/-vo$/, "") ?? f.stem}`)
    .join("\n");
  const points = piece.edit_points
    .map((p) => `- ${p.tc} · ${p.kind} — ${p.note}`)
    .join("\n");
  const vertical = piece.format === "vertical";
  return `Lee CLAUDE.md y AGENT_GUIDE.md de este repo y síguelos: eres el agente de OpenMontage.

Trabajo: editar el video de la pieza "${piece.title}" a partir de MATERIAL PROPIO ya grabado (source-footage request → source_media_review + pipeline footage-led como talking-head/hybrid). NO generes el video desde cero: los crudos son la fuente.

## Crudos (rutas absolutas, no los muevas — cópialos al proyecto si hace falta)
${clips}

${voiceLines ? `## Voz en off ya grabada (úsala como narración; NO generes TTS)\n${voiceLines}\nCada archivo es la voz de ESE bloque del guion: móntala sobre el material que le toca (demo/pantalla/b-roll) y ajusta el corte al audio, no al revés. Donde hay voz en off, el crudo del bloque va sin su audio original.\n` : ""}
## Guion aprobado (el corte final debe seguirlo)
${piece.hook ? `Hook (primer segundo): ${piece.hook}\n` : ""}${piece.script_md ?? "(sin guion — arma el corte con el mejor material de los crudos)"}

${points ? `## Puntos de edición marcados por ${OWNER} (instrucciones de corte, en orden)\n${points}\n` : ""}
## Formato destino
${vertical ? "Vertical 9:16 (tiktok/reels/shorts), 24-38s" : `Formato "${piece.format}"`} · plataformas: ${piece.platforms.join(", ") || "por definir"} · subtítulos quemados en español si el pipeline lo permite.

## Letra en pantalla (estilo de la casa, OBLIGATORIO en vertical)
- Hook y títulos: overlay Remotion \`reel_title\` (referencias virales de IG/TikTok; ver remotion-composer/SCENE_TYPES.md). Variantes: \`outline\` (blanco pesado con contorno negro — el default, úsalo para el hook y frases narrativas) · \`yellow\` (mayúsculas condensadas amarillas — cifras y claims de plata) · \`block\` (mayúsculas con extrusión negra y relleno de acento — nombres de producto) · \`editorial\` (caps espaciadas + subline serif itálica — apertura aspiracional).
- Subtítulos quemados: \`captionStyle: "reel"\` de TalkingHead (blanco pesado con contorno negro, SIN caja de fondo, palabra activa en amarillo). Nada de píldoras oscuras.
- Márgenes seguros SIEMPRE: los componentes ya los traen (10% arriba, 24% abajo, 9% por lado — ahí vive la UI de la plataforma). No posiciones texto a mano fuera de esos límites ni uses hero_title/section_title (look de dashboard) en contenido social.
- Títulos de 2-4 líneas máx, centrados; saltos de línea con \\n dentro de \`text\`.

## Reglas de ESTE run (headless, sin humano en el loop)
- Slug del proyecto OpenMontage: ${slugify(piece.title)}
- Donde el manifest pida aprobación humana, auto-apruébate y deja constancia en el decision_log (el humano ya aprobó al disparar este run desde Hermes).
- NO uses proveedores pagos de generación (video/imagen/TTS de pago): trabaja con los crudos y herramientas locales (ffmpeg, WhisperX, Remotion).
- Reporta progreso con la tool report_progress al ENTRAR a cada etapa del pipeline (stage = nombre de la etapa, detail = una línea en español de qué vas a hacer).
- Al terminar llama record_edit_result con la ruta ABSOLUTA del master renderizado y un resumen corto (2-4 líneas) de qué hiciste y qué revisar.
${piece.media_dir ? `- Además copia el master final a ${piece.media_dir}/exports/ (crea la carpeta si falta).` : ""}
${brief?.trim() ? `\n## Brief adicional de ${OWNER}\n${brief.trim()}` : ""}`;
}

/**
 * Dispara el run de edición (async: la respuesta vuelve de una con el job
 * "running"; el progreso llega por el poll del board + SSE /events).
 */
export async function startEditRun(
  pieceId: number,
  brief?: string,
): Promise<{ piece?: ContentPiece; error?: string; status?: number }> {
  if (!editAvailable())
    return {
      error: `OpenMontage no está en ${env.VIDEO_EDIT_PATH} (configura VIDEO_EDIT_PATH)`,
      status: 503,
    };
  let piece = await getPiece(pieceId);
  if (!piece) return { error: "pieza no encontrada", status: 404 };
  // Import dinámico: media.ts ya depende de este módulo (evita el ciclo).
  const { linkFolderMedia, scanPieceMedia } = await import("./media.js");
  // Sin crudos vinculados, la carpeta de la pieza en el disco extraíble es la
  // fuente automática.
  if (!piece.raw_clips.length) {
    const linked = await linkFolderMedia(pieceId);
    if (linked.piece) piece = linked.piece;
  }
  if (!piece.raw_clips.length)
    return {
      error: "vincula al menos un crudo (o pon los archivos en la carpeta de la pieza)",
      status: 400,
    };
  if (piece.edit_job?.status === "running" && runningEdits.has(pieceId))
    return { error: "ya hay una edición corriendo para esta pieza", status: 409 };

  const missing = piece.raw_clips.filter((c) => !existsSync(c.path));
  if (missing.length)
    return {
      error: `crudos que ya no existen en disco: ${missing.map((c) => c.name).join(", ")}`,
      status: 400,
    };

  const job: ContentEditJob = {
    status: "running",
    stage: "preparando",
    detail: "arrancando el run de OpenMontage",
    brief: brief?.trim() || null,
    started_at: new Date().toISOString(),
    finished_at: null,
    output_path: null,
    project_dir: null,
    error: null,
  };
  const updated = await updatePiece(pieceId, { editJob: job });
  if (!updated) return { error: "no se pudo guardar el job (sin Supabase)", status: 500 };

  // La voz en off grabada desde el dashboard entra al prompt como narración:
  // solo la ÚLTIMA toma de cada bloque (re-grabar deja las viejas al lado).
  const media = await scanPieceMedia(pieceId);
  const voice = latestVoTakes(media?.assets ?? []);

  const abort = new AbortController();
  runningEdits.set(pieceId, abort);
  emit({
    kind: "task_start",
    taskId: `content-edit-${pieceId}`,
    detail: `edición automática de "${piece.title}" (${piece.raw_clips.length} crudos${voice.length ? `, ${voice.length} de voz en off` : ""})`,
  });
  void runEdit(pieceId, { ...job }, buildEditPrompt(piece, brief, voice), abort);
  return { piece: updated };
}

/** ⏹ Detener: aborta el SDK de verdad (detenido ≠ error del pipeline). */
export async function stopEditRun(pieceId: number): Promise<ContentPiece | null> {
  runningEdits.get(pieceId)?.abort();
  runningEdits.delete(pieceId);
  const piece = await getPiece(pieceId);
  if (!piece?.edit_job || piece.edit_job.status !== "running") return piece;
  return updatePiece(pieceId, {
    editJob: {
      ...piece.edit_job,
      status: "error",
      error: `detenida por ${OWNER}`,
      finished_at: new Date().toISOString(),
    },
  });
}

async function runEdit(
  pieceId: number,
  job: ContentEditJob,
  prompt: string,
  abort: AbortController,
): Promise<void> {
  let captured: { summary: string; output_path: string; project_dir: string } | null = null;

  const patchJob = async (patch: Partial<ContentEditJob>) => {
    job = { ...job, ...patch };
    await updatePiece(pieceId, { editJob: job });
  };

  const progressTool = tool(
    "report_progress",
    "Reporta la etapa del pipeline al ENTRAR a ella (progreso visible en Hermes).",
    {
      stage: z.string().describe("Etapa del pipeline (idea/script/scene_plan/assets/edit/compose…)"),
      detail: z.string().describe("Una línea en español de qué se está haciendo"),
    },
    async (args) => {
      await patchJob({ stage: args.stage, detail: args.detail });
      return { content: [{ type: "text" as const, text: "Anotado." }] };
    },
  );
  const resultTool = tool(
    "record_edit_result",
    "Registra el resultado final del run. Llámala UNA sola vez, al terminar.",
    {
      summary: z.string().describe("Resumen corto (2-4 líneas): qué se hizo y qué revisar"),
      output_path: z.string().describe("Ruta ABSOLUTA del master renderizado (mp4)"),
      project_dir: z.string().describe("Carpeta del proyecto OpenMontage (projects/<slug>)"),
    },
    async (args) => {
      captured = args;
      return { content: [{ type: "text" as const, text: "Registrado." }] };
    },
  );
  const server = createSdkMcpServer({
    name: "edit",
    version: "0.1.0",
    tools: [progressTool, resultTool],
  });

  try {
    const q = query({
      prompt,
      options: {
        cwd: env.VIDEO_EDIT_PATH,
        model: process.env.HERMES_MODEL || undefined,
        // Un render footage-led encadena MUCHAS llamadas (probe, review,
        // pipeline por etapas, Remotion): el tope alto es a propósito.
        maxTurns: 300,
        // El contrato de OpenMontage vive en SU repo (CLAUDE.md → AGENT_GUIDE).
        settingSources: ["project"],
        mcpServers: { edit: server },
        // Como en session.ts: lo seguro va en allowedTools; Bash/Write/Edit
        // pasan por canUseTool → guardrails (deny-list + roots de escritura,
        // que ya cubren ~/dev donde vive video-edit).
        allowedTools: [
          "Read",
          "Glob",
          "Grep",
          "TodoWrite",
          "mcp__edit__report_progress",
          "mcp__edit__record_edit_result",
        ],
        permissionMode: "default",
        abortController: abort,
        canUseTool: async (toolName, input) => {
          const verdict = checkTool(toolName, input as Record<string, unknown>);
          if (!verdict.allowed) {
            emit({
              kind: "error",
              taskId: `content-edit-${pieceId}`,
              toolName,
              detail: `GUARDRAIL: ${verdict.reason}`,
            });
            return { behavior: "deny", message: verdict.reason ?? "bloqueado por guardrail" };
          }
          return { behavior: "allow", updatedInput: input };
        },
      },
    });
    // El SDK LANZA desde el iterador en errores de result (maxTurns, abort…);
    // si el modelo YA llamó record_edit_result, el catch aprovecha `captured`.
    for await (const message of q) void message;
  } catch (err) {
    if (!captured) {
      const aborted = abort.signal.aborted;
      runningEdits.delete(pieceId);
      await patchJob({
        status: "error",
        error: aborted ? `detenida por ${OWNER}` : String(err).slice(0, 300),
        finished_at: new Date().toISOString(),
      });
      if (!aborted)
        emit({
          kind: "error",
          taskId: `content-edit-${pieceId}`,
          detail: `edición falló: ${String(err).slice(0, 200)}`,
        });
      return;
    }
  }

  runningEdits.delete(pieceId);
  const result = captured as { summary: string; output_path: string; project_dir: string } | null;
  if (!result) {
    await patchJob({
      status: "error",
      error: "el run terminó sin llamar record_edit_result (mira agent.log)",
      finished_at: new Date().toISOString(),
    });
    return;
  }
  const outputOk = existsSync(result.output_path);
  await patchJob({
    status: outputOk ? "done" : "error",
    stage: "listo",
    detail: result.summary.slice(0, 500),
    output_path: outputOk ? result.output_path : null,
    project_dir: result.project_dir,
    error: outputOk ? null : `el run reportó ${result.output_path} pero el archivo no existe`,
    finished_at: new Date().toISOString(),
  });
  emit({
    kind: "task_done",
    taskId: `content-edit-${pieceId}`,
    detail: outputOk
      ? `corte listo: ${basename(result.output_path)} — ${result.summary.slice(0, 160)}`
      : `edición terminó sin master verificable (${result.output_path})`,
  });
}

// ── Abrir el resultado ─────────────────────────────────────────────────

/** Abre el master (QuickTime) o lo revela en Finder. */
export async function openEditOutput(
  pieceId: number,
  reveal: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const piece = await getPiece(pieceId);
  // El master sellado manda: cubre también la edición MANUAL (el archivo que
  // apareció en exports/), donde no hay edit_job del cual sacar la ruta.
  const path = piece?.master_path ?? piece?.edit_job?.output_path;
  if (!path) return { ok: false, error: "la pieza no tiene master renderizado" };
  if (!existsSync(path)) return { ok: false, error: `el archivo ya no existe: ${path}` };
  try {
    await execFileAsync("open", reveal ? ["-R", path] : [path]);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err).slice(0, 160) };
  }
}
