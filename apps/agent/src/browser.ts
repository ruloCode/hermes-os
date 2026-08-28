import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { resolve } from "node:path";
import { env } from "./env.js";

/**
 * Control del navegador por voz: abre sitios y ejecuta verbos rápidos sobre
 * el Chrome REAL de la máquina (con las sesiones iniciadas del dueño) vía
 * AppleScript nativo — sin CDP ni puertos de debugging. Las acciones son
 * SEMÁNTICAS de una allowlist (igual que las teclas de los gestos): jamás
 * se ejecuta un script arbitrario que venga del cliente.
 *
 * El único verbo que necesita "execute javascript" es el scroll; Chrome lo
 * bloquea por defecto y hay que activarlo UNA vez en la barra de menús:
 * Ver → Desarrollador → "Permitir JavaScript de Apple Events".
 */

const CHROME = "Google Chrome";
const OSA_TIMEOUT_MS = 5_000;

/** Escapa un string para incrustarlo en AppleScript entre comillas. */
const q = (s: string): string => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

function osascript(script: string): Promise<{ ok: true; out: string } | { ok: false; error: string }> {
  // El control de Chrome es AppleScript puro: en la máquina que no es Mac hay
  // que decirlo tal cual (la voz lee este texto) en vez de soltar un ENOENT.
  if (platform() !== "darwin") {
    return Promise.resolve({
      ok: false,
      error: `El control del navegador solo funciona en la Mac; esta máquina (${env.MACHINE_NAME}) corre ${platform()}.`,
    });
  }
  return new Promise((done) => {
    execFile("osascript", ["-e", script], { timeout: OSA_TIMEOUT_MS }, (err, stdout, stderr) => {
      if (err) done({ ok: false, error: (stderr || err.message).trim() });
      else done({ ok: true, out: stdout.trim() });
    });
  });
}

/** Errores de AppleScript → mensaje útil para que la VOZ lo diga tal cual. */
function friendlyOsaError(raw: string): string {
  if (/JavaScript through AppleScript is turned off|1743/i.test(raw)) {
    return 'Chrome bloquea el scroll por AppleScript. Actívalo una vez: menú Ver → Desarrollador → "Permitir JavaScript de Apple Events".';
  }
  if (/Application isn't running|-600/i.test(raw)) return "Chrome no está abierto.";
  if (/Invalid index|-1719/i.test(raw)) return "No hay ninguna ventana de Chrome abierta.";
  return `Chrome no respondió: ${raw.slice(0, 160)}`;
}

// ── Resolución de destino ("mi linkedin" → URL real) ───────────────────

const SITE_ALIASES: Record<string, string> = {
  linkedin: "https://www.linkedin.com/feed/",
  gmail: "https://mail.google.com/",
  correo: "https://mail.google.com/",
  mail: "https://mail.google.com/",
  calendario: "https://calendar.google.com/",
  calendar: "https://calendar.google.com/",
  github: "https://github.com/",
  youtube: "https://www.youtube.com/",
  twitter: "https://x.com/",
  x: "https://x.com/",
  whatsapp: "https://web.whatsapp.com/",
  notion: "https://www.notion.so/",
  linear: "https://linear.app/",
  claude: "https://claude.ai/",
  chatgpt: "https://chatgpt.com/",
  drive: "https://drive.google.com/",
  maps: "https://www.google.com/maps",
  mapas: "https://www.google.com/maps",
  spotify: "https://open.spotify.com/",
  instagram: "https://www.instagram.com/",
  reddit: "https://www.reddit.com/",
  netflix: "https://www.netflix.com/",
  vercel: "https://vercel.com/",
  supabase: "https://supabase.com/dashboard",
  figma: "https://www.figma.com/",
  meet: "https://meet.google.com/",
};

/**
 * Convierte lo que dijo la voz en una URL: alias conocido → dominio dicho
 * tal cual → búsqueda en Google como red de seguridad (siempre abre ALGO).
 */
export function resolveTarget(raw: string): { url: string; label: string } {
  const target = raw.trim();
  if (/^https?:\/\//i.test(target)) return { url: target, label: target };
  const cleaned = target
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^(mi|mis|el|la|los|las|un|una)\s+/, "")
    .trim();
  const alias = SITE_ALIASES[cleaned];
  if (alias) return { url: alias, label: cleaned };
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/.test(cleaned)) {
    return { url: `https://${cleaned}`, label: cleaned };
  }
  return {
    url: `https://www.google.com/search?q=${encodeURIComponent(target)}`,
    label: `búsqueda "${target}"`,
  };
}

