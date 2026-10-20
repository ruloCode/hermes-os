"use client";

// Práctica EN VIVO con la tutora — la pantalla de conversación.
//
// Tres franjas, cada una con UN trabajo (patrones Mobbin: Speak roleplay para
// la tarjeta de la tutora + pista, Speak/Duolingo para la corrección pegada a
// tu frase, Gemini Live para la barra de llamada):
//
// 1. BARRA DE LLAMADA: quién habla (onda real del audio), tiempo, silenciar,
//    ayuda automática y terminar.
// 2. CONVERSACIÓN: la frase de la tutora llega EN STREAMING mientras la dice
//    (agent_chat_response_part) y queda grande; las viejas bajan de peso. Tus
//    frases como burbuja con su feedback DEBAJO: «dijiste → mejor | regla» o
//    "bien dicho". Las palabras de la tutora se tocan para guardarlas.
// 3. TU TURNO (fijo abajo, nunca se va con el scroll): la frase que puedes
//    decir, en grande, apenas ella termina la pregunta. Atajos F · P · Q · M.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useConversationControls,
  useConversationInput,
  useConversationMode,
  useConversationStatus,
} from "@elevenlabs/react";
import { parseClassHelp, type VocabEntry } from "@hermes/shared";
import { useVoice, type VoiceLine } from "@/components/VoiceBusyContext";
import { VoiceWaveform } from "@/components/VoiceWaveform";
import { ScrollArea } from "@/components/ui/ScrollArea";
import { Button } from "@/components/ui/Button";
import { hermesPost } from "@/lib/hermes";
import { onAgentPartial, type AgentPartial } from "@/lib/voice-partials";
import type { LineFeedback, PracticeCompanion } from "@/hooks/usePracticeCompanion";
import { saveableWord, tokenizeWords, wordSchedule } from "./live-words";
import { AutoHelpToggle } from "./AutoHelpToggle";
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
        current
          ? "text-2xl leading-relaxed text-text"
          : "text-md leading-relaxed text-text-dim"
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
            ? "bg-selected text-text"
            : upcoming
              ? "text-text-faint"
              : saved
                ? "text-accent"
                : "",
          saved ? "underline decoration-accent/60 decoration-dotted underline-offset-4" : "",
          tappable ? "cursor-pointer hover:bg-hover hover:text-text" : "cursor-default",
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

/** Lo que la tutora va diciendo ahora mismo (texto en streaming). */
function useAgentPartial(): AgentPartial | null {
  const [p, setP] = useState<AgentPartial | null>(null);
  useEffect(() => onAgentPartial(setP), []);
  return p;
}

/** Tu frase + lo que la compañera opinó de ella. */
function MyLine({
  line,
  feedback,
  pending,
}: {
  line: VoiceLine;
  feedback?: LineFeedback;
  pending: boolean;
}) {
  return (
    <div className="hud-in flex flex-col items-end gap-1.5">
      <div className="max-w-[85%] rounded-lg border border-line bg-accent/10 px-3.5 py-2.5 text-md leading-relaxed text-text">
        {line.text}
      </div>
      {feedback?.kind === "correction" ? (
        <div className="hud-in max-w-[85%] rounded-md border border-amber/25 bg-amber/5 px-3 py-2">
          <p className="text-sm leading-snug text-text-dim">
            <span className="line-through decoration-amber/60">{feedback.quote}</span>
            <span className="px-1.5 text-text-faint">→</span>
            <span className="font-medium text-text">{feedback.correction}</span>
          </p>
          {feedback.note && <p className="mt-0.5 text-xs leading-snug text-text-dim">{feedback.note}</p>}
        </div>
      ) : feedback?.kind === "ok" ? (
        <span className="hud-in flex items-center gap-1 text-xs text-text-dim">
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
            className="text-green"
          >
            <path d="M20 6 9 17l-5-5" />
          </svg>
          Bien dicho
        </span>
      ) : pending ? (
        <span className="text-xs text-text-faint pulse-dot">revisando…</span>
      ) : null}
    </div>
  );
}

/** Etiqueta de la ayuda del turno, según lo que trajo la compañera. */
const HELP_LABEL: Record<string, string> = {
  decir: "Dilo así",
  andamio: "Pistas para responder",
  explicar: "Qué dijo",
};

