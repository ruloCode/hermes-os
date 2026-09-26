/**
 * REJILLA MUSICAL — tiempo ↔ compás/tiempo/semicorchea, pesos métricos, tempo
 * (tap y estimado), grooves y los eventos que suenan en una pista. Lógica pura
 * (sin DOM ni Node): la usa el motor de audio del dashboard para programar la
 * pista y el agente para leer una toma en compás/tiempo.
 *
 * Convenciones: la rejilla se cuenta en SEMICORCHEAS ("pasos"). En 4/4 hay 16
 * por compás; en 3/4, 12; en 6/8, 12 (el bpm de 6/8 es en negras con
 * puntillo: 2 pulsos de 6 pasos). El compás 1 empieza en `downbeatSec`; lo
 * anterior es anacrusa (compás ≤ 0, paso absoluto negativo).
 */
import { chordIntervals, mod12, parseChord, type Chord } from "./music-theory.js";
import type { Groove, Meter, TemaSection, TemaTrack } from "./tema.js";

/** Pulsos por compás: 4/4 → 4, 3/4 → 3, 6/8 → 2 (negras con puntillo). */
export function beatsPerBar(meter: Meter): number {
  return meter === "4/4" ? 4 : meter === "3/4" ? 3 : 2;
}

/** Pasos (semicorcheas) por pulso: 4 en 4/4 y 3/4; 6 en 6/8. */
export function stepsPerBeat(meter: Meter): number {
  return meter === "6/8" ? 6 : 4;
}

/** Pasos por compás: 16 · 12 · 12. */
export function stepsPerBar(meter: Meter): number {
  return beatsPerBar(meter) * stepsPerBeat(meter);
}

/** Segundos por semicorchea. */
export function secPerStep(bpm: number, meter: Meter): number {
  return 60 / bpm / stepsPerBeat(meter);
}

export interface GridSpec {
  bpm: number;
  meter: Meter;
  /** Segundo del primer tiempo del compás 1. */
  downbeatSec: number;
  /** 0..0,5: retraso de las semicorcheas impares en fracción de paso. */
  swing?: number;
}

/** Módulo siempre positivo (los pasos de la anacrusa son negativos). */
const posMod = (n: number, m: number): number => ((n % m) + m) % m;

const swingOf = (g: { swing?: number }): number =>
  Number.isFinite(g.swing) ? Math.max(0, Math.min(0.5, g.swing as number)) : 0;

