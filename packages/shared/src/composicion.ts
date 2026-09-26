/**
 * COMPOSICIÓN — contrato compartido entre el agente (persistencia, análisis de
 * audio, generación de letras) y el dashboard (/composicion).
 *
 * Dos mundos que se tocan:
 *  1. El TABLERO (canciones, referencias, cuaderno): lo que antes era un mock
 *     en memoria de la web. Ahora vive en `~/.hermes-os/composicion/board.json`
 *     y la web lo hidrata del agente (sin agente, cae al mock).
 *  2. El PLAYGROUND: se importa una SESIÓN de composición grabada (video de la
 *     cámara o memo del mic), el agente detecta los PASAJES cantados (letra,
 *     melismas, sílabas de relleno tipo "na na na / dun dun / uh uh", rap),
 *     extrae la melodía de cada uno (notas + sílabas + tonalidad), y con eso
 *     arma el MOLDE que una letra tiene que llenar. Sobre el molde se generan
 *     VERSIONES de letra que se miden contra él (sílabas, acentos, final agudo o
 *     llano, vocal abierta en el melisma).
 *
 * Reglas de la casa que este contrato hace cumplir:
 *  - El factor humano no se delega: una versión de letra es una SUGERENCIA;
 *    solo entra a una canción con un clic ("Usar" / "Aplicar").
 *  - Todo dato visible es real: la tonalidad y las sílabas son MEDIDAS
 *    aproximadas y se muestran con su confianza, nunca como certezas.
 *  - El audio original jamás se pisa: transponer genera archivos nuevos.
 */
import type { Key } from "./music-theory.js";
import type { GridAnalysis, TakeMeta } from "./tema.js";

// ─────────────────────────── Tablero (canciones) ───────────────────────────

/** Etapas = FASES en curso, como en el Estudio: dónde está el trabajo hoy. */
export type SongStage = "idea" | "letra" | "armonia" | "melodia" | "demo" | "terminada";

export type SectionKind = "intro" | "verso" | "pre" | "coro" | "puente" | "final" | "instrumental";

/** De dónde salió la letra de una sección cuando vino del Playground. */
export interface SectionMemoLink {
  sessionId: string;
  passageId: string;
  /** Semitonos aplicados para llevar el memo a la tonalidad de la canción. */
  semitones: number;
}

export interface SongSection {
  id: string;
  kind: SectionKind;
  /** "Verso 1", "Coro"… editable. */
  label: string;
  /** Letra con acordes inline [Am] (estilo ChordPro), un verso por línea. */
  lyrics: string;
  /** Progresión de la sección (símbolos: "Am", "F", "C", "G"). */
  chords: string[];
  bars: number;
  /** Nota de intención: qué tiene que pasar emocionalmente aquí. */
  intent?: string;
  /** Melodía de referencia (un pasaje del Playground). */
  memo?: SectionMemoLink;
}

export interface SongVersion {
  id: string;
  at: string;
  note: string;
  /** Qué cambió (para la línea de tiempo). */
  scope: "letra" | "armonía" | "estructura" | "tonalidad";
}

export interface Song {
  id: string;
  title: string;
  stage: SongStage;
  key: Key;
  tempo: number;
  meter: "4/4" | "3/4" | "6/8";
  mood: string[];
  /** De qué va: la frase-semilla que no se negocia. */
  seed: string;
  sections: SongSection[];
  refIds: string[];
  versions: SongVersion[];
  createdAt: string;
  updatedAt: string;
  /** Sesiones del Playground de donde sale material de esta canción. */
  sessionIds?: string[];
}

export type RefKind = "cancion" | "letra" | "progresion" | "poema" | "ambiente" | "nota";

export interface Reference {
  id: string;
  kind: RefKind;
  title: string;
  /** Artista, autor o fuente. */
  by?: string;
  url?: string;
  /** youtube · spotify · genius · web · nota · archivo */
  source: "youtube" | "spotify" | "genius" | "web" | "nota" | "archivo";
  /** Lo que importa: QUÉ tomo de aquí. Sin esto la referencia es ruido. */
  takeaway: string;
  key?: Key;
  tempo?: number;
  progression?: string[];
  tags: string[];
  /** Plan: observar → probar → aplicado (mismo patrón del radar del Estudio). */
  plan: "observar" | "probar" | "aplicado";
  savedAt: string;
  /** Extracto breve (verso, línea, imagen) — solo lo justo para recordar. */
  excerpt?: string;
}

