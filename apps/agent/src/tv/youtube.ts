import { execFile } from "node:child_process";
import { existsSync } from "node:fs";

/**
 * "Pon X en YouTube": busca con yt-dlp (sin API key ni cuota; ya está en la
 * Mac para el Estudio) y devuelve candidatos reales. Elegir y abrir en la TV
 * lo hace tv/index.ts con el enlace profundo de la app de YouTube.
 */

const YTDLP = (() => {
  const fixed = process.env.YTDLP_BIN?.trim();
  if (fixed) return fixed;
  return ["/opt/homebrew/bin/yt-dlp", `${process.env.HOME}/.local/bin/yt-dlp`].find((p) => existsSync(p)) ?? "yt-dlp";
})();

export interface YtVideo {
  id: string;
  title: string;
  channel: string;
  /** segundos; null si yt-dlp no lo dio (en vivo, estreno). */
  duration: number | null;
}

/** Una línea de `--print "%(id)s\t%(duration)s\t%(channel)s\t%(title)s"` → video (null si no cuadra). */
export function parseYtLine(line: string): YtVideo | null {
  const [id, dur, channel, ...rest] = line.split("\t");
  if (!id || !/^[\w-]{11}$/.test(id)) return null;
  const d = Number(dur);
  return { id, duration: Number.isFinite(d) && d > 0 ? Math.round(d) : null, channel: channel ?? "", title: rest.join("\t").trim() };
}

/**
 * El primero que de verdad es un video para ver: ni Short (< 90 s) ni en vivo
 * sin duración. Si ninguno pasa, el primero (mejor algo que nada, pero dicho).
 */
export function pickVideo(videos: readonly YtVideo[]): YtVideo | null {
  return videos.find((v) => v.duration != null && v.duration >= 90) ?? videos[0] ?? null;
}

export function searchYouTube(query: string, n = 6): Promise<YtVideo[]> {
  return new Promise((resolve) => {
    execFile(
      YTDLP,
      [`ytsearch${n}:${query}`, "--flat-playlist", "--no-warnings", "--print", "%(id)s\t%(duration)s\t%(channel)s\t%(title)s"],
      { timeout: 25_000, maxBuffer: 1024 * 1024 },
      (err, out) => resolve(err ? [] : out.split("\n").map(parseYtLine).filter((v): v is YtVideo => v !== null)),
    );
  });
}

export const youtubeUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;
