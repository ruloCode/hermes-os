import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import {
  encodeWav16,
  newTema,
  trackPitch,
  type ComposeSession,
  type Passage,
  type PassageAnalysis,
  type PassageCandidate,
} from "@hermes/shared";
import { SR, concat, midiToHz, silence, tone } from "./test-helpers.js";

/**
 * El PIPELINE contra carreras reales con el humano: importar dos archivos de
 * la misma carpeta, mover los bordes de un pasaje mientras corre la melodía,
 * re-detectar pasajes con trabajo humano encima, tomas que no aceptan
 * pasajes y la altura que no congela el event loop. Audio SINTÉTICO (tonos),
 * carpetas temporales fijadas ANTES de importar (env.ts las lee al cargar) y
 * sin nada que salga del equipo: sin Scribe (clave vacía, que dotenv no
 * rellena) y sin separador (python inexistente).
 */

let dir: string;
let root: string;
let store: typeof import("./store.js");
let pipeline: typeof import("./pipeline.js");
let media: typeof import("./media.js");
let app: Hono;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "hermes-composicion-pipeline-"));
  // Importar solo acepta rutas bajo ~ o /Volumes: el "home" de la prueba es la carpeta temporal.
  process.env.HOME = dir;
  process.env.HERMES_COMPOSICION_DIR = join(dir, "estado");
  root = join(dir, "medios", "sesiones");
  process.env.COMPOSICION_MEDIA_ROOT = root;
  process.env.ELEVENLABS_API_KEY = "";
  process.env.COMPOSICION_PYTHON = join(dir, "no-existe", "python");
  await mkdir(root, { recursive: true });
  store = await import("./store.js");
  pipeline = await import("./pipeline.js");
  media = await import("./media.js");
  if (!media.mediaRoot().root.startsWith(dir)) throw new Error(`la raíz de medios se salió: ${media.mediaRoot().root}`);
  const { mountComposicionRoutes } = await import("./routes.js");
  app = new Hono();
  mountComposicionRoutes(app);
});

after(async () => {
  for (const s of await store.listSessions()) await pipeline.whenIdle(s.id);
  await rm(dir, { recursive: true, force: true });
});

const HARM = [1, 0.5, 0.25];

/** Tonos de 0,6 s separados por silencios: algo con altura en cada tramo. */
function melody(sec: number): Float32Array {
  const parts: Float32Array[] = [];
  const scale = [57, 60, 62, 64, 67, 69];
  for (let t = 0, k = 0; t < sec; t += 0.8, k++) {
    parts.push(tone(midiToHz(scale[k % scale.length]), 0.6, { harmonics: HARM, amp: 0.4 }), silence(0.2));
  }
  return concat(...parts).subarray(0, Math.round(sec * SR));
}

async function writeWav(path: string, pcm: Float32Array): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, encodeWav16(pcm, SR));
}

function passage(n: number, start: number, end: number, over: Partial<Passage> = {}): Passage {
  const id = `P${String(n).padStart(2, "0")}`;
  return {
    id,
    label: id,
    start,
    end,
    text: "",
    kind: "mixto",
    confidence: 0.6,
    group: "probable",
    evidence: [],
    origin: "auto",
    status: "pendiente",
    ...over,
  };
}

function sessionRecord(id: string, over: Partial<ComposeSession> = {}): ComposeSession {
  const now = new Date().toISOString();
  return {
    id,
    title: id,
    createdAt: now,
    updatedAt: now,
    source: { path: join(dir, "fuente.wav"), name: "fuente.wav", bytes: 1, kind: "archivo" },
    mediaDir: join(root, id),
    mediaRoot: "disco",
    files: {},
    language: "es",
    status: "lista",
    stages: store.freshStages().map((st) => ({ ...st, status: "listo" as const })),
    speakers: [],
    passages: [],
    ...over,
  };
}

const cand = (start: number, end: number): PassageCandidate => ({
  start,
  end,
  text: "na na na",
  score: 0.8,
  evidence: ["relleno na ×3"],
  kind: "silabas",
});

async function waitFor(cond: () => Promise<boolean>, what: string, ms = 20_000): Promise<void> {
  const t0 = Date.now();
  while (!(await cond())) {
    if (Date.now() - t0 > ms) throw new Error(`timeout esperando ${what}`);
    await new Promise((r) => setTimeout(r, 2));
  }
}

// ─────────────────────────── ALTO 1: dos sesiones, una carpeta ───────────────────────────