export interface NotebookEntry {
  id: string;
  kind: "verso" | "frase" | "tarareo" | "titulo" | "imagen";
  text: string;
  at: string;
  /** Tarareo: duración en segundos y picos de la onda. */
  audio?: { seconds: number; peaks: number[] };
  /** Si ya se convirtió en canción. */
  songId?: string;
}

/** El tablero completo, tal como se persiste y se sirve. */
export interface ComposicionBoard {
  version: 1;
  songs: Song[];
  refs: Reference[];
  notebook: NotebookEntry[];
  updatedAt: string;
}

// ─────────────────────────── Medición musical ───────────────────────────

/** Una tonalidad candidata con su puntaje (correlación de perfil, 0..1). */
export interface KeyCandidate {
  key: Key;
  score: number;
}

/** Estimación de tonalidad: SIEMPRE con candidatas y confianza (margen sobre la 2ª). */
export interface KeyEstimate {
  best: KeyCandidate;
  /** Top-3 ordenadas, la primera = best. */
  candidates: KeyCandidate[];
  /** 0..1 — margen normalizado entre la 1ª y la 2ª. Bajo = ambigua. */
  confidence: number;
  /** De dónde salió: la voz (notas cantadas) o la guitarra/instrumento (chroma). */
  source: "voz" | "instrumento";
}

/** Una nota de la melodía. Tiempos en segundos RELATIVOS al inicio del pasaje. */
export interface MelodyNote {
  /** MIDI entero (60 = Do4), ya corregido por la afinación de la sesión. */
  midi: number;
  start: number;
  end: number;
  /** Desvío medio respecto al semitono (−50..50). */
  cents: number;
}

/**
 * Vocal de un fonema tarareado. "m" = boca cerrada (el "mmm" del tarareo): no
 * es vocal, pero es lo que se oyó y la letra puede querer respetarlo.
 */
export type Vowel = "a" | "e" | "i" | "o" | "u" | "m";

/**
 * Una sílaba cantada anclada a la melodía. Si cubre 2+ notas con cambio de
 * altura, ES UN MELISMA: varias notas sobre una sola sílaba.
 */
export interface SungSyllable {
  /** Lo que se cantó ("na", "quie", "ro", "dun"…). */
  text: string;
  start: number;
  end: number;
  /** Índices en `notes` que caen dentro de la sílaba. */
  noteIdx: number[];
  /** Altura dominante (MIDI) — la nota más larga de la sílaba; null si no hubo altura estable. */
  midi: number | null;
  /** Sílaba tónica de su palabra (o nota larga/alta en rellenos). */
  stressed: boolean;
  /** Relleno sin letra (na, dun, uh, la, ti, mm, oh, yeah…). */
  filler: boolean;
  /** 2+ notas distintas sobre esta sílaba. */
  melisma: boolean;
  /** Índice de la palabra de origen dentro de la frase. */
  word: number;
  /** Voz de la diarización, si se sabe: una frase se corta al cambiar de voz. */
  speaker?: string;
  /**
   * Solo en melismas: sus notas recortadas al tramo de la sílaba, en orden. Al
   * "silabizar", cada una se vuelve una sílaba con su propia duración y acento.
   */
  parts?: { midi: number; start: number; end: number }[];
  /** Vocal del fonema: del texto del relleno ("na" → a) o, sin texto, estimada por formantes. */
  vowel?: Vowel;
  vowelSource?: "texto" | "formantes";
  /** Posición en la rejilla (solo tomas grabadas sobre la pista). */
  metric?: { absStep: number; weight: number };
}

export type LineEnding = "aguda" | "llana" | "esdrujula";

/** Cómo tratar los melismas al pedir letra. */
export type MelismaMode =
  /** Una sílaba se estira sobre toda la corrida (pide vocal abierta a/o/e ahí). */
  | "respetar"
  /** Cada nota de la corrida recibe su propia sílaba (más palabras). */
  | "silabizar";

/**
 * El MOLDE de una frase: lo que la melodía le pide a una letra. Es medida, no
 * autoría — como un metrónomo.
 */
export interface PhraseMold {
  /** Sílabas que la letra debe cantar (ya con el modo de melisma aplicado). */
  syllables: number;
  /** Posiciones (1-based) de las sílabas acentuadas por la melodía. */
  stresses: number[];
  ending: LineEnding;
  /** Melismas: en qué sílaba (1-based), cuántas notas, cuánto dura. */
  melismas: { pos: number; notes: number; dur: number }[];
  /** Posiciones (1-based) de notas largas (≥0,6 s) — piden vocal abierta. */
  long: number[];
  /** Letra de rima (A, B…) si el humano fijó un esquema. */
  rhyme?: string;
  /** Por posición (índice = pos − 1): lo que la melodía y el tarareo piden en cada sílaba. */
  slots?: MoldSlotInfo[];
}

