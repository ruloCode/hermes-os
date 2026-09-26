import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ComposicionValidationError,
  acousticSeconds,
  anchorSyllables,
  buildPhrases,
  classifyPassage,
  detectPassages,
  downsampleF0,
  estimateKey,
  estimateTuningCents,
  fillerFlags,
  isAtonic,
  isFiller,
  lineFit,
  outOfKey,
  peaksOf,
  phraseMold,
  pitchClassProfile,
  segmentNotes,
  semitonesToKey,
  sessionSlug,
  splitSyllables,
  stressedSyllable,
  trackPitch,
  transposeNotes,
  validateBoard,
  type Phrase,
  type PhraseMold,
  type TranscriptWord,
} from "@hermes/shared";
import { SR, concat, midiToHz, note, silence, speech, syl, tone, words } from "./test-helpers.js";

/**
 * Melodía del Playground de composición: contratos de comportamiento sobre
 * datos SINTÉTICOS (senos, palabras inventadas). Lo que se prueba es lo que el
 * molde necesita que sea verdad: una nota sostenida es UNA nota a la altura
 * correcta, el vibrato no la parte, un melisma se detecta y se cuenta como una
 * sílaba (o como varias al silabizar), y una línea de letra se mide contra el
 * molde con sílabas cantadas, final y vocal abierta.
 */

const voicedMedian = (midi: Float32Array): number => {
  const v = Array.from(midi).filter(Number.isFinite).sort((a, b) => a - b);
  return v[v.length >> 1];
};

describe("trackPitch", () => {
  it("un seno de 440 Hz da MIDI 69 ± 0,1 con voz en casi todos los cuadros", () => {
    const tr = trackPitch(tone(440, 1), SR);
    assert.equal(tr.hop, 160);
    assert.equal(tr.hopSec, 0.01);
    assert.ok(Math.abs(voicedMedian(tr.midi) - 69) < 0.1);
    const voiced = Array.from(tr.f0).filter((f) => f > 0).length;
    assert.ok(voiced / tr.f0.length > 0.9);
  });

  it("no comete error de octava con un tono rico en armónicos (voz grave)", () => {
    const tr = trackPitch(tone(220, 1, { harmonics: [1, 0.8, 0.6, 0.4, 0.3, 0.2] }), SR);
    assert.ok(Math.abs(voicedMedian(tr.midi) - 57) < 0.1);
  });

  it("el silencio queda sin voz (f0 = 0, midi NaN) y la energía cae", () => {
    const tr = trackPitch(concat(tone(440, 0.3), silence(0.4), tone(440, 0.3)), SR);
    const mid = Math.round(0.5 / tr.hopSec);
    assert.equal(tr.f0[mid], 0);
    assert.ok(Number.isNaN(tr.midi[mid]));
    assert.ok(tr.rmsDb[mid] < -40);
    assert.ok(tr.rmsDb[Math.round(0.15 / tr.hopSec)] > -6);
  });
});

describe("estimateTuningCents", () => {
  it("detecta una afinación de −19 c (La ≈ 434 Hz)", () => {
    const tr = trackPitch(tone(440 * 2 ** (-19 / 1200), 1), SR);
    assert.ok(Math.abs(estimateTuningCents(tr) - -19) <= 2);
  });

  it("es circular: +45 c y −45 c no promedian a 0 sino a ±50", () => {
    const tr = trackPitch(concat(tone(440 * 2 ** (45 / 1200), 0.5), tone(440 * 2 ** (-45 / 1200), 0.5)), SR);
    assert.ok(Math.abs(estimateTuningCents(tr)) >= 45);
  });
});

describe("segmentNotes", () => {
  it("dos notas seguidas (La4 → Do5) son dos notas con sus tiempos", () => {
    const tr = trackPitch(concat(tone(midiToHz(69), 0.5), tone(midiToHz(72), 0.5)), SR);
    const notes = segmentNotes(tr, { tuningCents: 0 });
    assert.deepEqual(
      notes.map((n) => n.midi),
      [69, 72],
    );
    assert.ok(Math.abs(notes[0].start) < 0.03);
    assert.ok(Math.abs(notes[1].start - 0.5) < 0.05);
    assert.ok(Math.abs(notes[1].end - 1) < 0.05);
  });

  it("el vibrato de ±0,3 st no parte la nota", () => {
    const vib = tone((t) => 440 * 2 ** ((0.3 * Math.sin(2 * Math.PI * 5.5 * t)) / 12), 1.5);
    const notes = segmentNotes(trackPitch(vib, SR), { tuningCents: 0 });
    assert.equal(notes.length, 1);
    assert.equal(notes[0].midi, 69);
  });

  it("un silencio entre dos notas iguales las separa", () => {
    const tr = trackPitch(concat(tone(440, 0.3), silence(0.3), tone(440, 0.3)), SR);
    const notes = segmentNotes(tr, { tuningCents: 0 });
    assert.equal(notes.length, 2);
    assert.ok(notes[1].start - notes[0].end > 0.2);
  });

  it("compensa la afinación de la sesión antes de redondear", () => {
    const tr = trackPitch(tone(440 * 2 ** (-40 / 1200), 1), SR);
    // Sin compensar, −40 c redondea a La igual, pero el desvío queda a la vista.
    assert.equal(segmentNotes(tr, { tuningCents: 0 })[0].cents <= -35, true);
    // Con la afinación medida, la nota queda centrada.
    const [n] = segmentNotes(tr, { tuningCents: -40 });
    assert.equal(n.midi, 69);
    assert.ok(Math.abs(n.cents) <= 5);
  });

  it("toma las notas graves reales sin plegar la octava (Si2)", () => {
    const tr = trackPitch(tone(midiToHz(47), 1, { harmonics: [1, 0.7, 0.5] }), SR);
    assert.deepEqual(
      segmentNotes(tr, { tuningCents: 0 }).map((n) => n.midi),
      [47],
    );
  });
});

