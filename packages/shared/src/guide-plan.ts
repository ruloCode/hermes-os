/**
 * PLAN DE LA GUÍA CANTADA — "vocaloid-lite": la línea de letra dicha por un TTS
 * se corta por sílabas y cada una se lleva a SU nota de la melodía. Aquí vive
 * el plan (qué tramo del TTS va a qué tramo del pasaje y con qué altura); el
 * render (PSOLA) está en psola.ts. Lógica pura.
 *
 * Reglas que hacen que suene cantado y no leído:
 *  - La CONSONANTE entra antes del ataque (≤ 60 ms) para que la VOCAL caiga en
 *    el tiempo — así se canta.
 *  - La vocal se estira hasta el final de su posición; en un melisma lleva
 *    varios objetivos de altura con glissando de 30 ms.
 *  - `pitch: "tarareo"` usa el contorno f0 del propio tarareo (vibrato y
 *    ligaduras reales); `"notas"`, alturas limpias con vibrato de 5,5 Hz ±25 c
 *    en notas ≥ 0,35 s.
 */
import type { MelismaMode, MoldSlotInfo, Phrase } from "./composicion.js";
import { moldPositions } from "./melody.js";

/** Alineación por carácter que devuelve el TTS con timestamps (ElevenLabs /with-timestamps). */
export interface TtsAlignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

/** Dónde cae cada sílaba de la lectura DENTRO del audio del TTS. */
export interface SyllableSpan {
  syllable: string;
  start: number;
  /** Inicio de la vocal núcleo (lo anterior es consonante). */
  vowelStart: number;
  end: number;
}

// ─────────────────────────── Alineación ───────────────────────────

/** Hueco entre sílabas (s) que todavía se parte a la mitad: el espacio entre palabras del habla fluida. */
const GAP_SPLIT_SEC = 0.08;
/** Con una pausa real (coma, respiración), cada sílaba se lleva a lo sumo esto del hueco. */
const GAP_EDGE_SEC = 0.04;

/** Una letra comparable: minúscula, sin tilde (la ñ es otra letra y se queda). */
interface Letter {
  ch: string;
  /** Tenía diéresis ("ü"): esa u sí suena (pingüino). */
  dieresis: boolean;
}

function lettersOf(text: string): Letter[] {
  const out: Letter[] = [];
  for (const c of text.normalize("NFC").toLowerCase()) {
    if (c === "ñ") {
      out.push({ ch: "ñ", dieresis: false });
      continue;
    }
    for (const b of c.normalize("NFD").replace(/[̀-ͯ]/g, "")) {
      if (/[a-z]/.test(b)) out.push({ ch: b, dieresis: c === "ü" });
    }
  }
  return out;
}

/** ¿La h es muda aquí? Toda h que no forma "ch". */
const muteH = (ls: { ch: string }[], i: number): boolean =>
  ls[i].ch === "h" && ls[i - 1]?.ch !== "c";

const VOWEL_LETTERS = "aeiou";

/**
 * Índice (dentro de las letras de la sílaba) de la primera letra que SUENA a
 * vocal: la u de "que"/"gui" no suena (la de "güe" sí) y la y ante vocal es
 * consonante ("y al", "yo"); la y final es vocal ("hoy"). −1 si no hay.
 */
function firstVowel(ls: Letter[]): number {
  for (let i = 0; i < ls.length; i++) {
    const c = ls[i].ch;
    if (c === "u") {
      const prev = ls[i - 1]?.ch;
      const next = ls[i + 1]?.ch;
      if (prev === "q") continue;
      if (prev === "g" && (next === "e" || next === "i") && !ls[i].dieresis) continue;
      return i;
    }
    if (VOWEL_LETTERS.includes(c)) return i;
    if (c === "y" && !VOWEL_LETTERS.includes(ls[i + 1]?.ch ?? "_")) return i;
  }
  return -1;
}

