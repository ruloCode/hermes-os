/**
 * El AUDIO de las tomas de un tema, compartido por Grabar y Análisis:
 *
 *  - Escuchar una toma SOBRE SU PISTA: la que sonaba cuando se grabó (tempo,
 *    compás y loop de su rejilla), no la de hoy — si después cambiaste el bpm,
 *    la toma igual suena en su sitio. La voz se programa en el mismo reloj que
 *    la pista (`engine.scheduleBuffer`), alineada por `grid.downbeatSec`.
 *  - Las tomas que no se pudieron subir: viven EN MEMORIA (módulo, no estado de
 *    React) para que cambiar de etapa no las tire; "guardada solo en este
 *    navegador · Reintentar" es literal.
 *  - Cachés: el audio decodificado por toma (el WAV de una toma no cambia
 *    nunca; corregir la latencia solo mueve su rejilla) y la onda local de lo
 *    recién grabado (mientras el agente la procesa, la toma ya se ve).
 */
import { useMemo, useSyncExternalStore } from "react";
import type { ChordBar, ComposeSession, Meter, TakeGrid, TakeMeta, TemaSection, TemaTrack } from "@hermes/shared";
import { beatsPerBar } from "@hermes/shared";
import type { TrackEngine } from "@/lib/track-engine";
import type { PlaygroundApi } from "../playground/api";

/** Segundos por compás (en 6/8 el bpm es de negras con puntillo: 2 pulsos). */
export const barSecOf = (bpm: number, meter: Meter): number => (beatsPerBar(meter) * 60) / bpm;

/** El pasaje único de una toma. */
export const TAKE_PASSAGE = "P01";

/** Pico absoluto de un tramo. */
export function peakOf(pcm: Float32Array): number {
  let p = 0;
  for (let i = 0; i < pcm.length; i++) {
    const a = pcm[i] < 0 ? -pcm[i] : pcm[i];
    if (a > p) p = a;
  }
  return p;
}

/** Picos por cubeta (0..1, SIN normalizar: una toma bajita se ve bajita — es un dato). */
export function peaksOf(pcm: Float32Array, buckets = 160): number[] {
  const size = Math.max(1, Math.floor(pcm.length / buckets));
  const out: number[] = [];
  for (let i = 0; i < buckets && i * size < pcm.length; i++) out.push(peakOf(pcm.subarray(i * size, (i + 1) * size)));
  return out;
}

// ─────────────────────────── Escuchar una toma ───────────────────────────

const rotate = <T,>(xs: T[], k: number): T[] => (xs.length ? [...xs.slice(k % xs.length), ...xs.slice(0, k % xs.length)] : xs);

/** La pista con la que se grabó la toma: su tempo, compás y loop — no los de hoy. */
export function trackOfTake(base: TemaTrack, sectionId: string, grid: TakeGrid, loop: ChordBar[] = grid.loop, bars = grid.bars): TemaTrack {
  const sec = base.sections.find((s) => s.id === sectionId);
  const section: TemaSection = {
    ...(sec ?? { id: sectionId, kind: "coro", label: "Toma" }),
    loop,
    bars: Math.max(1, bars),
  };
  return { ...base, key: grid.key, bpm: grid.bpm, meter: grid.meter, swing: grid.swing, sections: [section] };
}

/** Copia un AudioBuffer desde `fromSec` (el motor programa buffers enteros). */
function sliceFrom(ac: AudioContext, buf: AudioBuffer, fromSec: number): AudioBuffer {
  const a = Math.max(0, Math.min(buf.length - 1, Math.floor(fromSec * buf.sampleRate)));
  if (a === 0) return buf;
  const out = ac.createBuffer(buf.numberOfChannels, buf.length - a, buf.sampleRate);
  for (let c = 0; c < buf.numberOfChannels; c++) out.copyToChannel(buf.getChannelData(c).subarray(a), c);
  return out;
}