describe("splitSyllables", () => {
  const cases: [string, string][] = [
    // hiatos
    ["país", "pa-ís"],
    ["poeta", "po-e-ta"],
    ["leer", "le-er"],
    ["río", "rí-o"],
    ["aéreo", "a-é-re-o"],
    ["baúl", "ba-úl"],
    ["oído", "o-í-do"],
    ["caos", "ca-os"],
    ["héroe", "hé-ro-e"],
    ["maíz", "ma-íz"],
    // diptongos
    ["cielo", "cie-lo"],
    ["ciudad", "ciu-dad"],
    ["cuidado", "cui-da-do"],
    ["huevo", "hue-vo"],
    ["causa", "cau-sa"],
    ["peine", "pei-ne"],
    ["canción", "can-ción"],
    ["agua", "a-gua"],
    ["fuimos", "fui-mos"],
    // triptongos
    ["buey", "buey"],
    ["paraguay", "pa-ra-guay"],
    ["limpiáis", "lim-piáis"],
    ["averiguáis", "a-ve-ri-guáis"],
    ["miau", "miau"],
    // grupos inseparables y consonantes trabadas
    ["pregunta", "pre-gun-ta"],
    ["hablar", "ha-blar"],
    ["otro", "o-tro"],
    ["madre", "ma-dre"],
    ["iglesia", "i-gle-sia"],
    ["ofrecer", "o-fre-cer"],
    ["siempre", "siem-pre"],
    ["cristal", "cris-tal"],
    ["explicar", "ex-pli-car"],
    ["instrumento", "ins-tru-men-to"],
    ["construir", "cons-truir"],
    ["abstracto", "abs-trac-to"],
    ["transporte", "trans-por-te"],
    ["acción", "ac-ción"],
    // qu / gu / gü
    ["queso", "que-so"],
    ["guitarra", "gui-ta-rra"],
    ["aquí", "a-quí"],
    ["guerra", "gue-rra"],
    ["seguir", "se-guir"],
    ["pingüino", "pin-güi-no"],
    ["quizás", "qui-zás"],
    // y final (vocal) y y consonante
    ["hoy", "hoy"],
    ["muy", "muy"],
    ["estoy", "es-toy"],
    ["ayer", "a-yer"],
    ["reyes", "re-yes"],
    ["mayo", "ma-yo"],
    ["y", "y"],
    // rr / ll / ch y h intercalada
    ["perro", "pe-rro"],
    ["calle", "ca-lle"],
    ["noche", "no-che"],
    ["llorar", "llo-rar"],
    ["muchacho", "mu-cha-cho"],
    ["carretera", "ca-rre-te-ra"],
    ["lluvia", "llu-via"],
    ["ahora", "a-ho-ra"],
    ["prohibir", "pro-hi-bir"],
    // varias
    ["episodio", "e-pi-so-dio"],
    ["murciélago", "mur-cié-la-go"],
    ["corazón", "co-ra-zón"],
  ];
  for (const [w, expected] of cases) {
    it(`${w} → ${expected}`, () => assert.equal(splitSyllables(w).join("-"), expected));
  }

  it("ignora mayúsculas y puntuación de la transcripción", () => {
    assert.deepEqual(splitSyllables("¿Canción,"), ["can", "ción"]);
    assert.deepEqual(splitSyllables("123"), []);
  });
});

