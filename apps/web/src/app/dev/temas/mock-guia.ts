/**
 * GUÍA CANTADA sintética para /dev/temas (se registra sobre ./mock al
 * importarse, como el montaje). Nada sale del navegador ni se habla con
 * ElevenLabs: las "voces" son nombres inventados y el WAV son TONOS — cada
 * sílaba de la lectura (`lineReading`, la misma de `lineFit`) suena en la
 * altura de SU nota del molde, con un soplo de ruido de consonante al entrar y
 * un color por vocal. Sirve para revisar el karaoke, la alineación sobre la
 * pista, el costo y los errores sin gastar un carácter.
 *
 * Escenarios por URL (`?guia=`):
 *   (nada)    el "agente" no tiene voz por defecto → la 1ª guía pide elegir una
 *   default   el agente tiene voz por defecto
 *   sinclave  503 sin ELEVENLABS_API_KEY (voces y guía)
 *   cuota     402 sin caracteres
 *   falla     502 ElevenLabs falló
 *   lenta     4 s de render (para ver "preparando" y cancelar)
 *
 * Además registra una SESIÓN con palabras reales (sin tarareo con vocales):
 * es el caso en que el eco no existe y la UI tiene que degradar sin inventar.
 */
import {
  encodeWav16,
  lineReading,
  moldPositions,
  phraseMold,
  splitSyllables,
  stressedSyllable,
  type ComposeSession,
  type GuideResult,
  type MelodyNote,
  type PassageAnalysis,
  type Phrase,
  type SungSyllable,
} from "@hermes/shared";
import { ComposeApiError, type GuideVoice } from "@/lib/hermes";
import { guideHooks, mockPlaygroundApi, takes, version } from "./mock";

const SR = 24000;
const VOICES: GuideVoice[] = [
  { id: "voz-demo-a", name: "Voz genérica A", gender: "female", accent: "latinoamericano" },
  { id: "voz-demo-b", name: "Voz genérica B", gender: "male", accent: "neutro" },
  { id: "voz-demo-c", name: "Voz genérica C", gender: "female", accent: "español" },
];

const scenario = () => (typeof location === "undefined" ? "" : (new URLSearchParams(location.search).get("guia") ?? ""));

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(Object.assign(new Error("abortado"), { name: "AbortError" }));
    });
  });
}

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0");
}

/** Armónicos por vocal (un color distinto para cada una, nada más). */
const TIMBRE: Record<string, number[]> = {
  a: [1, 0.8, 0.6, 0.35, 0.2],
  e: [1, 0.5, 0.5, 0.4, 0.25],
  i: [1, 0.25, 0.15, 0.35, 0.3],
  o: [1, 0.9, 0.35, 0.15, 0.08],
  u: [1, 0.5, 0.12, 0.05, 0.03],
};
const vowelOf = (syl: string): string => {
  const plain = syl.normalize("NFD").replace(/[̀-ͯ]/g, "");
  return [...plain].find((c) => "aeo".includes(c)) ?? [...plain].reverse().find((c) => "iu".includes(c)) ?? "a";
};
const hz = (m: number) => 440 * 2 ** ((m - 69) / 12);

const files = new Map<string, string>();
/** Texto ya "leído" por voz: la segunda vez sale de caché (0 caracteres). */
const spoken = new Set<string>();

guideHooks.voices = async (signal) => {
  await wait(250, signal);
  if (scenario() === "sinclave") throw new ComposeApiError("sin ELEVENLABS_API_KEY: no hay voces para la guía cantada", 503);
  return VOICES;
};

guideHooks.fileUrl = (sid, rel) => files.get(`${sid}|${rel}`) ?? null;

