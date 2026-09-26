/**
 * VOCALES DEL TARAREO — el "fonema melódico" de un relleno: lo que la gente
 * tararea y recuerda. Del texto cuando lo hay ("na" → a, "uh"/"dun" → u, "mm"
 * → m) y, sin texto, estimada por formantes (LPC → F1/F2 contra las 5 vocales
 * del español). La estimación es APROXIMADA y pierde confianza en agudos (f0 >
 * 400 Hz, donde los armónicos ya no dibujan bien los formantes): el texto
 * siempre manda.
 *
 * Lógica pura y autocontenida: no importa melody.ts a propósito (melody.ts va
 * a usar estas funciones para el eco fonético y un import de vuelta sería un
 * ciclo).
 */
import type { Vowel } from "./composicion.js";

// ─────────────────────────── Del texto ───────────────────────────

const STRONG = "aeoáéó";
const WEAK = "iuü";
const ACCENTED: Record<string, string> = { á: "a", é: "e", í: "i", ó: "o", ú: "u", ü: "u" };
const base = (c: string): string => ACCENTED[c] ?? c;

/**
 * Rellenos cuyo silabeo ortográfico mentiría: "yeah" se partiría ye·ah y, sin
 * tilde, quedaría aguda en la a — pero lo que se canta es una e.
 */
const FILLER_VOWEL: [RegExp, Vowel][] = [
  [/^[hmn]*m[hmn]*$/, "m"], // mm, hmm, mhm: boca cerrada
  [/^(?:ye+a*h*|y?e+y+|he+y+|e+h*)$/, "e"], // yeah, ey, hey, eh
  [/^(?:u?wo+h*|uo+h*|o+h*)$/, "o"], // wo, woh, uoh, oh
  [/^(?:u+h*|uu+)$/, "u"], // uh, uu
  [/^(?:a+h*)$/, "a"], // ah
];

/** Núcleos vocálicos de una palabra, con hiato entre fuertes (o con í/ú) y la y final como vocal. */
function nuclei(w: string): { v: string; accented: boolean }[] {
  // "qu"/"gu" + e/i: la u no suena ("quie" → ie).
  const s = w.replace(/([qg])u(?=[eiéí])/g, "$1");
  const out: { v: string; accented: boolean }[] = [];
  let group = "";
  const flush = (): void => {
    if (!group) return;
    // Dentro del grupo: hiato entre dos fuertes o con débil acentuada.
    const parts: string[] = [];
    let cur = "";
    for (const c of group) {
      const prev = cur[cur.length - 1];
      const hiatus =
        prev !== undefined && ((STRONG.includes(prev) && STRONG.includes(c)) || "íú".includes(prev) || "íú".includes(c));
      if (hiatus) {
        parts.push(cur);
        cur = c;
      } else cur += c;
    }
    parts.push(cur);
    for (const p of parts) {
      // El núcleo de un diptongo es su vocal fuerte; en iu/ui, la segunda (ciu·dad, cui·da).
      const strong = [...p].find((c) => STRONG.includes(c) || c === "í" || c === "ú");
      const v = strong ?? p[p.length - 1];
      out.push({ v: base(v === "y" ? "i" : v), accented: /[áéíóú]/.test(p) });
    }
    group = "";
  };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const isVowel = STRONG.includes(c) || WEAK.includes(c) || "íú".includes(c);
    // La y es vocal si no la sigue una vocal (hoy, muy, "y"); antes de vocal es consonante (yo, yeah).
    const yVowel = c === "y" && !/[aeiouáéíóúü]/.test(s[i + 1] ?? "");
    if (isVowel || yVowel) group += c;
    else flush();
  }
  flush();
  return out;
}

