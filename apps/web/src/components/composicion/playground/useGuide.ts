"use client";

/**
 * GUÍA CANTADA de unas líneas sobre la melodía de un pasaje: el agente la
 * renderiza (TTS de ElevenLabs con tiempos por carácter + PSOLA local, voz
 * GENÉRICA) y aquí se baja el WAV, se decodifica y suena en el MISMO
 * AudioContext que la pista:
 *
 *  - En un TEMA (hay `onTrack`): la pista con la que se grabó la toma (su
 *    tempo, compás y loop — no los de hoy) + la guía programada con
 *    `engine.scheduleBuffer(buf, startAt − grid.downbeatSec + inicio del
 *    pasaje, "guia")`, así cae sobre la pista a nivel de muestra. "▶ todo"
 *    va en loop (la guía se reprograma en cada vuelta); una fila suena una
 *    vez desde su compás, con la cuenta justa para su anacrusa.
 *  - En una SESIÓN (sin pista): la guía sola.
 *
 * Es una GUÍA (voz sintética que muestra dónde cae cada sílaba), no un demo:
 * la UI lo rotula siempre. El costo es honesto: `ttsChars` de la llamada, y
 * "de caché, sin costo" cuando no se cobró nada (cambiar altura o modo no
 * vuelve a cobrar el TTS: el agente cachea el habla por línea).
 *
 * El karaoke NO es estado por cuadro: `clock()` lee el reloj de audio por ref
 * y cada sílaba se enciende desde un rAF (ver GuideKaraoke).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GuideRequest, GuideResult, MelismaMode, TakeGrid, TemaTrack } from "@hermes/shared";
import { ComposeApiError } from "@/lib/hermes";
import { getTrackEngine, type TrackEngine } from "@/lib/track-engine";
import { barSecOf, trackOfTake } from "../temas/take-audio";
import { transportStore } from "../temas/transport-settings";
import type { GuideVoice, PlaygroundApi } from "./api";

export interface GuideTarget {
  sessionId: string;
  passageId: string;
  /** Segundo del audio de la toma/sesión donde empieza el pasaje (0 en una toma). */
  passageStart: number;
  /** Semitonos de la guía (en Sesiones, los del memo hacia la canción). */
  semitones?: number;
  /** Solo en un Tema: la pista con que se grabó la toma. Sin esto, la guía suena sola. */
  onTrack?: { base: TemaTrack; sectionId: string; grid: TakeGrid; engine?: TrackEngine };
}

export type GuidePitch = GuideRequest["pitch"];
export type GuideLine = { phrase: number; text: string };

export interface GuideProblem {
  kind: "clave" | "cuota" | "voz" | "red" | "otro";
  message: string;
}

export interface GuidePlaying {
  run: number;
  /** Quién la pidió ("todo" = el botón de toda tu versión). */
  tag?: string;
  /** Lo que se está cantando (frase + texto: el karaoke solo va donde el texto coincide). */
  lines: GuideLine[];
  phrases: number[];
  loop: boolean;
  onTrack: boolean;
  syllables: GuideResult["syllables"];
}

export interface GuideCost {
  ttsChars: number;
  /** Nada se cobró (caché del agente o de esta página). */
  free: boolean;
  lines: number;
}

const VOICE_KEY = "hermes-guia-voz";
const PITCH_KEY = "hermes-guia-altura";