// ── Acciones ───────────────────────────────────────────────────────────

export interface BrowserTab {
  window: number;
  index: number;
  active: boolean;
  url: string;
  title: string;
}

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

/** Abre la URL en Chrome (lo lanza y lo trae al frente si hace falta). */
export function openInBrowser(rawTarget: string): Promise<Result<{ url: string; label: string }>> {
  const { url, label } = resolveTarget(rawTarget);
  return new Promise((done) => {
    execFile("open", ["-a", CHROME, url], { timeout: OSA_TIMEOUT_MS }, (err) => {
      if (!err) return done({ ok: true, url, label });
      // Sin Chrome instalado: cae al navegador por defecto del sistema.
      execFile("open", [url], { timeout: OSA_TIMEOUT_MS }, (err2) => {
        if (err2) done({ ok: false, error: `no pude abrir ${url}: ${err2.message}` });
        else done({ ok: true, url, label });
      });
    });
  });
}

/** Pestañas abiertas (todas las ventanas), con cuál está activa. */
export async function listTabs(): Promise<Result<{ tabs: BrowserTab[] }>> {
  const running = await osascript(
    `tell application "System Events" to (name of processes) contains ${q(CHROME)}`,
  );
  if (running.ok && running.out !== "true") return { ok: true, tabs: [] };
  // OJO: sep/nl se capturan FUERA del tell — dentro, Chrome sombrea la
  // constante `tab` con su clase tab y se concatena el literal "tab".
  const res = await osascript(`
set sep to tab
set nl to linefeed
set out to ""
tell application ${q(CHROME)}
  repeat with w from 1 to count of windows
    set act to active tab index of window w
    repeat with t from 1 to count of tabs of window w
      set out to out & w & sep & t & sep & ((t = act) as text) & sep & (URL of tab t of window w) & sep & (title of tab t of window w) & nl
    end repeat
  end repeat
end tell
return out`);
  if (!res.ok) return { ok: false, error: friendlyOsaError(res.error) };
  const tabs = res.out
    .split("\n")
    .filter(Boolean)
    .map((line): BrowserTab => {
      const [w, t, active, url, ...title] = line.split("\t");
      return {
        window: Number(w),
        index: Number(t),
        active: active === "true",
        url: url ?? "",
        title: title.join("\t"),
      };
    });
  return { ok: true, tabs };
}

/** Cambia a la pestaña cuyo título o URL contenga el query (y enfoca Chrome). */
export async function switchTab(query: string): Promise<Result<{ title: string }>> {
  const listed = await listTabs();
  if (!listed.ok) return listed;
  const needle = query.trim().toLowerCase();
  if (!needle) return { ok: false, error: "¿a qué pestaña?" };
  const match =
    listed.tabs.find((t) => t.title.toLowerCase().includes(needle)) ??
    listed.tabs.find((t) => t.url.toLowerCase().includes(needle));
  if (!match) return { ok: false, error: `no hay ninguna pestaña que coincida con "${query}"` };
  const res = await osascript(`
tell application ${q(CHROME)}
  set active tab index of window ${match.window} to ${match.index}
  set index of window ${match.window} to 1
  activate
end tell`);
  if (!res.ok) return { ok: false, error: friendlyOsaError(res.error) };
  return { ok: true, title: match.title };
}

export const BROWSER_COMMANDS = [
  "back",
  "forward",
  "reload",
  "close_tab",
  "next_tab",
  "prev_tab",
  "scroll_down",
  "scroll_up",
  "scroll_top",
  "scroll_bottom",
] as const;

