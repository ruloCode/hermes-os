/**
 * PSOLA en TypeScript puro: lleva cada sílaba del TTS a su altura y duración
 * objetivo sin cambiar el timbre de golpe (a diferencia de asetrate, no corre
 * los formantes con la altura). Marcas de período con `trackPitch` sobre el
 * TTS (fmin 70); las consonantes (sin voz) se copian por OLA a velocidad 1;
 * la vocal se mapea en el tiempo de forma lineal y se sintetiza con granos
 * Hann de 2 períodos centrados en las marcas del período OBJETIVO. Suena a
 * "guía", no a demo: lo dice la UI.
 */
import { pitchAt, type GuideSegment } from "./guide-plan.js";
import { trackPitch, type PitchTrack } from "./melody.js";
import { midiToHz } from "./music-theory.js";

/** Voz del TTS: una voz grave de hombre baja de 100 Hz; 70 la cubre sin meter sub-octavas de más. */
const TTS_FMIN = 70;
/** Sin altura medida en todo el TTS (no debería pasar con voz): un período típico de voz hablada. */
const DEFAULT_HZ = 150;
/** Fundido de entrada de la consonante y cruce consonante→vocal (s). */
const FADE_IN_SEC = 0.003;
const XFADE_SEC = 0.005;
/** Fundido de salida de cada sílaba: evita el clic contra el silencio o la sílaba siguiente. */
const FADE_OUT_SEC = 0.01;
/** Topes de la ganancia de normalización por sílaba. */
const GAIN_MIN = 0.25;
const GAIN_MAX = 4;

const clampHz = (hz: number): number => Math.max(50, Math.min(1500, hz));

/** Muestra con interpolación lineal (0 fuera del buffer). */
function sampleAt(x: Float32Array, pos: number): number {
  const i = Math.floor(pos);
  if (i < 0 || i + 1 >= x.length) return i >= 0 && i < x.length ? x[i] : 0;
  const f = pos - i;
  return x[i] + (x[i + 1] - x[i]) * f;
}

function rms(x: Float32Array, a: number, b: number): number {
  let s = 0;
  let n = 0;
  for (let i = Math.max(0, a); i < Math.min(x.length, b); i++) {
    s += x[i] * x[i];
    n++;
  }
  return n ? Math.sqrt(s / n) : 0;
}

/** f0 (Hz) del TTS en `t`: el cuadro más cercano con voz a ±50 ms; si no, `fallback`. */
function srcHzAt(track: PitchTrack, t: number, fallback: number): number {
  const n = track.f0.length;
  if (!n) return fallback;
  const i = Math.max(0, Math.min(n - 1, Math.round(t / track.hopSec)));
  const reach = Math.max(1, Math.round(0.05 / track.hopSec));
  for (let d = 0; d <= reach; d++) {
    if (i - d >= 0 && track.f0[i - d] > 0) return track.f0[i - d];
    if (i + d < n && track.f0[i + d] > 0) return track.f0[i + d];
  }
  return fallback;
}

/**
 * Marcas de período (muestras) en [a, b]: la primera en el extremo del primer
 * período y cada una en el MISMO rasgo de la onda un período después (el
 * extremo de igual signo a ±¼ de período de lo predicho). Así cada grano sale
 * del mismo punto del ciclo glotal y el tren sintetizado no tiembla.
 */
function pitchMarks(
  src: Float32Array,
  sr: number,
  track: PitchTrack,
  a: number,
  b: number,
  fallback: number,
): number[] {
  const period = (s: number): number => sr / clampHz(srcHzAt(track, s / sr, fallback));
  a = Math.max(0, Math.min(src.length - 1, a));
  b = Math.max(a, Math.min(src.length - 1, b));
  let m = a;
  let best = -1;
  for (let i = a; i < Math.min(src.length, a + Math.ceil(period(a))); i++)
    if (Math.abs(src[i]) > best) {
      best = Math.abs(src[i]);
      m = i;
    }
  const sign = src[m] >= 0 ? 1 : -1;
  const marks = [m];
  for (let guard = 0; guard < 100000; guard++) {
    const T = period(m);
    const pred = m + T;
    if (pred > b) break;
    const lo = Math.max(m + 1, Math.round(pred - T / 4));
    const hi = Math.min(src.length - 1, Math.round(pred + T / 4));
    let k = Math.round(pred);
    let bv = -Infinity;
    for (let i = lo; i <= hi; i++)
      if (sign * src[i] > bv) {
        bv = sign * src[i];
        k = i;
      }
    if (k <= m) k = Math.max(m + 1, Math.round(pred));
    marks.push(k);
    m = k;
  }
  return marks;
}

/** Índice de la marca más cercana a `pos` (búsqueda binaria). */
function nearestMark(marks: number[], pos: number): number {
  let lo = 0;
  let hi = marks.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (marks[mid] <= pos) lo = mid;
    else hi = mid;
  }
  return Math.abs(marks[hi] - pos) < Math.abs(marks[lo] - pos) ? hi : lo;
}

