/**
 * Medios de COMPOSICIÓN: dónde vive cada sesión en disco, cómo entra el video
 * (adoptar o copiar verificado), ffmpeg/ffprobe, cortes por pasaje,
 * transposición del audio real y el servidor de archivos con Range.
 *
 * Carpeta de una sesión: <root>/<slug>/{crudos,assets,analisis}
 *   crudos/    el original (video de la cámara o memo), JAMÁS se pisa
 *   assets/    session.wav (44.1k mono) + peaks.json
 *   analisis/  <pid>/{mezcla.wav, voz.wav, instrumento.wav, <fuente>_<±n>.wav}
 *
 * Una TOMA de un tema tiene la misma forma en <temas>/<temaId>/tomas/<sid>/
 * (ver temasMediaRoot): crudos/toma.wav es el WAV que subió el browser.
 *
 * ffmpeg/ffprobe van por RUTA ABSOLUTA: launchd corre con PATH mínimo.
 */
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import {
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import { homedir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, resolve, sep } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import type {
  CameraSource,
  ComposeSession,
  MediaBrowse,
  MediaFileInfo,
} from "@hermes/shared";
import { peaksOf } from "@hermes/shared";
import { childEnv } from "../agent/child-env.js";
import { env } from "../env.js";

const execFileAsync = promisify(execFile);

/**
 * Entorno de los procesos de medios (ffmpeg, ffprobe, open, el separador).
 * Procesan archivos NO confiables (lo que venga de una tarjeta o del
 * navegador): un demuxer con un bug no tiene por qué encontrar en su entorno
 * la service role de Supabase, ni la clave de ElevenLabs u OpenAI. Parte de
 * la allowlist de childEnv (PATH, HOME, locale, TMPDIR, proxy) y le quita
 * también lo del CLI de Claude (ANTHROPIC_*, CLAUDE_*, NODE_OPTIONS), que
 * ffmpeg no usa. `extra` = lo que un proceso necesita de verdad, explícito.
 */
export function toolEnv(extra: Record<string, string> = {}): Record<string, string> {
  const out = childEnv();
  for (const k of Object.keys(out)) if (/^(ANTHROPIC_|CLAUDE_)|^NODE_OPTIONS$/.test(k)) delete out[k];
  return { ...out, ...extra };
}

export const FFMPEG = env.FFMPEG_BIN;
/** ffprobe vive al lado de ffmpeg (misma instalación); si no, el de Homebrew. */
export const FFPROBE = existsSync(join(dirname(FFMPEG), "ffprobe"))
  ? join(dirname(FFMPEG), "ffprobe")
  : existsSync("/opt/homebrew/bin/ffprobe")
    ? "/opt/homebrew/bin/ffprobe"
    : "ffprobe";

export const VIDEO_EXTS = new Set([".mp4", ".mov", ".m4v", ".mkv", ".avi", ".mts", ".webm"]);
export const AUDIO_EXTS = new Set([
  ".wav",
  ".mp3",
  ".m4a",
  ".aac",
  ".flac",
  ".ogg",
  ".opus",
  ".aif",
  ".aiff",
  ".caf",
]);
export const SESSION_SUBDIRS = ["crudos", "assets", "analisis"] as const;

/** Relleno alrededor de un pasaje al separar: el modelo necesita contexto en los bordes. */
export const SEPARATION_PAD_SEC = 1.0;
/** Afinación y transposición: rango humano razonable (una octava a cada lado). */
export const MAX_TRANSPOSE = 12;

/** El picker solo navega el home y los discos externos. */
const BROWSE_ROOTS = [homedir(), "/Volumes"];
const LOCAL_ROOT = join(homedir(), "Movies", "composicion", "sesiones");

export function mediaKindOf(name: string): "video" | "audio" | null {
  const ext = extname(name).toLowerCase();
  if (VIDEO_EXTS.has(ext)) return "video";
  if (AUDIO_EXTS.has(ext)) return "audio";
  return null;
}

/** AppleDouble ("._x" en exFAT), .DS_Store y ocultos: nunca son medios. */
const hidden = (name: string) => name.startsWith(".");

// ─────────────────────────── Raíz de medios ───────────────────────────

/** Volumen que contiene una ruta (/Volumes/X) o su carpeta padre. */
function mountOf(path: string): string {
  const m = /^\/Volumes\/[^/]+/.exec(path);
  return m ? m[0] : dirname(path);
}

export interface MediaRootInfo {
  /** Carpeta madre efectiva hoy. */
  root: string;
  kind: "disco" | "local";
  /** ¿Está accesible la raíz configurada? (false = se usa el fallback local). */
  connected: boolean;
  configured: string;
}

/**
 * Raíz efectiva: la configurada si su volumen está montado; si no, el
 * fallback local. Importar nunca se bloquea por un cable (patrón Estudio).
 */
export function mediaRoot(): MediaRootInfo {
  const configured = env.COMPOSICION_MEDIA_ROOT;
  const connected = !!configured && existsSync(mountOf(configured));
  return connected
    ? { root: configured, kind: "disco", connected, configured }
    : { root: LOCAL_ROOT, kind: "local", connected: false, configured };
}

/**
 * Raíz de los TEMAS: carpeta HERMANA de la de sesiones, en el mismo disco
 * (/Volumes/Rulo/composicion/sesiones → /Volumes/Rulo/composicion/temas; el
 * fallback local ~/Movies/composicion/sesiones → ~/Movies/composicion/temas).
 * Mismo disco a propósito: una toma y la sesión de la que salió su tarareo
 * viajan juntas. Si la raíz configurada es el volumen mismo (/Volumes/Rulo),
 * "hermana" sería /Volumes/temas — un volumen que no existe —, así que ahí va
 * DENTRO de la raíz.
 */
export function temasMediaRoot(): MediaRootInfo {
  const base = mediaRoot();
  const parent = dirname(base.root);
  const root = parent === "/" || parent === "/Volumes" ? join(base.root, "temas") : join(parent, "temas");
  return { ...base, root };
}

/** Carpeta de una toma: <temas>/<temaId>/tomas/<sessionId>/{crudos,assets,analisis}. */
export function takeMediaDir(root: string, temaId: string, sessionId: string): string {
  return join(root, temaId, "tomas", sessionId);
}

export async function ensureSessionFolder(dir: string): Promise<void> {
  for (const sub of SESSION_SUBDIRS) await mkdir(join(dir, sub), { recursive: true });
}

/**
 * ¿El archivo YA está dentro de la carpeta de una sesión (<root>/<x>/crudos/<f>)?
 * Entonces se ADOPTA: nada de copiar 4,7 GB sobre sí mismos.
 */
export async function adoptableFolder(
  sourcePath: string,
): Promise<{ dir: string; folder: string; kind: "disco" | "local" } | null> {
  let real: string;
  try {
    real = await realpath(sourcePath);
  } catch {
    return null;
  }
  const roots: { root: string; kind: "disco" | "local" }[] = [];
  if (env.COMPOSICION_MEDIA_ROOT) roots.push({ root: env.COMPOSICION_MEDIA_ROOT, kind: "disco" });
  roots.push({ root: LOCAL_ROOT, kind: "local" });
  for (const { root, kind } of roots) {
    let realRoot: string;
    try {
      realRoot = await realpath(root);
    } catch {
      continue;
    }
    if (!real.startsWith(realRoot + sep)) continue;
    const parts = real.slice(realRoot.length + 1).split(sep);
    if (parts.length === 3 && parts[1] === "crudos" && parts[0] && !hidden(parts[0])) {
      return { dir: join(realRoot, parts[0]), folder: parts[0], kind };
    }
  }
  return null;
}

// ─────────────────────────── ffprobe ───────────────────────────

export interface ProbeInfo {
  durationSec?: number;
  video?: { width: number; height: number; codec: string; fps?: number };
  audio?: { sampleRate: number; channels: number; codec: string };
  /** creation_time del contenedor (la cámara la escribe en UTC). */
  recordedAt?: string;
}

const probeCache = new Map<string, { key: string; info: ProbeInfo }>();

export async function probeMedia(path: string): Promise<ProbeInfo> {
  const st = await stat(path);
  const key = `${st.size}:${st.mtimeMs}`;
  const cached = probeCache.get(path);
  if (cached && cached.key === key) return cached.info;
  const { stdout } = await execFileAsync(
    FFPROBE,
    ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", path],
    { timeout: 30_000, maxBuffer: 8 * 1024 * 1024, env: toolEnv() },
  );
  const data = JSON.parse(stdout) as {
    format?: { duration?: string; tags?: Record<string, string> };
    streams?: {
      codec_type?: string;
      codec_name?: string;
      width?: number;
      height?: number;
      avg_frame_rate?: string;
      r_frame_rate?: string;
      sample_rate?: string;
      channels?: number;
      disposition?: { attached_pic?: number };
      tags?: Record<string, string>;
    }[];
  };
  const info: ProbeInfo = {};
  const duration = Number(data.format?.duration ?? 0);
  if (duration > 0) info.durationSec = Math.round(duration * 1000) / 1000;
  // La portada (mjpeg attached_pic) también es un stream de video: se salta.
  const v = data.streams?.find(
    (s) => s.codec_type === "video" && !s.disposition?.attached_pic && s.codec_name !== "mjpeg",
  );
  if (v?.width && v.height) {
    const fps = parseRate(v.avg_frame_rate) ?? parseRate(v.r_frame_rate);
    info.video = { width: v.width, height: v.height, codec: v.codec_name ?? "?", ...(fps ? { fps } : {}) };
  }
  const a = data.streams?.find((s) => s.codec_type === "audio");
  if (a?.sample_rate) {
    info.audio = { sampleRate: Number(a.sample_rate), channels: a.channels ?? 1, codec: a.codec_name ?? "?" };
  }
  const created = data.format?.tags?.creation_time ?? v?.tags?.creation_time;
  if (created && !Number.isNaN(Date.parse(created))) info.recordedAt = new Date(created).toISOString();
  probeCache.set(path, { key, info });
  return info;
}

function parseRate(r?: string): number | undefined {
  if (!r) return undefined;
  const [n, d] = r.split("/").map(Number);
  if (!n || !d) return undefined;
  return Math.round((n / d) * 1000) / 1000;
}

// ─────────────────────────── ffmpeg ───────────────────────────

/** Error de un proceso detenido a propósito (no es una falla). */
export class AbortedError extends Error {
  constructor() {
    super("detenido");
  }
}

/**
 * Corre ffmpeg con progreso real (`-progress pipe:1` → out_time_us). Mata el
 * proceso si llega la señal de detener. Rechaza con la cola de stderr.
 */
export function runFfmpeg(
  args: string[],
  opts: { signal?: AbortSignal; durationSec?: number; onProgress?: (pct: number) => void; timeoutMs?: number } = {},
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    if (opts.signal?.aborted) return reject(new AbortedError());
    const child = spawn(
      FFMPEG,
      ["-nostdin", "-hide_banner", "-loglevel", "error", "-progress", "pipe:1", "-nostats", "-y", ...args],
      { stdio: ["ignore", "pipe", "pipe"], env: toolEnv() },
    );
    let err = "";
    let buf = "";
    child.stdout.on("data", (d: Buffer) => {
      buf += d.toString();
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        const m = /^out_time_us=(\d+)/.exec(line);
        if (m && opts.durationSec && opts.onProgress) {
          opts.onProgress(Math.min(1, Number(m[1]) / 1e6 / opts.durationSec));
        }
      }
    });
    child.stderr.on("data", (d: Buffer) => {
      err = (err + d.toString()).slice(-2000);
    });
    const onAbort = () => child.kill("SIGKILL");
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    const timer = opts.timeoutMs ? setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs) : null;
    child.on("error", (e) => {
      opts.signal?.removeEventListener("abort", onAbort);
      if (timer) clearTimeout(timer);
      reject(new Error(`no pude ejecutar ffmpeg (${FFMPEG}): ${String(e)}`));
    });
    child.on("close", (code) => {
      opts.signal?.removeEventListener("abort", onAbort);
      if (timer) clearTimeout(timer);
      if (opts.signal?.aborted) return reject(new AbortedError());
      if (code === 0) resolvePromise();
      else reject(new Error(`ffmpeg salió ${code}: ${err.trim().slice(-400)}`));
    });
  });
}

