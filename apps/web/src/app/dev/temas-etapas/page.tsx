"use client";

/**
 * QA de las etapas GRABAR y ANÁLISIS de un Tema, SIN agente y AISLADAS (la
 * vista completa, con TemaView alrededor, vive en /dev/temas): un `TemaCtx`
 * falso con un tema y un tarareo SINTÉTICOS (./synthetic.ts), la API del
 * Playground en memoria y el motor de audio real. Aquí cada estado difícil
 * (cargando, sin notas, sin permiso, subida fallida…) se fuerza por URL.
 *
 * Escenarios por URL (para revisar cada estado de un tirón):
 *   ?etapa=grabar|analisis
 *   ?escena=normal|cargando|sin-notas|sin-estrella|sin-tomas
 *   ?grabar=voz|silencio|satura|permiso|origen|subida|real
 * "voz" es una grabadora sintética (no pide micrófono): la onda y el medidor
 * se mueven y al parar sale un tarareo de senos; "real" usa el micrófono.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import type { ComposeSession, PassageAnalysis, TakeMeta, TemaCandidate, TemaDetail, TemaStage } from "@hermes/shared";
import { temaGates } from "@hermes/shared";
import { getTrackEngine } from "@/lib/track-engine";
import { startLoopRecorder, type LoopRecorder } from "@/lib/loop-recorder";
import { useTheme } from "@/state/ThemeProvider";
import { PlaygroundApiCtx, realPlaygroundApi, type PlaygroundApi } from "@/components/composicion/playground/api";
import { chip } from "@/components/composicion/playground/ui";
import { TemaCtx, type TemaCtxValue, type TemaPatch } from "@/components/composicion/temas/TemaContext";
import { RecordStage } from "@/components/composicion/temas/RecordStage";
import { AnalysisStage } from "@/components/composicion/temas/AnalysisStage";
import { keyLabel } from "@/lib/music-theory";
import * as S from "./synthetic";

const ESCENAS = ["normal", "cargando", "sin-notas", "sin-estrella", "sin-tomas"] as const;
const GRABAR = ["voz", "silencio", "satura", "permiso", "origen", "subida", "real"] as const;
type Escena = (typeof ESCENAS)[number];
type Grabar = (typeof GRABAR)[number];

/** Lo que el "agente" de mentira guarda por toma. */
interface World {
  sessions: Map<string, ComposeSession>;
  analyses: Map<string, PassageAnalysis>;
  audio: Map<string, string>;
  peaks: Map<string, number[]>;
  take: S.SynthTake;
  pcm: Float32Array;
}

function buildWorld(escena: Escena): { world: World; detail: TemaDetail } {
  const now = new Date();
  const tema = S.syntheticTema(now.toISOString());
  // 28 ms tarde a propósito: la lectura sugiere correr la rejilla.
  const take = S.synthTake(28);
  const pcm = S.synthPcm(take);
  const url = S.wavUrl(pcm);
  const peaks = S.peaksOfPcm(pcm);
  const world: World = { sessions: new Map(), analyses: new Map(), audio: new Map(), peaks: new Map(), take, pcm };
  const rows: { n: number; status: TemaCandidate["status"]; fav: boolean }[] =
    escena === "sin-tomas"
      ? []
      : [
          { n: 1, status: "listo", fav: false },
          { n: 2, status: escena === "cargando" ? "analizando" : "listo", fav: escena !== "sin-estrella" },
          { n: 3, status: "procesando", fav: false },
        ];
  const candidates = rows.map((r) => {
    const sid = `toma-${r.n}`;
    const at = new Date(now.getTime() - (10 - r.n) * 60_000).toISOString();
    world.sessions.set(sid, S.syntheticSession(sid, S.takeMeta(r.n, 38, r.fav), take.durationSec, at));
    world.audio.set(sid, url);
    world.peaks.set(sid, peaks);
    if (r.status === "listo") world.analyses.set(sid, S.syntheticAnalysis(sid, take, pcm, { emptyNotes: escena === "sin-notas" }));
    return S.candidate(sid, r.n, r.status, r.fav, take.durationSec, at);
  });
  return { world, detail: { tema, candidates, gates: temaGates(tema, candidates) } };
}

