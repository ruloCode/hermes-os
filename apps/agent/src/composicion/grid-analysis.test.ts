import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  analyzeOnGrid,
  applyHint,
  buildPhrases,
  chordAt,
  chordToneOf,
  classifyRole,
  describeGridPhrase,
  dynamicOf,
  intervalName,
  noteVelocities,
  scaleDegreeOf,
  segmentNotes,
  syllablesFromTrack,
  syllablesOnGrid,
  trackPitch,
  type ChordBar,
  type GridPhraseStats,
  type Key,
  type MelodyNote,
  type PitchTrack,
  type TakeGrid,
} from "@hermes/shared";
import { SR, midiToHz, note } from "./test-helpers.js";

/**
 * La toma leída en la REJILLA: sílabas sin texto (hueco, valle, legato =
 * melisma), la pista de texto, armonía (acorde que suena, función, grado,
 * rol), dinámica relativa a la toma y la toma entera en compás/paso con su
 * lectura en números. Tomas SINTÉTICAS: notas y energía armadas a mano (o
 * senos por `trackPitch`); nada sale de una sesión grabada.
 */

const HOP = 0.01;
const A_MINOR: Key = { tonic: 9, mode: "minor" };
const C_MAJOR: Key = { tonic: 0, mode: "major" };
const LOOP: ChordBar[] = ["Am", "F", "C", "G"].map((symbol) => ({ chords: [{ symbol, beat: 0 }] }));

/**
 * PitchTrack a mano: voz (f0 > 0) y `levelDb` dentro de cada nota, silencio
 * (−60 dB, sin voz) fuera. `voicedGaps` pone voz también entre notas (un
 * portamento: el hueco existe en las notas pero no en la voz).
 */
function handTrack(
  notes: MelodyNote[],
  opts: { levelDb?: (i: number) => number; voicedGaps?: boolean; tail?: number } = {},
): PitchTrack {
  const end = Math.max(...notes.map((n) => n.end)) + (opts.tail ?? 0.5);
  const n = Math.round(end / HOP) + 1;
  const f0 = new Float32Array(n);
  const midi = new Float32Array(n).fill(NaN);
  const rmsDb = new Float32Array(n).fill(-60);
  const fr = (t: number): number => Math.round(t / HOP);
  notes.forEach((nt, i) => {
    for (let k = fr(nt.start); k < fr(nt.end) && k < n; k++) {
      f0[k] = midiToHz(nt.midi);
      midi[k] = nt.midi;
      rmsDb[k] = opts.levelDb?.(i) ?? -10;
    }
  });
  if (opts.voicedGaps)
    for (let i = 1; i < notes.length; i++)
      for (let k = fr(notes[i - 1].end); k < fr(notes[i].start); k++) {
        f0[k] = midiToHz(notes[i].midi);
        rmsDb[k] = opts.levelDb?.(i) ?? -10;
      }
  return { sr: 16000, hop: 160, hopSec: HOP, f0, midi, rmsDb };
}

