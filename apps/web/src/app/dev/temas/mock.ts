/**
 * Datos SINTÉTICOS para /dev/temas: temas, tomas, análisis y letras
 * inventados para revisar la UI sin agente. Nada de aquí sale de una sesión
 * real (el repo es público): los textos son genéricos y la "voz" es una
 * melodía de juguete calculada aquí mismo.
 */
import {
  analyzeOnGrid,
  encodeWav16,
  lineFit,
  newTema,
  phraseMold,
  temaGates,
  type ComposeSession,
  type ComposeSessionSummary,
  type GridAnalysis,
  type Key,
  type LyricBoard,
  type LyricLine,
  type LyricRequest,
  type LyricVersion,
  type MelismaMode,
  type MelodyNote,
  type PassageAnalysis,
  type Phrase,
  type PitchTrack,
  type PrivacyInfo,
  type SungSyllable,
  type TakeGrid,
  type TakeMeta,
  type Tema,
  type TemaCandidate,
  type TemaDetail,
  type TemaGate,
  type TemaListItem,
  type Vowel,
} from "@hermes/shared";
import type { TemasApi, TemaPatchBody } from "@/components/composicion/temas/api";
import type { PlaygroundApi } from "@/components/composicion/playground/api";
import type { LoopRecorder, LoopRecording } from "@/lib/loop-recorder";
import { ComposeApiError } from "@/lib/hermes";

const iso = (minAgo: number) => new Date(Date.now() - minAgo * 60_000).toISOString();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const A_MINOR: Key = { tonic: 9, mode: "minor" };

// ─────────────────────────── Temas ───────────────────────────

function base(id: string, title: string, key: Key, bpm: number, minAgo: number): Tema {
  const t = newTema({ id, title, now: iso(minAgo), key, bpm });
  return { ...t, updatedAt: iso(minAgo) };
}

const temaA: Tema = (() => {
  const t = base("tema-demo-1", "Coro de prueba", A_MINOR, 92, 20);
  return {
    ...t,
    stage: "letra",
    intent: {
      about: "Alguien se va en el último tren de la noche y nadie tiene la culpa.",
      convey: "Nostalgia sin drama: ganas de bailar aunque duela.",
      pov: "yo → tú",
      avoid: "«corazón roto», «para siempre», rimas en -ción",
      anchors: ["andén", "última llamada", "luz naranja"],
      genre: "rnb",
    },
    track: {
      ...t.track,
      groove: "dembow",
      bpmSource: "tap",
      keySource: "medida",
      sections: [
        {
          id: "coro-1",
          kind: "coro",
          label: "Coro",
          bars: 8,
          intent: "La frase que la gente canta de vuelta.",
          loop: [
            { chords: [{ symbol: "Am", beat: 0 }] },
            { chords: [{ symbol: "F", beat: 0 }] },
            { chords: [{ symbol: "C", beat: 0 }] },
            { chords: [{ symbol: "G", beat: 0 }, { symbol: "E", beat: 2 }] },
          ],
        },
        {
          id: "verso-1",
          kind: "verso",
          label: "Verso",
          bars: 8,
          loop: [
            { chords: [{ symbol: "Am", beat: 0 }] },
            { chords: [{ symbol: "Em", beat: 0 }] },
            { chords: [{ symbol: "F", beat: 0 }] },
            { chords: [{ symbol: "G", beat: 0 }] },
          ],
        },
      ],
    },
  };
})();

const temaB: Tema = base("tema-demo-2", "Idea en Sol", { tonic: 7, mode: "major" }, 100, 60 * 26);
const temaC: Tema = (() => {
  const t = base("tema-demo-3", "Puente sin nombre", { tonic: 2, mode: "minor" }, 84, 60 * 24 * 3);
  return { ...t, stage: "pista", track: { ...t.track, meter: "6/8" } };
})();

export const temas = new Map<string, Tema>([temaA, temaB, temaC].map((t) => [t.id, t]));

// ─────────────────────────── Tomas sintéticas ───────────────────────────

/** Una sílaba de juguete: texto, notas (MIDI) y dónde cae en tiempos desde el compás 1. */
type Syl = { text: string; vowel: Vowel; beat: number; beats: number; notes: number[] };

