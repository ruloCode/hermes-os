import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  lineFit,
  lineReading,
  moldPositions,
  moldSlots,
  phraseMold,
  type MoldSlotInfo,
  type Phrase,
  type PhraseMold,
  type SungSyllable,
  type Vowel,
} from "@hermes/shared";
import { syl } from "./test-helpers.js";

/**
 * FASE C — letra con ECO FONÉTICO: lo que pide cada posición del molde
 * (vocal del tarareo, peso métrico, largo) y cómo se mide una línea contra
 * eso (eco de vocales, malacentos, vocal del melisma). Frases y líneas
 * INVENTADAS: el repo es público.
 */

/** Frase a mano: na · na · uh (melisma de 3 notas) · sol (palabra real). */
function hummed(opts: { metric?: boolean } = {}): Phrase {
  const s: SungSyllable[] = [
    syl({
      text: "na",
      start: 0,
      end: 0.25,
      filler: true,
      stressed: true,
      midi: 60,
      noteIdx: [0],
      word: 0,
    }),
    syl({ text: "na", start: 0.25, end: 0.5, filler: true, midi: 62, noteIdx: [1], word: 1 }),
    syl({
      text: "uh",
      start: 0.5,
      end: 1.7,
      filler: true,
      stressed: true,
      melisma: true,
      midi: 64,
      noteIdx: [2, 3, 4],
      word: 2,
      parts: [
        { midi: 64, start: 0.5, end: 0.9 },
        { midi: 62, start: 0.9, end: 1.3 },
        { midi: 60, start: 1.3, end: 1.7 },
      ],
    }),
    syl({
      text: "sol",
      start: 1.75,
      end: 2.0,
      filler: false,
      stressed: true,
      midi: 60,
      noteIdx: [5],
      word: 3,
    }),
  ];
  if (opts.metric) {
    // 120 bpm en 4/4 = 8 semicorcheas por segundo: pasos 0 · 2 · 4 · 14.
    const at: [number, number][] = [
      [0, 4],
      [2, 1],
      [4, 2],
      [14, 1],
    ];
    s.forEach((x, i) => (x.metric = { absStep: at[i][0], weight: at[i][1] }));
  }
  const p: Phrase = {
    idx: 0,
    start: 0,
    end: 2,
    text: "na na uh sol",
    syllables: s,
    mold: { syllables: 0, stresses: [], ending: "llana", melismas: [], long: [] },
  };
  p.mold = phraseMold(p, "respetar");
  return p;
}

describe("moldSlots", () => {
  it("coincide con los conteos de phraseMold en ambos modos (y phraseMold los guarda en slots)", () => {
    for (const metric of [false, true])
      for (const mode of ["respetar", "silabizar"] as const) {
        const p = hummed({ metric });
        const m = phraseMold(p, mode);
        const slots = moldSlots(p, mode);
        assert.equal(slots.length, m.syllables);
        assert.deepEqual(m.slots, slots);
        // Las posiciones largas y los melismas del molde son los mismos que dicen los slots.
        assert.deepEqual(
          m.long,
          slots.flatMap((s, i) => (s.long ? [i + 1] : [])),
        );
        assert.deepEqual(
          m.melismas.map((x) => x.pos),
          slots.flatMap((s, i) => (s.melismaNotes ? [i + 1] : [])),
        );
      }
  });

  it('"respetar": vocal del tarareo solo en rellenos, peso 3/1 sin rejilla y notas del melisma', () => {
    const slots = moldSlots(hummed(), "respetar");
    assert.deepEqual(
      slots.map((s) => s.vowel),
      ["a", "a", "u", undefined],
    );
    assert.deepEqual(
      slots.map((s) => s.weight),
      [3, 1, 3, 3],
    );
    assert.equal(slots[2].melismaNotes, 3);
    assert.equal(slots[2].long, true);
    assert.equal(slots[2].dur, 1.2);
    assert.ok(slots.every((s) => s.len16 === undefined));
    assert.deepEqual(
      slots.map((s) => s.filler),
      [true, true, true, false],
    );
  });

  it('"silabizar": cada nota del melisma es su posición y hereda la vocal', () => {
    const slots = moldSlots(hummed(), "silabizar");
    assert.equal(slots.length, 6);
    assert.deepEqual(
      slots.map((s) => s.vowel),
      ["a", "a", "u", "u", "u", undefined],
    );
    // La nota que abre el melisma hereda el acento; las siguientes (0,4 s, cortas) no.
    assert.deepEqual(
      slots.map((s) => s.weight),
      [3, 1, 3, 1, 1, 3],
    );
    assert.ok(slots.every((s) => s.melismaNotes === undefined));
    assert.deepEqual(
      slots.slice(2, 5).map((s) => s.dur),
      [0.4, 0.4, 0.4],
    );
  });

  it("con rejilla: peso métrico de cada ataque y largo en semicorcheas (también dentro del melisma)", () => {
    const r = moldSlots(hummed({ metric: true }), "respetar");
    assert.deepEqual(
      r.map((s) => s.weight),
      [4, 1, 2, 1],
    );
    assert.deepEqual(
      r.map((s) => s.len16),
      [2, 2, 10, 2],
    );
    const s = moldSlots(hummed({ metric: true }), "silabizar");
    // Notas internas del melisma: pasos 4+3 = 7 (peso 0) y 4+6 = 10 (peso 1) en 4/4.
    assert.deepEqual(
      s.map((x) => x.weight),
      [4, 1, 2, 0, 1, 1],
    );
    assert.deepEqual(
      s.map((x) => x.len16),
      [2, 2, 3, 3, 3, 2],
    );
  });

  it("moldPositions da el ataque de cada posición y sus notas (la guía canta ahí)", () => {
    const ps = moldPositions(hummed(), "respetar");
    assert.deepEqual(
      ps.map((p) => p.start),
      [0, 0.25, 0.5, 1.75],
    );
    assert.deepEqual(
      ps[2].notes.map((n) => n.midi),
      [64, 62, 60],
    );
    const sil = moldPositions(hummed(), "silabizar");
    assert.deepEqual(
      sil.map((p) => p.start),
      [0, 0.25, 0.5, 0.9, 1.3, 1.75],
    );
  });

  it("una corrección humana a menos sílabas recorta los slots como recorta los acentos", () => {
    const p = { ...hummed(), override: { syllables: 3 } };
    const m = phraseMold(p, "respetar");
    assert.equal(m.slots?.length, 3);
    assert.equal(moldSlots(p, "respetar").length, 4);
  });
});