/** Escribe con ffmpeg a un tmp y renombra: un corte a medias nunca pasa por terminado. */
async function ffmpegTo(
  out: string,
  args: (tmp: string) => string[],
  opts: Parameters<typeof runFfmpeg>[1] = {},
): Promise<void> {
  await mkdir(dirname(out), { recursive: true });
  const tmp = join(dirname(out), `.${basename(out, extname(out))}.part${extname(out)}`);
  try {
    await runFfmpeg(args(tmp), opts);
    await rename(tmp, out);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

/** Audio de la sesión: WAV 44.1k mono (lo que miden el separador y el tracker). */
export function extractSessionAudio(
  input: string,
  out: string,
  opts: { signal?: AbortSignal; durationSec?: number; onProgress?: (pct: number) => void } = {},
): Promise<void> {
  return ffmpegTo(
    out,
    (tmp) => ["-i", input, "-vn", "-map", "0:a:0", "-ac", "1", "-ar", "44100", "-c:a", "pcm_s16le", tmp],
    opts,
  );
}

/** MP3 16k mono 32 kbps para el STT: 20 min ≈ 5 MB en vez de 110. */
export function compressForStt(input: string, out: string, signal?: AbortSignal): Promise<void> {
  return ffmpegTo(
    out,
    (tmp) => ["-i", input, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libmp3lame", "-b:a", "32k", tmp],
    { signal, timeoutMs: 10 * 60_000 },
  );
}

/** Corta [start, start+dur] de un WAV a otro WAV (PCM16, misma frecuencia). */
export function cutWav(
  input: string,
  out: string,
  start: number,
  dur: number,
  signal?: AbortSignal,
): Promise<void> {
  return ffmpegTo(
    out,
    (tmp) => [
      "-ss",
      start.toFixed(3),
      "-t",
      dur.toFixed(3),
      "-i",
      input,
      "-ac",
      "1",
      "-c:a",
      "pcm_s16le",
      tmp,
    ],
    { signal, timeoutMs: 120_000 },
  );
}

/**
 * PCM float32 mono por pipe (sin archivo intermedio) para analizar en JS.
 * 20 min a 16 kHz = 80 MB: se decodifica una vez y se suelta.
 */
export function decodePcm(
  input: string,
  opts: { sr?: number; start?: number; duration?: number; signal?: AbortSignal } = {},
): Promise<Float32Array> {
  const sr = opts.sr ?? 16000;
  return new Promise((resolvePromise, reject) => {
    if (opts.signal?.aborted) return reject(new AbortedError());
    const args = ["-nostdin", "-hide_banner", "-loglevel", "error"];
    if (opts.start) args.push("-ss", opts.start.toFixed(3));
    if (opts.duration) args.push("-t", opts.duration.toFixed(3));
    args.push("-i", input, "-vn", "-ac", "1", "-ar", String(sr), "-f", "f32le", "pipe:1");
    const child = spawn(FFMPEG, args, { stdio: ["ignore", "pipe", "pipe"], env: toolEnv() });
    const chunks: Buffer[] = [];
    let err = "";
    child.stdout.on("data", (d: Buffer) => chunks.push(d));
    child.stderr.on("data", (d: Buffer) => {
      err = (err + d.toString()).slice(-1000);
    });
    const onAbort = () => child.kill("SIGKILL");
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    child.on("error", (e) => reject(new Error(`no pude ejecutar ffmpeg: ${String(e)}`)));
    child.on("close", (code) => {
      opts.signal?.removeEventListener("abort", onAbort);
      if (opts.signal?.aborted) return reject(new AbortedError());
      if (code !== 0) return reject(new Error(`ffmpeg (decodificar) salió ${code}: ${err.trim()}`));
      const buf = Buffer.concat(chunks);
      // Copia alineada: el Buffer puede venir del pool con byteOffset no múltiplo de 4.
      const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + (buf.length - (buf.length % 4)));
      resolvePromise(new Float32Array(ab));
    });
  });
}

// ─────────────────────────── Copia verificada ───────────────────────────

/**
 * Copia con md5 por streams: se hashea el origen MIENTRAS se escribe y luego
 * se relee la copia para comparar. Progreso real sobre las dos pasadas
 * (copiar + verificar). Escribe a .part y renombra solo si coincide.
 */
export async function copyVerified(
  src: string,
  dest: string,
  opts: { signal?: AbortSignal; onProgress?: (done: number, total: number, phase: "copiar" | "verificar") => void } = {},
): Promise<{ md5: string; bytes: number }> {
  const { size } = await stat(src);
  await mkdir(dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  const total = size * 2;
  let done = 0;
  let lastReport = 0;
  const report = (phase: "copiar" | "verificar") => {
    // El callback persiste estado: se limita a ~1 vez por cada 0,5 % para no escribir JSON por chunk.
    if (!opts.onProgress || (done - lastReport < total / 200 && done < total)) return;
    lastReport = done;
    opts.onProgress(done, total, phase);
  };

  const srcHash = createHash("md5");
  const tap = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      srcHash.update(chunk);
      done += chunk.length;
      report("copiar");
      cb(null, chunk);
    },
  });
  try {
    await pipeline(createReadStream(src, { highWaterMark: 4 * 1024 * 1024 }), tap, createWriteStream(part), {
      signal: opts.signal,
    });
    const md5 = srcHash.digest("hex");

    const destHash = createHash("md5");
    const verify = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        destHash.update(chunk);
        done += chunk.length;
        report("verificar");
        cb();
      },
    });
    await pipeline(createReadStream(part, { highWaterMark: 4 * 1024 * 1024 }), verify, {
      signal: opts.signal,
    });
    const check = destHash.digest("hex");
    if (check !== md5) throw new Error(`la copia no coincide (md5 ${md5.slice(0, 8)} ≠ ${check.slice(0, 8)})`);
    await rename(part, dest);
    opts.onProgress?.(total, total, "verificar");
    return { md5, bytes: size };
  } catch (err) {
    await rm(part, { force: true }).catch(() => {});
    if (opts.signal?.aborted) throw new AbortedError();
    throw err;
  }
}

