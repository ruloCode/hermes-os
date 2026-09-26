/**
 * TEMAS — la máquina de temas de Composición: el contrato compartido entre el
 * agente (persistencia, tomas, análisis en la rejilla) y el dashboard.
 *
 * Un tema es una canción en construcción en 4 capas (la junta de músicos):
 * PISTA (tonalidad + acordes por compás + bpm) · INTENCIÓN (de qué habla, qué
 * transmite) · FONEMAS MELÓDICOS (el humano tararea "na na / uh uh" ENCIMA de
 * la pista) · TRADUCCIÓN a versiones de letra. Encima, dos etapas propias:
 * ANÁLISIS (la toma leída en la rejilla: compás, tiempo, grado sobre el
 * acorde, melisma, vocal, dinámica) y MONTAJE (armar el tema tomando partes).
 *
 * Una TOMA es una `ComposeSession` con `take: TakeMeta` y un solo pasaje P01:
 * reusa todo el pipeline, el molde y las letras de Sesiones. Como se graba
 * SOBRE la pista, su rejilla (bpm, compás, primer tiempo) viaja con ella: el
 * análisis no adivina el tempo, lo sabe.
 *
 * Las firmas son el contrato: no cambiarlas sin actualizar agente y web.
 */
import { chordFromRoman, chordSymbol, parseChord, type Key } from "./music-theory.js";
import type { Passage, SectionKind, Song, Vowel } from "./composicion.js";
import { beatsPerBar } from "./grid.js";

// ─────────────────────────── Etapas ───────────────────────────

export const TEMA_STAGES = ["intencion", "pista", "grabar", "analisis", "letra", "montaje"] as const;
export type TemaStage = (typeof TEMA_STAGES)[number];

export const TEMA_STAGE_LABEL: Record<TemaStage, string> = {
  intencion: "Intención",
  pista: "Pista",
  grabar: "Grabar",
  analisis: "Análisis",
  letra: "Letra",
  montaje: "Montaje",
};

// ─────────────────────────── Pista e intención ───────────────────────────

export type Meter = Song["meter"];

/** Patrón rítmico de la pista. "clic" = solo metrónomo (sirve para cualquier compás). */
export const GROOVES = ["clic", "dembow", "dancehall", "rnb", "pop"] as const;
export type Groove = (typeof GROOVES)[number];

export const GENRES = ["rnb", "dancehall", "reggaeton", "pop-urbano", "otro"] as const;
export type Genre = (typeof GENRES)[number];

/** Un compás de la progresión: 1 o 2 acordes (el segundo entra en `beat`, 0-based). */
export interface ChordBar {
  chords: { symbol: string; beat: number }[];
}

export interface MemoRef {
  sessionId: string;
  passageId: string;
}

export interface TemaIntent {
  /** De qué habla. */
  about: string;
  /** Qué quiere transmitir. */
  convey: string;
  /** Quién le habla a quién ("yo a ti", "las dos a él"). */
  pov?: string;
  /** Qué evitar (clichés, palabras gastadas). */
  avoid?: string;
  /** Palabras o imágenes ancla. */
  anchors?: string[];
  genre: Genre;
}

export interface TemaSection {
  id: string;
  kind: SectionKind;
  label: string;
  /** El loop de acordes de la sección (1..16 compases). */
  loop: ChordBar[];
  /** Largo de la sección en compases (el loop se repite hasta llenarlo). */
  bars: number;
  intent?: string;
  /** Pasajes de Sesiones que entraron como tarareo de esta sección. */
  refs?: MemoRef[];
}

export interface TemaTrack {
  key: Key;
  bpm: number;
  meter: Meter;
  groove: Groove;
  /** 0..0,5: cuánto se retrasan las semicorcheas impares (swing). */
  swing?: number;
  bpmSource?: "manual" | "tap" | "estimado";
  keySource?: "manual" | "medida";
  sections: TemaSection[];
}

