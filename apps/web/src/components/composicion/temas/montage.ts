"use client";

/**
 * Lo que la MESA DE MONTAJE necesita saber de sus partes, fuera de la vista:
 *
 *  - `usePartMaterials`: por parte (toma o pasaje), su onda, y —solo para las
 *    que están en un hueco— su análisis (cuántas frases) y su tablero de letras
 *    ("Tu versión" y las versiones). Se relee al montar la etapa: la letra se
 *    edita en Letra y el conteo del detalle no ve un cambio de texto.
 *  - `useOtherTemas`: "De todos" — las tomas ★ de los OTROS temas, cargadas solo
 *    al pedirlas (o cuando un hueco ya usa una parte de otro tema).
 *  - `lyricFor`: qué letra lleva una parte según el pick (Tu versión por
 *    defecto, que la escribió el humano; una versión solo si se eligió).
 *  - `playEnsemble`: el tema entero (o un hueco) sección por sección con la voz
 *    de cada parte alineada a su compás 1 (`starts[i] − grid.downbeatSec`): el
 *    tarareo, la guía cantada de su letra (`loadGuide`, misma línea de tiempo
 *    que la toma) o las dos.
 *  - `buildApplyRequest`: una fila por sección para la hoja de Aplicar.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  GuideRequest,
  LyricBoard,
  MelismaMode,
  MemoRef,
  MontagePick,
  PassageAnalysis,
  TakeGrid,
  Tema,
  TemaCandidate,
  TemaSection,
  TemaTrack,
} from "@hermes/shared";
import type { TrackEngine } from "@/lib/track-engine";
import type { PlaygroundApi } from "../playground/api";
import type { ApplyRequest, ApplyRow } from "../playground/ApplySheet";
import { useTemasApi } from "./api";
import { useTemas } from "./TemasProvider";
import { barSecOf, localPeaks } from "./take-audio";

export const memoKey = (m: MemoRef): string => `${m.sessionId}:${m.passageId}`;
export const sameMemo = (a: MemoRef | undefined, b: MemoRef | undefined): boolean =>
  !!a && !!b && a.sessionId === b.sessionId && a.passageId === b.passageId;

/** Lo que cambia el material de una parte (si cambia, se relee). */
export const candidateRev = (c: TemaCandidate): string => `${c.status}|${c.lyrics.versions}|${c.lyrics.mine}`;

// ─────────────────────────── Material de las partes ───────────────────────────

export interface PartMaterial {
  peaks: number[] | null;
  /** Solo las partes que están en un hueco (hace falta cuántas frases tiene). */
  analysis: PassageAnalysis | null;
  board: LyricBoard | null;
  loading: boolean;
  error: string | null;
}

export interface PartEntry {
  memo: MemoRef;
  kind: TemaCandidate["kind"];
  rev: string;
  /** Está en un hueco: además de la onda, su análisis y su letra. */
  deep: boolean;
}

/** Lo último leído por parte: la etapa arranca con esto (sin parpadeo) y relee encima. */
const cache = new Map<string, { rev: string; deep: boolean; data: PartMaterial }>();