// ─────────────────────────── Peaks de la sesión ───────────────────────────

/** Cubetas de la onda de la sesión: ~2 por segundo, entre 400 y 4000. */
export function sessionPeakBuckets(durationSec: number): number {
  return Math.max(400, Math.min(4000, Math.round(durationSec * 2)));
}

/** Picos cacheados en assets/peaks.json (se recalculan si cambia session.wav). */
export async function sessionPeaks(
  session: ComposeSession,
): Promise<{ peaks: number[]; durationSec: number } | null> {
  if (!session.files.audio) return null;
  const wav = join(session.mediaDir, session.files.audio);
  let st;
  try {
    st = await stat(wav);
  } catch {
    return null;
  }
  const cachePath = join(session.mediaDir, "assets", "peaks.json");
  try {
    const cached = JSON.parse(await readFile(cachePath, "utf8")) as {
      peaks: number[];
      durationSec: number;
      source: { size: number; mtimeMs: number };
    };
    if (cached.source?.size === st.size && cached.source.mtimeMs === st.mtimeMs) {
      return { peaks: cached.peaks, durationSec: cached.durationSec };
    }
  } catch {
    /* sin cache: se calcula */
  }
  // 8 kHz basta para una onda de ~2 cubetas por segundo y cuesta la mitad.
  const pcm = await decodePcm(wav, { sr: 8000 });
  const durationSec = pcm.length / 8000;
  const peaks = peaksOf(pcm, sessionPeakBuckets(durationSec)).map((p) => Math.round(p * 1000) / 1000);
  await writeFile(
    cachePath,
    JSON.stringify({ peaks, durationSec, source: { size: st.size, mtimeMs: st.mtimeMs } }),
  ).catch(() => {});
  return { peaks, durationSec };
}

