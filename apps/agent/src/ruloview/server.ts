/**
 * RuloView — el servidor RuView (fork ruloCode/RuView) visto desde Hermes.
 *
 * El servidor es la imagen Docker `ruvnet/wifi-densepose` que arranca el
 * script del propio repo (`start-rulostark-rust.sh`): contenedor en :3000,
 * sidecar UDP y un relay en la Mac que recibe a los ESP32 en UDP 5005. Hermes
 * NO reimplementa ese arranque — lo invoca, porque el script es la verdad del
 * fork. Lo que sí hace aquí:
 *   - el token del servidor se lee de `<repo>/docker/.env` (el navegador no
 *     tiene que pegarlo nunca);
 *   - Colima se levanta antes del script y, si quedó un candado de un apagado
 *     sucio ("in use by instance"), se libera con `colima stop -f` y se
 *     reintenta UNA vez (el script a secas muere ahí sin explicar nada);
 *   - el estado se MIDE en cada consulta (daemon, contenedor, relay, /health,
 *     fuente que reporta el servidor) — nada se supone.
 *
 * launchd corre con PATH mínimo: docker/colima van por ruta absoluta y el
 * script recibe un PATH con Homebrew.
 */
import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseDotenv, setDotenvKey, trimSensing, type RuCsiSource, type RuloviewStatus } from "@hermes/shared";
import { env } from "../env.js";

const DOCKER_BIN = process.env.DOCKER_BIN || "/opt/homebrew/bin/docker";
const COLIMA_BIN = process.env.COLIMA_BIN || "/opt/homebrew/bin/colima";
const CHILD_PATH = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
const SCRIPT = "start-rulostark-rust.sh";
const CONTAINER = "rulostark-rust";
const IMAGE = "ruvnet/wifi-densepose:latest";
const LOG_MAX = 40;

export function ruviewPath(): string | null {
  const raw = env.RUVIEW_PATH.trim();
  if (!raw) return null;
  return resolve(raw.replace(/^~(?=$|\/)/, homedir()));
}

function dockerEnvFile(): string | null {
  const p = ruviewPath();
  return p ? join(p, "docker/.env") : null;
}

function readDockerEnv(): Record<string, string> {
  const f = dockerEnvFile();
  if (!f || !existsSync(f)) return {};
  try {
    return parseDotenv(readFileSync(f, "utf8"));
  } catch {
    return {};
  }
}

/** Token del servidor: la env manda; si no, el que generó el script en docker/.env. */
export function ruviewToken(): string {
  return env.RUVIEW_API_TOKEN || readDockerEnv().RUVIEW_API_TOKEN || "";
}

export function ruviewUrl(): string {
  return env.RUVIEW_URL.replace(/\/+$/, "");
}

