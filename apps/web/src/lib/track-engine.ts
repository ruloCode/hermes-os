/**
 * MOTOR DE LA PISTA de un Tema (WebAudio, sin samples): el loop de acordes de
 * una sección con su bajo, el groove sintetizado (bombo = barrido de seno;
 * caja y hat = ruido filtrado), el metrónomo y la cuenta de entrada, más los
 * buffers de voz (tomas, guía cantada) programados sobre la MISMA línea de
 * tiempo. Planificador con adelanto (setInterval de 25 ms que programa 120 ms
 * hacia adelante a partir de `trackEvents` de @hermes/shared): los temporizadores
 * de JS se atrasan, el reloj de audio no.
 *
 * Comparte el AudioContext de lib/chord-audio.ts: una sola salida, y lo que se
 * graba con lib/loop-recorder.ts vive en el mismo reloj (alineación exacta a
 * nivel de muestra).
 *
 * `play()` SIEMPRE corta lo que suena (su dueño se entera por onEnd) y arranca
 * de cero. Los cambios EN VIVO son explícitos: `update(id, opts)` sobre la
 * pasada `id` que devolvió `play()` — misma sección y mismo compás siguen en la
 * misma posición musical con el tempo, el groove, los acordes o el metrónomo
 * nuevos (el bpm se cambia sin corte); otra sección u otro compás arrancan de
 * cero. Antes el cambio en vivo era implícito dentro de `play()`, y cualquier
 * pasada ajena con la misma sección (la guía por fila, una toma) se "pegaba"
 * a la del transporte: heredaba su posición y su loop, o quedaba muda.
 *
 * SECUENCIA (`playSequence`, la usa el ensamble del Montaje): varias secciones
 * una tras otra, cada una sus `bars` compases con su loop, en UNA sola línea de
 * tiempo — el compás 1 de cada sección cae exactamente donde termina la
 * anterior, así los buffers de voz de cada parte se alinean con aritmética
 * (`starts[i]`). Es otra pasada del mismo motor: `play()` la corta como a
 * cualquier otra, y `position()` agrega en qué sección va.
 */
import {
  beatsPerBar,
  secPerStep,
  stepsPerBar,
  stepsPerBeat,
  trackEvents,
  type TemaSection,
  type TemaTrack,
  type TrackEvent,
} from "@hermes/shared";
import { audioContext, scheduleChordAt, scheduleNoteAt, type ScheduledSound } from "./chord-audio";

export type TrackBus = "pista" | "metro" | "guia" | "toma";

export interface TrackPlayOptions {
  track: TemaTrack;
  sectionId: string;
  /** Compases de cuenta de entrada (solo clic) antes del compás 1. Default 0. */
  countInBars?: number;
  /** Repetir el loop de la sección sin fin (si no, suena `section.bars` compases). */
  loop?: boolean;
  metronome?: boolean;
  groove?: boolean;
  chords?: boolean;
  /** Cada compás/tiempo que empieza (compás ≤ 0 = cuenta). Para el contador y la cuenta regresiva. */
  onBeat?: (bar: number, beat: number) => void;
  /** Cuando termina (sin loop) o se detiene. */
  onEnd?: () => void;
}

/** Una secuencia de secciones (el tema entero, o un tramo) sobre una sola línea de tiempo. */
export interface TrackSequenceOptions {
  track: TemaTrack;
  /** Ids de `track.sections` en el orden en que suenan (se pueden repetir). */
  sectionIds: string[];
  /** Compases de cuenta de entrada (solo clic) antes del compás 1 de la primera. Default 0. */
  countInBars?: number;
  /**
   * Silencio antes del compás 1 (s), SIN clic: deja entrar la anacrusa de una
   * voz sin cuenta audible. Se suma a la cuenta si también hay.
   */
  leadSec?: number;
  /** Repetir la secuencia entera sin fin. */
  loop?: boolean;
  metronome?: boolean;
  groove?: boolean;
  chords?: boolean;
  /** Cada sección que empieza: su índice en `sectionIds`. */
  onSection?: (index: number) => void;
  onEnd?: () => void;
}