describe("stressedSyllable", () => {
  const cases: [string, number][] = [
    // agudas con tilde
    ["canción", 1],
    ["café", 1],
    ["está", 1],
    ["corazón", 2],
    // agudas sin tilde (terminan en consonante que no es n/s, o en y)
    ["amor", 1],
    ["verdad", 1],
    ["feliz", 1],
    ["cantar", 1],
    ["estoy", 1],
    // llanas terminadas en vocal, n o s
    ["casa", 0],
    ["cantan", 0],
    ["lunes", 0],
    ["episodio", 2],
    ["pregunta", 1],
    // llanas con tilde
    ["árbol", 0],
    ["fácil", 0],
    ["lápiz", 0],
    // esdrújulas
    ["música", 0],
    ["pájaro", 0],
    ["lágrima", 0],
    ["murciélago", 1],
    // hiatos con tilde y monosílabos
    ["país", 1],
    ["río", 0],
    ["sol", 0],
  ];
  for (const [w, k] of cases) it(`${w} → sílaba ${k}`, () => assert.equal(stressedSyllable(w), k));

  it("las átonas no llevan acento de frase; sus homógrafas con tilde sí", () => {
    for (const w of ["la", "de", "que", "me", "tu", "mi", "y", "para"]) assert.equal(isAtonic(w), true, w);
    for (const w of ["tú", "mí", "qué", "no", "sol", "ti"]) assert.equal(isAtonic(w), false, w);
  });
});

describe("rellenos", () => {
  it("los vocablos que nunca son palabras son relleno sin contexto", () => {
    for (const w of ["na", "Nana", "dun,", "uh", "Oh.", "mmm", "yeah", "ey", "tin", "lalala", "tururú"])
      assert.equal(isFiller(w), true, w);
    for (const w of ["casa", "la", "ti", "amor", "ay"]) assert.equal(isFiller(w), false, w);
  });

  it("'la' y 'ti' son relleno solo repetidos o junto a otro relleno", () => {
    const f = (t: string) => fillerFlags(t.split(" ").map((text) => ({ text })));
    assert.deepEqual(f("la la la"), [true, true, true]);
    assert.deepEqual(f("canta la vida"), [false, false, false]);
    assert.deepEqual(f("na la na"), [true, true, true]);
    assert.deepEqual(f("a ti te"), [false, false, false]);
  });

  it("dos 'la' separados por un silencio largo no se contagian", () => {
    const flags = fillerFlags([
      { text: "la", start: 0, end: 0.2 },
      { text: "la", start: 5, end: 5.2 },
    ]);
    assert.deepEqual(flags, [false, false]);
  });
});

// Escenario sintético: "te quiero sol" con un melisma de tres notas en "sol"
// cuya última nota es larga.
const melismaWords = words([
  ["te", 0, 0.25],
  ["quiero", 0.3, 0.9],
  ["sol", 1.0, 2.4],
]);
const melismaNotes = [
  note(60, 0, 0.25),
  note(62, 0.3, 0.6),
  note(64, 0.6, 0.9),
  note(65, 1.0, 1.3),
  note(67, 1.3, 1.6),
  note(65, 1.6, 2.4),
];

describe("anchorSyllables", () => {
  it("ancla cada sílaba a su nota y detecta el melisma", () => {
    const s = anchorSyllables(melismaWords, melismaNotes);
    assert.deepEqual(
      s.map((x) => x.text),
      ["te", "quie", "ro", "sol"],
    );
    assert.deepEqual(
      s.map((x) => x.melisma),
      [false, false, false, true],
    );
    assert.deepEqual(s[3].noteIdx, [3, 4, 5]);
    assert.equal(s[3].parts?.length, 3);
    // La altura dominante es la nota que más tiempo ocupa dentro de la sílaba.
    assert.equal(s[3].midi, 65);
    // Legato: "te" dura hasta que empieza "quie".
    assert.equal(s[0].end, 0.3);
    // Tónicas: "quie" y "sol"; "te" es átona.
    assert.deepEqual(
      s.map((x) => x.stressed),
      [false, true, false, true],
    );
  });

  it("la cola de una nota que se asoma a la sílaba vecina no inventa un melisma", () => {
    const s = anchorSyllables(
      words([
        ["mar", 0, 0.5],
        ["azul", 0.5, 1.2],
      ]),
      // La nota de "mar" se estira 90 ms dentro de "a".
      [note(60, 0, 0.59), note(64, 0.59, 0.85), note(62, 0.85, 1.2)],
    );
    assert.equal(s[0].text, "mar");
    assert.equal(s[0].melisma, false);
    assert.deepEqual(s[0].noteIdx, [0]);
  });

  it("dos notas de la MISMA altura sobre una sílaba no son melisma", () => {
    const s = anchorSyllables(words([["sol", 0, 1]]), [note(60, 0, 0.5), note(60, 0.5, 1)]);
    assert.equal(s[0].noteIdx.length, 2);
    assert.equal(s[0].melisma, false);
  });

  it("recorta una palabra que la transcripción estiró sobre la guitarra", () => {
    const s = anchorSyllables(words([["mar", 10, 25]]), [note(60, 24.5, 25)]);
    assert.ok(s[0].start >= 23);
    assert.deepEqual(s[0].noteIdx, [0]);
  });

  it("acentos musicales en los rellenos: el primero, las notas largas y los picos", () => {
    const flat = anchorSyllables(
      words([
        ["na", 0, 0.28],
        ["na", 0.3, 0.58],
        ["na", 0.6, 0.88],
        ["na", 0.9, 1.18],
      ]),
      [note(60, 0, 0.28), note(60, 0.3, 0.58), note(60, 0.6, 0.88), note(60, 0.9, 1.18)],
    );
    assert.deepEqual(
      flat.map((x) => x.stressed),
      [true, false, false, false],
    );
    assert.ok(flat.every((x) => x.filler));

    const long = anchorSyllables(
      words([
        ["na", 0, 0.28],
        ["na", 0.3, 0.58],
        ["na", 0.6, 1.5],
      ]),
      [note(60, 0, 0.28), note(60, 0.3, 0.58), note(60, 0.6, 1.5)],
    );
    assert.deepEqual(
      long.map((x) => x.stressed),
      [true, false, true],
    );

    const peak = anchorSyllables(
      words([
        ["dun", 0, 0.28],
        ["dun", 0.3, 0.58],
        ["dun", 0.6, 0.88],
        ["dun", 0.9, 1.18],
      ]),
      [note(60, 0, 0.28), note(60, 0.3, 0.58), note(64, 0.6, 0.88), note(60, 0.9, 1.18)],
    );
    assert.deepEqual(
      peak.map((x) => x.stressed),
      [true, false, true, false],
    );
  });

  it("un relleno pegado se parte en sus sílabas", () => {
    const s = anchorSyllables(words([["nanana", 0, 0.9]]), [note(60, 0, 0.3), note(62, 0.3, 0.6), note(64, 0.6, 0.9)]);
    assert.deepEqual(
      s.map((x) => x.text),
      ["na", "na", "na"],
    );
    assert.ok(s.every((x) => !x.melisma));
  });
});

