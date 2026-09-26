"use client";

/**
 * Tema · GRABAR — tararear los fonemas ("na na / uh uh / dun dun") ENCIMA de
 * la pista. Patrones (Mobbin): [untitled] "New recording" para la cabecera
 * "4/4 · metrónomo · Tap · BPM" y la onda en vivo con el cabezal en
 * compás.tiempo; Workable para las tomas con sus huecos punteados; VEED para la
 * cuenta en una hoja pequeña que no tapa nada; Braintrust para el aviso "no te
 * escucho hace 4 s".
 *
 * Cómo queda alineada una toma: la pista y la grabadora viven en el MISMO
 * AudioContext. El motor dice en qué instante del reloj de audio suena el
 * compás 1 (`startAt`); la grabadora, en qué instante cayó su primera muestra
 * (`firstFrameSec`). La diferencia, más la latencia (lo que tarda la pista en
 * llegarte y tu voz en entrar), es el segundo del audio donde cae el compás 1:
 *     downbeatSec = (startAt − firstFrameSec) + latencia
 * Se graba de corrido varias vueltas del loop y al detener se parte en una toma
 * por vuelta (`splitCycles`); las vueltas mudas se descartan.
 *
 * Lo que define la rejilla (sección, pista, compases, duración de una vuelta)
 * se CONGELA al arrancar dentro de `Live`: el cierre de la toma y el rAF leen
 * eso, no la sección/el tempo de ahora — un poll o un cambio de sección a mitad
 * de la toma la guardaría con otro loop. Además el candado del transporte fija
 * tempo y sección mientras se graba.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TakeMeta, TemaSection, TemaTrack } from "@hermes/shared";
import { beatsPerBar, encodeWav16, splitCycles } from "@hermes/shared";
import { currentLatency, deviceKeyFor, type LatencyEstimate } from "@/lib/latency";
import { startLoopRecorder, type LoopRecorder, type LoopRecording } from "@/lib/loop-recorder";
import { readToken } from "@/components/ui/tones";
import { Toggle } from "@/components/ui/Toggle";
import { useTheme } from "@/state/ThemeProvider";
import { btn, btnGhost, chip, field, modalOpen, plainKey } from "../playground/ui";
import { focusTransport, transportStore, useTransport } from "./transport-settings";
import { fmtBpm } from "./track-edit";
import { useTemaCtx } from "./TemaContext";
import { CountInSheet } from "./CountInSheet";
import { LatencySheet, NUDGE_MAX } from "./LatencySheet";
import { TakeList, sectionTakes } from "./TakeList";
import { barSecOf, peakOf, peaksOf, pendingTakes, uploadPending, type PendingTake } from "./take-audio";

type Phase = "idle" | "arming" | "countin" | "recording" | "saving";
type Monitor = TakeMeta["monitor"];
type RecError = { kind: "permiso" | "origen" | "otro"; message: string };

/** Por debajo de este pico una vuelta es muda (no hay tarareo que analizar). */
const MUTE_PEAK = 0.02;
/** Nivel a partir del cual cuenta como voz para el aviso de silencio. */
const VOICE_LEVEL = 0.02;
const SILENCE_SEC = 4;
const LOUD_LEVEL = 0.98;
/** Tope de una grabación continua: 10 min (la memoria del navegador no es infinita). */
const MAX_REC_SEC = 600;
/** Cubetas de la onda en vivo por vuelta (independiente del ancho). */
const RES = 240;

const LS = {
  monitor: "hermes-temas-monitor",
  cycles: "hermes-temas-vueltas",
  nudge: "hermes-temas-latencia-oido:",
};
const lsGet = (k: string): string | null => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const lsSet = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* sin almacenamiento: vale hasta recargar */
  }
};

/** Por qué no se pudo grabar, en las tres formas que la UI sabe explicar. */
function classify(e: unknown): RecError {
  const message = (e as Error)?.message ?? String(e);
  const name = (e as { name?: string })?.name ?? "";
  if ((typeof window !== "undefined" && !window.isSecureContext) || /localhost|https/i.test(message))
    return { kind: "origen", message };
  if (name === "NotAllowedError" || /permiso/i.test(message)) return { kind: "permiso", message };
  return { kind: "otro", message };
}

/** La rejilla de UNA grabación, congelada al arrancar. */
interface Frozen {
  section: TemaSection;
  track: TemaTrack;
  bpb: number;
  barSec: number;
  beatSec: number;
  cycleBars: number;
  cycleSec: number;
  labels: string[];
}

interface Live {
  run: number;
  ac: AudioContext;
  startAt: number;
  rec: LoopRecorder;
  /** Latencia leída al abrir el micrófono (con su track: Chrome declara la de entrada). */
  lat: LatencyEstimate | null;
  f: Frozen;
}

/** Acorde(s) de cada compás de una vuelta (lo que el canvas escribe arriba). */
function barLabels(section: TemaSection, cycleBars: number): string[] {
  return Array.from({ length: cycleBars }, (_, i) => {
    const bar = section.loop.length ? section.loop[i % section.loop.length] : null;
    return bar?.chords.map((c) => c.symbol).join(" ") ?? "";
  });
}

