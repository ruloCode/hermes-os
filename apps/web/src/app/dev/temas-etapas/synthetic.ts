/**
 * Datos SINTÉTICOS para /dev/temas: un tema inventado ("Tema de prueba", La
 * menor, 92 bpm) con un tarareo de relleno ("na / uh / dun") escrito a mano,
 * leído en la rejilla con el `analyzeOnGrid` REAL de @hermes/shared (así la
 * forma de GridAnalysis es la de verdad, no una copia a mano). El audio de las
 * tomas es un seno por nota. El repo es público: aquí no hay material real.
 */
import type {
  ChordBar,
  ComposeSession,
  GridAnalysis,
  Key,
  MelodyNote,
  PassageAnalysis,
  Phrase,
  PitchTrack,
  SungSyllable,
  TakeMeta,
  Tema,
  TemaCandidate,
  Vowel,
} from "@hermes/shared";
import { analyzeOnGrid, encodeWav16, secPerStep, stepsPerBar } from "@hermes/shared";

export const KEY: Key = { tonic: 9, mode: "minor" };
export const BPM = 92;
export const BARS = 8;
export const SECTION_ID = "sec-coro";
export const LOOP: ChordBar[] = [
  { chords: [{ symbol: "Am", beat: 0 }] },
  { chords: [{ symbol: "F", beat: 0 }] },
  { chords: [{ symbol: "C", beat: 0 }] },
  { chords: [{ symbol: "G", beat: 0 }, { symbol: "E", beat: 2 }] },
];
export const DOWNBEAT = 1.2;
const SR = 22050;

export function syntheticTema(now: string): Tema {
  return {
    id: "tema-prueba",
    title: "Tema de prueba",
    createdAt: now,
    updatedAt: now,
    stage: "grabar",
    intent: {
      about: "Un coro corto de pregunta y respuesta",
      convey: "Ganas de volver a empezar",
      genre: "pop-urbano",
    },
    track: {
      key: KEY,
      bpm: BPM,
      meter: "4/4",
      groove: "dembow",
      bpmSource: "manual",
      keySource: "manual",
      sections: [
        { id: SECTION_ID, kind: "coro", label: "Coro", loop: LOOP, bars: BARS },
        { id: "sec-verso", kind: "verso", label: "Verso", loop: LOOP.slice(0, 2), bars: 4 },
      ],
    },
    montage: [],
  };
}

/** [paso absoluto, largo en semicorcheas, MIDI, sílaba] — una fila por nota. */
type N = [number, number, number, string];
/** Frases: cada sílaba agrupa 1+ notas (2+ = melisma). */
const PHRASES: N[][][] = [
  [
    [[-4, 2, 64, "na"]],
    [[-2, 2, 67, "na"]],
    [
      [0, 2, 69, "uh"],
      [2, 2, 71, "uh"],
      [4, 4, 69, "uh"],
    ],
    [[8, 2, 72, "dun"]],
    [[10, 2, 71, "dun"]],
    [[12, 4, 69, "na"]],
    [[16, 2, 69, "na"]],
    [[18, 4, 72, "na"]],
    [[22, 2, 74, "a"]],
    [
      [24, 2, 72, "a"],
      [26, 2, 69, "a"],
    ],
    [[28, 4, 65, "dun"]],
    [[32, 2, 67, "na"]],
    [[34, 2, 67, "na"]],
    [[36, 2, 64, "na"]],
    [[38, 2, 68, "na"]],
    [[40, 4, 69, "dun"]],
    [[44, 2, 64, "dun"]],
    [[46, 2, 71, "dun"]],
    [[48, 6, 71, "uh"]],
  ],
  [
    [[60, 2, 64, "na"]],
    [[62, 2, 69, "na"]],
    [
      [64, 2, 72, "uh"],
      [66, 2, 74, "uh"],
      [68, 4, 76, "uh"],
    ],
    [[72, 2, 74, "na"]],
    [[74, 2, 72, "na"]],
    [[76, 4, 69, "mm"]],
    [[80, 2, 69, "dun"]],
    [[82, 2, 72, "dun"]],
    [[84, 4, 77, "a"]],
    [[88, 2, 76, "a"]],
    [[90, 2, 74, "na"]],
    [[92, 4, 72, "na"]],
    [
      [96, 2, 76, "uh"],
      [98, 2, 74, "uh"],
      [100, 4, 72, "uh"],
    ],
    [[104, 2, 71, "na"]],
    [[106, 2, 72, "na"]],
    [[108, 4, 74, "na"]],
    [[112, 4, 71, "dun"]],
    [[116, 2, 69, "dun"]],
    [[118, 10, 67, "uh"]],
  ],
];