/** Qué parte suena en cada sección del montaje. */
export interface MontagePick {
  sectionId: string;
  memo?: MemoRef;
  lyric?: { kind: "mine" } | { kind: "version"; versionId: string };
  semitones?: number;
  /** 🔒 conservar: no se toca al regenerar. */
  keep?: boolean;
}

export interface Tema {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  stage: TemaStage;
  intent: TemaIntent;
  track: TemaTrack;
  montage: MontagePick[];
  /** Canción del tablero a la que se aplicó. */
  songId?: string;
  /** Pasaje de Sesiones del que nació (si nació de un tarareo). */
  origin?: MemoRef;
}

/** Una toma o pasaje que el tema puede usar, visto desde el tema. */
export interface TemaCandidate {
  memo: MemoRef;
  kind: "toma" | "pasaje";
  label: string;
  sectionId: string;
  favorite: boolean;
  status: Passage["status"] | "procesando";
  /** Tiene rejilla (grabada sobre la pista). */
  onGrid: boolean;
  recordedAt: string;
  durationSec?: number;
  syllables?: number;
  melismas?: number;
  lyrics: { versions: number; mine: number; bestScore?: number };
}

/** Lo que le falta a una etapa, calculado sobre el material REAL. Avanzar siempre se puede. */
export interface TemaGate {
  stage: TemaStage;
  done: boolean;
  missing: string[];
}

export interface TemaDetail {
  tema: Tema;
  candidates: TemaCandidate[];
  gates: TemaGate[];
}

/** Lo liviano para la lista de temas. */
export type TemaListItem = Pick<Tema, "id" | "title" | "createdAt" | "updatedAt" | "stage" | "songId"> & {
  key: Key;
  bpm: number;
  takes: number;
};

// ─────────────────────────── Tomas ───────────────────────────

/** La rejilla con la que se grabó una toma: el análisis no adivina el tempo, lo sabe. */
export interface TakeGrid {
  bpm: number;
  meter: Meter;
  key: Key;
  /**
   * Segundo DEL AUDIO de la toma donde cae el primer tiempo del compás 1 de la
   * sección, ya compensado por latencia. Lo anterior (anacrusa) es compás < 1.
   */
  downbeatSec: number;
  loop: ChordBar[];
  /** Compases de la sección grabados en esta toma (una vuelta del loop o la sección entera). */
  bars: number;
  swing?: number;
}

export interface TakeMeta {
  temaId: string;
  sectionId: string;
  /** Número de toma dentro de la sección (1, 2, 3…). Lo asigna el agente. */
  n: number;
  grid: TakeGrid;
  latency: { ms: number; source: "medida" | "navegador" | "manual" };
  /** Con audífonos la toma es voz sola; con parlantes se separa la voz de la pista. */
  monitor: "audifonos" | "parlantes";
  /** Leer los fonemas con Scribe (sale del equipo). Default false: todo local. */
  stt: boolean;
  /** Pista de texto de lo que se tarareó ("na na uh dun"): ancla las sílabas. */
  hint?: string;
  favorite?: boolean;
  /** Vuelta del loop de la que salió (grabación continua de N vueltas). */
  cycle?: number;
}

// ─────────────────────────── Análisis en la rejilla ───────────────────────────

/** Qué es una nota respecto del acorde que suena. */
export type ChordRole =
  | "acorde"
  | "tension"
  | "paso"
  | "bordadura"
  | "apoyatura"
  | "anticipacion"
  | "fuera";

export type Dynamic = "pp" | "p" | "mp" | "mf" | "f" | "ff";