function median(a: ArrayLike<number>): number {
  const s = Array.from(a).sort((x, y) => x - y);
  if (!s.length) return NaN;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const round1 = (x: number): number => Math.round(x * 10) / 10;

/** Paso más cercano a `t` (con swing), su compás (1-based; ≤0 = anacrusa) y el desvío. */
export function toGrid(
  t: number,
  g: GridSpec,
): { bar: number; stepInBar: number; absStep: number; offSec: number } {
  const sps = secPerStep(g.bpm, g.meter);
  const spb = stepsPerBar(g.meter);
  // Con swing los pasos impares se corren: el más cercano puede ser el vecino
  // del redondeo lineal, así que se comparan los candidatos alrededor.
  const base = Math.floor((t - g.downbeatSec) / sps);
  let best = base;
  let bd = Infinity;
  for (let k = base - 1; k <= base + 2; k++) {
    const d = Math.abs(fromGrid(k, g) - t);
    if (d < bd) {
      bd = d;
      best = k;
    }
  }
  const bar = Math.floor(best / spb) + 1;
  return { bar, stepInBar: best - (bar - 1) * spb, absStep: best, offSec: t - fromGrid(best, g) };
}

/** Segundo de un paso absoluto (con swing). */
export function fromGrid(absStep: number, g: GridSpec): number {
  const sps = secPerStep(g.bpm, g.meter);
  const sw = swingOf(g);
  const at = (k: number): number => g.downbeatSec + k * sps + (posMod(k, 2) === 1 ? sw * sps : 0);
  if (Number.isInteger(absStep)) return at(absStep);
  // Pasos fraccionarios (el final de una nota): interpolación entre los vecinos.
  const k = Math.floor(absStep);
  const f = absStep - k;
  return at(k) + (at(k + 1) - at(k)) * f;
}

/**
 * Peso métrico 0..4 de un paso dentro del compás. 4/4: 0→4, 8→3, 4/12→2,
 * pares→1, impares→0. 3/4: 0→4, 4/8→2, pares→1, impares→0. 6/8: 0→4, 6→3,
 * 2/4/8/10→1 (corcheas), impares→0.
 */
export function metricWeight(stepInBar: number, meter: Meter): number {
  const s = posMod(Math.round(stepInBar), stepsPerBar(meter));
  if (s === 0) return 4;
  if (meter === "4/4") {
    if (s === 8) return 3;
    if (s === 4 || s === 12) return 2;
  } else if (meter === "3/4") {
    if (s === 4 || s === 8) return 2;
  } else if (s === 6) return 3;
  return s % 2 === 0 ? 1 : 0;
}

/** BPM por golpes (ms): mediana de los últimos ≤8 intervalos; un hueco > 2 s reinicia. null con < 2 golpes. */
export function tapTempo(tapsMs: number[]): number | null {
  const taps = tapsMs.filter(Number.isFinite);
  if (taps.length < 2) return null;
  // Un hueco de más de 2 s = el humano empezó a tapear de nuevo: lo de antes no cuenta.
  let start = taps.length - 1;
  while (start > 0 && taps[start] - taps[start - 1] <= 2000) start--;
  const recent = taps.slice(Math.max(start, taps.length - 9));
  const ivs: number[] = [];
  for (let i = 1; i < recent.length; i++) {
    const d = recent[i] - recent[i - 1];
    if (d > 0) ivs.push(d);
  }
  if (!ivs.length) return null;
  // Mediana y no media: un golpe adelantado no arrastra el tempo.
  const bpm = 60000 / median(ivs);
  return Number.isFinite(bpm) ? round1(bpm) : null;
}

/**
 * Tempo estimado desde ataques (s): histograma de intervalos entre ataques
 * plegado a múltiplos del pulso + la fase que más ataques alinea (±40 ms).
 * Es APROXIMADO (la UI lo rotula así). null si no hay con qué.
 *
 * Cómo: para cada bpm candidato (paso 0,25) y cada fase (paso 5 ms) se cuenta
 * cuántos ataques caen a ±40 ms de una semicorchea, ponderados por dónde caen
 * (tiempo 1 · corchea 0,5 · semicorchea 0,25): un tarareo cae sobre todo en
 * tiempos y corcheas, y ese peso es lo que separa 96 de 72 o 128 (con la
 * rejilla de semicorcheas sola, los tres "calzan"). El puntaje se normaliza
 * contra el AZAR de ese bpm (una rejilla más densa atrapa más ataques
 * aleatorios) y el ganador se refina por mínimos cuadrados sobre los ataques
 * que atrapó. Rango por defecto 70..140: una octava justa, así el doble y la
 * mitad del tempo no compiten (la ambigüedad de octava no se resuelve con
 * ataques, se resuelve con el rango).
 *
 * `confidence` es honesta: sube con cuánto por encima del azar quedó el
 * ganador, cuánto le sacó al segundo bpm DISTINTO (±4 %) y cuántos ataques
 * hubo (con < 12 no pasa de proporcional).
 */
export function estimateTempo(
  onsets: number[],
  opts?: { min?: number; max?: number },
): { bpm: number; confidence: number } | null {
  const min = opts?.min ?? 70;
  const max = opts?.max ?? 140;
  if (!(min > 0) || !(max > min)) return null;
  const sorted = onsets.filter(Number.isFinite).sort((a, b) => a - b);
  // Dos ataques a menos de 30 ms son el mismo (doble detección de un onset).
  const on: number[] = [];
  for (const t of sorted) if (!on.length || t - on[on.length - 1] >= 0.03) on.push(t);
  if (on.length < 4) return null;

  const TOL = 0.04;
  const W = [1, 0.25, 0.5, 0.25];
  const scoreAt = (u: number, phi: number): number => {
    let s = 0;
    for (const t of on) {
      const k = (t - phi) / u;
      const r = Math.round(k);
      const dev = Math.abs(k - r) * u;
      if (dev <= TOL) s += W[posMod(r, 4)] * (1 - (0.5 * dev) / TOL);
    }
    return s;
  };

  const cands: { bpm: number; norm: number; phi: number }[] = [];
  for (let i = 0; min + i * 0.25 <= max + 1e-9; i++) {
    const bpm = min + i * 0.25;
    const P = 60 / bpm;
    const u = P / 4;
    let bestS = -Infinity;
    let bestPhi = 0;
    for (let phi = 0; phi < P; phi += 0.005) {
      const s = scoreAt(u, phi);
      if (s > bestS) {
        bestS = s;
        bestPhi = phi;
      }
    }
    // Azar: P(caer a ±TOL) × peso medio (0,5) × factor triangular medio (0,75).
    const chance = Math.min(1, (2 * TOL) / u) * 0.5 * 0.75;
    const norm = (bestS / on.length - chance) / (1 - chance);
    cands.push({ bpm, norm, phi: bestPhi });
  }
  let best = cands[0];
  for (const c of cands) if (c.norm > best.norm) best = c;
  if (!(best.norm > 0.05)) return null;

  // Refinamiento: t = φ + r·u por mínimos cuadrados sobre los ataques atrapados
  // (el paso de 0,25 bpm deriva ~100 ms en 40 s; la regresión no).
  let bpm = best.bpm;
  {
    const u = 60 / best.bpm / 4;
    const xs: number[] = [];
    const ys: number[] = [];
    for (const t of on) {
      const k = (t - best.phi) / u;
      const r = Math.round(k);
      if (Math.abs(k - r) * u <= TOL) {
        xs.push(r);
        ys.push(t);
      }
    }
    if (xs.length >= 3) {
      const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
      const my = ys.reduce((a, b) => a + b, 0) / ys.length;
      let sxy = 0;
      let sxx = 0;
      for (let i = 0; i < xs.length; i++) {
        sxy += (xs[i] - mx) * (ys[i] - my);
        sxx += (xs[i] - mx) ** 2;
      }
      if (sxx > 0) {
        const refined = 60 / ((sxy / sxx) * 4);
        if (Number.isFinite(refined) && Math.abs(refined - best.bpm) / best.bpm < 0.03) bpm = refined;
      }
    }
  }

  let second = 0;
  for (const c of cands) if (Math.abs(c.bpm - best.bpm) / best.bpm > 0.04 && c.norm > second) second = c.norm;
  const margin = Math.max(0, Math.min(1, (2 * (best.norm - second)) / best.norm));
  const amount = Math.min(1, on.length / 12);
  const confidence = Math.max(0, Math.min(1, best.norm)) * margin * amount;
  return { bpm: round1(bpm), confidence: Math.round(confidence * 100) / 100 };
}

/** Patrones de groove en pasos de un compás de 4/4 (en otros compases solo suena el clic). */
export const GROOVE_PATTERNS: Record<Exclude<Groove, "clic">, { kick: number[]; snare: number[]; hat: number[] }> = {
  // Dembow: bombo en los 4 tiempos, caja en el tresillo 3+3+2 desplazado.
  dembow: { kick: [0, 4, 8, 12], snare: [3, 6, 11, 14], hat: [2, 6, 10, 14] },
  dancehall: { kick: [0, 7, 8], snare: [4, 12], hat: [2, 6, 10, 14] },
  rnb: { kick: [0, 10], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14] },
  pop: { kick: [0, 8], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14] },
};