export interface TrackEngine {
  /**
   * Arranca la pista DE CERO (corta lo que sonara). `startAt` = tiempo del
   * AudioContext del primer tiempo del compás 1 (después de la cuenta); `id` =
   * la pasada, para `update()`. `startAt` = 0 si no hay audio web.
   */
  play(opts: TrackPlayOptions): { startAt: number; id: number };
  /**
   * Cambio EN VIVO de la pasada `id` (solo el transporte lo usa): misma sección
   * y mismo compás → sigue en la misma posición musical con lo nuevo; otra
   * sección u otro compás → arranca de cero sin cuenta. null = esa pasada ya no
   * suena (otra la cortó): no se toca nada.
   */
  update(id: number, opts: TrackPlayOptions): { startAt: number; id: number } | null;
  /**
   * Toca varias secciones seguidas. `starts[i]` = tiempo del AudioContext del
   * compás 1 de la sección i (de la primera vuelta); `endAt` = fin de la
   * secuencia (null con loop). `startAt` = 0 si no hay audio web.
   */
  playSequence(opts: TrackSequenceOptions): { startAt: number; starts: number[]; endAt: number | null; id: number };
  stop(): void;
  playing(): boolean;
  /**
   * Posición actual (compás ≤ 0 durante la cuenta), o null si no suena. El
   * compás es local a la sección que suena; en una secuencia, `index` dice
   * cuál y `sec` cuenta desde el compás 1 de la PRIMERA.
   */
  position(): { bar: number; beat: number; sec: number; index?: number } | null;
  /** Programa un buffer (toma o guía) en un tiempo del AudioContext, por su bus. */
  scheduleBuffer(buf: AudioBuffer, atCtxTime: number, bus: Extract<TrackBus, "guia" | "toma">): AudioBufferSourceNode;
  /** Volumen por bus, 0..1. */
  setMix(mix: Partial<Record<TrackBus, number>>): void;
  mix(): Record<TrackBus, number>;
  context(): AudioContext | null;
}

const TICK_MS = 25;
const AHEAD_SEC = 0.12;
const MIX_KEY = "hermes-tema-mix";
const DEFAULT_MIX: Record<TrackBus, number> = { pista: 0.8, metro: 0.7, guia: 0.9, toma: 1 };
const BUSES: TrackBus[] = ["pista", "metro", "guia", "toma"];

/** Módulo matemático (el % de JS deja negativos negativos). */
const mod = (n: number, m: number) => ((n % m) + m) % m;

interface Playback {
  /** La pasada (lo que devuelve play y pide update). */
  id: number;
  opts: TrackPlayOptions;
  section: TemaSection;
  /** Tiempo del contexto del paso 0 (primer tiempo del compás 1 de la primera vuelta). */
  startAt: number;
  spb: number;
  barSteps: number;
  beatSteps: number;
  beats: number;
  /** Pasos de una vuelta (la sección entera). */
  cycleSteps: number;
  /** Primer paso que no se programó todavía. */
  nextStep: number;
  /** Paso final (sin loop) o null (sin fin). */
  endStep: number | null;
  /** Solo en una secuencia: cada sección con su primer paso dentro de la vuelta. */
  segments?: { section: TemaSection; start: number; steps: number }[];
  onSection?: (index: number) => void;
}

