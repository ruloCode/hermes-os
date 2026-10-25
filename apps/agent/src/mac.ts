import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { env } from "./env.js";
import { openInBrowser, resolveTarget } from "./browser.js";
import { isStrongMatch, matchApp, type MacApp } from "./mac-apps.js";

/**
 * Manos de Hermes en la Mac: abrir apps instaladas (o un sitio en Chrome) y
 * manejar Spotify. Pensado para la voz desde el teléfono / las gafas, donde
 * no hay pantalla: cada respuesta es una frase que se puede decir tal cual.
 *
 * Igual que el navegador y las luces, las acciones son SEMÁNTICAS de una
 * allowlist: lo que llega del cliente es un nombre que se busca en el
 * catálogo REAL de apps instaladas (mac-apps.ts) — jamás una ruta o un
 * script. Sin System Events a propósito: exige el permiso de Automatización
 * sobre TODO el sistema y, sin él, cada llamada se cuelga hasta el timeout.
 * A Spotify se le habla directo (macOS pide permiso para "Spotify" una vez).
 */

type Result = { ok: true; detail: string } | { ok: false; error: string };

const OPEN_TIMEOUT_MS = 8_000;
// Con Spotify cerrado, "play" lo lanza y el AppleScript espera a que arranque.
const OSA_TIMEOUT_MS = 12_000;

function notMac(): Result | null {
  return platform() === "darwin"
    ? null
    : { ok: false, error: `Eso solo funciona en la Mac; esta máquina (${env.MACHINE_NAME}) corre ${platform()}.` };
}

function run(cmd: string, args: string[], timeout: number): Promise<{ ok: true; out: string } | { ok: false; error: string }> {
  return new Promise((done) => {
    execFile(cmd, args, { timeout }, (err, stdout, stderr) => {
      if (err) done({ ok: false, error: (stderr || err.message).trim() });
      else done({ ok: true, out: stdout.trim() });
    });
  });
}

// ── Catálogo de apps instaladas ────────────────────────────────────────

const APP_DIRS = [
  "/Applications",
  "/Applications/Utilities",
  "/System/Applications",
  "/System/Applications/Utilities",
  join(homedir(), "Applications"),
];
// Finder no vive en /Applications.
const EXTRA_APPS: MacApp[] = [{ name: "Finder", path: "/System/Library/CoreServices/Finder.app" }];
const CATALOG_TTL_MS = 60_000;
let catalogCache: { at: number; apps: MacApp[] } | null = null;

/** Apps instaladas: bundles .app de las carpetas estándar y un nivel adentro ("Adobe…", "Chrome Apps"). */
export async function listMacApps(): Promise<MacApp[]> {
  if (catalogCache && Date.now() - catalogCache.at < CATALOG_TTL_MS) return catalogCache.apps;
  const seen = new Map<string, MacApp>();
  const add = (dir: string, entry: string) => {
    const path = join(dir, entry);
    if (!seen.has(path)) seen.set(path, { name: entry.replace(/\.app$/, ""), path });
  };
  for (const dir of APP_DIRS) {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (e.name.endsWith(".app")) add(dir, e.name);
      else if (e.isDirectory() && !e.name.startsWith(".")) {
        const sub = join(dir, e.name);
        for (const s of await readdir(sub).catch(() => [] as string[])) if (s.endsWith(".app")) add(sub, s);
      }
    }
  }
  for (const a of EXTRA_APPS) seen.set(a.path, a);
  const apps = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  catalogCache = { at: Date.now(), apps };
  return apps;
}

// ── Abrir ──────────────────────────────────────────────────────────────

export const MAC_OPEN_KINDS = ["auto", "app", "web"] as const;
export type MacOpenKind = (typeof MAC_OPEN_KINDS)[number];

async function launchApp(app: MacApp): Promise<Result> {
  const r = await run("open", ["-a", app.path], OPEN_TIMEOUT_MS);
  return r.ok ? { ok: true, detail: `abrí ${app.name}` } : { ok: false, error: `no pude abrir ${app.name}: ${r.error.slice(0, 160)}` };
}

async function openWeb(target: string): Promise<Result> {
  const r = await openInBrowser(target);
  return r.ok ? { ok: true, detail: `abrí ${r.label} en Chrome` } : { ok: false, error: r.error };
}

/**
 * "Abre X" en la Mac. En auto: una app instalada que se llama así gana
 * (Spotify, WhatsApp abren la app, no la web); si no, un sitio conocido o un
 * dominio va a Chrome; un prefijo de app ("spoti") es el último recurso.
 * Nunca cae a una búsqueda de Google sin que se pida web explícitamente.
 */