function vowelOfToken(w: string): Vowel | null {
  for (const [re, v] of FILLER_VOWEL) if (re.test(w)) return v;
  const nu = nuclei(w);
  if (!nu.length) return null;
  let k: number;
  const acc = nu.findIndex((n) => n.accented);
  if (acc >= 0) k = acc;
  else if (nu.length === 1) k = 0;
  // Sin tilde: llana si termina en vocal, n o s; aguda si no (la regla del español).
  else k = /[aeiouns]$/.test(w) ? nu.length - 2 : nu.length - 1;
  const v = nu[k].v;
  return v === "a" || v === "e" || v === "i" || v === "o" || v === "u" ? v : null;
}

/** Vocal núcleo de un texto de relleno o sílaba ("na" → a, "dun" → u, "mm" → m, "yeah" → e). null si no hay. */
export function vowelOfText(text: string): Vowel | null {
  const tokens = text
    .normalize("NFC")
    .toLowerCase()
    .split(/[^a-záéíóúüñ]+/)
    .filter(Boolean);
  // En un texto de varias palabras manda la primera que tenga vocal (la sílaba que se ancló).
  for (const t of tokens) {
    const v = vowelOfToken(t);
    if (v) return v;
  }
  return null;
}

/** Parecido entre vocales: misma = 1; misma clase (abiertas a/e/o, cerradas i/u) = 0,5; m con u/o = 0,25; resto 0. */
export function vowelSimilarity(a: Vowel, b: Vowel): number {
  if (a === b) return 1;
  if (a === "m" || b === "m") {
    // La boca cerrada suena cerca de una u/o con los labios redondeados.
    const o = a === "m" ? b : a;
    return o === "u" || o === "o" ? 0.25 : 0;
  }
  const open = (v: Vowel): boolean => v === "a" || v === "e" || v === "o";
  return open(a) === open(b) ? 0.5 : 0;
}

/** ¿Vocal abierta? (a, e, o) — la que se sostiene en notas largas, agudas o melismas. */
export function isOpenVowel(v: Vowel | null | undefined): boolean {
  return v === "a" || v === "e" || v === "o";
}

// ─────────────────────────── Por formantes ───────────────────────────

/**
 * Prototipos F1/F2 (Hz) de las vocales del español, voz adulta promedio. Una
 * voz aguda los corre hacia arriba ~15 %: la distancia en LOG lo tolera mejor
 * que en Hz.
 */
export const VOWEL_FORMANTS: Record<Exclude<Vowel, "m">, [number, number]> = {
  a: [750, 1300],
  e: [450, 1900],
  i: [300, 2300],
  o: [480, 900],
  u: [320, 800],
};

const LPC_ORDER = 12;
const ENV_BINS = 512;

/** Filtro pasabajos (sinc con ventana de Hamming, 63 coeficientes) + diezmado por D. */
function decimate(x: Float32Array, D: number): Float32Array {
  const taps = 63;
  const half = taps >> 1;
  const fc = 0.45 / D; // ciclos por muestra: deja margen antes del nuevo Nyquist
  const h = new Float64Array(taps);
  let sum = 0;
  for (let k = 0; k < taps; k++) {
    const n = k - half;
    const sinc = n === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * n) / (Math.PI * n);
    h[k] = sinc * (0.54 - 0.46 * Math.cos((2 * Math.PI * k) / (taps - 1)));
    sum += h[k];
  }
  for (let k = 0; k < taps; k++) h[k] /= sum;
  const out = new Float32Array(Math.floor(x.length / D));
  for (let i = 0; i < out.length; i++) {
    const c = i * D;
    let s = 0;
    for (let k = 0; k < taps; k++) {
      const j = c + k - half;
      if (j >= 0 && j < x.length) s += h[k] * x[j];
    }
    out[i] = s;
  }
  return out;
}

/** Levinson-Durbin: coeficientes del predictor a[0..p] (a[0] = 1) desde la autocorrelación. */
function levinson(r: Float64Array, p: number): Float64Array | null {
  const a = new Float64Array(p + 1);
  const tmp = new Float64Array(p + 1);
  a[0] = 1;
  let err = r[0];
  if (!(err > 0)) return null;
  for (let i = 1; i <= p; i++) {
    let acc = r[i];
    for (let j = 1; j < i; j++) acc += a[j] * r[i - j];
    const k = -acc / err;
    tmp.set(a);
    for (let j = 1; j < i; j++) a[j] = tmp[j] + k * tmp[i - j];
    a[i] = k;
    err *= 1 - k * k;
    if (!(err > 0)) return null;
  }
  return a;
}

