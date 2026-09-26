/**
 * MELODÍA — análisis puro de un memo cantado (sin DOM, sin Node): de PCM a
 * notas, de notas + palabras con tiempo a SÍLABAS (con melismas), de sílabas a
 * FRASES con su MOLDE, tonalidad por perfil de clases de altura, y la medida de
 * qué tan bien calza una línea de letra con un molde.
 *
 * Lo usan el agente (análisis de la sesión) y el dashboard (medir en vivo lo
 * que el humano escribe contra el molde). Los parámetros por defecto salen de
 * mediciones REALES sobre una sesión de 20 min (voz femenina, guitarra
 * eléctrica de fondo, voz aislada con Mel-Roformer): ver la cabecera de cada
 * función. Lo que no se midió se dice.
 *
 * El corazón del producto es el MELISMA: una sílaba que cubre 2+ notas de
 * altura distinta. El molde lo cuenta como UNA sílaba que pide vocal abierta
 * ("respetar") o como una sílaba por nota ("silabizar"). Todo lo demás
 * (sílabas, acentos, final agudo/llano) es medida aproximada, como un
 * metrónomo: la corrección humana del molde siempre manda.
 */
import { mod12, scaleNotes, type Key } from "./music-theory.js";
import { stripChords } from "./lyrics-analysis.js";
import { metricWeight } from "./grid.js";
import { isOpenVowel, vowelOfText, vowelSimilarity } from "./vowels.js";
import type { Meter } from "./tema.js";
import type {
  KeyCandidate,
  KeyEstimate,
  LineEnding,
  LineFit,
  MelismaMode,
  MelodyNote,
  MoldSlotInfo,
  PassageKind,
  Phrase,
  PhraseMold,
  SungSyllable,
  Vowel,
} from "./composicion.js";

// ─────────────────────────── Utilidades ───────────────────────────

const round = (x: number, d = 3): number => {
  const k = 10 ** d;
  return Math.round(x * k) / k;
};
const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

function median(a: ArrayLike<number>): number {
  const s = Array.from(a).sort((x, y) => x - y);
  if (!s.length) return NaN;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Segundos de una nota o sílaba que se solapan con [a, b]. */
const overlap = (s: number, e: number, a: number, b: number): number =>
  Math.min(e, b) - Math.max(s, a);

/** Una sílaba (o nota) es LARGA desde 0,6 s: pide vocal abierta. */
export const LONG_SYLLABLE_SEC = 0.6;

// ─────────────────────────── Altura (pitch) ───────────────────────────

export interface PitchOptions {
  /** Hz. Default 100 (medido: 100–130 da igual en voz femenina; 70 mete sub-octavas). */
  fmin?: number;
  /** Hz. Default 1000. */
  fmax?: number;
  /** Muestras entre cuadros. Default 10 ms (160 @16 kHz). */
  hop?: number;
  /**
   * Ventana de integración de YIN en muestras. Default 32 ms (512 @16 kHz), la
   * medida; nunca menos que un período de `fmin`.
   */
  frame?: number;
  /** Costo de pasar a "sin voz" en el Viterbi. Default 0,4 (barrido: 0,4 > 0,3 > 0,2). */
  unvoicedCost?: number;
  /** Penalización a candidatos de sub-octava. Default 0,12. */
  subOctavePenalty?: number;
  /** Compuerta de silencio: dB bajo el pico. Default 45. */
  silenceDb?: number;
}

export interface PitchTrack {
  sr: number;
  /** Muestras entre cuadros. */
  hop: number;
  hopSec: number;
  /** Hz por cuadro; 0 = sin voz. El cuadro i está CENTRADO en i·hopSec. */
  f0: Float32Array;
  /** MIDI con decimales por cuadro (sin corregir afinación); NaN = sin voz. */
  midi: Float32Array;
  /**
   * Energía por cuadro en dB relativos al pico (percentil 99,5 de la energía:
   * los cuadros más fuertes pueden pasar un poco de 0).
   */
  rmsDb: Float32Array;
}

interface YinCand {
  /** Hz. */
  f: number;
  /** d'(τ): diferencia normalizada (0 = periódico perfecto). */
  c: number;
  lag: number;
}

/**
 * YIN + Viterbi ("pYIN-lite"): ~100× tiempo real, 92,6 % de acuerdo con
 * librosa.pyin (cuadros con voz a <50 c), 2,8 % de errores de octava. Pensado
 * para 16 kHz: a 44,1 kHz funciona pero cuesta ~8× más (ventanas más largas).
 *
 * Por qué Viterbi: YIN solo acierta 83–91 % y comete hasta 14 % de errores de
 * octava; con un camino que castiga saltos y sub-octavas sube a 92,6 %.
 * Sin pliegue de octava: medido, las notas "corregidas" coincidían con pyin 5
 * de 29 veces; los graves raros eran reales.
 */
export function trackPitch(pcm: Float32Array, sr: number, opts: PitchOptions = {}): PitchTrack {
  const job = pitchTracker(pcm, sr, opts);
  job.run(0, job.frames);
  return job.finish();
}

/**
 * trackPitch por PARTES, con el mismo resultado bit a bit: `run(from, to)`
 * procesa los cuadros [from, to) de YIN (lo caro: ~8 s para 20 min de sesión)
 * y `finish()` corre el Viterbi y arma la pista. Quien llama decide cuándo
 * ceder el control entre tramos (el agente no puede congelar su event loop:
 * el poll del dashboard, los WS y los jobs viven en el mismo hilo). Sin
 * Node ni DOM: la cesión (setImmediate, un await) la pone el que llama.
 */
export function pitchTracker(
  pcm: Float32Array,
  sr: number,
  opts: PitchOptions = {},
): { frames: number; run: (from: number, to: number) => void; finish: () => PitchTrack } {
  const hop = Math.max(1, Math.round(opts.hop ?? sr * 0.01));
  const fmin = opts.fmin ?? 100;
  const fmax = opts.fmax ?? 1000;
  const gateDb = opts.silenceDb ?? 45;
  // Sin umbral absoluto de YIN: con el Viterbi deja de importar (medido); los
  // mejores mínimos de cada cuadro pasan todos como candidatos.
  const maxCands = 5;
  const minLag = Math.max(2, Math.floor(sr / fmax));
  const maxLag = Math.ceil(sr / fmin);
  const W = Math.max(maxLag + 1, Math.round(opts.frame ?? sr * 0.032));
  const span = W + maxLag + 2;
  const nFrames = pcm.length > 0 ? Math.floor(pcm.length / hop) + 1 : 0;

  // Pico global = percentil 99,5 de la energía por bloque: un golpe aislado no
  // debe correr la compuerta de silencio.
  let peak = 1e-9;
  {
    const r: number[] = [];
    for (let s = 0; s + hop <= pcm.length; s += hop) {
      let e = 0;
      for (let j = s; j < s + hop; j++) e += pcm[j] * pcm[j];
      r.push(Math.sqrt(e / hop));
    }
    r.sort((a, b) => a - b);
    if (r.length) peak = r[Math.floor(r.length * 0.995)] || 1e-9;
  }
  const gate = peak * Math.pow(10, -gateDb / 20);

  const rmsDb = new Float32Array(nFrames);
  const cands: YinCand[][] = new Array(nFrames);
  const frame = new Float32Array(span);
  const d = new Float64Array(maxLag + 2);
  const cm = new Float64Array(maxLag + 2);

  const run = (from: number, to: number): void => {
    const hi = Math.min(nFrames, to);
    for (let i = Math.max(0, from); i < hi; i++) {
      const start = i * hop - (span >> 1);
      for (let j = 0; j < span; j++) {
        const k = start + j;
        frame[j] = k >= 0 && k < pcm.length ? pcm[k] : 0;
      }
      let e = 0;
      for (let j = 0; j < W; j++) e += frame[j] * frame[j];
      const rms = Math.sqrt(e / W);
      rmsDb[i] = 20 * Math.log10(rms / peak + 1e-12);
      cands[i] = [];
      if (rms < gate) continue;

      // Función diferencia y su normalización por la media acumulada (YIN, pasos 2-3).
      for (let tau = 1; tau <= maxLag + 1; tau++) {
        let s = 0;
        for (let j = 0; j < W; j++) {
          const df = frame[j] - frame[j + tau];
          s += df * df;
        }
        d[tau] = s;
      }
      cm[0] = 1;
      let runSum = 0;
      for (let tau = 1; tau <= maxLag + 1; tau++) {
        runSum += d[tau];
        cm[tau] = runSum > 0 ? (d[tau] * tau) / runSum : 1;
      }
      const loc: number[] = [];
      for (let tau = minLag; tau <= maxLag; tau++) {
        if (cm[tau] < cm[tau - 1] && cm[tau] <= cm[tau + 1]) loc.push(tau);
      }
      if (!loc.length) continue;
      const interp = (tau: number): number => {
        const a = cm[tau - 1];
        const b = cm[tau];
        const c = cm[tau + 1];
        const den = a - 2 * b + c;
        const off = den > 1e-12 ? (0.5 * (a - c)) / den : 0;
        return tau + Math.max(-1, Math.min(1, off));
      };
      const sorted = loc.slice().sort((a, b) => cm[a] - cm[b]).slice(0, maxCands);
      cands[i] = sorted.map((t) => ({ f: sr / interp(t), c: cm[t], lag: t }));
    }
  };

  const finish = (): PitchTrack => {
    // Un cuadro que nadie procesó no inventa voz: queda sin candidatos (y rmsDb en 0).
    for (let i = 0; i < nFrames; i++) if (!cands[i]) cands[i] = [];
    const f0 = viterbiPath(cands, {
      unvoicedCost: opts.unvoicedCost ?? 0.4,
      subOctavePenalty: opts.subOctavePenalty ?? 0.12,
    });
    const midi = new Float32Array(nFrames);
    for (let i = 0; i < nFrames; i++) midi[i] = f0[i] > 0 ? hzToMidi(f0[i]) : NaN;
    return { sr, hop, hopSec: hop / sr, f0, midi, rmsDb };
  };

  return { frames: nFrames, run, finish };
}

/**
 * Camino de mínimo costo por los candidatos YIN + un estado "sin voz".
 * Emisión = d' del candidato (+ castigo si otro de lag más corto es casi igual
 * de bueno: el error típico de sub-octava). Transición = semitonos saltados
 * (+ extra si el salto pasa de 3 st en 10 ms, casi siempre un error) o
 * entrar/salir de la voz.
 */
function viterbiPath(
  cands: YinCand[][],
  o: { unvoicedCost: number; subOctavePenalty: number },
): Float32Array {
  const switchCost = 0.2;
  const stCost = 0.035;
  const leapCost = 0.25;
  const n = cands.length;
  const f0 = new Float32Array(n);
  if (!n) return f0;
  // Por cuadro: estado 0 = sin voz; el resto, candidatos (Hz, MIDI, emisión).
  const sf: number[][] = new Array(n);
  const sm: number[][] = new Array(n);
  const se: number[][] = new Array(n);
  for (let i = 0; i < n; i++) {
    const cs = cands[i];
    const fs = [0];
    const ms = [NaN];
    const es = [cs.length ? o.unvoicedCost : 0];
    for (const c of cs) {
      if (c.c > 0.6) continue;
      const shorter = cs.some((k) => k.lag < c.lag && k.c < c.c + 0.08);
      fs.push(c.f);
      ms.push(hzToMidi(c.f));
      es.push(c.c + (shorter ? o.subOctavePenalty : 0));
    }
    sf[i] = fs;
    sm[i] = ms;
    se[i] = es;
  }
  let cost = Float64Array.from(se[0]);
  const back: Int32Array[] = new Array(n);
  back[0] = new Int32Array(se[0].length).fill(-1);
  for (let i = 1; i < n; i++) {
    const cur = sm[i];
    const prev = sm[i - 1];
    const cc = new Float64Array(cur.length);
    const bb = new Int32Array(cur.length);
    for (let a = 0; a < cur.length; a++) {
      let best = Infinity;
      let arg = 0;
      const va = a > 0;
      for (let b = 0; b < prev.length; b++) {
        const vb = b > 0;
        let t: number;
        if (va && vb) {
          const st = Math.abs(cur[a] - prev[b]);
          t = stCost * Math.min(st, 24) + (st > 3 ? leapCost : 0);
        } else if (va !== vb) t = switchCost;
        else t = 0;
        const v = cost[b] + t;
        if (v < best) {
          best = v;
          arg = b;
        }
      }
      cc[a] = best + se[i][a];
      bb[a] = arg;
    }
    cost = cc;
    back[i] = bb;
  }
  let s = 0;
  let m = Infinity;
  cost.forEach((v, k) => {
    if (v < m) {
      m = v;
      s = k;
    }
  });
  for (let i = n - 1; i >= 0 && s >= 0; i--) {
    f0[i] = sf[i][s];
    s = back[i][s];
  }
  return f0;
}

export function hzToMidi(hz: number): number {
  return 69 + 12 * Math.log2(hz / 440);
}

/**
 * Afinación global en cents (−50..50): media CIRCULAR de la parte fraccionaria
 * de los cuadros con voz (circular porque +49 c y −49 c son vecinos, no
 * opuestos). Medido en la sesión real: la voz sola da −6 a −22 c según el
 * pasaje; la guitarra (librosa) −19 c. Si hay instrumento, su afinación manda.
 */
export function estimateTuningCents(track: PitchTrack): number {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let i = 0; i < track.midi.length; i++) {
    const m = track.midi[i];
    if (!Number.isFinite(m)) continue;
    const a = 2 * Math.PI * (m - Math.round(m));
    sx += Math.cos(a);
    sy += Math.sin(a);
    n++;
  }
  if (!n) return 0;
  return Math.round((100 * Math.atan2(sy, sx)) / (2 * Math.PI));
}