/**
 * Recorre los caracteres normalizados (tildes, h muda, espacios de sinalefa,
 * signos) y reparte la alineación del TTS entre las sílabas de `reading`.
 * null si la alineación no cuadra con la lectura (el TTS dijo otra cosa).
 *
 * - Se comparan LETRAS: minúsculas, sin tildes (la ñ se conserva) y sin la h
 *   muda en ninguno de los dos lados. Espacios y signos no se comparan: su
 *   tiempo se reparte. Una sinalefa ("y al") trae su espacio adentro y queda
 *   dentro de la sílaba.
 * - Un dígito en la alineación = el TTS leyó un número que la lectura no tiene
 *   (la lectura sale de las letras de la línea): null. Lo mismo si las letras
 *   no coinciden (abreviaturas expandidas por el TTS, otra frase).
 * - Entre sílabas, un hueco corto (≤ 80 ms, el espacio entre palabras) se
 *   parte a la mitad; una pausa real deja a cada lado a lo sumo 40 ms — el
 *   silencio no se copia a la guía.
 * - `vowelStart` = la primera letra que suena a vocal (ver `firstVowel`); una
 *   sílaba sin vocal ("mm") es toda sonora.
 */
export function alignSyllables(reading: string[], alignment: TtsAlignment): SyllableSpan[] | null {
  const chars = alignment.characters ?? [];
  const t0 = alignment.character_start_times_seconds ?? [];
  const t1 = alignment.character_end_times_seconds ?? [];
  if (!reading.length || !chars.length || t0.length !== chars.length || t1.length !== chars.length)
    return null;

  // Letras del TTS con su tiempo (un carácter que se vuelve varias letras reparte su tramo).
  const A: (Letter & { start: number; end: number })[] = [];
  for (let j = 0; j < chars.length; j++) {
    if (/[0-9]/.test(chars[j])) return null;
    const ls = lettersOf(chars[j]);
    const a = t0[j];
    const b = Math.max(a, t1[j]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    ls.forEach((l, k) =>
      A.push({
        ...l,
        start: a + ((b - a) * k) / ls.length,
        end: a + ((b - a) * (k + 1)) / ls.length,
      }),
    );
  }
  // Letras de la lectura con su sílaba.
  const R: (Letter & { syl: number })[] = [];
  reading.forEach((s, i) => lettersOf(s).forEach((l) => R.push({ ...l, syl: i })));
  const a = A.filter((_, i) => !muteH(A, i));
  const r = R.filter((_, i) => !muteH(R, i));
  if (a.length !== r.length || a.some((x, i) => x.ch !== r[i].ch)) return null;

  const spans: SyllableSpan[] = [];
  for (let i = 0; i < reading.length; i++) {
    const idx: number[] = [];
    r.forEach((x, k) => {
      if (x.syl === i) idx.push(k);
    });
    if (!idx.length) return null;
    const ls = idx.map((k) => r[k]);
    const v = firstVowel(ls);
    const start = a[idx[0]].start;
    const end = a[idx[idx.length - 1]].end;
    spans.push({ syllable: reading[i], start, vowelStart: v >= 0 ? a[idx[v]].start : start, end });
  }
  // Reparto de los huecos (espacios, signos, h mudas, pausas) entre vecinas.
  for (let i = 0; i + 1 < spans.length; i++) {
    const cur = spans[i];
    const nx = spans[i + 1];
    const gap = nx.start - cur.end;
    if (gap <= GAP_SPLIT_SEC) {
      const mid = (cur.end + nx.start) / 2;
      cur.end = mid;
      nx.start = mid;
    } else {
      cur.end += GAP_EDGE_SEC;
      nx.start -= GAP_EDGE_SEC;
    }
  }
  for (const s of spans) {
    s.vowelStart = Math.min(s.end, Math.max(s.start, s.vowelStart));
    s.start = round4(s.start);
    s.vowelStart = round4(s.vowelStart);
    s.end = round4(s.end);
  }
  return spans;
}

const round4 = (x: number): number => Math.round(x * 1e4) / 1e4;

// ─────────────────────────── Plan ───────────────────────────

/** Un tramo del render: de dónde se toma del TTS y a dónde va en el pasaje, con su altura objetivo. */
export interface GuideSegment {
  phrase: number;
  syllable: string;
  src: SyllableSpan;
  /** Tiempos DESTINO dentro del pasaje (s). */
  dstStart: number;
  dstVowelStart: number;
  dstEnd: number;
  /** Curva de altura objetivo sobre el tiempo destino (MIDI con decimales). */
  pitch: { t: number; midi: number }[];
}

/** La consonante entra a lo sumo esto antes del ataque. */
const MAX_LEAD_SEC = 0.06;
/** Transición entre notas de un melisma. */
const GLIDE_SEC = 0.03;
/** Vibrato del modo "notas": 5,5 Hz, ±25 c, solo en notas desde 0,35 s. */
const VIBRATO_HZ = 5.5;
const VIBRATO_ST = 0.25;
const VIBRATO_MIN_SEC = 0.35;
/** El vibrato no arranca con la nota: entra a los 120 ms y crece en 150 ms, como lo hace un cantante. */
const VIBRATO_DELAY_SEC = 0.12;
const VIBRATO_RAMP_SEC = 0.15;
/** Paso de la curva de altura donde hay movimiento (vibrato, contorno del tarareo). */
const CURVE_STEP_SEC = 0.01;

type PlanNote = { midi: number | null; start: number; end: number };

/** Altura de una curva en `t` (interpolación lineal; fuera de rango, el extremo). NaN si está vacía. */
export function pitchAt(curve: { t: number; midi: number }[], t: number): number {
  if (!curve.length) return NaN;
  if (t <= curve[0].t) return curve[0].midi;
  const last = curve[curve.length - 1];
  if (t >= last.t) return last.midi;
  let lo = 0;
  let hi = curve.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (curve[m].t <= t) lo = m;
    else hi = m;
  }
  const a = curve[lo];
  const b = curve[hi];
  return b.t > a.t ? a.midi + ((b.midi - a.midi) * (t - a.t)) / (b.t - a.t) : b.midi;
}