describe("syllablesFromTrack", () => {
  it("deslizamiento sin valle (legato con otra altura) = 1 sílaba con melisma", () => {
    const notes = [note(60, 0, 0.3), note(62, 0.3, 0.6)];
    const syl = syllablesFromTrack(handTrack(notes), notes);
    assert.equal(syl.length, 1);
    assert.equal(syl[0].melisma, true);
    assert.deepEqual(syl[0].noteIdx, [0, 1]);
    assert.deepEqual(syl[0].parts?.map((p) => p.midi), [60, 62]);
    assert.equal(syl[0].text, "");
    assert.equal(syl[0].filler, true);
  });

  it("un valle de 8 dB en el ataque = 2 sílabas; uno de 4 dB no alcanza", () => {
    const notes = [note(60, 0, 0.3), note(62, 0.3, 0.6)];
    const dipped = (db: number): PitchTrack => {
      const tr = handTrack(notes);
      for (let k = 29; k <= 31; k++) tr.rmsDb[k] = -10 - db;
      return tr;
    };
    const two = syllablesFromTrack(dipped(8), notes);
    assert.equal(two.length, 2);
    assert.ok(two.every((s) => !s.melisma));
    assert.equal(syllablesFromTrack(dipped(4), notes).length, 1);
  });

  it("un hueco sin voz de ≥ 40 ms = 2 sílabas; el mismo hueco CON voz (portamento) sigue siendo legato", () => {
    const notes = [note(60, 0, 0.3), note(62, 0.36, 0.6)];
    assert.equal(syllablesFromTrack(handTrack(notes), notes).length, 2);
    const glide = syllablesFromTrack(handTrack(notes, { voicedGaps: true }), notes);
    assert.equal(glide.length, 1);
    assert.equal(glide[0].melisma, true);
  });

  it("de punta a punta con trackPitch: un portamento de 40 ms entre Do y Mi es UNA sílaba con melisma", () => {
    // Seno con armónicos; el portamento deja un tramo con voz que segmentNotes descarta.
    const dur = 0.8;
    const pcm = new Float32Array(Math.round(dur * SR));
    let ph = 0;
    for (let i = 0; i < pcm.length; i++) {
      const t = i / SR;
      const m = t < 0.4 ? 60 : t < 0.44 ? 60 + (4 * (t - 0.4)) / 0.04 : 64;
      ph += (2 * Math.PI * midiToHz(m)) / SR;
      pcm[i] = (0.5 * (Math.sin(ph) + 0.5 * Math.sin(2 * ph) + 0.25 * Math.sin(3 * ph))) / 1.75;
    }
    const tr = trackPitch(pcm, SR);
    const notes = segmentNotes(tr);
    assert.deepEqual(notes.map((n) => n.midi), [60, 64]);
    const syl = syllablesFromTrack(tr, notes);
    assert.equal(syl.length, 1);
    assert.equal(syl[0].melisma, true);
  });

  it("acentos de relleno: el primero del grupo, las notas largas y lo que entra tras una nota larga", () => {
    const notes = [note(60, 0, 0.2), note(62, 0.3, 0.5), note(64, 0.6, 1.4), note(62, 1.5, 1.7), note(60, 1.8, 2.0)];
    const syl = syllablesFromTrack(handTrack(notes), notes);
    assert.deepEqual(syl.map((s) => s.stressed), [true, false, true, true, false]);
  });

  it("sin notas, sin sílabas", () => {
    assert.deepEqual(syllablesFromTrack(handTrack([note(60, 0, 0.2)]), []), []);
  });
});

describe("applyHint", () => {
  const four = (): ReturnType<typeof syllablesFromTrack> => {
    const notes = [note(60, 0, 0.2), note(62, 0.3, 0.5), note(64, 0.6, 0.8), note(62, 0.9, 1.1)];
    return syllablesFromTrack(handTrack(notes), notes);
  };

  it("mismo conteo: 1:1, con la vocal del texto", () => {
    const out = applyHint(four(), "na na uh dun");
    assert.deepEqual(out.map((s) => s.text), ["na", "na", "uh", "dun"]);
    assert.deepEqual(out.map((s) => s.vowel), ["a", "a", "u", "u"]);
    assert.ok(out.every((s) => s.vowelSource === "texto" && s.filler));
  });

  it("los rellenos pegados se parten por unidad y comparten palabra", () => {
    const three = four().slice(0, 3);
    const out = applyHint(three, "nanana");
    assert.deepEqual(out.map((s) => s.text), ["na", "na", "na"]);
    assert.deepEqual(out.map((s) => s.word), [0, 0, 0]);
  });

  it("conteo distinto: por proporción", () => {
    const notes = Array.from({ length: 6 }, (_, i) => note(60, i * 0.3, i * 0.3 + 0.2));
    const out = applyHint(syllablesFromTrack(handTrack(notes), notes), "na uh");
    assert.deepEqual(out.map((s) => s.text), ["na", "na", "na", "uh", "uh", "uh"]);
  });

  it("palabras reales: se silabean, no son relleno y llevan su acento léxico", () => {
    const out = applyHint(four().slice(0, 3), "te quiero");
    assert.deepEqual(out.map((s) => s.text), ["te", "quie", "ro"]);
    assert.ok(out.every((s) => !s.filler));
    assert.deepEqual(out.map((s) => s.stressed), [false, true, false]);
    assert.deepEqual(out.map((s) => s.vowel), ["e", "e", "o"]);
  });

  it("pista vacía: copia sin tocar", () => {
    const s = four();
    assert.deepEqual(applyHint(s, "  "), s);
  });
});

