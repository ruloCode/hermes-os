"use client";

import { useCallback, useEffect, useRef, type RefObject } from "react";

/**
 * Captura de audio para la junta EN VIVO → AudioWorklet → frames PCM16LE
 * 16 kHz mono de 100 ms (3200 B) vía `onFrame(ArrayBuffer)`.
 *
 * Dos modos:
 *  - "presencial" (default): solo mic, constraints para sala física.
 *  - "remoto": mic (con AEC/NS: hay far-end sonando por las bocinas) + audio
 *    de la PESTAÑA de la llamada (Meet en Chrome) vía getDisplayMedia. Ambas
 *    fuentes se MEZCLAN client-side hacia el mismo worklet (Web Audio suma
 *    entradas): una sola sesión STT y la diarización separa hablantes.
 *
 * El nivel (RMS) se escribe en `levelRef` mutable — el VU meter lo lee con
 * rAF y nadie re-renderiza por frame de audio.
 *
 * Constraints presenciales (mic de la Mac captando la sala):
 *  - echoCancellation: false → no hay far-end (la voz ElevenLabs está
 *    bloqueada durante la junta) y el AEC distorsiona voces lejanas.
 *  - noiseSuppression: false → la supresión se come a los hablantes lejos
 *    del mic, que son justo los que la diarización necesita oír.
 *  - autoGainControl: true → hablantes a distinta distancia del mic.
 */
const MIC_PRESENCIAL: MediaTrackConstraints = {
  channelCount: 1,
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: true,
};