// ─────────────────────────── Notas ───────────────────────────

export interface NoteOptions {
  /** Semitonos de desvío que abren nota nueva. Default 0,7. */
  splitSt?: number;
  /** Cuánto debe sostenerse el desvío (ms). Default 50. */
  holdMs?: number;
  /** Duración mínima de nota (ms). Default 80. */
  minMs?: number;
  /** Huecos sin voz que se rellenan (ms). Default 40. */
  gapFillMs?: number;
  /** Legato: huecos que unen notas iguales (ms). Default 50. */
  mergeGapMs?: number;
  /** Valle de energía que parte notas repetidas a la misma altura (dB). Default 6. */
  dipDb?: number;
  /** Afinación de la sesión a compensar antes de redondear (cents). Default: la de la pista. */
  tuningCents?: number;
}

/**
 * Curva → notas. Tiempos relativos al inicio del PCM analizado. Medido: 208 de
 * 210 notas caen a ±1 st de la mediana de pyin. El vibrato (±0,3 st) no parte
 * notas; las sílabas repetidas a la misma altura ("na na na") se parten por
 * valles de energía de 6 dB.
 */
export function segmentNotes(track: PitchTrack, opts: NoteOptions = {}): MelodyNote[] {
  const hopS = track.hopSec;
  const splitSt = opts.splitSt ?? 0.7;
  const hold = Math.max(1, Math.round((opts.holdMs ?? 50) / 1000 / hopS));
  const minF = Math.max(1, Math.round((opts.minMs ?? 80) / 1000 / hopS));
  const gapFill = Math.round((opts.gapFillMs ?? 40) / 1000 / hopS);
  const mergeGap = Math.round((opts.mergeGapMs ?? 50) / 1000 / hopS);
  const dipDb = opts.dipDb ?? 6;
  const tuning = (opts.tuningCents ?? estimateTuningCents(track)) / 100;
  const n = track.midi.length;
  const m = new Float64Array(n).fill(NaN);
  for (let i = 0; i < n; i++) if (Number.isFinite(track.midi[i])) m[i] = track.midi[i] - tuning;

  // 1) Huecos cortos sin voz (consonantes sordas) se rellenan si ambos lados
  //    están a menos de 2 st: la nota sigue, solo cambió la consonante.
  for (let i = 1; i < n; i++) {
    if (!isNaN(m[i]) || isNaN(m[i - 1])) continue;
    let j = i;
    while (j < n && isNaN(m[j])) j++;
    if (j < n && j - i <= gapFill && Math.abs(m[j] - m[i - 1]) < 2) {
      for (let k = i; k < j; k++) m[k] = m[i - 1] + ((m[j] - m[i - 1]) * (k - i + 1)) / (j - i + 1);
    }
    i = j;
  }
  // 2) Mediana de 5 cuadros dentro de cada tramo con voz.
  const sm = Float64Array.from(m);
  for (let i = 0; i < n; i++) {
    if (isNaN(m[i])) continue;
    const w: number[] = [];
    for (let k = i - 2; k <= i + 2; k++) if (k >= 0 && k < n && !isNaN(m[k])) w.push(m[k]);
    sm[i] = median(w);
  }
  // 3) Segmentación por altura con histéresis: el desvío debe SOSTENERSE
  //    `holdMs` para abrir nota (un vibrato o un ataque no la abren).
  const raw: { a: number; b: number }[] = [];
  let i = 0;
  while (i < n) {
    if (isNaN(sm[i])) {
      i++;
      continue;
    }
    let a = i;
    let frames: number[] = [sm[i]];
    let dev = 0;
    let devStart = -1;
    i++;
    while (i < n && !isNaN(sm[i])) {
      const ref = median(frames.length > 12 ? frames.slice(-12) : frames);
      if (Math.abs(sm[i] - ref) > splitSt) {
        if (dev === 0) devStart = i;
        dev++;
        if (dev >= hold) {
          raw.push({ a, b: devStart });
          a = devStart;
          frames = Array.from(sm.slice(devStart, i + 1));
          dev = 0;
        }
      } else {
        dev = 0;
        frames.push(sm[i]);
      }
      i++;
    }
    raw.push({ a, b: i });
  }
  // 4) Notas de igual altura se parten por valles de energía (sílabas repetidas).
  const rms = track.rmsDb;
  const split: { a: number; b: number }[] = [];
  for (const s of raw) {
    let a = s.a;
    for (let k = s.a + minF; k < s.b - minF; k++) {
      if (!(rms[k] <= rms[k - 1] && rms[k] <= rms[k + 1])) continue;
      let l = -Infinity;
      let r = -Infinity;
      for (let q = Math.max(a, k - 12); q < k; q++) l = Math.max(l, rms[q]);
      for (let q = k + 1; q < Math.min(s.b, k + 13); q++) r = Math.max(r, rms[q]);
      if (Math.min(l, r) - rms[k] >= dipDb && k - a >= minF) {
        split.push({ a, b: k });
        a = k;
      }
    }
    split.push({ a, b: s.b });
  }
  // 5) Altura = mediana del CUERPO (sin el ataque ni la caída).
  const notes = split.map((s) => {
    const len = s.b - s.a;
    const body = Array.from(
      sm.slice(s.a + Math.floor(len * 0.2), s.a + Math.max(Math.ceil(len * 0.9), 1)),
    ).filter((x) => !isNaN(x));
    const pm = median(body.length ? body : Array.from(sm.slice(s.a, s.b)));
    return { a: s.a, b: s.b, pm, len };
  });
  // 6) Notas demasiado cortas: se pegan a la vecina si está a < 1 st; si no, fuera.
  const kept: typeof notes = [];
  for (const nt of notes) {
    if (nt.len >= minF) {
      kept.push(nt);
      continue;
    }
    const prev = kept[kept.length - 1];
    if (prev && nt.a - prev.b <= mergeGap && Math.abs(prev.pm - nt.pm) < 1) prev.b = nt.b;
  }
  // 7) Legato: misma nota redondeada, hueco corto y SIN valle de energía entre ellas.
  const out: typeof notes = [];
  for (const nt of kept) {
    const prev = out[out.length - 1];
    if (
      prev &&
      Math.round(prev.pm) === Math.round(nt.pm) &&
      nt.a - prev.b <= mergeGap &&
      !hasDip(rms, prev.b - 3, nt.a + 3, dipDb)
    ) {
      prev.b = nt.b;
      prev.pm = (prev.pm * prev.len + nt.pm * nt.len) / (prev.len + nt.len);
      prev.len += nt.len;
    } else out.push({ ...nt });
  }
  return out
    .filter((nt) => Number.isFinite(nt.pm))
    .map((nt) => {
      const midi = Math.round(nt.pm);
      return {
        midi,
        start: round(nt.a * hopS),
        end: round(nt.b * hopS),
        cents: Math.round((nt.pm - midi) * 100),
      };
    });
}

function hasDip(rms: Float32Array, a: number, b: number, dipDb: number): boolean {
  a = Math.max(0, a);
  b = Math.min(rms.length - 1, b);
  if (b <= a) return false;
  let mx = -Infinity;
  let mn = Infinity;
  for (let k = a; k <= b; k++) {
    mx = Math.max(mx, rms[k]);
    mn = Math.min(mn, rms[k]);
  }
  return mx - mn >= dipDb;
}

// ─────────────────────────── Palabras y sílabas ───────────────────────────

/** Palabra con tiempo (de la transcripción), relativa al inicio del pasaje. */
export interface TimedWord {
  text: string;
  start: number;
  end: number;
  speaker?: string;
}

/** Minúsculas y solo letras del español ("¿Dun," → "dun"). */
function normWord(w: string): string {
  return w.normalize("NFC").toLowerCase().replace(/[^a-záéíóúüñ]/g, "");
}

/** Para reconocer rellenos la tilde no importa ("tururú" = "tururu"). */
const normFiller = (w: string): string =>
  normWord(w)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

/**
 * Vocablos que NO son palabras del español: son relleno en cualquier contexto.
 * Repeticiones pegadas ("nanana", "dundun", "lalala") también.
 */
const FILLER_STRICT =
  /^(?:(?:na)+|(?:du+n|du+m|du+)+|(?:pu+m|pa+m)+|tu+(?:ru)+|u+h+|uu+|o+h+|oo+|a+h{2,}|aa+h*|h?m{2,}|hm+|(?:la){2,}|(?:ti){2,}|ti+n|tiri(?:ri)*n?|(?:ra)+|(?:pa){2,}|(?:ta){2,}|ye+a*h*|e+y+|he+y|u?wo+h?|uo+h?)$/;

/**
 * Vocablos que TAMBIÉN son palabras ("la" artículo, "ti" pronombre, "pa"
 * de "para", "eh" de habla): solo son relleno repetidos o junto a otro relleno.
 * Medido en la sesión: "la" suelto era casi siempre artículo.
 */
const FILLER_AMBIGUOUS = new Set(["la", "le", "lo", "li", "ti", "tu", "pa", "ta", "ah", "eh"]);

/**
 * ¿Es un relleno sin letra? Sin contexto: solo los vocablos que nunca son
 * palabras (na, nana, dun, uh, oh, mm, tin, tirin, yeah, ey, lalala…). Los
 * ambiguos ("la", "ti", "eh") necesitan contexto: ver `fillerFlags`.
 */
export function isFiller(word: string): boolean {
  const w = normFiller(word);
  return !!w && FILLER_STRICT.test(w);
}

/**
 * Relleno CON contexto: un vocablo ambiguo ("la", "ti", "eh"…) cuenta como
 * relleno si su vecina (a menos de `maxGapSec`) es relleno o es el mismo
 * vocablo repetido ("la la la" sí; "la vida" no).
 */