describe("importar: una carpeta de sesión nunca la comparten dos sesiones", () => {
  it("el 2º archivo de <raíz>/<carpeta-de-A>/crudos/ se COPIA a una carpeta propia; A queda intacta", async () => {
    const crudos = join(root, "ensayo", "crudos");
    await writeWav(join(crudos, "clip1.wav"), melody(2));
    await writeWav(join(crudos, "clip2.wav"), melody(3.2));

    const a = await pipeline.createSessionFromPath({ path: join(crudos, "clip1.wav") });
    const b = await pipeline.createSessionFromPath({ path: join(crudos, "clip2.wav") });
    assert.equal(a.id, "ensayo", "el primero adopta la carpeta (su nombre es el id)");
    assert.equal(a.files.original, join("crudos", "clip1.wav"));
    assert.notEqual(b.mediaDir, a.mediaDir, "B no puede vivir en la carpeta de A");
    assert.deepEqual(b.files, {}, "B no adopta: la etapa copiar lo trae verificado");

    await pipeline.whenIdle(a.id);
    await pipeline.whenIdle(b.id);
    const [sa, sb] = [await store.readSession(a.id), await store.readSession(b.id)];
    assert.equal(sb?.stages.find((st) => st.stage === "copiar")?.status, "listo");
    assert.ok(sb?.source.md5, "copia con md5 verificado");
    assert.ok(existsSync(join(sb!.mediaDir, "crudos", "clip2.wav")));
    // El session.wav de cada una mide SU archivo (antes B pisaba el de A).
    const durA = (await media.probeMedia(join(sa!.mediaDir, sa!.files.audio!))).durationSec!;
    const durB = (await media.probeMedia(join(sb!.mediaDir, sb!.files.audio!))).durationSec!;
    assert.ok(Math.abs(durA - 2) < 0.05, `A mide ${durA}`);
    assert.ok(Math.abs(durB - 3.2) < 0.05, `B mide ${durB}`);
  });

  it("el MISMO archivo por otra ruta (symlink) es la misma sesión, no una nueva", async () => {
    await mkdir(join(dir, "atajos"), { recursive: true });
    const link = join(dir, "atajos", "clip1.wav");
    await symlink(join(root, "ensayo", "crudos", "clip1.wav"), link);
    const again = await pipeline.createSessionFromPath({ path: link });
    assert.equal(again.id, "ensayo");
  });

  it("dos importaciones A LA VEZ de la misma carpeta tampoco la comparten", async () => {
    const crudos = join(root, "a-la-vez", "crudos");
    await writeWav(join(crudos, "uno.wav"), melody(1.6));
    await writeWav(join(crudos, "dos.wav"), melody(1.6));
    const [x, y] = await Promise.all([
      pipeline.createSessionFromPath({ path: join(crudos, "uno.wav") }),
      pipeline.createSessionFromPath({ path: join(crudos, "dos.wav") }),
    ]);
    assert.notEqual(x.mediaDir, y.mediaDir);
    assert.equal([x, y].filter((s) => s.id === "a-la-vez").length, 1, "solo una adopta la carpeta");
  });
});

// ─────────────────────────── ALTO 2: bordes movidos mientras corre la melodía ───────────────────────────

describe("melodía: mover los bordes de un pasaje a mitad de la etapa", () => {
  it("el análisis final es del tramo VIGENTE (corte, f0 y span), no del de la foto de la etapa", async () => {
    const id = "s-bordes";
    const mediaDir = join(root, id);
    await writeWav(join(mediaDir, "assets", "session.wav"), melody(40));
    await media.ensureSessionFolder(mediaDir);
    const passages = Array.from({ length: 6 }, (_, k) => passage(k + 1, 2 + k * 6, 7 + k * 6, { origin: "manual" }));
    await store.createSessionRecord(
      sessionRecord(id, { files: { audio: join("assets", "session.wav") }, durationSec: 40, passages }),
    );

    const r = await pipeline.processSession(id, "melodia");
    assert.deepEqual(r, { ok: true });
    // P01: la etapa YA lo cortó (leyó su tramo viejo) → se mueve. P06: todavía no llega.
    await waitFor(async () => existsSync(join(mediaDir, "analisis", "P01", "corte.json")), "el corte de P01");
    await pipeline.patchPassage(id, "P01", { start: 2.5, end: 8.2 });
    await pipeline.patchPassage(id, "P06", { start: 33, end: 38.4 });
    await pipeline.whenIdle(id);

    const fin = (await store.readSession(id))!;
    assert.equal(fin.stages.find((st) => st.stage === "melodia")?.status, "listo");
    assert.ok(!fin.passages.some((p) => p.status === "analizando"), "nada queda colgado en 'analizando'");
    for (const [pid, start, end] of [["P01", 2.5, 8.2], ["P06", 33, 38.4]] as const) {
      const p = fin.passages.find((q) => q.id === pid)!;
      assert.equal(p.status, "listo", `${pid} analizado`);
      const a = (await store.readAnalysis(id, pid)) as PassageAnalysis;
      assert.deepEqual(a.span, { start, end }, `${pid}: el análisis dice qué tramo midió`);
      const corte = JSON.parse(await readFile(join(mediaDir, "analisis", pid, "corte.json"), "utf8"));
      assert.deepEqual([corte.start, corte.end], [start, end], `${pid}: el corte es el tramo nuevo`);
      assert.ok(Math.abs(a.f0.length * a.hop - (end - start)) < 0.05, `${pid}: la curva mide ${a.f0.length * a.hop} s`);
    }
  });
});

