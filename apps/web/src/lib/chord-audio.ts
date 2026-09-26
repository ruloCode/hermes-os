/**
 * Audio de acordes y melodías con WebAudio puro — sin samples ni dependencias.
 *
 * Es un piano de juguete a propósito: osciladores triangulares con una
 * envolvente suave y un filtro que quita el brillo digital. Suficiente para
 * OÍR una progresión antes de decidir si la letra va sobre ella, y para oír la
 * melodía de un memo en la tonalidad de la canción (el Playground), que es el
 * único trabajo de este módulo. El contexto se crea perezosamente en el primer
 * gesto del usuario (los navegadores lo exigen).
 *
 * Stop REAL: cada nota programada queda registrada con sus nodos, así que
 * `stop()` corta el sonido en el acto. Antes solo se cancelaban los timers y
 * los osciladores ya programados seguían sonando hasta terminar la vuelta —
 * con una melodía de 50 s eso es medio minuto de audio que no se puede callar.
 */
import { chordIntervals, midi, midiToHz, type Chord } from "./music-theory";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let stopScheduled: (() => void) | null = null;

/** Una voz sonando (o programada): lo necesario para callarla ya. */
interface Voice {
  osc: OscillatorNode;
  gain: GainNode;
}

/** Todas las voces vivas, para `stopAllSound()` (salir de la vista corta todo). */
const live = new Set<Voice>();

function ensure(): { ctx: AudioContext; master: GainNode } | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
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

/**
 * El AudioContext ÚNICO del dashboard (lo crea el primer gesto). Lo comparten
 * este módulo, el motor de la pista de un Tema (lib/track-engine.ts) y la
 * grabadora sobre el loop (lib/loop-recorder.ts): un solo reloj, así lo que se
 * graba queda alineado a nivel de muestra con lo que suena.
 */
export function audioContext(): AudioContext | null {
  return ensure()?.ctx ?? null;
}

/**
 * Registra una voz en `bag` y la saca al terminar. `global` = entra al conjunto
 * que `stopAllSound()` calla; las voces del motor de la pista NO entran (tienen
 * su propio stop, y salir de un memo no debe cortar el loop de un tema).
 */
function track(bag: Set<Voice> | null, v: Voice, global = true): void {
  if (global) live.add(v);
  bag?.add(v);
  v.osc.onended = () => {
    live.delete(v);
    bag?.delete(v);
    try {
      v.gain.disconnect();
    } catch {
      /* ya desconectado */
    }
  };
}

/**
 * Calla un grupo de voces YA: rampa de 15 ms (un corte seco a cero hace clic) y
 * stop del oscilador, aunque todavía no hubiera empezado.
 */
function silence(bag: Iterable<Voice>): void {
  if (!ctx) return;
  const now = ctx.currentTime;
  for (const v of Array.from(bag)) {
    try {
      v.gain.gain.cancelScheduledValues(now);
      v.gain.gain.setValueAtTime(Math.max(0.0001, v.gain.gain.value), now);
      v.gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.015);
      v.osc.stop(now + 0.02);
    } catch {
      /* el oscilador ya había parado */
    }
  }
}

/** Programa un acorde en `at` (segundos del contexto) con duración `dur`. */
function scheduleChord(
  chord: Chord,
  at: number,
  dur: number,
  octave = 3,
  bag: Set<Voice> | null = null,
  out?: AudioNode,
  global = true,
): void {
  const intervals = chordIntervals(chord);
  // Voicing: bajo una octava abajo + el acorde en posición abierta.
  const notes = [midi(chord.root, octave - 1), ...intervals.map((i) => midi(chord.root, octave) + i)];
  scheduleVoicing(notes, at, dur, bag, out, global, undefined, true);
}

/**
 * Las voces de un acorde ya armado. `withBass`: la primera nota es el bajo
 * (seno, más fuerte). `level` escala todo el acorde.
 */
function scheduleVoicing(
  notes: number[],
  at: number,
  dur: number,
  bag: Set<Voice> | null,
  out?: AudioNode,
  global = true,
  level = 1,
  withBass = false,
): void {
  const a = ensure();
  if (!a) return;
  const { ctx, master } = a;
  notes.forEach((n, i) => {
    const bass = withBass && i === 0;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = bass ? "sine" : "triangle";
    osc.frequency.value = midiToHz(n);
    // Rasgueo: cada voz entra unos ms después de la anterior.
    const t0 = at + i * 0.018;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime((bass ? 0.5 : 0.28) * level, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.12 * level, t0 + Math.min(0.9, dur * 0.6));
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(g).connect(out ?? master);
    osc.start(t0);
    osc.stop(at + dur + 0.05);
    track(bag, { osc, gain: g }, global);
  });
}