export type BrowserCommand = (typeof BROWSER_COMMANDS)[number];

const SCROLL_JS: Record<string, string> = {
  scroll_down: "window.scrollBy({top: Math.round(window.innerHeight*0.8), behavior:'smooth'})",
  scroll_up: "window.scrollBy({top: -Math.round(window.innerHeight*0.8), behavior:'smooth'})",
  scroll_top: "window.scrollTo({top: 0, behavior:'smooth'})",
  scroll_bottom: "window.scrollTo({top: document.body.scrollHeight, behavior:'smooth'})",
};

/** Verbo rápido sobre la pestaña activa. Trae Chrome al frente para que se VEA. */
export async function browserCommand(cmd: BrowserCommand): Promise<Result<object>> {
  let body: string;
  switch (cmd) {
    case "back":
      body = "tell active tab of front window to go back";
      break;
    case "forward":
      body = "tell active tab of front window to go forward";
      break;
    case "reload":
      body = "tell active tab of front window to reload";
      break;
    case "close_tab":
      body = "close active tab of front window";
      break;
    case "next_tab":
    case "prev_tab": {
      const delta = cmd === "next_tab" ? "(i mod n) + 1" : "((i + n - 2) mod n) + 1";
      body = `tell front window
    set n to count of tabs
    set i to active tab index
    set active tab index to ${delta}
  end tell`;
      break;
    }
    default:
      body = `tell active tab of front window to execute javascript ${q(SCROLL_JS[cmd])}`;
  }
  const res = await osascript(`
tell application ${q(CHROME)}
  activate
  ${body}
end tell`);
  if (!res.ok) return { ok: false, error: friendlyOsaError(res.error) };
  return { ok: true };
}

// ── Chrome dedicado con CDP (navegación profunda del Agent SDK) ────────
// Chrome 136+ bloquea --remote-debugging-port sobre el perfil personal, así
// que la navegación agéntica usa una instancia APARTE con perfil propio
// (~/.hermes-os/chrome-hermes): visible, persistente (el dueño inicia sesión en
// sus sitios UNA vez ahí) y conviviendo con su Chrome normal. El MCP
// chrome-devtools solo se CONECTA a este CDP — nunca lanza Chrome él mismo,
// así N sesiones SDK concurrentes comparten la misma instancia.

const CDP_PORT = Number(process.env.HERMES_BROWSER_CDP_PORT || 9222);
export const CDP_URL = `http://127.0.0.1:${CDP_PORT}`;
const CDP_PROFILE = resolve(homedir(), ".hermes-os", "chrome-hermes");

export async function cdpAlive(): Promise<boolean> {
  try {
    const res = await fetch(`${CDP_URL}/json/version`, { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch {
    return false;
  }
}

let launching: Promise<{ ok: boolean; error?: string }> | null = null;

/** Garantiza el Chrome CDP dedicado (idempotente y a prueba de carreras). */
export function ensureCdpChrome(): Promise<{ ok: boolean; error?: string }> {
  launching ??= doEnsureCdpChrome().finally(() => {
    launching = null;
  });
  return launching;
}

async function doEnsureCdpChrome(): Promise<{ ok: boolean; error?: string }> {
  if (await cdpAlive()) return { ok: true };
  await mkdir(CDP_PROFILE, { recursive: true });
  // open -na = instancia NUEVA aunque el Chrome personal esté abierto.
  const ok = await new Promise<boolean>((done) => {
    execFile(
      "open",
      [
        "-na",
        CHROME,
        "--args",
        `--user-data-dir=${CDP_PROFILE}`,
        `--remote-debugging-port=${CDP_PORT}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--window-size=1440,900",
      ],
      { timeout: OSA_TIMEOUT_MS },
      (err) => done(!err),
    );
  });
  if (!ok) return { ok: false, error: "no pude lanzar el Chrome dedicado de Hermes" };
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await cdpAlive()) return { ok: true };
  }
  return { ok: false, error: `el Chrome dedicado no expuso CDP en el puerto ${CDP_PORT}` };
}