/**
 * Curva limpia del modo "notas" sobre [a, b]: cada nota sostenida hasta que
 * entra la siguiente (un silencio dentro de una sílaba sostenida no baja la
 * voz), glissando de 30 ms que LLEGA en el ataque de la nota nueva, y vibrato
 * en las notas largas.
 */
function notesCurve(
  notes: { midi: number; start: number; end: number }[],
  a: number,
  b: number,
  semis: number,
) {
  const pts: { t: number; midi: number }[] = [];
  if (!notes.length || !(b > a)) return pts;
  const push = (t: number, midi: number): void => {
    const tt = Math.min(b, Math.max(a, t));
    if (pts.length && tt <= pts[pts.length - 1].t + 1e-9) {
      if (tt >= pts[pts.length - 1].t - 1e-9) pts[pts.length - 1].midi = midi;
      return;
    }
    pts.push({ t: tt, midi });
  };
  // Tramo efectivo de cada nota dentro de [a, b]: desde su ataque (o a) hasta el de la siguiente (o b).
  const spans = notes
    .map((n, k) => ({
      midi: n.midi + semis,
      from: k === 0 ? a : Math.max(a, Math.min(b, n.start)),
      to: k + 1 < notes.length ? Math.max(a, Math.min(b, notes[k + 1].start)) : b,
    }))
    .filter((s) => s.to > s.from || notes.length === 1);
  spans.forEach((s, k) => {
    push(s.from, s.midi);
    // Glissando: la nota se suelta 30 ms antes del ataque de la siguiente y LLEGA en su ataque.
    const glide = k + 1 < spans.length && spans[k + 1].midi !== s.midi;
    const tail = glide ? Math.max(s.from, s.to - GLIDE_SEC) : s.to;
    const vib = s.to - s.from >= VIBRATO_MIN_SEC;
    const at = (t: number): number => {
      if (!vib) return s.midi;
      const age = t - s.from;
      const depth =
        age <= VIBRATO_DELAY_SEC
          ? 0
          : VIBRATO_ST * Math.min(1, (age - VIBRATO_DELAY_SEC) / VIBRATO_RAMP_SEC);
      return s.midi + depth * Math.sin(2 * Math.PI * VIBRATO_HZ * (age - VIBRATO_DELAY_SEC));
    };
    if (vib)
      for (let t = s.from + CURVE_STEP_SEC; t < tail - 1e-9; t += CURVE_STEP_SEC) push(t, at(t));
    if (tail > s.from) push(tail, at(tail));
  });
  push(b, pts[pts.length - 1].midi);
  return pts;
}

/**
 * Curva del modo "tarareo" sobre [a, b]: el f0 real del pasaje (MIDI por hop)
 * con los huecos sin voz interpolados. null si en el tramo no hay voz
 * suficiente (menos del 30 % de los cuadros): ahí se cantan las notas.
 */