class WebAudioTrackEngine implements TrackEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buses: Partial<Record<TrackBus, GainNode>> = {};
  /** Los acordes pasan por un paso-bajo (el triángulo desnudo suena a videojuego); la batería no. */
  private pads: BiquadFilterNode | null = null;
  private noise: AudioBuffer | null = null;
  private mixState: Record<TrackBus, number> = loadMix();
  private pb: Playback | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private timeouts = new Set<ReturnType<typeof setTimeout>>();
  private sounds = new Set<ScheduledSound>();
  private seq = 0;

  context(): AudioContext | null {
    return this.ensure()?.ctx ?? null;
  }

  private ensure(): { ctx: AudioContext; master: GainNode } | null {
    const ctx = audioContext();
    if (!ctx) return null;
    if (this.ctx !== ctx || !this.master) {
      this.ctx = ctx;
      const master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(ctx.destination);
      this.master = master;
      for (const b of BUSES) {
        const g = ctx.createGain();
        g.gain.value = this.mixState[b];
        g.connect(master);
        this.buses[b] = g;
      }
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 2600;
      lp.connect(this.buses.pista!);
      this.pads = lp;
      // Un segundo de ruido blanco: la materia prima de caja y hat.
      const n = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = n.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.noise = n;
    }
    return { ctx, master: this.master };
  }

  playing(): boolean {
    return this.pb !== null;
  }

  play(opts: TrackPlayOptions): { startAt: number; id: number } {
    const a = this.ensure();
    const section = opts.track.sections.find((s) => s.id === opts.sectionId) ?? opts.track.sections[0];
    if (!a || !section) {
      // Lo que sonaba igual se corta: quien pidió tocar otra cosa no quiere la anterior encima.
      this.halt(true);
      opts.onEnd?.();
      return { startAt: 0, id: 0 };
    }
    // Lo que sonaba se corta (y su dueño se entera por onEnd).
    this.halt(true);
    return this.begin(a.ctx, opts, section, Math.max(0, Math.floor(opts.countInBars ?? 0)));
  }

  update(id: number, opts: TrackPlayOptions): { startAt: number; id: number } | null {
    const cur = this.pb;
    // La pasada ya no es la que suena (la cortó otra, o terminó): nada que actualizar.
    if (!cur || cur.id !== id || cur.segments) return null;
    const a = this.ensure();
    const section = opts.track.sections.find((s) => s.id === opts.sectionId) ?? opts.track.sections[0];
    if (!a || !section) return null;
    // Otra sección u otro compás: la posición musical no se puede conservar → de cero, sin cuenta.
    // Se compara el COMPÁS y no los pasos por compás: 3/4 y 6/8 tienen los mismos 12 pasos
    // pero otros tiempos, y "seguir" dejaría los pulsos viejos programados.
    if (cur.section.id !== section.id || cur.opts.track.meter !== opts.track.meter || !this.timer) {
      this.halt(true);
      return this.begin(a.ctx, opts, section, 0);
    }
    const meter = opts.track.meter;
    const spb = secPerStep(opts.track.bpm, meter);
    const cycleSteps = Math.max(1, section.bars) * stepsPerBar(meter);
    // El paso `nextStep` cae en el MISMO instante que antes: lo ya programado (≤120 ms)
    // suena con el tempo viejo y lo que sigue, con el nuevo.
    const tNext = cur.startAt + cur.nextStep * cur.spb;
    cur.startAt = tNext - cur.nextStep * spb;
    cur.spb = spb;
    cur.opts = opts;
    cur.section = section;
    cur.cycleSteps = cycleSteps;
    cur.endStep = opts.loop ? null : cycleSteps;
    if (cur.endStep !== null && cur.nextStep >= cur.endStep) this.finish();
    return { startAt: cur.startAt, id: cur.id };
  }

  /** Programa una pasada nueva desde la cuenta (el motor ya está callado). */
  private begin(
    ctx: AudioContext,
    opts: TrackPlayOptions,
    section: TemaSection,
    countIn: number,
  ): { startAt: number; id: number } {
    const meter = opts.track.meter;
    const spb = secPerStep(opts.track.bpm, meter);
    const barSteps = stepsPerBar(meter);
    const cycleSteps = Math.max(1, section.bars) * barSteps;
    // 100 ms de margen: el primer paso nunca cae en el pasado del reloj.
    const first = -countIn * barSteps;
    const startAt = ctx.currentTime + 0.1 - first * spb;
    const id = ++this.seq;
    this.pb = {
      id,
      opts: { ...opts, countInBars: countIn },
      section,
      startAt,
      spb,
      barSteps,
      beatSteps: stepsPerBeat(meter),
      beats: beatsPerBar(meter),
      cycleSteps,
      nextStep: first,
      endStep: opts.loop ? null : cycleSteps,
    };
    this.tick();
    this.timer = setInterval(() => this.tick(), TICK_MS);
    return { startAt, id };
  }

  playSequence(opts: TrackSequenceOptions): { startAt: number; starts: number[]; endAt: number | null; id: number } {
    const a = this.ensure();
    const sections = opts.sectionIds
      .map((id) => opts.track.sections.find((s) => s.id === id))
      .filter((s): s is TemaSection => !!s);
    if (!a || !sections.length) {
      this.halt(true);
      opts.onEnd?.();
      return { startAt: 0, starts: [], endAt: null, id: 0 };
    }
    const { ctx } = a;
    const meter = opts.track.meter;
    const spb = secPerStep(opts.track.bpm, meter);
    const barSteps = stepsPerBar(meter);
    let at = 0;
    const segments = sections.map((section) => {
      const steps = Math.max(1, section.bars) * barSteps;
      const seg = { section, start: at, steps };
      at += steps;
      return seg;
    });
    const cycleSteps = at;
    const countIn = Math.max(0, Math.floor(opts.countInBars ?? 0));
    const lead = Math.max(0, opts.leadSec ?? 0);

    this.halt(true);
    const first = -countIn * barSteps;
    const startAt = ctx.currentTime + 0.1 + lead - first * spb;
    const playOpts: TrackPlayOptions = {
      track: opts.track,
      sectionId: sections[0].id,
      countInBars: countIn,
      loop: opts.loop,
      metronome: opts.metronome,
      groove: opts.groove,
      chords: opts.chords,
      onEnd: opts.onEnd,
    };
    const id = ++this.seq;
    this.pb = {
      id,
      opts: playOpts,
      section: sections[0],
      startAt,
      spb,
      barSteps,
      beatSteps: stepsPerBeat(meter),
      beats: beatsPerBar(meter),
      cycleSteps,
      nextStep: first,
      endStep: opts.loop ? null : cycleSteps,
      segments,
      onSection: opts.onSection,
    };
    this.tick();
    this.timer = setInterval(() => this.tick(), TICK_MS);
    return {
      startAt,
      starts: segments.map((g) => startAt + g.start * spb),
      endAt: opts.loop ? null : startAt + cycleSteps * spb,
      id,
    };
  }

  stop(): void {
    this.halt(true);
  }

  /** Corta todo lo programado; `notify` = avisa onEnd al que tocaba. */
  private halt(notify: boolean): void {
    const pb = this.pb;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.timeouts.forEach(clearTimeout);
    this.timeouts.clear();
    for (const s of this.sounds) s.stop();
    this.sounds.clear();
    this.pb = null;
    if (notify) pb?.opts.onEnd?.();
  }

  /** Terminó solo (sin loop): deja sonar lo programado y avisa al llegar el final. */
  private finish(): void {
    const pb = this.pb;
    if (!pb || !this.ctx) return;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const endAt = pb.startAt + (pb.endStep ?? pb.nextStep) * pb.spb;
    const t = setTimeout(
      () => {
        this.timeouts.delete(t);
        if (this.pb !== pb) return;
        this.pb = null;
        pb.opts.onEnd?.();
      },
      Math.max(0, (endAt - this.ctx.currentTime) * 1000),
    );
    this.timeouts.add(t);
  }

  private tick(): void {
    const pb = this.pb;
    const ctx = this.ctx;
    if (!pb || !ctx) return;
    const now = ctx.currentTime;
    // Poda de lo que ya sonó (la lista no crece sin fin en un loop de horas).
    for (const s of this.sounds) if (s.end < now - 0.2) this.sounds.delete(s);

    const horizon = now + AHEAD_SEC;
    let to = Math.floor((horizon - pb.startAt) / pb.spb) + 1;
    if (pb.endStep !== null) to = Math.min(to, pb.endStep);
    if (to <= pb.nextStep) return;
    const from = pb.nextStep;
    pb.nextStep = to;

    try {
      this.scheduleRange(pb, from, to);
    } catch (e) {
      // La lógica de eventos (shared) puede no estar lista todavía: se para y se dice.
      console.warn("[track-engine] no se pudo programar la pista:", (e as Error).message);
      this.halt(true);
      return;
    }
    if (pb.endStep !== null && pb.nextStep >= pb.endStep) this.finish();
  }

  /** Programa los pasos [from, to): cuenta de entrada (negativos) y vueltas de la sección. */
  private scheduleRange(pb: Playback, from: number, to: number): void {
    const { track } = pb.opts;
    const flags = { metronome: pb.opts.metronome, groove: pb.opts.groove, chords: pb.opts.chords };
    // Cuenta de entrada: pasos negativos, tiempo relativo al compás 1.
    if (from < 0) {
      const end = Math.min(to, 0);
      for (const ev of trackEvents(track, pb.section, from, end, flags)) this.dispatch(ev, pb.startAt + ev.t);
    }
    if (pb.segments) {
      this.scheduleSegments(pb, pb.segments, Math.max(0, from), to, flags);
      return;
    }
    // La sección, vuelta por vuelta (cada vuelta pide sus pasos locales).
    let s = Math.max(0, from);
    while (s < to) {
      const k = Math.floor(s / pb.cycleSteps);
      const cycleEnd = (k + 1) * pb.cycleSteps;
      const e = Math.min(to, cycleEnd);
      const offset = pb.startAt + k * pb.cycleSteps * pb.spb;
      for (const ev of trackEvents(track, pb.section, s - k * pb.cycleSteps, e - k * pb.cycleSteps, flags))
        this.dispatch(ev, offset + ev.t);
      s = e;
    }
    // Pulsos para el contador y la cuenta regresiva.
    if (pb.opts.onBeat) {
      for (let st = from; st < to; st++) {
        if (mod(st, pb.beatSteps) !== 0) continue;
        const { bar, beat } = this.barBeat(pb, st);
        const at = pb.startAt + st * pb.spb;
        const cb = pb.opts.onBeat;
        const t = setTimeout(
          () => {
            this.timeouts.delete(t);
            if (this.pb === pb) cb(bar, beat);
          },
          Math.max(0, (at - (this.ctx?.currentTime ?? at)) * 1000),
        );
        this.timeouts.add(t);
      }
    }
  }

  /**
   * Secuencia: los pasos [from, to) (≥ 0) repartidos entre las secciones, vuelta
   * por vuelta. Cada sección pide sus pasos LOCALES (su compás 1 = paso 0) y sus
   * sonidos se cortan en su borde: el acorde largo de una sección no se monta
   * sobre la siguiente.
   */
  private scheduleSegments(
    pb: Playback,
    segments: NonNullable<Playback["segments"]>,
    from: number,
    to: number,
    flags: { metronome?: boolean; groove?: boolean; chords?: boolean },
  ): void {
    const { track } = pb.opts;
    let s = from;
    while (s < to) {
      const k = Math.floor(s / pb.cycleSteps);
      const local = s - k * pb.cycleSteps;
      const j = segments.findIndex((g) => local >= g.start && local < g.start + g.steps);
      if (j < 0) break;
      const seg = segments[j];
      const segStart = k * pb.cycleSteps + seg.start;
      const e = Math.min(to, segStart + seg.steps);
      const offset = pb.startAt + segStart * pb.spb;
      const until = offset + seg.steps * pb.spb;
      if (s === segStart && pb.onSection) {
        const cb = pb.onSection;
        const t = setTimeout(
          () => {
            this.timeouts.delete(t);
            if (this.pb === pb) cb(j);
          },
          Math.max(0, (offset - (this.ctx?.currentTime ?? offset)) * 1000),
        );
        this.timeouts.add(t);
      }
      for (const ev of trackEvents(track, seg.section, s - segStart, e - segStart, flags))
        this.dispatch(ev, offset + ev.t, until);
      s = e;
    }
  }

  /** La sección de la secuencia que suena en el paso `st` (≥ 0) y su primer paso absoluto. */
  private segmentAt(pb: Playback, st: number): { index: number; start: number } | null {
    if (!pb.segments) return null;
    const k = Math.floor(st / pb.cycleSteps);
    const local = st - k * pb.cycleSteps;
    const j = pb.segments.findIndex((g) => local >= g.start && local < g.start + g.steps);
    const seg = pb.segments[j < 0 ? pb.segments.length - 1 : j];
    return { index: j < 0 ? pb.segments.length - 1 : j, start: k * pb.cycleSteps + seg.start };
  }

  /** Compás (1-based en la vuelta, o en su sección si es una secuencia; ≤0 en la cuenta) y tiempo (1-based). */
  private barBeat(pb: Playback, st: number): { bar: number; beat: number } {
    const inBar = mod(st, pb.barSteps);
    const beat = Math.floor(inBar / pb.beatSteps) + 1;
    if (st < 0) return { bar: Math.floor(st / pb.barSteps) + 1, beat };
    const seg = this.segmentAt(pb, st);
    if (seg) return { bar: Math.floor((st - seg.start) / pb.barSteps) + 1, beat };
    const local = pb.endStep === null ? st % pb.cycleSteps : st;
    return { bar: Math.floor(local / pb.barSteps) + 1, beat };
  }

  /** `until`: tiempo del contexto donde el sonido tiene que terminar (el borde de su sección). */
  private dispatch(ev: TrackEvent, at: number, until?: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    // Un evento atrasado (el hilo se trabó) entra ya, no en el pasado.
    const t = Math.max(at, ctx.currentTime + 0.005);
    const late = t - at;
    const dur = Math.max(0.05, Math.min(ev.dur - late, until != null ? until - t : Infinity));
    let s: ScheduledSound | null = null;
    switch (ev.kind) {
      case "chord":
        if (ev.midi?.length) s = scheduleChordAt(ev.midi, t, dur, { out: this.pads!, level: 0.75 });
        break;
      case "bass":
        if (ev.midi?.length) s = scheduleNoteAt(ev.midi[0], t, dur, { out: this.buses.pista!, bass: true, level: 0.42 });
        break;
      case "kick":
        s = this.kick(t);
        break;
      case "snare":
        s = this.snare(t);
        break;
      case "hat":
        s = this.hat(t, ev.accent);
        break;
      case "click":
        s = this.click(t, !!ev.accent);
        break;
    }
    if (s) this.sounds.add(s);
  }

  // ─────────── Batería sintetizada (sin samples) ───────────

  /** Envolvente de percusión: ataque de 3 ms y caída exponencial. */
  private env(at: number, peak: number, decay: number, out: AudioNode): GainNode {
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(peak, at + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    g.connect(out);
    return g;
  }

  private stopper(nodes: AudioScheduledSourceNode[], gains: GainNode[], end: number): ScheduledSound {
    return {
      end,
      stop: () => {
        const now = this.ctx?.currentTime ?? 0;
        for (const g of gains) {
          try {
            g.gain.cancelScheduledValues(now);
            g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), now);
            g.gain.exponentialRampToValueAtTime(0.0001, now + 0.012);
          } catch {
            /* ya terminó */
          }
        }
        for (const n of nodes) {
          try {
            n.stop(now + 0.015);
          } catch {
            /* ya paró */
          }
        }
      },
    };
  }

  /** Bombo: seno con barrido de 150 a 45 Hz. */
  private kick(at: number): ScheduledSound {
    const ctx = this.ctx!;
    const g = this.env(at, 0.95, 0.42, this.buses.pista!);
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(150, at);
    o.frequency.exponentialRampToValueAtTime(45, at + 0.13);
    o.connect(g);
    o.start(at);
    o.stop(at + 0.45);
    return this.stopper([o], [g], at + 0.45);
  }

  /** Caja: ruido en banda media + un cuerpo corto de triángulo. */
  private snare(at: number): ScheduledSound {
    const ctx = this.ctx!;
    const g = this.env(at, 0.5, 0.2, this.buses.pista!);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1900;
    bp.Q.value = 0.7;
    src.connect(bp).connect(g);
    src.start(at, Math.random() * 0.5);
    src.stop(at + 0.22);
    const bg = this.env(at, 0.3, 0.1, this.buses.pista!);
    const body = ctx.createOscillator();
    body.type = "triangle";
    body.frequency.setValueAtTime(200, at);
    body.frequency.exponentialRampToValueAtTime(150, at + 0.08);
    body.connect(bg);
    body.start(at);
    body.stop(at + 0.12);
    return this.stopper([src, body], [g, bg], at + 0.22);
  }

  /** Hat: ruido por un paso-alto, muy corto (el acento, un poco más abierto). */
  private hat(at: number, accent?: boolean): ScheduledSound {
    const ctx = this.ctx!;
    const decay = accent ? 0.09 : 0.045;
    const g = this.env(at, accent ? 0.2 : 0.14, decay, this.buses.pista!);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 7000;
    src.connect(hp).connect(g);
    src.start(at, Math.random() * 0.5);
    src.stop(at + decay + 0.01);
    return this.stopper([src], [g], at + decay + 0.01);
  }

  /** Clic del metrónomo: el primer tiempo más agudo. */
  private click(at: number, accent: boolean): ScheduledSound {
    const ctx = this.ctx!;
    const g = this.env(at, accent ? 0.55 : 0.38, 0.035, this.buses.metro!);
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.value = accent ? 1760 : 1320;
    o.connect(g);
    o.start(at);
    o.stop(at + 0.04);
    return this.stopper([o], [g], at + 0.04);
  }

  // ─────────── Posición, buffers y mezcla ───────────

  position(): { bar: number; beat: number; sec: number; index?: number } | null {
    const pb = this.pb;
    const ctx = this.ctx;
    if (!pb || !ctx) return null;
    const rel = ctx.currentTime - pb.startAt;
    const st = Math.floor(rel / pb.spb);
    const { bar, beat } = this.barBeat(pb, st);
    const cycleSec = pb.cycleSteps * pb.spb;
    const sec = rel < 0 || pb.endStep !== null ? rel : rel % cycleSec;
    if (!pb.segments) return { bar, beat, sec };
    return { bar, beat, sec, index: st < 0 ? 0 : (this.segmentAt(pb, st)?.index ?? 0) };
  }

  scheduleBuffer(buf: AudioBuffer, atCtxTime: number, bus: Extract<TrackBus, "guia" | "toma">): AudioBufferSourceNode {
    const a = this.ensure();
    if (!a) throw new Error("Este navegador no tiene audio web");
    const { ctx } = a;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = 1;
    src.connect(g).connect(this.buses[bus]!);
    const now = ctx.currentTime;
    // Si el momento ya pasó (se programó tarde), entra ahora desde donde va.
    if (atCtxTime >= now) src.start(atCtxTime);
    else if (now - atCtxTime < buf.duration) src.start(now, now - atCtxTime);
    const end = Math.max(now, atCtxTime) + buf.duration;
    const s = this.stopper([src], [g], end);
    this.sounds.add(s);
    // addEventListener y no `onended`: quien recibe el nodo suele poner su propio onended.
    src.addEventListener("ended", () => {
      this.sounds.delete(s);
      try {
        g.disconnect();
      } catch {
        /* ya desconectado */
      }
    });
    return src;
  }

  setMix(mix: Partial<Record<TrackBus, number>>): void {
    for (const b of BUSES) {
      const v = mix[b];
      if (v == null || !Number.isFinite(v)) continue;
      this.mixState[b] = Math.max(0, Math.min(1, v));
      const node = this.buses[b];
      if (node && this.ctx) node.gain.setTargetAtTime(this.mixState[b], this.ctx.currentTime, 0.02);
    }
    try {
      localStorage.setItem(MIX_KEY, JSON.stringify(this.mixState));
    } catch {
      /* sin almacenamiento: la mezcla vive hasta recargar */
    }
  }

  mix(): Record<TrackBus, number> {
    return { ...this.mixState };
  }
}

function loadMix(): Record<TrackBus, number> {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(MIX_KEY) : null;
    if (raw) {
      const m = JSON.parse(raw) as Partial<Record<TrackBus, number>>;
      const out = { ...DEFAULT_MIX };
      for (const b of BUSES) if (typeof m[b] === "number" && m[b]! >= 0 && m[b]! <= 1) out[b] = m[b]!;
      return out;
    }
  } catch {
    /* almacenamiento bloqueado o corrupto: mezcla por defecto */
  }
  return { ...DEFAULT_MIX };
}

let engine: WebAudioTrackEngine | null = null;

/** El motor único del dashboard (perezoso: el AudioContext nace en el primer gesto). */
export function getTrackEngine(): TrackEngine {
  if (!engine) engine = new WebAudioTrackEngine();
  return engine;
}
