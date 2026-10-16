// Habla del modo voz del tutor: cada frase cerrada del stream se dice apenas
// llega (no se espera a la respuesta completa) y `onIdle` avisa cuando ya no
// queda nada por decir — ahí se reabre el micrófono. Síntesis del sistema
// (sin red en macOS: Paulina/Mónica); el mismo selector de voz de la Oficina.

import { SentenceSplitter } from "@hermes/shared";
import { spanishVoice } from "@/lib/oficina/speech";

export interface Speaker {
  /** Texto nuevo del stream (deltas). */
  push(chunk: string): void;
  /** Fin del stream: dice lo que quedó y, al terminar todo, llama a onIdle. */
  end(): void;
  /** Corta en seco (interrumpir o salir de la vista). */
  stop(): void;
  /** true mientras hay frases sonando o en cola. */
  speaking(): boolean;
}

export function speechAvailable(): boolean {
  return typeof window !== "undefined" && !!window.speechSynthesis;
}

export function createSpeaker(onIdle: () => void, onStart?: () => void): Speaker {
  const splitter = new SentenceSplitter();
  let pending = 0;
  let ended = false;
  let stopped = false;

  const check = () => {
    if (!stopped && ended && pending === 0) onIdle();
  };

  const say = (text: string) => {
    if (stopped || !text || !speechAvailable()) return;
    const u = new SpeechSynthesisUtterance(text);
    const voice = spanishVoice();
    if (voice) u.voice = voice;
    u.lang = voice?.lang ?? "es-CO";
    u.rate = 1.07;
    pending += 1;
    if (pending === 1) onStart?.();
    const done = () => {
      pending = Math.max(0, pending - 1);
      check();
    };
    u.onend = done;
    u.onerror = done;
    window.speechSynthesis.speak(u);
  };

  return {
    push(chunk) {
      for (const s of splitter.push(chunk)) say(s);
    },
    end() {
      for (const s of splitter.flush()) say(s);
      ended = true;
      check();
    },
    stop() {
      stopped = true;
      pending = 0;
      if (speechAvailable()) window.speechSynthesis.cancel();
    },
    speaking: () => pending > 0,
  };
}