// ─────────────────────────── Lectura y eco ───────────────────────────

/** Molde de tarareo a mano: todas las posiciones son relleno con su vocal. */
function vowelMold(
  vowels: Vowel[],
  o: { dur?: number[]; stresses?: number[]; ending?: PhraseMold["ending"] } = {},
): PhraseMold {
  const slots: MoldSlotInfo[] = vowels.map((v, i) => ({
    vowel: v,
    weight: (o.stresses ?? [1, 3]).includes(i + 1) ? 3 : 1,
    dur: o.dur?.[i] ?? 0.4,
    long: false,
    filler: true,
  }));
  return {
    syllables: vowels.length,
    stresses: o.stresses ?? [1, 3],
    ending: o.ending ?? "llana",
    melismas: [],
    long: [],
    slots,
  };
}

describe("lineReading", () => {
  const mold = (p: Partial<PhraseMold>): PhraseMold => ({
    syllables: 9,
    stresses: [2, 6, 8],
    ending: "llana",
    melismas: [],
    long: [],
    ...p,
  });

  it("devuelve la lectura de sinalefas que elige lineFit (la sinalefa une con un espacio)", () => {
    const m = mold({ syllables: 9, stresses: [1, 3, 6, 9], ending: "aguda" });
    const text = "vuelve a casa y ella se va";
    const r = lineReading(text, m, "respetar");
    assert.deepEqual(r, ["vuel", "ve a", "ca", "sa", "y", "e", "lla", "se", "va"]);
    assert.deepEqual(lineFit(text, m, "respetar").reading, r);
  });

  it("sin sinalefa posible, una sílaba por sílaba; y la lectura cambia con el molde", () => {
    assert.deepEqual(lineReading("la luna", mold({ syllables: 3 }), "respetar"), [
      "la",
      "lu",
      "na",
    ]);
    // "te quiero aunque": 5 sin sinalefa, 4 con "ro‿aun".
    assert.deepEqual(lineReading("te quiero aunque", mold({ syllables: 4 }), "respetar"), [
      "te",
      "quie",
      "ro aun",
      "que",
    ]);
    assert.deepEqual(lineReading("te quiero aunque", mold({ syllables: 5 }), "respetar"), [
      "te",
      "quie",
      "ro",
      "aun",
      "que",
    ]);
  });

  it("una línea vacía no tiene lectura", () => {
    assert.deepEqual(lineReading("  ", mold({}), "respetar"), []);
  });
});

