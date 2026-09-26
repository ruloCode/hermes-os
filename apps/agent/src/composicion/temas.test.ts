import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import type { ComposeSession, PassageAnalysis, TakeMeta, Tema } from "@hermes/shared";
import { SR, concat, midiToHz, silence, tone } from "./test-helpers.js";

/**
 * TEMAS del lado agente: alta (en blanco y desde un tarareo), tomas con su
 * número por sección, ★ exclusiva, latencia que corre la rejilla, detalle con
 * candidatos y, de punta a punta, una toma SINTÉTICA leída en su compás y
 * paso. Todo con carpetas temporales fijadas ANTES de importar (env.ts las lee
 * al cargar) y datos inventados: el repo es público.
 */

let dir: string;
let store: typeof import("./store.js");
let temas: typeof import("./temas.js");
let pipeline: typeof import("./pipeline.js");
let media: typeof import("./media.js");
let app: Hono;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "hermes-composicion-temas-"));
  process.env.HERMES_COMPOSICION_DIR = join(dir, "estado");
  process.env.COMPOSICION_MEDIA_ROOT = join(dir, "medios", "sesiones");
  // La raíz cuenta como "conectada" si su carpeta madre existe; si no, cae al
  // fallback local (~/Movies/composicion) y el test escribiría en el home real.
  await mkdir(join(dir, "medios"), { recursive: true });
  // Scribe nunca: una toma es local, y si algo intentara salir el test lo delataría.
  delete process.env.ELEVENLABS_API_KEY;
  store = await import("./store.js");
  temas = await import("./temas.js");
  pipeline = await import("./pipeline.js");
  media = await import("./media.js");
  if (!media.temasMediaRoot().root.startsWith(dir))
    throw new Error(`la raíz de temas se salió de la carpeta temporal: ${media.temasMediaRoot().root}`);
  const { mountComposicionRoutes } = await import("./routes.js");
  app = new Hono();
  mountComposicionRoutes(app);
});

after(async () => {
  // Nada puede seguir escribiendo en la carpeta que se borra.
  for (const s of await store.listSessions()) await pipeline.whenIdle(s.id);
  await rm(dir, { recursive: true, force: true });
});

// ─────────────────────────── WAV sintético ───────────────────────────

/** WAV PCM16 mono a mano (la cabecera de 44 bytes): no depende de wav.ts. */
function wavByHand(pcm: Float32Array, sr: number): Uint8Array {
  const buf = Buffer.alloc(44 + pcm.length * 2);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + pcm.length * 2, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(pcm.length * 2, 40);
  for (let i = 0; i < pcm.length; i++)
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, pcm[i])) * 32767), 44 + i * 2);
  return new Uint8Array(buf);
}

async function wav16(pcm: Float32Array, sr = SR): Promise<Uint8Array> {
  const { encodeWav16 } = await import("@hermes/shared");
  try {
    return encodeWav16(pcm, sr);
  } catch {
    return wavByHand(pcm, sr);
  }
}

const BPM = 90;
const DOWNBEAT = 0.6;
const STEP = 60 / BPM / 4;
const HARM = [1, 0.5, 0.25];

/**
 * Un compás de 4/4 a 90 bpm con ANACRUSA: una nota 2 semicorcheas antes del
 * primer tiempo y cuatro negras (La menor arpegiado) en los pasos 0, 4, 8 y
 * 12 del compás 1. Cada nota se corta antes del siguiente ataque (silencio =
 * sílaba nueva).
 */
function syntheticTake(): { pcm: Float32Array; expected: { bar: number; stepInBar: number; midi: number }[] } {
  const notes = [
    { absStep: -2, len: 0.16, midi: 64 },
    { absStep: 0, len: 0.45, midi: 69 },
    { absStep: 4, len: 0.45, midi: 72 },
    { absStep: 8, len: 0.45, midi: 76 },
    { absStep: 12, len: 0.45, midi: 69 },
  ];
  const parts: Float32Array[] = [];
  let t = 0;
  for (const n of notes) {
    const at = DOWNBEAT + n.absStep * STEP;
    parts.push(silence(at - t), tone(midiToHz(n.midi), n.len, { harmonics: HARM, amp: 0.4 }));
    t = at + n.len;
  }
  parts.push(silence(0.5));
  return {
    pcm: concat(...parts),
    expected: notes.map((n) => ({
      bar: n.absStep < 0 ? 0 : 1,
      stepInBar: ((n.absStep % 16) + 16) % 16,
      midi: n.midi,
    })),
  };
}