// ─────────────────────────── MEDIO 3: re-detectar sin tirar trabajo ───────────────────────────

describe("re-detectar pasajes: ids que no se reusan y trabajo humano que no se tira", () => {
  it("conserva manuales, editados y referenciados; el mismo tramo conserva su id; lo nuevo nunca hereda un id viejo", async () => {
    const id = "s-redetectar";
    await store.createSessionRecord(
      sessionRecord(id, {
        passages: [
          passage(1, 1, 5),
          passage(2, 10, 14), // melodía de una sección del tablero
          passage(3, 20, 24, { edited: true, group: "dudoso" }),
          passage(4, 30, 34, { origin: "manual" }),
          passage(5, 40, 44), // tiene "Tu versión"
          passage(6, 50, 54), // nada: se reemplaza
          passage(7, 60, 64), // origen de un tema
          passage(8, 70, 74), // la detección nueva vuelve a encontrar ESTE tramo
        ],
      }),
    );
    await store.writeAnalysis({ sessionId: id, passageId: "P06" } as PassageAnalysis);
    await store.updateBoard((b) => {
      b.songs.push({
        id: "song-1",
        title: "Prueba",
        stage: "letra",
        key: { tonic: 9, mode: "minor" },
        tempo: 90,
        meter: "4/4",
        mood: [],
        seed: "",
        sections: [{ id: "sec", kind: "coro", label: "Coro", lyrics: "", chords: [], bars: 8, memo: { sessionId: id, passageId: "P02", semitones: 0 } }],
        refIds: [],
        versions: [],
        createdAt: "",
        updatedAt: "",
      });
    });
    await store.patchLyrics(id, "P05", (b) => void b.mine.push({ phrase: 1, text: "la marea sube" }));
    await store.createTemaRecord(
      newTema({ id: "t-origen", title: "Origen", now: new Date().toISOString(), origin: { sessionId: id, passageId: "P07" } }),
    );

    // La etapa leyó su foto ANTES de que el humano trabajara.
    const snapshot = (await store.readSession(id))!;
    await pipeline.patchPassage(id, "P01", { label: "Verso bueno" });
    await store.patchSession(id, (x) => void x.passages.push(passage(9, 90, 94, { origin: "manual" })));

    const merged = await pipeline.mergePassages(snapshot, [cand(10.5, 13.5), cand(70, 74), cand(100, 104)], false, new Set());
    const ids = merged.map((p) => p.id);
    for (const keep of ["P01", "P02", "P03", "P04", "P05", "P07", "P09"]) assert.ok(ids.includes(keep), `se conserva ${keep}`);
    assert.equal(merged.find((p) => p.id === "P01")?.label, "Verso bueno", "la edición hecha durante la etapa no se pierde");
    assert.ok(!ids.includes("P06"), "lo que no tiene trabajo se reemplaza");
    assert.equal(await store.readAnalysis(id, "P06"), null, "y su análisis se limpia");
    assert.deepEqual(
      merged.filter((p) => p.start === 70).map((p) => p.id),
      ["P08"],
      "el mismo tramo es el mismo pasaje",
    );
    assert.equal(merged.find((p) => p.start === 100)?.id, "P10", "nuevo = después del más alto (P06 queda quemado)");
    assert.equal(merged.filter((p) => p.start >= 10 && p.start < 14).length, 1, "lo que pisa un conservado no se duplica");

    // Segunda re-detección: P10 (sin trabajo) se va y lo nuevo sigue sin reusar nada.
    const again = await pipeline.mergePassages((await store.readSession(id))!, [cand(120, 124)], false, new Set());
    assert.equal(again.find((p) => p.start === 120)?.id, "P11");
    assert.ok(!again.some((p) => p.id === "P06" || p.id === "P10"));
    assert.equal((await store.readSession(id))?.passageSeq, 11);
    // Un pasaje manual nuevo tampoco reusa un número quemado.
    await store.patchSession(id, (x) => void (x.durationSec = 200));
    const manual = await pipeline.addManualPassage(id, { start: 150, end: 152 });
    assert.equal(manual.id, "P12");
    await pipeline.whenIdle(id);
  });

  it("editar marca el pasaje como `edited`; sin cambios reales no", async () => {
    const id = "s-editar";
    await store.createSessionRecord(sessionRecord(id, { durationSec: 60, passages: [passage(1, 1, 5), passage(2, 10, 14)] }));
    await pipeline.patchPassage(id, "P01", { group: "dudoso" });
    await pipeline.patchPassage(id, "P02", { label: "P02", group: "probable" });
    const s = (await store.readSession(id))!;
    assert.equal(s.passages.find((p) => p.id === "P01")?.edited, true);
    assert.equal(s.passages.find((p) => p.id === "P02")?.edited, undefined);
  });
});