// ─────────────────────────── Transposición ───────────────────────────

/** Nombre del render transpuesto: "voz_+2.wav", "mezcla_-3.wav". */
// ─────────────────────────── Separación reanudable ───────────────────────────

/** Entrada temporal del separador (corte con relleno) dentro de la carpeta del pasaje. */
export const SEP_INPUT = "_sep_in.wav";

/**
 * ¿Este pasaje ya quedó separado? stems.json sin error + voz.wav. ensureCuts
 * borra stems.json cuando cambia el tramo, así que su presencia implica que el
 * corte coincide. Reanudar una sesión salta lo que ya pasó: separar 50
 * pasajes toma ~5 min y rehacerlos por un reinicio no le sirve a nadie.
 */
export async function isSeparated(passageDir: string): Promise<boolean> {
  if (!existsSync(join(passageDir, "voz.wav"))) return false;
  try {
    const stems = JSON.parse(await readFile(join(passageDir, "stems.json"), "utf8")) as { error?: string };
    return !stems.error;
  } catch {
    return false;
  }
}

/**
 * Borra las entradas del separador que dejó un proceso muerto (el `finally`
 * no corre si se cae el agente). Devuelve cuántas borró. Un disco desmontado
 * no es error: no hay nada que limpiar ahí.
 */
