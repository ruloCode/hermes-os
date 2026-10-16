"use client";

// Compañera de "Practicar ahora": mientras la tutora de voz está en la llamada,
// sube cada línea final del transcript (TÚ/TUTOR, ya transcritas por
// ElevenLabs) y lo que la tutora VA diciendo (streaming) al WS del agente, y
// recibe: la ayuda de tu turno (frase/pistas/qué dijo) y el feedback de cada
// cosa que dices (corrección o "bien dicho"), anclado a tu burbuja.
//
// Abre con la llamada CONECTANDO (no conectada): el arranque de la compañera
// corre en paralelo con el de la voz y llega lista a la primera pregunta.

import { useEffect, useRef, useState } from "react";
import {
  correctable,
  parseCorrection,
  type LiveHelpIntent,
  type LiveSuggestion,
  type LiveSuggestionKind,
  type PracticeCompanionEvent,
} from "@hermes/shared";
import { practiceCompanionWsUrl } from "@/lib/hermes";
import { addPracticeCorrection, resetPracticeCorrections } from "@/lib/practice-corrections";
import { useAutoHelp } from "@/lib/auto-help";
import { onAgentPartial } from "@/lib/voice-partials";
import { useVoice, type VoiceLine } from "@/components/VoiceBusyContext";

const MAX_CARDS = 40;
/** "Revisando…" no se queda colgado si el veredicto no llega. */
const PENDING_MAX_MS = 8_000;

/** Feedback de una cosa que dijiste. */
export type LineFeedback =
  | { kind: "correction"; quote: string; correction: string; note?: string }
  | { kind: "ok" };

export interface PracticeCompanion {
  /** El agente tiene la compañera lista (false = apagada o arrancando). */
  ready: boolean;
  /** Motivo si el agente la tiene apagada. */
  disabledReason: string | null;
  /** Correcciones y ayudas terminadas, la más reciente al final. */
  cards: LiveSuggestion[];
  /**
   * La ayuda para ESTE turno (frase/pistas/qué dijo), streameando o lista. Se
   * va cuando respondes o la tutora vuelve a hablar.
   */
  current: { id: string; kind: LiveSuggestionKind; text: string; streaming: boolean } | null;
  /** Feedback por línea tuya del transcript (por identidad de la línea). */
  feedback: ReadonlyMap<VoiceLine, LineFeedback>;
  /** Líneas tuyas que la compañera está revisando ahora. */
  pending: ReadonlySet<VoiceLine>;
  help(intent: LiveHelpIntent): void;
}

const norm = (t: string) =>
  t
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .replace(/\s+/g, " ")
    .trim();

