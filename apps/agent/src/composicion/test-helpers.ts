import type { MelodyNote, SungSyllable, TimedWord, TranscriptWord } from "@hermes/shared";

/**
 * Datos SINTÉTICOS para probar la melodía sin audio real: senos con armónicos,
 * silencios, notas y palabras inventadas. El repo es público: nada de aquí
 * sale de una sesión grabada.
 */

export const SR = 16000;

export const midiToHz = (m: number): number => 440 * 2 ** ((m - 69) / 12);

/** Tono de `dur` s; `hz` fijo o función del tiempo (vibrato). Fase integrada: sin clics. */
export function tone(
  hz: number | ((t: number) => number),
  dur: number,
  opts: { amp?: number; harmonics?: number[] } = {},
): Float32Array {
  const amp = opts.amp ?? 0.5;
  const harmonics = opts.harmonics ?? [1];
  const norm = harmonics.reduce((a, b) => a + b, 0);
  const n = Math.round(dur * SR);
  const out = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const f = typeof hz === "number" ? hz : hz(i / SR);
    ph += (2 * Math.PI * f) / SR;
    let v = 0;
    harmonics.forEach((a, k) => (v += a * Math.sin((k + 1) * ph)));
    out[i] = (amp * v) / norm;
  }
  return out;
}

export const silence = (dur: number): Float32Array => new Float32Array(Math.round(dur * SR));

export function concat(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((a, p) => a + p.length, 0));
  let k = 0;
  for (const p of parts) {
    out.set(p, k);
    k += p.length;
  }
  return out;
}

export const note = (midi: number, start: number, end: number): MelodyNote => ({ midi, start, end, cents: 0 });

export const words = (spec: [string, number, number][], speaker?: string): TimedWord[] =>
  spec.map(([text, start, end]) => ({ text, start, end, ...(speaker ? { speaker } : {}) }));

/** Sílaba cantada mínima para probar clasificadores. */
export function syl(p: Partial<SungSyllable> & { start: number; end: number }): SungSyllable {
  return {
    text: "la",
    noteIdx: [0],
    midi: 60,
    stressed: false,
    filler: false,
    melisma: false,
    word: 0,
    ...p,
  };
}

/**
 * Habla inventada y variada: `rate` palabras por segundo entre `from` y `to`,
 * sin trigramas repetidos (el orden sale de un generador con semilla).
 */
export function speech(from: number, to: number, rate = 3.5, seed = 7): TranscriptWord[] {
  const vocab = (
    "bueno entonces vamos mirar esto ahora luego mañana tarde temprano siempre nunca quizás " +
    "tenemos hacemos dijiste pensaba creo parece suena falta sobra cambia pasa queda viene " +
    "guitarra acorde tono ritmo parte cosa idea forma manera lado punto vez rato tiempo " +
    "grabar probar repetir escuchar anotar borrar subir bajar abrir cerrar poner quitar " +
    "claro vale listo seguro cierto exacto igual distinto mejor peor raro lindo feo largo"
  ).split(" ");
  // Park-Miller: el producto cabe exacto en un double, así la secuencia es estable.
  let x = seed;
  const rnd = () => {
    x = (x * 16807) % 2147483647;
    return x / 2147483647;
  };
  const out: TranscriptWord[] = [];
  for (let t = from; t < to; t += 1 / rate) {
    const w = vocab[Math.floor(rnd() * vocab.length)];
    out.push({ text: w, start: t, end: t + 0.8 / rate, type: "word", speaker: "speaker_0" });
  }
  return out;
}