const PHRASES: Syl[][] = [
  [
    { text: "na", vowel: "a", beat: 0, beats: 0.5, notes: [69] },
    { text: "na", vowel: "a", beat: 0.5, beats: 0.5, notes: [72] },
    { text: "uh", vowel: "u", beat: 1, beats: 1, notes: [71, 69] },
    { text: "uh", vowel: "u", beat: 2, beats: 0.5, notes: [67] },
    { text: "dun", vowel: "u", beat: 3, beats: 1.5, notes: [69] },
  ],
  [
    { text: "na", vowel: "a", beat: 8, beats: 0.5, notes: [69] },
    { text: "na", vowel: "a", beat: 8.5, beats: 0.5, notes: [72] },
    { text: "na", vowel: "a", beat: 9, beats: 0.5, notes: [74] },
    { text: "oh", vowel: "o", beat: 10, beats: 1.5, notes: [72, 71, 69] },
    { text: "uh", vowel: "u", beat: 12, beats: 1.5, notes: [69] },
  ],
];

const BPM = 92;
const BEAT = 60 / BPM;
const DOWNBEAT = 0.6;
const TAKE_SEC = DOWNBEAT + 16 * BEAT + 0.6;

function takeAnalysis(sid: string, shift = 0, g: TakeGrid = takeMeta(sid).grid): PassageAnalysis {
  const BEAT = 60 / g.bpm;
  const DOWNBEAT = g.downbeatSec;
  const TAKE_SEC = DOWNBEAT + 16 * BEAT + 0.6;
  const notes: MelodyNote[] = [];
  const phrases: Phrase[] = PHRASES.map((ph, idx) => {
    const syllables: SungSyllable[] = ph.map((s, w) => {
      const start = DOWNBEAT + s.beat * BEAT;
      const dur = s.beats * BEAT * 0.92;
      const per = dur / s.notes.length;
      const noteIdx = s.notes.map((m, k) => {
        notes.push({ midi: m + shift, start: start + k * per, end: start + (k + 1) * per, cents: 0 });
        return notes.length - 1;
      });
      return {
        text: s.text,
        start,
        end: start + dur,
        noteIdx,
        midi: s.notes[0] + shift,
        stressed: s.beat % 2 === 0 || s.beats >= 1.5,
        filler: true,
        melisma: s.notes.length > 1,
        word: w,
        vowel: s.vowel,
        vowelSource: "texto",
        ...(s.notes.length > 1
          ? { parts: noteIdx.map((j) => ({ midi: notes[j].midi, start: notes[j].start, end: notes[j].end })) }
          : {}),
      };
    });
    const phrase: Phrase = {
      idx,
      start: syllables[0].start,
      end: syllables[syllables.length - 1].end,
      text: ph.map((s) => s.text).join(" "),
      syllables,
      mold: { syllables: syllables.length, stresses: [], ending: "aguda", melismas: [], long: [] },
    };
    return { ...phrase, mold: phraseMold(phrase, "respetar") };
  });

  const hop = 0.02;
  const frames = Math.ceil(TAKE_SEC / hop);
  const f0: (number | null)[] = [];
  const rmsDb = new Float32Array(frames).fill(-60);
  const midiTrack = new Float32Array(frames).fill(NaN);
  for (let i = 0; i < frames; i++) {
    const t = i * hop;
    const n = notes.find((x) => t >= x.start && t < x.end);
    f0.push(n ? n.midi + Math.sin(t * 34) * 0.12 : null);
    if (n) {
      rmsDb[i] = -6 - ((t - n.start) / (n.end - n.start)) * 8;
      midiTrack[i] = n.midi;
    }
  }
  const peaks = Array.from({ length: 400 }, (_, i) => {
    const t = (i / 400) * TAKE_SEC;
    const n = notes.find((x) => t >= x.start && t < x.end);
    return n ? 0.35 + 0.5 * (1 - (t - n.start) / (n.end - n.start + 0.001)) : 0.03;
  });
  const key = { key: A_MINOR, score: 0.82 };
  const analysis: PassageAnalysis = {
    sessionId: sid,
    passageId: "P01",
    version: 1,
    analyzedAt: iso(15),
    source: "voz",
    tuningCents: 0,
    hop,
    f0,
    peaks,
    notes,
    phrases,
    key: {
      best: key,
      candidates: [key, { key: { tonic: 0, mode: "major" }, score: 0.74 }, { key: { tonic: 4, mode: "minor" }, score: 0.41 }],
      confidence: 0.3,
      source: "voz",
    },
    range: { lo: Math.min(...notes.map((n) => n.midi)), hi: Math.max(...notes.map((n) => n.midi)) },
    files: { mix: "analisis/P01/mezcla.wav" },
  };
  const track: PitchTrack = {
    sr: 16000,
    hop: 320,
    hopSec: hop,
    f0: new Float32Array(frames),
    midi: midiTrack,
    rmsDb,
  };
  try {
    const grid: GridAnalysis = analyzeOnGrid({ notes, phrases, track, grid: g });
    analysis.grid = grid;
  } catch {
    /* sin rejilla: la etapa Análisis lo dice */
  }
  return analysis;
}