const VOWEL: Record<string, Vowel | undefined> = { na: "a", uh: "u", dun: "u", a: "a" };

/** Desvío determinista por nota (ms): humano, no aleatorio entre recargas. */
const jitter = (k: number) => (((k * 37) % 23) - 11) * 1.1;

export interface SynthTake {
  notes: MelodyNote[];
  phrases: Phrase[];
  track: PitchTrack;
  durationSec: number;
}

/** El tarareo: notas en segundos del audio de la toma, con `lateMs` de retraso parejo. */
export function synthTake(lateMs: number): SynthTake {
  const sps = secPerStep(BPM, "4/4");
  const notes: MelodyNote[] = [];
  const phrases: Phrase[] = [];
  let k = 0;
  let word = 0;
  PHRASES.forEach((ph, pIdx) => {
    const syllables: SungSyllable[] = [];
    for (const syl of ph) {
      const idx: number[] = [];
      for (const [step, len, midi] of syl) {
        const start = DOWNBEAT + step * sps + (lateMs + jitter(k)) / 1000;
        // Una nota dudosa a propósito (entre dos semitonos): se dibuja punteada con "?".
        const cents = step === 40 ? 36 : ((k * 13) % 17) - 8;
        notes.push({ midi, start, end: start + len * sps - 0.02, cents });
        idx.push(notes.length - 1);
        k++;
      }
      const first = notes[idx[0]];
      const last = notes[idx[idx.length - 1]];
      const text = syl[0][3];
      const longest = idx.reduce((a, b) => (notes[b].end - notes[b].start > notes[a].end - notes[a].start ? b : a));
      const v = VOWEL[text];
      syllables.push({
        text,
        start: first.start,
        end: last.end,
        noteIdx: idx,
        midi: notes[longest].midi,
        stressed: syl[0][1] >= 4 || idx.length > 1,
        filler: true,
        melisma: idx.length > 1,
        word: word++,
        ...(idx.length > 1 ? { parts: idx.map((i) => ({ midi: notes[i].midi, start: notes[i].start, end: notes[i].end })) } : {}),
        // "mm" queda SIN vocal: así se ve el caso real de una vocal que no se pudo leer.
        ...(v ? { vowel: v, vowelSource: "texto" as const } : {}),
      });
    }
    phrases.push({
      idx: pIdx,
      start: syllables[0].start,
      end: syllables[syllables.length - 1].end,
      text: syllables.map((s) => s.text).join(" "),
      syllables,
      mold: {
        syllables: syllables.length,
        stresses: syllables.map((s, i) => (s.stressed ? i + 1 : 0)).filter(Boolean),
        ending: "llana",
        melismas: syllables
          .map((s, i) => (s.melisma ? { pos: i + 1, notes: s.noteIdx.length, dur: s.end - s.start } : null))
          .filter((x): x is { pos: number; notes: number; dur: number } => !!x),
        long: syllables.map((s, i) => (s.end - s.start >= 0.6 ? i + 1 : 0)).filter(Boolean),
      },
    });
  });

  const durationSec = DOWNBEAT + BARS * stepsPerBar("4/4") * sps + 0.7;
  const hopSec = 0.01;
  const frames = Math.ceil(durationSec / hopSec);
  const f0 = new Float32Array(frames);
  const midi = new Float32Array(frames).fill(NaN);
  const rmsDb = new Float32Array(frames).fill(-60);
  for (const n of notes) {
    // Dinámica: arco por frase (entra suave, crece hacia el medio, cierra un poco).
    const phraseT = n.start < DOWNBEAT + 64 * sps ? (n.start - DOWNBEAT) / (60 * sps) : (n.start - DOWNBEAT - 60 * sps) / (68 * sps);
    const db = -22 + 20 * Math.sin(Math.PI * Math.max(0, Math.min(1, phraseT))) + ((n.midi * 7) % 5) - 2;
    for (let f = Math.floor(n.start / hopSec); f < Math.min(frames, Math.ceil(n.end / hopSec)); f++) {
      midi[f] = n.midi + n.cents / 100;
      f0[f] = 440 * Math.pow(2, (midi[f] - 69) / 12);
      rmsDb[f] = db;
    }
  }
  return { notes, phrases, track: { sr: 16000, hop: 160, hopSec, f0, midi, rmsDb }, durationSec };
}