export function fillerFlags(
  words: { text: string; start?: number; end?: number }[],
  maxGapSec = 1.5,
): boolean[] {
  const norm = words.map((w) => normFiller(w.text));
  const strict = norm.map((w) => !!w && FILLER_STRICT.test(w));
  const close = (i: number, j: number): boolean => {
    const a = words[Math.min(i, j)];
    const b = words[Math.max(i, j)];
    if (a.end == null || b.start == null) return true;
    return b.start - a.end < maxGapSec;
  };
  return norm.map((t, i) => {
    if (strict[i]) return true;
    if (!FILLER_AMBIGUOUS.has(t)) return false;
    const near = (j: number): boolean =>
      j >= 0 && j < words.length && (strict[j] || norm[j] === t) && close(i, j);
    return near(i - 1) || near(i + 1);
  });
}

/** Sílabas de un relleno: "nanana" → na·na·na; "uhh" o "yeah" → una sola. */
function fillerSyllables(word: string): string[] {
  const w = normFiller(word);
  if (!w) return [];
  const unit = /na|la|ti|ta|pa|ra|du+n|du+m|du+|pu+m|pa+m/g;
  if (/^(?:na|la|ti|ta|pa|ra|du+n|du+m|du+|pu+m|pa+m)+$/.test(w)) return w.match(unit) ?? [w];
  if (/^(?:ye+a*h*|o+h*|u+h*|a+h*|e+h*|e+y+|he+y|h?m+|hm+|u?wo+h?|uo+h?)$/.test(w)) return [w];
  return splitSyllables(w);
}

const V = "aeiouáéíóúü";
// í/ú acentuadas se comportan como fuertes: rompen el diptongo (pa-ís, rí-o).
const STRONG = "aeoáéóíú";
const INSEP = new Set(["pr", "br", "tr", "dr", "cr", "gr", "fr", "pl", "bl", "cl", "gl", "fl", "kr", "kl"]);

/**
 * Silabeo ortográfico del español: "episodio" → ["e","pi","so","dio"].
 * ch/ll/rr/qu/gu(e,i) son una unidad; hiato entre fuertes o con í/ú tónicas;
 * grupos inseparables (pr, bl, tr…) van con la vocal siguiente; la "y" final
 * es vocal (hoy, muy). Medido: acierta las 38 palabras de prueba del informe.
 */
export function splitSyllables(word: string): string[] {
  const w = normWord(word);
  if (!w) return [];
  const u: [string, boolean][] = [];
  for (let i = 0; i < w.length; i++) {
    const c = w[i];
    const dd = w.slice(i, i + 2);
    if (dd === "ch" || dd === "ll" || dd === "rr") {
      u.push([dd, false]);
      i++;
      continue;
    }
    if ((c === "q" || c === "g") && w[i + 1] === "u" && "eiéí".includes(w[i + 2] || "_")) {
      u.push([c + "u", false]);
      i++;
      continue;
    }
    if (c === "y") {
      const vocalic = i === w.length - 1 || !V.includes(w[i + 1] || "_");
      u.push([c, vocalic && i > 0]);
      continue;
    }
    u.push([c, V.includes(c)]);
  }
  // Núcleos: grupos vocálicos, partidos por hiato.
  const nuc: number[] = [];
  for (let i = 0; i < u.length; i++) {
    if (!u[i][1]) continue;
    const prevV = i > 0 && u[i - 1][1];
    if (!prevV) {
      nuc.push(i);
      continue;
    }
    const a = u[i - 1][0];
    const b = u[i][0];
    if ((STRONG.includes(a) && STRONG.includes(b)) || "íú".includes(a) || "íú".includes(b)) nuc.push(i);
  }
  if (!nuc.length) return [w];
  // Reparto de consonantes entre núcleos (V-CV, VC-CV, VC-CCV, grupos inseparables).
  const cuts: number[] = [];
  for (let k = 1; k < nuc.length; k++) {
    let e = nuc[k - 1];
    while (e + 1 < u.length && u[e + 1][1] && e + 1 < nuc[k]) e++;
    const cons = u.slice(e + 1, nuc[k]).map((x) => x[0]);
    const c = cons.length;
    let cut: number;
    if (c === 0) cut = nuc[k];
    else if (c === 1) cut = e + 1;
    else if (c === 2) cut = INSEP.has(cons.join("")) ? e + 1 : e + 2;
    else if (c === 3) cut = INSEP.has(cons.slice(1).join("")) ? e + 2 : e + 3;
    else cut = e + 3;
    cuts.push(cut);
  }
  const syl: string[] = [];
  let s = 0;
  for (const c of cuts) {
    syl.push(
      u
        .slice(s, c)
        .map((x) => x[0])
        .join(""),
    );
    s = c;
  }
  syl.push(
    u
      .slice(s)
      .map((x) => x[0])
      .join(""),
  );
  return syl;
}

/**
 * Índice (0-based) de la sílaba tónica de una palabra española: la tilde
 * manda; sin tilde, llana si termina en vocal, n o s; aguda si no.
 */
export function stressedSyllable(word: string): number {
  const syl = splitSyllables(word);
  if (syl.length <= 1) return 0;
  const k = syl.findIndex((s) => /[áéíóú]/.test(s));
  if (k >= 0) return k;
  return /[aeiouns]$/.test(normWord(word)) ? syl.length - 2 : syl.length - 1;
}

/**
 * Palabras ÁTONAS del español (artículos, preposiciones, conjunciones,
 * pronombres clíticos, posesivos antepuestos, relativos sin tilde): no llevan
 * acento de frase, así que no cuentan como acentos del molde ni de la letra.
 * Las tónicas homógrafas llevan tilde (tú, mí, él, sí, qué) y no están aquí.
 */
const ATONIC = new Set([
  "el", "la", "los", "las", "lo", "un", "una", "unos", "unas",
  "a", "ante", "con", "contra", "de", "del", "al", "desde", "en", "entre", "hacia", "hasta",
  "para", "por", "sin", "sobre", "tras",
  "y", "e", "ni", "o", "u", "pero", "mas", "sino", "que", "si", "como", "cuando", "donde",
  "aunque", "porque", "pues",
  "me", "te", "se", "nos", "os", "le", "les",
  "mi", "mis", "tu", "tus", "su", "sus",
  "cual", "cuales", "quien", "quienes",
]);

/** ¿Palabra átona? (no lleva acento de frase: "la", "de", "que", "me", "tu"…). */
export function isAtonic(word: string): boolean {
  return ATONIC.has(normWord(word));
}

/** Tramo de una sílaba antes de anclarle notas. */
interface SylSpan {
  text: string;
  word: number;
  filler: boolean;
  tonic: boolean;
  speaker?: string;
  a: number;
  b: number;
}

/**
 * Ancla sílabas a notas: cada palabra se silabea y sus sílabas se reparten en
 * su tramo de tiempo (los límites internos caen en los ATAQUES de nota más
 * cercanos al reparto proporcional); cada sílaba dura hasta que empieza la
 * siguiente (legato, `legatoSec` 0,35: la transcripción da 60 ms a "lo"/"que"
 * y sin esto quedaban sin nota) y las palabras estiradas por la transcripción
 * se recortan a su final (`maxWordSec` 1,6). Medido en la sesión real: 0 de 37
 * sílabas sin nota en un pasaje con letra; en uno de "dun", 18 de 137 sin
 * altura estable (percusivos).
 *
 * Cada nota pertenece a UNA sola sílaba (la que más la cubre): así la cola de
 * una nota que se asoma a la sílaba vecina no inventa un melisma. Una sílaba
 * que se queda sin nota propia toma prestada la que más la cubre. Una sílaba
 * que cubre 2+ notas de altura distinta (≥ 1 st) es MELISMA.
 *
 * Acentos: en palabras, la tónica (las átonas no acentúan); en rellenos, los
 * acentos son MUSICALES — el primero de cada grupo, las notas largas y los
 * picos de altura.
 *
 * `word` = índice de la palabra en `words` (buildPhrases lo rebasa a la frase).
 */
export function anchorSyllables(
  words: TimedWord[],
  notes: MelodyNote[],
  opts: { legatoSec?: number; maxWordSec?: number } = {},
): SungSyllable[] {
  const maxWord = opts.maxWordSec ?? 1.6;
  const legato = opts.legatoSec ?? 0.35;
  const flags = fillerFlags(words);
  const order = words.map((_, i) => i).sort((x, y) => words[x].start - words[y].start);
  const spans: SylSpan[] = [];
  for (const i of order) {
    const w = words[i];
    const filler = flags[i];
    const syl = filler ? fillerSyllables(w.text) : splitSyllables(w.text);
    if (!syl.length || !Number.isFinite(w.start)) continue;
    let start = w.start;
    let end = Number.isFinite(w.end) && w.end >= start ? w.end : start;
    // La transcripción estira a veces una palabra sobre la guitarra: la voz
    // suele estar al FINAL del tramo.
    if (end - start > maxWord) start = Math.max(start, end - Math.min(maxWord, 0.25 * syl.length + 0.3));
    if (end - start < 0.06) end = start + 0.06 * syl.length;
    const onsets = notes
      .filter((nt) => nt.end > start && nt.start < end)
      .map((nt) => nt.start)
      .filter((t) => t > start + 0.04 && t < end - 0.04);
    const per = (end - start) / syl.length;
    const bounds = [start];
    for (let k = 1; k < syl.length; k++) {
      const prev = bounds[bounds.length - 1];
      const target = start + per * k;
      let best: number | null = null;
      let bd = Infinity;
      for (const o of onsets) {
        const dd = Math.abs(o - target);
        if (o > prev + 0.03 && dd < bd && dd < per) {
          bd = dd;
          best = o;
        }
      }
      bounds.push(Math.min(end, Math.max(best ?? target, prev)));
    }
    bounds.push(end);
    const tonic = filler || isAtonic(w.text) ? -1 : stressedSyllable(w.text);
    for (let k = 0; k < syl.length; k++) {
      spans.push({
        text: syl[k],
        word: i,
        filler,
        tonic: k === tonic,
        speaker: w.speaker,
        a: bounds[k],
        b: bounds[k + 1],
      });
    }
  }
  // Legato: en el canto la sílaba dura hasta que empieza la siguiente.
  for (let k = 0; k + 1 < spans.length; k++) {
    const c = spans[k];
    const nx = spans[k + 1];
    if (nx.speaker === c.speaker && nx.a > c.b && nx.a - c.b < legato) c.b = nx.a;
  }

  // Cada nota a la sílaba que más la cubre (> 40 ms).
  const owned: number[][] = spans.map(() => []);
  let lo = 0;
  for (let j = 0; j < notes.length; j++) {
    const nt = notes[j];
    while (lo < spans.length && spans[lo].a + maxWord + legato + 1 < nt.start) lo++;
    let bestK = -1;
    let bo = 0.04;
    for (let k = lo; k < spans.length && spans[k].a < nt.end; k++) {
      const ov = overlap(nt.start, nt.end, spans[k].a, spans[k].b);
      if (ov > bo) {
        bo = ov;
        bestK = k;
      }
    }
    if (bestK >= 0) owned[bestK].push(j);
  }

  const out: SungSyllable[] = spans.map((sp, k) => {
    let idx = owned[k];
    if (!idx.length) {
      // Sílaba corta sin nota propia: la que más la cubre, si la cubre algo.
      let best = -1;
      let bo = 0.02;
      for (let j = 0; j < notes.length; j++) {
        const ov = overlap(notes[j].start, notes[j].end, sp.a, sp.b);
        if (ov > bo) {
          bo = ov;
          best = j;
        }
      }
      idx = best >= 0 ? [best] : [];
    }
    idx = idx.slice().sort((x, y) => notes[x].start - notes[y].start);
    let main: number | null = null;
    let mainDur = -Infinity;
    for (const j of idx) {
      const ov = overlap(notes[j].start, notes[j].end, sp.a, sp.b);
      if (ov > mainDur) {
        mainDur = ov;
        main = notes[j].midi;
      }
    }
    const melisma = new Set(idx.map((j) => notes[j].midi)).size >= 2;
    const syl: SungSyllable = {
      text: sp.text,
      start: round(sp.a),
      end: round(sp.b),
      noteIdx: idx,
      midi: main,
      stressed: sp.tonic,
      filler: sp.filler,
      melisma,
      word: sp.word,
    };
    if (sp.speaker !== undefined) syl.speaker = sp.speaker;
    if (melisma) {
      syl.parts = idx.map((j) => ({
        midi: notes[j].midi,
        start: round(Math.max(notes[j].start, sp.a)),
        end: round(Math.min(notes[j].end, sp.b)),
      }));
    }
    return syl;
  });
  markFillerStress(out, notes);
  return out;
}

