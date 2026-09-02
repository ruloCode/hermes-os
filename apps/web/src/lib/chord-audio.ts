/**
 * Audio de acordes con WebAudio puro — sin samples ni dependencias.
 *
 * Es un piano de juguete a propósito: osciladores triangulares con una
 * envolvente suave y un filtro que quita el brillo digital. Suficiente para
 * OÍR una progresión antes de decidir si la letra va sobre ella, que es el
 * único trabajo de este módulo. El contexto se crea perezosamente en el
 * primer gesto del usuario (los navegadores lo exigen).
 */
import { chordIntervals, midi, midiToHz, type Chord } from "./music-theory";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let stopScheduled: (() => void) | null = null;

function ensure(): { ctx: AudioContext; master: GainNode } | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.35;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 2200;
    master.connect(lp).connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return { ctx, master: master! };
}

/** Programa un acorde en `at` (segundos del contexto) con duración `dur`. */
function scheduleChord(chord: Chord, at: number, dur: number, octave = 3): void {
  const a = ensure();
  if (!a) return;
  const { ctx, master } = a;
  const intervals = chordIntervals(chord);
  // Voicing: bajo una octava abajo + el acorde en posición abierta.
  const notes = [midi(chord.root, octave - 1), ...intervals.map((i) => midi(chord.root, octave) + i)];
  notes.forEach((n, i) => {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = i === 0 ? "sine" : "triangle";
    osc.frequency.value = midiToHz(n);
    // Rasgueo: cada voz entra unos ms después de la anterior.
    const t0 = at + i * 0.018;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(i === 0 ? 0.5 : 0.28, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.12, t0 + Math.min(0.9, dur * 0.6));
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(g).connect(master);
    osc.start(t0);
    osc.stop(at + dur + 0.05);
  });
}

/** Toca un acorde ahora mismo. */
export function playChord(chord: Chord, dur = 1.4): void {
  const a = ensure();
  if (!a) return;
  scheduleChord(chord, a.ctx.currentTime + 0.01, dur);
}

/** Toca una progresión: un acorde por compás al tempo dado. Devuelve stop(). */
export function playProgression(
  chords: Chord[],
  bpm: number,
  opts: { beatsPerChord?: number; onStep?: (i: number | null) => void; loop?: boolean } = {},
): () => void {
  stopScheduled?.();
  const a = ensure();
  if (!a || chords.length === 0) return () => {};
  const beats = opts.beatsPerChord ?? 4;
  const secPerChord = (60 / bpm) * beats;
  const timers: ReturnType<typeof setTimeout>[] = [];
  let cancelled = false;

  const run = (startAt: number) => {
    chords.forEach((c, i) => {
      const at = startAt + i * secPerChord;
      scheduleChord(c, at, secPerChord * 0.98);
      timers.push(setTimeout(() => !cancelled && opts.onStep?.(i), Math.max(0, (at - a.ctx.currentTime) * 1000)));
    });
    const end = startAt + chords.length * secPerChord;
    timers.push(
      setTimeout(() => {
        if (cancelled) return;
        if (opts.loop) run(end);
        else opts.onStep?.(null);
      }, Math.max(0, (end - a.ctx.currentTime) * 1000 - 30)),
    );
  };
  run(a.ctx.currentTime + 0.05);

  const stop = () => {
    cancelled = true;
    timers.forEach(clearTimeout);
    opts.onStep?.(null);
    stopScheduled = null;
  };
  stopScheduled = stop;
  return stop;
}

/** ¿Hay soporte de audio en este navegador? */
export const audioSupported = (): boolean =>
  typeof window !== "undefined" && Boolean(window.AudioContext ?? (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext);
