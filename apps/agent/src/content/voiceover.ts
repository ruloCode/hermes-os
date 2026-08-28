/**
 * VOZ EN OFF grabada desde el dashboard.
 *
 * El browser graba con MediaRecorder (webm/opus) y manda el blob; aquí se
 * transcodifica a **WAV 48k mono** y se guarda en `<media_dir>/assets/` con la
 * convención de captura (`01-hook-vo.wav`). Dos razones para no dejar el webm
 * tal cual: los NLE (CapCut/Premiere) y el pipeline de OpenMontage lo tratan
 * mal, y el webm de MediaRecorder sale SIN duración en el header — ffprobe
 * devolvería N/A y el checklist mostraría un dato falso (regla del repo: todo
 * dato visible es real).
 *
 * Re-grabar no pisa: `nextVoName` (shared/capture.ts) da el siguiente sufijo
 * libre y la última toma es la que manda.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join } from "node:path";
import { promisify } from "node:util";
import type { PieceMedia, PieceMediaFile } from "@hermes/shared";
import { captureSlug, isVoStem, nextVoName, voBaseOf, voTakeNumber } from "@hermes/shared";
import { getPiece } from "./store.js";
import {
  MEDIA_SUBDIRS,
  ensurePieceFolder,
  resolvePieceDir,
  scanPieceMedia,
} from "./media.js";

const execFileAsync = promisify(execFile);

/** ffmpeg por ruta absoluta (launchd corre con PATH mínimo, como ffprobe). */
const FFMPEG = existsSync("/opt/homebrew/bin/ffmpeg") ? "/opt/homebrew/bin/ffmpeg" : "ffmpeg";

/** Extensiones que sabemos servir/borrar dentro de la carpeta de la pieza. */
const MEDIA_TYPES: Record<string, string> = {
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".m4v": "video/x-m4v",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
};

export type MediaSubdir = (typeof MEDIA_SUBDIRS)[number];

export function isMediaSubdir(value: string): value is MediaSubdir {
  return (MEDIA_SUBDIRS as readonly string[]).includes(value);
}

export interface SaveVoiceoverResult {
  file?: PieceMediaFile;
  media?: PieceMedia;
  /** false = ffmpeg no estaba: se guardó el original sin convertir. */
  transcoded?: boolean;
  error?: string;
  status?: number;
}

/**
 * Guarda una toma de voz en off en assets/ y devuelve el escaneo fresco de la
 * carpeta (la UI se refresca con una sola respuesta).
 *
 * `stem` = el nombre base del bloque ("01-hook") o el de una toma libre; el
 * sufijo `-vo` y el número de toma los pone el servidor: nunca se confía un
 * nombre de archivo al cliente.
 */
export async function saveVoiceover(
  pieceId: number,
  input: { stem: string; bytes: Uint8Array; sourceExt?: string },
): Promise<SaveVoiceoverResult> {
  const piece = await getPiece(pieceId);
  if (!piece) return { error: "pieza no encontrada", status: 404 };
  if (!input.bytes.byteLength) return { error: "audio vacío", status: 400 };

  const slug = captureSlug(input.stem).slice(0, 60);

  // La carpeta se crea sola: grabar no puede fallar por "no existe todavía".
  const ensured = await ensurePieceFolder(pieceId);
  if (ensured.error) return { error: ensured.error, status: ensured.status ?? 500 };
  const dir = resolvePieceDir(ensured.piece ?? piece).dir;
  const assets = join(dir, "assets");

  const existing = (await readdir(assets).catch(() => []))
    .filter((n) => !n.startsWith("."))
    .map((n) => n.replace(/\.[^.]+$/, ""));

  // Tmp fuera de la carpeta de la pieza: un fallo a mitad no deja basura en
  // assets/ (que es material que el editor mira).
  const rawExt = normalizeExt(input.sourceExt) || ".webm";
  const tmp = join(tmpdir(), `hermes-vo-${pieceId}-${Date.now()}${rawExt}`);
  await writeFile(tmp, input.bytes);

  let name = nextVoName(slug, existing, ".wav");
  let transcoded = true;
  try {
    // -ac 1 -ar 48000 pcm_s16le: el estándar de una pista de narración.
    await execFileAsync(FFMPEG, ["-y", "-i", tmp, "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", join(assets, name)], {
      timeout: 120_000,
    });
  } catch (err) {
    // Sin ffmpeg (o audio ilegible) el crudo NO se tira: se guarda tal cual y
    // la UI avisa que quedó sin convertir. El .wav a medio escribir se borra —
    // si no, el checklist mostraría una toma que no suena.
    await rm(join(assets, name), { force: true });
    transcoded = false;
    name = nextVoName(slug, existing, rawExt);
    try {
      await writeFile(join(assets, name), input.bytes);
    } catch {
      await rm(tmp, { force: true });
      return { error: `no se pudo guardar el audio: ${String(err).slice(0, 120)}`, status: 500 };
    }
  } finally {
    await rm(tmp, { force: true });
  }

  const media = await scanPieceMedia(pieceId);
  const file = media?.assets.find((f) => f.name === name);
  return { file, media: media ?? undefined, transcoded };
}