export async function openOnMac(target: string, kind: MacOpenKind = "auto"): Promise<Result> {
  const blocked = notMac();
  if (blocked) return blocked;
  const t = target.trim();
  if (!t) return { ok: false, error: "¿Qué abro? No llegó el nombre." };
  if (kind === "web") return openWeb(t);
  const match = matchApp(t, await listMacApps());
  if (kind === "app") {
    return match ? launchApp(match.app) : { ok: false, error: `No encontré una app que se llame "${t}" en la Mac.` };
  }
  if (match && isStrongMatch(match)) return launchApp(match.app);
  if (resolveTarget(t).kind !== "search") return openWeb(t);
  if (match) return launchApp(match.app);
  return { ok: false, error: `No encontré "${t}" entre las apps de la Mac ni como sitio conocido. Si es una web, pídemela como web.` };
}

// ── Spotify ────────────────────────────────────────────────────────────

export const MAC_MEDIA_ACTIONS = ["play", "pause", "toggle", "next", "previous", "now", "volume", "search"] as const;
export type MacMediaAction = (typeof MAC_MEDIA_ACTIONS)[number];

async function osa(script: string): Promise<{ ok: true; out: string } | { ok: false; error: string }> {
  const r = await run("osascript", ["-e", script], OSA_TIMEOUT_MS);
  if (r.ok) return r;
  if (/-1743|not authori[sz]ed/i.test(r.error)) {
    return { ok: false, error: "macOS no deja que Hermes controle Spotify. Dale permiso en Ajustes → Privacidad y seguridad → Automatización." };
  }
  if (/-1712|timed out|tiempo l[ií]mite/i.test(r.error)) return { ok: false, error: "Spotify no respondió a tiempo." };
  return { ok: false, error: `Spotify no respondió: ${r.error.slice(0, 160)}` };
}

const NOW_SCRIPT = `if application "Spotify" is running then
  tell application "Spotify"
    set st to player state as string
    if st is "stopped" then return "stopped"
    return st & "|" & (name of current track) & "|" & (artist of current track) & "|" & (sound volume as string)
  end tell
else
  return "closed"
end if`;

async function nowPlaying(): Promise<Result> {
  const r = await osa(NOW_SCRIPT);
  if (!r.ok) return r;
  if (r.out === "closed") return { ok: true, detail: "Spotify está cerrado" };
  if (r.out === "stopped") return { ok: true, detail: "Spotify está abierto pero sin nada sonando" };
  const [state, name, artist, volume] = r.out.split("|");
  const verb = state === "playing" ? "suena" : "en pausa";
  return { ok: true, detail: `${verb}: ${name} de ${artist} (volumen ${volume})` };
}

const SIMPLE: Partial<Record<MacMediaAction, string>> = {
  play: "play",
  pause: "pause",
  toggle: "playpause",
  next: "next track",
  previous: "previous track",
};

/** Volumen: número 0-100 o "sube"/"baja" (±15). */
export function parseVolume(value: string | undefined, current: number): number | null {
  const v = (value ?? "").trim().toLowerCase();
  if (/^\d{1,3}$/.test(v)) return Math.max(0, Math.min(100, Number(v)));
  if (/^(sube|subir|mas|más|up|\+)/.test(v)) return Math.min(100, current + 15);
  if (/^(baja|bajar|menos|down|-)/.test(v)) return Math.max(0, current - 15);
  return null;
}

export async function macMedia(action: MacMediaAction, value?: string): Promise<Result> {
  const blocked = notMac();
  if (blocked) return blocked;
  if (action === "now") return nowPlaying();
  if (action === "search") {
    const query = value?.trim();
    if (!query) return { ok: false, error: "¿Qué busco en Spotify? No llegó la búsqueda." };
    const r = await run("open", [`spotify:search:${encodeURIComponent(query)}`], OPEN_TIMEOUT_MS);
    // La búsqueda queda en pantalla; darle play a un resultado es un clic (sin la Web API no hay "pon X").
    return r.ok ? { ok: true, detail: `abrí la búsqueda de "${query}" en Spotify` } : { ok: false, error: `no pude abrir Spotify: ${r.error.slice(0, 160)}` };
  }
  if (action === "volume") {
    const cur = await osa(`tell application "Spotify" to return sound volume`);
    if (!cur.ok) return cur;
    const next = parseVolume(value, Number(cur.out) || 0);
    if (next === null) return { ok: false, error: `volumen inválido: "${value ?? ""}" (0-100, sube o baja)` };
    const r = await osa(`tell application "Spotify" to set sound volume to ${next}`);
    return r.ok ? { ok: true, detail: `volumen de Spotify en ${next}` } : r;
  }
  const cmd = SIMPLE[action];
  if (!cmd) return { ok: false, error: `acción inválida (${MAC_MEDIA_ACTIONS.join("|")})` };
  const r = await osa(`tell application "Spotify" to ${cmd}`);
  if (!r.ok) return r;
  if (action === "pause") return { ok: true, detail: "Spotify en pausa" };
  // Tras play/siguiente/anterior se dice QUÉ suena: el estado tarda un instante en reflejarse.
  await new Promise((res) => setTimeout(res, 400));
  const now = await nowPlaying();
  return now.ok ? now : { ok: true, detail: `listo (${action})` };
}
