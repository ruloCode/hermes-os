"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Graba audio del micrófono con MediaRecorder → Blob (webm/opus). Lo usan dos
 * caminos: subir una junta grabada en vivo desde el dashboard y grabar la VOZ
 * EN OFF de una pieza del Estudio. OJO: getUserMedia exige contexto seguro
 * (HTTPS) salvo en localhost — desde el celular hay que servir el dashboard por
 * HTTPS (Tailscale). El camino "subir archivo" no tiene ese límite.
 *
 * Opciones (la voz en off las usa; las juntas se quedan con los defaults):
 *  - `raw`: apaga cancelación de eco / supresión de ruido / AGC. Ese
 *    procesamiento está afinado para LLAMADAS y le come cuerpo a una
 *    narración; para voz en off se graba crudo.
 *  - `meter`: publica nivel, PICO y las últimas amplitudes (bins) en un REF
 *    para pintar medidor y forma de onda en vivo — sin eso no hay forma de
 *    saber que el micrófono está vivo, y el pico permite avisar "no se escuchó
 *    nada" al guardar. Va por ref y no por estado a propósito: el teleprompter
 *    es la pantalla que se está mirando mientras se graba y no puede
 *    re-renderizarse 60 veces por segundo por una barrita.
 *  - `deviceId`: micrófono concreto (USB vs el de la Mac).
 */
export interface MediaRecorderOptions {
  raw?: boolean;
  meter?: boolean;
  deviceId?: string | null;
}

/** Cuántas amplitudes guarda el anillo de la onda en vivo (~8s a 30fps). */
export const WAVE_BINS = 240;

/** Lo que publica el medidor, todo por ref (cero re-renders). */
export interface MeterState {
  /** Nivel suavizado 0-1 para la barrita. */
  level: number;
  /** Pico absoluto de TODA la toma (0 = silencio: el mic no captó nada). */
  peak: number;
  /** Anillo de amplitudes 0-1; `head` es el índice del próximo escrito. */
  bins: Float32Array;
  head: number;
  /** Muestras escritas desde el último start (para no pintar el anillo viejo). */
  written: number;
}

function emptyMeter(): MeterState {
  return { level: 0, peak: 0, bins: new Float32Array(WAVE_BINS), head: 0, written: 0 };
}

function pickMime(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m;
    } catch {
      /* isTypeSupported puede lanzar en navegadores viejos */
    }
  }
  return null;
}