/** ".webm" desde un mimetype o nombre suelto; null si no se reconoce. */
function normalizeExt(hint?: string): string | null {
  if (!hint) return null;
  const fromName = extname(hint).toLowerCase();
  if (fromName && MEDIA_TYPES[fromName]) return fromName;
  const t = hint.toLowerCase();
  if (t.includes("webm")) return ".webm";
  if (t.includes("mp4") || t.includes("m4a") || t.includes("aac")) return ".m4a";
  if (t.includes("wav")) return ".wav";
  if (t.includes("ogg")) return ".ogg";
  return null;
}

/**
 * Ruta real de un archivo de la carpeta de la pieza, con las dos guardas que
 * importan: el nombre es un basename (nada de `../`) y tiene que existir.
 */
export async function pieceMediaFilePath(
  pieceId: number,
  sub: MediaSubdir,
  name: string,
): Promise<{ path?: string; type?: string; error?: string; status?: number }> {
  const piece = await getPiece(pieceId);
  if (!piece) return { error: "pieza no encontrada", status: 404 };
  const safe = basename(name);
  if (!safe || safe.startsWith(".") || safe !== name)
    return { error: "nombre inválido", status: 400 };
  const ext = extname(safe).toLowerCase();
  // Un .webm de voz en off (fallback sin ffmpeg) se sirve como audio: si no,
  // el <audio> del dashboard no lo reproduce.
  const type =
    ext === ".webm" && isVoStem(safe.replace(/\.[^.]+$/, "")) ? "audio/webm" : MEDIA_TYPES[ext];
  if (!type) return { error: "tipo de archivo no servido", status: 400 };
  const path = join(resolvePieceDir(piece).dir, sub, safe);
  if (!existsSync(path)) return { error: "archivo no encontrado", status: 404 };
  return { path, type };
}

/**
 * "Usar esta toma": la ASCIENDE renombrándola al siguiente sufijo libre, con
 * lo que pasa a ser la última — que es la que manda para el checklist y para
 * el run de edición. Sin flags ni columnas nuevas: el disco sigue siendo la
 * única fuente de verdad y el orden de las tomas se conserva.
 */
export async function promoteVoiceover(
  pieceId: number,
  name: string,
): Promise<{ media?: PieceMedia; name?: string; error?: string; status?: number }> {
  const safe = basename(name);
  const stem = safe.replace(/\.[^.]+$/, "");
  if (safe !== name || !isVoStem(stem))
    return { error: "eso no es una toma de voz en off", status: 400 };
  const found = await pieceMediaFilePath(pieceId, "assets", safe);
  if (found.error) return { error: found.error, status: found.status };

  const dir = dirname(found.path!);
  const existing = (await readdir(dir).catch(() => []))
    .filter((n) => !n.startsWith("."))
    .map((n) => n.replace(/\.[^.]+$/, ""));
  // Ya es la última: no tocar el disco por un clic redundante.
  const base = voBaseOf(stem)!;
  const isLatest = existing
    .filter((s) => voBaseOf(s) === base)
    .every((s) => voTakeNumber(s) <= voTakeNumber(stem));
  if (isLatest) {
    const media = await scanPieceMedia(pieceId);
    return { media: media ?? undefined, name: safe };
  }

  const next = nextVoName(base, existing, extname(safe) || ".wav");
  await rename(found.path!, join(dir, next));
  const media = await scanPieceMedia(pieceId);
  return { media: media ?? undefined, name: next };
}

/**
 * Borra UNA toma de voz en off. Solo archivos `-vo` de assets/: el botón ✕ de
 * la UI no puede llevarse por delante otro material de la pieza.
 */
export async function deleteVoiceover(
  pieceId: number,
  name: string,
): Promise<{ media?: PieceMedia; error?: string; status?: number }> {
  const safe = basename(name);
  if (safe !== name || !isVoStem(safe.replace(/\.[^.]+$/, "")))
    return { error: "eso no es una toma de voz en off", status: 400 };
  const found = await pieceMediaFilePath(pieceId, "assets", safe);
  if (found.error) return { error: found.error, status: found.status };
  await rm(found.path!, { force: true });
  const media = await scanPieceMedia(pieceId);
  return { media: media ?? undefined };
}
