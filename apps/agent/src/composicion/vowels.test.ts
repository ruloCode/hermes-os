import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { VOWEL_FORMANTS, estimateVowel, isOpenVowel, vowelOfText, vowelSimilarity, type Vowel } from "@hermes/shared";

/**
 * La VOCAL del fonema melódico: del texto del relleno (manda siempre) y, sin
 * texto, por formantes. Las vocales de prueba se SINTETIZAN (tren de pulsos a
 * f0 por resonadores de 2º orden en F1/F2/F3): no hay voz grabada en el repo.
 */

/**
 * Vocal sintética fuente-filtro: pulsos a `f0` con la caída de la fuente
 * glotal + radiación de los labios (≈ −6 dB/oct, un integrador con fuga) por
 * tres resonadores (Klatt) en cascada. Sin esa caída la fuente es plana, el
 * preénfasis de 0,97 la sobre-inclina y F1 se lee ~30 % alto: sería probar
 * contra una voz que no existe.
 */
function synthVowel(f1: number, f2: number, f0: number, sr: number, dur: number): Float32Array {
  const n = Math.round(sr * dur);
  let y: Float32Array = new Float32Array(n);
  const period = sr / f0;
  for (let next = 0; next < n; next += period) y[Math.floor(next)] = 1;
  const leak = Math.exp((-2 * Math.PI * 100) / sr);
  for (let i = 1; i < n; i++) y[i] += leak * y[i - 1];
  const resonate = (x: Float32Array, F: number, BW: number): Float32Array => {
    const C = -Math.exp((-2 * Math.PI * BW) / sr);
    const B = 2 * Math.exp((-Math.PI * BW) / sr) * Math.cos((2 * Math.PI * F) / sr);
    const A = 1 - B - C;
    const out = new Float32Array(x.length);
    for (let i = 0; i < x.length; i++) out[i] = A * x[i] + B * (i > 0 ? out[i - 1] : 0) + C * (i > 1 ? out[i - 2] : 0);
    return out;
  };
  y = resonate(resonate(resonate(y, f1, 80), f2, 100), 2600, 150);
  let mx = 0;
  for (const v of y) mx = Math.max(mx, Math.abs(v));
  for (let i = 0; i < n; i++) y[i] = (0.5 * y[i]) / mx;
  return y;
}

const OPEN = new Set<Vowel>(["a", "e", "o"]);

describe("vowelOfText", () => {
  it("rellenos del tarareo", () => {
    const cases: [string, Vowel][] = [
      ["na", "a"],
      ["nana", "a"],
      ["lalala", "a"],
      ["la", "a"],
      ["dun", "u"],
      ["uh", "u"],
      ["tu", "u"],
      ["pum", "u"],
      ["mm", "m"],
      ["hmm", "m"],
      ["yeah", "e"],
      ["ey", "e"],
      ["hey", "e"],
      ["oh", "o"],
      ["wo", "o"],
      ["uoh", "o"],
      ["ti", "i"],
      ["tin", "i"],
      ["¡Uuh!", "u"],
    ];
    for (const [t, v] of cases) assert.equal(vowelOfText(t), v, t);
  });

  it("sílabas y palabras: el núcleo de la sílaba tónica (qu muda, diptongos, tilde)", () => {
    const cases: [string, Vowel][] = [
      ["quie", "e"],
      ["corazón", "o"],
      ["amor", "o"],
      ["canción", "o"],
      ["noche", "o"],
      ["ciu", "u"],
      ["muy", "i"],
      ["hoy", "o"],
      ["y", "i"],
    ];
    for (const [t, v] of cases) assert.equal(vowelOfText(t), v, t);
  });

  it("varias palabras: manda la primera con vocal; sin vocal, null", () => {
    assert.equal(vowelOfText("brr na"), "a");
    assert.equal(vowelOfText("brr"), null);
    assert.equal(vowelOfText(""), null);
    assert.equal(vowelOfText("…"), null);
  });
});

