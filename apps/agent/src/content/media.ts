/**
 * Carpeta canónica de la pieza en el disco extraíble (ESTUDIO_MEDIA_ROOT):
 * <root>/<slug>/{crudos,assets,exports}. Es el contrato de orden del flujo
 * grabación → edición: el dueño graba con LO QUE SEA y guarda con el nombre
 * esperado ("01-hook", la extensión da igual); el checklist del tab Tomas se
 * marca solo cuando el archivo aparece (regla del repo: todo dato visible es
 * real) y el run de edición toma crudos/ + assets/ automáticamente.
 *
 * La carpeta se sella en content_pieces.media_dir al crearla (como
 * vault_path): renombrar la pieza no rompe el enlace con el disco.
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { basename, dirname, extname, join } from "node:path";
import { promisify } from "node:util";
import type { ContentPiece, PieceMedia, PieceMediaFile } from "@hermes/shared";
import { env } from "../env.js";
import { attachClips, probeClip, VIDEO_EXTS } from "./edit.js";
import { getPiece, slugify, updatePiece } from "./store.js";

const execFileAsync = promisify(execFile);

const AUDIO_EXTS = new Set([".mp3", ".wav", ".aac", ".m4a", ".flac", ".ogg"]);
const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".heic", ".gif"]);
export const MEDIA_SUBDIRS = ["crudos", "assets", "exports"] as const;

/** ¿Está montado el disco del estudio? (el padre de ESTUDIO_MEDIA_ROOT). */
export function mediaConnected(): boolean {
  return !!env.ESTUDIO_MEDIA_ROOT && existsSync(dirname(env.ESTUDIO_MEDIA_ROOT));
}

/**
 * Fallback local cuando el disco NO está montado: la grabación no se bloquea
 * por un cable. La carpeta canónica sigue siendo la del disco (la única que
 * se sella en media_dir); lo local es un buffer que el dueño archiva después —
 * la auditoría 2026-08-10 encontró los crudos reales en ~/Downloads porque
 * exigir el disco solo conseguía que la convención no se usara.
 */
const LOCAL_MEDIA_ROOT = join(homedir(), "Movies", "estudio");

/** Carpeta REAL de la pieza ahora mismo, con su raíz (disco o fallback local). */
export function resolvePieceDir(piece: ContentPiece): { dir: string; root: "disco" | "local" } {
  const sealed = piece.media_dir;
  // La sellada manda mientras su volumen esté accesible.
  if (sealed && (existsSync(sealed) || mediaConnected()))
    return { dir: sealed, root: sealed.startsWith(LOCAL_MEDIA_ROOT) ? "local" : "disco" };
  if (mediaConnected())
    return { dir: join(env.ESTUDIO_MEDIA_ROOT, slugify(piece.title)), root: "disco" };
  return { dir: join(LOCAL_MEDIA_ROOT, sealed ? basename(sealed) : slugify(piece.title)), root: "local" };
}

/** Carpeta de la pieza (compat: los llamadores que solo quieren la ruta). */
export function pieceMediaDir(piece: ContentPiece): string {
  return resolvePieceDir(piece).dir;
}

/** Crea <dir>/{crudos,assets,exports}; sella media_dir SOLO en el disco. */
export async function ensurePieceFolder(
  pieceId: number,
): Promise<{ piece?: ContentPiece; error?: string; status?: number }> {
  const piece = await getPiece(pieceId);
  if (!piece) return { error: "pieza no encontrada", status: 404 };
  const { dir, root } = resolvePieceDir(piece);
  try {
    for (const sub of MEDIA_SUBDIRS) await mkdir(join(dir, sub), { recursive: true });
  } catch (err) {
    return { error: `no se pudo crear ${dir}: ${String(err).slice(0, 120)}`, status: 500 };
  }
  // El fallback local no se sella: cuando el disco vuelva, la canónica manda.
  if (root !== "disco" || piece.media_dir === dir) return { piece };
  const updated = await updatePiece(pieceId, { mediaDir: dir });
  return { piece: updated ?? piece };
}

// Probe con caché por mtime: el scan corre al abrir el tab, no en el poll,
// pero re-probar crudos de gigas en cada refresh sería castigo gratuito.
const probeCache = new Map<string, { mtimeMs: number; duration: number | null }>();

async function fileInfo(path: string, probe: boolean): Promise<PieceMediaFile | null> {
  try {
    const s = await stat(path);
    let duration: number | null = null;
    if (probe) {
      const cached = probeCache.get(path);
      if (cached && cached.mtimeMs === s.mtimeMs) {
        duration = cached.duration;
      } else {
        duration = (await probeClip(path)).duration_sec;
        probeCache.set(path, { mtimeMs: s.mtimeMs, duration });
      }
    }
    const name = path.split("/").pop() ?? path;
    return {
      name,
      stem: name.replace(/\.[^.]+$/, ""),
      path,
      size_bytes: s.size,
      mtime: s.mtime.toISOString(),
      duration_sec: duration,
    };
  } catch {
    return null;
  }
}