describe("lineFit · eco fonético", () => {
  it("eco = 1 con las mismas vocales del tarareo y ≈ 0 con la clase opuesta", () => {
    const m = vowelMold(["a", "a", "o", "a"]);
    const same = lineFit("casa loca", m, "respetar");
    assert.equal(same.echo?.score, 1);
    assert.deepEqual(
      same.echo?.perSlot.map((x) => x.got),
      ["a", "a", "o", "a"],
    );
    const opposite = lineFit("tu mi di su", m, "respetar");
    assert.ok((opposite.echo?.score ?? 1) <= 0.05);
    assert.ok(opposite.score < same.score);
  });

  it("con eco bajo el consejo nombra la sílaba y las dos vocales", () => {
    // sir·ve·lu·jo contra a·a·o·a: cabe, acentúa y cierra bien; solo falla el eco.
    const f = lineFit("sirve lujo", vowelMold(["a", "a", "o", "a"]), "respetar");
    assert.equal(f.echo?.score, 0.25);
    assert.equal(f.hint, "en la sílaba 1 el tarareo decía «a»; «i» no se parece");
  });

  it("pesa por la duración de cada posición: la nota larga manda", () => {
    const m = vowelMold(["a", "i"], { dur: [1.0, 0.1], stresses: [1] });
    const longOk = lineFit("mar sin", m, "respetar").echo;
    const shortOk = lineFit("mis fin", m, "respetar").echo;
    // a·i (todo calza) vs i·i (falla solo la larga): la larga decide.
    assert.ok((longOk?.score ?? 0) > 0.9);
    assert.ok((shortOk?.score ?? 1) < 0.15);
    assert.deepEqual(
      longOk?.perSlot.map((x) => x.w),
      [1, 0.1],
    );
  });

  it("sin vocales de tarareo (palabras reales) o con un molde viejo no hay eco", () => {
    const words = vowelMold(["a", "o"]);
    words.slots = words.slots?.map((s) => ({ ...s, filler: false }));
    assert.equal(lineFit("casa", words, "respetar").echo, undefined);
    const old: PhraseMold = {
      syllables: 2,
      stresses: [1],
      ending: "llana",
      melismas: [],
      long: [],
    };
    const f = lineFit("casa", old, "respetar");
    assert.equal(f.echo, undefined);
    assert.equal(f.misaccents, undefined);
  });

  it("un molde viejo (sin slots) puntúa exactamente como antes", () => {
    const old: PhraseMold = {
      syllables: 9,
      stresses: [2, 6, 8],
      ending: "llana",
      melismas: [],
      long: [],
    };
    // 10 sílabas contra 9, final bien, 1 de 3 acentos: (0,45·0,66 + 0,2 + 0,2/3) / 0,85.
    assert.equal(lineFit("la luna ya se quedó dormida", old, "respetar").score, 0.66);
    const mel: PhraseMold = {
      syllables: 4,
      stresses: [3],
      ending: "llana",
      melismas: [{ pos: 3, notes: 3, dur: 1.1 }],
      long: [3],
    };
    // "sin tu risa": todo bien menos la vocal del melisma → 0,85 / 1.
    assert.equal(lineFit("sin tu risa", mel, "respetar").score, 0.85);
  });
});

describe("lineFit · malacentos", () => {
  // Rejilla: 1 = primer tiempo, 2 = semicorchea débil, 3 = tiempo, 4 = tiempo fuerte (acento).
  const m: PhraseMold = {
    syllables: 4,
    stresses: [1, 4],
    ending: "aguda",
    melismas: [],
    long: [],
    slots: [
      { weight: 4, len16: 2, dur: 0.25, long: false, filler: false },
      { weight: 0, len16: 1, dur: 0.12, long: false, filler: false },
      { weight: 2, len16: 2, dur: 0.25, long: false, filler: false },
      { weight: 3, len16: 4, dur: 0.5, long: false, filler: false },
    ],
  };

  it("detecta la tónica que cae en una posición débil y corta, y lo dice con la palabra", () => {
    const f = lineFit("quería sol", m, "respetar");
    assert.deepEqual(f.misaccents, [{ pos: 2, syl: "rí" }]);
    assert.equal(f.hint, "«quería» carga el acento en un tiempo débil");
    const ok = lineFit("dame tu sol", m, "respetar");
    assert.deepEqual(ok.misaccents, []);
    assert.equal(ok.hint, undefined);
    assert.ok(ok.score > f.score);
  });

  it("una tónica débil pero LARGA no es malacento (se sostiene)", () => {
    const long = {
      ...m,
      slots: m.slots?.map((s, i) => (i === 1 ? { ...s, len16: 6, dur: 0.75, long: true } : s)),
    };
    assert.deepEqual(lineFit("quería sol", long, "respetar").misaccents, []);
  });
});

describe("lineFit · vocal del melisma", () => {
  const withHum = (v: Vowel): PhraseMold => ({
    syllables: 4,
    stresses: [3],
    ending: "llana",
    melismas: [{ pos: 3, notes: 3, dur: 1.1 }],
    long: [3],
    slots: [
      { weight: 1, dur: 0.3, long: false, filler: false },
      { weight: 1, dur: 0.3, long: false, filler: false },
      { vowel: v, weight: 3, dur: 1.1, long: true, filler: true, melismaNotes: 3 },
      { weight: 1, dur: 0.3, long: false, filler: false },
    ],
  });

  it("la vocal cerrada que se TARAREÓ en el melisma se acepta; otra cerrada no", () => {
    const m = withHum("u");
    const cura = lineFit("sin tu cura", m, "respetar");
    assert.equal(cura.melismaVowelOk, true);
    assert.equal(cura.echo?.score, 1);
    const risa = lineFit("sin tu risa", m, "respetar");
    assert.equal(risa.melismaVowelOk, false);
    assert.equal(
      risa.hint,
      "el melisma de la sílaba 3 cae en «i»: busca a/o/e (o «u», como el tarareo)",
    );
    // La abierta sigue valiendo aunque el tarareo dijera otra cosa.
    assert.equal(lineFit("sin tu boca", m, "respetar").melismaVowelOk, true);
  });
});