const nope = () => Promise.reject(new Error("no disponible en /dev/temas"));

/**
 * Grabadora SINTÉTICA con la forma de la real: medidor por ref mientras
 * "graba" y, al parar, un tarareo de senos alineado a la cuenta de entrada
 * (compás 1 ≈ 0,1 s + 1 compás después de abrir el micrófono, como el motor).
 */
function fakeRecorder(mode: Grabar, bpm: number, bars: number) {
  return async (ac: AudioContext, opts: { deviceId?: string; meterRef?: MutableRefObject<number> } = {}): Promise<LoopRecorder> => {
    await new Promise((r) => setTimeout(r, 200));
    if (mode === "permiso")
      throw Object.assign(
        new Error("No hay permiso de micrófono. Dale permiso a esta página desde el candado de la barra de direcciones y vuelve a intentar."),
        { name: "NotAllowedError" },
      );
    if (mode === "origen")
      throw new Error(
        "El micrófono solo funciona abriendo Hermes en esta Mac (localhost) o por https (Tailscale). Desde otro equipo por http el navegador lo bloquea.",
      );
    const t0 = ac.currentTime;
    const barSec = 240 / bpm;
    const bar1 = t0 + 0.1 + barSec;
    const dest = ac.createMediaStreamDestination();
    const track = dest.stream.getAudioTracks()[0];
    const level = (t: number) => {
      if (mode === "silencio") return 0.004;
      if (t < bar1 - 0.3) return 0.01;
      if (mode === "satura") return 0.99;
      return 0.18 + 0.4 * Math.abs(Math.sin((t - bar1) * 5.3)) * (0.6 + 0.4 * Math.sin((t - bar1) * 0.7));
    };
    const timer = setInterval(() => {
      if (opts.meterRef) opts.meterRef.current = Math.min(1, level(ac.currentTime));
    }, 33);
    const close = () => {
      clearInterval(timer);
      track.stop();
      if (opts.meterRef) opts.meterRef.current = 0;
    };
    return {
      track,
      cancel: close,
      stop: async () => {
        close();
        const sr = 22050;
        const dur = Math.max(0, ac.currentTime - t0);
        const pcm = new Float32Array(Math.ceil(dur * sr));
        if (mode !== "silencio") {
          const voice = S.synthPcm(S.synthTake(0), sr);
          const cycleSec = bars * barSec;
          for (let k = 0; ; k++) {
            const at = bar1 - t0 + k * cycleSec - S.DOWNBEAT;
            if (at > dur) break;
            const a = Math.floor(at * sr);
            for (let i = 0; i < voice.length; i++) {
              const j = a + i;
              if (j >= 0 && j < pcm.length) pcm[j] += voice[i] * (mode === "satura" ? 4 : 1);
            }
          }
          if (mode === "satura") for (let i = 0; i < pcm.length; i++) pcm[i] = Math.max(-1, Math.min(1, pcm[i]));
        } else {
          for (let i = 0; i < pcm.length; i++) pcm[i] = ((i * 7919) % 97) / 97 / 200 - 0.0025;
        }
        let peak = 0;
        for (let i = 0; i < pcm.length; i++) peak = Math.max(peak, Math.abs(pcm[i]));
        return { pcm, sr, firstFrameSec: t0, peak };
      },
    };
  };
}