function meta(tema: Tema, over: Partial<TakeMeta> = {}): Omit<TakeMeta, "n"> {
  return {
    temaId: tema.id,
    sectionId: tema.track.sections[0].id,
    grid: {
      bpm: BPM,
      meter: "4/4",
      key: { tonic: 9, mode: "minor" },
      downbeatSec: DOWNBEAT,
      loop: [{ chords: [{ symbol: "Am", beat: 0 }] }],
      bars: 1,
    },
    latency: { ms: 20, source: "medida" },
    monitor: "audifonos",
    stt: false,
    ...over,
  };
}

// ─────────────────────────── Raíz de medios ───────────────────────────

describe("temasMediaRoot", () => {
  it("es hermana de la raíz de sesiones y la toma vive en <tema>/tomas/<sid>", () => {
    const root = media.temasMediaRoot();
    assert.equal(root.root, join(dir, "medios", "temas"));
    assert.equal(media.takeMediaDir(root.root, "t1", "s1"), join(dir, "medios", "temas", "t1", "tomas", "s1"));
  });
});

// ─────────────────────────── Alta ───────────────────────────

describe("createTema", () => {
  it("en blanco: id legible, sección Coro, se lista con 0 tomas", async () => {
    const t = await temas.createTema({ title: "Coro de prueba" });
    assert.match(t.id, /^\d{4}-\d{2}-\d{2}-coro-de-prueba$/);
    assert.ok(t.track.sections.length >= 1);
    assert.deepEqual(await store.readTema(t.id), t);
    const item = (await store.listTemas()).find((x) => x.id === t.id);
    assert.equal(item?.takes, 0);
    assert.equal(item?.bpm, t.track.bpm);
  });

  it("desde un pasaje: tonalidad medida (el instrumento manda), bpm estimado y el pasaje en el Coro", async () => {
    const now = new Date().toISOString();
    await store.createSessionRecord({
      id: "s-tarareo",
      title: "Ensayo inventado",
      createdAt: now,
      updatedAt: now,
      source: { path: "/tmp/x.wav", name: "x.wav", bytes: 1, kind: "archivo" },
      mediaDir: join(dir, "medios", "sesiones", "s-tarareo"),
      mediaRoot: "disco",
      files: {},
      language: "es",
      status: "lista",
      stages: store.freshStages(),
      speakers: [],
      passages: [
        {
          id: "P03",
          label: "P03",
          start: 10,
          end: 20,
          text: "dun dun uh",
          kind: "silabas",
          confidence: 0.8,
          group: "probable",
          evidence: [],
          origin: "auto",
          status: "listo",
        },
      ],
    });
    // Negras a 96 bpm: 0,625 s entre ataques.
    const notes = Array.from({ length: 16 }, (_, i) => ({ midi: 57 + (i % 3), start: i * 0.625, end: i * 0.625 + 0.4, cents: 0 }));
    const est = (tonic: number, mode: "major" | "minor", source: "voz" | "instrumento") => ({
      best: { key: { tonic, mode }, score: 0.8 },
      candidates: [{ key: { tonic, mode }, score: 0.8 }],
      confidence: 0.5,
      source,
    });
    await store.writeAnalysis({
      sessionId: "s-tarareo",
      passageId: "P03",
      version: 1,
      analyzedAt: now,
      source: "voz",
      tuningCents: 0,
      hop: 0.02,
      f0: [],
      peaks: [],
      notes,
      phrases: [],
      key: est(0, "major", "voz"),
      instrumentKey: est(9, "minor", "instrumento"),
      range: { lo: 57, hi: 59 },
      files: { mix: "analisis/P03/mezcla.wav" },
    } satisfies PassageAnalysis);

    const t = await temas.createTema({ fromPassage: { sessionId: "s-tarareo", passageId: "P03" } });
    assert.deepEqual(t.track.key, { tonic: 9, mode: "minor" });
    assert.equal(t.track.keySource, "medida");
    assert.equal(t.track.bpmSource, "estimado");
    assert.ok(Math.abs(t.track.bpm - 96) <= 3, `bpm estimado ${t.track.bpm}`);
    assert.deepEqual(t.origin, { sessionId: "s-tarareo", passageId: "P03" });
    const coro = t.track.sections.find((s) => s.kind === "coro") ?? t.track.sections[0];
    assert.deepEqual(coro.refs, [{ sessionId: "s-tarareo", passageId: "P03" }]);
    assert.match(t.title, /Ensayo inventado · P03/);

    // El detalle lo muestra como candidato "pasaje" (sin rejilla) de esa sección.
    const d = await temas.temaDetail(t.id);
    const c = d.candidates.find((x) => x.kind === "pasaje");
    assert.equal(c?.sectionId, coro.id);
    assert.equal(c?.onGrid, false);
    assert.equal(c?.status, "listo");
    assert.deepEqual(c?.lyrics, { versions: 0, mine: 0 });
  });

  it("desde un pasaje que no existe → 404", async () => {
    await assert.rejects(
      temas.createTema({ fromPassage: { sessionId: "s-tarareo", passageId: "P99" } }),
      store.ComposicionNotFoundError,
    );
    await assert.rejects(temas.createTema({ fromPassage: { sessionId: 5 } }), temas.TemaError);
  });
});

