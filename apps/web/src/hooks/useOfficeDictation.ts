"use client";

// Dictado de la Oficina: le dices la instrucción al agente con la voz.
//
// Dos motores, en orden:
//  1. "navegador": Web Speech API (Chrome/Safari). Ves la frase EN VIVO
//     mientras hablas y se detiene sola al callarte (SILENCE_MS).
//  2. "hermes": si el navegador no tiene reconocedor o falla (sin red, sin
//     permiso del servicio), se graba con MediaRecorder hasta el silencio y se
//     transcribe con la cadena STT del agente (POST /office/dictate →
//     Scribe → Whisper → local). Más lento, pero no depende del navegador.
//
// Estados: idle → listening → (transcribing) → ready | error. En "ready" el
// texto se puede corregir a mano antes de enviarlo.

import { useCallback, useEffect, useRef, useState } from "react";
import { hermesFetch } from "@/lib/hermes";

export type DictationState = "idle" | "listening" | "transcribing" | "ready" | "error";
export type DictationEngine = "navegador" | "hermes";

interface SpeechResultLike {
  0: { transcript: string };
  isFinal: boolean;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { results: ArrayLike<SpeechResultLike> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function speechCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Silencio que cierra la frase (después de haber hablado). */
const SILENCE_MS = 1600;
/** Si no dices nada en este tiempo, se deja de escuchar. */
const NO_SPEECH_MS = 8000;
/** Tope de una instrucción grabada (motor hermes). */
const MAX_RECORD_MS = 30000;
/** Errores del reconocedor del navegador que justifican pasar al motor de Hermes. */
const FALLBACK_ERRORS = new Set(["network", "service-not-allowed", "language-not-supported", "audio-capture"]);

export function useOfficeDictation(lang = "es-CO") {
  const [state, setState] = useState<DictationState>("idle");
  const [text, setText] = useState("");
  const [interim, setInterim] = useState("");
  const [engine, setEngine] = useState<DictationEngine>("navegador");
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const mediaRef = useRef<{ rec: MediaRecorder; stream: MediaStream; ctx: AudioContext; raf: number } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textRef = useRef("");
  const interimRef = useRef("");
  const forceHermes = useRef(false);

  const clearTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  const teardown = useCallback(() => {
    clearTimer();
    const r = recRef.current;
    if (r) {
      r.onresult = r.onend = r.onerror = null;
      try {
        r.abort();
      } catch {
        /* ya cerrado */
      }
    }
    recRef.current = null;
    const m = mediaRef.current;
    if (m) {
      cancelAnimationFrame(m.raf);
      if (m.rec.state !== "inactive") {
        m.rec.onstop = null;
        m.rec.stop();
      }
      m.stream.getTracks().forEach((t) => t.stop());
      void m.ctx.close();
    }
    mediaRef.current = null;
  }, []);

  useEffect(() => teardown, [teardown]);

  // ── Motor 2: grabar y transcribir con Hermes ───────────────────────────
  const startHermes = useCallback(async () => {
    setEngine("hermes");
    setState("listening");
    setError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      setState("error");
      setError("Sin permiso de micrófono.");
      return;
    }
    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "";
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    // Detector de silencio por volumen (RMS): corta al callarte tras haber hablado.
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    const started = performance.now();
    let spoke = false;
    let quietSince = performance.now();
    const media = { rec, stream, ctx, raf: 0 };
    const tick = () => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      const rms = Math.sqrt(sum / buf.length);
      const now = performance.now();
      if (rms > 0.02) {
        spoke = true;
        quietSince = now;
      }
      const done = (spoke && now - quietSince > SILENCE_MS) || (!spoke && now - started > NO_SPEECH_MS) || now - started > MAX_RECORD_MS;
      if (done && rec.state === "recording") {
        rec.stop();
        return;
      }
      media.raf = requestAnimationFrame(tick);
    };
    rec.onstop = async () => {
      cancelAnimationFrame(media.raf);
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
      mediaRef.current = null;
      if (!spoke) {
        setState("idle");
        return;
      }
      setState("transcribing");
      try {
        const form = new FormData();
        form.append("audio", new Blob(chunks, { type: rec.mimeType || "audio/webm" }), "instruccion.webm");
        const res = await hermesFetch("/office/dictate", { method: "POST", body: form });
        const data = (await res.json()) as { ok: boolean; text?: string; error?: string };
        if (!data.ok || !data.text) throw new Error(data.error || "no se entendió nada");
        textRef.current = data.text;
        setText(data.text);
        setState("ready");
      } catch (err) {
        setState("error");
        setError(err instanceof Error ? err.message : String(err));
      }
    };
    mediaRef.current = media;
    rec.start(250);
    media.raf = requestAnimationFrame(tick);
  }, []);

  // ── Motor 1: reconocedor del navegador ─────────────────────────────────
  const start = useCallback(() => {
    teardown();
    textRef.current = "";
    interimRef.current = "";
    setText("");
    setInterim("");
    setError(null);
    const Ctor = speechCtor();
    if (!Ctor || forceHermes.current) {
      void startHermes();
      return;
    }
    setEngine("navegador");
    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    const finish = () => {
      clearTimer();
      try {
        rec.stop();
      } catch {
        /* ya cerrado */
      }
    };
    rec.onresult = (e) => {
      let final = "";
      let live = "";
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) final += r[0].transcript;
        else live += r[0].transcript;
      }
      textRef.current = final.trim();
      interimRef.current = live.trim();
      setText(final.trim());
      setInterim(live.trim());
      clearTimer();
      timerRef.current = setTimeout(finish, SILENCE_MS);
    };
    rec.onerror = (e) => {
      if (FALLBACK_ERRORS.has(e.error)) {
        // El reconocedor del navegador no está disponible: se pasa a Hermes.
        forceHermes.current = true;
        rec.onend = null;
        recRef.current = null;
        void startHermes();
        return;
      }
      if (e.error !== "no-speech" && e.error !== "aborted") {
        setState("error");
        setError(e.error === "not-allowed" ? "Sin permiso de micrófono." : e.error);
      }
    };
    rec.onend = () => {
      clearTimer();
      recRef.current = null;
      // Lo último que quedó como interino también cuenta.
      const full = [textRef.current, interimRef.current].filter(Boolean).join(" ").trim();
      textRef.current = full;
      interimRef.current = "";
      setText(full);
      setInterim("");
      setState(full ? "ready" : "idle");
    };
    recRef.current = rec;
    timerRef.current = setTimeout(finish, NO_SPEECH_MS);
    try {
      rec.start();
      setState("listening");
    } catch {
      void startHermes();
    }
  }, [lang, startHermes, teardown]);

  /** Deja de escuchar ya (A o el botón): lo dicho queda listo para enviar. */
  const stop = useCallback(() => {
    clearTimer();
    if (recRef.current) {
      try {
        recRef.current.stop();
      } catch {
        /* ya cerrado */
      }
      return;
    }
    const m = mediaRef.current;
    if (m && m.rec.state === "recording") m.rec.stop();
  }, []);

  const cancel = useCallback(() => {
    teardown();
    textRef.current = "";
    setText("");
    setInterim("");
    setError(null);
    setState("idle");
  }, [teardown]);

  /** Corrección a mano del texto (o el seam de QA). */
  const edit = useCallback((value: string) => {
    textRef.current = value;
    setText(value);
    setState(value.trim() ? "ready" : "idle");
  }, []);

  return { state, text, interim, engine, error, start, stop, cancel, edit };
}

export type OfficeDictation = ReturnType<typeof useOfficeDictation>;