guideHooks.guide = async (sid, pid, req, signal) => {
  const sc = scenario();
  if (sc === "sinclave")
    throw new ComposeApiError("sin ELEVENLABS_API_KEY: la guía cantada necesita el TTS de ElevenLabs (voz genérica)", 503);
  const voice = req.voiceId ?? (sc === "default" ? VOICES[0].id : null);
  if (!voice) throw new ComposeApiError("elige una voz para la guía (GET /composicion/guide/voices)", 400);
  const analysis = await mockPlaygroundApi.analysis(sid, pid);
  if (!analysis) throw new ComposeApiError("el pasaje todavía no tiene análisis (melodía)", 409);
  await wait(sc === "lenta" ? 4000 : 650, signal);
  if (sc === "cuota") throw new ComposeApiError("ElevenLabs: sin caracteres o créditos para el TTS (401) — quota_exceeded", 402);
  if (sc === "falla") throw new ComposeApiError("ElevenLabs TTS falló (500) — internal_error", 502);

  const semis = req.semitones ?? 0;
  const warnings: string[] = [];
  const syllables: GuideResult["syllables"] = [];
  const segs: { start: number; end: number; notes: { midi: number; start: number; end: number }[]; vowel: string }[] = [];
  let chars = 0;
  for (const line of req.lines) {
    const ph = analysis.phrases.find((p) => p.idx === line.phrase);
    if (!ph) throw new ComposeApiError(`la frase ${line.phrase} no existe en el pasaje`, 400);
    const text = line.text.trim();
    const k = `${voice}|${text}`;
    if (!spoken.has(k)) {
      chars += text.length;
      spoken.add(k);
    }
    const mold = phraseMold(ph, req.mode);
    const ps = moldPositions(ph, req.mode).slice(0, mold.syllables);
    const reading = lineReading(text, mold, req.mode);
    if (reading.length !== ps.length)
      warnings.push(
        `frase ${line.phrase}: la letra lee ${reading.length} sílabas y el molde pide ${ps.length}; ${
          reading.length > ps.length ? "las que sobran no suenan" : "las posiciones sin sílaba quedan mudas"
        }`,
      );
    const n = Math.min(reading.length, ps.length);
    for (let i = 0; i < n; i++) {
      const p = ps[i];
      const start = Math.max(0, p.start - 0.04);
      syllables.push({ phrase: line.phrase, text: reading[i], start: round3(start), end: round3(p.end) });
      segs.push({
        start,
        end: p.end,
        notes: p.notes.filter((x) => x.midi != null).map((x) => ({ midi: (x.midi as number) + semis, start: x.start, end: x.end })),
        vowel: vowelOf(reading[i]),
      });
    }
  }
  syllables.sort((a, b) => a.start - b.start);

  const passageDur = Math.max(analysis.hop * analysis.f0.length, ...analysis.notes.map((x) => x.end));
  const dur = Math.max(passageDur, ...segs.map((x) => x.end + 0.25));
  const pcm = new Float32Array(Math.ceil(dur * SR));
  const tarareo = req.pitch === "tarareo";
  for (const seg of segs) {
    // Consonante: un soplo corto de ruido antes de la vocal.
    const c0 = Math.floor(seg.start * SR);
    for (let i = 0; i < 0.035 * SR && c0 + i < pcm.length; i++) pcm[c0 + i] += (Math.random() * 2 - 1) * 0.05 * (1 - i / (0.035 * SR));
    const harm = TIMBRE[seg.vowel] ?? TIMBRE.a;
    let phase = 0;
    const v0 = seg.start + 0.035;
    for (const nt of seg.notes) {
      const a = Math.max(nt.start, v0);
      const b = Math.max(a + 0.05, nt.end);
      const i0 = Math.floor(a * SR);
      const i1 = Math.min(pcm.length, Math.floor(b * SR));
      for (let i = i0; i < i1; i++) {
        const t = i / SR;
        // "notas": vibrato suave; "tarareo": más ancho y lento, como una voz que se mueve.
        const cents = tarareo ? 35 * Math.sin(2 * Math.PI * 4.2 * t) + 15 * Math.sin(2 * Math.PI * 0.9 * t) : 22 * Math.sin(2 * Math.PI * 5.5 * t);
        phase += (2 * Math.PI * hz(nt.midi) * 2 ** (cents / 1200)) / SR;
        const into = (i - i0) / SR;
        const left = (i1 - i) / SR;
        const env = Math.min(1, into / 0.015) * Math.min(1, left / 0.04);
        let v = 0;
        harm.forEach((h, j) => (v += h * Math.sin((j + 1) * phase)));
        pcm[i] += 0.16 * env * v;
      }
    }
  }
  let peak = 0;
  for (let i = 0; i < pcm.length; i++) peak = Math.max(peak, Math.abs(pcm[i]));
  if (peak > 0.95) for (let i = 0; i < pcm.length; i++) pcm[i] *= 0.9 / peak;

  const path = `analisis/${pid}/guias/${hash(JSON.stringify([sid, req, voice]))}.wav`;
  const key = `${sid}|${path}`;
  const existed = files.has(key);
  if (!existed) files.set(key, URL.createObjectURL(new Blob([encodeWav16(pcm, SR) as BlobPart], { type: "audio/wav" })));
  return { path, engine: "psola", voiceId: voice, sr: SR, syllables, ttsChars: chars, cached: existed && chars === 0, warnings };
};

const round3 = (n: number) => Math.round(n * 1000) / 1000;

// ─────────────────────────── Una sesión con PALABRAS (sin tarareo) ───────────────────────────

const WORD_LINES = ["cuando la noche se acaba", "vuelvo a mirar la ventana"];
const MELODY = [64, 65, 67, 69, 67, 65, 64, 62, 64, 65, 67, 67, 65, 64];

