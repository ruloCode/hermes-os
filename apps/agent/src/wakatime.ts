import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Tiempo programando HOY según WakaTime (el plugin de los editores ya lo
 * mide). La llave sale de WAKATIME_API_KEY o del ~/.wakatime.cfg que el plugin
 * ya dejó en la Mac — no se copia a ningún otro lado. Caché de 5 min.
 */

let cache: { at: number; value: WakaToday | null } | null = null;

export interface WakaToday {
  seconds: number;
  text: string;
  /** Proyectos de hoy, de más a menos tiempo (máx. 3). */
  projects: Array<{ name: string; seconds: number }>;
}

async function apiKey(): Promise<string | null> {
  const fromEnv = process.env.WAKATIME_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  try {
    const cfg = await readFile(join(homedir(), ".wakatime.cfg"), "utf8");
    return /^\s*api_key\s*=\s*(\S+)/m.exec(cfg)?.[1] ?? null;
  } catch {
    return null;
  }
}

export async function wakatimeToday(): Promise<WakaToday | null> {
  if (cache && Date.now() - cache.at < 5 * 60_000) return cache.value;
  const key = await apiKey();
  if (!key) return null;
  try {
    const res = await fetch("https://wakatime.com/api/v1/users/current/status_bar/today", {
      headers: { Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = ((await res.json()) as { data?: { grand_total?: { total_seconds?: number; text?: string }; projects?: Array<{ name: string; total_seconds: number }> } }).data;
    const value: WakaToday = {
      seconds: Math.round(d?.grand_total?.total_seconds ?? 0),
      text: d?.grand_total?.text ?? "",
      projects: (d?.projects ?? []).slice(0, 3).map((p) => ({ name: p.name, seconds: Math.round(p.total_seconds) })),
    };
    cache = { at: Date.now(), value };
    return value;
  } catch (err) {
    console.error("[wakatime]", err instanceof Error ? err.message : err);
    return cache?.value ?? null;
  }
}
