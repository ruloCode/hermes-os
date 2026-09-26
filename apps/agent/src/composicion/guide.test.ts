import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { decodeWav, phraseMold, trackPitch, type MelodyNote, type PassageAnalysis, type Phrase, type SungSyllable } from "@hermes/shared";

/**
 * GUÍA CANTADA por la ruta, de punta a punta, con el TTS SIMULADO: un
 * "hablante" sintético (tono de 150 Hz en las vocales, ruido en las
 * consonantes, alineación inventada de 80 ms por carácter) cantado sobre un
 * pasaje sintético de 5 notas. Se mide que las vocales queden en la altura de
 * SU nota, que la caché no vuelva a cobrar, y los errores (sin clave → 503).
 * Todo inventado: el repo es público.
 */

const FAKE_KEY = "clave-de-prueba-no-real";
const VOICE = "AbCdEf0123456789XyZw";
let dir: string;
let app: Hono;
let env: typeof import("../env.js").env;
let tts: typeof import("./tts.js");
const realFetch = globalThis.fetch;
let ttsCalls = 0;

// ─────────────────────────── Pasaje sintético ───────────────────────────

/** Cinco notas "na" de 0,4 s desde 0,5 s: La3 Do4 Re4 Mi4 Do4. */
const NOTES: [number, number, number][] = [
  [57, 0.5, 0.9],
  [60, 0.9, 1.3],
  [62, 1.3, 1.7],
  [64, 1.7, 2.1],
  [60, 2.1, 2.7],
];
const PASSAGE_SEC = 3.2;
const HOP = 0.01;

function syntheticAnalysis(sessionId: string): PassageAnalysis {
  const notes: MelodyNote[] = NOTES.map(([midi, start, end]) => ({ midi, start, end, cents: 0 }));
  const syllables: SungSyllable[] = NOTES.map(([midi, start, end], i) => ({
    text: "na",
    start,
    end,
    noteIdx: [i],
    midi,
    stressed: i === 0 || i === 3,
    filler: true,
    melisma: false,
    word: i,
    vowel: "a",
    vowelSource: "texto",
  }));
  const phrase: Phrase = {
    idx: 1,
    start: 0.5,
    end: 2.7,
    text: "na na na na na",
    syllables,
    mold: { syllables: 5, stresses: [1, 4], ending: "llana", melismas: [], long: [5] },
  };
  phrase.mold = phraseMold(phrase, "respetar");
  // f0 del "tarareo": la nota con un vibrato leve (el modo tarareo lo sigue).
  const f0 = Array.from({ length: Math.round(PASSAGE_SEC / HOP) }, (_, k) => {
    const t = k * HOP;
    const n = NOTES.find(([, s, e]) => t >= s && t < e);
    return n ? n[0] + 0.15 * Math.sin(2 * Math.PI * 5.5 * t) : null;
  });
  return {
    sessionId,
    passageId: "P01",
    version: 1,
    analyzedAt: "2026-09-24T12:00:00.000Z",
    source: "voz",
    tuningCents: 0,
    hop: HOP,
    f0,
    peaks: [],
    notes,
    phrases: [phrase],
    key: { best: { key: { tonic: 9, mode: "minor" }, score: 0.8 }, candidates: [], confidence: 0.5, source: "voz" },
    range: { lo: 57, hi: 64 },
    files: { mix: "analisis/P01/mezcla.wav" },
  };
}

// ─────────────────────────── TTS simulado ───────────────────────────

const VOWELS = new Set([..."aeiouáéíóú"]);
const CHAR_SEC = 0.08;