describe("vowelSimilarity / isOpenVowel", () => {
  it("misma = 1, misma clase = 0,5, m con u/o = 0,25, resto 0", () => {
    assert.equal(vowelSimilarity("a", "a"), 1);
    assert.equal(vowelSimilarity("m", "m"), 1);
    assert.equal(vowelSimilarity("a", "o"), 0.5);
    assert.equal(vowelSimilarity("e", "a"), 0.5);
    assert.equal(vowelSimilarity("i", "u"), 0.5);
    assert.equal(vowelSimilarity("m", "u"), 0.25);
    assert.equal(vowelSimilarity("o", "m"), 0.25);
    assert.equal(vowelSimilarity("m", "a"), 0);
    assert.equal(vowelSimilarity("a", "i"), 0);
    assert.equal(vowelSimilarity("u", "e"), 0);
  });

  it("es simétrica", () => {
    const vs: Vowel[] = ["a", "e", "i", "o", "u", "m"];
    for (const a of vs) for (const b of vs) assert.equal(vowelSimilarity(a, b), vowelSimilarity(b, a));
  });

  it("abiertas: a, e, o", () => {
    assert.deepEqual(
      (["a", "e", "i", "o", "u", "m"] as Vowel[]).filter((v) => isOpenVowel(v)),
      ["a", "e", "o"],
    );
    assert.equal(isOpenVowel(null), false);
  });
});

describe("estimateVowel (formantes por LPC)", () => {
  it("a, i, u sintetizadas se clasifican bien (voz grave, 16 kHz)", () => {
    for (const v of ["a", "i", "u"] as const) {
      const [f1, f2] = VOWEL_FORMANTS[v];
      for (const f0 of [120, 150]) {
        const r = estimateVowel(synthVowel(f1, f2, f0, 16000, 0.4), 16000, 0, 0.4);
        assert.ok(r, `${v} @${f0}`);
        assert.equal(r.vowel, v, `${v} @${f0} → ${r.vowel} (F1 ${r.f1}, F2 ${r.f2})`);
      }
    }
  });

  it("e y o caen al menos en su clase (abiertas)", () => {
    for (const v of ["e", "o"] as const) {
      const [f1, f2] = VOWEL_FORMANTS[v];
      const r = estimateVowel(synthVowel(f1, f2, 140, 16000, 0.4), 16000, 0, 0.4);
      assert.ok(r && OPEN.has(r.vowel), `${v} → ${r?.vowel}`);
    }
  });

  it("mide F1/F2 cerca de los formantes reales y funciona a 48 kHz (diezma antes del LPC)", () => {
    const r = estimateVowel(synthVowel(750, 1300, 130, 48000, 0.4), 48000, 0, 0.4);
    assert.ok(r);
    assert.equal(r.vowel, "a");
    assert.ok(Math.abs(r.f1 - 750) / 750 < 0.15, `F1 ${r.f1}`);
    assert.ok(Math.abs(r.f2 - 1300) / 1300 < 0.1, `F2 ${r.f2}`);
  });

  it("solo mira el tramo pedido", () => {
    const sr = 16000;
    const a = synthVowel(750, 1300, 140, sr, 0.4);
    const i = synthVowel(300, 2300, 140, sr, 0.4);
    const both = new Float32Array(a.length + i.length);
    both.set(a, 0);
    both.set(i, a.length);
    assert.equal(estimateVowel(both, sr, 0, 0.4)?.vowel, "a");
    assert.equal(estimateVowel(both, sr, 0.4, 0.8)?.vowel, "i");
  });

  it("la confianza cae en agudos (f0 > 400 Hz): el texto manda", () => {
    const sr = 16000;
    const low = estimateVowel(synthVowel(750, 1300, 140, sr, 0.4), sr, 0, 0.4);
    const high = estimateVowel(synthVowel(750, 1300, 450, sr, 0.4), sr, 0, 0.4, 450);
    assert.ok(low && high);
    assert.ok(high.confidence <= 0.3, `agudo ${high.confidence}`);
    assert.ok(low.confidence > high.confidence);
  });

  it("null con un tramo demasiado corto o en silencio", () => {
    const sr = 16000;
    assert.equal(estimateVowel(synthVowel(750, 1300, 140, sr, 0.4), sr, 0, 0.02), null);
    assert.equal(estimateVowel(new Float32Array(sr), sr, 0, 1), null);
  });
});
