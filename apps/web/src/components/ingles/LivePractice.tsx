"use client";

// Práctica EN VIVO con el tutor: transcripción en tiempo real de la llamada,
// en el centro de la pantalla, para reforzar reading mientras hablas (patrón
// Speak / Meta AI voice de Mobbin: la frase vigente del tutor grande y aireada,
// lo tuyo como píldora). Dos mecánicas encima del transcript:
//
// 1. KARAOKE: la frase vigente del tutor resalta palabra por palabra al ritmo
//    del audio (animación estimada por longitud — el SDK no da timings; con la
//    llamada real arranca cuando suena el agente y se completa cuando calla).
// 2. BANCO DE PALABRAS (patrón "tap to save" de Speak): cualquier palabra del
//    tutor es clickeable → se guarda al instante en english_vocab (sin
//    significado aún) y un contextual update le pide al tutor explicarla y
//    completarla con save_vocab cuando sea natural.
//
// Las líneas salen del transcript compartido de la voz (VoiceSessionBridge
// etiqueta TUTOR); aquí solo se leen las de ESTA sesión.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  useConversationControls,
  useConversationMode,
  useConversationStatus,
} from "@elevenlabs/react";
import type { VocabEntry } from "@hermes/shared";
import { useVoice } from "@/components/VoiceBusyContext";
import { ScrollArea } from "@/components/ui/ScrollArea";
import { hermesPost } from "@/lib/hermes";
import { saveableWord, tokenizeWords, wordSchedule } from "./live-words";
import { OWNER } from "@/lib/owner";

/** Palabra guardada durante ESTA práctica (para el rail "Banco de la sesión"). */
export interface SessionWord {
  term: string;
  /** La frase del tutor de donde salió (queda como example del vocab). */
  sentence: string;
}