/** Las pistas llegan como "Clave: a (x) · b (y)\nArranca: …": se pintan como chips + frase. */
function parseHints(text: string): { keys: string[]; start: string | null } | null {
  const keyLine = text.match(/Clave:\s*(.+)/i)?.[1];
  const start = text.match(/Arranca:\s*(.+)/i)?.[1]?.replace(/^["“]|["”]$/g, "") ?? null;
  if (!keyLine && !start) return null;
  return { keys: keyLine ? keyLine.split(/\s+·\s+/).filter(Boolean) : [], start };
}

const ACTIONS = [
  { intent: "full", label: "Frase", key: "F", title: "La respuesta completa para decirla" },
  { intent: "scaffold", label: "Pistas", key: "P", title: "Palabras clave + cómo arrancar" },
  { intent: "explain", label: "¿Qué dijo?", key: "Q", title: "Lo último de la tutora en español" },
] as const;

/** El dock de tu turno: lo que puedes decir, siempre a la vista. */
function TurnDock({ companion, live }: { companion: PracticeCompanion; live: boolean }) {
  const cur = companion.current;
  const hints = cur?.kind === "andamio" ? parseHints(cur.text) : null;
  return (
    <div className="shrink-0 rounded-md border border-line bg-panel px-4 py-3 shadow-[var(--shadow-card)]">
      <div className="flex items-center gap-2">
        <span
          className={`flex items-center gap-1.5 text-xs font-medium ${cur ? "text-text" : "text-text-dim"}`}
        >
          {cur?.streaming && <span aria-hidden className="pulse-dot h-1.5 w-1.5 rounded-full bg-cyan" />}
          {cur ? (HELP_LABEL[cur.kind] ?? "Ayuda") : "Tu turno"}
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          {ACTIONS.map((a) => (
            <Button
              key={a.intent}
              onClick={() => companion.help(a.intent)}
              disabled={!companion.ready || !live}
              title={`${a.title} (${a.key})`}
            >
              {a.label}
              <kbd className="rounded-xs border border-line px-1 font-sans text-2xs text-text-faint">
                {a.key}
              </kbd>
            </Button>
          ))}
        </span>
      </div>
      <div className="mt-2 min-h-[64px]">
        {cur && hints ? (
          <div className="flex flex-col gap-2">
            {hints.keys.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {hints.keys.map((k) => (
                  <span key={k} className="rounded-sm border border-line bg-panel-2 px-2 py-0.5 text-sm text-text">
                    {k}
                  </span>
                ))}
              </div>
            )}
            {hints.start && <p className="text-2xl leading-snug text-text">{hints.start}</p>}
          </div>
        ) : cur && cur.kind === "decir" ? (
          (() => {
            const parts = parseClassHelp(cur.text);
            return (
              <div>
                <p className="whitespace-pre-line text-2xl leading-snug text-text">
                  {parts.main || <span className="text-text-faint">…</span>}
                  {cur.streaming && <span className="text-accent">▌</span>}
                </p>
                {parts.levelUp && (
                  <p className="mt-2 text-sm leading-snug text-text-dim">
                    <span className="font-medium">Sube de nivel:</span>{" "}
                    <span className="font-medium text-text">{parts.levelUp.expr}</span>
                    {parts.levelUp.meaning ? ` — ${parts.levelUp.meaning}` : ""}
                  </p>
                )}
              </div>
            );
          })()
        ) : cur ? (
          <p
            className={`whitespace-pre-line text-text ${cur.kind === "explicar" ? "text-lg leading-relaxed" : "text-2xl leading-snug"}`}
          >
            {cur.text || <span className="text-text-faint">…</span>}
            {cur.streaming && <span className="text-accent">▌</span>}
          </p>
        ) : (
          <p className="text-md leading-relaxed text-text-faint">
            {companion.disabledReason
              ? `Compañera apagada: ${companion.disabledReason}`
              : companion.ready
                ? "Cuando la tutora te pregunte, aquí aparece qué decir — apenas termine la pregunta."
                : live
                  ? "Preparando tu compañera…"
                  : "Conectando…"}
          </p>
        )}
      </div>
    </div>
  );
}

