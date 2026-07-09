"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Graba audio del micrófono con MediaRecorder → Blob (webm/opus). Para subir
 * una junta grabada en vivo desde el dashboard. OJO: getUserMedia exige contexto
 * seguro (HTTPS) salvo en localhost — desde el celular hay que servir el
 * dashboard por HTTPS (Tailscale). El camino "subir archivo" no tiene ese límite.
 */
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

export function useMediaRecorder() {
  const [supported, setSupported] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startAtRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const resolveRef = useRef<((b: Blob | null) => void) | null>(null);

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

  const start = useCallback(async () => {
    setError(null);
    if (!supported) {
      setError("Tu navegador no soporta grabación de audio.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
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
      timerRef.current = setInterval(
        () => setElapsed(Math.floor((Date.now() - startAtRef.current) / 1000)),
        500,
      );
    } catch {
      cleanup();
      setError("No se pudo acceder al micrófono. Revisa el permiso (requiere HTTPS fuera de localhost).");
    }
  }, [supported, cleanup]);

  /** Detiene y resuelve con el audio grabado + su duración en segundos. */
  const stop = useCallback((): Promise<{ blob: Blob | null; durationSec: number }> => {
    return new Promise((resolve) => {
      const rec = recRef.current;
      const durationSec = Math.floor((Date.now() - startAtRef.current) / 1000);
      if (!rec || rec.state !== "recording") {
        resolve({ blob: null, durationSec });
        return;
      }
      resolveRef.current = (blob) => resolve({ blob, durationSec });
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

  return { supported, recording, elapsed, error, start, stop, cancel };
}