describe("buildPhrases", () => {
  it("corta por silencios, rebasa las palabras a la frase y calcula el molde", () => {
    const w = words([
      ...([
        ["te", 0, 0.25],
        ["quiero", 0.3, 0.9],
        ["sol", 1.0, 2.4],
      ] as [string, number, number][]),
      ["cae", 3.5, 4.0],
      ["la", 4.05, 4.2],
      ["tarde", 4.25, 4.9],
    ]);
    const n = [
      ...melismaNotes,
      note(62, 3.5, 3.75),
      note(62, 3.75, 4.0),
      note(60, 4.05, 4.2),
      note(59, 4.25, 4.55),
      note(57, 4.55, 4.9),
    ];
    const phrases = buildPhrases(anchorSyllables(w, n), n);
    assert.equal(phrases.length, 2);
    assert.equal(phrases[0].text, "te quiero sol");
    assert.equal(phrases[1].text, "cae la tarde");
    assert.deepEqual(
      phrases[1].syllables.map((s) => s.word),
      [0, 0, 1, 2, 2],
    );
    assert.equal(phrases[1].idx, 1);
    assert.equal(phrases[1].mold.syllables, 5);
    assert.equal(phrases[1].mold.ending, "llana");
  });

  it("separa una corrida de relleno de la letra que la sigue", () => {
    const w = words([
      ["dun", 0, 0.25],
      ["dun", 0.3, 0.55],
      ["mar", 0.6, 1.2],
      ["azul", 1.25, 2],
    ]);
    const n = [note(60, 0, 0.25), note(60, 0.3, 0.55), note(64, 0.6, 1.2), note(62, 1.25, 1.6), note(60, 1.6, 2)];
    const phrases = buildPhrases(anchorSyllables(w, n), n);
    assert.deepEqual(
      phrases.map((p) => p.text),
      ["dun dun", "mar azul"],
    );
  });

  it("corta al cambiar de voz", () => {
    const w = [
      ...words([["mar", 0, 0.5]], "speaker_0"),
      ...words([["sol", 0.55, 1]], "speaker_1"),
    ];
    const n = [note(60, 0, 0.5), note(64, 0.55, 1)];
    assert.equal(buildPhrases(anchorSyllables(w, n), n).length, 2);
  });
});