// ─────────────────────────── BAJO 12: una toma tiene un solo pasaje ───────────────────────────

describe("tomas: agregar o editar pasajes → 409", () => {
  it("POST y PATCH de pasajes sobre una toma responden 409 con el motivo", async () => {
    const id = "s-toma";
    await store.createSessionRecord(
      sessionRecord(id, {
        durationSec: 8,
        passages: [passage(1, 0, 8, { origin: "manual" })],
        take: {
          temaId: "t-x",
          sectionId: "coro-1",
          n: 1,
          grid: { bpm: 90, meter: "4/4", key: { tonic: 9, mode: "minor" }, downbeatSec: 0.5, loop: [{ chords: [{ symbol: "Am", beat: 0 }] }], bars: 2 },
          latency: { ms: 0, source: "medida" },
          monitor: "audifonos",
          stt: false,
        },
      }),
    );
    const add = await app.request(`/composicion/sessions/${id}/passages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ start: 1, end: 3 }),
    });
    assert.equal(add.status, 409);
    assert.deepEqual(await add.json(), { error: pipeline.TAKE_ONE_PASSAGE });
    const edit = await app.request(`/composicion/sessions/${id}/passages/P01`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ start: 1 }),
    });
    assert.equal(edit.status, 409);
    const s = (await store.readSession(id))!;
    assert.equal(s.passages.length, 1);
    assert.deepEqual([s.passages[0].start, s.passages[0].end], [0, 8], "el tramo de la toma no se movió");
  });
});

// ─────────────────────────── MEDIO 6: la altura no congela el agente ───────────────────────────

describe("trackPitchAsync", () => {
  const pcm = concat(
    tone((t) => midiToHz(60 + 0.3 * Math.sin(2 * Math.PI * 5 * t)), 1.1, { harmonics: HARM }),
    silence(0.3),
    tone(midiToHz(67), 0.9, { harmonics: HARM }),
    tone(midiToHz(64), 0.7, { harmonics: HARM, amp: 0.2 }),
  );

  it("da EXACTAMENTE lo mismo que trackPitch, con tramos de cualquier tamaño", async () => {
    const ref = trackPitch(pcm, SR);
    for (const chunkFrames of [1, 37, 500, 1e6]) {
      const got = await pipeline.trackPitchAsync(pcm, SR, { chunkFrames });
      assert.deepEqual([got.sr, got.hop, got.hopSec], [ref.sr, ref.hop, ref.hopSec]);
      assert.deepEqual(Array.from(got.f0), Array.from(ref.f0), `f0 con tramos de ${chunkFrames}`);
      assert.deepEqual(Array.from(got.rmsDb), Array.from(ref.rmsDb));
      assert.deepEqual(Array.from(got.midi).map(String), Array.from(ref.midi).map(String));
    }
  });

  it("cede el event loop entre tramos y respeta Detener", async () => {
    let ticks = 0;
    let alive = true;
    const beat = () => {
      if (!alive) return;
      ticks++;
      setImmediate(beat);
    };
    setImmediate(beat);
    await pipeline.trackPitchAsync(pcm, SR, { chunkFrames: 20 });
    alive = false;
    const frames = Math.floor(pcm.length / 160) + 1;
    assert.ok(ticks >= Math.floor(frames / 20) - 1, `el loop corrió ${ticks} veces en ${Math.ceil(frames / 20)} tramos`);

    const ctl = new AbortController();
    const running = pipeline.trackPitchAsync(pcm, SR, { chunkFrames: 20, signal: ctl.signal });
    ctl.abort();
    await assert.rejects(running, media.AbortedError);
  });
});