export function usePracticeCompanion(active: boolean): PracticeCompanion {
  const { transcript } = useVoice();
  const [ready, setReady] = useState(false);
  const [disabledReason, setDisabledReason] = useState<string | null>(null);
  const [cards, setCards] = useState<LiveSuggestion[]>([]);
  const [current, setCurrent] = useState<PracticeCompanion["current"]>(null);
  const [feedback, setFeedback] = useState<Map<VoiceLine, LineFeedback>>(new Map());
  const [pending, setPending] = useState<Set<VoiceLine>>(new Set());
  const [autoHelp] = useAutoHelp();
  const autoHelpRef = useRef(autoHelp);
  autoHelpRef.current = autoHelp;
  const wsRef = useRef<WebSocket | null>(null);
  /** Líneas ya enviadas (por identidad: el transcript se recorta a 200). */
  const sentRef = useRef(new WeakSet<VoiceLine>());
  /** Tus líneas de esta práctica, para anclar el feedback que llega después. */
  const mineRef = useRef<VoiceLine[]>([]);
  const transcriptRef = useRef(transcript);
  transcriptRef.current = transcript;

  // Feedback de lo que dijiste → a la burbuja que lo contiene.
  const attach = (said: string, fb: LineFeedback) => {
    const mine = mineRef.current;
    const key = norm(fb.kind === "correction" ? fb.quote : said);
    const hits =
      fb.kind === "correction"
        ? [[...mine].reverse().find((l) => norm(l.text).includes(key)) ?? mine[mine.length - 1]]
        : mine.filter((l) => key.includes(norm(l.text)));
    const targets = hits.filter((l): l is VoiceLine => !!l);
    if (!targets.length) return;
    setFeedback((prev) => {
      const next = new Map(prev);
      // Una corrección manda sobre un "bien dicho" de la misma línea.
      for (const l of targets) if (fb.kind === "correction" || !next.has(l)) next.set(l, fb);
      return next;
    });
    setPending((prev) => {
      const next = new Set(prev);
      for (const l of targets) next.delete(l);
      return next;
    });
  };

  // Una práctica = una conexión. Lo dicho ANTES (charla con Hermes) no cuenta.
  useEffect(() => {
    if (!active) return;
    for (const line of transcriptRef.current) sentRef.current.add(line);
    mineRef.current = [];
    resetPracticeCorrections();
    setCards([]);
    setCurrent(null);
    setFeedback(new Map());
    setPending(new Set());
    setDisabledReason(null);

    let ws: WebSocket;
    try {
      ws = new WebSocket(practiceCompanionWsUrl());
    } catch {
      return;
    }
    wsRef.current = ws;
    ws.onopen = () => ws.send(JSON.stringify({ type: "config", autoHelp: autoHelpRef.current }));
    ws.onmessage = (msg: MessageEvent) => {
      if (typeof msg.data !== "string") return;
      let ev: PracticeCompanionEvent;
      try {
        ev = JSON.parse(msg.data) as PracticeCompanionEvent;
      } catch {
        return;
      }
      switch (ev.type) {
        case "ready":
          setReady(ev.enabled);
          setDisabledReason(ev.enabled ? null : (ev.reason ?? "no disponible"));
          break;
        case "checked":
          attach(ev.said, { kind: "ok" });
          break;
        case "suggestion":
        case "suggestion_done": {
          const s = ev.suggestion;
          addPracticeCorrection(s);
          setCards((prev) => [...prev, s].slice(-MAX_CARDS));
          if (s.kind === "corregir") {
            const e = parseCorrection(s.why ? `${s.text} | ${s.why}` : s.text);
            if (e) attach(e.quote, { kind: "correction", quote: e.quote, correction: e.correction, note: e.note_es });
          }
          if (ev.type === "suggestion_done")
            setCurrent((prev) =>
              prev && prev.id === s.id ? { ...prev, text: s.text, streaming: false } : prev,
            );
          break;
        }
        case "suggestion_start":
          setCurrent({ id: ev.id, kind: ev.kind, text: "", streaming: true });
          break;
        case "suggestion_delta":
          setCurrent((prev) => (prev && prev.id === ev.id ? { ...prev, text: prev.text + ev.text } : prev));
          break;
        case "suggestion_aborted":
          setCurrent((prev) => (prev && prev.id === ev.id ? null : prev));
          break;
      }
    };
    ws.onclose = () => {
      if (wsRef.current === ws) wsRef.current = null;
      setReady(false);
    };

    // Lo que la tutora VA diciendo: cada oración completa sube enseguida
    // (la compañera arranca la ayuda sin esperar a que termine de hablar).
    let sentences = 0;
    const off = onAgentPartial((p) => {
      if (!p || p.done) {
        sentences = 0;
        return;
      }
      const n = (p.text.match(/[.!?]/g) ?? []).length;
      if (n <= sentences || ws.readyState !== WebSocket.OPEN) return;
      sentences = n;
      ws.send(JSON.stringify({ type: "partial", text: p.text }));
    });

    return () => {
      off();
      wsRef.current = null;
      ws.onmessage = null;
      ws.onclose = null;
      try {
        ws.close();
      } catch {
        /* ya cerrado */
      }
      setReady(false);
      setCurrent(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // Cambió la preferencia con la práctica corriendo: el agente la aplica ya.
  useEffect(() => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "config", autoHelp }));
  }, [autoHelp]);

  // Cada línea nueva de la práctica sube una vez (las de la tutora cierran tu turno).
  useEffect(() => {
    if (!active) return;
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    for (const line of transcript) {
      if (sentRef.current.has(line)) continue;
      sentRef.current.add(line);
      if (line.who !== "TÚ" && line.who !== "TUTOR") continue;
      if (line.who === "TÚ") {
        mineRef.current.push(line);
        // Solo lo que va al corrector espera veredicto (corto o en español, no).
        if (ready && correctable(line.text)) {
          setPending((prev) => new Set(prev).add(line));
          setTimeout(
            () =>
              setPending((prev) => {
                if (!prev.has(line)) return prev;
                const next = new Set(prev);
                next.delete(line);
                return next;
              }),
            PENDING_MAX_MS,
          );
        }
      }
      // Respondiste o ella volvió a hablar: la ayuda de ese turno ya pasó.
      setCurrent((prev) => (prev && !prev.streaming ? null : prev));
      ws.send(
        JSON.stringify({ type: "turn", role: line.who === "TÚ" ? "user" : "tutor", text: line.text }),
      );
    }
  }, [active, transcript, ready]);

  return {
    ready,
    disabledReason,
    cards,
    current,
    feedback,
    pending,
    help: (intent) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "help", intent }));
    },
  };
}
