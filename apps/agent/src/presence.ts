import { existsSync, readFileSync } from "node:fs";
import { arch, networkInterfaces, platform } from "node:os";
import { execFile } from "node:child_process";
import type { MachineCapabilities, MachinePresence } from "@hermes/shared";
import { supabase } from "./supabase.js";
import { env } from "./env.js";
import { resolveClaudeBin } from "./agent/claude-cli.js";

let currentStatus: "idle" | "working" | "thinking" = "idle";
let currentTask: string | null = null;

export function setPresence(
  status: "idle" | "working" | "thinking",
  task?: string | null,
) {
  currentStatus = status;
  currentTask = task ?? null;
  void push();
}

export function getPresence() {
  return { status: currentStatus, currentTask };
}

// ── Identidad de red de ESTA máquina ───────────────────────────────────
// Otras máquinas de la LAN necesitan saber cómo alcanzarnos. Publicarlo en el
// heartbeat es lo que convierte el selector de máquina en descubrimiento real
// (antes las URLs vivían horneadas en NEXT_PUBLIC_HERMES_AGENTS).

// Interfaces que NUNCA son la LAN de casa: túneles, AirDrop, puentes de VMs y
// docker. Sin este filtro el agente publica una IP a la que nadie llega.
const SKIP_IFACE = /^(utun|awdl|llw|bridge|docker|veth|vboxnet|vmnet|tun|tap|ap\d)/i;

/** Rango privado + prioridad: la LAN de casa (192.168) manda sobre 10/172. */
function lanRank(ip: string): number {
  if (ip.startsWith("192.168.")) return 3;
  if (ip.startsWith("10.")) return 2;
  const m = /^172\.(\d+)\./.exec(ip);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return 1;
  return 0; // pública, link-local (169.254) o loopback: no sirve
}

/** IPv4 privada de esta máquina, la mejor candidata. null si solo hay loopback. */
export function detectLanIp(): string | null {
  let best: { ip: string; rank: number } | null = null;
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    if (SKIP_IFACE.test(name)) continue;
    for (const a of addrs ?? []) {
      if (a.internal || a.family !== "IPv4") continue;
      const rank = lanRank(a.address);
      if (rank === 0) continue;
      if (!best || rank > best.rank) best = { ip: a.address, rank };
    }
  }
  return best?.ip ?? null;
}

/** true si corremos dentro de WSL (importa: la red y las rutas no son Windows). */
function isWsl(): boolean {
  if (platform() !== "linux") return false;
  try {
    return /microsoft/i.test(readFileSync("/proc/version", "utf8"));
  } catch {
    return false;
  }
}

function describeOs(): string {
  const label =
    platform() === "darwin"
      ? "macOS"
      : platform() === "win32"
        ? "Windows"
        : platform() === "linux"
          ? isWsl()
            ? "Linux (WSL)"
            : "Linux"
          : platform();
  return `${label} · ${arch()}`;
}

// ¿Existe el CLI de `claude` en esta máquina? Es la capacidad que decide si un
// PC puede ejecutar tareas o solo mirar, así que se verifica de verdad (una
// invocación al arrancar) en vez de asumirlo por el sistema operativo.
let claudeOk: boolean | null = null;
let probeStarted = false;
function ensureClaudeProbe(): void {
  if (probeStarted) return;
  probeStarted = true;
  const bin = resolveClaudeBin();
  execFile(bin, ["--version"], { timeout: 10_000 }, (err) => {
    claudeOk = !err;
    if (err) console.log(`[hermes] claude CLI no responde (${bin}): runs desactivados`);
  });
}

function capabilities(): MachineCapabilities {
  ensureClaudeProbe(); // el primer latido lo arranca; el resultado entra al siguiente
  const mac = platform() === "darwin";
  return {
    vault: Boolean(env.VAULT_PATH) && existsSync(env.VAULT_PATH),
    runs: claudeOk === true,
    // Gestos y control de navegador son CGEvent/AppleScript: solo macOS.
    gestures: mac && env.GESTURES_ENABLED,
    browser: mac,
    liveMeetings: Boolean(env.ASSEMBLYAI_API_KEY) || env.LIVE_STT_PROVIDER === "fake",
    estudioMedia: !!env.ESTUDIO_MEDIA_ROOT && existsSync(env.ESTUDIO_MEDIA_ROOT),
    codeGraph: existsSync(env.GRAPHIFY_BIN),
  };
}

