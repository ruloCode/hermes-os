import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  alignSyllables,
  moldSlots,
  phraseMold,
  pitchAt,
  planGuide,
  type Phrase,
  type SungSyllable,
  type SyllableSpan,
  type TtsAlignment,
} from "@hermes/shared";
import { syl } from "./test-helpers.js";

/**
 * FASE D — el PLAN de la guía cantada: de la alineación por carácter del TTS a
 * sílabas, y de sílabas a tramos del pasaje con su altura. Alineaciones y
 * frases INVENTADAS (80 ms por carácter, notas de 0,5 s): el repo es público.
 */

const near = (a: number, b: number, tol = 1e-6): boolean => Math.abs(a - b) <= tol;

/** Alineación sintética: cada carácter dura `per` s, en orden. */
function fakeAlignment(text: string, per = 0.07): TtsAlignment {
  const chars = [...text];
  return {
    characters: chars,
    character_start_times_seconds: chars.map((_, i) => i * per),
    character_end_times_seconds: chars.map((_, i) => (i + 1) * per),
  };
}

describe("alignSyllables", () => {
  it("reparte la alineación entre sílabas con tildes, mayúsculas y la sinalefa «y al»", () => {
    const spans = alignSyllables(["can", "ción", "y al", "ma"], fakeAlignment("Canción y alma"));
    assert.ok(spans);
    const s = spans as SyllableSpan[];
    assert.deepEqual(
      s.map((x) => x.syllable),
      ["can", "ción", "y al", "ma"],
    );
    // can: C·a·n → la vocal empieza en la «a» (0,07).
    assert.ok(near(s[0].start, 0) && near(s[0].vowelStart, 0.07) && near(s[0].end, 0.21));
    // ción: la vocal arranca en la «i» del diptongo; el espacio antes de «y» se parte a la mitad.
    assert.ok(near(s[1].start, 0.21) && near(s[1].vowelStart, 0.28) && near(s[1].end, 0.525));
    // «y al»: la y ante vocal es consonante; el espacio de la sinalefa queda DENTRO de la sílaba.
    assert.ok(near(s[2].start, 0.525) && near(s[2].vowelStart, 0.7) && near(s[2].end, 0.84));
    assert.ok(near(s[3].start, 0.84) && near(s[3].vowelStart, 0.91) && near(s[3].end, 0.98));
  });

  it("la h es muda: «hola» empieza su vocal en la o; la u de «que» no suena", () => {
    const h = alignSyllables(["ho", "la"], fakeAlignment("Hola", 0.1)) as SyllableSpan[];
    assert.ok(near(h[0].start, 0.1) || near(h[0].start, 0), "la h no se compara");
    assert.ok(near(h[0].vowelStart, 0.1));
    const q = alignSyllables(["que", "so"], fakeAlignment("queso", 0.1)) as SyllableSpan[];
    assert.ok(near(q[0].vowelStart, 0.2), "la vocal de «que» es la e");
  });

  it("devuelve null si el TTS dijo otra cosa: un número o letras que no cuadran", () => {
    assert.equal(alignSyllables(["be", "sos"], fakeAlignment("2 besos")), null);
    assert.equal(alignSyllables(["be", "sos"], fakeAlignment("dos besos")), null);
    assert.equal(
      alignSyllables(["can", "ción", "y al", "ma"], fakeAlignment("Canción y el alma")),
      null,
    );
    assert.equal(alignSyllables([], fakeAlignment("hola")), null);
  });

  it("una pausa real (coma) no se reparte entera: cada lado se lleva a lo sumo 40 ms", () => {
    // «sí, no»: la coma y el espacio suman 0,4 s de hueco.
    const al: TtsAlignment = {
      characters: ["s", "í", ",", " ", "n", "o"],
      character_start_times_seconds: [0, 0.1, 0.2, 0.4, 0.6, 0.7],
      character_end_times_seconds: [0.1, 0.2, 0.4, 0.6, 0.7, 0.8],
    };
    const s = alignSyllables(["sí", "no"], al) as SyllableSpan[];
    assert.ok(near(s[0].end, 0.24) && near(s[1].start, 0.56));
  });
});

// ─────────────────────────── Plan ───────────────────────────