/** F1/F2 de un cuadro: preénfasis 0,97 · Hann · autocorrelación · LPC(12) · picos de la envolvente. */
function frameFormants(x: Float32Array, fs: number): { f1: number; f2: number } | null {
  const n = x.length;
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const pre = x[i] - 0.97 * (i > 0 ? x[i - 1] : 0);
    y[i] = pre * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  }
  const r = new Float64Array(LPC_ORDER + 1);
  for (let k = 0; k <= LPC_ORDER; k++) {
    let s = 0;
    for (let i = k; i < n; i++) s += y[i] * y[i - k];
    r[k] = s;
  }
  if (!(r[0] > 1e-12)) return null;
  r[0] *= 1 + 1e-6; // corrección de ruido blanco: estabiliza el Levinson
  const a = levinson(r, LPC_ORDER);
  if (!a) return null;
  // Envolvente |1/A(e^jω)|² en 512 cubetas de 0 a Nyquist (en dB).
  const env = new Float64Array(ENV_BINS);
  for (let b = 0; b < ENV_BINS; b++) {
    const w = (Math.PI * b) / ENV_BINS;
    let re = 0;
    let im = 0;
    for (let j = 0; j <= LPC_ORDER; j++) {
      re += a[j] * Math.cos(w * j);
      im -= a[j] * Math.sin(w * j);
    }
    env[b] = -10 * Math.log10(re * re + im * im + 1e-30);
  }
  const hzPerBin = fs / 2 / ENV_BINS;
  const peaks: number[] = [];
  for (let b = 1; b < ENV_BINS - 1; b++) {
    if (env[b] > env[b - 1] && env[b] >= env[b + 1]) {
      // Interpolación parabólica: la cubeta mide 8-11 Hz, el pico cae entre dos.
      const den = env[b - 1] - 2 * env[b] + env[b + 1];
      const off = den < 0 ? (0.5 * (env[b - 1] - env[b + 1])) / den : 0;
      peaks.push((b + Math.max(-0.5, Math.min(0.5, off))) * hzPerBin);
    }
  }
  const f1 = peaks.find((f) => f >= 180 && f <= 1200);
  if (f1 === undefined) return null;
  const f2 = peaks.find((f) => f > f1 + 150 && f >= 550 && f <= 3200);
  if (f2 === undefined) return null;
  return { f1, f2 };
}

/** f0 aproximada por autocorrelación normalizada (70..1000 Hz) del centro del tramo. */
function roughF0(x: Float32Array, fs: number): number | null {
  const n = Math.min(x.length, Math.round(0.05 * fs));
  const off = Math.max(0, (x.length - n) >> 1);
  const seg = x.subarray(off, off + n);
  const minLag = Math.max(2, Math.floor(fs / 1000));
  const maxLag = Math.min(n - 2, Math.ceil(fs / 70));
  let e0 = 0;
  for (let i = 0; i < n; i++) e0 += seg[i] * seg[i];
  if (!(e0 > 0) || maxLag <= minLag) return null;
  let best = 0;
  let bestLag = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += seg[i] * seg[i + lag];
    const v = s / e0;
    // El primer pico casi tan alto como el mejor gana: evita elegir el doble del período.
    if (v > best * 1.05) {
      best = v;
      bestLag = lag;
    }
  }
  return best > 0.3 && bestLag ? fs / bestLag : null;
}