export interface GridNote {
  /** Índice en `PassageAnalysis.notes`. */
  i: number;
  /** Compás (1-based; ≤ 0 = anacrusa). */
  bar: number;
  /** Semicorchea dentro del compás (0-based). */
  stepInBar: number;
  /** Semicorchea absoluta desde el primer tiempo del compás 1 (negativa = anacrusa). */
  absStep: number;
  /** Largo en semicorcheas (≥ 1). */
  len16: number;
  /** Desvío del ataque respecto a la rejilla (ms, + = tarde). */
  offMs: number;
  /** Peso métrico 0..4 (4 = primer tiempo). */
  weight: number;
  /** Ataque débil que se sostiene sobre una posición más fuerte. */
  syncopated: boolean;
  /** Acorde que suena (símbolo) o null. */
  chord: string | null;
  /** Grado de la nota en la tonalidad ("1", "♭3", "5"…). */
  degree: string;
  /** Función respecto del acorde ("R", "3", "5", "7", "9", "11", "13") o null si no pertenece. */
  chordTone: string | null;
  role: ChordRole;
  /** Intervalo en semitonos desde la nota anterior (null en la primera). */
  interval: number | null;
  /** Dinámica 0..100, relativa a esta toma. */
  velocity: number;
  dynamic: Dynamic;
  vowel?: Vowel;
}

export interface GridPhraseStats {
  idx: number;
  startBar: number;
  /** Anacrusa en semicorcheas (0 = entra en el tiempo). */
  pickup16: number;
  lenBars: number;
  syllablesPerBar: number;
  melismaPct: number;
  range: { lo: number; hi: number };
  contour: "asc" | "desc" | "arco" | "valle" | "plano";
  endsOn: { degree: string; chordTone: string | null; weight: number };
  syncopationPct: number;
  /** % de notas en tiempos fuertes (peso ≥ 3) que son nota del acorde. */
  strongChordTonePct: number;
}

export interface GridAnalysis {
  bpm: number;
  meter: Meter;
  downbeatSec: number;
  key: Key;
  notes: GridNote[];
  phrases: GridPhraseStats[];
  /** Mediana del desvío de los ataques en posiciones fuertes (ms). */
  medianOffMs: number;
  /** Si la rejilla parece corrida: cuánto moverla (ms, con signo) o null. */
  suggestShiftMs: number | null;
  /** La lectura en números, una línea por frase. */
  readout: string[];
}


// ─────────────────────────── Funciones puras (contrato) ───────────────────────────

export class TemaValidationError extends Error {}

/** Las clases de sección de una canción (mismo vocabulario que el tablero). */
export const TEMA_SECTION_KINDS: readonly SectionKind[] = [
  "intro",
  "verso",
  "pre",
  "coro",
  "puente",
  "final",
  "instrumental",
];

const METERS: readonly Meter[] = ["4/4", "3/4", "6/8"];
const BPM_SOURCES = ["manual", "tap", "estimado"] as const;
const KEY_SOURCES = ["manual", "medida"] as const;

/** Tonalidad por defecto de un tema nuevo sin medida: La menor (la más común del género urbano). */
const DEFAULT_KEY: Key = { tonic: 9, mode: "minor" };

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function fail(msg: string): never {
  throw new TemaValidationError(msg);
}

function optString(v: unknown, field: string): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") fail(`${field} debe ser texto`);
  return v;
}

function memoRef(v: unknown, field: string): MemoRef {
  if (
    !isObj(v) ||
    typeof v.sessionId !== "string" ||
    !v.sessionId ||
    typeof v.passageId !== "string" ||
    !v.passageId
  )
    fail(`${field}: referencia a un pasaje inválida (sessionId + passageId)`);
  return { sessionId: v.sessionId as string, passageId: v.passageId as string };
}