/**
 * Una nota de MELODÍA: timbre de voz de juguete (triángulo + un poco de seno
 * una octava arriba) con ataque corto y soltada breve — las notas de un memo
 * van en legato y un ataque largo borraría los melismas, que son lo que se
 * quiere oír.
 */
function scheduleNote(
  m: number,
  at: number,
  dur: number,
  bag: Set<Voice> | null,
  level = 0.42,
  out?: AudioNode,
  global = true,
): void {
  const a = ensure();
  if (!a) return;
  const { ctx, master } = a;
  const d = Math.max(0.06, dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(level, at + 0.018);
  g.gain.setValueAtTime(level * 0.8, at + Math.max(0.02, d - 0.05));
  g.gain.exponentialRampToValueAtTime(0.0001, at + d + 0.06);
  g.connect(out ?? master);
  const body = ctx.createOscillator();
  body.type = "triangle";
  body.frequency.value = midiToHz(m);
  body.connect(g);
  body.start(at);
  body.stop(at + d + 0.08);
  track(bag, { osc: body, gain: g }, global);
  const air = ctx.createOscillator();
  const ag = ctx.createGain();
  ag.gain.value = 0.18;
  air.type = "sine";
  air.frequency.value = midiToHz(m + 12);
  air.connect(ag).connect(g);
  air.start(at);
  air.stop(at + d + 0.08);
  track(bag, { osc: air, gain: ag }, global);
}

/** Algo ya programado en el reloj de audio: `stop()` lo calla aunque no haya empezado. */
export interface ScheduledSound {
  stop: () => void;
  /** Segundo del contexto en que termina solo (para podar la lista del que lo programó). */
  end: number;
}

export interface ScheduleOpts {
  /**
   * Nodo de salida (el bus de la pista de un tema). Sin él va al master de
   * este módulo y entra a lo que `stopAllSound()` calla.
   */
  out?: AudioNode;
  /** Nivel pico 0..1. */
  level?: number;
}

/**
 * Programa UNA nota en `at` (segundos del contexto): el timbre de melodía de
 * este módulo, o un bajo (`bass`: seno + triángulo una octava arriba, sin el
 * "aire" que ensucia el grave).
 */
export function scheduleNoteAt(
  m: number,
  at: number,
  dur: number,
  opts: ScheduleOpts & { bass?: boolean } = {},
): ScheduledSound {
  const a = ensure();
  const bag = new Set<Voice>();
  if (!a) return { stop: () => {}, end: 0 };
  const global = !opts.out;
  if (!opts.bass) {
    scheduleNote(m, at, dur, bag, opts.level ?? 0.42, opts.out, global);
  } else {
    const { ctx } = a;
    const d = Math.max(0.08, dur);
    const lvl = opts.level ?? 0.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(lvl, at + 0.012);
    g.gain.exponentialRampToValueAtTime(lvl * 0.55, at + Math.min(0.35, d * 0.5));
    g.gain.setValueAtTime(lvl * 0.55, at + Math.max(0.02, d - 0.06));
    g.gain.exponentialRampToValueAtTime(0.0001, at + d + 0.04);
    g.connect(opts.out ?? a.master);
    const body = ctx.createOscillator();
    body.type = "sine";
    body.frequency.value = midiToHz(m);
    body.connect(g);
    body.start(at);
    body.stop(at + d + 0.06);
    track(bag, { osc: body, gain: g }, global);
    const edge = ctx.createOscillator();
    const eg = ctx.createGain();
    eg.gain.value = 0.22;
    edge.type = "triangle";
    edge.frequency.value = midiToHz(m + 12);
    edge.connect(eg).connect(g);
    edge.start(at);
    edge.stop(at + d + 0.06);
    track(bag, { osc: edge, gain: eg }, global);
  }
  return { stop: () => silence(bag), end: at + dur + 0.1 };
}

/**
 * Programa un ACORDE en `at`: con un `Chord` usa el voicing de este módulo
 * (bajo + posición abierta); con notas MIDI las toca tal cual (el voicing ya
 * lo decidió quien llama — p. ej. `trackEvents` de @hermes/shared).
 */
export function scheduleChordAt(
  chord: Chord | number[],
  at: number,
  dur: number,
  opts: ScheduleOpts & { octave?: number } = {},
): ScheduledSound {
  const bag = new Set<Voice>();
  if (Array.isArray(chord)) scheduleVoicing(chord, at, dur, bag, opts.out, !opts.out, opts.level);
  else scheduleChord(chord, at, dur, opts.octave ?? 3, bag, opts.out, !opts.out);
  return { stop: () => silence(bag), end: at + dur + 0.1 };
}

/** Toca un acorde ahora mismo. */
export function playChord(chord: Chord, dur = 1.4): void {
  const a = ensure();
  if (!a) return;
  scheduleChord(chord, a.ctx.currentTime + 0.01, dur);
}

/**
 * Toca UNA nota (MIDI, con decimales si hace falta) durante `dur` segundos,
 * ahora o en `at` segundos desde ahora. Devuelve stop() para callarla.
 */
export function playNote(m: number, dur = 0.5, at = 0): () => void {
  const a = ensure();
  if (!a) return () => {};
  const bag = new Set<Voice>();
  scheduleNote(m, a.ctx.currentTime + 0.01 + Math.max(0, at), dur, bag);
  return () => silence(bag);
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
  const bag = new Set<Voice>();
  let cancelled = false;

  const run = (startAt: number) => {
    chords.forEach((c, i) => {
      const at = startAt + i * secPerChord;
      scheduleChord(c, at, secPerChord * 0.98, 3, bag);
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
    silence(bag);
    opts.onStep?.(null);
    stopScheduled = null;
  };
  stopScheduled = stop;
  return stop;
}

/** Nota para `playMelody`: tiempos en segundos relativos al inicio de la melodía. */
export interface MelodyEvent {
  midi: number;
  start: number;
  /** Duración en segundos. */
  dur: number;
}

export interface MelodyPlayback {
  /** Corta el sonido en el acto (y los timers de onStep). */
  stop: () => void;
  /** Posición actual en segundos de la melodía (null si ya no suena). */
  position: () => number | null;
}

let stopMelodyScheduled: (() => void) | null = null;

/**
 * Toca una melodía (las notas de un memo, ya transpuestas si hace falta).
 * `from`/`to` recortan un tramo (una frase) y `loop` lo repite; `onStep`
 * avisa qué nota suena (índice en `notes`) para encender el piano roll, y
 * null al terminar. Una melodía nueva corta la anterior: dos a la vez no
 * sirven para nada.
 */
export function playMelody(
  notes: MelodyEvent[],
  opts: { onStep?: (i: number | null) => void; loop?: boolean; from?: number; to?: number } = {},
): MelodyPlayback {
  stopMelodyScheduled?.();
  const a = ensure();
  const from = Math.max(0, opts.from ?? 0);
  const lastEnd = notes.reduce((m, n) => Math.max(m, n.start + n.dur), 0);
  const to = Math.min(opts.to ?? lastEnd, lastEnd);
  const span = Math.max(0.05, to - from);
  const idx = notes
    .map((n, i) => ({ n, i }))
    .filter(({ n }) => n.start + n.dur > from + 0.01 && n.start < to - 0.01);
  if (!a || idx.length === 0) {
    opts.onStep?.(null);
    return { stop: () => {}, position: () => null };
  }
  const bag = new Set<Voice>();
  const timers: ReturnType<typeof setTimeout>[] = [];
  let cancelled = false;
  let loopStart = a.ctx.currentTime + 0.06;

  const run = (startAt: number) => {
    loopStart = startAt;
    for (const { n, i } of idx) {
      const s = Math.max(n.start, from);
      const e = Math.min(n.start + n.dur, to);
      const at = startAt + (s - from);
      scheduleNote(n.midi, at, e - s, bag);
      timers.push(
        setTimeout(() => !cancelled && opts.onStep?.(i), Math.max(0, (at - a.ctx.currentTime) * 1000)),
      );
    }
    const end = startAt + span;
    timers.push(
      setTimeout(() => {
        if (cancelled) return;
        if (opts.loop) run(end);
        else {
          cancelled = true;
          opts.onStep?.(null);
          stopMelodyScheduled = null;
        }
      }, Math.max(0, (end - a.ctx.currentTime) * 1000 - 20)),
    );
  };
  run(loopStart);

  const stop = () => {
    if (cancelled && bag.size === 0) return;
    cancelled = true;
    timers.forEach(clearTimeout);
    silence(bag);
    opts.onStep?.(null);
    if (stopMelodyScheduled === stop) stopMelodyScheduled = null;
  };
  stopMelodyScheduled = stop;
  return {
    stop,
    position: () => {
      if (cancelled || !ctx) return null;
      const p = ctx.currentTime - loopStart;
      return p < 0 ? from : from + Math.min(span, p);
    },
  };
}

/** Calla TODO lo que este módulo esté tocando (salir de la vista, cambiar de memo). */
export function stopAllSound(): void {
  stopScheduled?.();
  stopMelodyScheduled?.();
  silence(live);
}

/** ¿Hay soporte de audio en este navegador? */
export const audioSupported = (): boolean =>
  typeof window !== "undefined" &&
  Boolean(window.AudioContext ?? (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext);