// ─────────────────────────── Tomas ───────────────────────────

describe("createTake / patchTake", () => {
  let tema: Tema;
  let take1: ComposeSession;
  let take2: ComposeSession;
  let expected: ReturnType<typeof syntheticTake>["expected"];

  before(async () => {
    tema = await temas.createTema({ title: "Tomas inventadas" });
    const synth = syntheticTake();
    expected = synth.expected;
    const bytes = await wav16(synth.pcm);
    take1 = await temas.createTake(tema.id, bytes, meta(tema));
    take2 = await temas.createTake(tema.id, bytes, meta(tema, { hint: "na na na na na" }));
  });

  it("la toma es una sesión con take, n por sección, título y carpeta de la toma", async () => {
    assert.equal(take1.take?.n, 1);
    assert.equal(take2.take?.n, 2);
    assert.equal(take1.take?.temaId, tema.id);
    assert.equal(take1.title, `Toma 1 · ${tema.track.sections[0].label}`);
    assert.equal(take1.language, "es");
    assert.equal(take1.mediaDir, join(dir, "medios", "temas", tema.id, "tomas", take1.id));
    assert.ok(existsSync(join(take1.mediaDir, "crudos", "toma.wav")));
    assert.ok(Math.abs((take1.durationSec ?? 0) - syntheticTake().pcm.length / SR) < 0.01);
    const summary = (await store.listSessions()).find((s) => s.id === take1.id);
    assert.deepEqual(summary?.take, { temaId: tema.id, sectionId: tema.track.sections[0].id, n: 1 });
    assert.equal((await store.listTemas()).find((x) => x.id === tema.id)?.takes, 2);
  });

  it("otra sección numera desde 1", async () => {
    const withVerse = await temas.updateTema(tema.id, {
      track: {
        sections: [
          ...tema.track.sections,
          { id: "verso", kind: "verso", label: "Verso", loop: [{ chords: [{ symbol: "F", beat: 0 }] }], bars: 4 },
        ],
      },
    });
    const bytes = await wav16(syntheticTake().pcm);
    const v = await temas.createTake(withVerse.id, bytes, meta(withVerse, { sectionId: "verso" }));
    assert.equal(v.take?.n, 1);
    assert.equal(v.title, "Toma 1 · Verso");
    await pipeline.whenIdle(v.id);
  });

  it("valida el WAV y la meta antes de escribir nada", async () => {
    const good = await wav16(syntheticTake().pcm);
    const bad = new TextEncoder().encode("esto no es un wav");
    await assert.rejects(temas.createTake(tema.id, bad, meta(tema)), (e: Error) => e instanceof temas.TemaError && /WAV/.test(e.message));
    await assert.rejects(temas.createTake(tema.id, good, meta(tema, { sectionId: "puente" })), /no existe/);
    const late = meta(tema);
    late.grid = { ...late.grid, downbeatSec: 60 };
    await assert.rejects(temas.createTake(tema.id, good, late), /fuera de la toma/);
    const slow = meta(tema);
    slow.grid = { ...slow.grid, bpm: 12 };
    await assert.rejects(temas.createTake(tema.id, good, slow), /grid\.bpm/);
    const chord = meta(tema);
    chord.grid = { ...chord.grid, loop: [{ chords: [{ symbol: "Xyz", beat: 0 }] }] };
    await assert.rejects(temas.createTake(tema.id, good, chord), /acorde/);
    await assert.rejects(temas.createTake("no-existe", good, meta(tema)), store.ComposicionNotFoundError);
  });

  it("la tubería de una toma: nada sale del equipo, sin resumen, P01 = la toma, sin separar con audífonos", async () => {
    await pipeline.whenIdle(take1.id);
    const s = (await store.readSession(take1.id))!;
    const st = (name: string) => s.stages.find((x) => x.stage === name)!;
    assert.equal(st("copiar").status, "listo");
    assert.equal(st("transcribir").status, "omitido");
    assert.match(st("transcribir").detail ?? "", /no sale del equipo/);
    assert.equal(st("resumen").status, "omitido");
    assert.equal(st("separar").status, "omitido");
    assert.match(st("separar").detail ?? "", /audífonos/);
    if (!existsSync(media.FFMPEG)) return; // sin ffmpeg no hay audio que medir
    assert.equal(st("audio").status, "listo");
    assert.equal(s.passages.length, 1);
    assert.equal(s.passages[0].id, "P01");
    assert.equal(s.passages[0].start, 0);
    assert.ok(Math.abs(s.passages[0].end - (s.durationSec ?? 0)) < 0.02);
    assert.equal(s.passages[0].origin, "manual");
  });

  it("la toma sintética cae en su compás y su paso (con anacrusa)", async (t) => {
    if (!existsSync(media.FFMPEG)) return t.skip("sin ffmpeg");
    await pipeline.whenIdle(take1.id);
    const s = (await store.readSession(take1.id))!;
    const melodia = s.stages.find((x) => x.stage === "melodia")!;
    assert.equal(melodia.status, "listo", melodia.error ?? melodia.detail);
    const a = (await store.readAnalysis(take1.id, "P01"))!;
    assert.equal(a.source, "voz", "con audífonos la mezcla ES la voz");
    assert.equal(a.files.voice, join("analisis", "P01", "voz.wav"), "y se expone como voz.wav (transponer, guía)");
    assert.equal(a.tuningCents, 0);
    assert.ok(a.grid, "la toma trae su lectura en la rejilla");
    assert.equal(a.grid!.bpm, BPM);
    assert.deepEqual(a.grid!.key, { tonic: 9, mode: "minor" });
    assert.deepEqual(
      a.grid!.notes.map((n) => ({ bar: n.bar, stepInBar: n.stepInBar, midi: a.notes[n.i].midi })),
      expected,
    );
    assert.ok(Math.abs(a.grid!.medianOffMs) < 30, `desvío mediano ${a.grid!.medianOffMs} ms`);
    // Cada sílaba sabe dónde cae en la rejilla.
    const syl = a.phrases.flatMap((p) => p.syllables);
    assert.ok(syl.length >= 1 && syl.every((y) => y.metric && Number.isFinite(y.metric.absStep)));
    assert.equal(s.tuningCents, 0);
  });

  it("la pista de texto manda: vocal del texto en cada sílaba", async (t) => {
    if (!existsSync(media.FFMPEG)) return t.skip("sin ffmpeg");
    await pipeline.whenIdle(take2.id);
    const a = await store.readAnalysis(take2.id, "P01");
    assert.ok(a, "la segunda toma también se analizó");
    const syl = a!.phrases.flatMap((p) => p.syllables);
    assert.ok(syl.length > 0);
    assert.ok(syl.every((y) => y.vowel === "a" && y.vowelSource === "texto"), JSON.stringify(syl.map((y) => [y.text, y.vowel])));
  });

  it("★ es una por sección", async () => {
    const a = await temas.patchTake(tema.id, take1.id, { favorite: true });
    assert.equal(a.take?.favorite, true);
    await temas.patchTake(tema.id, take2.id, { favorite: true });
    assert.equal((await store.readSession(take1.id))?.take?.favorite, false);
    assert.equal((await store.readSession(take2.id))?.take?.favorite, true);
  });

  it("latencia: corre el primer tiempo por la diferencia y re-analiza; fuera de la toma → 400", async () => {
    await pipeline.whenIdle(take1.id);
    const s = await temas.patchTake(tema.id, take1.id, { latencyMs: 50 });
    assert.ok(Math.abs(s.take!.grid.downbeatSec - (DOWNBEAT + 0.03)) < 1e-6);
    assert.deepEqual(s.take!.latency, { ms: 50, source: "manual" });
    await pipeline.whenIdle(take1.id);
    if (existsSync(media.FFMPEG)) {
      const a = await store.readAnalysis(take1.id, "P01");
      assert.ok(Math.abs((a?.grid?.downbeatSec ?? 0) - (DOWNBEAT + 0.03)) < 1e-6, "el re-análisis usó la rejilla nueva");
    }
    await assert.rejects(temas.patchTake(tema.id, take1.id, { latencyMs: -999 }), /fuera de la toma/);
    await assert.rejects(temas.patchTake(tema.id, take1.id, { bpm: 100 }), /campo desconocido/);
    await assert.rejects(temas.patchTake("otro-tema", take1.id, { favorite: true }), store.ComposicionNotFoundError);
  });

  it("detalle: las tomas como candidatos de su sección, en orden, con sus gates", async () => {
    const d = await temas.temaDetail(tema.id);
    const takes = d.candidates.filter((c) => c.kind === "toma");
    assert.deepEqual(
      takes.map((c) => [c.sectionId, c.label]),
      [
        [tema.track.sections[0].id, `Toma 1 · ${tema.track.sections[0].label}`],
        [tema.track.sections[0].id, `Toma 2 · ${tema.track.sections[0].label}`],
        ["verso", "Toma 1 · Verso"],
      ],
    );
    assert.ok(takes.every((c) => c.onGrid && c.memo.passageId === "P01" && c.lyrics.versions === 0));
    assert.equal(takes[1].favorite, true);
    assert.equal(d.gates.length, 6);
  });

  it("por la ruta: multipart con audio + meta; meta rota → 400", async () => {
    const bytes = await wav16(syntheticTake().pcm);
    const form = new FormData();
    form.append("audio", new Blob([bytes], { type: "audio/wav" }), "toma.wav");
    form.append("meta", JSON.stringify(meta(tema)));
    const res = await app.request(`/composicion/temas/${tema.id}/takes`, { method: "POST", body: form });
    assert.equal(res.status, 200);
    const s = (await res.json()) as ComposeSession;
    assert.equal(s.take?.n, 3);
    await pipeline.whenIdle(s.id);

    const broken = new FormData();
    broken.append("audio", new Blob([bytes], { type: "audio/wav" }), "toma.wav");
    broken.append("meta", "{no es json");
    const bad = await app.request(`/composicion/temas/${tema.id}/takes`, { method: "POST", body: broken });
    assert.equal(bad.status, 400);
    assert.match(((await bad.json()) as { error: string }).error, /JSON/);

    const patch = await app.request(`/composicion/temas/${tema.id}/takes/${s.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ favorite: true }),
    });
    assert.equal(patch.status, 200);
    assert.equal(((await patch.json()) as ComposeSession).take?.favorite, true);
  });

  it("borrar el tema deja las tomas en disco, y un tema nuevo con el mismo título NO las hereda", async () => {
    assert.equal(await store.deleteTema(tema.id), true);
    assert.ok(existsSync(join(take1.mediaDir, "crudos", "toma.wav")));
    assert.ok(await store.readSession(take1.id));
    const again = await temas.createTema({ title: tema.title });
    assert.notEqual(again.id, tema.id);
    assert.equal((await temas.temaDetail(again.id)).candidates.length, 0);
  });
});