async function listSubdir(dir: string, sub: (typeof MEDIA_SUBDIRS)[number]): Promise<PieceMediaFile[]> {
  const full = join(dir, sub);
  if (!existsSync(full)) return [];
  const out: PieceMediaFile[] = [];
  for (const name of await readdir(full)) {
    if (name.startsWith(".")) continue;
    const ext = extname(name).toLowerCase();
    // crudos/exports = video; assets acepta también audio e imágenes.
    const isMedia =
      VIDEO_EXTS.has(ext) || (sub === "assets" && (AUDIO_EXTS.has(ext) || IMAGE_EXTS.has(ext)));
    if (!isMedia) continue;
    const info = await fileInfo(join(full, name), VIDEO_EXTS.has(ext) || AUDIO_EXTS.has(ext));
    if (info) out.push(info);
  }
  // Orden por nombre: la convención NN-etiqueta ordena el plan sola.
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Estado real de la carpeta de la pieza (para el checklist de captura). */
export async function scanPieceMedia(pieceId: number): Promise<PieceMedia | null> {
  const piece = await getPiece(pieceId);
  if (!piece) return null;
  const connected = mediaConnected();
  const { dir, root } = resolvePieceDir(piece);
  const exists = existsSync(dir);
  if (!exists) return { connected, root, dir, exists, crudos: [], assets: [], exports: [] };
  const [crudos, assets, exports_] = await Promise.all([
    listSubdir(dir, "crudos"),
    listSubdir(dir, "assets"),
    listSubdir(dir, "exports"),
  ]);
  return { connected, root, dir, exists, crudos, assets, exports: exports_ };
}

/** Vincula los videos de crudos/ + assets/ como raw_clips de la pieza. */
export async function linkFolderMedia(
  pieceId: number,
): Promise<{ piece: ContentPiece | null; added: number }> {
  const media = await scanPieceMedia(pieceId);
  const before = await getPiece(pieceId);
  if (!media?.exists || !before) return { piece: before, added: 0 };
  const paths = [...media.crudos, ...media.assets].map((f) => f.path);
  if (!paths.length) return { piece: before, added: 0 };
  const piece = await attachClips(pieceId, paths);
  return { piece, added: (piece?.raw_clips.length ?? 0) - before.raw_clips.length };
}

// ── El master canónico ─────────────────────────────────────────────────

/**
 * Resuelve el video FINAL de la pieza contra el disco, en orden de confianza:
 *
 *  1. `master_path` ya sellado (si el archivo sigue ahí).
 *  2. `edit_job.output_path` del run de OpenMontage (ya verificado al cerrar).
 *  3. El video más reciente de <media_dir>/exports/ — el caso de la edición
 *     MANUAL (CapCut, Premiere): el archivo aparece en el disco y hasta ahora
 *     la base de datos no se enteraba.
 *
 * Devuelve null si no hay master en disco. Nunca inventa: si la ruta sellada
 * ya no existe, la descarta y busca de nuevo.
 */
export async function resolveMaster(
  piece: ContentPiece,
): Promise<{ path: string; source: "sellado" | "edicion-automatica" | "exports" } | null> {
  if (piece.master_path && existsSync(piece.master_path))
    return { path: piece.master_path, source: "sellado" };

  const fromEdit = piece.edit_job?.output_path;
  if (fromEdit && existsSync(fromEdit)) return { path: fromEdit, source: "edicion-automatica" };

  const { dir } = resolvePieceDir(piece);
  if (existsSync(dir)) {
    const exports_ = await listSubdir(dir, "exports");
    // El más reciente manda: al re-exportar, ese es el corte bueno.
    const newest = exports_.sort((a, b) => b.mtime.localeCompare(a.mtime))[0];
    if (newest) return { path: newest.path, source: "exports" };
  }
  return null;
}

/**
 * Resuelve y SELLA el master en la pieza (como vault_path o media_dir).
 * Idempotente: si ya está sellado y sigue en disco, no escribe.
 */
export async function sealMaster(
  pieceId: number,
): Promise<{ piece: ContentPiece | null; master: string | null }> {
  const piece = await getPiece(pieceId);
  if (!piece) return { piece: null, master: null };
  const found = await resolveMaster(piece);
  const next = found?.path ?? null;
  if (piece.master_path === next) return { piece, master: next };
  const updated = await updatePiece(pieceId, { masterPath: next });
  return { piece: updated ?? piece, master: next };
}

/**
 * Abre en Finder la carpeta de la pieza o una de sus subcarpetas
 * (`crudos` para soltar el material, `assets` para la voz en off).
 *
 * El botón NO puede fallar por "todavía no existe": si falta, se crea antes de
 * abrirla (es la misma carpeta canónica que sella `ensurePieceFolder`).
 */
export async function revealPieceFolder(
  pieceId: number,
  sub?: (typeof MEDIA_SUBDIRS)[number],
): Promise<{ ok: boolean; dir?: string; error?: string }> {
  const piece = await getPiece(pieceId);
  if (!piece) return { ok: false, error: "pieza no encontrada" };
  const ensured = await ensurePieceFolder(pieceId);
  if (ensured.error) return { ok: false, error: ensured.error };
  const dir = pieceMediaDir(ensured.piece ?? piece);
  const target = sub ? join(dir, sub) : dir;
  try {
    if (!existsSync(target)) await mkdir(target, { recursive: true });
    await execFileAsync("open", [target]);
    return { ok: true, dir: target };
  } catch (err) {
    return { ok: false, error: String(err).slice(0, 160) };
  }
}
