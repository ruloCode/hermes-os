/**
 * Modo avión: un modelo local (llama.cpp) para chatear con Hermes sin internet.
 *
 * El agente NO depende de este proceso: lo arranca cuando el dueño prende el
 * modo y lo apaga cuando lo baja, porque en una Mac de 8 GB tener el modelo
 * cargado todo el día no es gratis. El estado (prendido + modelo + pid) vive en
 * `~/.hermes-os/local-llm/state.json`, así que si el agente se reinicia —o la
 * Mac, en pleno vuelo— el modo vuelve solo y adopta el servidor si sigue vivo.
 *
 * `llama-server` va por ruta absoluta (`LLAMA_SERVER_BIN`): launchd no tiene
 * /opt/homebrew/bin garantizado en PATH. Se lanza `detached` con su log propio:
 * reiniciar el agente no tumba el modelo (cargarlo de nuevo son ~15 s).
 */
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { HERMES_HOME } from "../home.js";

export const LOCAL_DIR = join(HERMES_HOME, "local-llm");
const STATE_PATH = join(LOCAL_DIR, "state.json");
const LOG_PATH = join(HERMES_HOME, "logs", "llama-server.log");
const MODELS_DIR = join(HERMES_HOME, "models");

const expandHome = (p: string) => (p.startsWith("~") ? join(homedir(), p.slice(1)) : p);

export const LOCAL_LLM = {
  bin: process.env.LLAMA_SERVER_BIN || "/opt/homebrew/bin/llama-server",
  port: Number(process.env.HERMES_LOCAL_LLM_PORT || 8655),
  /**
   * 16k de contexto con caché KV en q8_0: cabe holgado en 8 GB junto al
   * dashboard. El chat recorta el historial antes de llegar a este techo.
   */
  ctx: Number(process.env.HERMES_LOCAL_LLM_CTX || 16384),
  /** Razonamiento apagado por defecto: en un modelo chico duplica la espera por poco. */
  reasoning: process.env.HERMES_LOCAL_REASONING === "on" ? "on" : "off",
};

/**
 * Los dos modelos que se ofrecen en la UI. "Rápido" va por defecto: en el M2
 * de 8 GB el 2B responde ~2× más rápido y ocupa la mitad de RAM (menos swap),
 * a cambio de razonar menos fino. `HERMES_LOCAL_MODEL` agrega uno propio.
 */
export interface LocalModel {
  id: string;
  label: string;
  hint: string;
  path: string;
}

export const MODELS: LocalModel[] = [
  {
    id: "rapido",
    label: "Qwen3.5 2B",
    hint: "Rápido",
    path: join(MODELS_DIR, "Qwen3.5-2B-Q4_K_M.gguf"),
  },
  {
    id: "mejor",
    label: "Qwen3.5 4B",
    hint: "Mejor",
    path: join(MODELS_DIR, "Qwen3.5-4B-Q4_K_M.gguf"),
  },
  ...(process.env.HERMES_LOCAL_MODEL
    ? [
        {
          id: "propio",
          label:
            process.env.HERMES_LOCAL_MODEL_LABEL ||
            basename(process.env.HERMES_LOCAL_MODEL)
              .replace(/\.gguf$/i, "")
              .replace(/[-_.](Q\d.*|IQ\d.*|F16|BF16)$/i, "")
              .replace(/-/g, " "),
          hint: "Propio",
          path: expandHome(process.env.HERMES_LOCAL_MODEL),
        },
      ]
    : []),
];

export const localBaseUrl = () => `http://127.0.0.1:${LOCAL_LLM.port}`;

interface State {
  enabled: boolean;
  model?: string;
  pid?: number;
}

function readState(): State {
  try {
    return JSON.parse(readFileSync(STATE_PATH, "utf8")) as State;
  } catch {
    return { enabled: false };
  }
}