function run(bin: string, args: string[], timeout = 8000): Promise<{ ok: boolean; out: string }> {
  return new Promise((done) => {
    execFile(
      bin,
      args,
      { timeout, env: { ...process.env, PATH: CHILD_PATH }, maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => done({ ok: !err, out: `${stdout}${stderr}`.trim() }),
    );
  });
}

async function fetchJson(path: string, timeout = 1500): Promise<unknown> {
  const res = await fetch(`${ruviewUrl()}${path}`, {
    headers: { Authorization: `Bearer ${ruviewToken()}` },
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function relayAlive(path: string): boolean {
  const pidFile = join(path, "logs/udp-relay.pid");
  if (!existsSync(pidFile)) return false;
  const pid = Number(readFileSync(pidFile, "utf8").trim());
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ── Arranque / parada (async: colima + contenedor tardan) ──────────────
const job: { busy: RuloviewStatus["busy"]; log: string[]; error: string | null } = {
  busy: null,
  log: [],
  error: null,
};

function logLine(line: string) {
  for (const l of line.split(/\r?\n/)) {
    const t = l.trim();
    if (!t) continue;
    job.log.push(t);
    if (job.log.length > LOG_MAX) job.log.shift();
  }
}

/** Corre el script del repo y espera a que termine (sus hijos quedan vivos). */
function runScript(path: string, args: string[]): Promise<number> {
  return new Promise((done) => {
    const child = spawn("bash", [SCRIPT, ...args], {
      cwd: path,
      env: { ...process.env, PATH: CHILD_PATH },
      // grupo de procesos propio: el relay (nohup) sobrevive a un reinicio del agente
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (b: Buffer) => logLine(b.toString()));
    child.stderr.on("data", (b: Buffer) => logLine(b.toString()));
    child.on("error", (err) => {
      logLine(err.message);
      done(1);
    });
    child.on("close", (code) => done(code ?? 1));
  });
}

async function ensureColima(): Promise<boolean> {
  if ((await run(DOCKER_BIN, ["info", "--format", "{{.ServerVersion}}"], 5000)).ok) return true;
  logLine("Iniciando Colima (motor Docker)…");
  let res = await run(COLIMA_BIN, ["start"], 180_000);
  if (!res.ok && /in use by instance/i.test(res.out)) {
    // candado de un apagado sucio: la VM no corre pero el disco sigue "en uso"
    logLine("Colima dejó un candado de un apagado sucio: liberándolo (colima stop -f)…");
    await run(COLIMA_BIN, ["stop", "-f"], 60_000);
    res = await run(COLIMA_BIN, ["start"], 180_000);
  }
  if (!res.ok) logLine(res.out.split("\n").slice(-3).join("\n"));
  return res.ok;
}

/** Fija CSI_SOURCE en docker/.env; si el archivo no existe lo crea con token (como el script). */
function writeSource(path: string, source: RuCsiSource) {
  const f = join(path, "docker/.env");
  const text = existsSync(f)
    ? readFileSync(f, "utf8")
    : `RUVIEW_API_TOKEN=${randomBytes(32).toString("hex")}\n`;
  writeFileSync(f, setDotenvKey(text, "CSI_SOURCE", source), { mode: 0o600 });
}

async function waitHealth(ms: number): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const res = await fetch(`${ruviewUrl()}/health`, { signal: AbortSignal.timeout(1500) });
      if (res.ok) return true;
    } catch {
      /* todavía arrancando */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

export function startServer(source?: RuCsiSource): { ok: boolean; error?: string } {
  const path = ruviewPath();
  if (!path || !existsSync(join(path, SCRIPT)))
    return { ok: false, error: "RUVIEW_PATH no apunta a un clon de RuView con start-rulostark-rust.sh" };
  if (job.busy) return { ok: false, error: `ya hay una operación en curso (${job.busy})` };
  job.busy = "starting";
  job.log = [];
  job.error = null;
  void (async () => {
    try {
      if (source) writeSource(path, source);
      if (!(await ensureColima())) throw new Error("Colima no arrancó (mira el log)");
      const code = await runScript(path, []);
      if (code !== 0) throw new Error(`el script terminó con código ${code}`);
      if (!(await waitHealth(30_000))) throw new Error("el contenedor arrancó pero /health no responde en 30 s");
      logLine("Servidor arriba.");
    } catch (err) {
      job.error = err instanceof Error ? err.message : String(err);
      logLine(`Error: ${job.error}`);
    } finally {
      job.busy = null;
    }
  })();
  return { ok: true };
}

export function stopServer(): { ok: boolean; error?: string } {
  const path = ruviewPath();
  if (!path || !existsSync(join(path, SCRIPT))) return { ok: false, error: "RUVIEW_PATH no configurado" };
  if (job.busy) return { ok: false, error: `ya hay una operación en curso (${job.busy})` };
  job.busy = "stopping";
  job.log = [];
  job.error = null;
  void runScript(path, ["stop"]).finally(() => {
    job.busy = null;
  });
  return { ok: true };
}

// ── Estado (medido) ─────────────────────────────────────────────────────
let cache: { at: number; value: RuloviewStatus } | null = null;

export async function ruloviewStatus(): Promise<RuloviewStatus> {
  if (cache && Date.now() - cache.at < 1500 && !job.busy) return { ...cache.value, busy: job.busy, log: job.log };
  const path = ruviewPath();
  const pathOk = Boolean(path && existsSync(join(path, SCRIPT)));
  const denv = readDockerEnv();
  const source = denv.CSI_SOURCE === "esp32" || denv.CSI_SOURCE === "simulated" ? denv.CSI_SOURCE : null;

  const [daemon, container, image, health, latest] = await Promise.all([
    run(DOCKER_BIN, ["info", "--format", "{{.ServerVersion}}"], 4000).then((r) => r.ok),
    run(DOCKER_BIN, ["inspect", "-f", "{{.State.Running}}", CONTAINER], 4000).then((r) => r.ok && r.out === "true"),
    run(DOCKER_BIN, ["image", "inspect", "--format", "{{.Id}}", IMAGE], 4000).then((r) => r.ok),
    fetch(`${ruviewUrl()}/health`, { signal: AbortSignal.timeout(1500) })
      .then((r) => r.ok)
      .catch(() => false),
    fetchJson("/api/v1/sensing/latest").catch(() => null),
  ]);
  const url = ruviewUrl();
  const value: RuloviewStatus = {
    enabled: env.RULOVIEW_ENABLED,
    path,
    pathOk,
    url,
    hasToken: Boolean(ruviewToken()),
    source,
    docker: { daemon, container, relay: pathOk && path ? relayAlive(path) : false, image },
    serverUp: health,
    liveSource: latest ? (trimSensing(latest)?.source ?? null) : null,
    busy: job.busy,
    log: job.log,
    error: job.error,
    pages: health
      ? {
          observatory: `${url}/ui/rulostark/observatory.html`,
          escenario: `${url}/ui/escenario.html`,
          sala3d: `${url}/ui/rulostark/sala3d.html`,
        }
      : null,
  };
  cache = { at: Date.now(), value };
  return value;
}
