"use client";

/**
 * Transporte del MEMO: tres fuentes sobre el mismo reloj.
 *  - Original: la mezcla del pasaje (voz + guitarra), tal cual se grabó.
 *  - Voz aislada: el stem de voz (si la separación corrió).
 *  - Melodía sintetizada: las NOTAS medidas tocadas con WebAudio — la escucha
 *    exacta de lo que el análisis entendió, y la única que transpone sin
 *    deformar la voz.
 *
 * Transponer el audio real pide un render al agente (ffmpeg, archivo NUEVO: el
 * original jamás se pisa) y se cachea por (fuente, semitonos). Mueve los
 * formantes, así que suena a "ardilla" o a voz grave: la UI lo rotula como
 * vista previa.
 *
 * El TIEMPO no es estado por cuadro: vive en un ref y el rAF lo publica a
 * suscriptores (`clock.subscribe`) — el cabezal y el contador se escriben por
 * DOM, el karaoke se re-pinta solo al cruzar un borde de sílaba
 * (`useQuantizedTime`). El estado `time` cambia solo al pausar o buscar: antes
 * un setTime a 30 fps re-renderizaba el memo entero y re-suscribía su teclado.
 *
 * Cada `play()` es una CORRIDA (`runRef`): lo que termina de bajar o de
 * transponer después de ■, de cambiar de fuente/semitonos o de salir de la
 * vista ya no suena. Con la vista oculta (`active` false) todo se calla.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type SyntheticEvent } from "react";
import type { MelodyNote, PassageAnalysis } from "@hermes/shared";
import { playMelody, stopAllSound, type MelodyPlayback } from "@/lib/chord-audio";
import type { PlaygroundApi } from "./api";
import { shiftNotes } from "./measure";

export type MemoSource = "original" | "voz" | "sinte";

/** Reloj del reproductor: la posición por ref y un aviso por cuadro mientras suena. */
export interface TimeClock {
  now(): number;
  subscribe(fn: (t: number) => void): () => void;
}

/**
 * El tiempo del reloj CUANTIZADO a unos bordes (inicios y finales de sílaba o
 * de frase): devuelve el mayor borde ≤ t (o -Infinity). Toda comparación
 * `t >= borde` / `t < borde` da lo mismo con el valor cuantizado, así que el
 * componente se re-pinta solo al cruzar un borde — no a 30 fps.
 */
export function useQuantizedTime(clock: TimeClock, bounds: number[]): number {
  const sorted = useMemo(() => [...bounds].filter(Number.isFinite).sort((a, b) => a - b), [bounds]);
  const quantize = useCallback(
    (t: number) => {
      let lo = 0;
      let hi = sorted.length - 1;
      let at = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (sorted[mid] <= t) {
          at = mid;
          lo = mid + 1;
        } else hi = mid - 1;
      }
      return at < 0 ? -Infinity : sorted[at];
    },
    [sorted],
  );
  const [q, setQ] = useState(() => quantize(clock.now()));
  useEffect(() => {
    const on = (t: number) => {
      const v = quantize(t);
      setQ((prev) => (prev === v ? prev : v));
    };
    on(clock.now());
    return clock.subscribe(on);
  }, [clock, quantize]);
  return q;
}