/** Hueco entre la última nota de `a` y la primera de `b` (o entre sílabas si no hay notas). */
function restBetween(a: SungSyllable, b: SungSyllable, notes: MelodyNote[]): number {
  const la = a.noteIdx.length ? notes[a.noteIdx[a.noteIdx.length - 1]] : undefined;
  const fb = b.noteIdx.length ? notes[b.noteIdx[0]] : undefined;
  if (la && fb) return fb.start - la.end;
  return b.start - a.end;
}

/**
 * Acentos MUSICALES de las corridas de relleno (na/dun/uh): no tienen tónica
 * léxica, así que acentúa la melodía — el primer tiempo de cada grupo (tras
 * un silencio o una nota larga), las notas largas y los picos de altura.
 * Exportada para las tomas sin texto (grid-analysis.ts): mismos acentos que
 * los rellenos de una sesión. Muta `syl[].stressed`.
 */
export function markFillerStress(syl: SungSyllable[], notes: MelodyNote[]): void {
  let k = 0;
  while (k < syl.length) {
    if (!syl[k].filler) {
      k++;
      continue;
    }
    let e = k;
    while (
      e + 1 < syl.length &&
      syl[e + 1].filler &&
      syl[e + 1].speaker === syl[e].speaker &&
      syl[e + 1].start - syl[e].end <= 0.6
    )
      e++;
    const run = syl.slice(k, e + 1);
    const dur = run.map((s) => s.end - s.start);
    const md = median(dur);
    const mids = run.map((s) => s.midi).filter((m): m is number => m != null);
    const medMidi = median(mids);
    const maxMidi = mids.length ? Math.max(...mids) : NaN;
    const isLong = (d: number) => d >= LONG_SYLLABLE_SEC || (d >= 1.5 * md && d >= 0.25);
    run.forEach((s, r) => {
      const groupStart =
        r === 0 || isLong(dur[r - 1]) || restBetween(run[r - 1], s, notes) >= 0.15;
      const peak =
        run.length >= 3 && s.midi != null && s.midi === maxMidi && maxMidi - medMidi >= 2;
      s.stressed = groupStart || isLong(dur[r]) || peak;
    });
    k = e + 1;
  }
}

/**
 * Agrupa sílabas en frases. Corta por: silencio > `gapSec` (0,6) entre
 * sílabas o entre sus NOTAS (la transcripción a veces pega palabras sobre un
 * silencio real), cambio de voz (si la diarización lo sabe), y paso entre una
 * corrida de relleno (2+ sílabas) y letra — "dun dun · hay algo · dun dun"
 * son tres moldes distintos. Calcula el molde de cada frase en modo "respetar".
 */
export function buildPhrases(
  syllables: SungSyllable[],
  notes: MelodyNote[],
  opts: { gapSec?: number } = {},
): Phrase[] {
  const gap = opts.gapSec ?? 0.6;
  const fillerRun = (i: number, dir: 1 | -1): number => {
    let n = 0;
    for (let k = i; k >= 0 && k < syllables.length && syllables[k].filler; k += dir) n++;
    return n;
  };
  const groups: SungSyllable[][] = [];
  let cur: SungSyllable[] | null = null;
  for (let i = 0; i < syllables.length; i++) {
    const s = syllables[i];
    const p = syllables[i - 1];
    let brk = !cur || !p;
    if (!brk && p) {
      const la = p.noteIdx.length ? notes[p.noteIdx[p.noteIdx.length - 1]] : undefined;
      const fb = s.noteIdx.length ? notes[s.noteIdx[0]] : undefined;
      const noteGap = la && fb ? fb.start - la.end : 0;
      const speakerChange = p.speaker !== undefined && s.speaker !== undefined && p.speaker !== s.speaker;
      const kindChange =
        s.word !== p.word &&
        s.filler !== p.filler &&
        (p.filler ? fillerRun(i - 1, -1) : fillerRun(i, 1)) >= 2;
      brk = s.start - p.end > gap || noteGap > gap || speakerChange || kindChange;
    }
    if (brk || !cur) {
      cur = [];
      groups.push(cur);
    }
    cur.push(s);
  }
  return groups.map((g, idx) => {
    const wordMap = new Map<number, number>();
    const syls = g.map((s) => {
      if (!wordMap.has(s.word)) wordMap.set(s.word, wordMap.size);
      return { ...s, word: wordMap.get(s.word) as number };
    });
    const texts: string[] = [];
    for (const s of syls) texts[s.word] = (texts[s.word] ?? "") + s.text;
    const phrase: Phrase = {
      idx,
      start: round(g[0].start),
      end: round(Math.max(...g.map((s) => s.end))),
      text: texts.filter(Boolean).join(" "),
      syllables: syls,
      mold: { syllables: 0, stresses: [], ending: "llana", melismas: [], long: [] },
    };
    phrase.mold = phraseMold(phrase, "respetar");
    return phrase;
  });
}

/**
 * Una posición del molde después de aplicar el modo de melisma, con su tiempo
 * y sus alturas: lo que comparten el molde (`phraseMold`), el eco fonético
 * (`lineFit`) y la guía cantada (`planGuide`). Una sola fuente para las tres
 * para que "la sílaba 6" signifique lo mismo en el chip, en el eco y en lo que
 * suena.
 */
export interface MoldPosition {
  /** 1-based. */
  pos: number;
  /** Índice de la sílaba cantada de la que sale (en `phrase.syllables`). */
  syllable: number;
  /** Ataque y final de la posición (s, relativos al pasaje). */
  start: number;
  end: number;
  /** Acento del molde: tónica léxica o acento musical (al silabizar: la 1ª nota, o una larga). */
  stressed: boolean;
  /** Lo que suena en la posición, en orden: una nota o, en un melisma respetado, varias. */
  notes: { midi: number | null; start: number; end: number }[];
  /** Lo que la posición le pide a una letra (vocal, peso, largo…). */
  info: MoldSlotInfo;
  /** El melisma de la posición (una sílaba sobre varias notas). */
  melisma?: { notes: number; dur: number };
}

/** Compases que se prueban al deducir la métrica de una frase (en orden: 4/4 gana empates). */
const METERS: Meter[] = ["4/4", "3/4", "6/8"];

/**
 * Semicorcheas por segundo que dibuja la frase: pendiente por mínimos
 * cuadrados de paso-vs-ataque de las sílabas con rejilla. La sílaba solo guarda
 * su paso (`metric.absStep`), no el tempo; la pendiente sobre toda la frase
 * absorbe el redondeo a la semicorchea de cada ataque. null con < 2 ataques
 * distintos.
 */
function stepRate(syls: SungSyllable[]): number | null {
  const pts: [number, number][] = [];
  for (const s of syls)
    if (s.metric && Number.isFinite(s.metric.absStep)) pts.push([s.start, s.metric.absStep]);
  if (pts.length < 2) return null;
  const mt = pts.reduce((a, [t]) => a + t, 0) / pts.length;
  const ms = pts.reduce((a, [, k]) => a + k, 0) / pts.length;
  let num = 0;
  let den = 0;
  for (const [t, k] of pts) {
    num += (t - mt) * (k - ms);
    den += (t - mt) ** 2;
  }
  const r = den > 1e-9 ? num / den : NaN;
  return Number.isFinite(r) && r > 0 ? r : null;
}

/**
 * Compás de la toma deducido de sus propias sílabas: el primero cuyos pesos
 * métricos reproducen TODOS los `metric.weight` guardados (la sílaba trae paso
 * y peso, no el compás). Sin ninguno exacto, el que más acierta. Hace falta
 * para pesar las notas internas de un melisma al silabizar.
 */
function meterOf(syls: SungSyllable[]): Meter {
  const withMetric = syls.filter((s) => s.metric);
  let best: Meter = "4/4";
  let bestHits = -1;
  for (const m of METERS) {
    const hits = withMetric.filter((s) => metricWeight(s.metric!.absStep, m) === s.metric!.weight)
      .length;
    if (hits === withMetric.length) return m;
    if (hits > bestHits) {
      bestHits = hits;
      best = m;
    }
  }
  return best;
}

/**
 * Las posiciones del molde de una frase según el modo de melisma.
 *
 * - "respetar": una posición por sílaba cantada; el melisma es UNA posición
 *   con todas sus notas (`melismaNotes`).
 * - "silabizar": cada nota del melisma es su propia posición — la que abre
 *   hereda el acento; las siguientes acentúan solo si son largas; su duración
 *   se mide de ataque a ataque (hasta la nota siguiente o el fin de la sílaba).
 *
 * Por posición (`info`):
 * - `vowel`: la del fonema (`SungSyllable.vowel`) y, si no la trae, la del
 *   texto — pero SOLO en rellenos/tarareo: en una palabra real no se le exige
 *   vocal a la letra nueva (el eco mide lo que se TARAREÓ).
 * - `weight`: con rejilla, el peso métrico del ataque (las notas internas de un
 *   melisma silabizado, el de SU posición: paso = ataque de la sílaba + tiempo
 *   × semicorcheas/s de la frase, sobre el compás que la frase delata); sin
 *   rejilla, 3 si la posición es acento del molde y 1 si no.
 * - `len16`: con rejilla, el largo en semicorcheas (≥ 1). Sale de la duración ×
 *   la tasa de la frase: la sílaba no guarda el tempo. Sin tasa (una sola
 *   sílaba con rejilla), no se inventa.
 */