/** "Habla" sintética a 24 kHz: vocales = 150 Hz con armónicos; consonantes = ruido suave; espacios = silencio. */
function fakeSpeech(text: string): { b64: string; alignment: { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] } } {
  const sr = 24000;
  const chars = [...text];
  const per = Math.round(CHAR_SEC * sr);
  const buf = Buffer.alloc(chars.length * per * 2);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  let phase = 0;
  chars.forEach((c, k) => {
    for (let i = 0; i < per; i++) {
      let v = 0;
      if (VOWELS.has(c.toLowerCase())) {
        phase += (2 * Math.PI * 150) / sr;
        v = 0.3 * (Math.sin(phase) + 0.6 * Math.sin(2 * phase) + 0.4 * Math.sin(3 * phase) + 0.2 * Math.sin(4 * phase));
      } else if (c !== " ") v = 0.05 * rnd();
      buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), (k * per + i) * 2);
    }
  });
  return {
    b64: buf.toString("base64"),
    alignment: {
      characters: chars,
      character_start_times_seconds: chars.map((_, i) => i * CHAR_SEC),
      character_end_times_seconds: chars.map((_, i) => (i + 1) * CHAR_SEC),
    },
  };
}

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "hermes-composicion-guide-"));
  process.env.HERMES_COMPOSICION_DIR = join(dir, "estado");
  process.env.COMPOSICION_MEDIA_ROOT = join(dir, "medios");
  process.env.ELEVENLABS_API_KEY = FAKE_KEY;
  process.env.COMPOSICION_GUIDE_VOICE = "";
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (/\/with-timestamps/.test(url)) {
      ttsCalls++;
      const { text } = JSON.parse(String(init?.body));
      const s = fakeSpeech(text);
      return new Response(JSON.stringify({ audio_base64: s.b64, alignment: s.alignment }), {
        status: 200,
        headers: { "character-cost": String(text.length) },
      });
    }
    throw new Error(`fetch inesperado: ${url}`);
  }) as typeof fetch;

  const store = await import("./store.js");
  env = (await import("../env.js")).env;
  tts = await import("./tts.js");
  const { mountComposicionRoutes } = await import("./routes.js");
  app = new Hono();
  mountComposicionRoutes(app);

  const mediaDir = join(dir, "medios", "s-guia");
  await mkdir(join(mediaDir, "analisis", "P01"), { recursive: true });
  const now = new Date().toISOString();
  await store.createSessionRecord({
    id: "s-guia",
    title: "Guía sintética",
    createdAt: now,
    updatedAt: now,
    source: { path: join(mediaDir, "crudos", "x.wav"), name: "x.wav", bytes: 1, kind: "microfono" },
    mediaDir,
    mediaRoot: "disco",
    files: { audio: "assets/audio.wav" },
    language: "es",
    status: "lista",
    stages: store.freshStages(),
    speakers: [],
    passages: [
      {
        id: "P01",
        label: "P01",
        start: 0,
        end: PASSAGE_SEC,
        text: "na na na na na",
        kind: "silabas",
        confidence: 1,
        group: "probable",
        evidence: [],
        origin: "manual",
        status: "listo",
      },
    ],
  });
  await store.writeAnalysis(syntheticAnalysis("s-guia"));
});

after(async () => {
  globalThis.fetch = realFetch;
  await rm(dir, { recursive: true, force: true });
});

beforeEach(() => {
  env.ELEVENLABS_API_KEY = FAKE_KEY;
});

const post = (path: string, body: unknown) =>
  app.request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const GUIDE = "/composicion/sessions/s-guia/passages/P01/guide";
const LINE = { phrase: 1, text: "la luna sale" };

/** Mediana de la altura (MIDI) en el tramo [a, b] s del WAV. */
function medianMidi(pcm: Float32Array, sr: number, a: number, b: number): number {
  const tr = trackPitch(pcm.slice(Math.round(a * sr), Math.round(b * sr)), sr, { fmin: 70 });
  const v = Array.from(tr.midi).filter(Number.isFinite).sort((x, y) => x - y);
  return v.length ? v[v.length >> 1] : NaN;
}