function fmtElapsed(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

/** Una frase del tutor con palabras clickeables y (si es la vigente) karaoke. */
function TutorLine({
  text,
  current,
  wordOn,
  inBank,
  onWordTap,
}: {
  text: string;
  /** ¿Es la frase vigente? (grande + karaoke; las viejas bajan de peso) */
  current: boolean;
  /** Índice de palabra activa del karaoke (solo aplica a la vigente). */
  wordOn: number;
  /** ¿Está esta palabra ya en el banco? (vocab existente o tap de esta sesión) */
  inBank: (clean: string) => boolean;
  onWordTap: (clean: string, sentence: string) => void;
}) {
  const tokens = useMemo(() => tokenizeWords(text), [text]);
  let wordIdx = -1;
  return (
    <p
      className={
        current ? "text-xl leading-loose text-text" : "text-lg leading-loose text-text-dim"
      }
    >
      {tokens.map((t, i) => {
        if (!t.clean) return <span key={i}>{t.raw}</span>;
        wordIdx += 1;
        const saved = inBank(t.clean);
        const active = current && wordIdx === wordOn;
        const upcoming = current && wordOn >= 0 && wordIdx > wordOn;
        const tappable = saveableWord(t.clean);
        const cls = [
          "inline rounded-sm transition-colors duration-150",
          active
            ? "bg-green/15 text-green"
            : upcoming
              ? "text-text-faint"
              : saved
                ? "text-violet"
                : "",
          saved ? "underline decoration-violet/60 decoration-dotted underline-offset-4" : "",
          tappable ? "cursor-pointer hover:bg-cyan/10 hover:text-cyan" : "cursor-default",
        ].join(" ");
        if (!tappable) return <span key={i} className={cls}>{t.raw}</span>;
        const clean = t.clean;
        return (
          <button
            key={i}
            type="button"
            onClick={() => onWordTap(clean, text)}
            title={saved ? "En tu banco de vocabulario" : `Guardar “${clean}” en tu banco`}
            className={cls}
          >
            {t.raw}
          </button>
        );
      })}
    </p>
  );
}

export function LivePractice({
  connecting,
  vocab = [],
  onWordSaved,
}: {
  connecting: boolean;
  /** Vocabulario existente: marca en el transcript lo que ya está en el banco. */
  vocab?: VocabEntry[];
  /** Un tap guardó una palabra nueva → el rail "Banco de la sesión" la pinta. */
  onWordSaved?: (w: SessionWord) => void;
}) {
  const { transcript } = useVoice();
  const { isSpeaking } = useConversationMode();
  const { sendContextualUpdate } = useConversationControls();
  const { status } = useConversationStatus();
  // Solo la conversación de ESTA práctica (el transcript acumula la sesión
  // de Hermes previa si la hubo).
  const startRef = useRef(transcript.length);
  const [elapsed, setElapsed] = useState(0);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const lines = transcript.slice(startRef.current);

  // Sigue la conversación: la línea nueva entra siempre a la vista.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [lines.length]);

  const lastTutorIdx = lines.reduce((a, l, i) => (l.who === "TUTOR" ? i : a), -1);
  const lastTutorText = lastTutorIdx >= 0 ? lines[lastTutorIdx].text : "";

  // ── Karaoke de la frase vigente ──────────────────────────────────────
  // wordOn: -1 = esperando el audio · n = palabra activa · ≥len = terminada.
  const durations = useMemo(() => wordSchedule(tokenizeWords(lastTutorText)), [lastTutorText]);
  const [wordOn, setWordOn] = useState(-1);
  const connected = status === "connected";
  // Sin llamada real (QA en /dev/ui) no hay audio que esperar: arranca ya.
  const startGate = !connected || isSpeaking;

  // Frase nueva del tutor → karaoke en cero.
  useEffect(() => setWordOn(-1), [lastTutorIdx, lastTutorText]);

  useEffect(() => {
    if (lastTutorIdx < 0 || durations.length === 0) return;
    if (wordOn >= durations.length) return; // frase completa
    if (wordOn === -1) {
      if (startGate) setWordOn(0);
      return;
    }
    const t = window.setTimeout(() => setWordOn((w) => w + 1), durations[wordOn]);
    return () => window.clearTimeout(t);
  }, [wordOn, startGate, durations, lastTutorIdx]);

  // El audio del tutor terminó → no dejar el resaltado colgado a mitad
  // (w === -1 significa que nunca arrancó: ahí no hay nada que completar).
  useEffect(() => {
    if (connected && !isSpeaking) setWordOn((w) => (w >= 0 ? durations.length : w));
  }, [connected, isSpeaking, durations.length]);

  // ── Banco de palabras (tap to save) ──────────────────────────────────
  // Taps de esta sesión (optimista); el vocab existente llega por props.
  const [tapped, setTapped] = useState<Set<string>>(() => new Set());
  const vocabSet = useMemo(
    () => new Set(vocab.map((v) => v.term.trim().toLowerCase())),
    [vocab],
  );
  const inBank = (clean: string) => tapped.has(clean) || vocabSet.has(clean);

  const onWordTap = (clean: string, sentence: string) => {
    if (inBank(clean)) return;
    setTapped((prev) => new Set(prev).add(clean));
    onWordSaved?.({ term: clean, sentence });
    // Al banco YA (sin significado — el tutor lo completa con save_vocab).
    void hermesPost("/english/vocab", { term: clean, example: sentence.slice(0, 180) }).catch(
      () => undefined,
    );
    // Y el tutor la enseña cuando sea natural, sin descarrilar la charla.
    if (connected) {
      sendContextualUpdate(
        `[Word bank] ${OWNER || "The student"} just tapped the word "${clean}" in your sentence "${sentence.slice(0, 140)}" — he wants to learn it. When it feels natural (do NOT derail the current exchange), briefly explain "${clean}" in simple English, have him use it in a sentence, and call save_vocab with the term, its Spanish meaning and a short example.`,
      );
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* Estado de la llamada + reloj */}
      <div className="flex shrink-0 items-center gap-2">
        <span
          aria-hidden
          className={`h-2 w-2 rounded-full ${connecting ? "animate-pulse bg-amber" : "animate-pulse bg-green glow-box-green"}`}
        />
        <span
          className={`text-2xs tracking-label uppercase ${connecting ? "text-amber" : "text-green"}`}
        >
          {connecting ? "Conectando con el tutor…" : "En vivo · el tutor te escucha"}
        </span>
        <span className="ml-auto font-display text-sm text-text-dim tabular-nums">
          {fmtElapsed(elapsed)}
        </span>
      </div>

      {lines.length === 0 ? (
        // Bienvenida mientras arranca la conversación
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-center">
          <span aria-hidden className="text-3xl">
            👋
          </span>
          <p className="font-display text-lg text-text">Say hello!</p>
          <p className="max-w-sm text-sm leading-relaxed text-text-dim">
            El tutor abre la conversación. Todo lo que digan los dos aparece aquí en tiempo
            real, para que refuerces tu reading mientras hablas.
          </p>
        </div>
      ) : (
        <ScrollArea rail fade="y" className="min-h-0 flex-1 pr-1">
          {/* Columna de lectura angosta y centrada: renglones cómodos */}
          <div className="mx-auto flex max-w-2xl flex-col gap-5 py-2">
            {lines.map((l, i) =>
              l.who === "TÚ" ? (
                <div key={i} className="hud-in flex justify-end">
                  <div className="max-w-[80%] rounded-lg border border-line bg-violet/10 px-3.5 py-2.5 text-base leading-relaxed text-text">
                    {l.text}
                  </div>
                </div>
              ) : (
                <div key={i} className="hud-in flex flex-col gap-1.5">
                  <span className="text-2xs tracking-title text-green/80 uppercase">Tutor</span>
                  <TutorLine
                    text={l.text}
                    current={i === lastTutorIdx}
                    wordOn={i === lastTutorIdx ? wordOn : Number.MAX_SAFE_INTEGER}
                    inBank={inBank}
                    onWordTap={onWordTap}
                  />
                </div>
              ),
            )}
            <div ref={endRef} />
          </div>
        </ScrollArea>
      )}

      <p className="shrink-0 border-t border-line pt-2 text-center text-2xs text-text-faint">
        Toca cualquier palabra del tutor para guardarla en tu banco de vocabulario. Al colgar,
        el coach genera tu reporte con drills.
      </p>
    </div>
  );
}
