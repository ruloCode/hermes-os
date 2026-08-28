"use client";

/**
 * Primitivas de onda de la grabadora del Estudio.
 *
 * Referencias (Mobbin): ElevenLabs Voice Changer y OpenPhone para la onda de
 * barras finas centrada; Suno para el anillo de progreso del botón; Apple
 * Notes / Journal para la onda YA grabada con playhead y regla de tiempo;
 * Epidemic Sound para las filas de versiones con su onda propia.
 *
 * Las dos ondas se pintan en canvas con su propio rAF y leen el dato por REF:
 * un waveform a 60fps por estado de React re-renderizaría toda la pestaña
 * mientras grabas (y esta es justo la pantalla que estás mirando).
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { MeterState } from "@/hooks/useMediaRecorder";
import { readToken } from "@/components/ui/tones";

/** Densidad de barras: ancho + separación en px lógicos. */
const BAR_W = 2;
const BAR_GAP = 2;

/** Prepara el canvas para la densidad de pantalla real (nada borroso). */
function fitCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.floor(rect.width));
  const h = Math.max(1, Math.floor(rect.height));
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return ctx;
}

/** Barra vertical centrada con puntas redondeadas (la forma de ElevenLabs). */
function bar(ctx: CanvasRenderingContext2D, x: number, mid: number, half: number, color: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x, mid - half, BAR_W, half * 2, BAR_W / 2);
  ctx.fill();
}

/**
 * Onda EN VIVO: las últimas amplitudes del micrófono avanzando hacia la
 * izquierda, con la más reciente pegada al centro-derecha. En reposo deja una
 * línea de puntos (el canal existe, todavía no hay señal).
 */
export function LiveWaveform({
  meterRef,
  active,
  className = "",
}: {
  meterRef: RefObject<MeterState>;
  active: boolean;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const idle = readToken("--color-line-2", "#2a2a3a");
    const hot = readToken("--color-red", "#fb7185");
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const ctx = fitCanvas(canvas);
      if (!ctx) return;
      const w = canvas.getBoundingClientRect().width;
      const h = canvas.getBoundingClientRect().height;
      const mid = h / 2;
      const count = Math.max(1, Math.floor(w / (BAR_W + BAR_GAP)));
      const meter = meterRef.current;
      for (let i = 0; i < count; i++) {
        // i = 0 es la barra más VIEJA (izquierda); la última es lo que suena.
        const age = count - 1 - i;
        const idx = (meter.head - 1 - age + meter.bins.length * 2) % meter.bins.length;
        const written = active && meter.written > age;
        const v = written ? meter.bins[idx] : 0;
        const half = Math.max(0.5, Math.min(1, v) * (mid - 2));
        bar(ctx, i * (BAR_W + BAR_GAP), mid, half, written && v > 0.02 ? hot : idle);
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [meterRef, active]);

  return <canvas ref={canvasRef} className={`block h-full w-full ${className}`} aria-hidden />;
}

/** Picos normalizados de un audio decodificado (para la onda estática). */
export function peaksFrom(buffer: AudioBuffer, buckets = 200): Float32Array {
  const data = buffer.getChannelData(0);
  const size = Math.floor(data.length / buckets) || 1;
  const out = new Float32Array(buckets);
  let max = 0;
  for (let i = 0; i < buckets; i++) {
    let peak = 0;
    const start = i * size;
    for (let j = 0; j < size && start + j < data.length; j++) {
      const abs = Math.abs(data[start + j]);
      if (abs > peak) peak = abs;
    }
    out[i] = peak;
    if (peak > max) max = peak;
  }
  // Normalizar: una voz grabada bajito debe VERSE, no ser una línea plana.
  if (max > 0) for (let i = 0; i < buckets; i++) out[i] /= max;
  return out;
}

/**
 * Onda YA grabada con progreso de reproducción (patrón Apple Notes/Journal:
 * lo reproducido se enciende, lo que falta queda apagado). Clic = buscar.
 */
export function TakeWaveform({
  peaks,
  progress,
  onSeek,
  tone = "violet",
  className = "",
}: {
  peaks: Float32Array | null;
  /** 0-1; null cuando no se ha reproducido. */
  progress: number;
  onSeek?: (fraction: number) => void;
  tone?: "violet" | "green";
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const played = readToken(tone === "green" ? "--color-green" : "--color-violet", "#a78bfa");
    const rest = readToken("--color-line-2", "#2a2a3a");
    const ctx = fitCanvas(canvas);
    if (!ctx) return;
    const w = canvas.getBoundingClientRect().width;
    const h = canvas.getBoundingClientRect().height;
    const mid = h / 2;
    const count = Math.max(1, Math.floor(w / (BAR_W + BAR_GAP)));
    for (let i = 0; i < count; i++) {
      const v = peaks ? peaks[Math.floor((i / count) * peaks.length)] : 0;
      const half = Math.max(0.5, v * (mid - 1));
      bar(ctx, i * (BAR_W + BAR_GAP), mid, half, i / count <= progress ? played : rest);
    }
  }, [peaks, progress, tone]);

  return (
    <canvas
      ref={canvasRef}
      onClick={(e) => {
        if (!onSeek) return;
        const rect = e.currentTarget.getBoundingClientRect();
        onSeek(Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)));
      }}
      className={`block h-full w-full ${onSeek ? "cursor-pointer" : ""} ${className}`}
      aria-hidden
    />
  );
}

/**
 * Reproductor de una toma: decodifica el WAV una vez (picos reales) y lleva el
 * playhead con su propio rAF. Devuelve los controles para que cada UI los
 * pinte como quiera.
 */
export function useTakePlayer(url: string | null) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [peaks, setPeaks] = useState<Float32Array | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const rafRef = useRef(0);

  // Picos: una sola decodificación por archivo.
  useEffect(() => {
    let cancelled = false;
    setPeaks(null);
    setProgress(0);
    if (!url) return;
    void (async () => {
      try {
        const buf = await (await fetch(url)).arrayBuffer();
        const ctx = new AudioContext();
        const decoded = await ctx.decodeAudioData(buf);
        void ctx.close();
        if (!cancelled) setPeaks(peaksFrom(decoded));
      } catch {
        /* sin picos la onda queda plana; el audio igual suena */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  useEffect(() => {
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const follow = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    const tick = () => {
      const a = audioRef.current;
      if (!a || !a.duration) return;
      setProgress(a.currentTime / a.duration);
      if (!a.paused) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  /** onPlay del <audio>: cubre el autoPlay de la primera carga. */
  const handlePlay = useCallback(() => {
    setPlaying(true);
    follow();
  }, [follow]);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      void a.play();
      handlePlay();
    } else {
      a.pause();
      setPlaying(false);
    }
  };

  const seek = (fraction: number) => {
    const a = audioRef.current;
    if (!a || !a.duration) return;
    a.currentTime = fraction * a.duration;
    setProgress(fraction);
  };

  const onEnded = () => {
    setPlaying(false);
    setProgress(1);
  };

  return { audioRef, peaks, playing, progress, toggle, seek, onEnded, handlePlay, setPlaying };
}