export function moldPositions(phrase: Phrase, mode: MelismaMode): MoldPosition[] {
  const syls = phrase.syllables;
  const hasMetric = syls.some((s) => s.metric);
  const rate = hasMetric ? stepRate(syls) : null;
  const meter = hasMetric ? meterOf(syls) : null;
  const len16Of = (d: number): number | undefined =>
    rate != null ? Math.max(1, Math.round(d * rate)) : undefined;
  const out: MoldPosition[] = [];
  syls.forEach((s, si) => {
    const dur = s.end - s.start;
    const vowel: Vowel | undefined =
      s.vowel ?? (s.filler ? (vowelOfText(s.text) ?? undefined) : undefined);
    const base = (d: number, long: boolean): MoldSlotInfo => {
      const info: MoldSlotInfo = { dur: round(d), long, filler: s.filler };
      if (vowel) info.vowel = vowel;
      return info;
    };
    if (mode === "silabizar" && s.melisma && s.noteIdx.length >= 2) {
      const parts =
        s.parts && s.parts.length >= 2
          ? s.parts
          : s.noteIdx.map((_, k) => {
              const step = dur / s.noteIdx.length;
              const start = s.start + k * step;
              return { midi: s.midi ?? 0, start, end: start + step };
            });
      const hasParts = !!(s.parts && s.parts.length >= 2);
      parts.forEach((p, k) => {
        // Duración musical de ataque a ataque: hasta la siguiente nota o el fin de la sílaba.
        const next = k + 1 < parts.length ? parts[k + 1].start : s.end;
        const d = next - p.start;
        const long = d >= LONG_SYLLABLE_SEC;
        const stressed = k === 0 ? s.stressed : long;
        const info = base(d, long);
        if (s.metric && k === 0) info.weight = s.metric.weight;
        else if (s.metric && rate != null && meter)
          info.weight = metricWeight(
            s.metric.absStep + Math.round((p.start - s.start) * rate),
            meter,
          );
        else info.weight = stressed ? 3 : 1;
        const l16 = s.metric ? len16Of(d) : undefined;
        if (l16 != null) info.len16 = l16;
        out.push({
          pos: out.length + 1,
          syllable: si,
          start: p.start,
          end: next,
          stressed,
          notes: [{ midi: hasParts ? p.midi : s.midi, start: p.start, end: next }],
          info,
        });
      });
      return;
    }
    const long = dur >= LONG_SYLLABLE_SEC;
    const info = base(dur, long);
    info.weight = s.metric ? s.metric.weight : s.stressed ? 3 : 1;
    const l16 = s.metric ? len16Of(dur) : undefined;
    if (l16 != null) info.len16 = l16;
    const pos: MoldPosition = {
      pos: out.length + 1,
      syllable: si,
      // El ataque del melisma es su primera nota (la vocal tiene que caer ahí).
      start: s.parts?.length ? Math.max(s.start, s.parts[0].start) : s.start,
      end: s.end,
      stressed: s.stressed,
      notes: s.parts?.length
        ? s.parts.map((p) => ({ midi: p.midi, start: p.start, end: p.end }))
        : [{ midi: s.midi, start: s.start, end: s.end }],
      info,
    };
    if (s.melisma) {
      pos.melisma = { notes: s.noteIdx.length, dur: round(dur, 2) };
      info.melismaNotes = s.noteIdx.length;
    }
    out.push(pos);
  });
  return out;
}

/**
 * Lo que pide CADA posición del molde (vocal del tarareo, peso métrico, largo,
 * relleno, notas del melisma) según el modo de melisma. Índice = posición − 1.
 * Es la parte medible de `moldPositions`; `phraseMold` la guarda en `slots`.
 */
export function moldSlots(phrase: Phrase, mode: MelismaMode): MoldSlotInfo[] {
  return moldPositions(phrase, mode).map((p) => p.info);
}

/**
 * El molde de una frase según el modo de melisma. "respetar": una sílaba por
 * sílaba cantada (el melisma cuenta 1, se lista en `melismas` y pide vocal
 * abierta). "silabizar": cada nota del melisma suma una sílaba (acentos y
 * posiciones se reubican; la nota que abre el melisma hereda el acento y las
 * siguientes solo acentúan si son largas). `long` = sílabas (o notas, al
 * silabizar) que duran ≥ 0,6 s, medidas de ataque a ataque.
 *
 * Final: la última sílaba acentuada — en palabras, la tónica léxica; en
 * rellenos, el acento musical o una nota larga — a 0/1/2+ sílabas del final =
 * aguda/llana/esdrújula. La corrección humana (`phrase.override`) manda: sus
 * sílabas cuentan en modo "respetar" (al silabizar se le suman las notas
 * extra de los melismas).
 *
 * `slots` (lo que pide cada posición, ver `moldSlots`) se recorta al conteo
 * del molde, como los acentos: una posición que ya no cabe no pide nada.
 */
export function phraseMold(phrase: Phrase, mode: MelismaMode): PhraseMold {
  const ps = moldPositions(phrase, mode);
  const n = ps.length;
  const ending = moldEnding(ps);
  const extra = n - phrase.syllables.length;
  const ov = phrase.override;
  const count =
    ov?.syllables != null && Number.isFinite(ov.syllables)
      ? Math.max(0, Math.round(ov.syllables) + (mode === "silabizar" ? extra : 0))
      : n;
  const positions = (pred: (p: MoldPosition) => boolean): number[] =>
    ps.flatMap((p, i) => (pred(p) && i + 1 <= count ? [i + 1] : []));
  const mold: PhraseMold = {
    syllables: count,
    stresses: positions((p) => p.stressed),
    ending: ov?.ending ?? ending,
    melismas: ps.flatMap((p, i) =>
      p.melisma && i + 1 <= count
        ? [{ pos: i + 1, notes: p.melisma.notes, dur: p.melisma.dur }]
        : [],
    ),
    long: positions((p) => p.info.long),
  };
  if (ov?.rhyme) mold.rhyme = ov.rhyme;
  mold.slots = ps.slice(0, count).map((p) => p.info);
  return mold;
}

function moldEnding(ps: MoldPosition[]): LineEnding {
  const n = ps.length;
  if (!n) return "llana";
  for (let k = n - 1; k >= Math.max(0, n - 3); k--) {
    const p = ps[k];
    if (p.stressed || (p.info.filler && p.info.long)) return endingAt(n - 1 - k);
  }
  // Sin acento en las 3 últimas (frase que cierra en átonas): una nota larga
  // decide; si no, llana, el final más común del español.
  for (let k = n - 1; k >= Math.max(0, n - 3); k--) if (ps[k].info.long) return endingAt(n - 1 - k);
  return "llana";
}

const endingAt = (fromEnd: number): LineEnding =>
  fromEnd <= 0 ? "aguda" : fromEnd === 1 ? "llana" : "esdrujula";

/**
 * Clasifica un pasaje por lo que se cantó: "silabas" (casi todo relleno
 * na/dun/uh), "melisma" (sílabas estiradas sobre varias notas, o vocalización
 * sin texto), "rap" (letra densa: sílabas cortas sin melismas), "mixto"
 * (letra y relleno a la par) o "letra". Umbrales puestos a mano sobre la
 * sesión de referencia, no ajustados a etiquetas.
 */
export function classifyPassage(syllables: SungSyllable[], words: TimedWord[]): PassageKind {
  const n = syllables.length;
  if (!n) return "melisma";
  const fillerN = syllables.filter((s) => s.filler).length;
  const lyric = syllables.filter((s) => !s.filler);
  const fillerFrac = fillerN / n;
  const melismaFrac = syllables.filter((s) => s.melisma).length / n;
  const lyricMelisma = lyric.length ? lyric.filter((s) => s.melisma).length / lyric.length : 0;
  const ioi = median(lyric.map((s) => s.end - s.start));
  const ws = words.filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end));
  const span = ws.length ? Math.max(...ws.map((w) => w.end)) - Math.min(...ws.map((w) => w.start)) : 0;
  const wordRate = span > 0 ? ws.length / span : 0;
  const rapLike = lyric.length >= 12 && ioi <= 0.17 && lyricMelisma < 0.1 && wordRate >= 2.8;
  if (rapLike && fillerFrac < 0.3) return "rap";
  if (fillerFrac >= 0.8 || lyric.length < 4) return melismaFrac >= 0.35 ? "melisma" : "silabas";
  if (fillerFrac >= 0.25) return "mixto";
  if (melismaFrac >= 0.35) return "melisma";
  return "letra";
}

// ─────────────────────────── Tonalidad ───────────────────────────

/** Perfil de 12 clases de altura ponderado por duración (C = 0), normalizado a suma 1. */
export function pitchClassProfile(notes: MelodyNote[]): number[] {
  const h = new Array<number>(12).fill(0);
  for (const nt of notes) {
    const d = nt.end - nt.start;
    if (d > 0 && Number.isFinite(nt.midi)) h[mod12(Math.round(nt.midi))] += d;
  }
  const total = h.reduce((a, b) => a + b, 0);
  return total > 0 ? h.map((x) => x / total) : h;
}

// Perfiles de Krumhansl-Kessler (1982) y de Temperley (2001), tónica = índice 0.
const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const TP_MAJOR = [0.748, 0.06, 0.488, 0.082, 0.67, 0.46, 0.096, 0.715, 0.104, 0.366, 0.057, 0.4];
const TP_MINOR = [0.712, 0.084, 0.474, 0.618, 0.049, 0.46, 0.105, 0.747, 0.404, 0.067, 0.133, 0.33];

function keyCorrelation(profile: number[], template: number[], tonic: number): number {
  const n = 12;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += profile[i];
    mb += template[i];
  }
  ma /= n;
  mb /= n;
  let s = 0;
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < n; i++) {
    const a = profile[i] - ma;
    const b = template[mod12(i - tonic)] - mb;
    s += a * b;
    sa += a * a;
    sb += b * b;
  }
  return sa > 0 && sb > 0 ? s / Math.sqrt(sa * sb) : 0;
}

/** Correlaciones de KK más cerca que esto se consideran empate (lo decide Temperley). */
const KEY_TIE = 0.02;
/** Margen KK entre la 1ª y la 2ª a partir del cual la tonalidad deja de estar en duda. */
const KEY_CLEAR_MARGIN = 0.2;

/**
 * Krumhansl-Schmuckler con perfiles de Krumhansl-Kessler; si la 1ª y otras
 * empatan (≤ 0,02) desempata el perfil de Temperley. Candidatas = top-3 por
 * correlación. `confidence` = margen KK sobre la 2ª normalizado (0,2 = clara)
 * y atenuado si la mejor correlación es floja (< 0,6): una relativa
 * mayor/menor casi empatada da confianza baja — la UI la muestra como
 * ambigua y decide el humano. Medido en la sesión real: guitarra r=0,57 con
 * margen 0,12; voz r=0,40–0,71 con márgenes 0,05–0,12.
 */
export function estimateKey(profile: number[], source: KeyEstimate["source"]): KeyEstimate {
  const p = Array.from({ length: 12 }, (_, i) => (Number.isFinite(profile[i]) ? profile[i] : 0));
  const all: { key: Key; kk: number; tp: number }[] = [];
  for (const mode of ["major", "minor"] as const) {
    const kkT = mode === "major" ? KK_MAJOR : KK_MINOR;
    const tpT = mode === "major" ? TP_MAJOR : TP_MINOR;
    for (let t = 0; t < 12; t++) {
      all.push({
        key: { tonic: t, mode },
        kk: keyCorrelation(p, kkT, t),
        tp: keyCorrelation(p, tpT, t),
      });
    }
  }
  all.sort((a, b) => b.kk - a.kk);
  const tied = all.filter((x) => all[0].kk - x.kk <= KEY_TIE);
  const best = tied.reduce((a, b) => (b.tp > a.tp ? b : a), tied[0]);
  const ordered = [best, ...all.filter((x) => x !== best)];
  const cand = (x: (typeof all)[number]): KeyCandidate => ({ key: x.key, score: round(clamp01(x.kk)) });
  const margin = Math.max(0, best.kk - ordered[1].kk);
  const fit = clamp01(Math.max(0, best.kk) / 0.6);
  return {
    best: cand(best),
    candidates: ordered.slice(0, 3).map(cand),
    confidence: round(clamp01(margin / KEY_CLEAR_MARGIN) * fit, 2),
    source,
  };
}

/** Tónica de la menor relativa: mayor y su relativa menor son la misma escala. */
const relMinorTonic = (k: Key): number => (k.mode === "minor" ? mod12(k.tonic) : mod12(k.tonic + 9));

/**
 * Semitonos para llevar un memo de `from` a `to`, el camino más corto
 * (−6..+5; el trítono se resuelve hacia abajo). Mayor/menor relativas cuentan
 * como la misma escala: un memo en Re♭ mayor hacia una canción en Si menor se
 * mide contra Si♭ menor → +1.
 */
export function semitonesToKey(from: Key, to: Key): number {
  const d = mod12(relMinorTonic(to) - relMinorTonic(from));
  return d > 5 ? d - 12 : d;
}

export function transposeNotes(notes: MelodyNote[], semitones: number): MelodyNote[] {
  return notes.map((n) => ({ ...n, midi: n.midi + semitones }));
}

/**
 * Por nota: ¿cae fuera de la escala de `key`? En menor se usa la natural y se
 * tolera la sensible (la tercera del V mayor: Sol♯ en La menor).
 */