describe("armonía", () => {
  it("chordAt: el acorde de cada compás, por módulo, y el anterior sigue si el compás aún no cambió", () => {
    assert.equal(chordAt(LOOP, 0, "4/4"), "Am");
    assert.equal(chordAt(LOOP, 17, "4/4"), "F");
    assert.equal(chordAt(LOOP, 64, "4/4"), "Am");
    assert.equal(chordAt(LOOP, -2, "4/4"), "G"); // la anacrusa cae sobre el final del loop
    const split: ChordBar[] = [{ chords: [{ symbol: "Am", beat: 0 }, { symbol: "G", beat: 2 }] }, { chords: [{ symbol: "F", beat: 1 }] }];
    assert.equal(chordAt(split, 7, "4/4"), "Am");
    assert.equal(chordAt(split, 8, "4/4"), "G");
    assert.equal(chordAt(split, 16 + 2, "4/4"), "G"); // el F entra en el tiempo 2
    assert.equal(chordAt(split, 16 + 4, "4/4"), "F");
    assert.equal(chordAt([], 0, "4/4"), null);
  });

  it("chordToneOf: función en el acorde o null", () => {
    assert.equal(chordToneOf(60, "Am"), "3");
    assert.equal(chordToneOf(57, "Am"), "R");
    assert.equal(chordToneOf(76, "Am"), "5");
    assert.equal(chordToneOf(67, "Am"), null);
    assert.equal(chordToneOf(67, "Am7"), "7");
    assert.equal(chordToneOf(62, "Cadd9"), "9");
    assert.equal(chordToneOf(65, "Csus4"), "11");
    assert.equal(chordToneOf(60, "Xm9#"), null);
  });

  it("scaleDegreeOf: grado en la escala de la tonalidad, sin importar la octava", () => {
    assert.equal(scaleDegreeOf(60, A_MINOR), "3");
    assert.equal(scaleDegreeOf(68, A_MINOR), "♯7");
    assert.equal(scaleDegreeOf(69 + 24, A_MINOR), "1");
    assert.equal(scaleDegreeOf(66, C_MAJOR), "♯4");
    assert.equal(scaleDegreeOf(63, C_MAJOR), "♭3");
    assert.equal(scaleDegreeOf(70, C_MAJOR), "♭7");
  });

  const role = (p: Partial<Parameters<typeof classifyRole>[0]> & { midi: number }) =>
    classifyRole({ prevMidi: null, nextMidi: null, chord: "C", nextChord: null, weight: 2, key: C_MAJOR, ...p });

  it("classifyRole: Do sobre Am = acorde", () => {
    assert.equal(role({ midi: 60, chord: "Am", key: A_MINOR }), "acorde");
  });

  it("classifyRole: Re entre Do y Mi = paso", () => {
    assert.equal(role({ prevMidi: 60, midi: 62, nextMidi: 64, chord: "Am", key: A_MINOR, weight: 1 }), "paso");
  });

  it("classifyRole: Si-Do-Si = bordadura", () => {
    assert.equal(role({ prevMidi: 59, midi: 60, nextMidi: 59, chord: "G" }), "bordadura");
  });

  it("classifyRole: Fa♯ en Do mayor = fuera", () => {
    assert.equal(role({ midi: 66 }), "fuera");
  });

  it("classifyRole: apoyatura (fuerte que resuelve por grado) y anticipación (débil, ya del acorde siguiente)", () => {
    // Fa en el 1 al que se llega por salto y resuelve bajando a Mi (sobre Do).
    assert.equal(role({ prevMidi: 60, midi: 65, nextMidi: 64, weight: 4 }), "apoyatura");
    // La misma bajada Sol-Fa-Mi por grado es paso: la primera regla que calza manda.
    assert.equal(role({ prevMidi: 67, midi: 65, nextMidi: 64, weight: 4 }), "paso");
    assert.equal(role({ prevMidi: 60, midi: 65, nextMidi: 72, weight: 1, nextChord: "F" }), "anticipacion");
    assert.equal(role({ prevMidi: 64, midi: 69, nextMidi: 72, weight: 2 }), "tension");
  });
});

