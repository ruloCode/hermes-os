import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hzToMidi, renderSung, trackPitch, type GuideSegment } from "@hermes/shared";

/**
 * FASE D — PSOLA: llevar una vocal del TTS a otra altura y otra duración. La
 * "voz" es SINTÉTICA (tren de pulsos por dos resonancias, como una vocal): no
 * hay audio grabado en el repo.
 */

const SR = 24000;

/** Vocal sintética: pulsos a `hz` que excitan dos resonancias amortiguadas (F1 700 Hz, F2 1200 Hz). */
function vowel(hz: number, dur: number, sr = SR): Float32Array {
  const n = Math.round(dur * sr);
  const out = new Float32Array(n);
  const period = sr / hz;
  const tail = Math.round(0.012 * sr);
  for (let p = 0; p < n; p += period) {
    const p0 = Math.floor(p);
    for (let k = 0; k < tail && p0 + k < n; k++) {
      const t = k / sr;
      out[p0 + k] +=
        Math.exp(-t / 0.003) * Math.sin(2 * Math.PI * 700 * t) +
        0.5 * Math.exp(-t / 0.002) * Math.sin(2 * Math.PI * 1200 * t);
    }
  }
  let mx = 0;
  for (const v of out) mx = Math.max(mx, Math.abs(v));
  for (let i = 0; i < n; i++) out[i] = (0.5 * out[i]) / mx;
  return out;
}

/** Mediana de la altura (MIDI) de [a, b] s y la fracción de cuadros con voz. */
function measure(pcm: Float32Array, a: number, b: number): { midi: number; voiced: number } {
  const tr = trackPitch(pcm.slice(Math.round(a * SR), Math.round(b * SR)), SR);
  const v = Array.from(tr.midi)
    .filter(Number.isFinite)
    .sort((x, y) => x - y);
  return { midi: v.length ? v[v.length >> 1] : NaN, voiced: v.length / tr.midi.length };
}

const seg = (
  o: Partial<GuideSegment> &
    Pick<GuideSegment, "src" | "dstStart" | "dstVowelStart" | "dstEnd" | "pitch">,
): GuideSegment => ({
  phrase: 0,
  syllable: "a",
  ...o,
});

describe("renderSung (PSOLA)", () => {
  it("lleva una vocal de 200 Hz a 300 Hz (±20 c)", () => {
    const src = vowel(200, 0.6);
    const target = hzToMidi(300);
    const out = renderSung(
      src,
      SR,
      [
        seg({
          src: { syllable: "a", start: 0, vowelStart: 0, end: 0.6 },
          dstStart: 0.1,
          dstVowelStart: 0.1,
          dstEnd: 0.7,
          pitch: [
            { t: 0.1, midi: target },
            { t: 0.7, midi: target },
          ],
        }),
      ],
      { outDurSec: 0.8 },
    );
    assert.equal(out.length, Math.round(0.8 * SR));
    const m = measure(out, 0.2, 0.6);
    assert.ok(
      Math.abs(m.midi - target) <= 0.2,
      `altura ${m.midi.toFixed(3)} vs ${target.toFixed(3)}`,
    );
    assert.ok(m.voiced > 0.9);
  });

  it("estirar ×4 conserva la altura (y la vocal suena todo el tramo)", () => {
    const src = vowel(200, 0.25);
    const target = hzToMidi(200);
    const out = renderSung(
      src,
      SR,
      [
        seg({
          src: { syllable: "a", start: 0, vowelStart: 0, end: 0.25 },
          dstStart: 0.05,
          dstVowelStart: 0.05,
          dstEnd: 1.05,
          pitch: [
            { t: 0.05, midi: target },
            { t: 1.05, midi: target },
          ],
        }),
      ],
      { outDurSec: 1.2 },
    );
    const m = measure(out, 0.15, 0.95);
    assert.ok(
      Math.abs(m.midi - target) <= 0.2,
      `altura ${m.midi.toFixed(3)} vs ${target.toFixed(3)}`,
    );
    assert.ok(m.voiced > 0.9, `con voz ${m.voiced}`);
  });

  it("sin curva de altura conserva la del TTS; silencio entre sílabas y fuera de ellas", () => {
    const src = vowel(180, 0.5);
    const out = renderSung(
      src,
      SR,
      [
        seg({
          src: { syllable: "a", start: 0, vowelStart: 0, end: 0.2 },
          dstStart: 0.1,
          dstVowelStart: 0.1,
          dstEnd: 0.4,
          pitch: [],
        }),
        seg({
          src: { syllable: "a", start: 0.25, vowelStart: 0.25, end: 0.45 },
          dstStart: 0.7,
          dstVowelStart: 0.7,
          dstEnd: 1.0,
          pitch: [],
        }),
      ],
      { outDurSec: 1.2 },
    );
    const m = measure(out, 0.15, 0.35);
    assert.ok(Math.abs(m.midi - hzToMidi(180)) <= 0.2);
    const quiet = (a: number, b: number) => {
      let mx = 0;
      for (let i = Math.round(a * SR); i < Math.round(b * SR); i++)
        mx = Math.max(mx, Math.abs(out[i]));
      return mx;
    };
    assert.ok(quiet(0, 0.099) < 1e-6, "antes de la primera sílaba");
    assert.ok(quiet(0.401, 0.699) < 1e-6, "entre sílabas");
    assert.ok(quiet(1.001, 1.2) < 1e-6, "después de la última");
  });

  it("la consonante (sin voz) se copia tal cual justo antes del ataque, y nunca satura", () => {
    // 60 ms de ruido determinista + la vocal: la cola de la consonante entra en [0,46; 0,5).
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    const noise = Float32Array.from({ length: Math.round(0.06 * SR) }, () => 0.2 * rnd());
    const v = vowel(200, 0.3);
    const src = new Float32Array(noise.length + v.length);
    src.set(noise, 0);
    src.set(v, noise.length);
    const out = renderSung(
      src,
      SR,
      [
        seg({
          src: { syllable: "sa", start: 0, vowelStart: 0.06, end: 0.36 },
          dstStart: 0.46,
          dstVowelStart: 0.5,
          dstEnd: 0.9,
          pitch: [{ t: 0.5, midi: hzToMidi(250) }],
        }),
      ],
      { outDurSec: 1 },
    );
    // Dentro de la consonante (pasado el fundido de entrada) la muestra es la del TTS: velocidad 1.
    const at = Math.round(0.48 * SR);
    const srcAt =
      Math.round(0.06 * SR) -
      Math.round(0.04 * SR) +
      (at - (Math.round(0.5 * SR) - Math.round(0.04 * SR)));
    assert.ok(Math.abs(out[at] - src[srcAt]) < 1e-6);
    let before = 0;
    for (let i = 0; i < Math.round(0.459 * SR); i++) before = Math.max(before, Math.abs(out[i]));
    assert.ok(before < 1e-6, "nada antes de la consonante");
    let peak = 0;
    for (const x of out) peak = Math.max(peak, Math.abs(x));
    assert.ok(peak <= 0.99 + 1e-6);
  });
});
