/**
 * Motor de vectores de la memoria v2: local → OpenAI → nada.
 *
 * - **Local**: `llama-server --embedding` con bge-m3 (1.024 dims, multilingüe:
 *   la pregunta en español encuentra el texto en inglés). Mismo patrón que el
 *   modo avión (local-llm/server.ts): binario por ruta absoluta porque launchd
 *   no tiene /opt/homebrew/bin, proceso `detached` con su log, pid en disco para
 *   adoptarlo tras un reinicio del agente. Se arranca al necesitarlo y se apaga
 *   a los 10 min sin uso: ~760 MB de RAM que no tienen por qué quedarse.
 * - **OpenAI**: solo si hay llave y no está en enfriamiento (cooldown.ts).
 * - **Nada**: la búsqueda sigue, léxica (BM25), y el estado lo dice.
 *
 * Cada motor tiene su identidad (`local:<modelo>` / `openai:<modelo>`): el
 * índice guarda con cuál se hizo y nunca compara vectores de modelos distintos.
 *
 * Avisos: cuando un motor pasa de responder a fallar sale UNA línea `[memoria]`
 * con el motivo (y otra cuando vuelve), no una por cada intento.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { normalizeVector } from "@hermes/shared";
import { HERMES_HOME } from "../home.js";
import { isQuotaError, openaiCooling, startCooldown } from "./cooldown.js";

const expandHome = (p: string) => (p.startsWith("~") ? join(homedir(), p.slice(1)) : p);

export interface EmbedEngine {
  /** Identidad del modelo: dos motores con la misma id dan vectores comparables. */
  readonly id: string;
  readonly kind: "local" | "openai";
  readonly dims: number;
  /** "" si se puede intentar ahora; si no, por qué no. */
  unavailable(): string;
  /** Vectores normalizados, paralelos a `texts`. Lanza si falla. */
  embed(texts: string[], signal?: AbortSignal): Promise<Float32Array[]>;
  /** Para el estado: qué está haciendo (apagado, arrancando, listo…). */
  describe?(): Record<string, unknown>;
  /** Libera recursos (apaga el servidor local si es nuestro). */
  stop?(): Promise<void>;
}

// ── Motor local (llama-server) ──────────────────────────────────────────

export interface LocalEngineConfig {
  bin: string;
  model: string;
  port: number;
  /** Carpeta para el pid/estado del servidor. */
  stateDir: string;
  logPath: string;
  idleMs: number;
  /** Cuánto se espera a que cargue el modelo la primera vez. */
  startTimeoutMs: number;
}

export function localEngineConfig(): LocalEngineConfig {
  return {
    bin: process.env.LLAMA_SERVER_BIN || "/opt/homebrew/bin/llama-server",
    model: expandHome(process.env.HERMES_EMBED_MODEL || join(HERMES_HOME, "models", "bge-m3-Q8_0.gguf")),
    port: Number(process.env.HERMES_EMBED_PORT || 8656),
    stateDir: join(HERMES_HOME, "memoria"),
    logPath: join(HERMES_HOME, "logs", "llama-embed.log"),
    idleMs: Number(process.env.HERMES_EMBED_IDLE_MS || 10 * 60_000),
    startTimeoutMs: 60_000,
  };
}

/** Recorte por texto: bge-m3 acepta 8k tokens, pero cada slot del servidor tiene ~2k. */
const LOCAL_MAX_CHARS = 2400;
/** Textos por petición: lo medido (64 en ~0,5 s). */
const LOCAL_BATCH = 64;
/** Tras un arranque fallido no se reintenta en este rato (sin esto cada búsqueda relanzaba). */
const LAUNCH_BACKOFF_MS = 60_000;

export class LocalEmbedEngine implements EmbedEngine {
  readonly kind = "local" as const;
  readonly dims = 1024;
  readonly id: string;
  private phase: "off" | "starting" | "ready" | "error" = "off";
  private lastError = "";
  private failedAt = 0;
  private starting: Promise<void> | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private adopted = false;