describe("phraseMold", () => {
  const phrase = (): Phrase => buildPhrases(anchorSyllables(melismaWords, melismaNotes), melismaNotes)[0];

  it('"respetar": el melisma cuenta 1 sílaba y se lista con sus notas y duración', () => {
    const m = phraseMold(phrase(), "respetar");
    assert.equal(m.syllables, 4);
    assert.deepEqual(m.stresses, [2, 4]);
    assert.deepEqual(m.melismas, [{ pos: 4, notes: 3, dur: 1.4 }]);
    assert.deepEqual(m.long, [4]);
    assert.equal(m.ending, "aguda");
  });

  it('"silabizar": cada nota del melisma suma una sílaba y reubica acentos', () => {
    const m = phraseMold(phrase(), "silabizar");
    assert.equal(m.syllables, 6);
    assert.deepEqual(m.melismas, []);
    // La nota que abre el melisma hereda el acento; la última, larga, también acentúa.
    assert.deepEqual(m.stresses, [2, 4, 6]);
    assert.deepEqual(m.long, [6]);
    assert.equal(m.ending, "aguda");
  });

  it("silabizar sin nota final larga deja el acento a dos del final: esdrújula", () => {
    const n = [...melismaNotes.slice(0, 5), note(65, 1.6, 1.9)];
    const w = words([
      ["te", 0, 0.25],
      ["quiero", 0.3, 0.9],
      ["sol", 1.0, 1.9],
    ]);
    const p = buildPhrases(anchorSyllables(w, n), n)[0];
    assert.equal(phraseMold(p, "respetar").ending, "aguda");
    assert.equal(phraseMold(p, "silabizar").ending, "esdrujula");
  });

  it("la corrección humana manda (y al silabizar suma las notas extra)", () => {
    const p = { ...phrase(), override: { syllables: 5, ending: "llana" as const, rhyme: "A" } };
    const r = phraseMold(p, "respetar");
    assert.equal(r.syllables, 5);
    assert.equal(r.ending, "llana");
    assert.equal(r.rhyme, "A");
    assert.equal(phraseMold(p, "silabizar").syllables, 7);
    // Posiciones que ya no caben se descartan.
    const short = phraseMold({ ...phrase(), override: { syllables: 3 } }, "respetar");
    assert.deepEqual(short.stresses, [2]);
    assert.deepEqual(short.melismas, []);
  });

  it("los rellenos marcan final por su acento musical", () => {
    const n = [note(60, 0, 0.28), note(60, 0.3, 0.58), note(62, 0.6, 1.5)];
    const w = words([
      ["na", 0, 0.28],
      ["na", 0.3, 0.58],
      ["na", 0.6, 1.5],
    ]);
    const m = buildPhrases(anchorSyllables(w, n), n)[0].mold;
    assert.equal(m.syllables, 3);
    assert.deepEqual(m.stresses, [1, 3]);
    assert.equal(m.ending, "aguda");
  });
});

describe("classifyPassage", () => {
  const lyric = (n: number, o: Partial<Parameters<typeof syl>[0]> = {}) =>
    Array.from({ length: n }, (_, i) => syl({ start: i * 0.4, end: (i + 1) * 0.4, word: i, ...o }));

  it("sin sílabas (tarareo sin texto) es melisma", () => assert.equal(classifyPassage([], []), "melisma"));
  it("todo relleno es sílabas", () => assert.equal(classifyPassage(lyric(8, { filler: true }), []), "silabas"));
  it("letra silábica es letra", () => assert.equal(classifyPassage(lyric(12), []), "letra"));
  it("letra con muchos melismas es melisma", () => {
    const s = lyric(10).map((x, i) => (i % 2 ? { ...x, melisma: true, noteIdx: [0, 1] } : x));
    assert.equal(classifyPassage(s, []), "melisma");
  });
  it("letra y relleno a la par es mixto", () => {
    assert.equal(classifyPassage([...lyric(6), ...lyric(6, { filler: true })], []), "mixto");
  });
  it("letra densa, de sílabas cortas y sin melismas, es rap", () => {
    const s = Array.from({ length: 24 }, (_, i) => syl({ start: i * 0.14, end: (i + 1) * 0.14, word: i >> 1 }));
    const w = Array.from({ length: 12 }, (_, i) => ({ text: "palabra", start: i * 0.28, end: i * 0.28 + 0.26 }));
    assert.equal(classifyPassage(s, w), "rap");
  });
});