function takeMeta(sid: string): TakeMeta {
  const n = sid === "toma-demo-1" ? 1 : sid === "toma-demo-2" ? 2 : Number(sid.split("-").pop()) || 3;
  return {
    temaId: temaA.id,
    sectionId: "coro-1",
    n,
    grid: { bpm: BPM, meter: "4/4", key: A_MINOR, downbeatSec: DOWNBEAT, loop: temaA.track.sections[0].loop, bars: 4 },
    latency: { ms: 0, source: "manual" },
    monitor: "audifonos",
    stt: false,
    hint: "na na uh uh dun / na na na oh uh",
    favorite: n === 1,
  };
}

export interface TakeState {
  session: ComposeSession;
  readyAt: number;
  analysis: PassageAnalysis;
  board: LyricBoard;
  temaId: string;
}

export const takes = new Map<string, TakeState>();
/** Candidatos que no son tomas (pasajes de Sesiones llevados a una sección), por tema. */
export const extraCandidates = new Map<string, TemaCandidate[]>();

export function makeTake(sid: string, temaId: string, meta: TakeMeta, readyInMs: number, shift = 0): TakeState {
  const recordedAt = iso(readyInMs > 0 ? 0 : 18 - meta.n);
  const TAKE_SEC = meta.grid.downbeatSec + 16 * (60 / meta.grid.bpm) + 0.6;
  const session: ComposeSession = {
    id: sid,
    title: `Toma ${meta.n}`,
    createdAt: recordedAt,
    updatedAt: recordedAt,
    recordedAt,
    source: { path: "(sintético)", name: "toma.wav", bytes: 0, kind: "microfono" },
    mediaDir: "/sintetico",
    mediaRoot: "local",
    files: { audio: "audio.wav" },
    durationSec: TAKE_SEC,
    language: "es",
    status: readyInMs > 0 ? "procesando" : "lista",
    stages: [],
    speakers: [],
    passages: [
      {
        id: "P01",
        label: "P01",
        start: 0,
        end: TAKE_SEC,
        text: "na na uh uh dun / na na na oh uh",
        kind: "silabas",
        confidence: 1,
        group: "probable",
        evidence: ["toma sobre la pista"],
        origin: "manual",
        status: readyInMs > 0 ? "analizando" : "listo",
      },
    ],
    take: meta,
  };
  const analysis = takeAnalysis(sid, shift, meta.grid);
  return {
    session,
    readyAt: Date.now() + readyInMs,
    analysis,
    board: { sessionId: sid, passageId: "P01", versions: [], mine: [], locked: [], melismaMode: "respetar", updatedAt: iso(10) },
    temaId,
  };
}

export function version(analysis: PassageAnalysis, angle: string, lines: string[], why: string[], mode: MelismaMode): LyricVersion {
  return {
    id: `v-${Math.random().toString(36).slice(2, 8)}`,
    angle,
    createdAt: new Date().toISOString(),
    melismaMode: mode,
    lines: analysis.phrases.map((ph, i): LyricLine => {
      const text = lines[i] ?? "";
      let fit;
      try {
        fit = lineFit(text, phraseMold(ph, mode), mode);
      } catch {
        fit = {
          syllables: 0,
          range: [0, 0] as [number, number],
          target: ph.mold.syllables,
          syllablesOk: false,
          ending: "llana" as const,
          endingOk: false,
          stressHits: 0,
          stressTotal: 0,
          melismaVowelOk: null,
          score: 0,
        };
      }
      return { phrase: ph.idx, text, why: why[i], fit };
    }),
  };
}