export interface TrackEvent {
  /** Segundo relativo al primer tiempo del compás 1 de la sección (negativo = cuenta de entrada). */
  t: number;
  kind: "chord" | "bass" | "kick" | "snare" | "hat" | "click";
  /** Notas MIDI (acorde en posición cerrada ~C4; bajo ~C2..C3). */
  midi?: number[];
  dur: number;
  /** Clic del primer tiempo / acento. */
  accent?: boolean;
}

/** Duraciones de la percusión sintetizada (s): cortas, el motor les da la envolvente. */
const HIT_DUR: Record<"kick" | "snare" | "hat" | "click", number> = {
  kick: 0.25,
  snare: 0.18,
  hat: 0.05,
  click: 0.05,
};

const KIND_ORDER: Record<TrackEvent["kind"], number> = { click: 0, kick: 1, snare: 2, hat: 3, bass: 4, chord: 5 };

/**
 * Acorde en posición CERRADA alrededor de Do4: cada nota del acorde cae en
 * [Sol3, Fa♯4] (55..66). Siempre la misma inversión para la misma raíz: el
 * loop suena estable y no "salta" de registro de un acorde al siguiente.
 */
export function chordVoicing(chord: Chord): number[] {
  const pcs = new Set(chordIntervals(chord).map((i) => mod12(chord.root + i)));
  return Array.from(pcs, (pc) => 55 + mod12(pc - 7)).sort((a, b) => a - b);
}

/** Bajo en la fundamental, en [Mi2, Re♯3] (40..51): el registro natural de un bajo. */
export function bassNote(chord: Chord): number {
  return 40 + mod12(chord.root - 4);
}