export default function TemasEtapasQA() {
  const theme = useTheme();
  const [etapa, setEtapa] = useState<"grabar" | "analisis">("grabar");
  const [escena, setEscena] = useState<Escena>("normal");
  const [grabar, setGrabar] = useState<Grabar>("voz");
  const [ready, setReady] = useState(false);

  // Escenario desde la URL (sin useSearchParams: /dev/* se construye estático).
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const e = q.get("etapa");
    if (e === "grabar" || e === "analisis") setEtapa(e);
    const s = q.get("escena") as Escena | null;
    if (s && ESCENAS.includes(s)) setEscena(s);
    const g = q.get("grabar") as Grabar | null;
    if (g && GRABAR.includes(g)) setGrabar(g);
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    const q = new URLSearchParams({ etapa, escena, grabar });
    window.history.replaceState(null, "", `?${q.toString()}`);
  }, [etapa, escena, grabar, ready]);

  const built = useMemo(() => (ready ? buildWorld(escena) : null), [escena, ready]);
  const worldRef = useRef<World | null>(null);
  const [detail, setDetail] = useState<TemaDetail | null>(null);
  const [sectionId, setSectionId] = useState(S.SECTION_ID);
  useEffect(() => {
    if (!built) return;
    worldRef.current = built.world;
    setDetail(built.detail);
    setSectionId(S.SECTION_ID);
  }, [built]);

  const setCandidates = useCallback((f: (c: TemaCandidate[]) => TemaCandidate[]) => {
    setDetail((d) => (d ? { ...d, candidates: f(d.candidates), gates: temaGates(d.tema, f(d.candidates)) } : d));
  }, []);

  const api = useMemo<PlaygroundApi>(
    () => ({
      ...realPlaygroundApi,
      listSessions: () => Promise.resolve([]),
      getSession: async (sid) => {
        const s = worldRef.current?.sessions.get(sid);
        if (!s) throw new Error("toma inexistente");
        return structuredClone(s);
      },
      analysis: async (sid) => worldRef.current?.analyses.get(sid) ?? null,
      peaks: async (sid) => {
        const p = worldRef.current?.peaks.get(sid);
        if (!p) throw new Error("sin onda todavía");
        return { peaks: p, durationSec: worldRef.current!.take.durationSec };
      },
      fileUrl: (sid) => worldRef.current?.audio.get(sid) ?? "",
      process: nope,
      stop: nope,
      reveal: nope,
      transcript: nope,
      createSong: nope,
      addPassage: nope,
      patchPassage: nope,
      analyze: nope,
      patchMold: nope,
      transpose: nope,
      lyrics: async () => null,
      generate: nope,
      putLyrics: nope,
      recordSession: nope,
      createSession: nope,
      patchSession: nope,
      sources: nope,
      browse: nope,
    }),
    [],
  );

  const engine = useMemo(() => getTrackEngine(), []);

  const value = useMemo<TemaCtxValue | null>(() => {
    if (!detail) return null;
    const section = detail.tema.track.sections.find((s) => s.id === sectionId) ?? detail.tema.track.sections[0];
    const w = worldRef.current!;
    return {
      tema: detail.tema,
      detail,
      section,
      setSectionId,
      patch: (p: TemaPatch) => setDetail((d) => (d ? { ...d, tema: { ...d.tema, ...p, updatedAt: new Date().toISOString() } } : d)),
      reload: async () => undefined,
      stage: etapa,
      setStage: (s: TemaStage) => {
        if (s === "grabar" || s === "analisis") setEtapa(s);
      },
      engine,
      uploadTake: async ({ wav, meta }) => {
        await new Promise((r) => setTimeout(r, 350));
        if (grabar === "subida") throw new Error("el agente no responde");
        const n = detail.candidates.filter((c) => c.kind === "toma" && c.sectionId === meta.sectionId).length + 1;
        const sid = `toma-${Date.now()}-${meta.cycle ?? 0}`;
        const now = new Date().toISOString();
        const full: TakeMeta = { ...meta, n };
        const dur = (wav.size - 44) / 2 / 22050;
        w.sessions.set(sid, S.syntheticSession(sid, full, dur, now));
        w.audio.set(sid, URL.createObjectURL(wav));
        setCandidates((c) => [...c, { ...S.candidate(sid, n, "procesando", false, dur, now), sectionId: meta.sectionId }]);
        // El "agente" tarda en leerla: pasa a lista con el análisis del tarareo de prueba.
        setTimeout(() => {
          w.analyses.set(sid, S.syntheticAnalysis(sid, w.take, w.pcm));
          w.peaks.set(sid, S.peaksOfPcm(w.pcm));
          setCandidates((c) =>
            c.map((x) => (x.memo.sessionId === sid ? { ...x, status: "listo", syllables: 38, melismas: 5 } : x)),
          );
        }, 2600);
        return w.sessions.get(sid)!;
      },
      patchTake: async (sid, p) => {
        await new Promise((r) => setTimeout(r, 250));
        const s = w.sessions.get(sid);
        if (!s?.take) throw new Error("toma inexistente");
        if (p.favorite !== undefined) {
          // ★ exclusiva por sección, como el agente.
          for (const x of w.sessions.values()) if (x.take && x.take.sectionId === s.take.sectionId) x.take.favorite = false;
          s.take.favorite = p.favorite;
          setCandidates((c) =>
            c.map((x) =>
              x.sectionId === s.take!.sectionId
                ? { ...x, favorite: x.memo.sessionId === sid ? p.favorite! : p.favorite ? false : x.favorite }
                : x,
            ),
          );
        }
        if (p.latencyMs !== undefined) {
          const delta = (p.latencyMs - s.take.latency.ms) / 1000;
          s.take.latency = { ms: p.latencyMs, source: "manual" };
          s.take.grid = { ...s.take.grid, downbeatSec: s.take.grid.downbeatSec + delta };
          setCandidates((c) => c.map((x) => (x.memo.sessionId === sid ? { ...x, status: "procesando" } : x)));
          setTimeout(() => {
            w.analyses.set(sid, S.syntheticAnalysis(sid, w.take, w.pcm, { downbeatSec: s.take!.grid.downbeatSec }));
            setCandidates((c) => c.map((x) => (x.memo.sessionId === sid ? { ...x, status: "listo" } : x)));
          }, 2000);
        }
      },
      active: true,
    };
  }, [detail, sectionId, etapa, engine, grabar, setCandidates]);

  const recorder = useMemo(
    () => (grabar === "real" ? startLoopRecorder : fakeRecorder(grabar, detail?.tema.track.bpm ?? S.BPM, value?.section.bars ?? S.BARS)),
    [grabar, detail?.tema.track.bpm, value?.section.bars],
  );

  if (!value) return <div className="min-h-screen bg-bg" />;

  const t = value.tema.track;
  return (
    <PlaygroundApiCtx.Provider value={api}>
      <TemaCtx.Provider value={value}>
        <div className="min-h-screen bg-bg text-text">
          <header className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line px-6 py-3">
            <div className="min-w-0">
              <h1 className="text-sm font-medium text-text">QA · Temas — Grabar y Análisis</h1>
              <p className="text-xs text-text-faint">Tema y tarareo sintéticos · sin agente · motor de audio real</p>
            </div>
            <Seg label="Etapa" value={etapa} options={["grabar", "analisis"]} onChange={(v) => setEtapa(v as typeof etapa)} />
            <Seg label="Escena" value={escena} options={[...ESCENAS]} onChange={(v) => setEscena(v as Escena)} />
            <Seg label="Grabadora" value={grabar} options={[...GRABAR]} onChange={(v) => setGrabar(v as Grabar)} />
            <button type="button" className={chip(false)} onClick={theme.cycle}>
              tema: {theme.pref}
            </button>
          </header>
          <div className="flex min-w-0">
            {/* Contexto simulado (el de TemaView): 240 px a 1440; a 1280 se pliega. */}
            <aside className="hidden w-[240px] shrink-0 flex-col gap-3 border-r border-line px-4 py-5 text-xs text-text-dim min-[1400px]:flex">
              <p className="text-sm text-text">{value.tema.title}</p>
              <p>
                {keyLabel(t.key)} · {t.bpm} bpm · {t.meter} · {t.groove}
              </p>
              <p className="text-text-faint">{value.tema.intent.about}</p>
              <ul className="flex flex-col gap-1">
                {t.sections.map((s) => (
                  <li key={s.id} className={s.id === value.section.id ? "text-accent" : ""}>
                    {s.label} · {s.bars} compases
                  </li>
                ))}
              </ul>
            </aside>
            <main className="min-w-0 flex-1 px-6 py-5">
              {etapa === "grabar" ? (
                <RecordStage key={`g-${escena}-${grabar}`} startRecorder={recorder} />
              ) : (
                <AnalysisStage key={`a-${escena}`} />
              )}
            </main>
          </div>
        </div>
      </TemaCtx.Provider>
    </PlaygroundApiCtx.Provider>
  );
}

function Seg({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <span className="flex flex-wrap items-center gap-1 text-xs text-text-faint" role="radiogroup" aria-label={label}>
      {label}
      {options.map((o) => (
        <button key={o} type="button" role="radio" aria-checked={value === o} className={chip(value === o)} onClick={() => onChange(o)}>
          {o}
        </button>
      ))}
    </span>
  );
}