/** Lo que pide UNA posición del molde. Sirve para el eco fonético y los malacentos. */
export interface MoldSlotInfo {
  /** Vocal que se tarareó ahí (solo en rellenos/tarareo; en palabras reales no se exige). */
  vowel?: Vowel;
  /** Peso métrico 0..4 (4 = primer tiempo). Sin rejilla: 3 si es acento de la melodía, 1 si no. */
  weight?: number;
  /** Largo en semicorcheas (solo con rejilla). */
  len16?: number;
  /** Duración en segundos. */
  dur: number;
  long: boolean;
  filler: boolean;
  /** Notas del melisma en esta posición (modo respetar). */
  melismaNotes?: number;
}

export interface Phrase {
  idx: number;
  start: number;
  end: number;
  /** Lo que se cantó en la frase (palabras reales y rellenos). */
  text: string;
  syllables: SungSyllable[];
  /** Molde calculado con `melismaMode: "respetar"`. */
  mold: PhraseMold;
  /** Corrección humana del molde (si existe, manda sobre `mold`). */
  override?: Partial<Pick<PhraseMold, "syllables" | "ending" | "rhyme">>;
}

// ─────────────────────────── Sesiones ───────────────────────────

/** Etapas del procesamiento de una sesión, en orden. */
/**
 * El resumen va justo después de transcribir: sus líneas de letra (literales,
 * con su momento) alimentan la detección de pasajes — la pista que cierra las
 * omisiones del audio (una frase cantada sin evento, sin relleno ni repetición).
 */
export const SESSION_STAGES = [
  "copiar",
  "audio",
  "transcribir",
  "resumen",
  "pasajes",
  "separar",
  "melodia",
] as const;
export type SessionStage = (typeof SESSION_STAGES)[number];

export const SESSION_STAGE_LABEL: Record<SessionStage, string> = {
  copiar: "Copiar al disco",
  audio: "Extraer audio",
  transcribir: "Transcribir y separar voces",
  pasajes: "Detectar pasajes cantados",
  separar: "Aislar la voz",
  melodia: "Melodía, sílabas y tonalidad",
  resumen: "Resumen de la sesión",
};

export interface StageState {
  stage: SessionStage;
  status: "pendiente" | "corriendo" | "listo" | "error" | "omitido";
  /** Detalle real ("3 de 12 pasajes", "4,7 GB verificados"). */
  detail?: string;
  /** 0..1 si la etapa sabe cuánto lleva. */
  pct?: number;
  startedAt?: string;
  endedAt?: string;
  error?: string;
}

export interface SessionSpeaker {
  /** Id del diarizador ("speaker_0"). */
  id: string;
  /** Nombre visible — lo pone el humano ("Voz 1" por defecto). */
  name: string;
  /** Segundos hablados + cantados. */
  seconds: number;
  /** Segundos dentro de pasajes cantados. */
  singingSeconds: number;
  /** Si el humano unió esta voz a otra (la diarización parte a una persona en dos). */
  mergedInto?: string;
}

export type PassageKind = "letra" | "melisma" | "silabas" | "rap" | "mixto";

/** Un pasaje cantado = un MEMO. Tiempos en segundos de la SESIÓN. */
export interface Passage {
  id: string;
  /** "P01"… estable dentro de la sesión. */
  label: string;
  start: number;
  end: number;
  speaker?: string;
  /** Lo que se cantó (de la transcripción), con rellenos. */
  text: string;
  kind: PassageKind;
  /** Puntaje de detección 0..1. */
  confidence: number;
  group: "probable" | "dudoso" | "descartado";
  /** Por qué se detectó ("evento [canta]", "relleno na/dun ×6", "se repite 3×", "melodía estable 81%"). */
  evidence: string[];
  origin: "auto" | "manual" | "resumen";
  /**
   * El humano lo tocó (etiqueta, grupo, voz o tramo). Re-detectar pasajes
   * conserva los editados igual que los manuales: su trabajo no se tira.
   */
  edited?: boolean;
  status: "pendiente" | "analizando" | "listo" | "error";
  error?: string;
  /** Resumen para la lista (el detalle vive en PassageAnalysis). */
  key?: KeyCandidate;
  melismas?: number;
  syllables?: number;
}