// Remoto: los otros suenan por las bocinas → el AEC evita que el mic los
// duplique (el audio limpio de ellos ya entra por la pestaña compartida).
const MIC_REMOTO: MediaTrackConstraints = {
  channelCount: 1,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

const TARGET_RATE = 16_000;

// Worklet inline por blob URL: apps/web no tiene public/ y así el processor
// queda versionado junto al hook (sin caché stale entre deploys). Convierte
// Float32→Int16, batchea 100 ms y resamplea lineal SOLO si el AudioContext
// no aceptó correr a 16 kHz nativo (ratio ≠ 1).
const WORKLET_SOURCE = `
class Pcm16Processor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const target = (options && options.processorOptions && options.processorOptions.targetRate) || 16000;
    this.ratio = sampleRate / target; // 1 cuando el contexto ya corre a 16k
    this.frameSamples = Math.round(target * 0.1); // 100 ms → 1600 samples → 3200 B
    this.acc = []; // muestras de entrada pendientes de resamplear
    this.pos = 0; // cursor fraccional sobre acc
    this.out = new Int16Array(this.frameSamples);
    this.outLen = 0;
    this.sumSq = 0;
  }
  emit(s) {
    const c = Math.max(-1, Math.min(1, s));
    this.out[this.outLen++] = c < 0 ? c * 0x8000 : c * 0x7fff;
    this.sumSq += c * c;
    if (this.outLen === this.frameSamples) {
      const pcm = this.out;
      const rms = Math.sqrt(this.sumSq / this.frameSamples);
      // El buffer viaja como transferable: cero copias por frame.
      this.port.postMessage({ pcm: pcm.buffer, rms }, [pcm.buffer]);
      this.out = new Int16Array(this.frameSamples);
      this.outLen = 0;
      this.sumSq = 0;
    }
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    if (this.ratio === 1) {
      for (let i = 0; i < ch.length; i++) this.emit(ch[i]);
      return true;
    }
    for (let i = 0; i < ch.length; i++) this.acc.push(ch[i]);
    // Interpolación lineal: consume mientras exista el vecino i0+1.
    while (this.pos + 1 < this.acc.length) {
      const i0 = Math.floor(this.pos);
      const frac = this.pos - i0;
      this.emit(this.acc[i0] * (1 - frac) + this.acc[i0 + 1] * frac);
      this.pos += this.ratio;
    }
    const drop = Math.floor(this.pos);
    if (drop > 0) {
      this.acc.splice(0, drop);
      this.pos -= drop;
    }
    return true;
  }
}
registerProcessor("pcm16-processor", Pcm16Processor);
`;

async function createWorkletNode(ctx: AudioContext): Promise<AudioWorkletNode> {
  const url = URL.createObjectURL(
    new Blob([WORKLET_SOURCE], { type: "application/javascript" }),
  );
  try {
    await ctx.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }
  return new AudioWorkletNode(ctx, "pcm16-processor", {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    processorOptions: { targetRate: TARGET_RATE },
  });
}

export interface LiveAudioStartOptions {
  /** "presencial" (default) = solo mic · "remoto" = mic + pestaña compartida. */
  mode?: "presencial" | "remoto";
  /** El usuario cortó el share de la pestaña a media junta (solo remoto). */
  onSystemAudioEnded?: () => void;
}

export interface LiveMeetingAudio {
  /** Pide el mic (y en remoto, la pestaña) y empieza a emitir frames.
   *  Lanza si el permiso del MIC falla; la pestaña es best-effort:
   *  `systemAudio` dice si quedó capturando (false = solo mic). */
  start: (
    onFrame: (frame: ArrayBuffer) => void,
    opts?: LiveAudioStartOptions,
  ) => Promise<{ systemAudio: boolean }>;
  /** Reintenta capturar la pestaña con la junta ya corriendo (requiere
   *  gesto del usuario: botón). true = quedó mezclando. */
  enableSystemAudio: () => Promise<boolean>;
  /** Suelta mic + pestaña + contexto (idempotente). */
  stop: () => void;
  /** RMS del último frame (0..~1) — para el VU con rAF, sin estado React. */
  levelRef: RefObject<number>;
}

export function useLiveMeetingAudio(): LiveMeetingAudio {
  const levelRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  const displayRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const nodeRef = useRef<AudioWorkletNode | null>(null);
  const onSysEndedRef = useRef<(() => void) | null>(null);

  const stopDisplay = useCallback(() => {
    displayRef.current?.getTracks().forEach((t) => {
      t.onended = null;
      t.stop();
    });
    displayRef.current = null;
  }, []);

  const stop = useCallback(() => {
    const node = nodeRef.current;
    nodeRef.current = null;
    if (node) {
      node.port.onmessage = null;
      try {
        node.disconnect();
      } catch {
        /* ya desconectado */
      }
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    stopDisplay();
    onSysEndedRef.current = null;
    const ctx = ctxRef.current;
    ctxRef.current = null;
    if (ctx && ctx.state !== "closed") void ctx.close().catch(() => {});
    levelRef.current = 0;
  }, [stopDisplay]);

  /** Pide la pestaña y la conecta al worklet vivo. Best-effort: false si el
   *  usuario canceló el picker o no marcó "compartir audio de la pestaña". */
  const enableSystemAudio = useCallback(async (): Promise<boolean> => {
    const ctx = ctxRef.current;
    const node = nodeRef.current;
    if (!ctx || !node) return false;
    stopDisplay();
    let display: MediaStream;
    try {
      // Chrome exige video:true en getDisplayMedia; el video track queda vivo
      // pero sin conectar (detenerlo termina la captura en algunos Chrome).
      // selfBrowserSurface excluye ESTA pestaña del picker (evita el eco de
      // capturarse a sí misma); el usuario elige la pestaña de Meet + audio.
      display = await (
        navigator.mediaDevices as MediaDevices & {
          getDisplayMedia(opts: object): Promise<MediaStream>;
        }
      ).getDisplayMedia({
        video: true,
        audio: { echoCancellation: false, noiseSuppression: false },
        selfBrowserSurface: "exclude",
      });
    } catch {
      return false; // canceló el picker: la junta sigue solo con el mic
    }
    const audioTrack = display.getAudioTracks()[0];
    if (!audioTrack) {
      // Compartió sin marcar "compartir audio de la pestaña".
      display.getTracks().forEach((t) => t.stop());
      return false;
    }
    displayRef.current = display;
    audioTrack.onended = () => {
      // "Dejar de compartir" a media junta: degradar a mic-only, avisar.
      stopDisplay();
      onSysEndedRef.current?.();
    };
    ctx.createMediaStreamSource(new MediaStream([audioTrack])).connect(node);
    return true;
  }, [stopDisplay]);

  const start = useCallback(
    async (
      onFrame: (frame: ArrayBuffer) => void,
      opts?: LiveAudioStartOptions,
    ): Promise<{ systemAudio: boolean }> => {
      stop();
      const mode = opts?.mode ?? "presencial";
      onSysEndedRef.current = opts?.onSystemAudioEnded ?? null;
      // El mic va PRIMERO (si falla, no queda nada abierto que limpiar).
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: mode === "remoto" ? MIC_REMOTO : MIC_PRESENCIAL,
      });
      streamRef.current = stream;
      try {
        let ctx: AudioContext;
        try {
          ctx = new AudioContext({ sampleRate: TARGET_RATE });
        } catch {
          // El motor no acepta 16 kHz nativo → el worklet resamplea (ratio ≠ 1).
          ctx = new AudioContext();
        }
        ctxRef.current = ctx;
        if (ctx.state === "suspended") await ctx.resume().catch(() => {});
        const node = await createWorkletNode(ctx);
        nodeRef.current = node;
        node.port.onmessage = (ev: MessageEvent) => {
          const data = ev.data as { pcm: ArrayBuffer; rms: number };
          levelRef.current = data.rms;
          onFrame(data.pcm);
        };
        ctx.createMediaStreamSource(stream).connect(node);
        // Gain 0 hacia destination: garantiza que el grafo procese en todos
        // los motores sin playback audible (el worklet es nodo "terminal").
        const mute = ctx.createGain();
        mute.gain.value = 0;
        node.connect(mute).connect(ctx.destination);
        // La pestaña es aditiva y best-effort: sin ella la junta arranca igual.
        const systemAudio = mode === "remoto" ? await enableSystemAudio() : false;
        return { systemAudio };
      } catch (err) {
        stop();
        throw err;
      }
    },
    [stop, enableSystemAudio],
  );

  // Al desmontar el dueño (el provider vive en el shell: en la práctica nunca).
  useEffect(() => stop, [stop]);

  return { start, enableSystemAudio, stop, levelRef };
}