{
  const t1 = makeTake("toma-demo-1", temaA.id, takeMeta("toma-demo-1"), 0);
  t1.board.versions = [
    version(t1.analysis, "imagen concreta", ["ya se va el tren", "luz naranja en el andén"], ["el andén como ancla", "vocal abierta en el melisma"], "respetar"),
    version(t1.analysis, "pregón pregunta-respuesta", ["¿y tú qué harás?", "última llamada, ya no hay más"], ["pregunta que pide respuesta", "cierra agudo como el tarareo"], "respetar"),
  ];
  t1.board.mine = [{ phrase: 0, text: "ya se va el tren", from: t1.board.versions[0].id }];
  takes.set(t1.session.id, t1);
  const t2 = makeTake("toma-demo-2", temaA.id, { ...takeMeta("toma-demo-2"), favorite: false }, 0, 0);
  takes.set(t2.session.id, t2);
  const t3 = makeTake("toma-demo-3", temaA.id, { ...takeMeta("toma-demo-3"), favorite: false, n: 3 }, 9000);
  takes.set(t3.session.id, t3);
}

/** Una SESIÓN normal (no es toma): para probar "Llevar a un Tema" desde Sesiones. */
const demoSession: ComposeSession = {
  id: "sesion-demo",
  title: "Sesión de prueba",
  createdAt: iso(60 * 5),
  updatedAt: iso(60 * 5),
  recordedAt: iso(60 * 5),
  source: { path: "(sintético)", name: "sesion.mp4", bytes: 0, kind: "archivo" },
  mediaDir: "/sintetico",
  mediaRoot: "local",
  files: { audio: "audio.wav" },
  durationSec: 180,
  language: "es",
  status: "lista",
  stages: [],
  speakers: [{ id: "speaker_0", name: "Voz 1", seconds: 120, singingSeconds: 40 }],
  passages: [
    {
      id: "P01",
      label: "P01",
      start: 42,
      end: 42 + TAKE_SEC,
      speaker: "speaker_0",
      text: "uh uh na na dun dun",
      kind: "silabas",
      confidence: 0.81,
      group: "probable",
      evidence: ["relleno uh/dun ×6", "melodía estable 78 %"],
      origin: "auto",
      status: "listo",
      key: { key: A_MINOR, score: 0.8 },
      melismas: 2,
      syllables: 10,
    },
    {
      id: "P02",
      label: "P02",
      start: 110,
      end: 121,
      speaker: "speaker_0",
      text: "la la la",
      kind: "silabas",
      confidence: 0.44,
      group: "dudoso",
      evidence: ["relleno la ×3"],
      origin: "auto",
      status: "pendiente",
    },
  ],
  key: { best: { key: A_MINOR, score: 0.8 }, candidates: [{ key: A_MINOR, score: 0.8 }], confidence: 0.4, source: "instrumento" },
};
const demoAnalysis = { ...takeAnalysis("sesion-demo"), grid: undefined };
let demoBoard: LyricBoard = { sessionId: "sesion-demo", passageId: "P01", versions: [], mine: [], locked: [], melismaMode: "respetar", updatedAt: iso(60) };

const summaryOf = (x: ComposeSession): ComposeSessionSummary => ({
  id: x.id,
  title: x.title,
  createdAt: x.createdAt,
  updatedAt: x.updatedAt,
  recordedAt: x.recordedAt,
  durationSec: x.durationSec,
  status: x.status,
  songId: x.songId,
  mediaRoot: x.mediaRoot,
  passages: x.passages.length,
  probable: x.passages.filter((p) => p.group === "probable").length,
  source: x.source,
  ...(x.take ? { take: { temaId: x.take.temaId, sectionId: x.take.sectionId, n: x.take.n, favorite: x.take.favorite } } : {}),
});

function isReady(t: TakeState): boolean {
  if (t.session.status === "procesando" && Date.now() >= t.readyAt) {
    t.session = {
      ...t.session,
      status: "lista",
      passages: t.session.passages.map((p) => ({ ...p, status: "listo" })),
    };
  }
  return t.session.status === "lista";
}

function candidatesOf(temaId: string): TemaCandidate[] {
  return [...(extraCandidates.get(temaId) ?? []), ...takeCandidates(temaId)];
}

