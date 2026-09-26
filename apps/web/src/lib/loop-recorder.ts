/**
 * GRABADORA SOBRE EL LOOP: micrófono crudo (sin cancelación de eco, supresión
 * de ruido ni control de ganancia — suavizan los ataques y cambian la vocal) a
 * un AudioWorklet (`/worklets/take-recorder.js`) en el MISMO AudioContext que
 * toca la pista. El worklet reporta el `currentFrame` de cada lote, así se sabe
 * en qué tiempo del reloj de audio cayó la primera muestra grabada: con eso y
 * la latencia, la toma queda alineada a la rejilla.
 *
 * Los lotes se colocan por su `frame`, no por orden de llegada: si el worklet
 * se saltó un cuanto (el micrófono tardó en arrancar), el hueco queda en
 * silencio y lo que sigue NO se corre.
 */
import type { MutableRefObject } from "react";

export interface LoopRecording {
  /** Mono float32. */
  pcm: Float32Array;
  sr: number;
  /** Tiempo del AudioContext de la primera muestra grabada. */
  firstFrameSec: number;
  /** Pico absoluto de toda la grabación (para avisar si quedó muda). */
  peak: number;
}

export interface LoopRecorder {
  stop(): Promise<LoopRecording>;
  cancel(): void;
  /** El track del micrófono (para leer su latencia declarada). */
  track: MediaStreamTrack;
}

const WORKLET_URL = "/worklets/take-recorder.js";
/** El módulo se carga UNA vez por contexto. */
const loaded = new WeakMap<AudioContext, Promise<void>>();

function loadWorklet(ctx: AudioContext): Promise<void> {
  let p = loaded.get(ctx);
  if (!p) {
    p = ctx.audioWorklet.addModule(WORKLET_URL).catch((e: unknown) => {
      loaded.delete(ctx);
      throw e;
    });
    loaded.set(ctx, p);
  }
  return p;
}

/** Explica en español por qué no hay micrófono (el error del navegador no lo dice). */
function micError(e: unknown): Error {
  const name = (e as { name?: string })?.name ?? "";
  if (name === "NotAllowedError" || name === "SecurityError")
    return new Error(
      "No hay permiso de micrófono. Dale permiso a esta página desde el candado de la barra de direcciones y vuelve a intentar.",
    );
  if (name === "NotFoundError" || name === "DevicesNotFoundError")
    return new Error("No se encontró ningún micrófono conectado.");
  if (name === "NotReadableError" || name === "TrackStartError")
    return new Error("El micrófono está ocupado por otra aplicación (o el sistema no lo deja abrir).");
  if (name === "OverconstrainedError")
    return new Error("Ese micrófono ya no está conectado. Elige otro en la lista.");
  return new Error(`No se pudo abrir el micrófono: ${(e as Error)?.message ?? String(e)}`);
}

/**
 * Empieza a grabar. `meterRef` recibe el nivel (0..1) por cuadro para el medidor
 * (por ref: un estado por cuadro re-renderizaría la pantalla que estás mirando).
 * Lanza con un mensaje en español si no hay permiso de micrófono o el origen no
 * es seguro (getUserMedia exige localhost o https).
 */
export async function startLoopRecorder(
  ctx: AudioContext,
  opts: { deviceId?: string; meterRef?: MutableRefObject<number> } = {},
): Promise<LoopRecorder> {
  if (typeof window === "undefined") throw new Error("La grabación solo funciona en el navegador.");
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
    throw new Error(
      "El micrófono solo funciona abriendo Hermes en esta Mac (localhost) o por https (Tailscale). Desde otro equipo por http el navegador lo bloquea.",
    );
  if (!ctx.audioWorklet) throw new Error("Este navegador no soporta AudioWorklet: usa Chrome o Safari recientes.");

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        ...(opts.deviceId ? { deviceId: { exact: opts.deviceId } } : {}),
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
    });
  } catch (e) {
    throw micError(e);
  }
  const track = stream.getAudioTracks()[0];
  const release = () => stream.getTracks().forEach((t) => t.stop());

  try {
    if (ctx.state === "suspended") await ctx.resume();
    await loadWorklet(ctx);
  } catch (e) {
    release();
    throw new Error(`No se pudo preparar la grabadora: ${(e as Error).message}`);
  }

  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, "take-recorder", {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    channelCount: 1,
    channelCountMode: "explicit",
    channelInterpretation: "speakers",
  });
  // El worklet tiene que estar en el grafo hacia la salida para que lo "tiren";
  // la ganancia 0 garantiza que el micrófono jamás suene por los parlantes.
  const sink = ctx.createGain();
  sink.gain.value = 0;
  source.connect(node);
  node.connect(sink).connect(ctx.destination);

  const batches: { frame: number; pcm: Float32Array }[] = [];
  let peak = 0;
  let meterDecay = 0;
  let done: (() => void) | null = null;
  let closed = false;

  node.port.onmessage = (e: MessageEvent) => {
    const m = e.data as { type: "batch"; frame: number; pcm: Float32Array; peak: number } | { type: "done" };
    if (m.type === "batch") {
      if (closed) return;
      batches.push({ frame: m.frame, pcm: m.pcm });
      if (m.peak > peak) peak = m.peak;
      // Medidor con caída suave (sube al instante, baja en ~200 ms).
      meterDecay = Math.max(m.peak, meterDecay * 0.8);
      if (opts.meterRef) opts.meterRef.current = Math.min(1, meterDecay);
    } else if (m.type === "done") done?.();
  };

  const teardown = () => {
    closed = true;
    try {
      source.disconnect();
      node.disconnect();
      sink.disconnect();
    } catch {
      /* ya desconectado */
    }
    node.port.onmessage = null;
    release();
    if (opts.meterRef) opts.meterRef.current = 0;
  };

  return {
    track,
    cancel: () => {
      if (closed) return;
      node.port.postMessage("stop");
      teardown();
    },
    stop: async () => {
      if (closed) throw new Error("La grabación ya terminó.");
      // Espera el último lote (el worklet vacía lo pendiente y responde "done").
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, 600);
        done = () => {
          clearTimeout(t);
          resolve();
        };
        node.port.postMessage("stop");
      });
      teardown();
      const sr = ctx.sampleRate;
      if (!batches.length) return { pcm: new Float32Array(0), sr, firstFrameSec: ctx.currentTime, peak: 0 };
      batches.sort((a, b) => a.frame - b.frame);
      const first = batches[0].frame;
      const last = batches[batches.length - 1];
      const pcm = new Float32Array(last.frame - first + last.pcm.length);
      for (const b of batches) pcm.set(b.pcm, b.frame - first);
      return { pcm, sr, firstFrameSec: first / sr, peak };
    },
  };
}