/** Frase de 4 sílabas con ataques en 0,5 · 1,0 · 1,5 · 2,0 (0,5 s cada una). */
function phrase4(midis: number[] = [60, 62, 64, 65]): Phrase {
  const s: SungSyllable[] = midis.map((m, i) =>
    syl({
      text: ["can", "ción", "yal", "ma"][i],
      start: 0.5 + 0.5 * i,
      end: 1.0 + 0.5 * i,
      midi: m,
      noteIdx: [i],
      word: i,
      stressed: i % 2 === 1,
    }),
  );
  const p: Phrase = {
    idx: 2,
    start: 0.5,
    end: 2.5,
    text: "canción y alma",
    syllables: s,
    mold: { syllables: 0, stresses: [], ending: "llana", melismas: [], long: [] },
  };
  p.mold = phraseMold(p, "respetar");
  return p;
}

const SPANS = alignSyllables(
  ["can", "ción", "y al", "ma"],
  fakeAlignment("Canción y alma"),
) as SyllableSpan[];

describe("planGuide", () => {
  it("la vocal cae en el ataque de la nota y la consonante entra antes (≤ 60 ms)", () => {
    const p = phrase4();
    const { segments, warnings } = planGuide({
      phrase: p,
      phraseIdx: p.idx,
      spans: SPANS,
      slots: moldSlots(p, "respetar"),
      mode: "respetar",
      pitch: "notas",
    });
    assert.deepEqual(warnings, []);
    assert.equal(segments.length, 4);
    segments.forEach((g, i) => {
      assert.equal(g.phrase, 2);
      assert.ok(near(g.dstVowelStart, 0.5 + 0.5 * i), `ataque de la sílaba ${i + 1}`);
      assert.ok(g.dstStart < g.dstVowelStart, "la consonante va antes del tiempo");
      assert.ok(g.dstVowelStart - g.dstStart <= 0.06 + 1e-9);
      assert.ok(
        near(pitchAt(g.pitch, g.dstVowelStart), [60, 62, 64, 65][i]),
        "la vocal ataca en su nota",
      );
    });
    // La vocal de cada sílaba se estira hasta que entra la consonante de la siguiente; la última, hasta su final.
    assert.ok(near(segments[0].dstEnd, segments[1].dstStart));
    assert.ok(near(segments[3].dstEnd, 2.5));
    assert.equal(segments[2].syllable, "y al");
  });

  it("semitonos: toda la curva se corre", () => {
    const p = phrase4();
    const { segments } = planGuide({
      phrase: p,
      phraseIdx: 0,
      spans: SPANS,
      slots: [],
      mode: "respetar",
      pitch: "notas",
      semitones: -3,
    });
    assert.ok(near(pitchAt(segments[0].pitch, 0.6), 57));
  });

  it("un melisma lleva varios objetivos con glissando de 30 ms que llega en el ataque", () => {
    const s: SungSyllable[] = [
      syl({ text: "la", start: 0, end: 0.4, midi: 60, noteIdx: [0], word: 0 }),
      syl({
        text: "ah",
        start: 0.4,
        end: 1.6,
        filler: true,
        melisma: true,
        midi: 64,
        noteIdx: [1, 2, 3],
        word: 1,
        parts: [
          { midi: 64, start: 0.4, end: 0.8 },
          { midi: 67, start: 0.8, end: 1.2 },
          { midi: 65, start: 1.2, end: 1.6 },
        ],
      }),
    ];
    const p: Phrase = {
      idx: 0,
      start: 0,
      end: 1.6,
      text: "la ah",
      syllables: s,
      mold: phraseMold(
        {
          idx: 0,
          start: 0,
          end: 1.6,
          text: "",
          syllables: s,
          mold: { syllables: 0, stresses: [], ending: "llana", melismas: [], long: [] },
        },
        "respetar",
      ),
    };
    const spans = alignSyllables(["la", "sol"], fakeAlignment("la sol")) as SyllableSpan[];
    const { segments } = planGuide({
      phrase: p,
      phraseIdx: 0,
      spans,
      slots: moldSlots(p, "respetar"),
      mode: "respetar",
      pitch: "notas",
    });
    const mel = segments[1];
    assert.ok(near(pitchAt(mel.pitch, 0.6), 64, 0.3));
    assert.ok(near(pitchAt(mel.pitch, 0.8), 67), "llega a la 2ª nota en su ataque");
    const mid = pitchAt(mel.pitch, 0.785);
    assert.ok(mid > 64.5 && mid < 66.5, `a mitad del glissando va entre las dos (${mid})`);
    assert.ok(near(pitchAt(mel.pitch, 0.765), 64, 0.3), "30 ms antes todavía está en la 1ª");
    assert.ok(near(pitchAt(mel.pitch, 1.2), 65));
  });

  it('"notas": vibrato de 5,5 Hz ±25 c solo en notas de 0,35 s o más', () => {
    const p = phrase4();
    const { segments } = planGuide({
      phrase: p,
      phraseIdx: 0,
      spans: SPANS,
      slots: [],
      mode: "respetar",
      pitch: "notas",
    });
    const g = segments[3]; // 0,5 s: con vibrato
    let lo = Infinity;
    let hi = -Infinity;
    for (let t = g.dstVowelStart; t <= g.dstEnd; t += 0.005) {
      const m = pitchAt(g.pitch, t);
      lo = Math.min(lo, m);
      hi = Math.max(hi, m);
    }
    assert.ok(hi - 65 <= 0.25 + 1e-6 && 65 - lo <= 0.25 + 1e-6, "nunca pasa de ±25 c");
    assert.ok(hi - lo > 0.2, "pero vibra");
    // Una nota corta (0,3 s) queda limpia.
    const short = phrase4();
    short.syllables = short.syllables.map((s) => ({ ...s, end: s.start + 0.3 }));
    const { segments: sg } = planGuide({
      phrase: short,
      phraseIdx: 0,
      spans: SPANS,
      slots: [],
      mode: "respetar",
      pitch: "notas",
    });
    assert.ok(sg[3].pitch.every((x) => near(x.midi, 65)));
  });

  it('"tarareo": sigue el contorno f0 real (+semitonos) y rellena los huecos sin voz', () => {
    const p = phrase4();
    const hop = 0.01;
    const f0 = Array.from({ length: 300 }, (_, k) => (k >= 160 && k < 170 ? null : 61.3));
    const { segments, warnings } = planGuide({
      phrase: p,
      phraseIdx: 0,
      spans: SPANS,
      slots: [],
      mode: "respetar",
      pitch: "tarareo",
      f0,
      hop,
      semitones: 1,
    });
    assert.deepEqual(warnings, []);
    for (const g of segments) assert.ok(g.pitch.every((x) => near(x.midi, 62.3, 1e-6)));
    // Sin contorno, canta las notas y lo avisa.
    const none = planGuide({
      phrase: p,
      phraseIdx: 0,
      spans: SPANS,
      slots: [],
      mode: "respetar",
      pitch: "tarareo",
    });
    assert.ok(near(pitchAt(none.segments[1].pitch, 1.05), 62));
    assert.match(none.warnings.join(" "), /no hay contorno del tarareo/);
  });

  it("sobran sílabas: se comprimen en la última posición; faltan: la última se sostiene", () => {
    const p = phrase4();
    const five = alignSyllables(
      ["can", "ción", "y al", "ma", "sí"],
      fakeAlignment("Canción y alma sí"),
    ) as SyllableSpan[];
    const over = planGuide({
      phrase: p,
      phraseIdx: 0,
      spans: five,
      slots: [],
      mode: "respetar",
      pitch: "notas",
    });
    assert.equal(over.segments.length, 5);
    assert.ok(
      near(over.segments[3].dstVowelStart, 2.0) && near(over.segments[4].dstVowelStart, 2.25),
    );
    assert.ok(near(over.segments[4].dstEnd, 2.5));
    assert.match(over.warnings[0], /sobra 1 sílaba/);

    const three = alignSyllables(
      ["can", "ción", "sol"],
      fakeAlignment("Canción sol"),
    ) as SyllableSpan[];
    const under = planGuide({
      phrase: p,
      phraseIdx: 0,
      spans: three,
      slots: [],
      mode: "respetar",
      pitch: "notas",
    });
    assert.equal(under.segments.length, 3);
    const last = under.segments[2];
    assert.ok(near(last.dstVowelStart, 1.5) && near(last.dstEnd, 2.5));
    // Sostiene la melodía de las posiciones que cubre: 64 y después 65.
    assert.ok(near(pitchAt(last.pitch, 1.7), 64, 0.3) && near(pitchAt(last.pitch, 2.3), 65, 0.3));
    assert.match(
      under.warnings[0],
      /falta 1 sílaba: «sol» se sostiene sobre las 2 últimas posiciones/,
    );
  });

  it("una sílaba sin altura estable toma la de su vecina", () => {
    const p = phrase4();
    p.syllables[1] = { ...p.syllables[1], midi: null };
    const { segments } = planGuide({
      phrase: p,
      phraseIdx: 0,
      spans: SPANS,
      slots: [],
      mode: "respetar",
      pitch: "notas",
    });
    const m = pitchAt(segments[1].pitch, 1.05);
    assert.ok(near(m, 60) || near(m, 64), `vecina (${m})`);
  });
});