export function outOfKey(notes: MelodyNote[], key: Key): boolean[] {
  const scale = new Set(scaleNotes(key));
  if (key.mode === "minor") scale.add(mod12(key.tonic + 11));
  return notes.map((n) => !scale.has(mod12(Math.round(n.midi))));
}

// ─────────────────────────── Letra contra molde ───────────────────────────

const OPEN_VOWELS = "aeoáéó";
const ENDING_LABEL: Record<LineEnding, string> = { aguda: "aguda", llana: "llana", esdrujula: "esdrújula" };

/** Vocal núcleo de una sílaba: la fuerte (a/e/o, o í/ú con tilde); si no, la última débil. */
function nucleusVowel(syl: string): string | null {
  const strong = [...syl].find((c) => "aeoáéóíú".includes(c));
  if (strong) return strong;
  const weak = [...syl].filter((c) => "iuüy".includes(c));
  return weak.length ? weak[weak.length - 1] : null;
}

const PLAIN_VOWEL: Record<string, Vowel> = {
  a: "a", á: "a", e: "e", é: "e", i: "i", í: "i", y: "i",
  o: "o", ó: "o", u: "u", ú: "u", ü: "u",
};

/**
 * La vocal que CANTA una sílaba de la letra (su núcleo, sin tilde); "m" si es
 * un murmullo sin vocal ("mm"). Es la que se compara con la del tarareo.
 */
function lineVowel(syl: string | undefined): Vowel | null {
  if (!syl) return null;
  const v = nucleusVowel(syl);
  if (v) return PLAIN_VOWEL[v] ?? null;
  return /^[hm ]+$/.test(syl) && syl.includes("m") ? "m" : null;
}

const endsInVowel = (w: string): boolean => /[aeiouáéíóúüy]$/.test(w);
const startsWithVowel = (w: string): boolean => w === "y" || /^h?[aeiouáéíóúü]/.test(w);

interface LineSyl {
  text: string;
  tonic: boolean;
  /** Índice de la palabra en la línea. */
  word: number;
}

/** Una línea partida en sílabas, con las fronteras entre palabras donde cabe sinalefa. */
interface ParsedLine {
  words: LineSyl[][];
  norm: string[];
  flat: LineSyl[];
  /** Índice (en `flat`) de la última sílaba de cada palabra que puede unirse a la siguiente. */
  boundaries: number[];
  /** Sílabas con todas las sinalefas / sin ninguna. */
  min: number;
  max: number;
}

function parseLine(text: string): ParsedLine {
  const raw = stripChords(text)
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => normWord(w));
  const norm = raw.map(normWord);
  const fill = fillerFlags(raw.map((t) => ({ text: t })));
  const words = norm.map((w, i) => {
    const syl = fill[i] ? fillerSyllables(w) : splitSyllables(w);
    const tonic = fill[i] ? 0 : isAtonic(w) ? -1 : stressedSyllable(w);
    return syl.map((s, k): LineSyl => ({ text: s, tonic: k === tonic, word: i }));
  });
  const flat = words.flat();
  // Fronteras entre palabras donde cabe sinalefa (vocal + vocal, la h es muda).
  const boundaries: number[] = [];
  let acc = 0;
  for (let i = 0; i < words.length; i++) {
    acc += words[i].length;
    if (i + 1 < words.length && endsInVowel(norm[i]) && startsWithVowel(norm[i + 1]))
      boundaries.push(acc - 1);
  }
  return { words, norm, flat, boundaries, min: flat.length - boundaries.length, max: flat.length };
}

/** Una sílaba de la lectura: con sinalefa, las dos sílabas unidas por un espacio ("y al"). */
interface ReadSyl {
  text: string;
  tonic: boolean;
  /** Palabra que pone la tónica (o la primera de la sílaba). */
  word: number;
}

interface Reading {
  count: number;
  hits: number;
  slots: ReadSyl[];
  vowelOk: number;
  merges: number;
  misaccents: { pos: number; syl: string; word: number }[];
  echo: NonNullable<LineFit["echo"]> | null;
  /** Sílabas tónicas de la línea en esta lectura. */
  tonics: number;
}

/**
 * Una tónica en posición débil es malacento si además es CORTA: ≤ 2 semicorcheas
 * con rejilla; sin rejilla, < 0,3 s. Larga, se sostiene y el oído la acepta.
 */
const SHORT_LEN16 = 2;
const SHORT_SEC = 0.3;

/**
 * La lectura de sinalefas que mejor calza con el molde, en este orden: número
 * de sílabas, tónicas sobre acentos del molde, vocal del melisma, menos
 * malacentos, más eco del tarareo y, al final, menos sinalefas (la lectura más
 * natural). Sin `slots` en el molde los dos criterios nuevos empatan siempre:
 * se elige exactamente lo mismo que antes.
 */
function chooseReading(p: ParsedLine, mold: PhraseMold, mode: MelismaMode): Reading {
  const { flat, boundaries } = p;
  const target = mold.syllables;
  const info = mold.slots ?? [];
  const melismaCheck = mode === "respetar" && mold.melismas.length > 0;
  const stressSet = new Set(mold.stresses);
  // Eco: solo en posiciones de TARAREO con vocal conocida.
  const echoPos = info.flatMap((s, i) =>
    s.filler && s.vowel ? [{ pos: i + 1, want: s.vowel, s }] : [],
  );
  const useLen = echoPos.length > 0 && echoPos.every((x) => x.s.len16 != null && x.s.len16 > 0);
  let ws = echoPos.map((x) => Math.max(0, useLen ? (x.s.len16 as number) : x.s.dur));
  if (!(ws.reduce((a, b) => a + b, 0) > 0)) ws = echoPos.map(() => 1);
  const wsum = ws.reduce((a, b) => a + b, 0);

  const read = (mask: number): Reading => {
    const slots: ReadSyl[] = [];
    const merge = new Set<number>();
    boundaries.forEach((b, k) => {
      if (mask & (1 << k)) merge.add(b);
    });
    for (let i = 0; i < flat.length; i++) {
      const f = flat[i];
      if (i > 0 && merge.has(i - 1)) {
        const last = slots[slots.length - 1];
        slots[slots.length - 1] = {
          text: `${last.text} ${f.text}`,
          tonic: last.tonic || f.tonic,
          word: last.tonic || !f.tonic ? last.word : f.word,
        };
      } else slots.push({ text: f.text, tonic: f.tonic, word: f.word });
    }
    let hits = 0;
    slots.forEach((s, i) => {
      if (s.tonic && stressSet.has(i + 1)) hits++;
    });
    let vowelOk = 0;
    if (melismaCheck)
      for (const m of mold.melismas)
        if (melismaVowelAccepted(slots[m.pos - 1]?.text, info[m.pos - 1]?.vowel)) vowelOk++;
    const misaccents: Reading["misaccents"] = [];
    if (info.length)
      slots.forEach((s, i) => {
        // Una tónica sobre un acento de la melodía es un acierto, nunca un malacento.
        if (!s.tonic || stressSet.has(i + 1)) return;
        const at = info[i];
        if (!at) return;
        const short = !at.long && (at.len16 != null ? at.len16 <= SHORT_LEN16 : at.dur < SHORT_SEC);
        if ((at.weight ?? 1) <= 1 && short)
          misaccents.push({ pos: i + 1, syl: s.text, word: s.word });
      });
    let echo: Reading["echo"] = null;
    if (echoPos.length) {
      const perSlot = echoPos.map((x, k) => {
        const got = lineVowel(slots[x.pos - 1]?.text);
        const sim = got ? vowelSimilarity(x.want, got) : 0;
        return { pos: x.pos, want: x.want, got, sim, w: round(ws[k]) };
      });
      const sc = perSlot.reduce((a, x, k) => a + ws[k] * x.sim, 0) / wsum;
      echo = { score: round(sc, 2), perSlot };
    }
    return {
      count: slots.length,
      hits,
      slots,
      vowelOk,
      merges: merge.size,
      misaccents,
      echo,
      tonics: slots.filter((s) => s.tonic).length,
    };
  };
  const better = (r: Reading, b: Reading): boolean => {
    const d = Math.abs(r.count - target) - Math.abs(b.count - target);
    if (d !== 0) return d < 0;
    if (r.hits !== b.hits) return r.hits > b.hits;
    if (r.vowelOk !== b.vowelOk) return r.vowelOk > b.vowelOk;
    const dm = r.misaccents.length - b.misaccents.length;
    if (dm !== 0) return dm < 0;
    const re = r.echo?.score ?? 0;
    const be = b.echo?.score ?? 0;
    if (Math.abs(re - be) > 1e-9) return re > be;
    return r.merges < b.merges;
  };
  // Todas las lecturas si son pocas fronteras (lo normal: ≤ 5); si no, las extremas.
  const masks: number[] = [];
  if (boundaries.length <= 12) for (let m = 0; m < 1 << boundaries.length; m++) masks.push(m);
  else masks.push(0, (1 << 30) - 1);
  let best: Reading | null = null;
  for (const m of masks) {
    const r = read(m);
    if (!best || better(r, best)) best = r;
  }
  return best ?? read(0);
}

/**
 * ¿Sirve la vocal de la letra en un melisma? Abierta (a/e/o, la que se
 * sostiene) o la MISMA que se tarareó ahí: si el tarareo estiraba una "u",
 * una "u" en la letra también canta.
 */
function melismaVowelAccepted(syl: string | undefined, hummed: Vowel | undefined): boolean {
  const v = lineVowel(syl);
  return isOpenVowel(v) || (!!hummed && v === hummed);
}

/**
 * FASE C: las sílabas de la línea en la lectura de sinalefas que mejor calza
 * con el molde (la MISMA que elige `lineFit`), para alinearlas con la melodía
 * y cantarlas. Una sinalefa une sus dos sílabas con un espacio ("y al",
 * "ro aun"): se lee como se canta y la alineación del TTS reparte ese espacio.
 */
export function lineReading(text: string, mold: PhraseMold, mode: MelismaMode): string[] {
  return chooseReading(parseLine(text), mold, mode).slots.map((s) => s.text);
}

/** "«a»", "«a» y «b»", "«a», «b» y «c»". */
function quoteList(xs: string[]): string {
  const q = xs.map((x) => `«${x}»`);
  return q.length <= 1 ? (q[0] ?? "") : `${q.slice(0, -1).join(", ")} y ${q[q.length - 1]}`;
}

/**
 * Mide una línea de letra contra el molde. Cuenta sílabas CANTADAS
 * (fonéticas: sin el +1/−1 poético de agudas y esdrújulas) con su rango [con
 * todas las sinalefas posibles, sin ninguna]; elige la lectura de sinalefas
 * que mejor calza (ver `chooseReading`) y sobre ESA mide: `syllables` es el
 * conteo de esa lectura (= el objetivo si cabe en el rango), `stressHits` las
 * tónicas de la línea que caen en acentos del molde, y en modo "respetar" si la
 * sílaba de cada melisma lleva vocal abierta (a/o/e) o la misma del tarareo.
 *
 * Con `slots` en el molde (moldes nuevos) mide además:
 * - `echo`: cuánto conserva la línea las vocales del TARAREO, solo en
 *   posiciones de relleno con vocal, ponderado por el largo (semicorcheas si
 *   todas lo traen; si no, segundos).
 * - `misaccents`: tónicas de la línea en posiciones débiles (peso ≤ 1) y
 *   cortas que no son acento de la melodía — se oyen mal acentuadas.
 *
 * Puntaje: sílabas 0,4 · final 0,15 · acentos 0,15 · melisma 0,1 · eco 0,1 ·
 * malacentos 0,1, normalizado sobre los componentes que existen. Un molde
 * VIEJO (sin `slots`) no tiene eco ni malacentos y conserva exactamente sus
 * pesos de siempre (0,45 · 0,2 · 0,2 · 0,15): las proporciones nuevas no
 * reproducen las viejas al normalizar, y un puntaje guardado no debe cambiar
 * solo porque cambió el código.
 *
 * Devuelve un `hint` corto cuando no calza. La corrección humana ya viene
 * aplicada en `mold`.
 */