const lsGet = (k: string): string | null => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const lsSet = (k: string, v: string | null) => {
  try {
    if (v == null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* sin almacenamiento: vive hasta recargar */
  }
};

// ─────────── Cachés de la página (no del componente: cambiar de etapa no las tira) ───────────

/** Por implementación de la API (la maqueta de /dev y el agente real no comparten voces). */
const voicesPromises = new WeakMap<PlaygroundApi, Promise<GuideVoice[]>>();
const results = new Map<string, GuideResult>();
const buffers = new Map<string, AudioBuffer>();
const BUFFER_CAP = 16;

function remember<K, V>(m: Map<K, V>, k: K, v: V, cap: number) {
  m.delete(k);
  m.set(k, v);
  while (m.size > cap) m.delete(m.keys().next().value as K);
}

/** Error del agente → lo que la UI dice (y si hay que pedir una voz). */
export function guideProblem(e: unknown): GuideProblem | null {
  if ((e as Error)?.name === "AbortError") return null;
  const msg = ((e as Error)?.message || "la guía no se pudo cantar").trim();
  const st = e instanceof ComposeApiError ? e.status : -1;
  if (st === 0) return { kind: "red", message: "El agente no responde: la guía no se pudo pedir." };
  if (st === 503) {
    if (/ELEVENLABS_API_KEY/i.test(msg))
      return { kind: "clave", message: "Falta la clave de ElevenLabs en el agente (ELEVENLABS_API_KEY): sin ella no hay guía cantada." };
    if (/401|rechaz/i.test(msg)) return { kind: "clave", message: `ElevenLabs rechazó la clave del agente. ${msg}` };
    return { kind: "otro", message: msg };
  }
  if (st === 402) return { kind: "cuota", message: `Sin cuota en ElevenLabs — ${msg}` };
  if (st === 400 && /elige una voz/i.test(msg))
    return { kind: "voz", message: "Elige una voz para la guía: el agente no tiene una por defecto." };
  if (st === 400 && /voz|voice/i.test(msg)) return { kind: "voz", message: `${msg}. Elige otra voz.` };
  if (st === 502) return { kind: "otro", message: `ElevenLabs falló: ${msg}` };
  return { kind: "otro", message: msg };
}

/** Copia [from, to) de un buffer (el motor programa buffers enteros). */
function sliceRange(ac: AudioContext, buf: AudioBuffer, from: number, to: number): AudioBuffer {
  const a = Math.max(0, Math.min(buf.length - 1, Math.floor(from * buf.sampleRate)));
  const b = Math.max(a + 1, Math.min(buf.length, Math.ceil(to * buf.sampleRate)));
  if (a === 0 && b === buf.length) return buf;
  const out = ac.createBuffer(buf.numberOfChannels, b - a, buf.sampleRate);
  for (let c = 0; c < buf.numberOfChannels; c++) out.copyToChannel(buf.getChannelData(c).subarray(a, b), c);
  return out;
}

const rotate = <T,>(xs: T[], k: number): T[] =>
  xs.length ? [...xs.slice(k % xs.length), ...xs.slice(0, k % xs.length)] : xs;

/** Margen antes de la primera consonante y cola después de la última vocal. */
const PRE = 0.15;
const TAIL = 0.35;

interface Clock {
  ac: AudioContext;
  from: number;
  to: number;
  /** Instantes del reloj de audio en que empieza cada vuelta de la guía. */
  starts: number[];
}

export function useGuide({
  api,
  target,
  mode,
  revision,
  onStart,
  active = true,
}: {
  api: PlaygroundApi;
  target: GuideTarget | null;
  mode: MelismaMode;
  /** Versión del análisis (`analyzedAt`): si el pasaje se re-analiza, la guía cacheada aquí ya no vale. */
  revision?: string;
  /** Antes de sonar (para callar otra escucha: el ▶ de la melodía sintetizada). */
  onStart?: () => void;
  /** ¿La vista se ve? Oculta (otra ruta: el AppShell la deja montada), la guía se calla. */
  active?: boolean;
}) {
  const [voices, setVoices] = useState<GuideVoice[] | null>(null);
  const [voicesError, setVoicesError] = useState<GuideProblem | null>(null);
  const [voiceId, setVoiceIdState] = useState<string | null>(null);
  const [pitch, setPitchState] = useState<GuidePitch>("notas");
  const [rendering, setRendering] = useState<{ lines: GuideLine[]; loop: boolean; tag?: string } | null>(null);
  const [playing, setPlaying] = useState<GuidePlaying | null>(null);
  const [cost, setCost] = useState<GuideCost | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [problem, setProblem] = useState<GuideProblem | null>(null);

  const runRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const clockRef = useRef<Clock | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const srcRef = useRef<AudioBufferSourceNode | null>(null);
  const ownsEngine = useRef(false);
  const onStartRef = useRef(onStart);
  onStartRef.current = onStart;

  const engine = target?.onTrack?.engine ?? getTrackEngine();
  const targetKey = target ? `${target.sessionId}/${target.passageId}` : "";

  // Preferencias del espectador.
  useEffect(() => {
    setVoiceIdState(lsGet(VOICE_KEY));
    const p = lsGet(PITCH_KEY);
    if (p === "notas" || p === "tarareo") setPitchState(p);
  }, []);

  // Voces genéricas (una vez por página; el agente las cachea 1 h).
  const hasTarget = !!target;
  useEffect(() => {
    if (!hasTarget) return;
    let cancelled = false;
    let pending = voicesPromises.get(api);
    if (!pending) {
      pending = api.guideVoices();
      voicesPromises.set(api, pending);
    }
    pending
      .then((list) => {
        if (cancelled) return;
        setVoices(list);
        setVoicesError(null);
        // La voz recordada ya no está en la cuenta: se olvida (el agente respondería 404).
        const saved = lsGet(VOICE_KEY);
        if (saved && list.length && !list.some((v) => v.id === saved)) {
          lsSet(VOICE_KEY, null);
          setVoiceIdState(null);
        }
      })
      .catch((e: unknown) => {
        voicesPromises.delete(api);
        if (!cancelled) setVoicesError(guideProblem(e));
      });
    return () => {
      cancelled = true;
    };
  }, [api, hasTarget]);

  const setVoiceId = useCallback((id: string | null) => {
    setVoiceIdState(id);
    lsSet(VOICE_KEY, id);
    setProblem((p) => (p?.kind === "voz" ? null : p));
  }, []);

  const setPitch = useCallback((p: GuidePitch) => {
    setPitchState(p);
    lsSet(PITCH_KEY, p);
  }, []);

  /** Corta lo que suena y lo que se está pidiendo. */
  const stop = useCallback(() => {
    runRef.current++;
    abortRef.current?.abort();
    abortRef.current = null;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    try {
      srcRef.current?.stop();
    } catch {
      /* ya paró */
    }
    srcRef.current = null;
    if (ownsEngine.current) {
      ownsEngine.current = false;
      engine.stop();
    }
    clockRef.current = null;
    setRendering(null);
    setPlaying(null);
  }, [engine]);

  // Cambiar de pasaje o salir corta la guía.
  useEffect(() => stop, [targetKey, stop]);
  // Con la vista oculta no canta (en Sesiones suena sin pasada del motor: nadie más la para).
  useEffect(() => {
    if (!active) stop();
  }, [active, stop]);

  /** Segundo DEL PASAJE que suena ahora (null en la cuenta o sin guía). Por ref: para rAF. */
  const clock = useCallback((): number | null => {
    const c = clockRef.current;
    if (!c) return null;
    const now = c.ac.currentTime;
    let at: number | null = null;
    for (const s of c.starts) if (s <= now) at = s;
    return at == null ? null : c.from + (now - at);
  }, []);

  /** Pide (o toma de caché) la guía y la baja decodificada. */
  const fetchGuide = useCallback(
    async (lines: GuideLine[], signal: AbortSignal): Promise<{ res: GuideResult; buf: AudioBuffer; free: boolean }> => {
      if (!target) throw new Error("sin pasaje");
      const req: GuideRequest = {
        lines,
        mode,
        pitch,
        semitones: target.semitones ?? 0,
        ...(voiceId ? { voiceId } : {}),
      };
      const key = JSON.stringify([target.sessionId, target.passageId, revision ?? "", req]);
      let res = results.get(key);
      const local = !!res;
      if (!res) {
        res = await api.guide(target.sessionId, target.passageId, req, signal);
        remember(results, key, res, 64);
      }
      const url = api.fileUrl(target.sessionId, res.path);
      if (!url) throw new Error("El audio de la guía no está disponible desde aquí.");
      let buf = buffers.get(url);
      if (!buf) {
        const ac = engine.context();
        if (!ac) throw new Error("Este navegador no tiene audio web.");
        let r: Response;
        try {
          r = await fetch(url, { signal });
        } catch (e) {
          if ((e as Error).name === "AbortError") throw e;
          throw new ComposeApiError("el agente no responde", 0);
        }
        if (!r.ok) throw new Error(`No se pudo bajar el audio de la guía (${r.status}).`);
        try {
          buf = await ac.decodeAudioData(await r.arrayBuffer());
        } catch {
          throw new Error("El audio de la guía no se pudo decodificar.");
        }
        remember(buffers, url, buf, BUFFER_CAP);
      }
      return { res, buf, free: local || res.cached || res.ttsChars === 0 };
    },
    [api, engine, mode, pitch, revision, target, voiceId],
  );

  /**
   * Canta estas líneas. `loop` (solo en un tema) = la pista en loop con la
   * guía en cada vuelta; si no, una pasada desde el compás de la primera frase.
   */
  const play = useCallback(
    async (lines: GuideLine[], opts: { loop?: boolean; tag?: string } = {}) => {
      if (!target) return;
      const clean = lines.map((l) => ({ phrase: l.phrase, text: l.text.trim() })).filter((l) => l.text);
      if (!clean.length) return;
      stop();
      const run = ++runRef.current;
      const phrases = clean.map((l) => l.phrase);
      const loop = !!opts.loop && !!target.onTrack;
      const ac = new AbortController();
      abortRef.current = ac;
      setProblem(null);
      setRendering({ lines: clean, loop, tag: opts.tag });
      let got: Awaited<ReturnType<typeof fetchGuide>>;
      try {
        got = await fetchGuide(clean, ac.signal);
      } catch (e) {
        if (runRef.current !== run) return;
        setRendering(null);
        const p = guideProblem(e);
        if (p) setProblem(p);
        return;
      } finally {
        if (abortRef.current === ac) abortRef.current = null;
      }
      if (runRef.current !== run) return;
      setRendering(null);
      const { res, buf, free } = got;
      setCost({ ttsChars: free ? 0 : res.ttsChars, free, lines: clean.length });
      setWarnings(res.warnings ?? []);
      const syl = res.syllables.filter((s) => phrases.includes(s.phrase));
      if (!syl.length) {
        setProblem({
          kind: "otro",
          message: res.warnings?.length
            ? `La guía no trae sílabas para ${phrases.length === 1 ? "esta frase" : "estas frases"}: ${res.warnings.map((w) => w.replace(/^frase (\d+):/, (_, n: string) => `F${Number(n) + 1}:`)).join(" · ")}`
            : "La guía volvió sin sílabas para estas frases.",
        });
        return;
      }
      const audio = engine.context();
      if (!audio) {
        setProblem({ kind: "otro", message: "Este navegador no tiene audio web." });
        return;
      }
      if (audio.state === "suspended") await audio.resume().catch(() => undefined);
      if (runRef.current !== run) return;
      onStartRef.current?.();

      let gFrom = Math.max(0, Math.min(...syl.map((s) => s.start)) - PRE);
      let gTo = Math.min(buf.duration, Math.max(...syl.map((s) => s.end)) + TAIL);
      const finish = () => {
        if (runRef.current !== run) return;
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = null;
        srcRef.current = null;
        ownsEngine.current = false;
        clockRef.current = null;
        setPlaying(null);
      };

      if (!target.onTrack) {
        // SESIÓN: la guía sola, en el mismo contexto (nada de la pista suena).
        engine.stop();
        const at = audio.currentTime + 0.05;
        const src = engine.scheduleBuffer(sliceRange(audio, buf, gFrom, gTo), at, "guia");
        srcRef.current = src;
        src.addEventListener("ended", finish);
        clockRef.current = { ac: audio, from: gFrom, to: gTo, starts: [at] };
        setPlaying({ run, tag: opts.tag, lines: clean, phrases, loop: false, onTrack: false, syllables: syl });
        return;
      }

      // TEMA: la pista con que se grabó la toma + la guía en su sitio.
      const { base, sectionId, grid } = target.onTrack;
      const bar = barSecOf(grid.bpm, grid.meter);
      const cycleSec = Math.max(1, grid.bars) * bar;
      // El primer sonido real (la consonante de la primera sílaba), en segundos DE LA TOMA.
      const tSyl = Math.min(...syl.map((x) => x.start)) + target.passageStart;
      // La consonante entra hasta ~60 ms antes del tiempo: el compás es el de la VOCAL.
      const relSyl = tSyl + 0.08 - grid.downbeatSec;
      const fromBar = loop || relSyl < 0 ? 1 : Math.floor(relSyl / bar) + 1;
      const barStart = grid.downbeatSec + (fromBar - 1) * bar;
      // Anacrusa de verdad (la voz entra antes del compás): la cuenta tiene que cubrirla. Si es
      // solo la consonante, no hace falta un compás de clic: se recorta el silencio previo.
      const pickup = barStart - tSyl;
      if (pickup <= 0.08) gFrom = Math.max(gFrom, barStart - target.passageStart - 0.08);
      // En loop la guía no puede pisarse a sí misma en la vuelta siguiente.
      if (loop) gTo = Math.min(gTo, gFrom + cycleSec - 0.02);
      const tFrom = gFrom + target.passageStart;
      const tTo = gTo + target.passageStart;
      const lead = Math.max(0, barStart - tFrom);
      const countIn = lead > 0.09 ? Math.ceil((lead + 0.05) / bar) : 0;
      const bars = loop ? Math.max(1, grid.bars) : Math.max(1, Math.ceil((tTo - grid.downbeatSec) / bar) - fromBar + 1);
      const track = loop
        ? trackOfTake(base, sectionId, grid)
        : trackOfTake(base, sectionId, grid, rotate(grid.loop, fromBar - 1), bars);
      let trackEnd = Infinity;
      let voiceDone = false;
      let trackDone = false;
      // Acordes y batería como los dejó el transporte; el clic, apagado (la guía ya marca el tiempo).
      const mix = transportStore.get().settings;
      const { startAt } = engine.play({
        track,
        sectionId: track.sections[0].id,
        countInBars: countIn,
        loop,
        metronome: false,
        chords: mix.chords,
        groove: mix.groove,
        onEnd: () => {
          if (runRef.current !== run) return;
          trackDone = true;
          ownsEngine.current = false;
          // Fin natural (sin loop): la cola de la última sílaba sigue; se cierra al callar.
          if (!loop && !voiceDone && audio.currentTime >= trackEnd - 0.08) return;
          // Cortada desde afuera (el transporte, otra etapa): el motor ya calló la guía.
          finish();
        },
      });
      if (!startAt) {
        setProblem({ kind: "otro", message: "La pista no pudo arrancar (¿la sección tiene acordes?)." });
        return;
      }
      ownsEngine.current = true;
      trackEnd = startAt + bars * bar;
      // Instante del reloj en que suena `tFrom` en la vuelta k.
      const voiceAt = (k: number) => startAt + k * cycleSec + (tFrom - barStart);
      const piece = sliceRange(audio, buf, gFrom, gTo);
      const starts: number[] = [];
      const schedule = (k: number) => {
        const at = voiceAt(k);
        const src = engine.scheduleBuffer(piece, at, "guia");
        srcRef.current = src;
        starts.push(at);
        if (!loop)
          src.addEventListener("ended", () => {
            voiceDone = true;
            if (!trackDone && engine.playing() && audio.currentTime < trackEnd - 0.08) return;
            if (runRef.current === run) {
              if (ownsEngine.current) {
                ownsEngine.current = false;
                engine.stop();
              }
              finish();
            }
          });
      };
      schedule(0);
      clockRef.current = { ac: audio, from: gFrom, to: gTo, starts };
      if (loop) {
        // La vuelta siguiente se programa con ~1 s de adelanto (el reloj de audio no se atrasa).
        let k = 0;
        timerRef.current = setInterval(() => {
          if (runRef.current !== run || !engine.playing()) return;
          if (audio.currentTime > voiceAt(k + 1) - 1.2) {
            k++;
            schedule(k);
            // Solo las dos últimas vueltas importan al reloj.
            if (starts.length > 3) starts.splice(0, starts.length - 3);
          }
        }, 120);
      }
      setPlaying({ run, tag: opts.tag, lines: clean, phrases, loop, onTrack: true, syllables: syl });
    },
    [engine, fetchGuide, stop, target],
  );

  // Al desmontar: callar y soltar el motor.
  useEffect(
    () => () => {
      runRef.current++;
      abortRef.current?.abort();
      if (timerRef.current) clearInterval(timerRef.current);
      if (ownsEngine.current) engine.stop();
    },
    [engine],
  );

  const needVoice = problem?.kind === "voz";
  const voiceName = useMemo(() => voices?.find((v) => v.id === voiceId)?.name ?? null, [voices, voiceId]);

  return {
    available: !!target,
    onTrack: !!target?.onTrack,
    voices,
    voicesError,
    voiceId,
    voiceName,
    setVoiceId,
    pitch,
    setPitch,
    rendering,
    playing,
    cost,
    warnings,
    problem,
    needVoice,
    play,
    stop,
    clock,
  };
}

export type Guide = ReturnType<typeof useGuide>;