describe("dinámica", () => {
  const five = [0, 1, 2, 3, 4].map((i) => note(60, i * 0.5, i * 0.5 + 0.4));

  it("velocidades monótonas con la energía de cada nota, de 5 a 95", () => {
    const tr = handTrack(five, { levelDb: (i) => -30 + 6 * i });
    const v = noteVelocities(five, tr.rmsDb, tr.hopSec);
    for (let i = 1; i < v.length; i++) assert.ok(v[i] > v[i - 1], `${v}`);
    assert.equal(v[0], 5);
    assert.equal(v[4], 95);
  });

  it("una toma de nivel parejo es toda mf (el ruido de 1 dB no se estira a pp→ff)", () => {
    const tr = handTrack(five, { levelDb: (i) => -10 + (i % 2) * 0.8 });
    const v = noteVelocities(five, tr.rmsDb, tr.hopSec);
    assert.ok(v.every((x) => dynamicOf(x) === "mf"), `${v}`);
  });

  it("una frase 12 dB más fuerte queda por encima del resto", () => {
    const ten = Array.from({ length: 10 }, (_, i) => note(60, i * 0.5, i * 0.5 + 0.4));
    const tr = handTrack(ten, { levelDb: (i) => (i >= 5 ? -8 : -20) });
    const v = noteVelocities(ten, tr.rmsDb, tr.hopSec);
    assert.ok(Math.min(...v.slice(5)) > Math.max(...v.slice(0, 5)), `${v}`);
  });

  it("6 dB de diferencia no se leen como pp→ff (ventana mínima de 12 dB)", () => {
    const ten = Array.from({ length: 10 }, (_, i) => note(60, i * 0.5, i * 0.5 + 0.4));
    const tr = handTrack(ten, { levelDb: (i) => (i >= 5 ? -14 : -20) });
    const v = noteVelocities(ten, tr.rmsDb, tr.hopSec);
    assert.ok(v[9] > v[0]);
    assert.notEqual(dynamicOf(v[0]), "pp");
    assert.notEqual(dynamicOf(v[9]), "ff");
  });

  it("de punta a punta (trackPitch + segmentNotes): toma pareja con ataques y caídas = mf; frase 12 dB arriba = más fuerte", () => {
    // Notas de 0,3 s con rampas de 30 ms y 80 ms de silencio: las rampas no son dinámica.
    const render = (gainDb: (i: number) => number): Float32Array => {
      const noteSec = 0.3;
      const gapSec = 0.08;
      const count = 8;
      const pcm = new Float32Array(Math.round(count * (noteSec + gapSec) * SR));
      let ph = 0;
      for (let i = 0; i < count; i++) {
        const a = 10 ** (gainDb(i) / 20) * 0.4;
        const off = Math.round(i * (noteSec + gapSec) * SR);
        for (let j = 0; j < noteSec * SR; j++) {
          const t = j / SR;
          const env = Math.min(1, t / 0.03, (noteSec - t) / 0.03);
          ph += (2 * Math.PI * midiToHz(60 + (i % 3) * 2)) / SR;
          pcm[off + j] = a * env * (Math.sin(ph) + 0.4 * Math.sin(2 * ph));
        }
      }
      return pcm;
    };
    const even = trackPitch(render(() => 0), SR);
    const evenNotes = segmentNotes(even);
    assert.equal(evenNotes.length, 8);
    const ve = noteVelocities(evenNotes, even.rmsDb, even.hopSec);
    assert.ok(ve.every((x) => dynamicOf(x) === "mf"), `${ve}`);

    const loud = trackPitch(render((i) => (i >= 4 ? 0 : -12)), SR);
    const loudNotes = segmentNotes(loud);
    const vl = noteVelocities(loudNotes, loud.rmsDb, loud.hopSec);
    assert.ok(Math.min(...vl.slice(4)) > Math.max(...vl.slice(0, 4)), `${vl}`);
  });

  it("dynamicOf: umbrales de 17 en 17", () => {
    assert.deepEqual([0, 17, 34, 51, 68, 85, 100].map(dynamicOf), ["pp", "p", "mp", "mf", "f", "ff", "ff"]);
  });
});