function takeCandidates(temaId: string): TemaCandidate[] {
  return [...takes.values()]
    .filter((t) => t.temaId === temaId)
    .map((t): TemaCandidate => {
      const ready = isReady(t);
      const meta = t.session.take!;
      return {
        memo: { sessionId: t.session.id, passageId: "P01" },
        kind: "toma",
        label: `Toma ${meta.n}`,
        sectionId: meta.sectionId,
        favorite: !!meta.favorite,
        status: ready ? "listo" : "procesando",
        onGrid: true,
        recordedAt: t.session.recordedAt ?? t.session.createdAt,
        durationSec: t.session.durationSec,
        syllables: ready ? t.analysis.phrases.reduce((a, p) => a + p.syllables.length, 0) : undefined,
        melismas: ready ? t.analysis.phrases.reduce((a, p) => a + p.syllables.filter((s) => s.melisma).length, 0) : undefined,
        lyrics: {
          versions: t.board.versions.length,
          mine: t.board.mine.filter((m) => m.text.trim()).length,
          bestScore: t.board.versions.length
            ? Math.max(...t.board.versions.flatMap((v) => v.lines.map((l) => l.fit.score)))
            : undefined,
        },
      };
    });
}

function gatesOf(t: Tema, c: TemaCandidate[]): TemaGate[] {
  try {
    return temaGates(t, c);
  } catch {
    return [];
  }
}

const detailOf = (id: string): TemaDetail => {
  const tema = temas.get(id);
  if (!tema) throw new ComposeApiError("tema no encontrado", 404);
  const candidates = candidatesOf(id);
  return { tema, candidates, gates: gatesOf(tema, candidates) };
};

/** Merge como el agente: intent y track se MEZCLAN (null borra), secciones y montaje se reemplazan. */
function mergeTema(t: Tema, p: TemaPatchBody): Tema {
  const clean = <T extends object>(o: T): T =>
    Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null)) as T;
  const next: Tema = {
    ...t,
    ...(p.title != null ? { title: p.title } : {}),
    ...(p.stage ? { stage: p.stage } : {}),
    ...(p.intent ? { intent: clean({ ...t.intent, ...p.intent }) } : {}),
    ...(p.track ? { track: clean({ ...t.track, ...p.track }) } : {}),
    ...(p.montage ? { montage: p.montage } : {}),
    updatedAt: new Date().toISOString(),
  };
  if (p.songId !== undefined) {
    if (p.songId) next.songId = p.songId;
    else delete next.songId;
  }
  return next;
}

let seq = 4;

export const mockTemasApi: TemasApi = {
  async list(): Promise<TemaListItem[]> {
    await sleep(250);
    return [...temas.values()].map((t) => ({
      id: t.id,
      title: t.title,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      stage: t.stage,
      songId: t.songId,
      key: t.track.key,
      bpm: t.track.bpm,
      takes: [...takes.values()].filter((x) => x.temaId === t.id).length,
    }));
  },
  async create(input) {
    await sleep(300);
    const id = `tema-demo-${seq++}`;
    const t = newTema({
      id,
      title: input.title ?? "Tema sin título",
      now: new Date().toISOString(),
      ...(input.fromPassage ? { key: A_MINOR, bpm: 96.4, keySource: "medida", bpmSource: "estimado", origin: input.fromPassage } : {}),
    });
    temas.set(id, t);
    return t;
  },
  async get(id) {
    await sleep(200);
    return structuredClone(detailOf(id));
  },
  async patch(id, p) {
    await sleep(150);
    const t = temas.get(id);
    if (!t) throw new Error("tema no encontrado");
    const next = mergeTema(t, p);
    temas.set(id, next);
    return structuredClone(next);
  },
  async remove(id) {
    temas.delete(id);
    return { ok: true };
  },
  async uploadTake(temaId, _wav, meta) {
    await sleep(400);
    const n = [...takes.values()].filter((t) => t.temaId === temaId && t.session.take?.sectionId === meta.sectionId).length + 1;
    const sid = `toma-demo-${Date.now().toString(36)}`;
    const st = makeTake(sid, temaId, { ...meta, n, favorite: false }, 6000, n % 2 ? 0 : 2);
    takes.set(sid, st);
    return st.session;
  },
  async patchTake(temaId, sid, p) {
    const t = takes.get(sid);
    if (!t?.session.take) throw new Error("toma no encontrada");
    if (p.favorite) {
      // UNA ★ por sección: marcar una se la quita a las demás.
      for (const o of takes.values())
        if (o.temaId === temaId && o.session.take?.sectionId === t.session.take.sectionId && o.session.take)
          o.session = { ...o.session, take: { ...o.session.take, favorite: o === t } };
    } else if (p.favorite === false) t.session = { ...t.session, take: { ...t.session.take, favorite: false } };
    if (p.hint != null) t.session = { ...t.session, take: { ...t.session.take!, hint: p.hint } };
    if (p.latencyMs != null) {
      t.session = { ...t.session, status: "procesando", take: { ...t.session.take!, latency: { ms: p.latencyMs, source: "manual" } } };
      t.readyAt = Date.now() + 3000;
    }
    return structuredClone(t.session);
  },
  async privacy(): Promise<PrivacyInfo> {
    return {
      lanOnly: true,
      external: [
        { what: "Intención, progresión y fonemas del tarareo", to: "Claude", when: "al generar versiones de letra" },
        { what: "El texto de las líneas", to: "ElevenLabs (voz guía)", when: "al pedir la guía cantada" },
        { what: "El audio de una sesión importada", to: "ElevenLabs Scribe", when: "al transcribir una sesión" },
      ],
      local: ["Tus tomas y tu voz", "El análisis en la rejilla", "Los temas, las letras y el tablero"],
    };
  },
};

