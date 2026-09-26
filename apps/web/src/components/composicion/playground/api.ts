"use client";

/**
 * La API del Playground como INTERFAZ inyectable (PlaygroundApiCtx). La vista
 * real le habla al agente (`lib/hermes.ts`); una implementación en memoria
 * con datos SINTÉTICOS puede montarse encima para revisar la UI sin agente y
 * sin exponer nunca material real en el repo.
 */
import { createContext, useContext } from "react";
import type {
  ComposeSession,
  ComposeSessionSummary,
  GuideRequest,
  GuideResult,
  LyricBoard,
  LyricRequest,
  MediaBrowse,
  Passage,
  PassageAnalysis,
  PhraseMold,
  SessionStage,
  Song,
} from "@hermes/shared";
import {
  addComposePassage,
  analyzeComposePassage,
  browseComposeMedia,
  composeFileUrl,
  createComposeSession,
  createSongFromSession,
  generateLyrics,
  getComposePeaks,
  getComposeSession,
  getComposeSources,
  getComposeTranscript,
  getLyricBoard,
  getPassageAnalysis,
  listComposeSessions,
  listGuideVoices,
  patchComposePassage,
  patchComposeSession,
  patchPassageMold,
  processComposeSession,
  putLyricBoard,
  recordComposeSession,
  renderGuide,
  revealComposeSession,
  stopComposeSession,
  transposePassage,
  type ComposeSources,
  type ComposeTranscriptLine,
  type GuideVoice,
} from "@/lib/hermes";

export type { ComposeSources, ComposeTranscriptLine, GuideVoice };

export type PassagePatch = Partial<Pick<Passage, "start" | "end" | "label" | "group" | "speaker">>;
/** Lo que viaja en el PUT de letras. `phrasesSig` = la firma de frases que se vio (ver useMemoData). */
export type LyricBoardPatch = Partial<
  Pick<LyricBoard, "mine" | "locked" | "brief" | "persona" | "rhyme" | "melismaMode" | "phrasesSig">
>;

export interface PlaygroundApi {
  listSessions(): Promise<ComposeSessionSummary[]>;
  sources(): Promise<ComposeSources>;
  browse(dir?: string): Promise<MediaBrowse>;
  createSession(input: {
    path: string;
    title?: string;
    language?: ComposeSession["language"];
    songId?: string;
  }): Promise<ComposeSession>;
  recordSession(input: { blob: Blob; title?: string; language?: ComposeSession["language"] }): Promise<ComposeSession>;
  getSession(id: string): Promise<ComposeSession>;
  patchSession(
    id: string,
    patch: {
      title?: string;
      songId?: string | null;
      speakers?: { id: string; name?: string; mergedInto?: string | null }[];
    },
  ): Promise<ComposeSession>;
  process(id: string, from?: SessionStage): Promise<unknown>;
  stop(id: string): Promise<unknown>;
  reveal(id: string): Promise<unknown>;
  transcript(id: string): Promise<{ lines: ComposeTranscriptLine[] }>;
  peaks(id: string): Promise<{ peaks: number[]; durationSec: number }>;
  fileUrl(id: string, relPath: string): string;
  createSong(id: string): Promise<Song>;
  addPassage(id: string, body: { start: number; end: number; speaker?: string }): Promise<Passage>;
  patchPassage(id: string, pid: string, patch: PassagePatch): Promise<Passage>;
  analyze(id: string, pid: string): Promise<unknown>;
  analysis(id: string, pid: string): Promise<PassageAnalysis | null>;
  patchMold(
    id: string,
    pid: string,
    body: { phrase: number; override: Partial<Pick<PhraseMold, "syllables" | "ending" | "rhyme">> },
  ): Promise<PassageAnalysis>;
  transpose(id: string, pid: string, body: { semitones: number; source: "voz" | "mezcla" }): Promise<{ path: string }>;
  lyrics(id: string, pid: string): Promise<LyricBoard | null>;
  generate(id: string, pid: string, req: LyricRequest, signal?: AbortSignal): Promise<LyricBoard>;
  putLyrics(id: string, pid: string, patch: LyricBoardPatch): Promise<LyricBoard>;
  /** Guía cantada (voz sintética sobre la melodía): el WAV se baja con `fileUrl(id, result.path)`. */
  guide(id: string, pid: string, req: GuideRequest, signal?: AbortSignal): Promise<GuideResult>;
  guideVoices(signal?: AbortSignal): Promise<GuideVoice[]>;
}

export const realPlaygroundApi: PlaygroundApi = {
  listSessions: listComposeSessions,
  sources: getComposeSources,
  browse: browseComposeMedia,
  createSession: createComposeSession,
  recordSession: recordComposeSession,
  getSession: getComposeSession,
  patchSession: patchComposeSession,
  process: processComposeSession,
  stop: stopComposeSession,
  reveal: revealComposeSession,
  transcript: getComposeTranscript,
  peaks: getComposePeaks,
  fileUrl: composeFileUrl,
  createSong: createSongFromSession,
  addPassage: addComposePassage,
  patchPassage: patchComposePassage,
  analyze: analyzeComposePassage,
  analysis: getPassageAnalysis,
  patchMold: patchPassageMold,
  transpose: transposePassage,
  lyrics: getLyricBoard,
  generate: generateLyrics,
  putLyrics: putLyricBoard,
  guide: renderGuide,
  guideVoices: listGuideVoices,
};

export const PlaygroundApiCtx = createContext<PlaygroundApi>(realPlaygroundApi);

export function usePlaygroundApi(): PlaygroundApi {
  return useContext(PlaygroundApiCtx);
}

/**
 * ¿La vista está a la vista? El AppShell mantiene montada /composicion al
 * navegar a otra ruta (display:none), así que los atajos de teclado tienen que
 * saber si les toca: sin esto, Espacio en /finanzas reproducía un memo oculto.
 */
export const ViewActiveCtx = createContext(true);

export function useViewActive(): boolean {
  return useContext(ViewActiveCtx);
}