function hummedCurve(f0: (number | null)[], hop: number, a: number, b: number, semis: number) {
  if (!(hop > 0) || !(b > a)) return null;
  const i0 = Math.max(0, Math.floor(a / hop));
  const i1 = Math.min(f0.length - 1, Math.ceil(b / hop));
  if (i1 < i0) return null;
  const raw: { t: number; v: number | null }[] = [];
  for (let i = i0; i <= i1; i++) {
    const v = f0[i];
    raw.push({ t: i * hop, v: v != null && Number.isFinite(v) ? v : null });
  }
  const voiced = raw.filter((x) => x.v != null);
  if (voiced.length < Math.max(1, 0.3 * raw.length)) return null;
  const pts: { t: number; midi: number }[] = [];
  const step = Math.max(1, Math.round(CURVE_STEP_SEC / hop));
  for (let k = 0; k < raw.length; k += step) {
    const x = raw[k];
    let v = x.v;
    if (v == null) {
      // Interpolación entre las vecinas con voz (o la más cercana en los bordes).
      let l = k - 1;
      while (l >= 0 && raw[l].v == null) l--;
      let r = k + 1;
      while (r < raw.length && raw[r].v == null) r++;
      if (l >= 0 && r < raw.length)
        v =
          (raw[l].v as number) +
          (((raw[r].v as number) - (raw[l].v as number)) * (k - l)) / (r - l);
      else v = (l >= 0 ? raw[l].v : raw[r].v) as number;
    }
    pts.push({ t: Math.min(b, Math.max(a, x.t)), midi: v + semis });
  }
  // Extremos exactos: la curva cubre todo el tramo.
  if (pts[0].t > a) pts.unshift({ t: a, midi: pts[0].midi });
  if (pts[pts.length - 1].t < b) pts.push({ t: b, midi: pts[pts.length - 1].midi });
  return pts.filter((p, k) => k === 0 || p.t > pts[k - 1].t);
}

/**
 * Plan de una línea: sílabas del TTS (`spans`) → posiciones del molde de la
 * frase. Si sobran sílabas se comprimen al final; si faltan, la última se
 * sostiene; en ambos casos se avisa en `warnings`.
 *
 * - Las posiciones (ataque, final, notas) salen de la frase medida en el modo
 *   de melisma pedido — las mismas que cuenta el molde (`moldPositions`).
 *   `slots` es el molde que midió la letra: si un humano lo corrigió a otro
 *   conteo, la guía canta sobre lo MEDIDO y lo avisa.
 * - La vocal cae en el ataque de la posición; la consonante entra antes, a lo
 *   sumo 60 ms (y nunca más de la mitad de la vocal anterior, que se acorta
 *   para dejarle sitio — así se canta).
 * - Una nota sin altura estable toma la de su vecina más cercana.
 */