export interface SessionSummary {
  /** Título de trabajo de la canción que están escribiendo, si se dijo. */
  workingTitle?: string;
  /** De qué va la canción, en una o dos frases. */
  theme: string;
  /** Líneas que escribieron o cantaron como letra — LITERALES, con su momento. */
  lines: { text: string; at: number; speaker?: string; section?: string }[];
  /** Ideas de estructura ("esto es intro", "el coro tiene que ser chicle"). */
  structure: { section: string; idea: string; at?: number }[];
  /** Decisiones tomadas ("rima ABBA consonante", "respuesta tipo pregón"). */
  decisions: { text: string; at?: number }[];
  /** Lo que quedó pendiente. */
  pending: { text: string; at?: number }[];
  generatedAt: string;
}

export interface ComposeSession {
  /** Slug estable: "2026-09-23-ensayo-del-coro". */
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  /** Fecha de grabación (del archivo de la cámara). */
  recordedAt?: string;
  source: {
    /** Ruta de donde se importó (la SD puede ya no estar montada). */
    path: string;
    name: string;
    bytes: number;
    /** md5 verificado de la copia (si se copió). */
    md5?: string;
    kind: "camara" | "archivo" | "microfono";
  };
  /** Carpeta de medios de la sesión: {crudos, assets, analisis}. */
  mediaDir: string;
  mediaRoot: "disco" | "local";
  /** Rutas RELATIVAS a mediaDir. */
  files: {
    original?: string;
    audio?: string;
  };
  durationSec?: number;
  video?: { width: number; height: number; codec: string; fps?: number };
  language: "es" | "en" | "auto";
  status: "procesando" | "lista" | "error" | "detenida";
  stages: StageState[];
  speakers: SessionSpeaker[];
  passages: Passage[];
  /**
   * Último número de pasaje asignado (P01 → 1). Los ids NUNCA se reusan: un
   * pasaje borrado por una re-detección deja su número quemado, así una
   * referencia vieja (tablero, tema, montaje) no apunta a otro tramo.
   */
  passageSeq?: number;
  summary?: SessionSummary;
  /** Tonalidad de la sesión (la guitarra manda; la voz valida). */
  key?: KeyEstimate;
  /** Afinación medida de la sesión en cents (−19 = La≈434 Hz). */
  tuningCents?: number;
  /** Canción vinculada del tablero. */
  songId?: string;
  /** Si es una TOMA de un tema (grabada sobre su pista). Las sesiones normales no lo traen. */
  take?: TakeMeta;
}

/** Lo liviano para la lista de sesiones. */
export type ComposeSessionSummary = Pick<
  ComposeSession,
  "id" | "title" | "createdAt" | "updatedAt" | "recordedAt" | "durationSec" | "status" | "songId" | "mediaRoot"
> & {
  stage?: StageState;
  passages: number;
  probable: number;
  key?: KeyCandidate;
  source: ComposeSession["source"];
  take?: Pick<TakeMeta, "temaId" | "sectionId" | "n" | "favorite">;
};

// ─────────────────────────── Análisis de un pasaje ───────────────────────────

export interface PassageAnalysis {
  sessionId: string;
  passageId: string;
  version: 1;
  analyzedAt: string;
  /**
   * El tramo de la SESIÓN que se analizó (segundos). Si el pasaje ya no mide
   * esto, el análisis es de un tramo viejo. Los análisis anteriores a este
   * campo no lo traen.
   */
  span?: { start: number; end: number };
  /** Sobre qué se midió la altura: voz aislada (lo normal) o la mezcla (si no hubo separación). */
  source: "voz" | "mezcla";
  tuningCents: number;
  /** Curva de altura para dibujar: MIDI con decimales cada `hop` segundos; null = sin voz. */
  hop: number;
  f0: (number | null)[];
  /** Picos de la onda del pasaje (0..1), ~400 cubetas. */
  peaks: number[];
  notes: MelodyNote[];
  phrases: Phrase[];
  /** Tonalidad por las notas cantadas. */
  key: KeyEstimate;
  /** Tonalidad por el instrumento del mismo tramo (si hubo stem). */
  instrumentKey?: KeyEstimate;
  range: { lo: number; hi: number };
  /** Archivos del pasaje, RELATIVOS a mediaDir ("analisis/P01/mezcla.wav"). */
  files: { mix: string; voice?: string; instrument?: string };
  /** Solo tomas grabadas sobre la pista: la lectura en compás/tiempo. */
  grid?: GridAnalysis;
}