function median(a: number[]): number {
  const s = a.slice().sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Vocal estimada de un tramo de audio por formantes: preénfasis + LPC de orden
 * 12 (autocorrelación + Levinson) → picos de la envolvente → F1/F2 → vocal
 * más cercana. `confidence` baja con f0 alto o formantes ambiguos.
 *
 * El tramo se recorta al 80 % central (el ataque y la caída son transición de
 * consonante), se diezma a ~11-16 kHz (el orden 12 es para esa banda: a 48 kHz
 * gastaría los polos en ruido de arriba) y se mide en cuadros de 30 ms cada
 * 10 ms; F1/F2 = mediana de los cuadros con voz. Solo devuelve a/e/i/o/u: la
 * "m" (boca cerrada) no se distingue bien por formantes y sale del texto.
 */
export function estimateVowel(
  pcm: Float32Array,
  sr: number,
  startSec: number,
  endSec: number,
  f0Hz?: number,
): { vowel: Vowel; confidence: number; f1: number; f2: number } | null {
  if (!(sr > 0)) return null;
  let a = Math.max(0, Math.round(startSec * sr));
  let b = Math.min(pcm.length, Math.round(endSec * sr));
  if (b - a < 0.03 * sr) return null;
  const trim = Math.floor((b - a) * 0.1);
  a += trim;
  b -= trim;
  const D = Math.max(1, Math.floor(sr / 11025));
  let x = pcm.subarray(a, b);
  let fs = sr;
  if (D > 1) {
    x = decimate(x, D);
    fs = sr / D;
  }
  const N = Math.min(x.length, Math.round(0.03 * fs));
  const H = Math.max(1, Math.round(0.01 * fs));
  if (N < 0.02 * fs) return null;

  // Cuadros con voz: energía a menos de 25 dB del cuadro más fuerte.
  const starts: number[] = [];
  const energy: number[] = [];
  for (let s = 0; s + N <= x.length; s += H) {
    let e = 0;
    for (let i = s; i < s + N; i++) e += x[i] * x[i];
    starts.push(s);
    energy.push(e);
  }
  const emax = Math.max(...energy);
  if (!(emax > 1e-10)) return null;
  const f1s: number[] = [];
  const f2s: number[] = [];
  let tried = 0;
  starts.forEach((s, k) => {
    if (energy[k] < emax * 10 ** (-25 / 10)) return;
    tried++;
    const fr = frameFormants(x.subarray(s, s + N), fs);
    if (fr) {
      f1s.push(fr.f1);
      f2s.push(fr.f2);
    }
  });
  if (!f1s.length) return null;
  const f1 = median(f1s);
  const f2 = median(f2s);

  const dist = (v: Exclude<Vowel, "m">): number => {
    const [p1, p2] = VOWEL_FORMANTS[v];
    return Math.hypot(Math.log(f1 / p1), Math.log(f2 / p2));
  };
  const ranked = (Object.keys(VOWEL_FORMANTS) as Exclude<Vowel, "m">[])
    .map((v) => ({ v, d: dist(v) }))
    .sort((p, q) => p.d - q.d);
  const [first, second] = ranked;
  // Confianza: cuánto le saca a la segunda, qué tan cerca está de su prototipo,
  // qué parte de los cuadros dio formantes y si la voz es aguda.
  const sep = (second.d - first.d) / (second.d + 1e-9);
  const fit = Math.exp(-first.d / 0.35);
  const frames = f1s.length / Math.max(1, tried);
  let confidence = sep * (0.4 + 0.6 * fit) * (0.5 + 0.5 * frames);
  // Voz aguda: los armónicos se separan y el LPC se "engancha" a ellos (medido
  // con vocales sintéticas fuente-filtro a 16/22/44/48 kHz: de 100 a 220 Hz
  // acierta las 5; desde 260 Hz la o empieza a leerse como e o u). La
  // confianza baja desde 200 Hz y por encima de 400 queda en 0,3×.
  const f0 = f0Hz ?? roughF0(x, fs);
  if (f0 != null && f0 > 400) confidence *= 0.3;
  else if (f0 != null && f0 > 200) confidence *= 1 - (0.5 * (f0 - 200)) / 200;
  confidence = Math.max(0, Math.min(1, confidence));
  return {
    vowel: first.v,
    confidence: Math.round(confidence * 100) / 100,
    f1: Math.round(f1),
    f2: Math.round(f2),
  };
}