function validateIntent(v: unknown): TemaIntent {
  if (!isObj(v)) fail("la intención debe ser un objeto");
  const about = optString(v.about, "«de qué habla»") ?? "";
  const convey = optString(v.convey, "«qué transmite»") ?? "";
  if (!(GENRES as readonly unknown[]).includes(v.genre)) fail(`género inválido: ${String(v.genre)}`);
  const out: TemaIntent = { about, convey, genre: v.genre as Genre };
  const pov = optString(v.pov, "«quién a quién»");
  const avoid = optString(v.avoid, "«qué evitar»");
  if (pov !== undefined) out.pov = pov;
  if (avoid !== undefined) out.avoid = avoid;
  if (v.anchors !== undefined && v.anchors !== null) {
    if (!Array.isArray(v.anchors) || !v.anchors.every((a) => typeof a === "string"))
      fail("las palabras ancla deben ser una lista de textos");
    out.anchors = (v.anchors as string[]).map((a) => a.trim()).filter(Boolean);
  }
  return out;
}

function validateLoop(v: unknown, meter: Meter, label: string): ChordBar[] {
  if (!Array.isArray(v) || v.length < 1 || v.length > 16)
    fail(`el loop de «${label}» debe tener de 1 a 16 compases`);
  const beats = beatsPerBar(meter);
  return v.map((bar, b) => {
    if (!isObj(bar) || !Array.isArray(bar.chords) || bar.chords.length < 1 || bar.chords.length > 2)
      fail(`«${label}», compás ${b + 1}: lleva 1 o 2 acordes`);
    let lastBeat = -1;
    const chords = (bar.chords as unknown[]).map((c) => {
      if (!isObj(c) || typeof c.symbol !== "string")
        fail(`«${label}», compás ${b + 1}: acorde sin símbolo`);
      const symbol = (c.symbol as string).trim();
      // El motor de audio y el análisis parsean el símbolo: si no se entiende aquí, no suena allá.
      if (!parseChord(symbol)) fail(`«${label}», compás ${b + 1}: no entiendo el acorde «${symbol}»`);
      const beat = c.beat;
      if (!Number.isInteger(beat) || (beat as number) < 0 || (beat as number) >= beats)
        fail(`«${label}», compás ${b + 1}: el acorde «${symbol}» entra fuera del compás (tiempo ${String(beat)} en ${meter})`);
      if ((beat as number) <= lastBeat)
        fail(`«${label}», compás ${b + 1}: los acordes van en orden y en tiempos distintos`);
      lastBeat = beat as number;
      return { symbol, beat: beat as number };
    });
    return { chords };
  });
}

function validateSection(v: unknown, meter: Meter, i: number): TemaSection {
  if (!isObj(v)) fail(`la sección ${i + 1} debe ser un objeto`);
  if (typeof v.id !== "string" || !v.id.trim()) fail(`la sección ${i + 1} necesita id`);
  if (!TEMA_SECTION_KINDS.includes(v.kind as SectionKind)) fail(`clase de sección inválida: ${String(v.kind)}`);
  if (typeof v.label !== "string" || !v.label.trim()) fail(`la sección ${i + 1} necesita un nombre`);
  const label = v.label.trim();
  const loop = validateLoop(v.loop, meter, label);
  if (!Number.isInteger(v.bars) || (v.bars as number) < 1 || (v.bars as number) > 64)
    fail(`«${label}»: el largo debe ser de 1 a 64 compases`);
  const out: TemaSection = { id: v.id, kind: v.kind as SectionKind, label, loop, bars: v.bars as number };
  const intent = optString(v.intent, `la intención de «${label}»`);
  if (intent !== undefined) out.intent = intent;
  if (v.refs !== undefined && v.refs !== null) {
    if (!Array.isArray(v.refs)) fail(`«${label}»: refs debe ser una lista`);
    out.refs = (v.refs as unknown[]).map((r) => memoRef(r, `«${label}»`));
  }
  return out;
}