// ─────────────────────────── Letras ───────────────────────────

/** Qué tan bien calza una línea con el molde de su frase. Medida aproximada. */
export interface LineFit {
  /** Sílabas métricas de la línea (con sinalefas posibles aplicadas al mínimo). */
  syllables: number;
  /** Rango posible según se hagan o no las sinalefas. */
  range: [number, number];
  target: number;
  syllablesOk: boolean;
  ending: LineEnding;
  endingOk: boolean;
  /** Acentos de la línea que caen en acentos de la melodía / acentos del molde. */
  stressHits: number;
  stressTotal: number;
  /** En modo "respetar": ¿la sílaba del melisma lleva vocal abierta (a/o/e)? null si no hay melisma. */
  melismaVowelOk: boolean | null;
  /** 0..1 — el número que ordena. */
  score: number;
  /** Consejo corto si no calza ("sobra 1 sílaba: 'me van a' → 'van a'"). */
  hint?: string;
  /**
   * Eco fonético: cuánto conserva la línea las vocales del TARAREO en las
   * posiciones de relleno, ponderado por duración (0..1). Solo si el molde
   * trae `slots` con vocales.
   */
  echo?: { score: number; perSlot: { pos: number; want: Vowel; got: Vowel | null; sim: number; w: number }[] };
  /** Tónicas de la línea que caen en posición débil y corta (se oyen mal acentuadas). */
  misaccents?: { pos: number; syl: string }[];
  /** Las sílabas de la lectura elegida (con sinalefas), para alinear y cantar. */
  reading?: string[];
}

export interface LyricLine {
  /** Índice de la frase del molde. */
  phrase: number;
  text: string;
  /** El porqué de esta línea (visible en la UI). */
  why?: string;
  fit: LineFit;
}

export interface LyricVersion {
  id: string;
  /** El ángulo de la versión ("desamor sin clichés", "respuesta tipo pregón"…). */
  angle: string;
  lines: LyricLine[];
  createdAt: string;
  brief?: string;
  melismaMode: MelismaMode;
  /**
   * De un análisis anterior: sus `phrase` apuntan a frases que un re-análisis
   * movió. Se conserva para leerla, pero su número de frase ya no es el de hoy.
   */
  stale?: boolean;
}

/** Una línea de "Tu versión". */
export interface MineLine {
  phrase: number;
  text: string;
  from?: string;
  /**
   * De un análisis anterior: la frase `phrase` de hoy es otro tramo. El texto
   * se guarda tal cual y NO se reasigna a otra frase (la UI lo muestra aparte).
   */
  stale?: boolean;
}

/** El tablero de letras de un pasaje. */
export interface LyricBoard {
  sessionId: string;
  passageId: string;
  versions: LyricVersion[];
  /** "Tu versión": se arma con clics sobre las versiones o escribiendo. */
  mine: MineLine[];
  /** Frases bloqueadas (no se regeneran). Un re-análisis que mueve las frases las suelta. */
  locked: number[];
  /**
   * Firma de las frases (phraseSignature) del análisis sobre el que se
   * escribieron `mine`, `locked` y `versions`. Si el análisis vigente tiene
   * otra, lo anterior queda marcado `stale` (reconcileLyricBoard).
   */
  phrasesSig?: string;
  brief?: string;
  persona?: string;
  /** Esquema de rima pedido ("ABBA", "ABAB", "AABB", "libre"). */
  rhyme?: string;
  melismaMode: MelismaMode;
  updatedAt: string;
}

export interface LyricRequest {
  /** Cuántas versiones nuevas (1..8; más de 5 van en dos tandas con ángulos distintos). */
  count: number;
  /** Tema de la toma: su intención, pista y sección entran al contexto. */
  temaId?: string;
  brief?: string;
  persona?: string;
  rhyme?: string;
  melismaMode: MelismaMode;
  /** Canción destino (contexto: tonalidad, semilla, letra existente, referencias enlazadas). */
  songId?: string;
  /** Frases que NO se tocan (sus textos de "Tu versión" viajan como contexto). */
  locked?: number[];
  /** Solo estas frases (regenerar las que no calzan). */
  onlyPhrases?: number[];
}

// ─────────────────────────── Letras ↔ análisis (alineación) ───────────────────────────

type PhraseLayoutSource = Pick<PassageAnalysis, "phrases" | "span">;