describe("tonalidad", () => {
  const prof = (w: Record<number, number>) => Array.from({ length: 12 }, (_, i) => w[i] ?? 0);

  it("pitchClassProfile pondera por duración y suma 1", () => {
    const p = pitchClassProfile([note(60, 0, 3), note(72, 3, 4), note(67, 4, 5)]);
    assert.ok(Math.abs(p.reduce((a, b) => a + b, 0) - 1) < 1e-9);
    assert.ok(Math.abs(p[0] - 0.8) < 1e-9);
    assert.ok(Math.abs(p[7] - 0.2) < 1e-9);
  });

  it("una escala de Do mayor con la tónica marcada da Do mayor con confianza alta", () => {
    const k = estimateKey(prof({ 0: 3, 2: 1, 4: 2, 5: 1, 7: 2, 9: 1, 11: 0.5 }), "voz");
    assert.deepEqual(k.best.key, { tonic: 0, mode: "major" });
    assert.equal(k.candidates.length, 3);
    assert.deepEqual(k.candidates[0], k.best);
    assert.ok(k.confidence > 0.8);
    assert.equal(k.source, "voz");
  });

  it("La menor con su sensible (Sol♯) da La menor", () => {
    const k = estimateKey(prof({ 9: 3, 11: 1, 0: 2, 2: 1, 4: 2, 5: 1, 8: 0.7 }), "instrumento");
    assert.deepEqual(k.best.key, { tonic: 9, mode: "minor" });
  });

  it("la escala sin centro (relativas empatadas) da confianza baja: no inventa certeza", () => {
    const k = estimateKey(prof({ 0: 1, 2: 1, 4: 1, 5: 1, 7: 1, 9: 1, 11: 1 }), "voz");
    const top2 = k.candidates.slice(0, 2).map((c) => `${c.key.tonic}${c.key.mode}`).sort();
    assert.deepEqual(top2, ["0major", "9minor"]);
    assert.ok(k.confidence < 0.3);
  });

  it("un perfil vacío no inventa nada", () => {
    const k = estimateKey(new Array(12).fill(0), "voz");
    assert.equal(k.confidence, 0);
  });

  it("semitonesToKey: relativas son la misma escala y se va por el camino corto", () => {
    // Re♭ mayor → Si menor: Re♭ mayor = Si♭ menor → +1.
    assert.equal(semitonesToKey({ tonic: 1, mode: "major" }, { tonic: 11, mode: "minor" }), 1);
    // La menor → Si♭ menor: +1.
    assert.equal(semitonesToKey({ tonic: 9, mode: "minor" }, { tonic: 10, mode: "minor" }), 1);
    // La menor → Do mayor: relativas, 0.
    assert.equal(semitonesToKey({ tonic: 9, mode: "minor" }, { tonic: 0, mode: "major" }), 0);
    // Si♭ menor → La menor: −1.
    assert.equal(semitonesToKey({ tonic: 10, mode: "minor" }, { tonic: 9, mode: "minor" }), -1);
    // Do mayor → Fa♯ mayor: trítono, el lado corto definido es −6.
    assert.equal(semitonesToKey({ tonic: 0, mode: "major" }, { tonic: 6, mode: "major" }), -6);
    // Siempre en −6..+5.
    for (let a = 0; a < 12; a++)
      for (let b = 0; b < 12; b++) {
        const d = semitonesToKey({ tonic: a, mode: "major" }, { tonic: b, mode: "minor" });
        assert.ok(d >= -6 && d <= 5);
      }
  });

  it("transposeNotes mueve alturas sin tocar tiempos", () => {
    assert.deepEqual(transposeNotes([note(60, 1, 2)], -1), [note(59, 1, 2)]);
  });

  it("outOfKey: menor natural + la sensible tolerada", () => {
    const aMinor = { tonic: 9, mode: "minor" as const };
    const ns = [note(69, 0, 1), note(68, 0, 1), note(66, 0, 1), note(70, 0, 1), note(72, 0, 1)];
    assert.deepEqual(outOfKey(ns, aMinor), [false, false, true, true, false]);
    assert.deepEqual(outOfKey([note(61, 0, 1), note(62, 0, 1)], { tonic: 0, mode: "major" }), [true, false]);
  });
});

describe("lineFit", () => {
  const mold = (p: Partial<PhraseMold>): PhraseMold => ({
    syllables: 9,
    stresses: [2, 6, 8],
    ending: "llana",
    melismas: [],
    long: [],
    ...p,
  });

  it("calce exacto: sílabas, final, acentos y puntaje 1", () => {
    const f = lineFit("La luna se quedó dormida", mold({}), "respetar");
    assert.equal(f.syllables, 9);
    assert.deepEqual(f.range, [9, 9]);
    assert.equal(f.syllablesOk, true);
    assert.equal(f.ending, "llana");
    assert.equal(f.endingOk, true);
    assert.equal(f.stressHits, 3);
    assert.equal(f.stressTotal, 3);
    assert.equal(f.melismaVowelOk, null);
    assert.equal(f.score, 1);
    assert.equal(f.hint, undefined);
  });

  it("sobra una sílaba", () => {
    const f = lineFit("la luna ya se quedó dormida", mold({}), "respetar");
    assert.equal(f.syllablesOk, false);
    assert.equal(f.syllables, 10);
    assert.equal(f.hint, "sobra 1 sílaba");
    assert.ok(f.score < 1);
  });

  it("faltan sílabas", () => {
    const f = lineFit("la luna se durmió", mold({}), "respetar");
    assert.equal(f.hint, "faltan 3 sílabas");
  });

  it("final equivocado: la melodía pide aguda", () => {
    const f = lineFit("la luna se quedó dormida", mold({ stresses: [2, 6, 9], ending: "aguda" }), "respetar");
    assert.equal(f.syllablesOk, true);
    assert.equal(f.endingOk, false);
    assert.equal(f.hint, "termina llana, la melodía pide aguda");
  });

  it("vocal cerrada en el melisma: pide a/o/e", () => {
    const m = mold({ syllables: 4, stresses: [3], melismas: [{ pos: 3, notes: 3, dur: 1.1 }], long: [3] });
    const bad = lineFit("sin tu risa", m, "respetar");
    assert.equal(bad.melismaVowelOk, false);
    assert.equal(bad.hint, "el melisma de la sílaba 3 cae en «i»: busca a/o/e");
    const good = lineFit("sin tu boca", m, "respetar");
    assert.equal(good.melismaVowelOk, true);
    assert.equal(good.score, 1);
    assert.ok(bad.score < good.score);
    // Al silabizar no hay melisma que medir.
    assert.equal(lineFit("sin tu risa", m, "silabizar").melismaVowelOk, null);
  });

  it("una sinalefa salva la cuenta (sílabas cantadas, sin el +1/−1 poético)", () => {
    const f = lineFit("te quiero aunque no quieras", mold({ syllables: 7, stresses: [2, 6] }), "respetar");
    assert.deepEqual(f.range, [7, 8]);
    assert.equal(f.syllablesOk, true);
    assert.equal(f.syllables, 7);
    assert.equal(f.stressHits, 2);
  });

  it("elige la sinalefa que mejor calza con los acentos del molde", () => {
    // vuel-ve-a-ca-sa-y-e-lla-se-va: 10 sin sinalefas, 3 posibles. Para 9 sílabas
    // solo "vuelve‿a" deja las tónicas en 1·3·6·9.
    const f = lineFit("vuelve a casa y ella se va", mold({ syllables: 9, stresses: [1, 3, 6, 9], ending: "aguda" }), "respetar");
    assert.deepEqual(f.range, [7, 10]);
    assert.equal(f.syllables, 9);
    assert.equal(f.stressHits, 4);
    assert.equal(f.endingOk, true);
  });

  it("final esdrújulo y acordes inline", () => {
    const f = lineFit("[Am]queda la [F]última lágrima", mold({ syllables: 8, stresses: [1, 4, 6], ending: "esdrujula" }), "respetar");
    assert.equal(f.ending, "esdrujula");
    assert.equal(f.endingOk, true);
    assert.equal(f.syllables, 8);
  });

  it("una línea vacía no calza y lo dice", () => {
    const f = lineFit("  ", mold({}), "respetar");
    assert.equal(f.score, 0);
    assert.equal(f.syllablesOk, false);
    assert.equal(f.hint, "escribe la línea");
  });
});