function wordsAnalysis(sid: string): PassageAnalysis {
  const notes: MelodyNote[] = [];
  let t = 0.8;
  let m = 0;
  const phrases: Phrase[] = WORD_LINES.map((line, idx) => {
    const syllables: SungSyllable[] = [];
    line.split(" ").forEach((w, wi) => {
      const syl = splitSyllables(w);
      const tonic = syl.length === 1 ? 0 : stressedSyllable(w);
      syl.forEach((s, k) => {
        const stressed = k === tonic && !["la", "a", "se"].includes(w);
        const len = stressed ? 0.46 : 0.3;
        // La última sílaba de la frase 2 se estira sobre dos notas (un melisma).
        const mel = idx === 1 && wi === line.split(" ").length - 1 && k === syl.length - 1;
        const idxs: number[] = [];
        const parts = mel ? [MELODY[m % MELODY.length], MELODY[(m + 1) % MELODY.length]] : [MELODY[m % MELODY.length]];
        const total = mel ? 0.9 : len;
        parts.forEach((midi, j) => {
          const a = t + (j * total) / parts.length;
          notes.push({ midi, start: a, end: a + total / parts.length - 0.02, cents: 0 });
          idxs.push(notes.length - 1);
        });
        syllables.push({
          text: s,
          start: t,
          end: t + total - 0.02,
          noteIdx: idxs,
          midi: parts[0],
          stressed,
          filler: false,
          melisma: mel,
          word: wi,
          ...(mel ? { parts: idxs.map((j) => ({ midi: notes[j].midi, start: notes[j].start, end: notes[j].end })) } : {}),
        });
        t += total;
        m += parts.length;
      });
    });
    const ph: Phrase = {
      idx,
      start: syllables[0].start,
      end: syllables[syllables.length - 1].end,
      text: line,
      syllables,
      mold: { syllables: syllables.length, stresses: [], ending: "llana", melismas: [], long: [] },
    };
    t += 0.7;
    return { ...ph, mold: phraseMold(ph, "respetar") };
  });
  const hop = 0.02;
  const frames = Math.ceil((t + 0.4) / hop);
  const f0 = Array.from({ length: frames }, (_, i) => notes.find((n) => i * hop >= n.start && i * hop < n.end)?.midi ?? null);
  const key = { key: { tonic: 4, mode: "minor" as const }, score: 0.7 };
  return {
    sessionId: sid,
    passageId: "P01",
    version: 1,
    analyzedAt: new Date(Date.now() - 40 * 60_000).toISOString(),
    source: "voz",
    tuningCents: 0,
    hop,
    f0,
    peaks: Array.from({ length: 400 }, (_, i) => (f0[Math.floor((i / 400) * frames)] != null ? 0.5 : 0.04)),
    notes,
    phrases,
    key: { best: key, candidates: [key], confidence: 0.35, source: "voz" },
    range: { lo: Math.min(...notes.map((n) => n.midi)), hi: Math.max(...notes.map((n) => n.midi)) },
    files: { mix: "analisis/P01/mezcla.wav" },
  };
}

{
  const sid = "sesion-palabras";
  const at = new Date(Date.now() - 3 * 3600_000).toISOString();
  const analysis = wordsAnalysis(sid);
  const end = analysis.hop * analysis.f0.length;
  const session: ComposeSession = {
    id: sid,
    title: "Memo con palabras",
    createdAt: at,
    updatedAt: at,
    recordedAt: at,
    source: { path: "(sintético)", name: "memo.m4a", bytes: 0, kind: "microfono" },
    mediaDir: "/sintetico",
    mediaRoot: "local",
    files: { audio: "audio.wav" },
    durationSec: end,
    language: "es",
    status: "lista",
    stages: [],
    speakers: [],
    passages: [
      {
        id: "P01",
        label: "P01",
        start: 0,
        end,
        text: WORD_LINES.join(" / "),
        kind: "letra",
        confidence: 0.9,
        group: "probable",
        evidence: ["letra cantada"],
        origin: "manual",
        status: "listo",
        syllables: analysis.phrases.reduce((a, p) => a + p.syllables.length, 0),
        melismas: 1,
      },
    ],
  };
  const v = version(
    analysis,
    "imagen concreta",
    ["cuando se apaga la calle", "vuelvo a buscar tu ventana"],
    ["cambia el sujeto, conserva el pulso", "la vocal abierta en el melisma"],
    "respetar",
  );
  takes.set(sid, {
    session,
    readyAt: 0,
    analysis,
    board: { sessionId: sid, passageId: "P01", versions: [v], mine: [], locked: [], melismaMode: "respetar", updatedAt: at },
    temaId: "",
  });
}