export function lineFit(text: string, mold: PhraseMold, mode: MelismaMode): LineFit {
  const p = parseLine(text);
  const { words, norm, min, max } = p;
  const reading = chooseReading(p, mold, mode);
  const info = mold.slots ?? [];
  const hasSlots = info.length > 0;
  const target = mold.syllables;
  const melismaCheck = mode === "respetar" && mold.melismas.length > 0;

  const lastWord = words[words.length - 1];
  const lastTonic = lastWord ? lastWord.findIndex((s) => s.tonic) : -1;
  const ending: LineEnding = lastWord
    ? endingAt(lastWord.length - 1 - (lastTonic >= 0 ? lastTonic : stressedSyllable(norm[norm.length - 1])))
    : mold.ending;
  const syllablesOk = max > 0 && min <= target && target <= max;
  const endingOk = ending === mold.ending;
  const stressTotal = mold.stresses.length;
  const melismaVowelOk = melismaCheck ? reading.vowelOk === mold.melismas.length : null;

  // Puntaje: las sílabas pesan más (una línea que no cabe no se canta).
  const W = hasSlots
    ? { syl: 0.4, end: 0.15, stress: 0.15, melisma: 0.1 }
    : { syl: 0.45, end: 0.2, stress: 0.2, melisma: 0.15 };
  const off = syllablesOk ? 0 : target < min ? min - target : target - max;
  const parts: [number, number][] = [
    [max ? Math.max(0, 1 - 0.34 * off) : 0, W.syl],
    [endingOk ? 1 : 0, W.end],
    [stressTotal ? reading.hits / stressTotal : 1, W.stress],
  ];
  if (melismaCheck) parts.push([reading.vowelOk / mold.melismas.length, W.melisma]);
  if (reading.echo) parts.push([reading.echo.score, 0.1]);
  if (hasSlots)
    parts.push([reading.tonics ? 1 - reading.misaccents.length / reading.tonics : 1, 0.1]);
  const wsum = parts.reduce((a, [, w]) => a + w, 0);
  const score = round(parts.reduce((a, [v, w]) => a + v * w, 0) / wsum, 2);

  let hint: string | undefined;
  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
  if (!max) hint = "escribe la línea";
  else if (!syllablesOk && target < min)
    hint = `${plural(min - target, "sobra", "sobran")} ${min - target} ${plural(min - target, "sílaba", "sílabas")}`;
  else if (!syllablesOk)
    hint = `${plural(target - max, "falta", "faltan")} ${target - max} ${plural(target - max, "sílaba", "sílabas")}`;
  else if (!endingOk) hint = `termina ${ENDING_LABEL[ending]}, la melodía pide ${ENDING_LABEL[mold.ending]}`;
  else if (melismaVowelOk === false) {
    const bad = mold.melismas.find(
      (m) => !melismaVowelAccepted(reading.slots[m.pos - 1]?.text, info[m.pos - 1]?.vowel),
    );
    if (bad) {
      const v = reading.slots[bad.pos - 1] ? nucleusVowel(reading.slots[bad.pos - 1].text) : null;
      const hummed = info[bad.pos - 1]?.vowel;
      hint = `el melisma de la sílaba ${bad.pos} cae en «${v ?? "?"}»: busca a/o/e${
        hummed && !isOpenVowel(hummed) ? ` (o «${hummed}», como el tarareo)` : ""
      }`;
    }
  } else if (reading.misaccents.length) {
    const ws = [...new Set(reading.misaccents.map((m) => norm[m.word]))];
    hint =
      ws.length === 1
        ? `${quoteList(ws)} carga el acento en un tiempo débil`
        : `${quoteList(ws)} cargan el acento en tiempos débiles`;
  } else if (reading.echo && reading.echo.score < 0.5) {
    // La posición que más le cuesta al eco: la más larga entre las que menos se parecen.
    const cost = (x: { w: number; sim: number }): number => x.w * (1 - x.sim);
    const worst = reading.echo.perSlot.reduce((a, x) => (cost(x) > cost(a) ? x : a));
    hint = `en la sílaba ${worst.pos} el tarareo decía «${worst.want}»; ${
      worst.got
        ? `«${worst.got}» ${worst.sim === 0 ? "no se parece" : "se parece poco"}`
        : "la línea no llega"
    }`;
  } else if (stressTotal && reading.hits / stressTotal < 0.5)
    hint = `los acentos caen fuera de la melodía (${reading.hits} de ${stressTotal})`;

  const fit: LineFit = {
    syllables: reading.count,
    range: [min, max],
    target,
    syllablesOk,
    ending,
    endingOk,
    stressHits: reading.hits,
    stressTotal,
    melismaVowelOk,
    score: max ? score : 0,
    reading: reading.slots.map((s) => s.text),
  };
  if (hint) fit.hint = hint;
  if (reading.echo) fit.echo = reading.echo;
  if (hasSlots) fit.misaccents = reading.misaccents.map((m) => ({ pos: m.pos, syl: m.syl }));
  return fit;
}

// ─────────────────────────── Onda y dibujo ───────────────────────────

/** Picos absolutos normalizados 0..1 en `buckets` cubetas. */
export function peaksOf(pcm: Float32Array, buckets: number): number[] {
  const nb = Math.max(0, Math.floor(buckets));
  const out = new Array<number>(nb).fill(0);
  if (!nb || !pcm.length) return out;
  let gmax = 0;
  for (let b = 0; b < nb; b++) {
    const a = Math.floor((b * pcm.length) / nb);
    const e = Math.max(a + 1, Math.floor(((b + 1) * pcm.length) / nb));
    let m = 0;
    for (let i = a; i < e && i < pcm.length; i++) {
      const v = Math.abs(pcm[i]);
      if (v > m) m = v;
    }
    out[b] = m;
    if (m > gmax) gmax = m;
  }
  return gmax > 0 ? out.map((v) => round(v / gmax)) : out;
}

/**
 * Curva MIDI remuestreada a `hopSec` (mediana por cubeta; null = sin voz en
 * la mayoría de sus cuadros), para dibujar. Va SIN corregir afinación, como
 * la pista: para dibujarla sobre las notas réstale `tuningCents / 100`.
 */
export function downsampleF0(track: PitchTrack, hopSec: number): (number | null)[] {
  const n = track.midi.length;
  if (!n || !(hopSec > 0)) return [];
  const per = hopSec / track.hopSec;
  const nb = Math.max(1, Math.ceil(n / per));
  const out: (number | null)[] = [];
  for (let b = 0; b < nb; b++) {
    const a = Math.floor(b * per);
    const e = Math.min(n, Math.max(a + 1, Math.floor((b + 1) * per)));
    const v: number[] = [];
    for (let i = a; i < e; i++) if (Number.isFinite(track.midi[i])) v.push(track.midi[i]);
    out.push(v.length * 2 >= e - a && v.length ? round(median(v), 2) : null);
  }
  return out;
}

// ─────────────────────────── Detección de pasajes ───────────────────────────

/** Palabra de la transcripción de la SESIÓN (tiempos de sesión). */
export interface TranscriptWord {
  text: string;
  start: number;
  end: number;
  speaker?: string;
  type: "word" | "audio_event";
}

/** Rasgos acústicos por segundo de la voz aislada (opcionales: sin stem no hay). */
export interface AcousticSecond {
  t: number;
  /** Fracción de cuadros con voz en ese segundo. */
  voiced: number;
  /** Fracción del segundo cubierta por notas sostenidas (≥ 0,25 s, lo medido). */
  sustained: number;
}

/**
 * Rasgos por segundo de una pista de voz (idealmente el stem aislado de la
 * sesión completa): voz y notas sostenidas. `t` en segundos desde el inicio
 * del PCM de la pista.
 */
export function acousticSeconds(
  track: PitchTrack,
  notes: MelodyNote[],
  opts: { durationSec?: number; sustainMinSec?: number } = {},
): AcousticSecond[] {
  const dur = opts.durationSec ?? track.midi.length * track.hopSec;
  const N = Math.max(0, Math.ceil(dur));
  const minSec = opts.sustainMinSec ?? 0.25;
  const voiced = new Float64Array(N);
  const frames = new Float64Array(N);
  for (let i = 0; i < track.midi.length; i++) {
    const s = Math.floor(i * track.hopSec);
    if (s >= N) break;
    frames[s]++;
    if (Number.isFinite(track.midi[i])) voiced[s]++;
  }
  const sus = new Float64Array(N);
  for (const nt of notes) {
    if (nt.end - nt.start < minSec) continue;
    for (let s = Math.max(0, Math.floor(nt.start)); s < Math.ceil(nt.end) && s < N; s++)
      sus[s] += Math.max(0, Math.min(nt.end, s + 1) - Math.max(nt.start, s));
  }
  return Array.from({ length: N }, (_, s) => ({
    t: s,
    voiced: frames[s] ? round(voiced[s] / frames[s]) : 0,
    sustained: round(Math.min(1, sus[s])),
  }));
}

export interface PassageCandidate {
  start: number;
  end: number;
  speaker?: string;
  text: string;
  score: number;
  evidence: string[];
  kind: PassageKind;
  /** "probable" (tramo sobre el umbral) o "dudoso" (entre 0,2 y el umbral). */
  group?: "probable" | "dudoso";
}

/** Evento de audio que indica canto ("[canta]", "[cantan]", "[singing]", tarareo). */
const SUNG_EVENT = /cant|sing|tarare|humm/i;
/** Ventana (s) de la recurrencia local: una línea que se itera al componer vuelve en minutos. */
const RECUR_WINDOW = 60;
/** Trigramas de conversación que se repiten sin ser letra. */
const TRIGRAM_STOP = new Set(["algo así como", "o sea como", "así como que", "no no no", "sí sí sí"]);

const fmtNum = (x: number, d = 1): string => x.toFixed(d).replace(".", ",");

/**
 * Pasajes cantados de una sesión larga combinando pistas por segundo: evento
 * "[canta]" (0,5), rellenos repetidos na/dun/uh (0,4), líneas de letra que se
 * repiten 3+ veces en la sesión Y 2+ veces en ±60 s (0,35, suavizado a 5 s —
 * la recurrencia que importa es la LOCAL: iterar una línea al componer; una
 * frase dicha una vez lejos de sus repeticiones es conversación), líneas de letra del resumen
 * (0,3), rasgos acústicos del stem (0,35) y castigo a la densidad de habla
 * (−0,08 por palabra/s sobre 2). Medido: AUC 0,959 por segundo contra
 * 0,61–0,67 de cada pista sola; ningún pasaje del combinado era solo habla.
 * Pesos puestos a mano, no ajustados a etiquetas. Umbral default 0,35 →
 * "probable"; entre 0,2 y el umbral → "dudoso". Tramos: huecos ≤ 2 s se
 * unen, mínimo 4 s.
 */