export async function cleanOrphanSepInputs(mediaDir: string): Promise<number> {
  const root = join(mediaDir, "analisis");
  let n = 0;
  for (const d of await readdir(root).catch(() => [] as string[])) {
    const f = join(root, d, SEP_INPUT);
    if (existsSync(f)) {
      await rm(f, { force: true }).catch(() => {});
      n++;
    }
  }
  return n;
}

export function transposedName(source: "voz" | "mezcla", semitones: number): string {
  return `${source}_${semitones > 0 ? "+" : ""}${semitones}.wav`;
}

/**
 * Args de ffmpeg para transponer SIN cambiar la duración: asetrate sube/baja
 * tono y tempo a la vez, aresample vuelve a la frecuencia original y atempo
 * devuelve el tempo (WSOLA). Medido: 0 c de error, ~300× tiempo real. Mueve
 * los formantes (voz de ardilla/grave), por eso la UI avisa desde ±4.
 */
export function transposeArgs(input: string, output: string, semitones: number, sr: number): string[] {
  if (!Number.isInteger(semitones) || Math.abs(semitones) > MAX_TRANSPOSE)
    throw new Error(`semitonos fuera de rango (±${MAX_TRANSPOSE})`);
  const r = 2 ** (semitones / 12);
  return [
    "-i",
    input,
    "-af",
    `asetrate=${sr}*${r.toFixed(6)},aresample=${sr},atempo=${(1 / r).toFixed(6)}`,
    "-c:a",
    "pcm_s16le",
    output,
  ];
}