export interface TakePlayback {
  stop(): void;
  /** Segundo DEL AUDIO de la toma que suena ahora; null durante la cuenta de entrada o al terminar. */
  position(): number | null;
}

/**
 * Toca una toma. Con la pista: arranca el motor EN EL COMPÁS de `fromSec` (el
 * loop rotado para que ese compás sea el 1), con la cuenta mínima que deje
 * entrar la anacrusa, y la voz recortada desde `fromSec` cae en su sitio. Sin
 * la pista: solo la voz, desde ya.
 */
export function playTake(
  engine: TrackEngine,
  opts: {
    base: TemaTrack;
    sectionId: string;
    grid: TakeGrid;
    buffer: AudioBuffer;
    fromSec?: number;
    withTrack: boolean;
    onEnd?: () => void;
  },
): TakePlayback | null {
  const ac = engine.context();
  if (!ac) return null;
  const { grid, buffer } = opts;
  const from = Math.max(0, Math.min(buffer.duration - 0.02, opts.fromSec ?? 0));
  const voice = sliceFrom(ac, buffer, from);
  let ended = false;
  let src: AudioBufferSourceNode | null = null;
  let voiceAt = 0;
  const done = () => {
    if (ended) return;
    ended = true;
    opts.onEnd?.();
  };

  if (!opts.withTrack) {
    engine.stop();
    voiceAt = ac.currentTime + 0.03;
    src = engine.scheduleBuffer(voice, voiceAt, "toma");
    src.onended = done;
    return {
      stop: () => {
        try {
          src?.stop();
        } catch {
          /* ya paró */
        }
        done();
      },
      position: () => (ended ? null : Math.min(buffer.duration, from + Math.max(0, ac.currentTime - voiceAt))),
    };
  }

  const bar = barSecOf(grid.bpm, grid.meter);
  const rel = from - grid.downbeatSec;
  const fromBar = rel < 0 ? 1 : Math.floor(rel / bar) + 1;
  const barStart = grid.downbeatSec + (fromBar - 1) * bar;
  // Voz que entra ANTES del compás (la anacrusa): la cuenta tiene que alcanzar a cubrirla.
  const lead = Math.max(0, barStart - from);
  const countIn = Math.max(1, Math.ceil((lead + 0.05) / bar));
  const loop = rotate(grid.loop, fromBar - 1);
  const bars = Math.max(1, grid.bars - (fromBar - 1));
  const track = trackOfTake(opts.base, opts.sectionId, grid, loop, bars);
  const sectionId = track.sections[0].id;
  let trackEnd = Infinity;
  let voiceDone = false;
  let trackDone = false;

  const { startAt } = engine.play({
    track,
    sectionId,
    countInBars: countIn,
    loop: false,
    metronome: false,
    onEnd: () => {
      trackDone = true;
      // Fin natural de la pista: la cola de la última sílaba (≤ 1 tiempo) sigue sonando.
      if (!voiceDone && src && ac.currentTime >= trackEnd - 0.08) return;
      // Cortada (otra etapa tocó la pista, o se detuvo): la voz se calla con ella.
      try {
        src?.stop();
      } catch {
        /* ya paró */
      }
      done();
    },
  });
  if (!startAt) {
    done();
    return null;
  }
  trackEnd = startAt + bars * bar;
  voiceAt = startAt - lead;
  src = engine.scheduleBuffer(voice, voiceAt, "toma");
  src.onended = () => {
    voiceDone = true;
    // La voz terminó antes que la pista: se sigue oyendo la pista hasta su final.
    if (!trackDone && engine.playing() && ac.currentTime < trackEnd - 0.08) return;
    done();
  };
  return {
    stop: () => {
      ended = true;
      engine.stop();
      try {
        src?.stop();
      } catch {
        /* ya paró */
      }
      opts.onEnd?.();
    },
    position: () => {
      if (ended) return null;
      const p = ac.currentTime - voiceAt;
      return p < 0 ? null : Math.min(buffer.duration, from + p);
    },
  };
}

// ─────────────────────────── Cargar una toma ───────────────────────────