// ─────────────────────────── Playground (solo lo que usan las tomas) ───────────────────────────

const nope = async (): Promise<never> => {
  throw new Error("no disponible en la maqueta");
};

/** La guía cantada sintética vive en ./mock-guia (se registra al importarse, como el montaje). */
export const guideHooks: {
  guide?: PlaygroundApi["guide"];
  voices?: PlaygroundApi["guideVoices"];
  fileUrl?: (id: string, rel: string) => string | null;
} = {};

export const mockPlaygroundApi: PlaygroundApi = {
  async listSessions(): Promise<ComposeSessionSummary[]> {
    // Las tomas también son sesiones: la lista de Sesiones tiene que excluirlas.
    return [summaryOf(demoSession), ...[...takes.values()].map((t) => summaryOf(t.session))];
  },
  async sources() {
    return { cameras: [], mediaRoot: "/sintetico", connected: false };
  },
  browse: nope,
  createSession: nope,
  recordSession: nope,
  async getSession(id) {
    await sleep(120);
    if (id === demoSession.id) return structuredClone(demoSession);
    const t = takes.get(id);
    if (!t) throw new Error("sesión no encontrada");
    isReady(t);
    return structuredClone(t.session);
  },
  patchSession: nope,
  process: nope,
  stop: nope,
  reveal: nope,
  async transcript() {
    return { lines: [] };
  },
  async peaks(id) {
    if (id === demoSession.id) return { peaks: Array.from({ length: 400 }, (_, i) => 0.1 + 0.4 * Math.abs(Math.sin(i / 9))), durationSec: 180 };
    const t = takes.get(id);
    return { peaks: t?.analysis.peaks ?? [], durationSec: t?.session.durationSec ?? TAKE_SEC };
  },
  fileUrl: (id, rel) => guideHooks.fileUrl?.(id, rel) ?? synthTakeUrl(id),
  createSong: nope,
  addPassage: nope,
  patchPassage: nope,
  analyze: nope,
  async analysis(id, pid) {
    await sleep(150);
    if (id === demoSession.id) return pid === "P01" ? structuredClone(demoAnalysis) : null;
    const t = takes.get(id);
    return t && isReady(t) ? structuredClone(t.analysis) : null;
  },
  patchMold: nope,
  transpose: nope,
  async lyrics(id) {
    if (id === demoSession.id) return structuredClone(demoBoard);
    const t = takes.get(id);
    return t ? structuredClone(t.board) : null;
  },
  async generate(id, _pid, req: LyricRequest, signal?: AbortSignal) {
    const t = takes.get(id);
    if (!t) throw new Error("toma no encontrada");
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 1400);
      signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(Object.assign(new Error("abortado"), { name: "AbortError" }));
      });
    });
    const angles: [string, string[], string[]][] = [
      ["confesión", ["no te lo dije", "me quedé mirando el tren"], ["directo, sin adornos", "la vocal abierta cae en el melisma"]],
      ["diálogo", ["dime si vuelves", "o si ya es tarde otra vez"], ["pregunta que abre", "responde y cierra agudo"]],
      ["orgullo", ["yo me quedo aquí", "con la luz naranja y sin ti"], ["afirmación", "ancla repetida"]],
    ];
    const add = Array.from({ length: Math.min(req.count, 3) }, (_, i) =>
      version(t.analysis, angles[i % 3][0], angles[i % 3][1], angles[i % 3][2], req.melismaMode),
    );
    t.board = { ...t.board, versions: [...t.board.versions, ...add], updatedAt: new Date().toISOString() };
    return structuredClone(t.board);
  },
  guide: (id, pid, req, signal) => (guideHooks.guide ? guideHooks.guide(id, pid, req, signal) : nope()),
  guideVoices: (signal) => (guideHooks.voices ? guideHooks.voices(signal) : nope()),
  async putLyrics(id, _pid, patch) {
    if (id === demoSession.id) {
      demoBoard = { ...demoBoard, ...patch, updatedAt: new Date().toISOString() };
      return structuredClone(demoBoard);
    }
    const t = takes.get(id);
    if (!t) throw new Error("toma no encontrada");
    t.board = { ...t.board, ...patch, updatedAt: new Date().toISOString() };
    return structuredClone(t.board);
  },
};