/** Render cacheado: si ya existe, no se vuelve a calcular. Devuelve la ruta relativa. */
export async function renderTransposed(
  mediaDir: string,
  passageDir: string,
  source: "voz" | "mezcla",
  semitones: number,
): Promise<string> {
  const input = join(mediaDir, passageDir, `${source}.wav`);
  if (!existsSync(input)) throw new Error(`no existe ${source}.wav de este pasaje`);
  const rel = join(passageDir, transposedName(source, semitones));
  const out = join(mediaDir, rel);
  if (existsSync(out)) return rel;
  const probe = await probeMedia(input);
  const sr = probe.audio?.sampleRate ?? 44100;
  await ffmpegTo(out, (tmp) => transposeArgs(input, tmp, semitones, sr), { timeoutMs: 120_000 });
  return rel;
}

// ─────────────────────────── Servir archivos (Range) ───────────────────────────

export class FileAccessError extends Error {
  constructor(
    message: string,
    public status: 400 | 403 | 404,
  ) {
    super(message);
  }
}

/**
 * Resuelve `rel` DENTRO de `mediaDir`. Rechaza absolutas, "..", NUL y
 * symlinks que escapen (se compara el realpath contra el realpath de la
 * carpeta, con separador al final para que "/a/b" no deje pasar "/a/bc").
 */
export async function resolveMediaFile(mediaDir: string, rel: string): Promise<string> {
  if (!rel || rel.includes("\0")) throw new FileAccessError("ruta vacía", 400);
  if (isAbsolute(rel) || rel.startsWith("~")) throw new FileAccessError("la ruta debe ser relativa", 400);
  const parts = rel.split(/[\\/]+/);
  if (parts.some((p) => p === ".." || p === "."))
    throw new FileAccessError("ruta inválida", 400);
  let realDir: string;
  let realFile: string;
  try {
    realDir = await realpath(mediaDir);
  } catch {
    throw new FileAccessError("la carpeta de la sesión no está disponible (¿disco desconectado?)", 404);
  }
  try {
    realFile = await realpath(resolve(realDir, rel));
  } catch {
    throw new FileAccessError("archivo no encontrado", 404);
  }
  if (!realFile.startsWith(realDir + sep)) throw new FileAccessError("fuera de la carpeta de la sesión", 403);
  const st = await stat(realFile);
  if (!st.isFile()) throw new FileAccessError("no es un archivo", 400);
  return realFile;
}

export type ParsedRange =
  | { kind: "none" }
  | { kind: "range"; start: number; end: number }
  | { kind: "unsatisfiable" };

/**
 * Range de un solo tramo ("bytes=a-b", "bytes=a-", "bytes=-n"). Multi-rango o
 * sintaxis rara → "none" (se sirve completo: la RFC lo permite).
 */