  constructor(private cfg: LocalEngineConfig = localEngineConfig()) {
    this.id = `local:${basename(cfg.model).replace(/\.gguf$/i, "")}`;
  }

  private get base() {
    return `http://127.0.0.1:${this.cfg.port}`;
  }
  private get statePath() {
    return join(this.cfg.stateDir, `embed-server-${this.cfg.port}.json`);
  }

  missing(): string {
    if (!existsSync(this.cfg.bin)) return `No encuentro llama-server en ${this.cfg.bin} (brew install llama.cpp o LLAMA_SERVER_BIN).`;
    if (!existsSync(this.cfg.model)) return `No encuentro el modelo de vectores en ${this.cfg.model} (HERMES_EMBED_MODEL).`;
    return "";
  }

  unavailable(): string {
    const missing = this.missing();
    if (missing) return missing;
    if (this.phase === "error" && Date.now() - this.failedAt < LAUNCH_BACKOFF_MS) return this.lastError;
    return "";
  }

  describe() {
    return { phase: this.phase, port: this.cfg.port, model: this.cfg.model, error: this.lastError || undefined, adopted: this.adopted };
  }

  private readPid(): number | undefined {
    try {
      return (JSON.parse(readFileSync(this.statePath, "utf8")) as { pid?: number }).pid;
    } catch {
      return undefined;
    }
  }