export function useMediaRecorder(options: MediaRecorderOptions = {}) {
  const { raw = false, meter = false, deviceId = null } = options;
  const [supported, setSupported] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  /** Medidor + onda en vivo (los leen <MicLevel>/<LiveWaveform> con su rAF). */
  const meterRef = useRef<MeterState>(emptyMeter());

  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startAtRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const resolveRef = useRef<((b: Blob | null) => void) | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    setSupported(
      typeof window !== "undefined" &&
        typeof navigator !== "undefined" &&
        !!navigator.mediaDevices?.getUserMedia &&
        typeof window.MediaRecorder !== "undefined",
    );
  }, []);

  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    void audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    meterRef.current.level = 0;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    // Corta cualquier grabación viva al desmontar.
    return () => {
      const rec = recRef.current;
      if (rec && rec.state === "recording") {
        rec.onstop = null;
        rec.stop();
      }
      cleanup();
    };
  }, [cleanup]);

  /** Medidor: RMS del buffer con caída suave + anillo de onda, al ref. */
  const startMeter = useCallback((stream: MediaStream) => {
    try {
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      // Un AudioContext creado fuera del gesto del usuario nace suspendido y
      // el analyser devolvería ceros: la onda se vería plana grabando bien.
      if (ctx.state === "suspended") void ctx.resume();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      const meter = meterRef.current;
      // La onda avanza a 30fps (no a 60): a 60 el dibujo corre demasiado
      // rápido para leerse y el anillo cubre la mitad del tiempo.
      let lastBin = 0;
      const tick = () => {
        rafRef.current = requestAnimationFrame(tick);
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        let max = 0;
        for (const v of buf) {
          sum += v * v;
          const abs = Math.abs(v);
          if (abs > max) max = abs;
        }
        const rms = Math.sqrt(sum / buf.length);
        // El nivel se sostiene y decae: seguir al RMS crudo parpadea entre
        // sílabas y no se lee.
        meter.level = Math.min(1, Math.max(rms * 3.2, meter.level * 0.82));
        if (max > meter.peak) meter.peak = max;
        const now = performance.now();
        if (now - lastBin < 33) return;
        lastBin = now;
        meter.bins[meter.head] = Math.min(1, rms * 3.6);
        meter.head = (meter.head + 1) % meter.bins.length;
        meter.written++;
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      /* sin AudioContext el medidor simplemente no se pinta */
    }
  }, []);

  const start = useCallback(async () => {
    setError(null);
    if (!supported) {
      setError("Tu navegador no soporta grabación de audio.");
      return false;
    }
    try {
      const constraints: MediaTrackConstraints = deviceId ? { deviceId: { exact: deviceId } } : {};
      if (raw) {
        constraints.echoCancellation = false;
        constraints.noiseSuppression = false;
        constraints.autoGainControl = false;
        constraints.channelCount = 1;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: Object.keys(constraints).length ? constraints : true,
      });
      streamRef.current = stream;
      chunksRef.current = [];
      meterRef.current = emptyMeter();
      const mime = pickMime();
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      rec.ondataavailable = (e) => {
        if (e.data.size) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        cleanup();
        setRecording(false);
        resolveRef.current?.(blob.size ? blob : null);
        resolveRef.current = null;
      };
      recRef.current = rec;
      rec.start();
      startAtRef.current = Date.now();
      setElapsed(0);
      setRecording(true);
      if (meter) startMeter(stream);
      timerRef.current = setInterval(
        () => setElapsed(Math.floor((Date.now() - startAtRef.current) / 1000)),
        500,
      );
      return true;
    } catch {
      cleanup();
      setError("No se pudo acceder al micrófono. Revisa el permiso (requiere HTTPS fuera de localhost).");
      return false;
    }
  }, [supported, cleanup, raw, meter, deviceId, startMeter]);

  /** Detiene y resuelve con el audio grabado, su duración y el pico captado. */
  const stop = useCallback((): Promise<{
    blob: Blob | null;
    durationSec: number;
    peak: number;
  }> => {
    return new Promise((resolve) => {
      const rec = recRef.current;
      const durationSec = Math.floor((Date.now() - startAtRef.current) / 1000);
      const peak = meterRef.current.peak;
      if (!rec || rec.state !== "recording") {
        resolve({ blob: null, durationSec, peak });
        return;
      }
      resolveRef.current = (blob) => resolve({ blob, durationSec, peak });
      rec.stop();
    });
  }, []);

  /** Cancela sin devolver audio. */
  const cancel = useCallback(() => {
    resolveRef.current = null;
    const rec = recRef.current;
    if (rec && rec.state === "recording") rec.stop();
    cleanup();
    setRecording(false);
    setElapsed(0);
  }, [cleanup]);

  return { supported, recording, elapsed, meterRef, error, start, stop, cancel };
}

/**
 * Micrófonos disponibles. Los nombres solo llegan DESPUÉS de conceder el
 * permiso (el browser los oculta antes): hasta entonces la lista queda vacía y
 * la UI dice "el que use el sistema".
 */
export function useAudioInputs(): MediaDeviceInfo[] {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const read = () => {
      void navigator.mediaDevices
        .enumerateDevices()
        .then((all) => setDevices(all.filter((d) => d.kind === "audioinput" && d.label)))
        .catch(() => setDevices([]));
    };
    read();
    navigator.mediaDevices.addEventListener?.("devicechange", read);
    return () => navigator.mediaDevices.removeEventListener?.("devicechange", read);
  }, []);
  return devices;
}