export function usePartMaterials(api: PlaygroundApi, entries: PartEntry[]): Record<string, PartMaterial> {
  const [state, setState] = useState<Record<string, PartMaterial>>(() => {
    const out: Record<string, PartMaterial> = {};
    for (const e of entries) {
      const c = cache.get(memoKey(e.memo));
      if (c) out[memoKey(e.memo)] = c.data;
    }
    return out;
  });
  /** Lo pedido en ESTE montaje de la etapa (clave → rev|deep): al volver a la etapa se relee todo. */
  const asked = useRef(new Map<string, string>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const sig = entries.map((e) => `${memoKey(e.memo)}@${e.rev}@${e.deep ? 1 : 0}`).join(",");

  useEffect(() => {
    for (const e of entries) {
      const key = memoKey(e.memo);
      const want = `${e.rev}|${e.deep ? 1 : 0}`;
      if (asked.current.get(key) === want) continue;
      asked.current.set(key, want);
      const prev = cache.get(key)?.data;
      setState((s) => ({ ...s, [key]: { ...(prev ?? emptyMaterial()), loading: true, error: null } }));
      void loadPart(api, e).then((data) => {
        cache.set(key, { rev: e.rev, deep: e.deep, data });
        // Solo si nadie pidió otra cosa para esta parte mientras tanto.
        if (mounted.current && asked.current.get(key) === want) setState((s) => ({ ...s, [key]: data }));
      });
    }
    // `sig` resume `entries` (clave + rev + deep): pedir solo cuando algo cambió de verdad.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, api]);

  return state;
}

const emptyMaterial = (): PartMaterial => ({ peaks: null, analysis: null, board: null, loading: false, error: null });

async function loadPart(api: PlaygroundApi, e: PartEntry): Promise<PartMaterial> {
  const { sessionId: sid, passageId: pid } = e.memo;
  const errs: string[] = [];
  const analysis = e.deep || e.kind === "pasaje"
    ? await api.analysis(sid, pid).catch((x: Error) => {
        errs.push(x.message);
        return null;
      })
    : null;
  const board = e.deep
    ? await api.lyrics(sid, pid).catch((x: Error) => {
        errs.push(x.message);
        return null;
      })
    : null;
  let peaks: number[] | null = null;
  if (e.kind === "toma") {
    // Una toma ES su pasaje: la onda de la sesión entera sirve (la local si se acaba de grabar).
    peaks = localPeaks.get(sid)?.peaks ?? (await api.peaks(sid).then((r) => r.peaks).catch(() => null));
  } else peaks = analysis?.peaks ?? null;
  if (!peaks?.length && analysis?.peaks.length) peaks = analysis.peaks;
  return { peaks, analysis, board, loading: false, error: errs[0] ?? null };
}

// ─────────────────────────── De todos: los otros temas ───────────────────────────

export interface OtherTema {
  tema: Tema;
  candidates: TemaCandidate[];
}

export interface OtherTemas {
  /** null = todavía no se pidió. */
  items: OtherTema[] | null;
  loading: boolean;
  error: string | null;
  /** Hay otros temas con tomas (sin cargarlos: sale de la lista). */
  available: boolean;
}

let othersCache: { key: string; items: OtherTema[] } | null = null;

/** Las tomas de los OTROS temas, cargadas solo cuando `enabled` (al pedir "De todos"). */
export function useOtherTemas(temaId: string, enabled: boolean): OtherTemas {
  const api = useTemasApi();
  const { temas } = useTemas();
  const others = useMemo(() => (temas ?? []).filter((t) => t.id !== temaId && t.takes > 0), [temas, temaId]);
  const key = others.map((t) => `${t.id}@${t.updatedAt}@${t.takes}`).join(",");
  const [items, setItems] = useState<OtherTema[] | null>(() => (othersCache?.key === key ? othersCache.items : null));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    setLoading(true);
    setError(null);
    Promise.allSettled(others.map((t) => api.get(t.id)))
      .then((res) => {
        if (!alive) return;
        const ok = res.flatMap((r) => (r.status === "fulfilled" ? [{ tema: r.value.tema, candidates: r.value.candidates }] : []));
        const failed = res.filter((r) => r.status === "rejected").length;
        othersCache = { key, items: ok };
        setItems(ok);
        setError(failed ? `${failed} ${failed === 1 ? "tema no respondió" : "temas no respondieron"}` : null);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // `key` resume la lista de otros temas (id + fecha + tomas).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key, api]);

  return { items: enabled ? items : (items ?? null), loading, error, available: others.length > 0 };
}

// ─────────────────────────── La letra de una parte ───────────────────────────

export interface LyricChoice {
  kind: "mine" | "version";
  versionId?: string;
  /** "Tu versión" / «ángulo». */
  label: string;
  /** Frases con texto, en orden. */
  lines: { phrase: number; text: string }[];
  /** Frases del molde (del análisis), si se sabe. */
  phrases: number | null;
  /** Calce medio de la versión (0..1). */
  score?: number;
  /** La versión elegida ya no está en el tablero. */
  missing?: boolean;
  /** …o está, pero es de un análisis anterior (las frases se movieron): no se usa tal cual. */
  stale?: boolean;
}

const byPhrase = (a: { phrase: number }, b: { phrase: number }) => a.phrase - b.phrase;

/** "Tu versión" de una parte (vacía = null). Las líneas de un análisis anterior (`stale`) no cuentan. */
export function mineOf(board: LyricBoard | null, analysis: PassageAnalysis | null): LyricChoice | null {
  const lines = (board?.mine ?? [])
    .filter((m) => !m.stale && m.text.trim())
    .sort(byPhrase)
    .map((m) => ({ phrase: m.phrase, text: m.text.trim() }));
  if (!lines.length) return null;
  return { kind: "mine", label: "Tu versión", lines, phrases: analysis?.phrases.length ?? null };
}

/** Las versiones de una parte como opciones de letra (sin las de un análisis anterior). */
export function versionsOf(board: LyricBoard | null, analysis: PassageAnalysis | null): LyricChoice[] {
  return (board?.versions ?? []).filter((v) => !v.stale).map((v) => {
    const lines = v.lines.filter((l) => l.text.trim()).sort(byPhrase);
    const score = lines.length ? lines.reduce((a, l) => a + l.fit.score, 0) / lines.length : undefined;
    return {
      kind: "version" as const,
      versionId: v.id,
      label: `«${v.angle}»`,
      lines: lines.map((l) => ({ phrase: l.phrase, text: l.text.trim() })),
      phrases: analysis?.phrases.length ?? null,
      score,
    };
  });
}

/**
 * La letra que lleva la parte de un hueco: la versión elegida; si no se eligió
 * ninguna, "Tu versión" (la escribió el humano). Una versión que desapareció
 * del tablero se dice, no se reemplaza en silencio.
 */
export function lyricFor(board: LyricBoard | null, analysis: PassageAnalysis | null, lyric: MontagePick["lyric"]): LyricChoice | null {
  if (lyric?.kind === "version") {
    const v = versionsOf(board, analysis).find((x) => x.versionId === lyric.versionId);
    if (v) return v;
    if (!board) return null;
    const stale = board.versions.some((x) => x.id === lyric.versionId && x.stale);
    return {
      kind: "version",
      versionId: lyric.versionId,
      label: "la versión elegida",
      lines: [],
      phrases: null,
      missing: true,
      ...(stale ? { stale: true } : {}),
    };
  }
  return mineOf(board, analysis);
}

// ─────────────────────────── Ensamble ───────────────────────────

/** La voz de una sección en el ensamble: su tarareo, su guía cantada, o las dos (misma rejilla). */
export interface EnsemblePart {
  grid: TakeGrid;
  take?: AudioBuffer | null;
  guide?: AudioBuffer | null;
}

/** Qué voz suena sobre la pista en el ensamble. */
export type EnsembleVoice = "tarareo" | "guia" | "ambos";

export interface EnsembleHandle {
  stop(): void;
  startAt: number;
  /** Compás 1 de cada sección (tiempo del AudioContext). */
  starts: number[];
  /** Duración de cada sección (s). */
  durs: number[];
  endAt: number;
}

/** La cola de la última sílaba de una parte, pasado el borde de su sección (s). */
const VOICE_TAIL = 0.4;

/**
 * Toca `sectionIds` en orden sobre la pista del tema (acordes y batería como
 * los dejó el transporte, sin clic: es para escuchar, no para ensayar) y
 * programa la voz de cada parte (tarareo, guía o las dos) en
 * el MISMO reloj: su compás 1 cae en el compás 1 de su sección. Si la toma es
 * de una vuelta del loop y la sección tiene varias, la toma se repite en cada
 * vuelta. La voz se corta al terminar su sección (más una cola corta).
 *
 * Antes del compás 1 va un silencio (no una cuenta de clic) del largo de la
 * anacrusa de la primera parte, para que entre entera.
 */
export function playEnsemble(
  engine: TrackEngine,
  opts: {
    track: TemaTrack;
    sectionIds: string[];
    parts: (EnsemblePart | null)[];
    chords?: boolean;
    groove?: boolean;
    onSection?: (i: number) => void;
    onEnd?: () => void;
  },
): EnsembleHandle | null {
  const ac = engine.context();
  if (!ac) return null;
  const { track } = opts;
  const barSec = barSecOf(track.bpm, track.meter);
  const sections = opts.sectionIds.map((id) => track.sections.find((s) => s.id === id)).filter((s): s is TemaSection => !!s);
  if (!sections.length) return null;
  const first = opts.parts[0];
  const lead = first && (first.take || first.guide) ? Math.max(0, first.grid.downbeatSec) : 0;
  let ended = false;
  const { startAt, starts, endAt } = engine.playSequence({
    track,
    sectionIds: sections.map((s) => s.id),
    leadSec: lead,
    loop: false,
    chords: opts.chords ?? true,
    groove: opts.groove ?? true,
    metronome: false,
    onSection: opts.onSection,
    onEnd: () => {
      if (ended) return;
      ended = true;
      opts.onEnd?.();
    },
  });
  if (!startAt) return null;
  const durs = sections.map((s) => s.bars * barSec);
  sections.forEach((sec, i) => {
    const part = opts.parts[i];
    if (!part) return;
    const takeBars = Math.max(1, part.grid.bars);
    const reps = Math.max(1, Math.floor(sec.bars / takeBars));
    const secEnd = starts[i] + durs[i];
    for (let r = 0; r < reps; r++) {
      // La guía vive en la línea de tiempo del pasaje (= la de la toma): cae en el mismo sitio.
      const at = starts[i] + r * takeBars * barSec - part.grid.downbeatSec;
      for (const [buf, bus] of [
        [part.take, "toma"],
        [part.guide, "guia"],
      ] as const) {
        if (!buf) continue;
        const src = engine.scheduleBuffer(buf, at, bus);
        try {
          src.stop(Math.max(at + 0.05, secEnd + VOICE_TAIL));
        } catch {
          /* ya programada o parada */
        }
      }
    }
  });
  return {
    stop: () => {
      ended = true;
      engine.stop();
    },
    startAt,
    starts,
    durs,
    endAt: endAt ?? startAt + durs.reduce((a, b) => a + b, 0),
  };
}

// ─────────────────────────── Guía cantada de una parte ───────────────────────────

/**
 * Las preferencias de la guía que el humano eligió en Letra (useGuide las
 * guarda en este navegador con estas claves): la misma voz y la misma altura.
 */
const GUIDE_VOICE_KEY = "hermes-guia-voz";
const GUIDE_PITCH_KEY = "hermes-guia-altura";

export function guidePrefs(): { voiceId?: string; pitch: GuideRequest["pitch"] } {
  try {
    const v = localStorage.getItem(GUIDE_VOICE_KEY);
    const p = localStorage.getItem(GUIDE_PITCH_KEY);
    return { ...(v ? { voiceId: v } : {}), pitch: p === "tarareo" ? "tarareo" : "notas" };
  } catch {
    return { pitch: "notas" };
  }
}

const guideBuffers = new Map<string, AudioBuffer>();

/**
 * La guía cantada de la letra de una parte, decodificada (en caché por pedido:
 * volver a tocar el ensamble no vuelve a pedirla). El agente cachea el habla
 * por línea, así que el costo se cobra una vez: `ttsChars` lo dice.
 */
export async function loadGuide(
  api: PlaygroundApi,
  ac: AudioContext,
  memo: MemoRef,
  lines: { phrase: number; text: string }[],
  mode: MelismaMode,
  signal?: AbortSignal,
): Promise<{ buffer: AudioBuffer; ttsChars: number }> {
  const req: GuideRequest = { lines, mode, semitones: 0, ...guidePrefs() };
  const key = JSON.stringify([memo.sessionId, memo.passageId, req]);
  const hit = guideBuffers.get(key);
  if (hit) return { buffer: hit, ttsChars: 0 };
  const res = await api.guide(memo.sessionId, memo.passageId, req, signal);
  const url = api.fileUrl(memo.sessionId, res.path);
  if (!url) throw new Error("El audio de la guía no está disponible desde aquí.");
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`No se pudo bajar el audio de la guía (${r.status}).`);
  let buffer: AudioBuffer;
  try {
    buffer = await ac.decodeAudioData(await r.arrayBuffer());
  } catch {
    throw new Error("El audio de la guía no se pudo decodificar.");
  }
  guideBuffers.set(key, buffer);
  return { buffer, ttsChars: res.cached ? 0 : res.ttsChars };
}

// ─────────────────────────── Aplicar ───────────────────────────

/** Los acordes del loop de una sección, en orden (un compás partido da dos). */
export const loopChords = (s: TemaSection): string[] => s.loop.flatMap((b) => b.chords.map((c) => c.symbol));

export interface ApplySlot {
  section: TemaSection;
  /** Elegida por el humano (una ★ propuesta NO cuenta). */
  chosen: MemoRef | null;
  partLabel: string | null;
  proposed: boolean;
  lyric: LyricChoice | null;
}

/**
 * Una fila por sección, en el orden del tema: letra elegida + acordes del loop +
 * compases + la melodía enlazada. Las secciones sin parte elegida van
 * desmarcadas (si se marcan, entran solo acordes y compases).
 */
export function buildApplyRequest(tema: Tema, slots: ApplySlot[]): ApplyRequest {
  const rows: ApplyRow[] = slots.map(({ section, chosen, partLabel, proposed, lyric }) => {
    const lines = chosen && lyric && !lyric.missing ? lyric.lines.map((l) => l.text) : [];
    return {
      id: section.id,
      payload: {
        label: section.label,
        kind: section.kind,
        lines,
        chords: loopChords(section),
        bars: section.bars,
        ...(chosen ? { link: { sessionId: chosen.sessionId, passageId: chosen.passageId, semitones: 0 } } : {}),
      },
      include: !!chosen,
      note: !chosen
        ? `${proposed ? "La ★ propuesta no está elegida" : "Sin parte elegida"}: si la marcas, entran solo los acordes y los compases.`
        : !lines.length
          ? `${partLabel ?? "La parte"} sin letra elegida: entran los acordes y la melodía enlazada.`
          : `${partLabel ?? "La parte"} · ${lyric!.label}`,
    };
  });
  return {
    origin: `el montaje de «${tema.title}»`,
    notePrefix: `Desde el tema «${tema.title}»`,
    rows,
    fromKey: tema.track.key,
    songId: tema.songId,
    newSong: {
      from: "desde el tema",
      title: tema.title,
      key: tema.track.key,
      tempo: tema.track.bpm,
      meter: tema.track.meter,
      seed: tema.intent.about,
    },
    footnote: "Cada sección queda enlazada a la toma de su melodía; la canción suma las sesiones de esas tomas.",
  };
}
