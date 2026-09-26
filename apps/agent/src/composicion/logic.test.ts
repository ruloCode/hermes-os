import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LineFit, Passage, TranscriptWord } from "@hermes/shared";

/**
 * Lógica del agente de Composición que no depende del audio ni del modelo:
 * normalizar Scribe, líneas de transcripción, voces, validación de lo
 * LITERAL del resumen, ids de pasajes, medianas y overrides del molde.
 * Palabras inventadas: nada de la sesión real entra a un test.
 */

let dir: string;
let transcribe: typeof import("./transcribe.js");
let summary: typeof import("./summary.js");
let pipeline: typeof import("./pipeline.js");
let lyrics: typeof import("./lyrics.js");

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "hermes-composicion-logic-"));
  process.env.HERMES_COMPOSICION_DIR = join(dir, "estado");
  process.env.COMPOSICION_MEDIA_ROOT = join(dir, "medios");
  transcribe = await import("./transcribe.js");
  summary = await import("./summary.js");
  pipeline = await import("./pipeline.js");
  lyrics = await import("./lyrics.js");
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

const w = (text: string, start: number, end: number, speaker = "speaker_0", type: TranscriptWord["type"] = "word"): TranscriptWord => ({
  text,
  start,
  end,
  speaker,
  type,
});

describe("transcripción", () => {
  it("normaliza Scribe: fuera los spacing, texto recortado, ordenado", () => {
    const out = transcribe.normalizeWords([
      { text: "mivena", start: 2, end: 2.4, type: "word", speaker_id: "speaker_1" },
      { text: " ", start: 1.5, end: 2, type: "spacing" },
      { text: " tralo ", start: 1, end: 1.5, type: "word", speaker_id: "speaker_0" },
      { text: "[canta]", start: 3, end: 6, type: "audio_event" },
    ]);
    assert.deepEqual(
      out.map((x) => [x.text, x.type]),
      [
        ["tralo", "word"],
        ["mivena", "word"],
        ["[canta]", "audio_event"],
      ],
    );
  });

  it("líneas: cortan por voz, por silencio largo y conservan los eventos", () => {
    const lines = transcribe.transcriptLines([
      w("sonda", 0, 0.3),
      w("velina", 0.4, 0.8),
      w("[canta]", 0.9, 1.2, "speaker_0", "audio_event"),
      w("trupo", 4, 4.3), // silencio > 1,2 s → línea nueva
      w("mafe", 4.4, 4.7, "speaker_1"), // otra voz
    ]);
    assert.deepEqual(
      lines.map((l) => l.text),
      ["sonda velina [canta]", "trupo", "mafe"],
    );
    assert.equal(lines[2].speaker, "speaker_1");
  });

  it("voces: segundos por turnos y nombres del humano conservados", () => {
    const sp = transcribe.computeSpeakers(
      [w("a", 0, 1), w("b", 1.2, 2), w("c", 5, 6, "speaker_1"), w("d", 10, 11)],
      [{ id: "speaker_1", name: "Productor", seconds: 0, singingSeconds: 4 }],
    );
    assert.deepEqual(sp.map((s) => [s.id, s.name]), [
      ["speaker_0", "Voz 1"],
      ["speaker_1", "Productor"],
    ]);
    assert.equal(sp[0].seconds, 3); // 0–2 + 10–11
    assert.equal(sp[1].singingSeconds, 4);
  });

  it("clock", () => {
    assert.equal(transcribe.clock(0), "0:00");
    assert.equal(transcribe.clock(125.4), "2:05");
  });
});

describe("resumen: lo literal se verifica contra la transcripción", () => {
  const words = [
    w("hablan", 1, 1.3),
    w("de", 1.4, 1.5),
    w("otra", 1.6, 1.9),
    w("cosa", 2, 2.3),
    w("Tralo", 60, 60.4),
    w("la", 60.5, 60.6),
    w("mivena,", 60.7, 61.2),
    w("sonda", 61.3, 61.8),
  ];

  it("acepta la línea literal (sin importar mayúsculas ni comas) y ajusta el momento", () => {
    assert.deepEqual(summary.verifyLiteral("tralo la mivena sonda", 58, words), { at: 60 });
  });

  it("encuentra la línea aunque el momento venga corrido", () => {
    assert.deepEqual(summary.verifyLiteral("Tralo la mivena", 300, words), { at: 60 });
  });

  it("descarta lo inventado", () => {
    assert.equal(summary.verifyLiteral("la luna de papel", 60, words), null);
  });

  it("finalizeSummary: solo quedan líneas reales, deduplicadas y en orden", () => {
    const s = summary.finalizeSummary(
      {
        theme: "  un tema  ",
        lines: [
          { text: "tralo la mivena sonda", at: 60, section: "Coro" },
          { text: "TRALO LA MIVENA SONDA", at: 61 },
          { text: "verso inventado por el modelo", at: 10 },
          { text: "hablan de otra cosa", at: 1 },
        ],
        structure: [{ section: "Coro", idea: "que se repita" }, { section: "", idea: "vacía" }],
        decisions: [{ text: "rima ABBA" }, { text: " " }],
        pending: [],
      },
      words,
    );
    assert.deepEqual(
      s.lines.map((l) => l.text),
      ["hablan de otra cosa", "tralo la mivena sonda"],
    );
    assert.equal(s.theme, "un tema");
    assert.equal(s.structure.length, 1);
    assert.deepEqual(s.decisions, [{ text: "rima ABBA" }]);
  });
});

