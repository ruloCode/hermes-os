/**
 * Puente con native/composicion/separate.py: separa la voz de una LISTA de
 * cortes con el modelo cargado una sola vez, y trae de vuelta afinación y
 * chroma del instrumento por pasaje.
 *
 * El python va por ruta absoluta (venv de audio-separator: torch con MPS +
 * librosa) y con un entorno SIN secretos: el separador no necesita
 * ninguna clave y un paquete de terceros no tiene por qué verlas (toolEnv:
 * ni siquiera la ANTHROPIC_API_KEY que childEnv sí deja pasar). El PATH se
 * arma a mano con la carpeta de ffmpeg (pydub lo busca ahí) porque launchd
 * corre con PATH mínimo.
 *
 * Ciclo de vida: el hijo va en su PROPIO grupo de procesos (detenerlo mata
 * también a lo que torch haya lanzado) y el stdin queda abierto como latido:
 * el job viaja en la primera línea y separate.py sale solo al recibir EOF, que
 * es lo que pasa si el agente muere. Antes un agente caído dejaba al separador
 * huérfano cargando 900 MB de modelo.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../env.js";
import { AbortedError, FFMPEG, toolEnv } from "./media.js";

const SCRIPT = resolve(fileURLToPath(import.meta.url), "../../../native/composicion/separate.py");

export interface SeparationItem {
  id: string;
  /** Corte CON relleno (entrada del modelo). */
  input: string;
  outDir: string;
  /** Tramo del pasaje real dentro del corte. */
  trimStart: number;
  trimDur: number;
}

export interface SeparationResult {
  id: string;
  voice?: string;
  instrument?: string;
  tuningCents?: number | null;
  voiceTuningCents?: number | null;
  chroma?: number[] | null;
  sec?: number;
  error?: string;
}

export function separatorAvailable(): { ok: boolean; reason?: string } {
  if (!existsSync(env.COMPOSICION_PYTHON))
    return {
      ok: false,
      reason: `sin separador de voz (${env.COMPOSICION_PYTHON} no existe; uv tool install audio-separator): la melodía se mide sobre la mezcla`,
    };
  if (!existsSync(SCRIPT)) return { ok: false, reason: `falta ${SCRIPT}` };
  return { ok: true };
}

/**
 * Corre la separación. `onEvent` recibe cada evento (para progreso real por
 * pasaje). Timeout proporcional a la duración: ~0,43× tiempo real medido en
 * MPS, se da ×4 de aire + carga del modelo (o descarga, la primera vez).
 */
export function separatePassages(
  items: SeparationItem[],
  opts: {
    signal?: AbortSignal;
    onEvent?: (e: { event: string; id?: string; sec?: number; error?: string }) => void;
    /** Cada pasaje terminado (o fallido), en cuanto llega: para persistirlo ya. */
    onResult?: (r: SeparationResult) => void;
  } = {},
): Promise<SeparationResult[]> {
  return new Promise((resolvePromise, reject) => {
    if (opts.signal?.aborted) return reject(new AbortedError());
    if (!items.length) return resolvePromise([]);
    const totalSec = items.reduce((a, it) => a + it.trimDur + 2, 0);
    const timeoutMs = 10 * 60_000 + totalSec * 4000;
    const child = spawn(env.COMPOSICION_PYTHON, [SCRIPT], {
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
      env: toolEnv({
        PATH: [dirname(FFMPEG), "/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(":"),
        PYTHONUNBUFFERED: "1",
        TQDM_DISABLE: "1",
        // Operadores sin kernel MPS caen a CPU en vez de reventar.
        PYTORCH_ENABLE_MPS_FALLBACK: "1",
      }),
    });
    const results = new Map<string, SeparationResult>();
    let fatal: string | null = null;
    let stderr = "";
    let buf = "";
    child.stdout.on("data", (d: Buffer) => {
      buf += d.toString();
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith("{")) continue; // prints de terceros
        let ev: Record<string, unknown>;
        try {
          ev = JSON.parse(line);
        } catch {
          continue;
        }
        const id = typeof ev.id === "string" ? ev.id : undefined;
        if (ev.event === "done" && id) {
          const r = ev as unknown as SeparationResult;
          results.set(id, r);
          opts.onResult?.(r);
        } else if (ev.event === "error" && id) {
          const r = { id, error: String(ev.error) };
          results.set(id, r);
          opts.onResult?.(r);
        } else if (ev.event === "fatal") fatal = String(ev.error);
        opts.onEvent?.(ev as { event: string; id?: string });
      }
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr = (stderr + d.toString()).slice(-3000);
    });
    // Al grupo entero (pid negativo); si el grupo ya no existe, al hijo.
    const signalGroup = (sig: NodeJS.Signals) => {
      try {
        if (child.pid) process.kill(-child.pid, sig);
      } catch {
        child.kill(sig);
      }
    };
    const kill = () => {
      signalGroup("SIGTERM");
      setTimeout(() => signalGroup("SIGKILL"), 5000).unref();
    };
    opts.signal?.addEventListener("abort", kill, { once: true });
    const timer = setTimeout(() => {
      fatal = `el separador pasó de ${Math.round(timeoutMs / 60_000)} min`;
      kill();
    }, timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`no pude ejecutar el separador: ${String(e)}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", kill);
      if (opts.signal?.aborted) return reject(new AbortedError());
      if (fatal || (code !== 0 && results.size === 0)) {
        const tail = stderr.trim().split("\n").slice(-3).join(" · ");
        return reject(new Error(`separador: ${fatal ?? `salió ${code}`}${tail ? ` (${tail.slice(0, 300)})` : ""}`));
      }
      resolvePromise(
        items.map((it) => results.get(it.id) ?? { id: it.id, error: "el separador no respondió por este pasaje" }),
      );
    });
    // Primera línea = el job; el stdin NO se cierra (latido: EOF = el agente murió).
    child.stdin.on("error", () => {});
    child.stdin.write(
      JSON.stringify({ modelDir: env.AUDIO_SEPARATOR_MODELS, model: env.COMPOSICION_SEPARATOR_MODEL, items }) + "\n",
    );
  });
}