export function planGuide(input: {
  phrase: Phrase;
  phraseIdx: number;
  spans: SyllableSpan[];
  slots: MoldSlotInfo[];
  mode: MelismaMode;
  pitch: "notas" | "tarareo";
  semitones?: number;
  /** Contorno f0 del pasaje (MIDI por hop, null = sin voz) para el modo "tarareo". */
  f0?: (number | null)[];
  hop?: number;
}): { segments: GuideSegment[]; warnings: string[] } {
  const { phrase, phraseIdx, spans, slots, mode } = input;
  const semis = Number.isFinite(input.semitones) ? (input.semitones as number) : 0;
  const warnings: string[] = [];
  const positions = moldPositions(phrase, mode);
  if (!positions.length)
    return {
      segments: [],
      warnings: ["la frase no tiene sílabas medidas: no hay dónde cantar la línea"],
    };
  if (!spans.length) return { segments: [], warnings: ["la línea no tiene sílabas que cantar"] };
  if (slots.length && slots.length !== positions.length)
    warnings.push(
      `el molde corregido pide ${slots.length} ${slots.length === 1 ? "sílaba" : "sílabas"}; la guía canta sobre las ${positions.length} posiciones medidas`,
    );

  // Alturas: una nota sin altura estable hereda la de su vecina más cercana (en el orden de la frase).
  const allNotes: PlanNote[] = positions.flatMap((p) => p.notes);
  const known = allNotes.map((n, i) => (n.midi != null ? i : -1)).filter((i) => i >= 0);
  const fillMidi = (n: PlanNote): number | null => {
    if (n.midi != null) return n.midi;
    if (!known.length) return null;
    const i = allNotes.indexOf(n);
    let best = known[0];
    for (const k of known)
      if (
        Math.abs(k - i) < Math.abs(best - i) ||
        (Math.abs(k - i) === Math.abs(best - i) && k < best)
      )
        best = k;
    return allNotes[best].midi;
  };
  if (!known.length)
    warnings.push("la frase no tiene alturas medidas: la guía queda a la altura del TTS");

  // Reparto de sílabas del TTS en posiciones.
  const R = spans.length;
  const P = positions.length;
  const targets: { span: SyllableSpan; start: number; end: number; notes: PlanNote[] }[] = [];
  const direct = Math.min(R, P) - 1;
  for (let i = 0; i < direct; i++)
    targets.push({
      span: spans[i],
      start: positions[i].start,
      end: positions[i].end,
      notes: positions[i].notes,
    });
  if (R >= P) {
    // Sobran (o calzan): las k últimas se reparten la última posición en partes iguales.
    const last = positions[P - 1];
    const k = R - P + 1;
    const len = (last.end - last.start) / k;
    for (let j = 0; j < k; j++) {
      const a = last.start + j * len;
      const b = a + len;
      const inside = last.notes.filter((n) => n.end > a && n.start < b);
      const notes = inside.length
        ? inside
        : [last.notes.reduce((x, n) => (n.start <= a ? n : x), last.notes[0])];
      targets.push({ span: spans[P - 1 + j], start: a, end: b, notes });
    }
    if (k > 1)
      warnings.push(
        `${R - P === 1 ? "sobra 1 sílaba" : `sobran ${R - P} sílabas`}: las ${k} últimas se comprimen en la última posición`,
      );
  } else {
    // Faltan: la última sílaba se sostiene sobre las posiciones que quedan.
    const from = positions[R - 1];
    const to = positions[P - 1];
    targets.push({
      span: spans[R - 1],
      start: from.start,
      end: to.end,
      notes: positions.slice(R - 1).flatMap((p) => p.notes),
    });
    warnings.push(
      `${P - R === 1 ? "falta 1 sílaba" : `faltan ${P - R} sílabas`}: «${spans[R - 1].syllable}» se sostiene sobre las ${P - R + 1} últimas posiciones`,
    );
  }

  // Tiempos: la vocal en el ataque, la consonante antes (≤ 60 ms, sin pisar más de media vocal anterior).
  const segments: GuideSegment[] = [];
  for (const t of targets) {
    const attack = t.start;
    const prev = segments[segments.length - 1];
    const cons = Math.max(0, t.span.vowelStart - t.span.start);
    const room = prev ? Math.max(0, (attack - prev.dstVowelStart) / 2) : Math.max(0, attack);
    const lead = Math.min(cons, MAX_LEAD_SEC, room);
    const dstStart = attack - lead;
    if (prev && prev.dstEnd > dstStart) prev.dstEnd = Math.max(prev.dstVowelStart, dstStart);
    segments.push({
      phrase: phraseIdx,
      syllable: t.span.syllable,
      src: t.span,
      dstStart: round4(dstStart),
      dstVowelStart: round4(attack),
      dstEnd: round4(Math.max(attack, t.end)),
      pitch: [],
    });
  }

  // Alturas: "tarareo" = el contorno real; "notas" = alturas limpias con vibrato.
  let noHum = 0;
  const wantHum = input.pitch === "tarareo";
  if (wantHum && !(input.f0?.length && (input.hop ?? 0) > 0))
    warnings.push("no hay contorno del tarareo: la guía canta las notas");
  segments.forEach((seg, k) => {
    const a = seg.dstVowelStart;
    const b = seg.dstEnd;
    if (wantHum && input.f0?.length && (input.hop ?? 0) > 0) {
      const c = hummedCurve(input.f0, input.hop as number, a, b, semis);
      if (c) {
        seg.pitch = c;
        return;
      }
      noHum++;
    }
    const notes = targets[k].notes
      .map((n) => ({ midi: fillMidi(n), start: n.start, end: n.end }))
      .filter((n): n is { midi: number; start: number; end: number } => n.midi != null)
      .sort((x, y) => x.start - y.start);
    seg.pitch = notesCurve(notes, a, b, semis).map((p) => ({
      t: round4(p.t),
      midi: Math.round(p.midi * 1000) / 1000,
    }));
  });
  if (noHum)
    warnings.push(
      `${noHum === 1 ? "1 sílaba cae" : `${noHum} sílabas caen`} donde el tarareo no tiene voz: ahí la guía canta las notas`,
    );
  return { segments, warnings };
}