describe("pipeline: piezas puras", () => {
  const p = (id: string): Passage => ({
    id,
    label: id,
    start: 0,
    end: 1,
    text: "",
    kind: "letra",
    confidence: 1,
    group: "probable",
    evidence: [],
    origin: "auto",
    status: "pendiente",
  });

  it("el siguiente id nunca reusa uno vivo", () => {
    assert.equal(pipeline.nextPassageId([]), "P01");
    assert.equal(pipeline.nextPassageId([p("P01"), p("P07"), p("P03")]), "P08");
  });

  it("mediana ponderada (afinación de la sesión)", () => {
    assert.equal(pipeline.weightedMedian([]), null);
    assert.equal(pipeline.weightedMedian([{ v: -19, w: 30 }, { v: -11, w: 5 }, { v: -25, w: 10 }]), -19);
    assert.equal(pipeline.weightedMedian([{ v: 10, w: 0 }, { v: NaN, w: 5 }]), null);
  });

  it("palabras del pasaje en tiempos relativos, recortadas al tramo, sin eventos", () => {
    const out = pipeline.wordsInPassage(
      [w("antes", 8, 9.5), w("dentro", 10.2, 10.8), w("[canta]", 10, 12, "speaker_0", "audio_event"), w("borde", 11.8, 12.6), w("después", 13, 14)],
      { start: 10, end: 12 },
    );
    assert.deepEqual(out.map((x) => [x.text, x.start, x.end]), [
      ["dentro", 0.2, 0.8],
      ["borde", 1.8, 2],
    ]);
  });
});

describe("letras: medida y overrides", () => {
  const fit = (syllables: number, range: [number, number], target: number): LineFit => ({
    syllables,
    range,
    target,
    syllablesOk: target >= range[0] && target <= range[1],
    ending: "llana",
    endingOk: true,
    stressHits: 0,
    stressTotal: 0,
    melismaVowelOk: null,
    score: 0,
  });

  it("la distancia se mide contra el RANGO (con/sin sinalefas)", () => {
    assert.equal(lyrics.syllableGap(fit(9, [8, 10], 8)), 0);
    assert.equal(lyrics.syllableGap(fit(11, [10, 12], 8)), 2);
    assert.equal(lyrics.syllableGap(fit(5, [5, 6], 8)), 2);
  });

  it("override del molde: valida y normaliza; null lo quita", () => {
    assert.deepEqual(lyrics.validateOverride({ syllables: 8, ending: "aguda", rhyme: "a" }), {
      syllables: 8,
      ending: "aguda",
      rhyme: "A",
    });
    assert.equal(lyrics.validateOverride(null), null);
    assert.equal(lyrics.validateOverride({}), null);
    assert.throws(() => lyrics.validateOverride({ syllables: 0 }), /syllables/);
    assert.throws(() => lyrics.validateOverride({ ending: "grave" }), /ending/);
    assert.throws(() => lyrics.validateOverride([1]), /objeto/);
  });
});

describe("canción desde la sesión", () => {
  it("sin líneas repetidas, secciones en orden musical, sueltas al Cuaderno, idempotente", async () => {
    const store = await import("./store.js");
    const now = new Date().toISOString();
    await store.writeBoard({ version: 1, songs: [], refs: [], notebook: [], updatedAt: now });
    await store.createSessionRecord({
      id: "s-cancion",
      title: "Ensayo",
      createdAt: now,
      updatedAt: now,
      source: { path: "/x.wav", name: "x.wav", bytes: 1, kind: "archivo" },
      mediaDir: join(dir, "medios", "s-cancion"),
      mediaRoot: "disco",
      files: {},
      language: "es",
      status: "lista",
      stages: store.freshStages(),
      speakers: [],
      passages: [],
      key: {
        best: { key: { tonic: 9, mode: "minor" }, score: 0.6 },
        candidates: [{ key: { tonic: 9, mode: "minor" }, score: 0.6 }],
        confidence: 0.6,
        source: "instrumento",
      },
      summary: {
        theme: "Un tema inventado",
        generatedAt: now,
        structure: [
          { section: "coro", idea: "corto y pegajoso" },
          { section: "intro", idea: "cuatro líneas cerradas" },
          { section: "coro", idea: "pregunta y respuesta" },
        ],
        decisions: [],
        pending: [],
        lines: [
          { text: "Tralo mivena sube", at: 1, section: "intro" },
          { text: "tralo mivena, sube…", at: 5, section: "intro" },
          { text: "Pelo de canela", at: 9, section: "coro" },
          { text: "Una línea sin lugar", at: 12 },
          { text: "Una línea sin lugar", at: 30 },
        ],
      },
    });
    const song = await lyrics.createSongFromSession("s-cancion");
    assert.deepEqual(
      song.sections.map((s) => s.label),
      ["Intro", "Coro"],
      "una sección por tipo, en orden musical",
    );
    assert.equal(song.sections[0].lyrics, "Tralo mivena sube", "la frase iterada entra una vez");
    assert.match(song.sections[1].intent ?? "", /corto y pegajoso · pregunta y respuesta/);
    assert.deepEqual(song.key, { tonic: 9, mode: "minor" });
    const board = await store.readBoard();
    const loose = board!.notebook.filter((n) => n.songId === song.id);
    assert.deepEqual(
      loose.map((n) => n.text),
      ["Una línea sin lugar"],
      "la suelta va al Cuaderno, una vez",
    );
    const again = await lyrics.createSongFromSession("s-cancion");
    assert.equal(again.id, song.id, "idempotente");
    assert.equal((await store.readBoard())!.songs.length, 1);
  });
});