describe("guía cantada: POST …/guide", () => {
  it("canta la línea en las notas del pasaje: 200, sílabas con tiempo y un WAV escrito", async () => {
    const res = await post(GUIDE, { lines: [LINE], mode: "respetar", pitch: "notas", voiceId: VOICE });
    const body = (await res.json()) as any;
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.engine, "psola");
    assert.equal(body.voiceId, VOICE);
    assert.equal(body.cached, false);
    assert.equal(body.ttsChars, LINE.text.length);
    assert.match(body.path, /^analisis\/P01\/guias\/[0-9a-f]+\.wav$/);
    assert.deepEqual(
      body.syllables.map((s: any) => s.phrase),
      [1, 1, 1, 1, 1],
    );
    assert.equal(body.syllables.length, 5, "la luna sale = la·lu·na·sa·le");
    for (let i = 0; i < 5; i++) {
      const s = body.syllables[i];
      assert.ok(s.start < s.end);
      // La vocal cae en el ataque; la consonante puede entrar hasta 60 ms antes.
      assert.ok(Math.abs(s.start - NOTES[i][1]) <= 0.08, `sílaba ${i}: ${s.start} vs nota ${NOTES[i][1]}`);
      if (i) assert.ok(s.start >= body.syllables[i - 1].start);
    }

    const wav = decodeWav(new Uint8Array(await readFile(join(dir, "medios", "s-guia", body.path))));
    assert.equal(wav.sr, body.sr);
    assert.ok(Math.abs(wav.pcm.length / wav.sr - PASSAGE_SEC) < 0.3, "el WAV dura lo que el pasaje");
    // Cada vocal en la altura de SU nota (±50 c): se mide el final de cada sílaba, donde ya es vocal.
    for (let i = 0; i < 5; i++) {
      const [midi, start, end] = NOTES[i];
      const got = medianMidi(wav.pcm, wav.sr, start + 0.5 * (end - start), end - 0.05);
      assert.ok(Math.abs(got - midi) <= 0.5, `nota ${i}: esperaba ${midi}, midió ${got.toFixed(2)}`);
    }
  });

  it("el mismo pedido sale de la caché (0 caracteres); otros semitonos re-renderizan SIN cobrar", async () => {
    const before = ttsCalls;
    const res = await post(GUIDE, { lines: [LINE], mode: "respetar", pitch: "notas", voiceId: VOICE });
    const body = (await res.json()) as any;
    assert.equal(res.status, 200);
    assert.equal(body.cached, true);
    assert.equal(body.ttsChars, 0);
    assert.equal(body.syllables.length, 5);
    const up = await post(GUIDE, { lines: [LINE], mode: "respetar", pitch: "tarareo", semitones: 2, voiceId: VOICE });
    const upBody = (await up.json()) as any;
    assert.equal(up.status, 200, JSON.stringify(upBody));
    assert.equal(upBody.cached, false, "otro pedido = otro WAV");
    assert.equal(upBody.ttsChars, 0, "el TTS salió de su caché");
    assert.notEqual(upBody.path, body.path);
    assert.equal(ttsCalls, before, "ni una llamada nueva a ElevenLabs");
    assert.ok(existsSync(join(dir, "medios", "s-guia", upBody.path)));
  });

  it("sin ELEVENLABS_API_KEY → 503 con el motivo (y las voces también)", async () => {
    env.ELEVENLABS_API_KEY = "";
    const res = await post(GUIDE, { lines: [LINE], mode: "respetar", pitch: "notas", voiceId: VOICE });
    assert.equal(res.status, 503);
    assert.match(((await res.json()) as any).error, /ELEVENLABS_API_KEY/);
    tts.resetVoicesCache();
    const voices = await app.request("/composicion/guide/voices");
    assert.equal(voices.status, 503);
    assert.match(((await voices.json()) as any).error, /ELEVENLABS_API_KEY/);
  });

  it("valida el pedido: voz obligatoria sin default, frase inexistente, semitonos fuera de rango", async () => {
    const noVoice = await post(GUIDE, { lines: [LINE], mode: "respetar", pitch: "notas" });
    assert.equal(noVoice.status, 400);
    assert.match(((await noVoice.json()) as any).error, /elige una voz/);
    const bad = await post(GUIDE, { lines: [{ phrase: 9, text: "hola" }], mode: "respetar", pitch: "notas", voiceId: VOICE });
    assert.equal(bad.status, 400);
    const semis = await post(GUIDE, { lines: [LINE], mode: "respetar", pitch: "notas", semitones: 30, voiceId: VOICE });
    assert.equal(semis.status, 400);
    const pitch = await post(GUIDE, { lines: [LINE], mode: "respetar", pitch: "robot", voiceId: VOICE });
    assert.equal(pitch.status, 400);
    const missing = await post("/composicion/sessions/s-guia/passages/P09/guide", { lines: [LINE], voiceId: VOICE });
    assert.equal(missing.status, 404);
  });

  it("la privacidad dice que el texto de las líneas va al TTS (solo con clave)", async () => {
    const withKey = (await (await app.request("/composicion/privacy")).json()) as any;
    assert.ok(withKey.external.some((e: any) => /ElevenLabs \(voz genérica\)/.test(e.to) && /guía cantada/.test(e.when)));
    env.ELEVENLABS_API_KEY = "";
    const without = (await (await app.request("/composicion/privacy")).json()) as any;
    assert.ok(!without.external.some((e: any) => /ElevenLabs/.test(e.to)));
  });
});

describe("guía cantada: el pool de TTS", () => {
  it("al PRIMER fallo nadie pide un TTS nuevo (lo que ya estaba en vuelo termina) y se rechaza con ese error", async () => {
    const { pool } = await import("./guide.js");
    const started: number[] = [];
    const boom = new Error("ElevenLabs: sin créditos");
    const run = pool([0, 1, 2, 3, 4, 5], 2, async (i) => {
      started.push(i);
      await new Promise((r) => setTimeout(r, i === 0 ? 5 : 20));
      if (i === 0) throw boom;
      return i;
    });
    await assert.rejects(run, (err: unknown) => err === boom);
    // Deja que el otro worker termine lo suyo: no debe tomar el siguiente.
    await new Promise((r) => setTimeout(r, 60));
    assert.deepEqual(started, [0, 1], "solo lo que ya estaba en vuelo");
  });

  it("sin fallos conserva el orden y respeta el tope en vuelo", async () => {
    const { pool } = await import("./guide.js");
    let live = 0;
    let peak = 0;
    const out = await pool([5, 1, 4, 2, 3], 2, async (x) => {
      peak = Math.max(peak, ++live);
      await new Promise((r) => setTimeout(r, x));
      live--;
      return x * 10;
    });
    assert.deepEqual(out, [50, 10, 40, 20, 30]);
    assert.equal(peak, 2);
  });
});
