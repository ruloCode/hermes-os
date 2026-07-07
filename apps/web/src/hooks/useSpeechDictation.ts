"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Dictado por voz (voz → texto) con la Web Speech API del navegador.
 * Gratis, on-device, sin dependencias — como el micrófono del input de
 * Claude/ChatGPT. Distinto del panel de voz en tiempo real (ElevenLabs).
 *
 * Soporte real: Chrome/Edge/Safari. Si no existe, `supported` es false y
 * el consumidor oculta el botón.
 */

// ── Tipos mínimos de la Web Speech API (no siempre están en lib.dom) ──
interface SpeechAlternative {
  transcript: string;
}
interface SpeechResult {
  0: SpeechAlternative;
  isFinal: boolean;
  length: number;
}
interface SpeechRecognitionEventLike {
  results: ArrayLike<SpeechResult>;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function useSpeechDictation({
  lang = "es-MX",
  onTranscript,
}: {
  lang?: string;
  /** Texto acumulado hasta ahora (final + interino) e indicador de si el
   *  último fragmento es definitivo. */
  onTranscript: (text: string, isFinal: boolean) => void;
}) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const cbRef = useRef(onTranscript);
  cbRef.current = onTranscript;

  useEffect(() => {
    setSupported(getCtor() !== null);
    return () => {
      // Cancela cualquier reconocimiento vivo al desmontar.
      const rec = recRef.current;
      if (rec) {
        rec.onresult = rec.onend = rec.onerror = null;
        rec.abort();
      }
      recRef.current = null;
    };
  }, []);

  const stop = useCallback(() => {
    recRef.current?.stop();
  }, []);

  const start = useCallback(() => {
    const Ctor = getCtor();
    if (!Ctor) {
      setError("Tu navegador no soporta dictado por voz.");
      return;
    }
    // Nueva instancia por sesión → los `results` arrancan limpios.
    const prev = recRef.current;
    if (prev) {
      prev.onresult = prev.onend = prev.onerror = null;
      prev.abort();
    }
    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let text = "";
      let isFinal = false;
      for (let i = 0; i < e.results.length; i++) {
        const res = e.results[i];
        text += res[0].transcript;
        isFinal = res.isFinal; // el del último fragmento
      }
      cbRef.current(text.trim(), isFinal);
    };
    rec.onerror = (e) => {
      if (e.error !== "aborted" && e.error !== "no-speech") setError(e.error);
      setListening(false);
    };
    rec.onend = () => setListening(false);
    recRef.current = rec;
    setError(null);
    try {
      rec.start();
      setListening(true);
    } catch {
      /* start() lanza si ya estaba activo; lo ignoramos */
    }
  }, [lang]);

  return { supported, listening, error, start, stop };
}
