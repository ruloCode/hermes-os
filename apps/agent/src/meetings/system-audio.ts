/**
 * Audio del SISTEMA para la junta en vivo: lo que suena en la Mac cuando la
 * llamada es una app de escritorio (Teams, Zoom, Slack…). El browser no puede
 * capturarlo con getDisplayMedia (solo pestañas), así que el helper nativo
 * (native/system-audio.swift, ScreenCaptureKit) lo escribe como PCM16 16 kHz
 * y este módulo lo reenvía en frames de 100 ms por WS `/audio/system/ws`. El
 * browser lo mezcla con el mic en el MISMO worklet que la pestaña de Meet:
 * una sola sesión STT, y el "soy yo" automático sigue funcionando porque la
 * energía de cada fuente se mide antes de mezclar.
 *
 * Una captura a la vez: abrir otra corta la anterior (un solo dueño del audio).
 * El helper vive solo mientras el WS está abierto — cerrar el socket cierra su
 * stdin y sale.
 */
import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const agentRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const HELPER_BIN = resolve(agentRoot, "native/system-audio");
const BUILD_SCRIPT = resolve(agentRoot, "scripts/build-system-audio.sh");
/** 100 ms de PCM16 mono 16 kHz — el mismo frame que manda el worklet del browser. */
export const SYSTEM_AUDIO_FRAME_BYTES = 3_200;

export type SystemAudioStatus =
  | { state: "capturing"; rate?: number }
  | { state: "error"; message: string; permission?: boolean }
  | { state: "stopped" };

export interface SystemAudioCapture {
  close(): void;
}

let current: { proc: ChildProcessWithoutNullStreams; onStatus: (s: SystemAudioStatus) => void } | null =
  null;
let building: Promise<boolean> | null = null;

function buildHelper(): Promise<boolean> {
  building ??= new Promise((done) => {
    execFile(BUILD_SCRIPT, { timeout: 180_000 }, (err) => {
      if (err) console.error("[system-audio] no se pudo compilar el helper:", err.message);
      building = null;
      done(!err && existsSync(HELPER_BIN));
    });
  });
  return building;
}

/** Arranca la captura; `onFrame` recibe frames exactos de 100 ms. */
export async function openSystemAudio(
  onFrame: (frame: Uint8Array<ArrayBuffer>) => void,
  onStatus: (s: SystemAudioStatus) => void,
): Promise<SystemAudioCapture> {
  if (process.platform !== "darwin") {
    onStatus({ state: "error", message: "El audio del sistema solo está disponible en macOS" });
    return { close: () => undefined };
  }
  if (!existsSync(HELPER_BIN) && !(await buildHelper())) {
    onStatus({
      state: "error",
      message: "No se pudo compilar el helper de audio (swiftc): corre apps/agent/scripts/build-system-audio.sh",
    });
    return { close: () => undefined };
  }
  // Un solo dueño: la captura anterior se corta y su cliente se entera.
  if (current) {
    current.onStatus({ state: "error", message: "otra ventana tomó el audio del sistema" });
    current.proc.kill();
    current = null;
  }

  const proc = spawn(HELPER_BIN, [], { stdio: ["pipe", "pipe", "pipe"] });
  const mine = { proc, onStatus };
  current = mine;
  let pending: Buffer = Buffer.alloc(0);
  let stderr = "";
  let reported = false;

  proc.stdout.on("data", (chunk: Buffer) => {
    pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    while (pending.length >= SYSTEM_AUDIO_FRAME_BYTES) {
      // Copia propia: el frame sale por el WS y no debe retener el chunk entero.
      onFrame(new Uint8Array(pending.subarray(0, SYSTEM_AUDIO_FRAME_BYTES)));
      pending = pending.subarray(SYSTEM_AUDIO_FRAME_BYTES);
    }
  });
  proc.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
    let nl: number;
    while ((nl = stderr.indexOf("\n")) >= 0) {
      const line = stderr.slice(0, nl).trim();
      stderr = stderr.slice(nl + 1);
      if (!line.startsWith("{")) continue; // ruido de frameworks del sistema
      try {
        const msg = JSON.parse(line) as SystemAudioStatus & { message?: string };
        if (msg.state === "error") reported = true;
        onStatus(msg);
      } catch {
        /* línea a medias */
      }
    }
  });
  proc.on("error", (err) => {
    reported = true;
    onStatus({ state: "error", message: `no arrancó el helper: ${err.message}` });
  });
  proc.on("exit", (code) => {
    if (current === mine) current = null;
    if (!reported && code && code !== 0)
      onStatus({ state: "error", message: `el helper de audio terminó (código ${code})` });
    onStatus({ state: "stopped" });
  });

  return {
    close() {
      if (current === mine) current = null;
      proc.stdin.end(); // el helper sale solo al ver stdin cerrado
      setTimeout(() => proc.kill(), 1_000).unref();
    },
  };
}