/** Entradas de acorde del loop en pasos desde su inicio (ordenadas). */
function chordEntries(loop: TemaSection["loop"], meter: Meter): { step: number; chord: Chord }[] {
  const spb = stepsPerBar(meter);
  const spbeat = stepsPerBeat(meter);
  const out: { step: number; chord: Chord }[] = [];
  loop.forEach((bar, b) => {
    for (const c of bar.chords) {
      const chord = parseChord(c.symbol);
      if (!chord) continue;
      const beat = Math.max(0, Math.min(beatsPerBar(meter) - 1, Math.round(c.beat)));
      out.push({ step: b * spb + beat * spbeat, chord });
    }
  });
  return out.sort((x, y) => x.step - y.step);
}

/**
 * Lo que suena entre dos pasos absolutos de la sección, con el loop repetido
 * por módulo: acordes (y su bajo) al entrar cada acorde, groove y clic. Con
 * `fromStep` negativo incluye la cuenta de entrada (solo clic).
 *
 * Rango semiabierto [fromStep, toStep): el motor pide ventanas consecutivas y
 * cada evento sale UNA vez. Cada acorde dura hasta la entrada del siguiente
 * (con la vuelta del loop). El groove solo suena en 4/4; con "clic" o en otro
 * compás, pedir groove = el clic. Por defecto suena todo.
 */