/**
 * Firma de las frases de un análisis: cuántas y dónde caen. Con `span`, en
 * segundos de la SESIÓN (mover el inicio del pasaje sin mover las frases no
 * la cambia); sin él (análisis viejos), relativa al pasaje. Décimas de
 * segundo: un re-análisis del mismo audio no la mueve por un cuadro de 10 ms.
 * `analyzedAt` NO entra a propósito: re-analizar sin mover las frases no
 * debe marcar como viejo lo que el humano escribió.
 */
export function phraseSignature(a: PhraseLayoutSource, mode: "auto" | "rel" = "auto"): string {
  const abs = mode === "auto" && !!a.span;
  const off = abs ? a.span!.start : 0;
  const spans = a.phrases.map((ph) => `${ph.idx}@${(off + ph.start).toFixed(1)}-${(off + ph.end).toFixed(1)}`);
  return `${abs ? "abs" : "rel"}|${a.phrases.length}|${spans.join(",")}`;
}

/** ¿Mismas frases en los dos análisis? Si alguno es viejo (sin `span`), se comparan relativas al pasaje. */
export function samePhraseLayout(a: PhraseLayoutSource, b: PhraseLayoutSource): boolean {
  const mode = a.span && b.span ? "auto" : "rel";
  return phraseSignature(a, mode) === phraseSignature(b, mode);
}

/**
 * Alinea un tablero de letras con la firma de frases VIGENTE (muta `board`;
 * devuelve si cambió algo). Si el tablero se escribió sobre otras frases, sus
 * líneas NO se reasignan por índice a frases que ahora son otro tramo: `mine`
 * y `versions` quedan `stale` (se conservan para leer) y `locked` se suelta.
 * Un tablero sin firma (anterior a este campo) adopta la vigente: no hay de
 * dónde saber que se movió. `boardSig` permite pasar la firma real cuando se
 * conoce por otro lado (el análisis que se está reemplazando).
 */
export function reconcileLyricBoard(board: LyricBoard, sig: string, boardSig = board.phrasesSig): boolean {
  if (boardSig === undefined || boardSig === sig) {
    if (board.phrasesSig === sig) return false;
    board.phrasesSig = sig;
    return true;
  }
  board.mine = board.mine.map((m) => (m.stale ? m : { ...m, stale: true }));
  board.versions = board.versions.map((v) => (v.stale ? v : { ...v, stale: true }));
  board.locked = [];
  board.phrasesSig = sig;
  return true;
}

// ─────────────────────────── Guía cantada ───────────────────────────

/** Pedir la guía cantada de unas líneas sobre la melodía de un pasaje/toma. */
export interface GuideRequest {
  lines: { phrase: number; text: string }[];
  mode: MelismaMode;
  /** "notas" = alturas limpias de la melodía; "tarareo" = el contorno real del tarareo (vibrato, ligaduras). */
  pitch: "notas" | "tarareo";
  semitones?: number;
  voiceId?: string;
}

export interface GuideResult {
  /** Archivo RELATIVO a mediaDir (servido por /file). */
  path: string;
  engine: "psola";
  voiceId: string;
  sr: number;
  /** Sílabas con su tiempo dentro del pasaje (karaoke). */
  syllables: { phrase: number; text: string; start: number; end: number }[];
  /** Caracteres cobrados al TTS en esta llamada (0 = todo salió de la caché). */
  ttsChars: number;
  cached: boolean;
  warnings: string[];
}

// ─────────────────────────── Fuentes para importar ───────────────────────────

export interface MediaFileInfo {
  path: string;
  name: string;
  bytes: number;
  mtime: string;
  kind: "video" | "audio";
  durationSec?: number;
}

/** Una cámara montada (volumen con DCIM). */
export interface CameraSource {
  volume: string;
  /** Carpeta donde están los clips (p.ej. /Volumes/SD_Card/DCIM/DJI_001). */
  dir: string;
  files: MediaFileInfo[];
}

export interface MediaBrowse {
  dir: string;
  parent: string | null;
  entries: ({ kind: "dir"; name: string; path: string } | ({ kind: "video" | "audio" } & MediaFileInfo))[];
}