describe("analyzeOnGrid", () => {
  // 90 bpm, 4/4: una semicorchea = 1/6 s. El primer tiempo real está en 0,5 s
  // y la voz entra 8 ms tarde en todas las notas.
  const BPM = 90;
  const SPS = 60 / BPM / 4;
  const DOWNBEAT = 0.5;
  const LATE = 0.008;
  // [paso absoluto, largo en semicorcheas, MIDI, pegada a la siguiente (legato)]
  const SPEC: [number, number, number, boolean][] = [
    [-2, 2, 64, false], // anacrusa: Mi sobre el final del loop (G) → anticipa el Am
    [0, 4, 69, false], // La, fundamental de Am, en el 1
    [4, 2, 71, false], // Si, paso entre La y Do
    [6, 2, 72, false], // Do, 3ª de Am
    [8, 4, 76, true], // Mi (5ª) ligada a…
    [12, 4, 74, false], // …Re: melisma sobre una sílaba
    [44, 2, 67, false], // frase 2 (tras 4 s): Sol, 5ª de C
    [46, 3, 69, false], // La a contratiempo que se sostiene sobre el 1 → síncopa; Sol-La-Si = paso
    [49, 3, 71, false], // Si, 3ª de G
    [52, 4, 74, false], // Re, 5ª de G, cierra en tiempo débil
  ];
  const notes: MelodyNote[] = SPEC.map(([step, len, midi, legato]) => {
    const start = DOWNBEAT + step * SPS + LATE;
    return note(midi, start, start + len * SPS - (legato ? 0 : 0.05));
  });
  const grid = (downbeatSec = DOWNBEAT): TakeGrid => ({
    bpm: BPM,
    meter: "4/4",
    key: A_MINOR,
    downbeatSec,
    loop: LOOP,
    bars: 4,
  });
  const run = (g: TakeGrid, hint?: string) => {
    const track = handTrack(notes);
    let syl = syllablesFromTrack(track, notes);
    if (hint) syl = applyHint(syl, hint);
    const phrases = buildPhrases(syl, notes);
    return { analysis: analyzeOnGrid({ notes, phrases, track, grid: g }), phrases };
  };

  it("cada nota en su compás.paso exacto, con la anacrusa en el compás 0", () => {
    const { analysis } = run(grid());
    assert.deepEqual(
      analysis.notes.map((n) => [n.bar, n.stepInBar]),
      [[0, 14], [1, 0], [1, 4], [1, 6], [1, 8], [1, 12], [3, 12], [3, 14], [4, 1], [4, 4]],
    );
    assert.deepEqual(analysis.notes.map((n) => n.absStep), SPEC.map((s) => s[0]));
    assert.deepEqual(analysis.notes.map((n) => n.len16), SPEC.map((s) => s[1]));
    assert.ok(analysis.notes.every((n) => n.offMs === 8));
    assert.deepEqual(analysis.notes.map((n) => n.weight), [1, 4, 2, 1, 3, 2, 2, 1, 0, 2]);
  });

  it("armonía por nota: acorde que suena, función, grado y rol", () => {
    const { analysis } = run(grid());
    const n = analysis.notes;
    assert.deepEqual(n.map((x) => x.chord), ["G", "Am", "Am", "Am", "Am", "Am", "C", "C", "G", "G"]);
    assert.deepEqual(n.map((x) => x.chordTone), [null, "R", null, "3", "5", null, "5", null, "3", "5"]);
    assert.deepEqual(n.map((x) => x.degree), ["5", "1", "2", "3", "5", "4", "7", "1", "2", "4"]);
    assert.deepEqual(n.map((x) => x.role), [
      "anticipacion",
      "acorde",
      "paso",
      "acorde",
      "acorde",
      "tension",
      "acorde",
      "paso",
      "acorde",
      "acorde",
    ]);
    assert.deepEqual(n.map((x) => x.syncopated), [false, false, false, false, false, false, false, true, false, false]);
    assert.deepEqual(n.map((x) => x.interval), [null, 5, 2, 1, 4, -2, null, 2, 2, 3]);
    assert.ok(n.every((x) => x.dynamic === "mf"), "toma pareja → mf");
  });

  it("por frase: anacrusa, largo, sílabas, melisma, ámbito, contorno y final", () => {
    const { analysis } = run(grid());
    assert.equal(analysis.phrases.length, 2);
    const [p1, p2] = analysis.phrases;
    assert.deepEqual([p1.startBar, p1.pickup16, p1.lenBars], [1, 2, 1.25]);
    assert.equal(p1.syllablesPerBar, 4); // 5 sílabas (una con melisma) en 1,25 compases
    assert.equal(p1.melismaPct, 20);
    assert.deepEqual(p1.range, { lo: 64, hi: 76 });
    assert.equal(p1.contour, "arco");
    assert.deepEqual(p1.endsOn, { degree: "4", chordTone: null, weight: 2 });
    assert.equal(p1.strongChordTonePct, 100);
    assert.equal(p1.syncopationPct, 0);
    assert.deepEqual([p2.startBar, p2.pickup16, p2.lenBars], [4, 4, 0.75]);
    assert.equal(p2.contour, "asc");
    assert.equal(p2.syncopationPct, 25);
    assert.deepEqual(p2.endsOn, { degree: "4", chordTone: "5", weight: 2 });
  });

  it("la lectura en números, en español y con coma decimal", () => {
    const { analysis } = run(grid(), "na na na na uh na na na na");
    assert.equal(analysis.readout.length, 2);
    const r = analysis.readout[0];
    assert.match(r, /^anacrusa de 2\/16 · 5 sílabas en 1,25 compases · 1 melisma \(2 notas, sobre u\)/);
    assert.match(r, /termina en el grado 4 \(fuera del acorde\) en tiempo débil/);
    assert.match(r, /100 % notas del acorde en tiempos fuertes · síncopa 0 % · ámbito octava · contorno en arco · mf$/);
    assert.match(analysis.readout[1], /^anacrusa de 4\/16 · 4 sílabas en 0,75 compases · sin melismas/);
    assert.match(analysis.readout[1], /termina en la 5ª del acorde en tiempo débil/);
    // La vocal del texto llega a las notas del melisma.
    assert.deepEqual([analysis.notes[4].vowel, analysis.notes[5].vowel], ["u", "u"]);
  });

  it("rejilla bien puesta: desvío mediano chico y sin sugerencia", () => {
    const { analysis } = run(grid());
    assert.equal(analysis.medianOffMs, 8);
    assert.equal(analysis.suggestShiftMs, null);
  });

  it("rejilla corrida: sugiere cuánto moverla, con signo", () => {
    // Latencia sobre-compensada 80 ms: la rejilla cae tarde y la voz se lee adelantada.
    const late = run(grid(DOWNBEAT + 0.08)).analysis;
    assert.equal(late.medianOffMs, -72);
    assert.ok(late.suggestShiftMs != null && Math.abs(late.suggestShiftMs - -72) <= 5, `${late.suggestShiftMs}`);
    const early = run(grid(DOWNBEAT - 0.03)).analysis;
    assert.ok(early.suggestShiftMs != null && Math.abs(early.suggestShiftMs - 38) <= 5, `${early.suggestShiftMs}`);
  });

  it("syllablesOnGrid: cada sílaba con su paso y peso", () => {
    const { phrases } = run(grid());
    const syl = syllablesOnGrid(phrases[0].syllables, grid());
    assert.deepEqual(syl.map((s) => s.metric?.absStep), [-2, 0, 4, 6, 8]);
    assert.deepEqual(syl.map((s) => s.metric?.weight), [1, 4, 2, 1, 3]);
  });
});