/** El audio de la toma: un triángulo suave por nota (para oírla sobre la pista). */
export function synthPcm(t: SynthTake, sr = SR): Float32Array {
  const pcm = new Float32Array(Math.ceil(t.durationSec * sr));
  for (const n of t.notes) {
    const hz = 440 * Math.pow(2, (n.midi - 69) / 12);
    const a = Math.floor(n.start * sr);
    const b = Math.min(pcm.length, Math.floor(n.end * sr));
    for (let i = a; i < b; i++) {
      const tt = (i - a) / sr;
      const env = Math.min(1, tt / 0.02) * Math.min(1, (b - i) / sr / 0.03);
      const ph = (tt * hz) % 1;
      pcm[i] += 0.32 * env * (4 * Math.abs(ph - 0.5) - 1);
    }
  }
  return pcm;
}

export function wavUrl(pcm: Float32Array, sr = SR): string {
  const bytes = encodeWav16(pcm, sr);
  return URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "audio/wav" }));
}

export function peaksOfPcm(pcm: Float32Array, buckets = 160): number[] {
  const size = Math.max(1, Math.floor(pcm.length / buckets));
  const out: number[] = [];
  for (let i = 0; i < buckets; i++) {
    let p = 0;
    for (let j = i * size; j < Math.min(pcm.length, (i + 1) * size); j++) p = Math.max(p, Math.abs(pcm[j]));
    out.push(p);
  }
  return out;
}

export function takeMeta(n: number, latencyMs: number, favorite: boolean): TakeMeta {
  return {
    temaId: "tema-prueba",
    sectionId: SECTION_ID,
    n,
    grid: { bpm: BPM, meter: "4/4", key: KEY, downbeatSec: DOWNBEAT, loop: LOOP, bars: BARS },
    latency: { ms: latencyMs, source: "medida" },
    monitor: "audifonos",
    stt: false,
    hint: "na na uh dun",
    favorite,
    cycle: n,
  };
}

export function syntheticSession(sid: string, meta: TakeMeta, durationSec: number, now: string): ComposeSession {
  return {
    id: sid,
    title: `Toma ${meta.n}`,
    createdAt: now,
    updatedAt: now,
    source: { path: "(sintético)", name: `toma-${meta.n}.wav`, bytes: 0, kind: "microfono" },
    mediaDir: "(sintético)",
    mediaRoot: "local",
    files: { audio: "crudos/toma.wav" },
    durationSec,
    language: "es",
    status: "lista",
    stages: [],
    speakers: [],
    passages: [
      {
        id: "P01",
        label: "P01",
        start: 0,
        end: durationSec,
        text: "",
        kind: "silabas",
        confidence: 1,
        group: "probable",
        evidence: [],
        origin: "auto",
        status: "listo",
      },
    ],
    take: meta,
  };
}

/** Análisis de P01 leído con el `analyzeOnGrid` real. `emptyNotes` = el caso "no hay notas claras". */
export function syntheticAnalysis(
  sid: string,
  t: SynthTake,
  pcm: Float32Array,
  opts: { emptyNotes?: boolean; downbeatSec?: number } = {},
): PassageAnalysis {
  const grid: GridAnalysis = analyzeOnGrid({
    notes: t.notes,
    phrases: t.phrases,
    track: t.track,
    grid: { bpm: BPM, meter: "4/4", key: KEY, downbeatSec: opts.downbeatSec ?? DOWNBEAT, loop: LOOP, bars: BARS },
  });
  const f0: (number | null)[] = Array.from(t.track.midi, (m) => (Number.isNaN(m) ? null : m));
  const midis = t.notes.map((n) => n.midi);
  return {
    sessionId: sid,
    passageId: "P01",
    version: 1,
    analyzedAt: new Date().toISOString(),
    source: "voz",
    tuningCents: 0,
    hop: t.track.hopSec,
    f0,
    peaks: peaksOfPcm(pcm, 400),
    notes: opts.emptyNotes ? [] : t.notes,
    phrases: opts.emptyNotes ? [] : t.phrases,
    key: { best: { key: KEY, score: 0.82 }, candidates: [{ key: KEY, score: 0.82 }], confidence: 0.41, source: "voz" },
    range: { lo: Math.min(...midis), hi: Math.max(...midis) },
    files: { mix: "analisis/P01/mezcla.wav", voice: "analisis/P01/voz.wav" },
    grid: opts.emptyNotes ? { ...grid, notes: [], phrases: [], readout: [], suggestShiftMs: null } : grid,
  };
}

export function candidate(
  sid: string,
  n: number,
  status: TemaCandidate["status"],
  favorite: boolean,
  durationSec: number,
  recordedAt: string,
): TemaCandidate {
  return {
    memo: { sessionId: sid, passageId: "P01" },
    kind: "toma",
    label: `Toma ${n}`,
    sectionId: SECTION_ID,
    favorite,
    status,
    onGrid: true,
    recordedAt,
    durationSec,
    ...(status === "listo" ? { syllables: 38, melismas: 5 } : {}),
    lyrics: { versions: 0, mine: 0 },
  };
}