  private writePid(pid: number | undefined) {
    mkdirSync(this.cfg.stateDir, { recursive: true });
    const tmp = `${this.statePath}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ pid, port: this.cfg.port, model: this.cfg.model, at: new Date().toISOString() }));
    renameSync(tmp, this.statePath);
  }

  /** El pid guardado sigue siendo NUESTRO llama-server en ESTE puerto (no un pid reciclado). */
  private ownsPid(pid: number | undefined): pid is number {
    if (!pid) return false;
    try {
      const cmd = execFileSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" });
      return cmd.includes("llama-server") && cmd.includes("--embedding") && cmd.includes(`--port ${this.cfg.port}`);
    } catch {
      return false;
    }
  }

  private async healthy(): Promise<boolean> {
    try {
      const res = await fetch(`${this.base}/health`, { signal: AbortSignal.timeout(1500) });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Un servidor vivo en el puerto se adopta solo si sirve vectores con ESTE modelo. */
  private async servesOurModel(): Promise<boolean> {
    try {
      const res = await fetch(`${this.base}/props`, { signal: AbortSignal.timeout(1500) });
      const props = (await res.json()) as { model_path?: string };
      return !props.model_path || props.model_path === this.cfg.model;
    } catch {
      return true;
    }
  }

  private fail(msg: string) {
    this.phase = "error";
    this.lastError = msg;
    this.failedAt = Date.now();
  }

  private async launch(): Promise<void> {
    const missing = this.missing();
    if (missing) return this.fail(missing);
    if (await this.healthy()) {
      if (await this.servesOurModel()) {
        this.phase = "ready";
        this.adopted = true;
        return;
      }
      return this.fail(`El puerto ${this.cfg.port} lo ocupa otro modelo; cambia HERMES_EMBED_PORT.`);
    }
    this.phase = "starting";
    this.lastError = "";
    this.adopted = false;
    mkdirSync(join(this.cfg.logPath, ".."), { recursive: true });
    const log = openSync(this.cfg.logPath, "a");
    const child = spawn(
      this.cfg.bin,
      // Los argumentos medidos: 8k de contexto y lote = micro-lote de 8k para
      // que 64 fragmentos entren en una pasada.
      ["-m", this.cfg.model, "--embedding", "--host", "127.0.0.1", "--port", String(this.cfg.port), "-c", "8192", "-b", "8192", "-ub", "8192"],
      { detached: true, stdio: ["ignore", log, log] },
    );
    child.unref();
    this.writePid(child.pid);
    let exited = false;
    child.once("exit", (code) => {
      exited = true;
      if (this.phase !== "off") this.fail(`llama-server (vectores) terminó con código ${code ?? "?"}. Mira ${this.cfg.logPath}.`);
    });
    const until = Date.now() + this.cfg.startTimeoutMs;
    while (Date.now() < until && !exited) {
      if (await this.healthy()) {
        this.phase = "ready";
        return;
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    if (!exited) this.fail(`El motor de vectores no respondió en ${Math.round(this.cfg.startTimeoutMs / 1000)} s. Mira ${this.cfg.logPath}.`);
  }

  /** Arranca (o adopta) el servidor si hace falta. true = listo. */
  async ensure(): Promise<boolean> {
    if (this.phase === "ready" && (await this.healthy())) return true;
    if (this.phase === "ready") this.phase = "off"; // se cayó por fuera: se relanza
    if (!this.starting) {
      this.starting = this.launch().finally(() => {
        this.starting = null;
      });
    }
    await this.starting;
    // launch() cambió la fase mientras se esperaba (TS no lo ve a través del await).
    return (this.phase as string) === "ready";
  }

  private touch() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => void this.stop(), this.cfg.idleMs);
    this.idleTimer.unref();
  }

  async embed(texts: string[], signal?: AbortSignal): Promise<Float32Array[]> {
    if (!texts.length) return [];
    if (!(await this.ensure())) throw new Error(this.lastError || "motor local no disponible");
    this.touch();
    const out: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += LOCAL_BATCH) {
      const input = texts.slice(i, i + LOCAL_BATCH).map((t) => (t.trim() || " ").slice(0, LOCAL_MAX_CHARS));
      const res = await fetch(`${this.base}/v1/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input, model: "bge-m3" }),
        signal: signal ?? AbortSignal.timeout(120_000),
      });
      if (!res.ok) throw new Error(`motor local HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const json = (await res.json()) as { data: { index: number; embedding: number[] }[] };
      const byIndex = new Map(json.data.map((d) => [d.index, d.embedding]));
      input.forEach((_, j) => {
        const v = byIndex.get(j);
        if (!v || v.length !== this.dims) throw new Error(`motor local devolvió un vector de ${v?.length ?? 0} dimensiones`);
        out.push(normalizeVector(Float32Array.from(v)));
      });
    }
    this.touch();
    return out;
  }

  /** Apaga el servidor si es nuestro (por su pid y su puerto; nunca por nombre). */
  async stop(): Promise<void> {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    const pid = this.readPid();
    this.phase = "off";
    if (!this.ownsPid(pid)) return;
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      return;
    }
    for (let i = 0; i < 20 && this.ownsPid(pid); i++) await new Promise((r) => setTimeout(r, 250));
    this.writePid(undefined);
  }
}

// ── OpenAI ──────────────────────────────────────────────────────────────

export class OpenAIEmbedEngine implements EmbedEngine {
  readonly kind = "openai" as const;
  readonly dims = 1536;
  readonly id = "openai:text-embedding-3-small";

  constructor(private key = process.env.OPENAI_API_KEY || "") {}

  unavailable(): string {
    if (!this.key) return "Sin OPENAI_API_KEY.";
    const c = openaiCooling();
    if (c) return `Sin crédito (${c.reason}); en enfriamiento hasta ${new Date(c.until).toISOString()}.`;
    return "";
  }

  describe() {
    const c = openaiCooling();
    return { coolingUntil: c ? new Date(c.until).toISOString() : null };
  }

  async embed(texts: string[], signal?: AbortSignal): Promise<Float32Array[]> {
    const why = this.unavailable();
    if (why) throw new Error(why);
    const out: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += 64) {
      const input = texts.slice(i, i + 64).map((t) => (t || " ").slice(0, 8000));
      const res = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.key}` },
        body: JSON.stringify({ model: "text-embedding-3-small", input }),
        signal: signal ?? AbortSignal.timeout(60_000),
      });
      if (!res.ok) {
        const body = await res.text();
        if (isQuotaError(res.status, body)) startCooldown(`HTTP ${res.status} insufficient_quota`);
        throw new Error(`OpenAI HTTP ${res.status}: ${body.slice(0, 160)}`);
      }
      const json = (await res.json()) as { data: { index: number; embedding: number[] }[] };
      const byIndex = new Map(json.data.map((d) => [d.index, d.embedding]));
      input.forEach((_, j) => out.push(normalizeVector(Float32Array.from(byIndex.get(j) ?? []))));
    }
    return out;
  }
}