/**
 * RUTAS DEL AGENTE (todas bajo auth; `HERMES_COMPOSICION=off` las apaga con 404).
 * Errores: `{ error }` con status. Acciones: `{ ok, error? }`.
 *
 *  GET    /composicion/board                          → ComposicionBoard | 404 {error:"sin tablero"}
 *  PUT    /composicion/board        ComposicionBoard & {baseUpdatedAt?: string} → ComposicionBoard
 *         (valida; 400 con motivo). Concurrencia optimista: `baseUpdatedAt` = el `updatedAt` del
 *         tablero que el cliente VIO. Si viene y el vigente es otro (otra pestaña, o el agente
 *         escribió — p.ej. "crear canción desde la sesión") → 409 {error:"el tablero cambió",
 *         board: <el vigente>} y NO se escribe nada: el cliente fusiona y reintenta con el
 *         `updatedAt` de ese board. Sin `baseUpdatedAt` se acepta (compatibilidad: último gana).
 *         Sin tablero en disco todavía, se acepta siempre. La respuesta trae SIEMPRE el
 *         `updatedAt` nuevo (estrictamente mayor que el anterior): es la base del próximo PUT.
 *  GET    /composicion/sources                        → { cameras: CameraSource[]; mediaRoot: string; connected: boolean }
 *  GET    /composicion/browse?dir=                    → MediaBrowse (acotado a ~ y /Volumes; video + audio)
 *  GET    /composicion/sessions                       → ComposeSessionSummary[]
 *  POST   /composicion/sessions  {path,title?,language?,songId?} → ComposeSession (arranca el procesamiento)
 *  POST   /composicion/sessions/record   multipart{audio,title?} → ComposeSession (memo del micrófono)
 *  GET    /composicion/sessions/:id                   → ComposeSession
 *  PATCH  /composicion/sessions/:id  {title?,songId?,speakers?:{id,name?,mergedInto?}[]} → ComposeSession
 *  POST   /composicion/sessions/:id/process {from?:SessionStage} → {ok}   (reanudar / reintentar)
 *  POST   /composicion/sessions/:id/stop              → {ok}
 *  POST   /composicion/sessions/:id/reveal            → {ok}             (Finder)
 *  GET    /composicion/sessions/:id/transcript        → { lines: {speaker,start,end,text,sung:boolean}[] }
 *  GET    /composicion/sessions/:id/peaks             → { peaks: number[]; durationSec: number }
 *  GET    /composicion/sessions/:id/file?path=        → el archivo (Range/206; `?key=` vale en GET)
 *  POST   /composicion/sessions/:id/song              → Song (crea la canción en el tablero desde el resumen)
 *  POST   /composicion/sessions/:id/passages {start,end,speaker?} → Passage (manual; se analiza)
 *         Una TOMA (sesión con `take`) → 409 {error:"una toma tiene un solo pasaje"}.
 *  PATCH  /composicion/sessions/:id/passages/:pid {start?,end?,label?,group?,speaker?} → Passage
 *         (marca `edited`; cambiar el tramo re-analiza). En una TOMA → 409 (mismo motivo).
 *  POST   /composicion/sessions/:id/passages/:pid/analyze → {ok}
 *  GET    /composicion/sessions/:id/passages/:pid     → PassageAnalysis
 *  PATCH  /composicion/sessions/:id/passages/:pid/mold {phrase, override} → PassageAnalysis
 *  POST   /composicion/sessions/:id/passages/:pid/transpose {semitones, source:"voz"|"mezcla"} → { path }
 *  GET    /composicion/sessions/:id/passages/:pid/lyrics → LyricBoard
 *         (alineado al análisis vigente: si un re-análisis movió las frases, `mine` y `versions`
 *         vienen con `stale: true` y `locked` vacío; `phrasesSig` = la firma vigente)
 *  POST   /composicion/sessions/:id/passages/:pid/lyrics  LyricRequest → LyricBoard (síncrono, ~30-90 s; abortable)
 *         Solo AGREGA versiones: brief/persona/rhyme/locked/melismaMode del tablero no se tocan
 *         (se guardan por PUT). Si el análisis cambió mientras generaba, las nuevas llegan `stale`.
 *  PUT    /composicion/sessions/:id/passages/:pid/lyrics  {mine?,locked?,brief?,persona?,rhyme?,melismaMode?,phrasesSig?} → LyricBoard
 *         `mine[].stale` se respeta tal cual. `phrasesSig` (opcional) = la firma que el cliente
 *         vio: si ya no es la vigente, las líneas de `mine` que manda se guardan `stale` y su
 *         `locked` se ignora (nunca se enganchan a la frase equivocada).
 *  GET    /composicion/privacy                        → PrivacyInfo
 *
 *  TEMAS (la máquina de temas; ver tema.ts):
 *  GET    /composicion/temas                          → TemaListItem[]
 *  POST   /composicion/temas  {title?, fromPassage?: MemoRef} → Tema (prellena tonalidad medida + bpm estimado aprox.)
 *  GET    /composicion/temas/:id                      → TemaDetail
 *  PATCH  /composicion/temas/:id {title?,stage?,intent?,track?,montage?,songId?} → Tema (validateTema sobre el merge)
 *  DELETE /composicion/temas/:id                      → {ok}  (las tomas quedan en disco)
 *  POST   /composicion/temas/:id/takes  multipart{audio: WAV, meta: JSON (TakeMeta sin n)} → ComposeSession
 *  PATCH  /composicion/temas/:id/takes/:sid {favorite?, latencyMs?, hint?} → ComposeSession (latencia/hint → re-análisis)
 *  POST   /composicion/sessions/:id/passages/:pid/guide  GuideRequest → GuideResult (síncrono, abortable)
 *  GET    /composicion/guide/voices                   → { voices: {id,name,gender?,accent?}[] }
 */