describe("describeGridPhrase", () => {
  it("una frase en números con el formato de la casa", () => {
    const stats: GridPhraseStats = {
      idx: 0,
      startBar: 1,
      pickup16: 2,
      lenBars: 1.5,
      syllablesPerBar: 4.67,
      melismaPct: 29,
      range: { lo: 60, hi: 70 },
      contour: "arco",
      endsOn: { degree: "3", chordTone: "3", weight: 3 },
      syncopationPct: 38,
      strongChordTonePct: 71,
    };
    assert.equal(
      describeGridPhrase(stats, "4/4"),
      "anacrusa de 2/16 · 7 sílabas en 1,5 compases · 2 melismas · termina en la 3ª del acorde en tiempo fuerte · " +
        "71 % notas del acorde en tiempos fuertes · síncopa 38 % · ámbito 7ª menor · contorno en arco",
    );
  });

  it("entra en el tiempo, un compás, singular y en 6/8 el segundo pulso", () => {
    const stats: GridPhraseStats = {
      idx: 1,
      startBar: 2,
      pickup16: 0,
      lenBars: 1,
      syllablesPerBar: 1,
      melismaPct: 0,
      range: { lo: 62, hi: 62 },
      contour: "plano",
      endsOn: { degree: "1", chordTone: "R", weight: 3 },
      syncopationPct: 0,
      strongChordTonePct: 100,
    };
    const r = describeGridPhrase(stats, "6/8");
    assert.match(r, /^entra en el tiempo · 1 sílaba en 1 compás · sin melismas · termina en la fundamental del acorde en el segundo pulso/);
    assert.match(r, /ámbito unísono · contorno plano$/);
  });

  it("intervalName en español", () => {
    assert.deepEqual([0, 3, 7, 10, 12, 14, 30].map(intervalName), [
      "unísono",
      "3ª menor",
      "5ª justa",
      "7ª menor",
      "octava",
      "9ª mayor",
      "30 semitonos",
    ]);
  });
});