describe("onda y curva", () => {
  it("peaksOf normaliza al pico máximo", () => {
    assert.deepEqual(peaksOf(new Float32Array([0, 0.5, -1, 0.25]), 2), [0.5, 1]);
    assert.deepEqual(peaksOf(new Float32Array(0), 3), [0, 0, 0]);
  });

  it("downsampleF0 remuestrea con mediana y deja null donde no hubo voz", () => {
    const tr = trackPitch(concat(tone(440, 0.5), silence(0.5)), SR);
    const c = downsampleF0(tr, 0.1);
    assert.equal(c.length, Math.ceil(tr.midi.length / 10));
    assert.ok(Math.abs((c[2] as number) - 69) < 0.1);
    assert.equal(c[8], null);
  });

  it("acousticSeconds cuenta voz y notas sostenidas por segundo", () => {
    const tr = trackPitch(concat(tone(440, 2), silence(1)), SR);
    const a = acousticSeconds(tr, segmentNotes(tr, { tuningCents: 0 }), { durationSec: 3 });
    assert.equal(a.length, 3);
    assert.ok(a[0].voiced > 0.9 && a[0].sustained > 0.9);
    // La ventana de YIN (±21 ms) todavía oye el tono en los primeros cuadros del silencio.
    assert.ok(a[2].voiced < 0.1 && a[2].sustained < 0.05);
  });
});