export function detectPassages(
  words: TranscriptWord[],
  opts: {
    durationSec: number;
    acoustic?: AcousticSecond[];
    threshold?: number;
    /** Líneas marcadas como letra por el resumen (tiempos de sesión). */
    lyricLines?: { text: string; at: number }[];
  },
): PassageCandidate[] {
  const N = Math.max(0, Math.ceil(opts.durationSec));
  if (!N) return [];
  const thr = opts.threshold ?? 0.35;
  const low = Math.min(0.2, thr);
  const inRange = (s: number) => s >= 0 && s < N;
  const events = words.filter((w) => w.type === "audio_event" && SUNG_EVENT.test(w.text));
  const ws = words
    .filter((w) => w.type === "word" && Number.isFinite(w.start))
    .slice()
    .sort((a, b) => a.start - b.start);
  const toks = ws.map((w) => normWord(w.text));
  const isF = fillerFlags(ws);

  // (1) Evento de canto, con 1 s de margen.
  const sing = new Float64Array(N);
  for (const w of events)
    for (let s = Math.floor(w.start) - 1; s <= Math.ceil(Math.max(w.end, w.start + 2)) + 1; s++)
      if (inRange(s)) sing[s] = 1;
  // (2) Relleno REPETIDO: uno suelto no basta ("la" suelto es artículo).
  const fill = new Float64Array(N);
  const fillRep = ws.map(
    (w, i) =>
      isF[i] &&
      ((i > 0 && isF[i - 1] && w.start - ws[i - 1].end < 1.5) ||
        (i + 1 < ws.length && isF[i + 1] && ws[i + 1].start - w.end < 1.5)),
  );
  ws.forEach((w, i) => {
    if (!fillRep[i]) return;
    for (let s = Math.floor(w.start) - 1; s <= Math.floor(w.start) + 1; s++) if (inRange(s)) fill[s] = 1;
  });
  // (3) Recurrencia: trigramas que aparecen 3+ veces en la sesión y 2+ veces en
  //     ±RECUR_WINDOW s de esta aparición (las líneas que se iteran al componer).
  const cnt = new Map<string, number>();
  const at = new Map<string, number[]>();
  const gram = (i: number): string | null => {
    const t = toks.slice(i, i + 3);
    if (t.length < 3 || !t.every(Boolean) || (isF[i] && isF[i + 1] && isF[i + 2])) return null;
    return t.join(" ");
  };
  for (let i = 0; i + 2 < toks.length; i++) {
    const k = gram(i);
    if (!k) continue;
    cnt.set(k, (cnt.get(k) ?? 0) + 1);
    const list = at.get(k) ?? [];
    list.push(ws[i].start);
    at.set(k, list);
  }
  /** Apariciones del trigrama en [a, b] (tiempos de sesión). */
  const countIn = (k: string, a: number, b: number) => (at.get(k) ?? []).filter((t) => t >= a && t <= b).length;
  const lyr = new Float64Array(N);
  const lyrGram: { s: number; gram: string; n: number }[] = [];
  for (let i = 0; i + 2 < toks.length; i++) {
    const k = gram(i);
    const c = k ? (cnt.get(k) ?? 0) : 0;
    if (!k || c < 3 || TRIGRAM_STOP.has(k)) continue;
    const t = ws[i].start;
    if (countIn(k, t - RECUR_WINDOW, t + RECUR_WINDOW) < 2) continue;
    for (let j = i; j < i + 3; j++) {
      const s = Math.floor(ws[j].start);
      if (inRange(s)) {
        lyr[s] = 1;
        lyrGram.push({ s, gram: k, n: c });
      }
    }
  }
  const lyrS = movingAvg(lyr, 5);
  // (4) Líneas de letra del resumen: se buscan cerca de su momento (±15 s).
  const summary = new Float64Array(N);
  const summaryAt: { a: number; b: number; text: string }[] = [];
  for (const line of opts.lyricLines ?? []) {
    const span = locateLine(line, ws, toks);
    summaryAt.push({ ...span, text: line.text });
    for (let s = Math.floor(span.a) - 1; s <= Math.ceil(span.b); s++) if (inRange(s)) summary[s] = 1;
  }
  // (5) Acústica: fracción del segundo en notas sostenidas y cuánto de la voz
  //     es sostenida (el habla desliza el tono; el canto sostiene alturas).
  const acoustic = new Float64Array(N);
  const susSec = new Float64Array(N);
  const voiSec = new Float64Array(N);
  const haveAcoustic = !!opts.acoustic?.length;
  if (haveAcoustic) {
    for (const a of opts.acoustic ?? []) {
      const s = Math.floor(a.t);
      if (!inRange(s)) continue;
      susSec[s] = a.sustained;
      voiSec[s] = a.voiced;
    }
    const S = movingAvg(susSec, 3);
    const Vv = movingAvg(voiSec, 3);
    for (let s = 0; s < N; s++) {
      const ratio = Vv[s] > 0.05 ? S[s] / Vv[s] : 0;
      acoustic[s] = clamp01(0.6 * (S[s] / 0.4) + 0.4 * (ratio / 0.6));
    }
  }
  // (6) Densidad de habla: palabras por segundo (media de 5 s).
  const wr = new Float64Array(N);
  for (const w of ws) {
    const s = Math.floor(w.start);
    if (inRange(s)) wr[s]++;
  }
  const rate = movingAvg(wr, 5);

  const score = Array.from({ length: N }, (_, s) =>
    clamp01(
      0.5 * sing[s] +
        0.4 * fill[s] +
        0.35 * lyrS[s] +
        0.3 * summary[s] +
        0.35 * acoustic[s] -
        0.08 * Math.max(0, rate[s] - 2),
    ),
  );

  const probable = segmentsOver(score, thr, () => false);
  const covered = new Uint8Array(N);
  for (const g of probable) for (let s = g.start; s < g.end; s++) covered[s] = 1;
  const doubtful = segmentsOver(score, low, (s) => covered[s] === 1);

  const build = (g: { start: number; end: number }, group: "probable" | "dudoso"): PassageCandidate => {
    const inSeg = (t: number) => t >= g.start && t < g.end;
    const segIdx = ws.map((w, i) => (inSeg(w.start) ? i : -1)).filter((i) => i >= 0);
    const segWords = segIdx.map((i) => ws[i]);
    const evidence: string[] = [];
    const ev = events.filter((w) => w.end >= g.start && w.start < g.end);
    if (ev.length) {
      const kinds = [...new Set(ev.map((w) => w.text.trim()))].slice(0, 2).join(" ");
      evidence.push(`evento ${kinds}${ev.length > 1 ? ` ×${ev.length}` : ""}`);
    }
    const rep = segIdx.filter((i) => fillRep[i]);
    if (rep.length) {
      const kinds = [...new Set(rep.map((i) => toks[i]))].slice(0, 3).join("/");
      evidence.push(`relleno ${kinds} ×${rep.length}`);
    }
    const grams = lyrGram.filter((x) => x.s >= g.start && x.s < g.end);
    if (grams.length) {
      // La evidencia cuenta lo CERCANO (lo que se iteró ahí), no el total de la
      // sesión: "se repite 15×" en pasajes lejanos inflaba la confianza.
      const near = (k: string) => countIn(k, g.start - RECUR_WINDOW, g.end + RECUR_WINDOW);
      const top = grams.reduce((a, b) => (near(b.gram) > near(a.gram) ? b : a), grams[0]);
      evidence.push(`se repite ${near(top.gram)}× cerca (${top.n}× en la sesión) («${top.gram}»)`);
    }
    const lines = summaryAt.filter((x) => x.b >= g.start && x.a < g.end);
    if (lines.length) {
      const t = lines[0].text.length > 40 ? `${lines[0].text.slice(0, 40)}…` : lines[0].text;
      evidence.push(`letra del resumen («${t}»)`);
    }
    let susSum = 0;
    let voiSum = 0;
    let acMean = 0;
    for (let s = g.start; s < g.end; s++) {
      susSum += susSec[s];
      voiSum += voiSec[s];
      acMean += acoustic[s];
    }
    acMean /= g.end - g.start;
    if (haveAcoustic && voiSum > 0 && acMean >= 0.2)
      evidence.push(`melodía estable ${Math.round((100 * Math.min(susSum, voiSum)) / voiSum)}%`);
    let rateMean = 0;
    for (let s = g.start; s < g.end; s++) rateMean += rate[s];
    rateMean /= g.end - g.start;
    if (rateMean > 2.5) evidence.push(`ojo: habla densa (${fmtNum(rateMean)} palabras/s)`);

    const speakers = new Map<string, number>();
    for (const w of segWords) if (w.speaker) speakers.set(w.speaker, (speakers.get(w.speaker) ?? 0) + 1);
    const speaker = [...speakers.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    let mean = 0;
    for (let s = g.start; s < g.end; s++) mean += score[s];
    mean /= g.end - g.start;

    const fillerFrac = segWords.length ? rep.length / segWords.length : 0;
    const segRate = segWords.length / Math.max(1, g.end - g.start);
    let kind: PassageKind;
    if (!segWords.length) kind = "melisma";
    else if (fillerFrac >= 0.8) kind = "silabas";
    else if (fillerFrac >= 0.25) kind = "mixto";
    else if (segRate >= 3 && !ev.length && acMean < 0.3) kind = "rap";
    else kind = "letra";

    const out: PassageCandidate = {
      start: g.start,
      end: Math.min(g.end, opts.durationSec),
      text: segWords.map((w) => w.text.trim()).join(" "),
      score: round(mean, 2),
      evidence,
      kind,
      group,
    };
    if (speaker) out.speaker = speaker;
    return out;
  };
  return [
    ...probable.map((g) => build(g, "probable")),
    ...doubtful.map((g) => build(g, "dudoso")),
  ].sort((a, b) => a.start - b.start);
}

function movingAvg(a: ArrayLike<number>, w: number): Float64Array {
  const n = a.length;
  const out = new Float64Array(n);
  const h = w >> 1;
  for (let s = 0; s < n; s++) {
    let t = 0;
    let c = 0;
    for (let k = s - h; k <= s + h; k++)
      if (k >= 0 && k < n) {
        t += a[k];
        c++;
      }
    out[s] = c ? t / c : 0;
  }
  return out;
}

/** Tramos de segundos ≥ umbral: huecos ≤ 2 s se unen; mínimo 4 s. */
function segmentsOver(
  score: number[],
  thr: number,
  skip: (s: number) => boolean,
): { start: number; end: number }[] {
  const segs: { start: number; end: number }[] = [];
  let cur: { start: number; end: number } | null = null;
  score.forEach((v, s) => {
    if (v < thr || skip(s)) return;
    if (cur && s - cur.end <= 2 && !rangeHits(cur.end, s, skip)) cur.end = s + 1;
    else {
      cur = { start: s, end: s + 1 };
      segs.push(cur);
    }
  });
  return segs.filter((g) => g.end - g.start >= 4);
}

const rangeHits = (a: number, b: number, skip: (s: number) => boolean): boolean => {
  for (let s = a; s < b; s++) if (skip(s)) return true;
  return false;
};

/**
 * Dónde se cantó una línea del resumen: la ventana de palabras (±15 s de su
 * momento) que contiene más palabras de la línea en orden. Sin calce
 * suficiente (60 %), se asume que empieza en su momento.
 */
function locateLine(
  line: { text: string; at: number },
  ws: TranscriptWord[],
  toks: string[],
): { a: number; b: number } {
  const L = line.text.split(/\s+/).map(normWord).filter(Boolean);
  const fallback = { a: line.at, b: line.at + Math.max(2, 0.35 * L.length) };
  if (!L.length) return fallback;
  const idx = ws.map((w, i) => (Math.abs(w.start - line.at) <= 15 ? i : -1)).filter((i) => i >= 0);
  let best: { hits: number; a: number; b: number } | null = null;
  for (const i0 of idx) {
    let k = 0;
    let first = -1;
    let last = -1;
    for (let i = i0; i < ws.length && i < i0 + L.length * 2 && k < L.length; i++) {
      if (toks[i] === L[k]) {
        if (first < 0) first = i;
        last = i;
        k++;
      }
    }
    if (first >= 0 && (!best || k > best.hits)) best = { hits: k, a: ws[first].start, b: ws[last].end };
  }
  return best && best.hits >= Math.max(1, Math.ceil(0.6 * L.length)) ? { a: best.a, b: best.b } : fallback;
}