export function parseRange(header: string | undefined | null, size: number): ParsedRange {
  if (!header) return { kind: "none" };
  const m = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i.exec(header);
  if (!m) return { kind: "none" };
  const [, a, b] = m;
  if (a === "" && b === "") return { kind: "none" };
  if (size <= 0) return { kind: "unsatisfiable" };
  if (a === "") {
    const n = Number(b);
    if (n <= 0) return { kind: "unsatisfiable" };
    return { kind: "range", start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(a);
  if (start >= size) return { kind: "unsatisfiable" };
  const end = b === "" ? size - 1 : Math.min(Number(b), size - 1);
  if (end < start) return { kind: "unsatisfiable" };
  return { kind: "range", start, end };
}

const CONTENT_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska",
  ".webm": "video/webm",
  ".avi": "video/x-msvideo",
  ".mts": "video/mp2t",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".aif": "audio/aiff",
  ".aiff": "audio/aiff",
  ".caf": "audio/x-caf",
  ".json": "application/json",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};

export function contentTypeOf(path: string): string {
  return CONTENT_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
}

/**
 * Respuesta de archivo con Range/206. El <video> del dashboard pide tramos:
 * sin esto, un MP4 de 4,7 GB se bajaba entero antes de poder buscar.
 */
export async function fileResponse(absPath: string, rangeHeader?: string | null): Promise<Response> {
  const { size } = await stat(absPath);
  const type = contentTypeOf(absPath);
  const range = parseRange(rangeHeader, size);
  const base = { "Content-Type": type, "Accept-Ranges": "bytes", "Cache-Control": "no-store" };
  if (range.kind === "unsatisfiable") {
    return new Response(null, { status: 416, headers: { ...base, "Content-Range": `bytes */${size}` } });
  }
  const start = range.kind === "range" ? range.start : 0;
  const end = range.kind === "range" ? range.end : size - 1;
  const length = size === 0 ? 0 : end - start + 1;
  const body = size === 0 ? null : streamFile(absPath, start, end);
  const headers: Record<string, string> = { ...base, "Content-Length": String(length) };
  if (range.kind === "range") headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
  return new Response(body, { status: range.kind === "range" ? 206 : 200, headers });
}

/** Stream web de un tramo; se cierra el descriptor si el browser corta (seek). */
function streamFile(path: string, start: number, end: number): ReadableStream<Uint8Array> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  let pos = start;
  const CHUNK = 256 * 1024;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        handle ??= await open(path, "r");
        if (pos > end) {
          await handle.close();
          handle = null;
          controller.close();
          return;
        }
        const len = Math.min(CHUNK, end - pos + 1);
        const buf = Buffer.allocUnsafe(len);
        const { bytesRead } = await handle.read(buf, 0, len, pos);
        if (bytesRead === 0) {
          await handle.close();
          handle = null;
          controller.close();
          return;
        }
        pos += bytesRead;
        controller.enqueue(new Uint8Array(buf.buffer, buf.byteOffset, bytesRead));
      } catch (err) {
        await handle?.close().catch(() => {});
        handle = null;
        controller.error(err);
      }
    },
    async cancel() {
      await handle?.close().catch(() => {});
      handle = null;
    },
  });
}

// ─────────────────────────── Fuentes: cámaras y picker ───────────────────────────

function insideRoots(abs: string): boolean {
  return BROWSE_ROOTS.some((root) => abs === root || abs.startsWith(root + "/"));
}

/** ¿Se puede importar esta ruta? (dentro de ~ o /Volumes, existe, es video/audio). */
export async function validateImportPath(raw: string): Promise<string> {
  const path = resolve(raw.trim().replace(/^~(?=$|\/)/, homedir()));
  if (!insideRoots(path)) throw new FileAccessError("solo se importa desde tu carpeta personal o /Volumes", 400);
  if (hidden(basename(path))) throw new FileAccessError("archivo oculto", 400);
  if (!mediaKindOf(path)) throw new FileAccessError("no es un video ni un audio reconocible", 400);
  let st;
  try {
    st = await stat(path);
  } catch {
    throw new FileAccessError("el archivo no existe (¿la tarjeta sigue montada?)", 404);
  }
  if (!st.isFile()) throw new FileAccessError("no es un archivo", 400);
  return path;
}