describe("detectPassages", () => {
  const sung = (): TranscriptWord[] => [
    { text: "[canta]", start: 25, end: 26, type: "audio_event" },
    ...[26, 26.4, 26.8, 27.2, 27.6, 28].map((t) => ({
      text: "na",
      start: t,
      end: t + 0.3,
      type: "word" as const,
      speaker: "speaker_1",
    })),
    ...[29, 31.5, 34].flatMap((t) =>
      ["cielo", "de", "papel"].map((text, i) => ({
        text,
        start: t + i * 0.5,
        end: t + i * 0.5 + 0.45,
        type: "word" as const,
        speaker: "speaker_1",
      })),
    ),
  ];

  it("evento [canta] + rellenos repetidos → probable; la línea repetida sola queda dudosa", () => {
    const all = [...speech(0, 20), ...sung(), ...speech(40, 60, 3.5, 11)];
    const c = detectPassages(all, { durationSec: 60 });
    const probable = c.filter((x) => x.group === "probable");
    assert.equal(probable.length, 1);
    const p = probable[0];
    assert.ok(p.start <= 26 && p.end >= 29, `${p.start}-${p.end}`);
    assert.ok(p.score >= 0.35);
    assert.equal(p.speaker, "speaker_1");
    assert.ok(p.evidence.some((e) => e.startsWith("evento [canta]")));
    assert.ok(p.evidence.some((e) => e === "relleno na ×6"));
    assert.equal(p.kind, "mixto");
    // La repetición de letra pesa 0,35 (medido): sola no cruza el umbral.
    const doubt = c.find((x) => x.group === "dudoso");
    assert.ok(doubt && doubt.start >= p.end && doubt.evidence.some((e) => e.startsWith("se repite 3×")));
    // Nada en el habla.
    assert.ok(c.every((x) => x.end <= 20 || x.start >= 20), "nada entre 0 y 20");
    assert.ok(c.every((x) => x.start < 38), "nada entre 40 y 60");
  });

  it("con melodía estable del stem, el pasaje entero es probable", () => {
    const all = [...speech(0, 20), ...sung(), ...speech(40, 60, 3.5, 11)];
    const talking = (t: number) => t < 20 || t >= 40;
    const acoustic = Array.from({ length: 60 }, (_, t) => ({
      t,
      voiced: t >= 25 && t < 36 ? 0.8 : talking(t) ? 0.7 : 0,
      sustained: t >= 25 && t < 36 ? 0.5 : talking(t) ? 0.08 : 0,
    }));
    const c = detectPassages(all, { durationSec: 60, acoustic });
    assert.equal(c.length, 1);
    assert.equal(c[0].group, "probable");
    assert.ok(c[0].start <= 26 && c[0].end >= 35, `${c[0].start}-${c[0].end}`);
    assert.ok(c[0].evidence.some((e) => e.startsWith("se repite 3×")));
    assert.ok(c[0].evidence.some((e) => e.startsWith("melodía estable")));
  });

  it("la recurrencia es LOCAL: una línea dicha una vez lejos de sus repeticiones no cuenta", () => {
    const say = (t: number): TranscriptWord[] =>
      ["cielo", "de", "papel"].map((text, i) => ({
        text,
        start: t + i * 0.5,
        end: t + i * 0.5 + 0.45,
        type: "word",
        speaker: "speaker_1",
      }));
    const all = [...say(30), ...say(32.5), ...say(35), ...say(300)];
    const c = detectPassages(all, { durationSec: 320 });
    assert.ok(c.every((x) => x.end < 290), "nada alrededor de la aparición lejana");
    const near = c.find((x) => x.start <= 31 && x.end >= 34);
    assert.ok(near, "el grupo que se itera sí queda");
    assert.ok(near.evidence.some((e) => e.startsWith("se repite 3× cerca (4× en la sesión)")));
  });

  it("habla densa sola no produce pasajes", () => {
    assert.deepEqual(detectPassages(speech(0, 120, 3.5, 3), { durationSec: 120 }), []);
  });

  it("una línea de letra del resumen sola queda como dudosa; con melodía estable, probable", () => {
    const line: TranscriptWord[] = ["luna", "de", "agua"].map((text, i) => ({
      text,
      start: 50 + i * 0.4,
      end: 50 + i * 0.4 + 0.35,
      type: "word",
      speaker: "speaker_0",
    }));
    const lyricLines = [{ text: "Luna de agua", at: 50 }];
    const alone = detectPassages(line, { durationSec: 70, lyricLines });
    assert.equal(alone.length, 1);
    assert.equal(alone[0].group, "dudoso");
    assert.ok(alone[0].evidence.some((e) => e.startsWith("letra del resumen")));

    const acoustic = Array.from({ length: 70 }, (_, t) => ({
      t,
      voiced: t >= 48 && t < 54 ? 0.9 : 0,
      sustained: t >= 48 && t < 54 ? 0.7 : 0,
    }));
    const withMelody = detectPassages(line, { durationSec: 70, lyricLines, acoustic });
    assert.equal(withMelody[0].group, "probable");
    assert.ok(withMelody[0].evidence.some((e) => e.startsWith("melodía estable")));
  });
});

describe("sesiones y tablero", () => {
  it("sessionSlug usa la fecha LOCAL y quita acentos", () => {
    // 22:13 hora local: en UTC-5 ya es el día siguiente; el slug no debe saltar de día.
    assert.equal(sessionSlug("Ensayo — Canción Ñandú!", new Date(2026, 8, 23, 22, 13)), "2026-09-23-ensayo-cancion-nandu");
    assert.equal(sessionSlug("   ", new Date(2026, 0, 5, 9)), "2026-01-05");
  });

  it("validateBoard acepta lo mínimo y rechaza tónicas imposibles e ids repetidos", () => {
    const song = { id: "s1", title: "Prueba", key: { tonic: 9, mode: "minor" }, sections: [] };
    const ok = validateBoard({ songs: [song], refs: [], notebook: [] });
    assert.equal(ok.version, 1);
    assert.throws(
      () => validateBoard({ songs: [{ ...song, key: { tonic: 13, mode: "minor" } }], refs: [], notebook: [] }),
      ComposicionValidationError,
    );
    assert.throws(
      () => validateBoard({ songs: [{ ...song, key: { tonic: 2.5, mode: "major" } }], refs: [], notebook: [] }),
      ComposicionValidationError,
    );
    assert.throws(() => validateBoard({ songs: [song, song], refs: [], notebook: [] }), /repetido/);
    assert.throws(() => validateBoard({ songs: [], refs: [{}], notebook: [] }), ComposicionValidationError);
  });
});