/**
 * El "audio" de una toma sintética: sus notas como senos con ataque, en un WAV
 * (blob URL, uno por toma). Nada grabado: lo mismo que dibuja el análisis.
 */
const synthUrls = new Map<string, string>();
function synthTakeUrl(sid: string): string {
  const t = takes.get(sid);
  if (!t || typeof URL === "undefined" || typeof Blob === "undefined") return "";
  const hit = synthUrls.get(sid);
  if (hit) return hit;
  const sr = 22050;
  const pcm = new Float32Array(Math.ceil((t.session.durationSec ?? 12) * sr));
  for (const n of t.analysis.notes) {
    const hz = 440 * Math.pow(2, (n.midi - 69) / 12);
    const a = Math.floor(n.start * sr);
    const b = Math.min(pcm.length, Math.floor(n.end * sr));
    for (let i = a; i < b; i++) {
      const x = (i - a) / sr;
      const env = Math.min(1, x / 0.015) * Math.min(1, (b - i) / sr / 0.04);
      const ph = 2 * Math.PI * hz * (i / sr);
      pcm[i] += 0.28 * env * (Math.sin(ph) + 0.3 * Math.sin(2 * ph) + 0.12 * Math.sin(3 * ph));
    }
  }
  const url = URL.createObjectURL(new Blob([encodeWav16(pcm, sr).buffer as ArrayBuffer], { type: "audio/wav" }));
  synthUrls.set(sid, url);
  return url;
}

// ─────────────────────────── Grabadora sintética ───────────────────────────

/**
 * Sin micrófono: "graba" una melodía de juguete (senos con ataques) sobre el
 * mismo reloj, con el medidor por ref. Sirve para ejercitar Grabar completo.
 */
export async function syntheticRecorder(
  ctx: AudioContext,
  opts: { meterRef?: { current: number } } = {},
): Promise<LoopRecorder> {
  if (ctx.state === "suspended") await ctx.resume();
  const sr = ctx.sampleRate;
  const startSec = ctx.currentTime;
  const dest = ctx.createMediaStreamDestination();
  const track = dest.stream.getAudioTracks()[0];
  let stopped = false;
  const meter = setInterval(() => {
    if (opts.meterRef) opts.meterRef.current = 0.25 + Math.abs(Math.sin(ctx.currentTime * 5)) * 0.5;
  }, 30);
  const render = (): LoopRecording => {
    const total = Math.max(0, ctx.currentTime - startSec);
    const pcm = new Float32Array(Math.floor(total * sr));
    const beat = 60 / BPM;
    for (let i = 0; i < pcm.length; i++) {
      const t = i / sr;
      const b = t / beat;
      const inNote = b % 1 < 0.7;
      const m = [69, 72, 71, 67][Math.floor(b) % 4];
      const hz = 440 * Math.pow(2, (m - 69) / 12);
      const env = inNote ? Math.min(1, (b % 1) * 20) * (1 - (b % 1) / 0.7) : 0;
      pcm[i] = 0.4 * env * Math.sin(2 * Math.PI * hz * t);
    }
    return { pcm, sr, firstFrameSec: startSec, peak: pcm.length ? 0.4 : 0 };
  };
  return {
    track,
    cancel: () => {
      stopped = true;
      clearInterval(meter);
      if (opts.meterRef) opts.meterRef.current = 0;
    },
    stop: async () => {
      if (stopped) throw new Error("La grabación ya terminó.");
      stopped = true;
      clearInterval(meter);
      if (opts.meterRef) opts.meterRef.current = 0;
      return render();
    },
  };
}