export function trackEvents(
  track: TemaTrack,
  section: TemaSection,
  fromStep: number,
  toStep: number,
  opts?: { metronome?: boolean; groove?: boolean; chords?: boolean },
): TrackEvent[] {
  const meter = track.meter;
  const spb = stepsPerBar(meter);
  const spbeat = stepsPerBeat(meter);
  const g: GridSpec = { bpm: track.bpm, meter, downbeatSec: 0, swing: track.swing };
  const sps = secPerStep(track.bpm, meter);
  const wantChords = opts?.chords !== false;
  const wantGroove = opts?.groove !== false;
  const wantMetro = opts?.metronome !== false;
  const pattern = track.groove !== "clic" && meter === "4/4" ? GROOVE_PATTERNS[track.groove] : null;
  const click = wantMetro || (wantGroove && !pattern);
  const entries = wantChords ? chordEntries(section.loop, meter) : [];
  const loopSteps = section.loop.length * spb;

  const out: TrackEvent[] = [];
  const to = Math.ceil(toStep);
  for (let s = Math.ceil(fromStep); s < to; s++) {
    const t = fromGrid(s, g);
    const inBar = posMod(s, spb);
    const onBeat = inBar % spbeat === 0;
    if (s < 0) {
      // Cuenta de entrada: solo el clic, con acento en el 1 de cada compás.
      if (onBeat) out.push({ t, kind: "click", dur: HIT_DUR.click, accent: inBar === 0 });
      continue;
    }
    if (click && onBeat) out.push({ t, kind: "click", dur: HIT_DUR.click, accent: inBar === 0 });
    if (entries.length && loopSteps > 0) {
      const ls = posMod(s, loopSteps);
      const k = entries.findIndex((e) => e.step === ls);
      if (k >= 0) {
        const e = entries[k];
        const next = k + 1 < entries.length ? entries[k + 1].step : entries[0].step + loopSteps;
        const dur = (next - e.step) * sps;
        out.push({ t, kind: "chord", midi: chordVoicing(e.chord), dur });
        out.push({ t, kind: "bass", midi: [bassNote(e.chord)], dur });
      }
    }
    if (wantGroove && pattern) {
      if (pattern.kick.includes(inBar)) out.push({ t, kind: "kick", dur: HIT_DUR.kick, accent: inBar === 0 });
      if (pattern.snare.includes(inBar)) out.push({ t, kind: "snare", dur: HIT_DUR.snare });
      if (pattern.hat.includes(inBar)) out.push({ t, kind: "hat", dur: HIT_DUR.hat });
    }
  }
  return out.sort((a, b) => a.t - b.t || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
}

/**
 * Parte una grabación continua de N vueltas del loop en tomas: cada una desde
 * `preRollSec` antes de su primer tiempo hasta `tailSec` después de su final
 * (la anacrusa y la última sílaba quedan dentro).
 *
 * `cycle` es 1-based y el `downbeatSec` de cada toma es RELATIVO a su propio
 * inicio (lo que espera `TakeGrid`). Una vuelta cuenta si la grabación la
 * cubre entera salvo ≤ 250 ms: la compensación de latencia corre el primer
 * tiempo hacia adelante y, si la grabación se corta justo al final del loop
 * programado, la última vuelta queda corta en exactamente esa latencia.
 */
export function splitCycles(opts: {
  totalSec: number;
  downbeatSec: number;
  loopSec: number;
  preRollSec: number;
  tailSec: number;
}): { cycle: number; startSec: number; endSec: number; downbeatSec: number }[] {
  const { totalSec, downbeatSec, loopSec } = opts;
  const pre = Math.max(0, opts.preRollSec);
  const tail = Math.max(0, opts.tailSec);
  const SHORT_OK = 0.25;
  if (!(loopSec > 0) || !(totalSec > 0) || !Number.isFinite(downbeatSec)) return [];
  const out: { cycle: number; startSec: number; endSec: number; downbeatSec: number }[] = [];
  for (let k = 0; k < 10000; k++) {
    const db = downbeatSec + k * loopSec;
    if (db + loopSec - SHORT_OK > totalSec) break;
    if (db < 0) continue;
    const startSec = Math.max(0, db - pre);
    const endSec = Math.min(totalSec, db + loopSec + tail);
    out.push({ cycle: k + 1, startSec, endSec, downbeatSec: db - startSec });
  }
  return out;
}

/** Tope de la media ventana de búsqueda de un clic (s). */
export const CLICK_WINDOW_MAX_SEC = 0.45;

/** Media ventana de detectClicks: 0,45 × la separación mínima entre clics, con tope. */
export function clickWindowSec(expectedSec: number[]): number {
  const t = expectedSec.filter(Number.isFinite).sort((a, b) => a - b);
  let gap = Infinity;
  for (let i = 1; i < t.length; i++) if (t[i] - t[i - 1] > 0) gap = Math.min(gap, t[i] - t[i - 1]);
  return Math.min(CLICK_WINDOW_MAX_SEC, 0.45 * gap);
}

/**
 * Calibración por loopback: en una grabación de clics que salieron por los
 * parlantes, encuentra cada clic cerca de su momento esperado y devuelve la
 * mediana del retardo y su dispersión (MAD). null si no encontró la mitad.
 *
 * Por clic: ventana de ± 0,45 × la separación MÍNIMA entre clics esperados
 * (tope ±450 ms; un clic solo usa el tope) alrededor del momento esperado. Así
 * la ventana nunca alcanza el clic vecino, y con clics a 1 s cabe una latencia
 * de Bluetooth de ~300-400 ms (con ±250 fijos, un retardo >250 ms enganchaba
 * el clic ANTERIOR y medía un retardo negativo). El piso de
 * ruido es la MEDIANA de |x| (el clic dura pocos ms, así que la mediana es el
 * ruido) y el clic existe si su pico pasa 6× ese piso. El ataque es el primer
 * cruce del 20 % del salto (piso → pico) en los 30 ms ANTES del pico: buscar
 * desde el pico hacia atrás y no desde el inicio de la ventana evita que un
 * ruido suelto de antes se lleve el ataque. Precisión de muestra en un clic
 * limpio; la reverberación del cuarto no mueve el ataque, solo la cola.
 */
export function detectClicks(
  pcm: Float32Array,
  sr: number,
  expectedSec: number[],
): { delayMs: number; madMs: number; found: number } | null {
  if (!expectedSec.length || !(sr > 0)) return null;
  const half = Math.round(clickWindowSec(expectedSec) * sr);
  const back = Math.round(0.03 * sr);
  const delays: number[] = [];
  for (const e of expectedSec) {
    if (!Number.isFinite(e)) continue;
    const c = Math.round(e * sr);
    const a = Math.max(0, c - half);
    const b = Math.min(pcm.length, c + half);
    if (b - a < 16) continue;
    const mags = new Float32Array(b - a);
    let peak = 0;
    let pk = a;
    for (let i = a; i < b; i++) {
      const m = Math.abs(pcm[i]);
      mags[i - a] = m;
      if (m > peak) {
        peak = m;
        pk = i;
      }
    }
    const noise = median(mags);
    if (peak < 1e-4 || peak < noise * 6) continue;
    const thr = noise + 0.2 * (peak - noise);
    let onset = pk;
    for (let i = Math.max(a, pk - back); i <= pk; i++) {
      if (Math.abs(pcm[i]) >= thr) {
        onset = i;
        break;
      }
    }
    delays.push(onset / sr - e);
  }
  if (!delays.length || delays.length < Math.ceil(expectedSec.length / 2)) return null;
  const med = median(delays);
  const mad = median(delays.map((d) => Math.abs(d - med)));
  return { delayMs: round1(med * 1000), madMs: round1(mad * 1000), found: delays.length };
}