export function useMemoPlayer({
  api,
  sessionId,
  passageId,
  analysis,
  semis,
  active = true,
}: {
  api: PlaygroundApi;
  sessionId: string;
  passageId: string;
  analysis: PassageAnalysis | null;
  semis: number;
  /** ¿La vista se ve? Oculta (otra ruta), se calla todo. */
  active?: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const synth = useRef<MelodyPlayback | null>(null);
  const range = useRef<{ from: number; to: number; loop: boolean } | null>(null);
  const renders = useRef(new Map<string, string>());
  /** Corrida vigente: stop() la incrementa y lo que llega tarde de una vieja no suena. */
  const runRef = useRef(0);
  const timeRef = useRef(0);
  const listeners = useRef(new Set<(t: number) => void>());
  const [source, setSourceState] = useState<MemoSource>("voz");
  const [playing, setPlaying] = useState(false);
  /** Posición CONFIRMADA (al pausar, parar o buscar); la viva está en `clock`. */
  const [time, setTimeState] = useState(0);
  const [activeNote, setActiveNote] = useState<number | null>(null);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clock = useMemo<TimeClock>(
    () => ({
      now: () => timeRef.current,
      subscribe: (fn) => {
        listeners.current.add(fn);
        return () => {
          listeners.current.delete(fn);
        };
      },
    }),
    [],
  );
  const publish = useCallback((t: number) => {
    timeRef.current = t;
    for (const fn of listeners.current) fn(t);
  }, []);
  /** Mueve la posición (sin sonar): reloj + estado. */
  const setTime = useCallback(
    (t: number) => {
      publish(t);
      setTimeState(t);
    },
    [publish],
  );

  const hasVoice = !!analysis?.files.voice;
  // Sin stem de voz, "Voz aislada" no existe: la fuente por defecto es la mezcla.
  useEffect(() => {
    if (analysis && !analysis.files.voice && source === "voz") setSourceState("original");
  }, [analysis, source]);

  const duration = analysis
    ? Math.max(
        analysis.hop * analysis.f0.length,
        analysis.notes.reduce((m, n) => Math.max(m, n.end), 0),
      )
    : 0;

  const stop = useCallback(() => {
    runRef.current++;
    synth.current?.stop();
    synth.current = null;
    audioRef.current?.pause();
    range.current = null;
    setPlaying(false);
    setActiveNote(null);
  }, []);

  // Cambiar de memo, de fuente o de semitonos corta lo que suena (no mezclar escuchas).
  useEffect(() => stop, [passageId, stop]);
  useEffect(() => {
    stop();
  }, [semis, source, stop]);
  useEffect(() => () => stopAllSound(), []);
  // Con la vista oculta (otra ruta: el AppShell la deja montada) no suena nada.
  useEffect(() => {
    if (!active) stop();
  }, [active, stop]);
  // Al parar, la posición viva queda como la confirmada (un solo render).
  useEffect(() => {
    if (!playing) setTimeState(timeRef.current);
  }, [playing]);

  /** Fin del tramo pedido (lo miran el rAF y `timeupdate`: con la pestaña en segundo plano no hay rAF). */
  const checkRange = useCallback((el: HTMLAudioElement) => {
    const r = range.current;
    if (!r || el.currentTime < r.to) return;
    if (r.loop) el.currentTime = r.from;
    else {
      el.pause();
      range.current = null;
    }
  }, []);

  // Reloj: rAF mientras suena (audio real o sinte) → suscriptores por ref, sin estado.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      let t: number | null = null;
      if (synth.current) t = synth.current.position();
      else if (audioRef.current) {
        checkRange(audioRef.current);
        t = audioRef.current.currentTime;
      }
      if (t != null) publish(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, publish, checkRange]);

  /** Archivo del agente para la fuente pedida (render transpuesto si hace falta). */
  const fileFor = useCallback(
    async (src: Exclude<MemoSource, "sinte">): Promise<string | null> => {
      if (!analysis) return null;
      const base = src === "voz" ? (analysis.files.voice ?? analysis.files.mix) : analysis.files.mix;
      if (semis === 0) return api.fileUrl(sessionId, base);
      const k = `${src}:${semis}`;
      let rel = renders.current.get(k);
      if (!rel) {
        setRendering(true);
        try {
          rel = (await api.transpose(sessionId, passageId, {
            semitones: semis,
            source: src === "voz" && analysis.files.voice ? "voz" : "mezcla",
          })).path;
          renders.current.set(k, rel);
        } finally {
          setRendering(false);
        }
      }
      return api.fileUrl(sessionId, rel);
    },
    [analysis, api, passageId, semis, sessionId],
  );

  /**
   * Toca desde `from` (hasta `to`, con loop opcional). `force` usa otra fuente
   * sin cambiar la elegida (el ▶ de una línea en Versiones siempre va en sinte).
   */
  const play = useCallback(
    async (opts: { from?: number; to?: number; loop?: boolean; force?: MemoSource; notes?: MelodyNote[] } = {}) => {
      if (!analysis) return;
      stop();
      const run = ++runRef.current;
      setError(null);
      const src = opts.force ?? source;
      const to = opts.to ?? duration;
      // Desde donde quedó el playhead; al final, vuelve a empezar.
      const cur = timeRef.current;
      const here = cur >= to - 0.05 ? 0 : cur;
      const from = Math.max(0, opts.from ?? here);
      if (src === "sinte") {
        const notes = opts.notes ?? shiftNotes(analysis.notes, semis);
        synth.current = playMelody(
          notes.map((n) => ({ midi: n.midi, start: n.start, dur: n.end - n.start })),
          {
            from,
            to,
            loop: opts.loop,
            onStep: (i) => {
              if (runRef.current !== run) return;
              setActiveNote(i);
              if (i === null && !opts.loop) {
                synth.current = null;
                setPlaying(false);
              }
            },
          },
        );
        publish(from);
        setPlaying(true);
        return;
      }
      try {
        const url = await fileFor(src);
        // ■, otra fuente/semitonos o salir mientras se transponía: esta corrida ya no suena.
        if (runRef.current !== run) return;
        const el = audioRef.current;
        if (!url || !el) return;
        if (el.src !== url) {
          el.src = url;
          await new Promise<void>((res) => {
            const done = () => {
              el.removeEventListener("loadedmetadata", done);
              el.removeEventListener("error", done);
              res();
            };
            el.addEventListener("loadedmetadata", done);
            el.addEventListener("error", done);
          });
          if (runRef.current !== run) return;
        }
        el.currentTime = from;
        publish(from);
        range.current = { from, to, loop: !!opts.loop };
        await el.play();
      } catch (e) {
        // Un stop() durante el play() lo rechaza con AbortError: no es un error de verdad.
        if (runRef.current !== run) return;
        setError((e as Error).message || "no se pudo reproducir");
        setPlaying(false);
      }
    },
    [analysis, duration, fileFor, publish, semis, source, stop],
  );

  const toggle = useCallback(
    (opts?: Parameters<typeof play>[0]) => (playing ? stop() : void play(opts)),
    [play, playing, stop],
  );

  const seek = useCallback(
    (t: number) => {
      const was = playing;
      setTime(t);
      if (was) void play({ from: t });
      else if (audioRef.current) audioRef.current.currentTime = t;
    },
    [play, playing, setTime],
  );

  const setSource = useCallback((s: MemoSource) => setSourceState(s), []);

  /** Props del <audio> oculto (vive en el DOM: salir de la vista lo pausa). */
  const audioProps = useMemo(
    () => ({
      ref: (el: HTMLAudioElement | null) => {
        audioRef.current = el;
      },
      onPlay: () => setPlaying(true),
      onPause: () => {
        if (!synth.current) setPlaying(false);
      },
      onEnded: () => setPlaying(false),
      onTimeUpdate: (e: SyntheticEvent<HTMLAudioElement>) => checkRange(e.currentTarget),
      onError: () => {
        if (audioRef.current?.getAttribute("src")) setError("no se pudo cargar el audio del pasaje");
      },
      preload: "metadata" as const,
      hidden: true,
    }),
    [checkRange],
  );

  return useMemo(
    () => ({
      source,
      setSource,
      hasVoice,
      playing,
      /** Posición confirmada (al pausar/buscar). La viva: `clock.now()` / `clock.subscribe`. */
      time,
      setTime,
      clock,
      duration,
      activeNote,
      rendering,
      error,
      play,
      stop,
      toggle,
      seek,
      audioProps,
    }),
    [source, setSource, hasVoice, playing, time, setTime, clock, duration, activeNote, rendering, error, play, stop, toggle, seek, audioProps],
  );
}

export type MemoPlayer = ReturnType<typeof useMemoPlayer>;