export const COMPOSICION_ROUTES_DOC = true;

// ─────────────────────────── Privacidad ───────────────────────────

/**
 * Lo que la pastilla "Privado" muestra: la verdad sobre qué sale del equipo.
 * Composición es interna; si algo viaja a un servicio externo, se dice qué,
 * a quién y cuándo.
 */
export interface PrivacyInfo {
  /** /composicion/* rechaza lo que llega por el túnel (solo red local). */
  lanOnly: boolean;
  external: { what: string; to: string; when: string }[];
  local: string[];
}

// ─────────────────────────── Validación ───────────────────────────

export class ComposicionValidationError extends Error {}

/** El motivo del 409 del PUT del tablero (la web lo reconoce por el status, no por el texto). */
export const BOARD_CONFLICT_ERROR = "el tablero cambió";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Valida la forma mínima de un tablero (lo que la web manda en PUT). */
export function validateBoard(input: unknown): ComposicionBoard {
  if (!isObj(input)) throw new ComposicionValidationError("el tablero debe ser un objeto");
  const { songs, refs, notebook } = input;
  if (!Array.isArray(songs)) throw new ComposicionValidationError("songs debe ser una lista");
  if (!Array.isArray(refs)) throw new ComposicionValidationError("refs debe ser una lista");
  if (!Array.isArray(notebook)) throw new ComposicionValidationError("notebook debe ser una lista");
  const ids = new Set<string>();
  for (const s of songs) {
    if (!isObj(s) || typeof s.id !== "string" || typeof s.title !== "string")
      throw new ComposicionValidationError("cada canción necesita id y title");
    if (ids.has(s.id)) throw new ComposicionValidationError(`id de canción repetido: ${s.id}`);
    ids.add(s.id);
    // La tónica indexa tablas de 12 notas: 2.5 o 13 romperían el deletreo y la transposición.
    if (
      !isObj(s.key) ||
      !Number.isInteger(s.key.tonic) ||
      (s.key.tonic as number) < 0 ||
      (s.key.tonic as number) > 11 ||
      (s.key.mode !== "major" && s.key.mode !== "minor")
    )
      throw new ComposicionValidationError(`tonalidad inválida en «${s.title}»`);
    if (!Array.isArray(s.sections) || !s.sections.every((x) => isObj(x) && typeof x.id === "string"))
      throw new ComposicionValidationError(`secciones inválidas en «${s.title}»`);
  }
  if (!refs.every((r) => isObj(r) && typeof r.id === "string"))
    throw new ComposicionValidationError("cada referencia necesita id");
  if (!notebook.every((n) => isObj(n) && typeof n.id === "string"))
    throw new ComposicionValidationError("cada entrada del cuaderno necesita id");
  return {
    version: 1,
    songs: songs as Song[],
    refs: refs as Reference[],
    notebook: notebook as NotebookEntry[],
    updatedAt: typeof input.updatedAt === "string" ? input.updatedAt : new Date().toISOString(),
  };
}

/**
 * Slug de sesión: "2026-09-23-ensayo-del-coro" (fecha + título, sin acentos).
 * La fecha es la del CALENDARIO LOCAL: una sesión grabada a las 22:13 en
 * Bogotá es del 23, aunque en UTC ya sea el 24 (con toISOString la carpeta
 * quedaba con el día siguiente).
 */
export function sessionSlug(title: string, date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const d = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const t = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return t ? `${d}-${t}` : d;
}
