"use client";

/**
 * Reloj de un <video>/<audio>: el elemento es el MAESTRO (la franja de voces,
 * la preescucha de un pasaje y el ▶ del resumen mueven el mismo), y la UI lee
 * su tiempo con un rAF mientras suena. `playRange` toca un tramo y se detiene
 * solo al final — la preescucha de un pasaje no sigue de largo por la sesión.
 *
 * El final del tramo se mira desde TRES lados: el rAF (preciso), `timeupdate`
 * del elemento y un temporizador al final previsto. Con la pestaña en segundo
 * plano el navegador congela el rAF y el tramo seguía de largo por la sesión.
 * Con la vista oculta (`active` false: el AppShell la deja montada en otra
 * ruta) se pausa todo.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export function useMediaClock({ active = true }: { active?: boolean } = {}) {
  const ref = useRef<HTMLMediaElement | null>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [range, setRange] = useState<{ from: number; to: number } | null>(null);
  const stopAt = useRef<number | null>(null);
  const loopFrom = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  /** ¿Se pasó del tramo? Vuelve al inicio (loop) o para. Lo llaman rAF, timeupdate y el temporizador. */
  const check = useCallback(() => {
    const el = ref.current;
    if (!el || stopAt.current == null || el.currentTime < stopAt.current) return false;
    if (loopFrom.current != null) {
      el.currentTime = loopFrom.current;
      return false;
    }
    el.pause();
    stopAt.current = null;
    clearTimer();
    setRange(null);
    return true;
  }, [clearTimer]);

  /** Temporizador de respaldo al final previsto del tramo (se re-arma solo si todavía no llegó). */
  const arm = useCallback(() => {
    clearTimer();
    const el = ref.current;
    if (!el || stopAt.current == null) return;
    const left = (stopAt.current - el.currentTime) / Math.max(0.1, el.playbackRate || 1);
    timer.current = setTimeout(
      () => {
        timer.current = null;
        if (ref.current?.paused) return;
        check();
        if (stopAt.current != null) arm();
      },
      Math.max(20, left * 1000 + 15),
    );
  }, [check, clearTimer]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      const el = ref.current;
      if (el) {
        check();
        // ~30 fps: suficiente para un playhead y la mitad de renders.
        if (now - last > 32) {
          last = now;
          setTime(el.currentTime);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, check]);

  /** Props para el elemento: engancha el estado sin addEventListener a mano. */
  const bind = useMemo(
    () => ({
      ref: (el: HTMLMediaElement | null) => {
        ref.current = el;
      },
      onPlay: () => {
        setPlaying(true);
        arm();
      },
      onPause: () => {
        setPlaying(false);
        clearTimer();
        if (ref.current) setTime(ref.current.currentTime);
      },
      onEnded: () => {
        setPlaying(false);
        clearTimer();
      },
      onSeeked: () => {
        if (ref.current) setTime(ref.current.currentTime);
        if (ref.current && !ref.current.paused) arm();
      },
      onTimeUpdate: () => {
        check();
      },
    }),
    [arm, check, clearTimer],
  );

  const seek = useCallback((t: number) => {
    const el = ref.current;
    if (!el) return;
    el.currentTime = Math.max(0, t);
    setTime(el.currentTime);
  }, []);

  const playRange = useCallback(
    (from: number, to?: number, loop = false) => {
      const el = ref.current;
      if (!el) return;
      el.currentTime = Math.max(0, from);
      stopAt.current = to ?? null;
      loopFrom.current = loop ? from : null;
      setRange(to != null ? { from, to } : null);
      void el
        .play()
        .then(arm)
        .catch(() => {});
    },
    [arm],
  );

  const pause = useCallback(() => {
    ref.current?.pause();
    stopAt.current = null;
    loopFrom.current = null;
    clearTimer();
    setRange(null);
  }, [clearTimer]);

  const toggle = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => {});
    else pause();
  }, [pause]);

  // Vista oculta (otra ruta) o desmontada: nada sigue sonando.
  useEffect(() => {
    if (!active) pause();
  }, [active, pause]);
  useEffect(() => clearTimer, [clearTimer]);

  return { ref, bind, time, playing, range, seek, playRange, pause, toggle };
}

export type MediaClock = ReturnType<typeof useMediaClock>;