/** Duración por ffprobe con tope de tiempo: una SD lenta no congela la lista. */
async function durationOf(path: string): Promise<number | undefined> {
  try {
    return (await probeMedia(path)).durationSec;
  } catch {
    return undefined;
  }
}

async function fileInfo(path: string, probe: boolean): Promise<MediaFileInfo | null> {
  const kind = mediaKindOf(path);
  if (!kind) return null;
  try {
    const st = await stat(path);
    if (!st.isFile()) return null;
    const info: MediaFileInfo = {
      path,
      name: basename(path),
      bytes: st.size,
      mtime: st.mtime.toISOString(),
      kind,
    };
    if (probe) {
      const d = await durationOf(path);
      if (d) info.durationSec = d;
    }
    return info;
  } catch {
    return null;
  }
}

/** Clips de una carpeta DCIM (recursivo, 3 niveles), agrupados por carpeta. */
async function scanDcim(dir: string, depth: number, out: Map<string, string[]>): Promise<void> {
  if (depth > 3) return;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (hidden(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) await scanDcim(full, depth + 1, out);
    else if (e.isFile() && mediaKindOf(e.name) === "video") {
      const list = out.get(dir) ?? [];
      list.push(full);
      out.set(dir, list);
    }
  }
}

/**
 * Cámaras montadas: cualquier volumen con DCIM/ que tenga videos. Nada de
 * nombres de marca: el estándar DCIM lo cumplen todas.
 */
export async function detectCameras(volumesDir = "/Volumes"): Promise<CameraSource[]> {
  let vols;
  try {
    vols = await readdir(volumesDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const cameras: CameraSource[] = [];
  for (const v of vols) {
    if (hidden(v.name)) continue;
    const volume = join(volumesDir, v.name);
    const dcim = join(volume, "DCIM");
    if (!existsSync(dcim)) continue;
    const byDir = new Map<string, string[]>();
    await scanDcim(dcim, 0, byDir);
    for (const [dir, paths] of byDir) {
      const infos: MediaFileInfo[] = [];
      for (const p of paths) {
        const info = await fileInfo(p, false);
        if (info) infos.push(info);
      }
      // Lo más reciente arriba: lo de hoy es lo que se busca.
      infos.sort((a, b) => b.mtime.localeCompare(a.mtime));
      // Duración solo para los primeros: ffprobe en una SD lenta cuesta.
      for (const info of infos.slice(0, 24)) {
        const d = await durationOf(info.path);
        if (d) info.durationSec = d;
      }
      if (infos.length) cameras.push({ volume, dir, files: infos });
    }
  }
  return cameras;
}

/** Picker server-side de video + audio, acotado a ~ y /Volumes. */
export async function browseMedia(dirIn?: string): Promise<MediaBrowse> {
  const fallback = existsSync(join(homedir(), "Movies")) ? join(homedir(), "Movies") : homedir();
  let dir = resolve(dirIn?.trim() ? dirIn.trim().replace(/^~(?=$|\/)/, homedir()) : fallback);
  if (!insideRoots(dir) || !existsSync(dir)) dir = fallback;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    dir = fallback;
    entries = await readdir(dir, { withFileTypes: true });
  }
  const dirs: MediaBrowse["entries"] = [];
  const files: MediaFileInfo[] = [];
  for (const e of entries) {
    if (hidden(e.name)) continue;
    const path = join(dir, e.name);
    if (e.isDirectory()) dirs.push({ kind: "dir", name: e.name, path });
    else if (e.isFile()) {
      const info = await fileInfo(path, false);
      if (info) files.push(info);
    }
  }
  dirs.sort((a, b) => a.name.localeCompare(b.name));
  files.sort((a, b) => b.mtime.localeCompare(a.mtime));
  for (const f of files.slice(0, 40)) {
    const d = await durationOf(f.path);
    if (d) f.durationSec = d;
  }
  const parent = dirname(dir);
  return {
    dir,
    parent: parent !== dir && insideRoots(parent) ? parent : null,
    entries: [...dirs, ...files.map((f) => ({ ...f, kind: f.kind }))],
  };
}

/** Abre la carpeta de la sesión en Finder (la crea si falta: el botón siempre hace algo). */
export async function revealFolder(dir: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await ensureSessionFolder(dir);
    await execFileAsync("/usr/bin/open", [dir], { timeout: 10_000, env: toolEnv() });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `no se pudo abrir ${dir}: ${String(err).slice(0, 160)}` };
  }
}