/** URL con la que otro PC de la red alcanza a este agente. */
export function selfBaseUrl(): string | null {
  if (env.PUBLIC_URL) return env.PUBLIC_URL;
  const ip = detectLanIp();
  return ip ? `http://${ip}:${env.PORT}` : null;
}

// Las migraciones de este repo se aplican a mano: si 024 todavía no está, el
// upsert con las columnas nuevas falla y el heartbeat se cae COMPLETO (y con él
// la presencia de la máquina). Se detecta una vez y se sigue latiendo con la
// forma vieja, avisando qué falta.
let legacyPresence = false;

async function push() {
  if (!supabase) return;
  const base = {
    machine: env.MACHINE_NAME,
    status: currentStatus,
    current_task: currentTask,
    last_heartbeat: new Date().toISOString(),
    version: "0.1.0",
  };
  const row = legacyPresence
    ? base
    : {
        ...base,
        base_url: selfBaseUrl(),
        lan_ip: detectLanIp(),
        os: describeOs(),
        capabilities: capabilities(),
      };
  const { error } = await supabase.from("agent_presence").upsert(row);
  if (!error) return;
  // 42703 / PGRST204 = la columna no existe en el esquema.
  if (!legacyPresence && /column|schema cache/i.test(error.message)) {
    legacyPresence = true;
    console.error(
      "[hermes] agent_presence sin las columnas de multi-máquina: aplica supabase/migrations/024_machines.sql (el selector de máquinas no descubrirá nada hasta entonces)",
    );
    return void push();
  }
  console.error("[hermes] presence upsert", error.message);
}

/**
 * Empuja la presencia una vez. El latido periódico es el job
 * "presence-heartbeat" de index.ts (cada 30 s), no un setInterval de aquí.
 */
export async function pushPresence(): Promise<void> {
  await push();
}

// Online = heartbeat hace menos de 3× el intervalo (tolera un latido perdido).
const ONLINE_WINDOW_MS = 90_000;
// Una máquina que no late en una semana ya no es parte de la red: se cae de la
// lista sola (así una prueba vieja no queda de fantasma en el selector).
const STALE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Presencia de TODAS las máquinas (tabla agent_presence) para el selector de
 * máquina y el riel. La fila local se sobreescribe con el estado en memoria —
 * es exacta aunque el upsert vaya rezagado — y se marca con self. Sin Supabase
 * devuelve solo la máquina local.
 */
export async function listPresence(): Promise<MachinePresence[]> {
  const selfRow: MachinePresence = {
    machine: env.MACHINE_NAME,
    status: currentStatus,
    currentTask,
    lastHeartbeat: null,
    version: null,
    online: true,
    self: true,
    baseUrl: selfBaseUrl(),
    lanIp: detectLanIp(),
    os: describeOs(),
    capabilities: capabilities(),
  };
  if (!supabase) return [selfRow];
  const { data, error } = await supabase.from("agent_presence").select("*");
  if (error || !data) {
    if (error) console.error("[hermes] presence list", error.message);
    return [selfRow];
  }
  const now = Date.now();
  const fresh = data.filter((r) => {
    if (r.machine === env.MACHINE_NAME) return true;
    const beat = r.last_heartbeat ? Date.parse(r.last_heartbeat) : NaN;
    return Number.isFinite(beat) && now - beat < STALE_WINDOW_MS;
  });
  const rows = fresh.map((r): MachinePresence => {
    const self = r.machine === env.MACHINE_NAME;
    if (self) return selfRow; // lo local siempre desde memoria, no desde la fila
    const beat = r.last_heartbeat ? Date.parse(r.last_heartbeat) : NaN;
    const online = Number.isFinite(beat) && now - beat < ONLINE_WINDOW_MS;
    return {
      machine: r.machine,
      status: online ? (r.status ?? "idle") : "offline",
      currentTask: r.current_task ?? null,
      lastHeartbeat: r.last_heartbeat ?? null,
      version: r.version ?? null,
      online,
      self: false,
      baseUrl: r.base_url ?? null,
      lanIp: r.lan_ip ?? null,
      os: r.os ?? null,
      capabilities: (r.capabilities as MachineCapabilities | null) ?? null,
    };
  });
  if (!rows.some((r) => r.self)) rows.unshift(selfRow);
  // La máquina local primero, luego por nombre.
  return rows.sort((a, b) => Number(b.self) - Number(a.self) || a.machine.localeCompare(b.machine));
}
