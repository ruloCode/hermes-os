/**
 * Tipos de COMPOSICIÓN (versión estática). Cuando pase a Supabase, estos
 * tipos se mueven a packages/shared y el provider hace el poll — la UI no
 * debería cambiar.
 */
import type { Key } from "@/lib/music-theory";

/** Etapas = FASES en curso, como en el Estudio: dónde está el trabajo hoy. */
export type SongStage = "idea" | "letra" | "armonia" | "melodia" | "demo" | "terminada";

export type SectionKind = "intro" | "verso" | "pre" | "coro" | "puente" | "final" | "instrumental";

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
  /** Tarareo: duración en segundos y picos de la onda (mock). */
  audio?: { seconds: number; peaks: number[] };
  /** Si ya se convirtió en canción. */
  songId?: string;
}

/** Sugerencia del copiloto: SIEMPRE con acción humana (usar / variar / descartar). */
export interface Suggestion {
  id: string;
  kind: "rima" | "verso" | "metafora" | "acorde" | "estructura" | "referencia" | "pregunta";
  title: string;
  body: string;
  /** Por qué lo sugiere (la razón se muestra, no se esconde). */
  why: string;
  /** A qué sección aplica. */
  sectionId?: string;
  options?: string[];
}

export interface ChatTurn {
  id: string;
  role: "tú" | "hermes";
  text: string;
  suggestions?: Suggestion[];
  at: string;
}