function validateTrack(v: unknown): TemaTrack {
  if (!isObj(v)) fail("la pista debe ser un objeto");
  const key = v.key;
  // La tónica indexa tablas de 12 notas: 2,5 o 12 romperían el deletreo y la transposición.
  if (!isObj(key) || !Number.isInteger(key.tonic) || (key.tonic as number) < 0 || (key.tonic as number) > 11)
    fail("tónica inválida: debe ser un entero de 0 a 11");
  if (key.mode !== "major" && key.mode !== "minor") fail("modo inválido: mayor o menor");
  if (typeof v.bpm !== "number" || !Number.isFinite(v.bpm) || v.bpm < 40 || v.bpm > 220)
    fail(`bpm fuera de rango (40 a 220): ${String(v.bpm)}`);
  if (!METERS.includes(v.meter as Meter)) fail(`compás inválido: ${String(v.meter)} (4/4, 3/4 o 6/8)`);
  if (!(GROOVES as readonly unknown[]).includes(v.groove)) fail(`groove inválido: ${String(v.groove)}`);
  const meter = v.meter as Meter;
  if (!Array.isArray(v.sections) || v.sections.length < 1) fail("la pista necesita al menos una sección");
  const sections = (v.sections as unknown[]).map((s, i) => validateSection(s, meter, i));
  const ids = new Set<string>();
  for (const s of sections) {
    if (ids.has(s.id)) fail(`id de sección repetido: ${s.id}`);
    ids.add(s.id);
  }
  const out: TemaTrack = {
    key: { tonic: key.tonic as number, mode: key.mode },
    bpm: v.bpm,
    meter,
    groove: v.groove as Groove,
    sections,
  };
  if (v.swing !== undefined && v.swing !== null) {
    if (typeof v.swing !== "number" || !Number.isFinite(v.swing) || v.swing < 0 || v.swing > 0.5)
      fail("swing fuera de rango (0 a 0,5)");
    out.swing = v.swing;
  }
  if (v.bpmSource !== undefined && v.bpmSource !== null) {
    if (!(BPM_SOURCES as readonly unknown[]).includes(v.bpmSource)) fail(`origen del bpm inválido: ${String(v.bpmSource)}`);
    out.bpmSource = v.bpmSource as TemaTrack["bpmSource"];
  }
  if (v.keySource !== undefined && v.keySource !== null) {
    if (!(KEY_SOURCES as readonly unknown[]).includes(v.keySource)) fail(`origen de la tonalidad inválido: ${String(v.keySource)}`);
    out.keySource = v.keySource as TemaTrack["keySource"];
  }
  return out;
}

function validatePick(v: unknown): MontagePick {
  if (!isObj(v) || typeof v.sectionId !== "string" || !v.sectionId) fail("cada parte del montaje necesita su sección");
  const out: MontagePick = { sectionId: v.sectionId };
  if (v.memo !== undefined && v.memo !== null) out.memo = memoRef(v.memo, "montaje");
  if (v.lyric !== undefined && v.lyric !== null) {
    const l = v.lyric;
    if (isObj(l) && l.kind === "mine") out.lyric = { kind: "mine" };
    else if (isObj(l) && l.kind === "version" && typeof l.versionId === "string" && l.versionId)
      out.lyric = { kind: "version", versionId: l.versionId };
    else fail("montaje: la letra es «mine» o una versión con su id");
  }
  if (v.semitones !== undefined && v.semitones !== null) {
    if (!Number.isInteger(v.semitones) || Math.abs(v.semitones as number) > 24)
      fail("montaje: los semitonos van de −24 a 24");
    out.semitones = v.semitones as number;
  }
  if (v.keep !== undefined && v.keep !== null) {
    if (typeof v.keep !== "boolean") fail("montaje: «conservar» es sí o no");
    out.keep = v.keep;
  }
  return out;
}

/**
 * Valida un tema completo (lo que se persiste tras un PATCH): tónica entera
 * 0..11, bpm 40..220, compás válido, groove válido, loop 1..16 compases con 1..2
 * acordes que `parseChord` entienda, bars 1..64, stage e intent válidos.
 *
 * Devuelve una copia LIMPIA (solo los campos conocidos). Las partes del
 * montaje de una sección que ya no existe se descartan en silencio: borrar
 * una sección no debe dejar el tema imposible de guardar. Si hay dos partes
 * para la misma sección, manda la última.
 */
