/**
 * Tipos de COMPOSICIÓN. Los del tablero (canciones, referencias, cuaderno) viven
 * en `@hermes/shared` (composicion.ts) desde que el agente los persiste y el
 * Playground los alimenta; aquí se re-exportan para no tocar a los importadores.
 * Solo quedan locales los del copiloto de prueba (sugerencias y turnos del chat).
 */
export type {
  ComposicionBoard,
  NotebookEntry,
  RefKind,
  Reference,
  SectionKind,
  SectionMemoLink,
  Song,
  SongSection,
  SongStage,
  SongVersion,
} from "@hermes/shared";

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