function renderSegment(
  src: Float32Array,
  sr: number,
  track: PitchTrack,
  fallbackHz: number,
  seg: GuideSegment,
  out: Float32Array,
): void {
  const sp = seg.src;
  const dv = seg.dstVowelStart;
  const de = seg.dstEnd;
  const vs = sp.vowelStart;
  const ve = sp.end;

  // 1) Consonante: OLA a velocidad 1 — la COLA de la consonante del TTS (la
  //    que lleva la transición a la vocal) entra justo antes del ataque.
  const lead = Math.max(0, Math.min(dv - seg.dstStart, vs - sp.start));
  if (lead > 0) {
    const n = Math.round(lead * sr);
    const x = Math.round(XFADE_SEC * sr);
    const fin = Math.max(1, Math.min(Math.round(FADE_IN_SEC * sr), n >> 1));
    const s0 = Math.round(vs * sr) - n;
    const d0 = Math.round(dv * sr) - n;
    for (let k = 0; k < n + x; k++) {
      const si = s0 + k;
      const di = d0 + k;
      if (si < 0 || si >= src.length || di < 0 || di >= out.length) continue;
      let g = k < fin ? 0.5 - 0.5 * Math.cos((Math.PI * k) / fin) : 1;
      // Cruce con la vocal: la consonante se apaga mientras entran los primeros granos.
      if (k >= n) g *= 1 - (k - n) / x;
      out[di] += src[si] * g;
    }
  }

  // 2) Vocal: tiempo mapeado de forma lineal y granos Hann de 2 períodos del
  //    TTS puestos en las marcas del período OBJETIVO.
  if (!(de - dv > 1e-3) || !(ve - vs > 1e-3)) return;
  const a = Math.round(vs * sr);
  const b = Math.round(ve * sr);
  const marks = pitchMarks(src, sr, track, a, b, fallbackHz);
  if (!marks.length) return;
  const D0 = Math.round(dv * sr);
  const len = Math.max(0, Math.round(de * sr) - D0);
  if (!len) return;
  const buf = new Float32Array(len);
  const ratio = (ve - vs) / (de - dv);
  const minT = sr / 1000;
  const maxT = sr / 50;
  for (let t = dv, guard = 0; t < de && guard < 1e6; guard++) {
    const sT = vs + (t - dv) * ratio;
    const midi = pitchAt(seg.pitch, t);
    // Sin curva de altura: se conserva la del TTS (solo cambia la duración).
    const hz = clampHz(Number.isFinite(midi) ? midiToHz(midi) : srcHzAt(track, sT, fallbackHz));
    const mi = nearestMark(marks, sT * sr);
    const m = marks[mi];
    // Período local de la FUENTE en esa marca (define el largo del grano: 2 períodos).
    const Ts =
      marks.length >= 2
        ? mi + 1 < marks.length
          ? marks[mi + 1] - m
          : m - marks[mi - 1]
        : sr / clampHz(srcHzAt(track, m / sr, fallbackHz));
    const H = Math.max(minT, Math.min(maxT, Ts));
    // Centro exacto (fraccionario): así el tren sintetizado tiene el período pedido, sin redondeo por grano.
    const c = (t - dv) * sr;
    for (let di = Math.max(0, Math.ceil(c - H)); di <= Math.min(len - 1, Math.floor(c + H)); di++) {
      const j = di - c;
      const w = 0.5 + 0.5 * Math.cos((Math.PI * j) / H);
      buf[di] += sampleAt(src, m + j) * w;
    }
    t += 1 / hz;
  }
  // Normalización por sílaba: los granos se solapan más al subir la altura
  // (más energía) y menos al bajarla; la vocal sale con el nivel del TTS.
  const rSrc = rms(src, a, b);
  const rOut = rms(buf, 0, len);
  const gain = rOut > 1e-9 ? Math.max(GAIN_MIN, Math.min(GAIN_MAX, rSrc / rOut)) : 0;
  const fin = Math.max(1, Math.min(Math.round(XFADE_SEC * sr), len >> 1));
  const fout = Math.max(1, Math.min(Math.round(FADE_OUT_SEC * sr), len >> 1));
  for (let k = 0; k < len; k++) {
    const di = D0 + k;
    if (di < 0 || di >= out.length) continue;
    let g = gain;
    if (k < fin) g *= 0.5 - 0.5 * Math.cos((Math.PI * k) / fin);
    if (k >= len - fout) g *= 0.5 - 0.5 * Math.cos((Math.PI * (len - 1 - k)) / fout);
    out[di] += buf[k] * g;
  }
}

/**
 * Renderiza los segmentos sobre un buffer de `outDurSec` (silencio entre
 * sílabas). `src` es el audio mono del TTS; normaliza por segmento.
 *
 * Las marcas salen de UNA sola pasada de `trackPitch` (fmin 70) sobre todo el
 * TTS: el Viterbi necesita contexto y la línea entera dura segundos. Al final,
 * un limitador: si la suma de sílabas pasara de 0,99, se escala todo (nunca
 * satura).
 */
export function renderSung(
  src: Float32Array,
  sr: number,
  segments: GuideSegment[],
  opts: { outDurSec: number },
): Float32Array {
  const out = new Float32Array(Math.max(0, Math.round(opts.outDurSec * sr)));
  if (!out.length || !src.length || !segments.length || !(sr > 0)) return out;
  const track = trackPitch(src, sr, { fmin: TTS_FMIN });
  const voiced = Array.from(track.f0)
    .filter((f) => f > 0)
    .sort((x, y) => x - y);
  const fallbackHz = voiced.length ? voiced[voiced.length >> 1] : DEFAULT_HZ;
  for (const seg of segments) renderSegment(src, sr, track, fallbackHz, seg, out);
  let peak = 0;
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0.99) {
    const g = 0.99 / peak;
    for (let i = 0; i < out.length; i++) out[i] *= g;
  }
  return out;
}