const buffers = new Map<string, AudioBuffer>();

export function primeTakeBuffer(sid: string, buf: AudioBuffer): void {
  buffers.set(sid, buf);
}

/** La sesión de la toma (su rejilla y latencia al día) + su audio decodificado (en caché). */
export async function loadTakeAudio(
  api: PlaygroundApi,
  ac: AudioContext,
  sid: string,
): Promise<{ session: ComposeSession & { take: TakeMeta }; buffer: AudioBuffer }> {
  const session = await api.getSession(sid);
  if (!session.take) throw new Error("Esta sesión no es una toma de un tema.");
  let buffer = buffers.get(sid);
  if (!buffer) {
    const rel = session.files.audio ?? session.files.original;
    if (!rel) throw new Error("El agente todavía no tiene el audio de esta toma.");
    const url = api.fileUrl(sid, rel);
    if (!url) throw new Error("El audio de esta toma no está disponible aquí.");
    let res: Response;
    try {
      res = await fetch(url);
    } catch {
      throw new Error("El agente no responde: no se pudo leer el audio de la toma.");
    }
    if (!res.ok) throw new Error(`No se pudo leer el audio de la toma (${res.status}).`);
    try {
      buffer = await ac.decodeAudioData(await res.arrayBuffer());
    } catch {
      // El mensaje del navegador llega en inglés y no dice nada útil.
      throw new Error("El audio de la toma no se pudo decodificar (archivo incompleto o en un formato que el navegador no lee).");
    }
    buffers.set(sid, buffer);
  }
  return { session: session as ComposeSession & { take: TakeMeta }, buffer };
}

// ─────────────────────────── Tomas sin subir ───────────────────────────

export interface PendingTake {
  key: string;
  temaId: string;
  sectionId: string;
  cycle: number;
  wav: Blob;
  meta: Omit<TakeMeta, "n">;
  peaks: number[];
  durationSec: number;
  buffer: AudioBuffer | null;
  state: "subiendo" | "error";
  error?: string;
}

let pending: PendingTake[] = [];
const listeners = new Set<() => void>();
const EMPTY: PendingTake[] = [];
const emit = () => listeners.forEach((f) => f());

export const pendingTakes = {
  list: (): PendingTake[] => pending,
  add(p: PendingTake) {
    pending = [...pending, p];
    emit();
  },
  update(key: string, patch: Partial<PendingTake>) {
    pending = pending.map((p) => (p.key === key ? { ...p, ...patch } : p));
    emit();
  },
  remove(key: string) {
    pending = pending.filter((p) => p.key !== key);
    emit();
  },
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};

export function usePendingTakes(temaId: string, sectionId: string): PendingTake[] {
  const all = useSyncExternalStore(pendingTakes.subscribe, pendingTakes.list, () => EMPTY);
  return useMemo(() => all.filter((p) => p.temaId === temaId && p.sectionId === sectionId), [all, temaId, sectionId]);
}

/** Onda local de lo recién subido (el agente tarda en tener la suya). */
export const localPeaks = new Map<string, { peaks: number[]; durationSec: number }>();

/**
 * Sube una toma pendiente. Si falla, se queda en memoria con el motivo; si
 * sale, deja su onda y su audio en caché con el id que asignó el agente.
 */
export async function uploadPending(
  p: PendingTake,
  upload: (input: { wav: Blob; meta: Omit<TakeMeta, "n"> }) => Promise<ComposeSession>,
): Promise<ComposeSession | null> {
  pendingTakes.update(p.key, { state: "subiendo", error: undefined });
  try {
    const s = await upload({ wav: p.wav, meta: p.meta });
    pendingTakes.remove(p.key);
    localPeaks.set(s.id, { peaks: p.peaks, durationSec: p.durationSec });
    if (p.buffer) buffers.set(s.id, p.buffer);
    return s;
  } catch (e) {
    pendingTakes.update(p.key, { state: "error", error: (e as Error).message || "no se pudo subir" });
    return null;
  }
}
