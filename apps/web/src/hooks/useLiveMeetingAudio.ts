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

// Fuente: PCM16 16 kHz que llega por el port (el audio del sistema que manda
// el agente) → muestras al rate del contexto. Colchón de ~150 ms antes de
// sonar (la red llega a ráfagas) y tope de ~600 ms (si se atrasa, se tira lo
// viejo: en una llamada vale más estar al día que completo).
class Pcm16SourceProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.step = 16000 / sampleRate; // muestras de entrada por muestra de salida
    this.queue = [];
    this.head = 0; // índice dentro de queue[0]
    this.pos = 0; // fase fraccional
    this.queued = 0;
    this.started = false;
    this.prev = 0;
    this.port.onmessage = (ev) => {
      const pcm = new Int16Array(ev.data);
      const f = new Float32Array(pcm.length);
      for (let i = 0; i < pcm.length; i++) f[i] = pcm[i] / 32768;
      this.queue.push(f);
      this.queued += f.length;
      while (this.queued > 9600 && this.queue.length > 1) {
        this.queued -= this.queue[0].length - this.head;
        this.queue.shift();
        this.head = 0;
      }
    };
  }
  next() {
    while (this.queue.length && this.head >= this.queue[0].length) {
      this.queue.shift();
      this.head = 0;
    }
    if (!this.queue.length) return null;
    this.queued -= 1;
    return this.queue[0][this.head++];
  }
  process(_inputs, outputs) {
    const out = outputs[0] && outputs[0][0];
    if (!out) return true;
    if (!this.started) {
      if (this.queued < 2400) return true; // colchón inicial (salida en silencio)
      this.started = true;
    }
    for (let i = 0; i < out.length; i++) {
      this.pos += this.step;
      while (this.pos >= 1) {
        const v = this.next();
        if (v === null) {
          this.started = false; // se vació: re-llenar el colchón (en silencio, sin DC)
          this.pos = 0;
          this.prev = 0;
          break;
        }
        this.prev = v;
        this.pos -= 1;
      }
      out[i] = this.prev;
    }
    return true;
  }
}
registerProcessor("pcm16-source", Pcm16SourceProcessor);
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

/** De dónde sale el audio de los demás en remoto: una pestaña (Meet, Teams web) o la app de escritorio. */
export type CallAudioSource = "tab" | "app";

export interface LiveAudioStartOptions {
  /** "presencial" (default) = solo mic · "remoto" = mic + audio de la llamada. */
  mode?: "presencial" | "remoto";
  /** Remoto: "tab" (default) = pestaña compartida · "app" = audio del sistema vía el agente. */
  source?: CallAudioSource;
  /** WS del agente con el audio del sistema (requerido con source "app"). */
  appAudioUrl?: string;
  /** El audio de la llamada se cortó a media junta (dejó de compartir / el helper murió). */
  onSystemAudioEnded?: () => void;
}

/**
 * Energía (RMS) de cada fuente ANTES de la mezcla, medida al emitir cada
 * frame. Con ella la clase de inglés sabe qué voz es la tuya (inferSelfSpeaker):
 * el mic con cancelación de eco no oye a la profe; la pestaña no te oye a ti.
 */
export interface SourceLevels {
  mic: number;
  tab: number;
}

export interface LiveMeetingAudio {
  /** Pide el mic (y en remoto, la pestaña) y empieza a emitir frames.
   *  Lanza si el permiso del MIC falla; la pestaña es best-effort:
   *  `systemAudio` dice si quedó capturando (false = solo mic). */
  start: (
    onFrame: (frame: ArrayBuffer, levels: SourceLevels) => void,
    opts?: LiveAudioStartOptions,
  ) => Promise<{ systemAudio: boolean }>;
  /** Reintenta capturar el audio de la llamada con la junta ya corriendo
   *  (la pestaña requiere gesto del usuario: botón). true = quedó mezclando. */
  enableSystemAudio: () => Promise<boolean>;
  /** Por qué falló la última captura del audio de la llamada (null = no falló). */
  systemAudioErrorRef: RefObject<string | null>;
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
  const micAnalyserRef = useRef<AnalyserNode | null>(null);
  const tabAnalyserRef = useRef<AnalyserNode | null>(null);
  const bufRef = useRef<Float32Array<ArrayBuffer> | null>(null);
  const sourceRef = useRef<CallAudioSource>("tab");
  const appUrlRef = useRef<string | null>(null);
  const appWsRef = useRef<WebSocket | null>(null);
  const appNodeRef = useRef<AudioWorkletNode | null>(null);
  const systemAudioErrorRef = useRef<string | null>(null);

  /** RMS de lo último que vio un analizador (~128 ms a 16 kHz). */
  const rmsOf = useCallback((a: AnalyserNode | null): number => {
    if (!a) return 0;
    if (!bufRef.current || bufRef.current.length !== a.fftSize)
      bufRef.current = new Float32Array(a.fftSize);
    const buf = bufRef.current;
    a.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    return Math.sqrt(sum / buf.length);
  }, []);