// ── Cadena ──────────────────────────────────────────────────────────────

export interface EngineNotice {
  engine: string;
  at: string;
  message: string;
}

export interface EngineStatus {
  id: string;
  kind: "local" | "openai";
  dims: number;
  /** "ok" = respondió la última vez · "idle" = nadie lo ha pedido · "down" = no se puede usar. */
  state: "ok" | "idle" | "down";
  reason: string | null;
  since: string | null;
  detail?: Record<string, unknown>;
}

export class EmbedChain {
  private down = new Map<string, { reason: string; since: number }>();
  private used = new Set<string>();
  readonly notices: EngineNotice[] = [];

  constructor(
    readonly engines: EmbedEngine[],
    private log: (msg: string) => void = (m) => console.warn(m),
  ) {}

  /** El primero de la cadena que se puede intentar ahora (local antes que OpenAI). */
  preferred(): EmbedEngine | null {
    return this.engines.find((e) => !e.unavailable()) ?? null;
  }

  byId(id: string | null | undefined): EmbedEngine | null {
    return this.engines.find((e) => e.id === id) ?? null;
  }

  private markDown(e: EmbedEngine, reason: string) {
    if (this.down.has(e.id)) {
      this.down.get(e.id)!.reason = reason;
      return;
    }
    this.down.set(e.id, { reason, since: Date.now() });
    const message = `[memoria] el motor ${e.id} no está disponible: ${reason}`;
    this.notices.push({ engine: e.id, at: new Date().toISOString(), message: reason });
    if (this.notices.length > 20) this.notices.shift();
    this.log(message);
  }

  private markUp(e: EmbedEngine) {
    this.used.add(e.id);
    if (!this.down.delete(e.id)) return;
    this.log(`[memoria] el motor ${e.id} volvió a responder.`);
  }

  /**
   * Vectores con UN motor concreto (el del índice). null si no se pudo: quien
   * llama sigue sin vectores (léxico), nunca con los de otro modelo.
   */
  async embedWith(id: string, texts: string[], signal?: AbortSignal): Promise<Float32Array[] | null> {
    const e = this.byId(id);
    if (!e) return null;
    const why = e.unavailable();
    if (why) {
      this.markDown(e, why);
      return null;
    }
    try {
      const out = await e.embed(texts, signal);
      this.markUp(e);
      return out;
    } catch (err) {
      this.markDown(e, (err as Error).message || String(err));
      return null;
    }
  }

  status(): EngineStatus[] {
    return this.engines.map((e) => {
      const why = e.unavailable();
      const d = this.down.get(e.id);
      const state: EngineStatus["state"] = why || d ? "down" : this.used.has(e.id) ? "ok" : "idle";
      return {
        id: e.id,
        kind: e.kind,
        dims: e.dims,
        state,
        reason: why || d?.reason || null,
        since: d ? new Date(d.since).toISOString() : null,
        detail: e.describe?.(),
      };
    });
  }

  async stop(): Promise<void> {
    await Promise.all(this.engines.map((e) => e.stop?.()));
  }
}

let chain: EmbedChain | null = null;

/** La cadena del proceso (una sola: un solo servidor local por agente). */
export function embedChain(): EmbedChain {
  if (!chain) chain = new EmbedChain([new LocalEmbedEngine(), new OpenAIEmbedEngine()]);
  return chain;
}

/** Tests y scripts: inyectar una cadena propia. */
export function setEmbedChain(c: EmbedChain | null): void {
  chain = c;
}