export function validateTema(input: unknown): Tema {
  if (!isObj(input)) fail("el tema debe ser un objeto");
  if (typeof input.id !== "string" || !input.id.trim()) fail("el tema necesita id");
  if (typeof input.title !== "string") fail("el título debe ser texto");
  if (typeof input.createdAt !== "string" || typeof input.updatedAt !== "string")
    fail("faltan las fechas del tema");
  if (!(TEMA_STAGES as readonly unknown[]).includes(input.stage)) fail(`etapa inválida: ${String(input.stage)}`);
  const intent = validateIntent(input.intent);
  const track = validateTrack(input.track);
  if (!Array.isArray(input.montage)) fail("el montaje debe ser una lista");
  const sectionIds = new Set(track.sections.map((s) => s.id));
  const picks = new Map<string, MontagePick>();
  for (const raw of input.montage as unknown[]) {
    const p = validatePick(raw);
    if (sectionIds.has(p.sectionId)) picks.set(p.sectionId, p);
  }
  const tema: Tema = {
    id: input.id,
    title: input.title,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    stage: input.stage as TemaStage,
    intent,
    track,
    montage: [...picks.values()],
  };
  const songId = optString(input.songId, "songId");
  if (songId) tema.songId = songId;
  if (input.origin !== undefined && input.origin !== null) tema.origin = memoRef(input.origin, "origen");
  return tema;
}

/**
 * Tema nuevo con valores sanos: una sección "Coro" de 8 compases con un loop
 * de 4 (i–VI–III–VII en menor, I–V–vi–IV en mayor: las dos progresiones que
 * más suenan en el género), 90 bpm, 4/4 y solo clic. Sin tonalidad medida,
 * La menor. El bpm que llega de una estimación se acota a 40..220 para que el
 * tema nazca válido.
 */
export function newTema(opts: {
  id: string;
  title: string;
  now: string;
  key?: Key;
  bpm?: number;
  keySource?: TemaTrack["keySource"];
  bpmSource?: TemaTrack["bpmSource"];
  origin?: MemoRef;
}): Tema {
  const key: Key = opts.key
    ? { tonic: ((Math.round(opts.key.tonic) % 12) + 12) % 12, mode: opts.key.mode }
    : DEFAULT_KEY;
  const romans = key.mode === "minor" ? ["i", "VI", "III", "VII"] : ["I", "V", "vi", "IV"];
  const loop: ChordBar[] = romans.map((r) => {
    const c = chordFromRoman(r, key);
    return { chords: [{ symbol: c ? chordSymbol(c, key) : "C", beat: 0 }] };
  });
  const bpm =
    opts.bpm != null && Number.isFinite(opts.bpm)
      ? Math.max(40, Math.min(220, Math.round(opts.bpm * 10) / 10))
      : 90;
  const tema: Tema = {
    id: opts.id,
    title: opts.title,
    createdAt: opts.now,
    updatedAt: opts.now,
    stage: "intencion",
    intent: { about: "", convey: "", genre: "otro" },
    track: {
      key,
      bpm,
      meter: "4/4",
      groove: "clic",
      bpmSource: opts.bpmSource ?? "manual",
      keySource: opts.keySource ?? "manual",
      sections: [{ id: "coro-1", kind: "coro", label: "Coro", loop, bars: 8 }],
    },
    montage: [],
  };
  if (opts.origin) tema.origin = { sessionId: opts.origin.sessionId, passageId: opts.origin.passageId };
  return tema;
}

const sameMemo = (a: MemoRef | undefined, b: MemoRef | undefined): boolean =>
  !!a && !!b && a.sessionId === b.sessionId && a.passageId === b.passageId;

/** Estados de un candidato que todavía pueden terminar en análisis. */
const IN_FLIGHT = new Set<TemaCandidate["status"]>(["procesando", "pendiente", "analizando"]);