function writeState(patch: Partial<State>): void {
  mkdirSync(LOCAL_DIR, { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify({ ...readState(), ...patch }, null, 2));
}

export const isLocalMode = (): boolean => readState().enabled;

/** El modelo elegido; si su archivo no está, el primero que sí exista. */
export function currentModel(): LocalModel {
  const chosen = MODELS.find((m) => m.id === readState().model);
  if (chosen && existsSync(chosen.path)) return chosen;
  return MODELS.find((m) => existsSync(m.path)) ?? chosen ?? MODELS[0];
}

export const modelLabel = (): string => currentModel().label;

export type LocalPhase = "off" | "starting" | "ready" | "error";

let phase: LocalPhase = "off";
let lastError = "";
let starting: Promise<void> | null = null;

async function healthy(): Promise<boolean> {
  try {
    const res = await fetch(`${localBaseUrl()}/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok; // 503 = cargando el modelo todavía
  } catch {
    return false;
  }
}

/** Qué archivo tiene cargado el servidor vivo ("" si no se puede saber). */
async function servedModelPath(): Promise<string> {
  try {
    const res = await fetch(`${localBaseUrl()}/props`, { signal: AbortSignal.timeout(1500) });
    const props = (await res.json()) as { model_path?: string };
    return props.model_path ?? "";
  } catch {
    return "";
  }
}

/** El pid guardado sigue siendo NUESTRO llama-server (no un pid reciclado). */
function ownsPid(pid: number | undefined): pid is number {
  if (!pid) return false;
  try {
    const cmd = execFileSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" });
    return cmd.includes("llama-server") && cmd.includes(`--port ${LOCAL_LLM.port}`);
  } catch {
    return false;
  }
}

async function killServer(): Promise<void> {
  const { pid } = readState();
  if (!ownsPid(pid)) return;
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return;
  }
  // Que suelte el puerto y la RAM antes de cargar otro.
  for (let i = 0; i < 20 && ownsPid(pid); i++) await new Promise((r) => setTimeout(r, 250));
}

/** Qué falta en esta máquina para poder prender el modo ("" = nada). */
export function missingRequirement(): string {
  if (!existsSync(LOCAL_LLM.bin)) {
    return `No encuentro llama-server en ${LOCAL_LLM.bin} (brew install llama.cpp o LLAMA_SERVER_BIN).`;
  }
  const model = currentModel();
  if (!existsSync(model.path)) return `No encuentro el modelo en ${model.path}.`;
  return "";
}

async function waitReady(timeoutMs: number, signal?: AbortSignal): Promise<boolean> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until && !signal?.aborted) {
    if (await healthy()) return true;
    // El proceso ya murió: esperar más solo esconde el error.
    if (phase === "error") return false;
    await new Promise((r) => setTimeout(r, 750));
  }
  return false;
}

/**
 * Espera a que el modelo termine de cargar. Un mensaje mandado apenas se
 * prende el modo (o tras un reinicio) llegaba mientras llama-server respondía
 * 503 "Loading model": ahora el turno espera en vez de fallar. Con la Mac en
 * swap la carga puede pasar de 15 s a más de un minuto, de ahí los 2 min.
 */
export async function waitUntilReady(signal?: AbortSignal): Promise<boolean> {
  if (starting) await Promise.race([starting, new Promise((r) => setTimeout(r, 120_000))]);
  if (await healthy()) return true;
  if (!isLocalMode()) return false;
  if (!starting && phase !== "starting") enableLocalMode();
  return waitReady(120_000, signal);
}

async function launch(): Promise<void> {
  const missing = missingRequirement();
  if (missing) {
    phase = "error";
    lastError = missing;
    return;
  }
  const model = currentModel();
  // Un servidor vivo en el puerto (de un agente anterior) se adopta si tiene
  // cargado ESTE modelo; si es otro (se cambió la elección), se reemplaza.
  if (await healthy()) {
    const served = await servedModelPath();
    if (!served || served === model.path) {
      phase = "ready";
      return;
    }
    await killServer();
  }
  phase = "starting";
  lastError = "";
  mkdirSync(join(HERMES_HOME, "logs"), { recursive: true });
  const log = openSync(LOG_PATH, "a");
  const child = spawn(
    LOCAL_LLM.bin,
    [
      "-m", model.path,
      "--host", "127.0.0.1",
      "--port", String(LOCAL_LLM.port),
      "-c", String(LOCAL_LLM.ctx),
      "-np", "1",
      "-fa", "on",
      "-ctk", "q8_0",
      "-ctv", "q8_0",
      "--reasoning", LOCAL_LLM.reasoning,
      "--alias", "hermes-local",
      "--jinja",
      // Con 8 GB macOS comprimía el modelo (544 MB "cmprs" medidos) y cada
      // respuesta lo descomprimía: leer 40 tokens tomaba 3-8 s en vez de 0,3.
      // mlock lo deja fijo en RAM; lo que se va a swap es lo demás. (En esta
      // versión de llama.cpp es `--load-mode`; el viejo `--mlock` ya no existe
      // y tumbaba el arranque.)
      ...(process.env.HERMES_LOCAL_MLOCK === "off" ? [] : ["--load-mode", "mmap+mlock"]),
    ],
    { detached: true, stdio: ["ignore", log, log] },
  );
  child.unref();
  writeState({ enabled: true, pid: child.pid });
  let exited = false;
  child.once("exit", (code) => {
    exited = true;
    if (phase !== "off") {
      phase = "error";
      lastError = `llama-server terminó (código ${code ?? "?"}). Mira ${LOG_PATH}.`;
    }
  });
  // Cargar el modelo del disco a Metal: ~10-15 s en frío; 90 s cubre un disco lento.
  const ok = await waitReady(90_000);
  if (ok) phase = "ready";
  else if (!exited) {
    phase = "error";
    lastError = `El modelo no respondió en 90 s. Mira ${LOG_PATH}.`;
  }
}

/** Prende el modo y arranca el servidor (idempotente; no espera a que cargue). */
export function enableLocalMode(): void {
  writeState({ enabled: true });
  if (!starting) {
    // "starting" desde YA: si no, mientras se cambia de modelo el estado seguía
    // diciendo "listo" con el servidor viejo a punto de morir.
    phase = "starting";
    starting = launch().finally(() => {
      starting = null;
    });
  }
}

/** Elige el modelo; con el modo prendido, recarga el servidor con el nuevo. */
export async function setLocalModel(id: string): Promise<string> {
  const model = MODELS.find((m) => m.id === id);
  if (!model) return `No existe el modelo "${id}".`;
  if (!existsSync(model.path)) return `No encuentro ${model.path}.`;
  writeState({ model: id });
  if (isLocalMode()) {
    if (starting) await starting;
    enableLocalMode();
  }
  return "";
}

/** Apaga el modo y mata el servidor si es nuestro. La elección de modelo se queda. */
export async function disableLocalMode(): Promise<void> {
  phase = "off";
  lastError = "";
  await killServer();
  writeState({ enabled: false, pid: undefined });
}

/** Al arrancar el agente: si el modo quedó prendido, vuelve a levantarlo. */
export function restoreLocalMode(): void {
  if (isLocalMode()) enableLocalMode();
}

const sizeGb = (path: string): number | null => {
  try {
    return Math.round((statSync(path).size / 1e9) * 10) / 10;
  } catch {
    return null;
  }
};

export interface LocalLlmStatus {
  enabled: boolean;
  phase: LocalPhase;
  error?: string;
  model: { id: string; label: string; path: string; sizeGb: number | null };
  models: { id: string; label: string; hint: string; sizeGb: number | null; available: boolean }[];
  port: number;
  ctx: number;
}

export async function localStatus(): Promise<LocalLlmStatus> {
  const enabled = isLocalMode();
  // El servidor pudo caerse o cargarse por fuera: la salud real manda.
  if (enabled && phase !== "starting" && !starting) {
    if (await healthy()) phase = "ready";
    else if (phase === "ready") {
      phase = "error";
      lastError = `llama-server dejó de responder. Mira ${LOG_PATH}.`;
    }
  }
  if (!enabled) phase = "off";
  const model = currentModel();
  const missing = missingRequirement();
  return {
    enabled,
    phase: missing && enabled ? "error" : phase,
    error: (enabled && (lastError || missing)) || undefined,
    model: { id: model.id, label: model.label, path: model.path, sizeGb: sizeGb(model.path) },
    models: MODELS.map((m) => ({
      id: m.id,
      label: m.label,
      hint: m.hint,
      sizeGb: sizeGb(m.path),
      available: existsSync(m.path),
    })),
    port: LOCAL_LLM.port,
    ctx: LOCAL_LLM.ctx,
  };
}