export function LivePractice({
  connecting,
  vocab = [],
  onWordSaved,
  companion,
  onEnd,
}: {
  connecting: boolean;
  /** Vocabulario existente: marca en el transcript lo que ya está en el banco. */
  vocab?: VocabEntry[];
  /** Un tap guardó una palabra nueva → el rail "Banco de la sesión" la pinta. */
  onWordSaved?: (w: SessionWord) => void;
  /** Ayuda de tu turno + feedback de lo que dices. */
  companion: PracticeCompanion;
  /** Colgar (la tutora guarda la sesión y el coach arma el reporte). */
  onEnd?: () => void;
}) {
  const { transcript } = useVoice();
  const { isSpeaking } = useConversationMode();
  const { sendContextualUpdate } = useConversationControls();
  const { status } = useConversationStatus();
  const { isMuted, setMuted } = useConversationInput();
  const partial = useAgentPartial();
  // Solo la conversación de ESTA práctica (el transcript acumula la sesión
  // de Hermes previa si la hubo).
  const startRef = useRef(transcript.length);
  const [elapsed, setElapsed] = useState(0);
  const endRef = useRef<HTMLDivElement>(null);
  const connected = status === "connected";

  // El reloj cuenta la conversación, no el arranque.
  useEffect(() => {
    if (!connected) return;
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [connected]);

  const lines = transcript.slice(startRef.current);
  // Mientras la tutora habla, su frase en streaming ES la vigente.
  const liveText = partial && !partial.done && partial.text.trim() ? partial.text : null;
  // Lo último que se vio en streaming: esa frase no repite el karaoke al cerrarse.
  const lastStreamedRef = useRef("");
  if (partial?.text.trim()) lastStreamedRef.current = partial.text;

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [lines.length, liveText]);

  const lastTutorIdx = liveText ? -1 : lines.reduce((a, l, i) => (l.who === "TUTOR" ? i : a), -1);
  const lastTutorText = lastTutorIdx >= 0 ? lines[lastTutorIdx].text : "";
  const squash = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, "");
  const streamedKey = squash(lastStreamedRef.current).slice(0, 24);
  const karaoke = !!lastTutorText && !(streamedKey && squash(lastTutorText).startsWith(streamedKey));

  // ── Karaoke de la frase vigente (solo si no se vio en streaming) ───────
  // wordOn: -1 = esperando el audio · n = palabra activa · ≥len = terminada.
  const durations = useMemo(() => wordSchedule(tokenizeWords(lastTutorText)), [lastTutorText]);
  const [wordOn, setWordOn] = useState(-1);
  const startGate = !connected || isSpeaking;

  useEffect(() => setWordOn(-1), [lastTutorIdx, lastTutorText]);

  useEffect(() => {
    if (!karaoke || lastTutorIdx < 0 || durations.length === 0) return;
    if (wordOn >= durations.length) return; // frase completa
    if (wordOn === -1) {
      if (startGate) setWordOn(0);
      return;
    }
    const t = window.setTimeout(() => setWordOn((w) => w + 1), durations[wordOn]);
    return () => window.clearTimeout(t);
  }, [wordOn, startGate, durations, lastTutorIdx, karaoke]);

  useEffect(() => {
    if (connected && !isSpeaking) setWordOn((w) => (w >= 0 ? durations.length : w));
  }, [connected, isSpeaking, durations.length]);

  // ── Banco de palabras (tap to save) ──────────────────────────────────
  const [tapped, setTapped] = useState<Set<string>>(() => new Set());
  const vocabSet = useMemo(
    () => new Set(vocab.map((v) => v.term.trim().toLowerCase())),
    [vocab],
  );
  const inBank = useCallback(
    (clean: string) => tapped.has(clean) || vocabSet.has(clean),
    [tapped, vocabSet],
  );

  const onWordTap = (clean: string, sentence: string) => {
    if (inBank(clean)) return;
    setTapped((prev) => new Set(prev).add(clean));
    onWordSaved?.({ term: clean, sentence });
    // Al banco YA (sin significado — la tutora lo completa con save_vocab).
    void hermesPost("/english/vocab", { term: clean, example: sentence.slice(0, 180) }).catch(
      () => undefined,
    );
    if (connected) {
      sendContextualUpdate(
        `[Word bank] ${OWNER || "The student"} just tapped the word "${clean}" in your sentence "${sentence.slice(0, 140)}" — he wants to learn it. When it feels natural (do NOT derail the current exchange), briefly explain "${clean}" in simple English, have him use it in a sentence, and call save_vocab with the term, its Spanish meaning and a short example.`,
      );
    }
  };

  // ── Atajos: F frase · P pistas · Q qué dijo · M silenciar ────────────
  const helpRef = useRef(companion.help);
  helpRef.current = companion.help;
  useEffect(() => {
    if (!connected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      const k = e.key.toLowerCase();
      if (k === "f") helpRef.current("full");
      else if (k === "p") helpRef.current("scaffold");
      else if (k === "q") helpRef.current("explain");
      else if (k === "m") setMuted(!isMuted);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [connected, isMuted, setMuted]);

  const callState = connecting
    ? { dot: "bg-amber pulse-dot", text: "Conectando con la tutora…" }
    : isMuted
      ? { dot: "bg-red", text: "Micrófono silenciado" }
      : isSpeaking
        ? { dot: "bg-cyan pulse-dot", text: "La tutora está hablando" }
        : { dot: "bg-green", text: "Te escucha — habla cuando quieras" };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* ── Barra de llamada ─────────────────────────────────────── */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-line pb-2.5">
        <span className="flex min-w-0 items-center gap-2">
          <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${callState.dot}`} />
          <span className="truncate text-sm text-text">{callState.text}</span>
        </span>
        <div className="hidden min-w-[120px] flex-1 md:block">
          <VoiceWaveform height={26} />
        </div>
        <span className="ml-auto text-sm text-text-dim tabular-nums">{fmtElapsed(elapsed)}</span>
        <AutoHelpToggle />
        <Button
          variant={isMuted ? "danger" : "secondary"}
          onClick={() => setMuted(!isMuted)}
          disabled={!connected}
          title="Silenciar tu micrófono (M)"
        >
          {isMuted ? "Activar mic" : "Silenciar"}
        </Button>
        {onEnd && (
          <Button
            variant="danger"
            onClick={onEnd}
            title="Colgar: la tutora guarda la sesión y el coach arma tu reporte"
          >
            Terminar
          </Button>
        )}
      </div>

      {/* ── Conversación ─────────────────────────────────────────── */}
      {lines.length === 0 && !liveText ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-center">
          <p className="text-lg text-text">La tutora va a saludarte</p>
          <p className="max-w-sm text-sm leading-relaxed text-text-dim">
            Responde con naturalidad. Si te bloqueas, abajo aparece qué decir; si no entiendes,
            pulsa Q.
          </p>
        </div>
      ) : (
        <ScrollArea rail fade="y" className="min-h-0 flex-1 pr-1">
          <div className="mx-auto flex max-w-2xl flex-col gap-5 py-2">
            {lines.map((l, i) =>
              l.who === "TÚ" ? (
                <MyLine
                  key={i}
                  line={l}
                  feedback={companion.feedback.get(l)}
                  pending={companion.pending.has(l)}
                />
              ) : (
                <div key={i} className="hud-in flex flex-col gap-1">
                  <span className="text-xs text-text-dim">Tutora</span>
                  <TutorLine
                    text={l.text}
                    current={i === lastTutorIdx}
                    wordOn={i === lastTutorIdx && karaoke ? wordOn : Number.MAX_SAFE_INTEGER}
                    inBank={inBank}
                    onWordTap={onWordTap}
                  />
                </div>
              ),
            )}
            {liveText && (
              <div className="flex flex-col gap-1">
                <span className="flex items-center gap-1.5 text-xs text-text-dim">
                  <span aria-hidden className="pulse-dot h-1.5 w-1.5 rounded-full bg-cyan" />
                  Tutora
                </span>
                <p className="text-2xl leading-relaxed text-text">
                  {liveText}
                  <span className="text-accent">▌</span>
                </p>
              </div>
            )}
            <div ref={endRef} />
          </div>
        </ScrollArea>
      )}

      {/* ── Tu turno ─────────────────────────────────────────────── */}
      <TurnDock companion={companion} live={connected} />
    </div>
  );
}