/**
 * Qué le falta a cada etapa, sobre el material real (intención escrita, loop, tomas, análisis, letras, montaje).
 *
 * Una por etapa, en orden. Grabar y Montaje se miden POR SECCIÓN (cada una
 * necesita su tarareo y su parte elegida); Análisis y Letra, en el tema (con
 * una toma leída en la rejilla o una línea de letra ya hay material). Un
 * pasaje de Sesiones llevado a una sección cuenta como su tarareo. En el
 * montaje, la ★ que `montageSlots` propone NO cuenta como elegida: la elección
 * es humana.
 */
export function temaGates(tema: Tema, candidates: TemaCandidate[]): TemaGate[] {
  const sections = tema.track.sections;
  const gate = (stage: TemaStage, missing: string[]): TemaGate => ({ stage, done: !missing.length, missing });

  const intent: string[] = [];
  if (!tema.intent.about.trim()) intent.push("De qué habla");
  if (!tema.intent.convey.trim()) intent.push("Qué quiere transmitir");

  const pista = sections.some((s) => s.loop.some((b) => b.chords.length > 0)) ? [] : ["Un loop de acordes"];

  const grabar = sections.length
    ? sections.filter((s) => !candidates.some((c) => c.sectionId === s.id)).map((s) => `Una toma de «${s.label}»`)
    : ["Una sección para grabar"];

  let analisis: string[] = [];
  if (!candidates.some((c) => c.onGrid && c.status === "listo")) {
    if (candidates.some((c) => c.kind === "toma" && IN_FLIGHT.has(c.status)))
      analisis = ["Esperar a que termine el análisis de la toma"];
    else if (candidates.some((c) => c.kind === "toma"))
      analisis = ["Una toma lista sobre la rejilla (las que hay fallaron)"];
    else analisis = ["Una toma grabada sobre la pista"];
  }

  const letra = candidates.some((c) => c.lyrics.mine > 0 || c.lyrics.versions > 0)
    ? []
    : ["Versiones de letra o una línea en «Tu versión»"];

  const montaje = sections
    .filter((s) => !tema.montage.some((p) => p.sectionId === s.id && p.memo))
    .map((s) => `Elegir la parte de «${s.label}»`);

  return [
    gate("intencion", intent),
    gate("pista", pista),
    gate("grabar", grabar),
    gate("analisis", analisis),
    gate("letra", letra),
    gate("montaje", montaje),
  ];
}

/**
 * Por sección: el pick del montaje o, si no hay, la toma ★ (o la última lista).
 *
 * Con pick que nombra un memo, `candidate` es ese memo si está entre los
 * candidatos de ESTE tema (una parte traída de otro tema da null: la web la
 * resuelve aparte). Sin memo elegido: la ★ más reciente de la sección (lista
 * antes que en proceso), y si no hay ★, la última toma lista.
 */
export function montageSlots(
  tema: Tema,
  candidates: TemaCandidate[],
): { section: TemaSection; pick: MontagePick | null; candidate: TemaCandidate | null }[] {
  const latest = (xs: TemaCandidate[]): TemaCandidate | null =>
    xs.length ? xs.reduce((a, b) => (b.recordedAt > a.recordedAt ? b : a)) : null;
  return tema.track.sections.map((section) => {
    let pick: MontagePick | null = null;
    for (const p of tema.montage) if (p.sectionId === section.id) pick = p;
    if (pick?.memo) {
      const memo = pick.memo;
      return { section, pick, candidate: candidates.find((c) => sameMemo(c.memo, memo)) ?? null };
    }
    const own = candidates.filter((c) => c.sectionId === section.id);
    const favs = own.filter((c) => c.favorite);
    const candidate =
      latest(favs.filter((c) => c.status === "listo")) ??
      latest(favs) ??
      latest(own.filter((c) => c.status === "listo"));
    return { section, pick, candidate };
  });
}