  const stopDisplay = useCallback(() => {
    displayRef.current?.getTracks().forEach((t) => {
      t.onended = null;
      t.stop();
    });
    displayRef.current = null;
    const ws = appWsRef.current;
    appWsRef.current = null;
    if (ws) {
      ws.onclose = null;
      ws.onmessage = null;
      ws.close();
    }
    try {
      appNodeRef.current?.disconnect();
    } catch {
      /* ya desconectado */
    }
    appNodeRef.current = null;
    tabAnalyserRef.current = null;
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
    micAnalyserRef.current = null;
    stopDisplay();
    onSysEndedRef.current = null;
    const ctx = ctxRef.current;
    ctxRef.current = null;
    if (ctx && ctx.state !== "closed") void ctx.close().catch(() => {});
    levelRef.current = 0;
  }, [stopDisplay]);

  /**
   * App de escritorio (Teams, Zoom…): el agente captura el audio del sistema
   * y lo manda por WS; aquí entra al MISMO mezclador que la pestaña, con su
   * analizador antes de mezclar (el "soy yo" automático sigue funcionando).
   * false = el helper no arrancó (sin permiso, sin swiftc…): el motivo queda
   * en systemAudioErrorRef y la junta sigue solo con el mic.
   */
  const enableAppAudio = useCallback(async (): Promise<boolean> => {
    const ctx = ctxRef.current;
    const node = nodeRef.current;
    const url = appUrlRef.current;
    if (!ctx || !node || !url) return false;
    stopDisplay();
    systemAudioErrorRef.current = null;
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    appWsRef.current = ws;
    const src = new AudioWorkletNode(ctx, "pcm16-source", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    const ok = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        systemAudioErrorRef.current = "el agente no respondió con el audio del sistema";
        resolve(false);
      }, 12_000); // la primera vez puede compilar el helper
      ws.onmessage = (ev) => {
        if (ev.data instanceof ArrayBuffer) {
          src.port.postMessage(ev.data, [ev.data]);
          return;
        }
        try {
          const msg = JSON.parse(String(ev.data)) as { state?: string; message?: string };
          if (msg.state === "capturing") {
            clearTimeout(timer);
            resolve(true);
          } else if (msg.state === "error") {
            clearTimeout(timer);
            systemAudioErrorRef.current = msg.message ?? "falló la captura del audio del sistema";
            resolve(false);
          }
        } catch {
          /* frame no-JSON */
        }
      };
      ws.onclose = (ev) => {
        clearTimeout(timer);
        if (!systemAudioErrorRef.current)
          systemAudioErrorRef.current = ev.reason || "se cerró la conexión del audio del sistema";
        resolve(false);
      };
    });
    if (!ok || appWsRef.current !== ws) {
      if (appWsRef.current === ws) stopDisplay();
      return false;
    }
    appNodeRef.current = src;
    src.connect(node);
    const tabAnalyser = ctx.createAnalyser();
    tabAnalyser.fftSize = 2048;
    src.connect(tabAnalyser);
    tabAnalyserRef.current = tabAnalyser;
    ws.onclose = (ev) => {
      // Se cortó a media junta (agente reiniciado, helper muerto): degradar a mic-only.
      systemAudioErrorRef.current = ev.reason || "se cortó el audio del sistema";
      stopDisplay();
      onSysEndedRef.current?.();
    };
    return true;
  }, [stopDisplay]);

  /** Pide la pestaña y la conecta al worklet vivo. Best-effort: false si el
   *  usuario canceló el picker o no marcó "compartir audio de la pestaña". */
  const enableTabAudio = useCallback(async (): Promise<boolean> => {
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
      systemAudioErrorRef.current = "compartiste sin marcar «Compartir audio de la pestaña»";
      return false;
    }
    displayRef.current = display;
    audioTrack.onended = () => {
      // "Dejar de compartir" a media junta: degradar a mic-only, avisar.
      stopDisplay();
      onSysEndedRef.current?.();
    };
    const tabSource = ctx.createMediaStreamSource(new MediaStream([audioTrack]));
    tabSource.connect(node);
    const tabAnalyser = ctx.createAnalyser();
    tabAnalyser.fftSize = 2048;
    tabSource.connect(tabAnalyser);
    tabAnalyserRef.current = tabAnalyser;
    systemAudioErrorRef.current = null;
    return true;
  }, [stopDisplay]);

  const enableSystemAudio = useCallback(
    () => (sourceRef.current === "app" ? enableAppAudio() : enableTabAudio()),
    [enableAppAudio, enableTabAudio],
  );

  const start = useCallback(
    async (
      onFrame: (frame: ArrayBuffer, levels: SourceLevels) => void,
      opts?: LiveAudioStartOptions,
    ): Promise<{ systemAudio: boolean }> => {
      stop();
      const mode = opts?.mode ?? "presencial";
      sourceRef.current = opts?.source ?? "tab";
      appUrlRef.current = opts?.appAudioUrl ?? null;
      systemAudioErrorRef.current = null;
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
          onFrame(data.pcm, {
            mic: rmsOf(micAnalyserRef.current),
            tab: rmsOf(tabAnalyserRef.current),
          });
        };
        const micSource = ctx.createMediaStreamSource(stream);
        micSource.connect(node);
        const micAnalyser = ctx.createAnalyser();
        micAnalyser.fftSize = 2048;
        micSource.connect(micAnalyser);
        micAnalyserRef.current = micAnalyser;
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
    [stop, enableSystemAudio, rmsOf],
  );

  // Al desmontar el dueño (el provider vive en el shell: en la práctica nunca).
  useEffect(() => stop, [stop]);

  return { start, enableSystemAudio, stop, levelRef, systemAudioErrorRef };
}