interface WaveState {
  cur: Float32Array;
  ghost: Float32Array;
  hasGhost: boolean;
  cycle: number;
  last: number;
}

export function RecordStage({
  startRecorder = startLoopRecorder,
}: {
  /** Costura de QA: la grabadora real por defecto; /dev/temas inyecta una sintética. */
  startRecorder?: typeof startLoopRecorder;
} = {}) {
  const ctx = useTemaCtx();
  const { tema, section, engine } = ctx;
  const track = tema.track;
  const theme = useTheme().resolved;
  const meter = track.meter;
  const bpb = beatsPerBar(meter);
  const barSec = barSecOf(track.bpm, meter);
  const beatSec = barSec / bpb;
  const cycleBars = Math.max(1, section.bars);
  const cycleSec = cycleBars * barSec;
  // Clave del par micrófono/salida: la real se conoce al abrir el micro (antes, la última usada).
  const [dkey, setDkey] = useState(() => deviceKeyFor(null));

  const [phase, setPhaseState] = useState<Phase>("idle");
  const [count, setCount] = useState(bpb);
  /** Tiempos por compás de la cuenta en curso (los de la grabación, no los de ahora). */
  const [countBeats, setCountBeats] = useState(bpb);
  const [recError, setRecError] = useState<RecError | null>(null);
  const [notice, setNotice] = useState<{ text: string; warn: boolean } | null>(null);
  const [silentSec, setSilentSec] = useState(0);
  const [loud, setLoud] = useState(false);
  // El metrónomo es el del TRANSPORTE (un solo lugar de control): Grabar lo lee.
  const metronome = useTransport().settings.metronome;
  const [monitor, setMonitor] = useState<Monitor>("audifonos");
  const [stt, setStt] = useState(false);
  const [hint, setHint] = useState("");
  const [maxCycles, setMaxCycles] = useState(0);
  const [base, setBase] = useState<LatencyEstimate | null>(null);
  const [nudge, setNudgeState] = useState(0);
  const [sheet, setSheet] = useState(false);

  const phaseRef = useRef<Phase>("idle");
  const setPhase = (p: Phase) => {
    phaseRef.current = p;
    setPhaseState(p);
  };
  const liveRef = useRef<Live | null>(null);
  const runRef = useRef(0);
  const meterRef = useRef(0);
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const posRef = useRef<HTMLSpanElement | null>(null);
  const meterBarRef = useRef<HTMLDivElement | null>(null);
  const waveRef = useRef<WaveState>({
    cur: new Float32Array(RES),
    ghost: new Float32Array(RES),
    hasGhost: false,
    cycle: -1,
    last: -1,
  });
  const colorsRef = useRef<Record<string, string>>({});

  // Preferencias por espectador (no son del tema): monitor, metrónomo, vueltas, ajuste a oído.
  useEffect(() => {
    const m = lsGet(LS.monitor);
    if (m === "audifonos" || m === "parlantes") setMonitor(m);
    const c = Number(lsGet(LS.cycles));
    if ([1, 2, 4].includes(c)) setMaxCycles(c);
    const n = Number(lsGet(LS.nudge + dkey));
    if (Number.isFinite(n) && Math.abs(n) <= NUDGE_MAX) setNudgeState(n);
  }, [dkey]);

  const setNudge = (ms: number) => {
    setNudgeState(ms);
    lsSet(LS.nudge + dkey, String(ms));
  };

  /**
   * Estimación del navegador o la medida guardada (sin el ajuste a oído). Con el
   * track del micrófono abierto, la clave pasa a ser la del aparato real.
   */
  const refreshLatency = useCallback(
    (mic?: MediaStreamTrack, keyOverride?: string) => {
      const ac = engine.context();
      if (!ac) return null;
      const key = keyOverride ?? (mic ? deviceKeyFor(ac, mic) : dkey);
      if (key !== dkey) setDkey(key);
      const est = currentLatency(ac, mic, key);
      setBase(est);
      return est;
    },
    [engine, dkey],
  );
  useEffect(() => {
    refreshLatency();
  }, [refreshLatency]);

  const eff = useMemo<{ ms: number; source: LatencyEstimate["source"] }>(
    () => ({ ms: Math.max(0, (base?.ms ?? 0) + nudge), source: nudge !== 0 ? "manual" : (base?.source ?? "manual") }),
    [base, nudge],
  );

  // ───────────── Onda en vivo (canvas, colores del tema) ─────────────

  useEffect(() => {
    colorsRef.current = {
      alt: readToken("--color-panel-2", "#232120"),
      line: readToken("--color-line", "rgba(255,255,255,.08)"),
      line2: readToken("--color-line-2", "rgba(255,255,255,.16)"),
      faint: readToken("--color-text-faint", "#8f8a80"),
      dim: readToken("--color-text-dim", "#b5afa5"),
      accent: readToken("--color-accent", "#d97757"),
      font: typeof document !== "undefined" ? getComputedStyle(document.body).fontFamily : "sans-serif",
    };
  }, [theme]);

  // La rejilla del canvas en reposo, por CONTENIDO: `section.loop` trae identidad nueva en
  // cada poll y, como dependencia, remontaba el rAF de la grabación cada 2 s (y con él el
  // contador del aviso de silencio, que nunca llegaba a 4 s).
  const labelsKey = barLabels(section, cycleBars).join("\u0001");
  const layoutRef = useRef<{ cycleBars: number; bpb: number; labels: string[] }>({ cycleBars, bpb, labels: [] });
  layoutRef.current = { cycleBars, bpb, labels: labelsKey.split("\u0001") };

  /** Dibuja la vuelta; `layout` = la rejilla congelada de la grabación (en reposo, la de ahora). */
  const draw = useCallback(
    (headFrac: number | null, layout?: { cycleBars: number; bpb: number; labels: string[] }) => {
      const { cycleBars, bpb, labels: chordLabels } = layout ?? layoutRef.current;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const W = Math.max(1, Math.floor(rect.width));
      const H = Math.max(1, Math.floor(rect.height));
      if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
        canvas.width = W * dpr;
        canvas.height = H * dpr;
      }
      const g = canvas.getContext("2d");
      if (!g) return;
      const c = colorsRef.current;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      const TOP = 20;
      const barW = W / cycleBars;
      // Compases alternos sombreados (la rejilla se lee de un vistazo, patrón Plane).
      for (let b = 0; b < cycleBars; b++) {
        if (b % 2 === 1) {
          g.fillStyle = c.alt;
          g.fillRect(b * barW, 0, barW, H);
        }
      }
      // Tiempos y compases.
      for (let b = 0; b < cycleBars; b++) {
        for (let k = 1; k < bpb; k++) {
          g.fillStyle = c.line;
          g.fillRect(Math.round(b * barW + (k * barW) / bpb), TOP, 1, H - TOP);
        }
        g.fillStyle = c.line2;
        if (b > 0) g.fillRect(Math.round(b * barW), 0, 1, H);
      }
      // Número de compás + acorde que suena ahí.
      g.font = `12px ${c.font}`;
      g.textBaseline = "middle";
      for (let b = 0; b < cycleBars; b++) {
        g.fillStyle = c.dim;
        g.fillText(String(b + 1), b * barW + 6, 11);
        if (chordLabels[b] && barW > 44) {
          g.fillStyle = c.faint;
          g.fillText(chordLabels[b], b * barW + 20, 11);
        }
      }
      // Onda: la vuelta anterior en gris, la actual en acento (es tu voz).
      const mid = TOP + (H - TOP) / 2;
      const half = (H - TOP) / 2 - 4;
      const wv = waveRef.current;
      const bw = W / RES;
      const drawArr = (arr: Float32Array, color: string, upto: number) => {
        g.fillStyle = color;
        for (let i = 0; i < upto; i++) {
          const v = arr[i];
          if (v <= 0) continue;
          const h = Math.max(1, Math.min(1, v) * half);
          g.fillRect(i * bw, mid - h, Math.max(1, bw - 1), h * 2);
        }
      };
      if (wv.hasGhost) drawArr(wv.ghost, c.line2, RES);
      const upto = headFrac == null ? (wv.cycle >= 0 ? RES : 0) : Math.floor(headFrac * RES);
      drawArr(wv.cur, c.accent, upto);
      if (!wv.hasGhost && wv.cycle < 0) {
        // Sin nada grabado: la línea de puntos dice que el canal existe.
        g.fillStyle = c.line2;
        for (let x = 2; x < W; x += 6) g.fillRect(x, mid, 2, 1);
      }
      // Cabezal.
      if (headFrac != null) {
        const x = Math.round(headFrac * W);
        g.fillStyle = c.accent;
        g.fillRect(x - 1, TOP - 4, 2, H - TOP + 4);
        g.beginPath();
        g.moveTo(x - 5, TOP - 8);
        g.lineTo(x + 5, TOP - 8);
        g.lineTo(x, TOP - 2);
        g.closePath();
        g.fill();
      }
    },
    [],
  );

  // En reposo se dibuja al cambiar el tamaño, el tema o la rejilla (compases, compás, acordes).
  useEffect(() => {
    if (phase === "countin" || phase === "recording") return;
    draw(null);
    const el = canvasRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => draw(null));
    ro.observe(el);
    return () => ro.disconnect();
  }, [draw, phase, theme, cycleBars, bpb, labelsKey]);

  // Al cambiar de sección la onda anterior ya no corresponde (grabando no cambia: está fija,
  // y si llegara a cambiar por fuera, la onda es de la toma en curso — no se borra).
  useEffect(() => {
    if (liveRef.current) return;
    waveRef.current = { cur: new Float32Array(RES), ghost: new Float32Array(RES), hasGhost: false, cycle: -1, last: -1 };
  }, [section.id]);

  // ───────────── Grabar ─────────────

  const finish = useCallback(async () => {
    const live = liveRef.current;
    if (!live || phaseRef.current === "saving") return;
    liveRef.current = null;
    setPhase("saving");
    const c = ctxRef.current;
    c.engine.stop();
    let r: LoopRecording;
    try {
      r = await live.rec.stop();
    } catch (e) {
      setRecError({ kind: "otro", message: `La grabación no se pudo cerrar: ${(e as Error).message}` });
      setPhase("idle");
      return;
    }
    const est = live.lat;
    // Entera: la misma cifra que viaja en la meta es la que corre el primer tiempo.
    const latMs = Math.round(Math.max(0, (est?.ms ?? 0) + nudge));
    const latSource: LatencyEstimate["source"] = nudge !== 0 ? "manual" : (est?.source ?? "manual");
    // La rejilla con la que SE GRABÓ (congelada al arrancar), no la de ahora.
    const { track: trk, section: sec, cycleSec, barSec, beatSec, cycleBars } = live.f;
    const downbeat = live.startAt - r.firstFrameSec + latMs / 1000;
    const totalSec = r.pcm.length / r.sr;
    let cuts: ReturnType<typeof splitCycles>;
    try {
      cuts = splitCycles({
        totalSec,
        downbeatSec: downbeat,
        loopSec: cycleSec,
        // La anacrusa entra en la cuenta: medio compás antes del 1 (tope 1,6 s).
        preRollSec: Math.min(barSec / 2, 1.6),
        // La última sílaba puede pasarse del compás: un tiempo de cola.
        tailSec: Math.min(beatSec, 0.8),
      });
    } catch (e) {
      setRecError({ kind: "otro", message: `No se pudo partir la grabación en vueltas: ${(e as Error).message}` });
      setPhase("idle");
      return;
    }

    const pieces: PendingTake[] = [];
    let muted = 0;
    const stamp = Date.now();
    for (const cut of cuts) {
      const a = Math.max(0, Math.floor(cut.startSec * r.sr));
      const b = Math.min(r.pcm.length, Math.ceil(cut.endSec * r.sr));
      const pcm = r.pcm.slice(a, b);
      // Muda se juzga en la vuelta propiamente dicha: el pre-roll es la cola de la vuelta
      // anterior y haría pasar por cantada una vuelta en silencio.
      const core = pcm.subarray(
        Math.floor(cut.downbeatSec * r.sr),
        Math.min(pcm.length, Math.ceil((cut.downbeatSec + cycleSec) * r.sr)),
      );
      if (peakOf(core) < MUTE_PEAK) {
        muted++;
        continue;
      }
      let bytes: Uint8Array;
      try {
        bytes = encodeWav16(pcm, r.sr);
      } catch (e) {
        setRecError({ kind: "otro", message: `No se pudo empaquetar la toma: ${(e as Error).message}` });
        setPhase("idle");
        return;
      }
      const buffer = live.ac.createBuffer(1, pcm.length, r.sr);
      buffer.copyToChannel(pcm, 0);
      pieces.push({
        key: `${c.tema.id}:${stamp}:${cut.cycle}`,
        temaId: c.tema.id,
        sectionId: sec.id,
        cycle: cut.cycle,
        wav: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "audio/wav" }),
        meta: {
          temaId: c.tema.id,
          sectionId: sec.id,
          grid: {
            bpm: trk.bpm,
            meter: trk.meter,
            key: trk.key,
            downbeatSec: cut.downbeatSec,
            loop: sec.loop,
            bars: cycleBars,
            ...(trk.swing ? { swing: trk.swing } : {}),
          },
          latency: { ms: latMs, source: latSource },
          monitor,
          stt,
          ...(hint.trim() ? { hint: hint.trim() } : {}),
          cycle: cut.cycle,
        },
        peaks: peaksOf(pcm),
        durationSec: pcm.length / r.sr,
        buffer,
        state: "subiendo",
      });
    }
    // Lo que se grabó después de la última vuelta completa.
    const covered = downbeat + cuts.length * cycleSec;
    const partialBars = Math.floor(Math.max(0, totalSec - covered) / barSec);
    setPhase("idle");

    const msg: string[] = [];
    if (!cuts.length)
      msg.push(`No se completó ninguna vuelta: cada toma llega hasta el final del compás ${cycleBars}`);
    else
      msg.push(
        `${pieces.length} ${pieces.length === 1 ? "toma" : "tomas"} de ${cuts.length} ${cuts.length === 1 ? "vuelta" : "vueltas"}`,
      );
    if (muted) msg.push(`${muted} ${muted === 1 ? "vuelta muda descartada" : "vueltas mudas descartadas"} (no te escuché)`);
    if (cuts.length && partialBars >= 1)
      msg.push(`la última vuelta quedó a medias (${partialBars} de ${cycleBars} compases) y no se guardó`);
    if (r.peak >= LOUD_LEVEL) msg.push("saturó en algún momento: aléjate 20 cm del micrófono");

    pieces.forEach((p) => pendingTakes.add(p));
    let failed = 0;
    for (const p of pieces) if (!(await uploadPending(p, c.uploadTake))) failed++;
    if (failed)
      msg.push(`${failed} sin subir: ${failed === 1 ? "quedó" : "quedaron"} en este navegador (Reintentar en la lista)`);
    if (failed < pieces.length) await ctxRef.current.reload().catch(() => undefined);
    setNotice({ text: `${msg.join(" · ")}.`, warn: msg.length > 1 || !pieces.length });
  }, [nudge, monitor, stt, hint]);

  // La versión más nueva de `finish` (con el monitor, la pista de texto y la latencia de AHORA):
  // la llaman closures viejas — el onEnd del motor y la limpieza al desmontar.
  const finishRef = useRef(finish);
  finishRef.current = finish;

  const start = useCallback(async () => {
    if (phaseRef.current !== "idle") return;
    setRecError(null);
    setNotice(null);
    setSilentSec(0);
    setLoud(false);
    const c = ctxRef.current;
    const ac = c.engine.context();
    if (!ac) {
      setRecError({ kind: "otro", message: "Este navegador no tiene audio web." });
      return;
    }
    setPhase("arming");
    let rec: LoopRecorder;
    try {
      if (ac.state === "suspended") await ac.resume();
      rec = await startRecorder(ac, { meterRef });
    } catch (e) {
      setRecError(classify(e));
      setPhase("idle");
      return;
    }
    // Esc mientras el navegador pedía el micrófono.
    // (el ref cambia durante el await: TS no lo ve y lo daría por "idle")
    if ((phaseRef.current as Phase) !== "arming") {
      rec.cancel();
      return;
    }
    const lat = refreshLatency(rec.track);
    const run = ++runRef.current;
    // La rejilla de ESTA grabación, congelada: el cierre y el rAF leen esto (la de DESPUÉS de
    // abrir el micro — desde "arming" el candado ya no deja cambiar tempo ni sección).
    const trk = ctxRef.current.tema.track;
    const sec = ctxRef.current.section;
    const fBpb = beatsPerBar(trk.meter);
    const fBar = barSecOf(trk.bpm, trk.meter);
    const fBars = Math.max(1, sec.bars);
    const f: Frozen = {
      section: sec,
      track: trk,
      bpb: fBpb,
      barSec: fBar,
      beatSec: fBar / fBpb,
      cycleBars: fBars,
      cycleSec: fBars * fBar,
      labels: barLabels(sec, fBars),
    };
    // Acordes y batería como los dejó el transporte (un solo lugar de control); el clic, el suyo.
    const mix = transportStore.get().settings;
    const wv = waveRef.current;
    if (wv.cycle >= 0) {
      wv.ghost = wv.cur;
      wv.hasGhost = true;
    }
    wv.cur = new Float32Array(RES);
    wv.cycle = -1;
    wv.last = -1;
    const { startAt } = c.engine.play({
      track: trk,
      sectionId: sec.id,
      countInBars: 1,
      loop: true,
      metronome: mix.metronome,
      chords: mix.chords,
      groove: mix.groove,
      onBeat: (bar, beat) => {
        if (runRef.current !== run) return;
        if (bar <= 0) setCount(-bar * fBpb + (fBpb - beat + 1));
        else if (phaseRef.current === "countin") setPhase("recording");
      },
      // La pista se cortó desde afuera (otra etapa, el transporte): lo grabado se guarda.
      onEnd: () => {
        if (liveRef.current?.run === run) void finishRef.current();
      },
    });
    if (!startAt) {
      rec.cancel();
      setRecError({ kind: "otro", message: "La pista no pudo arrancar (¿la sección tiene acordes?)." });
      setPhase("idle");
      return;
    }
    liveRef.current = { run, ac, startAt, rec, lat, f };
    setCount(fBpb);
    setCountBeats(fBpb);
    setPhase("countin");
  }, [startRecorder, refreshLatency]);

  const cancel = useCallback(() => {
    const live = liveRef.current;
    liveRef.current = null;
    runRef.current++;
    const wasArming = phaseRef.current === "arming";
    setPhase("idle");
    ctxRef.current.engine.stop();
    live?.rec.cancel();
    if (!wasArming) setNotice({ text: "Cancelado: no se guardó nada.", warn: false });
  }, []);

  const toggleRecord = useCallback(() => {
    const p = phaseRef.current;
    if (p === "idle") void start();
    else if (p === "countin" || p === "arming") cancel();
    else if (p === "recording") void finish();
  }, [start, cancel, finish]);

  // Salir de la etapa con algo grabándose: se guarda (nada se pierde por navegar).
  useEffect(
    () => () => {
      if (liveRef.current && phaseRef.current === "recording") void finishRef.current();
      else if (liveRef.current) {
        liveRef.current.rec.cancel();
        liveRef.current = null;
        ctxRef.current.engine.stop();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // ───────────── Un solo rAF mientras se graba ─────────────

  const silentRef = useRef(0);
  const loudRef = useRef(false);
  useEffect(() => {
    if (phase !== "countin" && phase !== "recording") return;
    let raf = 0;
    let lastVoice = -1;
    let loudAt = -Infinity;
    silentRef.current = 0;
    loudRef.current = false;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const live = liveRef.current;
      if (!live) return;
      const now = live.ac.currentTime;
      const t = now - live.startAt;
      const lvl = meterRef.current;
      const mb = meterBarRef.current;
      if (mb) {
        mb.style.width = `${Math.min(100, lvl * 100)}%`;
        mb.dataset.hot = lvl >= LOUD_LEVEL ? "1" : "0";
      }
      // La rejilla de ESTA grabación (congelada), no la de ahora.
      const { cycleSec, barSec, beatSec } = live.f;
      if (t < 0) {
        draw(null, live.f);
        return;
      }
      if (phaseRef.current === "countin") setPhase("recording");
      // Con tope de vueltas, la cola después de la última no abre una vuelta nueva en la onda.
      const cycle = Math.min(Math.floor(t / cycleSec), maxCycles ? maxCycles - 1 : Infinity);
      const pos = Math.min(cycleSec - 1e-6, t - cycle * cycleSec);
      const bar = Math.floor(pos / barSec) + 1;
      const beat = Math.floor((pos - (bar - 1) * barSec) / beatSec) + 1;
      if (posRef.current) posRef.current.textContent = `c.${bar} t.${beat} · vuelta ${cycle + 1}`;
      // Onda: la vuelta nueva manda la anterior al fondo (gris).
      const wv = waveRef.current;
      if (cycle !== wv.cycle) {
        if (wv.cycle >= 0) {
          wv.ghost = wv.cur;
          wv.hasGhost = true;
        }
        wv.cur = new Float32Array(RES);
        wv.cycle = cycle;
        wv.last = -1;
      }
      const bucket = Math.min(RES - 1, Math.floor((pos / cycleSec) * RES));
      for (let i = Math.max(0, wv.last + 1); i <= bucket; i++) wv.cur[i] = Math.max(wv.cur[i], lvl);
      wv.cur[bucket] = Math.max(wv.cur[bucket], lvl);
      wv.last = bucket;
      draw(pos / cycleSec, live.f);
      // Silencio: desde el compás 1, más de 4 s sin voz.
      if (lastVoice < 0) lastVoice = now;
      if (lvl > VOICE_LEVEL) lastVoice = now;
      const quiet = now - lastVoice >= SILENCE_SEC ? Math.floor(now - lastVoice) : 0;
      if (quiet !== silentRef.current) {
        silentRef.current = quiet;
        setSilentSec(quiet);
      }
      if (lvl >= LOUD_LEVEL) loudAt = now;
      const isLoud = now - loudAt < 2.5;
      if (isLoud !== loudRef.current) {
        loudRef.current = isLoud;
        setLoud(isLoud);
      }
      // Tope de vueltas (si se eligió) y tope duro de 10 min.
      const cap = maxCycles ? maxCycles * cycleSec + Math.min(beatSec, 0.8) : Infinity;
      if (t >= cap || t >= MAX_REC_SEC) void finishRef.current();
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      // Al parar: el contador y el medidor vuelven a cero (no se queda el último cuadro).
      if (posRef.current) posRef.current.textContent = "";
      if (meterBarRef.current) meterBarRef.current.style.width = "0%";
    };
    // Solo al empezar/terminar de grabar (y el tope de vueltas, fijo mientras se graba): la rejilla
    // sale de `live.f` y `finish` de su ref — nada que cambie por un poll remonta este rAF.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase === "countin" || phase === "recording", draw, maxCycles]);

  // ───────────── Atajos: R grabar/parar · S ★ · Esc ─────────────

  const star = useCallback(() => {
    const c = ctxRef.current;
    const takes = sectionTakes(c.detail.candidates, c.section.id);
    const last = takes[takes.length - 1];
    if (!last) return;
    void c
      .patchTake(last.memo.sessionId, { favorite: !last.favorite })
      .then(() => c.reload())
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const c = ctxRef.current;
      if (!c.active || c.stage !== "grabar") return;
      const p = phaseRef.current;
      if (e.key === "Escape") {
        if (modalOpen() || p === "idle" || p === "saving") return;
        e.preventDefault();
        e.stopPropagation();
        // Esc en la cuenta cancela; grabando, guarda (lo cantado no se tira).
        if (p === "recording") void finish();
        else cancel();
        return;
      }
      if (!plainKey(e)) return;
      if (e.key === " " && p !== "idle") {
        // El Espacio del transporte pararía la pista en plena toma.
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        e.stopPropagation();
        toggleRecord();
      } else if ((e.key === "s" || e.key === "S") && p === "idle") {
        e.preventDefault();
        e.stopPropagation();
        star();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [toggleRecord, cancel, finish, star]);

  const busy = phase !== "idle";

  // Mientras se graba, el tempo del transporte queda fijo: cambiarlo a mitad de una toma la
  // dejaría fuera de su rejilla. Al terminar (o salir de la etapa) se abre de nuevo.
  useEffect(() => {
    transportStore.lockTempo(busy ? "grabando: el tempo y la sección quedan fijos hasta terminar" : null);
  }, [busy]);
  useEffect(() => () => transportStore.lockTempo(null), []);
  const takes = sectionTakes(ctx.detail.candidates, section.id);
  // Para re-escuchar el ajuste: la última toma ya lista (su rejilla está al día); si no hay, la última.
  const refTake = [...takes].reverse().find((t) => t.status === "listo") ?? takes[takes.length - 1];
  const lastTake = refTake ? { sid: refTake.memo.sessionId, label: refTake.label } : null;
  const loopBars = section.loop.length;

  return (
    <div className="@container flex min-w-0 flex-col gap-4">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h2 className="text-md font-medium text-text">Grabar el tarareo</h2>
          <p className="text-xs text-text-dim">
            Sobre la pista de «{section.label}»: {cycleBars} {cycleBars === 1 ? "compás" : "compases"}
            {loopBars && loopBars !== cycleBars ? ` · loop de ${loopBars}` : ""} · cada vuelta es una toma.
          </p>
        </div>
        {tema.track.sections.length > 1 && (
          <div className="flex flex-wrap items-center gap-1" role="radiogroup" aria-label="Sección">
            {tema.track.sections.map((s) => (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={s.id === section.id}
                disabled={busy}
                className={chip(s.id === section.id)}
                onClick={() => ctx.setSectionId(s.id)}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}
      </header>

      <div className="grid min-w-0 items-start gap-4 @4xl:grid-cols-[minmax(0,1fr)_minmax(260px,340px)]">
        {/* La grabadora: se opera, lleva marco. */}
        <section className="flex min-w-0 flex-col rounded-md border border-line bg-panel" aria-label="Grabadora">
          {/* Cabecera "4/4 · 92 bpm · metrónomo on": SOLO LECTURA. Tempo, clic y cuenta se
              cambian en el transporte (un solo lugar de control); el clic lleva allá. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-3 py-2">
            <button
              type="button"
              onClick={() => focusTransport(metronome ? "bpm" : "clic")}
              className="group -ml-1.5 inline-flex cursor-pointer items-center gap-1.5 rounded-sm px-1.5 py-0.5 text-xs text-text-dim transition-colors hover:bg-panel-2 hover:text-text"
              title="El tempo, el clic y la cuenta se cambian en el transporte, abajo"
              aria-label={`${meter}, ${fmtBpm(track.bpm)} bpm, metrónomo ${metronome ? "encendido" : "apagado"}. Cambiar en el transporte`}
            >
              <span className="font-mono text-sm text-text">{meter}</span>
              <span aria-hidden className="text-text-faint">
                ·
              </span>
              <span>
                <span className="font-mono text-text tabular-nums">{fmtBpm(track.bpm)}</span> bpm
                {track.bpmSource === "estimado" ? " aprox." : ""}
              </span>
              <span aria-hidden className="text-text-faint">
                ·
              </span>
              <span>metrónomo {metronome ? "on" : "off"}</span>
              <span aria-hidden className="text-text-faint transition-colors group-hover:text-text-dim">
                ↓ transporte
              </span>
            </button>
            <span className="ml-auto flex items-center gap-1 text-xs text-text-faint" role="radiogroup" aria-label="Vueltas">
              vueltas
              {[1, 2, 4, 0].map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={maxCycles === n}
                  disabled={busy}
                  className={chip(maxCycles === n)}
                  onClick={() => {
                    setMaxCycles(n);
                    lsSet(LS.cycles, String(n));
                  }}
                >
                  {n || "sin fin"}
                </button>
              ))}
            </span>
          </div>

          {/* Onda en vivo con el cabezal en compás.tiempo */}
          <div className="relative px-3 pt-2">
            <canvas ref={canvasRef} className="block h-32 w-full" aria-hidden />
            {phase === "countin" && <CountInSheet count={count} beats={countBeats} section={section.label} />}
          </div>

          {/* Medidor + avisos */}
          <div className="flex flex-col gap-1 px-3 pt-1 pb-2">
            <div className="h-1.5 overflow-hidden rounded-full bg-line" aria-hidden>
              <div
                ref={meterBarRef}
                data-hot="0"
                className="h-full w-0 rounded-full bg-accent transition-[width] duration-75 data-[hot=1]:bg-red"
              />
            </div>
            <p className="min-h-[18px] text-xs" aria-live="polite">
              {phase === "recording" && silentSec >= SILENCE_SEC ? (
                <span className="text-amber">
                  No te escucho hace {silentSec} s — ¿es el micrófono correcto? Acércate o sube su volumen.
                </span>
              ) : loud ? (
                <span className="text-red">Muy fuerte: aléjate 20 cm del micrófono.</span>
              ) : phase === "recording" ? (
                <span className="text-text-faint">Nivel de tu voz. Tararea como lo cantarías.</span>
              ) : null}
            </p>
          </div>

          {/* Acción principal */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-line px-3 py-3">
            <button
              type="button"
              onClick={toggleRecord}
              disabled={phase === "saving"}
              aria-label={phase === "recording" ? "Parar y guardar (R)" : phase === "idle" ? "Grabar (R)" : "Cancelar la cuenta (Esc)"}
              title={phase === "recording" ? "Parar y guardar (R)" : "Grabar con 1 compás de entrada (R)"}
              className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-full bg-accent text-white transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-50"
            >
              {phase === "recording" ? (
                <span className="h-3.5 w-3.5 rounded-[3px] bg-white" />
              ) : phase === "idle" ? (
                <span className="h-4 w-4 rounded-full bg-white" />
              ) : (
                <span className="text-sm">✕</span>
              )}
            </button>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-sm text-text">
                {phase === "recording" && <span className="h-2 w-2 animate-pulse rounded-full bg-red" aria-hidden />}
                {phase === "idle" && "Listo para grabar"}
                {phase === "arming" && "Abriendo el micrófono…"}
                {phase === "countin" && "Cuenta de entrada…"}
                {phase === "recording" && "Grabando"}
                {phase === "saving" && "Partiendo en tomas…"}
                <span ref={posRef} className="font-mono text-xs text-text-dim tabular-nums" />
              </p>
              <p className="text-xs text-text-faint">
                {phase === "idle" ? (
                  <>
                    <kbd className="font-mono">R</kbd> graba con 1 compás de cuenta ·{" "}
                    {maxCycles ? `para solo tras ${maxCycles} ${maxCycles === 1 ? "vuelta" : "vueltas"}` : "R otra vez para parar"}
                  </>
                ) : phase === "recording" ? (
                  <>
                    <kbd className="font-mono">R</kbd> o <kbd className="font-mono">Esc</kbd> para y guarda las vueltas completas
                  </>
                ) : (
                  <>
                    <kbd className="font-mono">Esc</kbd> cancela
                  </>
                )}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-0.5 rounded-sm border border-line p-0.5" role="radiogroup" aria-label="Monitor">
                {(["audifonos", "parlantes"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={monitor === m}
                    disabled={busy}
                    className={chip(monitor === m)}
                    onClick={() => {
                      setMonitor(m);
                      lsSet(LS.monitor, m);
                    }}
                  >
                    {m === "audifonos" ? "Audífonos" : "Parlantes"}
                  </button>
                ))}
              </span>
              <button
                type="button"
                // Con aviso (sin medir, o Bluetooth) el borde se vuelve ámbar: calibrar vale la pena.
                className={base?.warn && nudge === 0 ? btn.replace("border-line", "border-amber/60") : btn}
                onClick={() => setSheet(true)}
                disabled={busy}
                title="Medir o ajustar la latencia"
              >
                Latencia {Math.round(eff.ms)} ms
                <span className="text-text-faint">· {eff.source}</span>
              </button>
            </div>
          </div>

          {recError && (
            <div role="alert" className="mx-3 mb-3 flex flex-wrap items-start justify-between gap-2 rounded-sm border border-red/40 px-3 py-2">
              <div className="min-w-0 text-xs">
                {recError.kind === "permiso" && (
                  <>
                    <p className="text-text">El navegador no tiene permiso para usar el micrófono.</p>
                    <p className="text-text-dim">
                      Actívalo en Ajustes del sistema › Privacidad y seguridad › Micrófono (para tu navegador) y en el
                      candado de la barra de direcciones.
                    </p>
                  </>
                )}
                {recError.kind === "origen" && (
                  <>
                    <p className="text-text">Aquí el navegador bloquea el micrófono.</p>
                    <p className="text-text-dim">
                      Solo funciona abriendo Hermes en esta Mac (localhost) o por https (Tailscale); desde otro equipo por
                      http no hay micrófono.
                    </p>
                  </>
                )}
                {recError.kind === "otro" && <p className="text-text">{recError.message}</p>}
              </div>
              {recError.kind !== "origen" && (
                <button type="button" className={btn} onClick={() => void start()}>
                  Reintentar
                </button>
              )}
            </div>
          )}
          {notice && !recError && (
            <p className={`mx-3 mb-3 text-xs ${notice.warn ? "text-amber" : "text-text-dim"}`} role="status">
              {notice.text}
            </p>
          )}

          {/* Opciones de la toma */}
          <div className="grid gap-3 border-t border-line px-3 py-3 @2xl:grid-cols-2">
            <label className="flex min-w-0 flex-col gap-1">
              <span className="text-xs text-text-dim">Pista de texto (opcional)</span>
              <input
                className={field}
                value={hint}
                onChange={(e) => setHint(e.target.value)}
                placeholder="na na uh… dun dun"
                disabled={busy}
                spellCheck={false}
              />
              <span className="text-xs text-text-faint">
                Lo que vas a tararear: ancla las sílabas y sus vocales. Sin ella se detectan por el audio.
              </span>
            </label>
            <div className="flex min-w-0 flex-col gap-1">
              <span className="flex items-center gap-2 text-xs text-text-dim">
                <Toggle size="sm" checked={stt} onChange={setStt} disabled={busy} />
                Leer los fonemas con Scribe
              </span>
              <span className={`text-xs ${stt ? "text-amber" : "text-text-faint"}`}>
                {stt
                  ? "Encendido: el audio de cada toma se envía a ElevenLabs (Scribe) para leer lo que tarareaste."
                  : "Apagado: la toma no sale de este equipo; las sílabas se detectan aquí mismo."}
              </span>
              <span className="text-xs text-text-faint">
                {monitor === "audifonos"
                  ? "Audífonos: la toma queda solo con tu voz (lo recomendado)."
                  : "Parlantes: la pista se cuela en el micrófono y Hermes separa tu voz después (más lento)."}
              </span>
            </div>
          </div>
        </section>

        <TakeList onRecord={() => void start()} recording={busy} />
      </div>

      {sheet && (
        <LatencySheet
          engine={engine}
          base={base}
          nudge={nudge}
          setNudge={setNudge}
          monitor={monitor}
          lastTake={lastTake}
          track={track}
          sectionId={section.id}
          onMeasured={(key) => refreshLatency(undefined, key)}
          onApply={async (sid, ms) => {
            await ctx.patchTake(sid, { latencyMs: ms });
            await ctx.reload();
          }}
          onClose={() => setSheet(false)}
        />
      )}
    </div>
  );
}
