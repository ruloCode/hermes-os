"use client";

/**
 * PIANO ROLL del memo, en SVG. Un solo eje de tiempo con carriles apilados
 * (patrón Descript: onda → notas → sílabas, un solo playhead) y bloques de
 * nota con su nombre adentro (patrón Duolingo música), con el eje de altura
 * rotulado según el conmutador C D E / Do Re Mi.
 *
 * Lo que dibuja es MEDIDA, no partitura: la curva fina es la altura real
 * cuadro a cuadro (f0) y los bloques son las notas que el análisis entendió.
 * Los MELISMAS (varias notas sobre una sílaba) llevan un corchete con su
 * vocal; al transponer, las notas que caen fuera de la tonalidad destino se
 * pintan en ámbar. Clic en una nota = suena; clic en el fondo = ir ahí.
 *
 * SVG (no canvas) a propósito: los colores salen de clases con tokens, así el
 * roll sigue el tema claro/oscuro sin re-montarse.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { Key, MelodyNote, Phrase, SungSyllable } from "@hermes/shared";
import { mod12, scaleNotes } from "@/lib/music-theory";
import { fmtTime, midiName } from "./format";
import { useQuantizedTime, type TimeClock } from "./useMemoPlayer";

const GUTTER = 52;
const AXIS_H = 20;
const WAVE_H = 30;
const ROW_H = 16;
const SYL_H = 44;
const BLACK = new Set([1, 3, 6, 8, 10]);

/** Vocal que se estira en un melisma: la última vocal de la sílaba ("quie" → "e"). */
export function melismaVowel(text: string): string {
  const m = text.toLowerCase().match(/[aeiouáéíóúü](?=[^aeiouáéíóúü]*$)/);
  return m ? m[0] : text;
}

export interface RollSyllable extends SungSyllable {
  phrase: number;
}

export function MelodyRoll({
  notes,
  f0,
  hop,
  shift,
  peaks,
  phrases,
  duration,
  displayKey,
  outMask,
  notation,
  clock,
  playing,
  selectedNote,
  activeNote,
  focusPhrase,
  pxPerSec,
  onNoteClick,
  onSeek,
  onPhraseClick,
}: {
  /** Notas YA transpuestas a lo que se muestra. */
  notes: MelodyNote[];
  f0: (number | null)[];
  hop: number;
  /** Semitonos aplicados (la curva f0 se mueve igual que las notas). */
  shift: number;
  peaks: number[];
  phrases: Phrase[];
  duration: number;
  /** Tonalidad para deletrear y para las filas de escala (la destino si se transpone). */
  displayKey: Key;
  /** Por nota: fuera de la tonalidad destino (null = no se marca). */
  outMask: boolean[] | null;
  notation: "en" | "latin";
  /** Reloj del reproductor: el cabezal va por DOM, la sílaba encendida se re-pinta al cruzar un borde. */
  clock: TimeClock;
  playing: boolean;
  selectedNote: number | null;
  activeNote: number | null;
  focusPhrase: number | null;
  pxPerSec: number;
  onNoteClick: (i: number) => void;
  onSeek: (t: number) => void;
  onPhraseClick: (idx: number) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [boxW, setBoxW] = useState(800);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setBoxW(el.clientWidth));
    ro.observe(el);
    setBoxW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const syllables: RollSyllable[] = useMemo(
    () => phrases.flatMap((ph) => ph.syllables.map((s) => ({ ...s, phrase: ph.idx }))),
    [phrases],
  );

  // Registro vertical: el de las notas (o de la curva si no hubo notas) + aire.
  const { lo, hi } = useMemo(() => {
    let a = Infinity;
    let b = -Infinity;
    for (const n of notes) {
      a = Math.min(a, n.midi);
      b = Math.max(b, n.midi);
    }
    if (!Number.isFinite(a)) {
      for (const v of f0) {
        if (v == null) continue;
        a = Math.min(a, v + shift);
        b = Math.max(b, v + shift);
      }
    }
    if (!Number.isFinite(a)) return { lo: 57, hi: 72 };
    return { lo: Math.floor(a) - 2, hi: Math.ceil(b) + 3 };
  }, [notes, f0, shift]);

  const rows = hi - lo + 1;
  const Y0 = AXIS_H + WAVE_H;
  const ROLL_H = rows * ROW_H;
  const H = Y0 + ROLL_H + SYL_H;
  const W = Math.max(boxW, Math.ceil(duration * pxPerSec));
  const pps = W / Math.max(0.01, duration);
  const X = (t: number) => t * pps;
  const yTop = (m: number) => Y0 + (hi - m) * ROW_H;
  const yMid = (m: number) => Y0 + (hi - m + 0.5) * ROW_H;
  const scale = useMemo(() => new Set(scaleNotes(displayKey)), [displayKey]);

  // Curva f0 como trazos (se corta en los silencios), a ~1 punto cada 2 px.
  const f0Path = useMemo(() => {
    if (!f0.length) return "";
    const step = Math.max(1, Math.floor(2 / Math.max(0.0001, hop * pps)));
    let d = "";
    let pen = false;
    for (let i = 0; i < f0.length; i += step) {
      const v = f0[i];
      if (v == null || v + shift < lo - 1 || v + shift > hi + 1) {
        pen = false;
        continue;
      }
      d += `${pen ? "L" : "M"}${(i * hop * pps).toFixed(1)} ${yMid(v + shift).toFixed(1)}`;
      pen = true;
    }
    return d;
  }, [f0, hop, pps, shift, lo, hi]);

  // Corchetes de melisma sobre las notas de la sílaba.
  const brackets = useMemo(
    () =>
      syllables
        .filter((s) => s.melisma && s.noteIdx.length > 1)
        .map((s) => {
          const ns = s.noteIdx.map((i) => notes[i]).filter(Boolean);
          if (ns.length < 2) return null;
          const x1 = X(Math.min(...ns.map((n) => n.start)));
          const x2 = X(Math.max(...ns.map((n) => n.end)));
          const top = Math.min(...ns.map((n) => yTop(n.midi))) - 7;
          return { key: `${s.start}-${s.text}`, x1, x2, top, vowel: melismaVowel(s.text), n: ns.length };
        })
        .filter((b): b is NonNullable<typeof b> => b !== null),
    [syllables, notes, pps, hi],
  );

  // Carril de sílabas en dos renglones para que las cortas no se pisen.
  const sylLayout = useMemo(() => {
    const ends = [-Infinity, -Infinity];
    return syllables.map((s) => {
      const x = X(s.start);
      const w = s.text.length * 7 + 8;
      const row = x >= ends[0] ? 0 : x >= ends[1] ? 1 : 0;
      ends[row] = x + w;
      return { x, row, w };
    });
  }, [syllables, pps]);

  const ticks = useMemo(() => {
    const step = pps > 90 ? 1 : pps > 40 ? 2 : 5;
    const out: number[] = [];
    for (let t = 0; t <= duration + 0.001; t += step) out.push(t);
    return out;
  }, [duration, pps]);

  // Cabezal por DOM desde el reloj (sin re-render por cuadro) y a la vista mientras suena
  // (el scroll es del contenedor, nunca de la página).
  const headRef = useRef<SVGLineElement>(null);
  const ppsRef = useRef(pps);
  ppsRef.current = pps;
  const playingRef = useRef(playing);
  playingRef.current = playing;
  useEffect(() => {
    const move = (t: number) => {
      const x = String(t * ppsRef.current);
      const line = headRef.current;
      if (line) {
        line.setAttribute("x1", x);
        line.setAttribute("x2", x);
      }
      const el = scrollRef.current;
      if (!el || !playingRef.current) return;
      const px = t * ppsRef.current;
      if (px < el.scrollLeft + 24 || px > el.scrollLeft + el.clientWidth - 60) el.scrollLeft = Math.max(0, px - 60);
    };
    move(clock.now());
    return clock.subscribe(move);
  }, [clock, pps]);

  // Enfocar una frase la trae a la vista.
  useEffect(() => {
    const el = scrollRef.current;
    const ph = phrases.find((p) => p.idx === focusPhrase);
    if (!el || !ph) return;
    const a = X(ph.start);
    const b = X(ph.end);
    if (a < el.scrollLeft || b > el.scrollLeft + el.clientWidth) el.scrollLeft = Math.max(0, a - 24);
  }, [focusPhrase]);

  const seekAt = (e: React.MouseEvent<SVGElement>) => {
    const svg = (e.currentTarget as SVGElement).ownerSVGElement ?? (e.currentTarget as SVGSVGElement);
    const r = svg.getBoundingClientRect();
    onSeek(Math.max(0, Math.min(duration, (e.clientX - r.left) / pps)));
  };

  const sylBounds = useMemo(() => syllables.flatMap((s) => [s.start, s.end]), [syllables]);
  const time = useQuantizedTime(clock, sylBounds);
  const currentSyl = syllables.findIndex((s) => time >= s.start && time < s.end);
  const peakW = peaks.length ? W / peaks.length : 0;

  return (
    <div className="flex min-w-0 select-none rounded-md border border-line bg-panel">
      {/* Eje de altura: fijo, no scrollea con el tiempo. */}
      <svg width={GUTTER} height={H} className="shrink-0 border-r border-line" aria-hidden>
        <text x={GUTTER - 8} y={Y0 - 10} textAnchor="end" fontSize={11} className="fill-text-faint">
          onda
        </text>
        {Array.from({ length: rows }, (_, r) => {
          const m = hi - r;
          const pc = mod12(m);
          const inScale = scale.has(pc);
          return (
            <g key={m}>
              {BLACK.has(pc) && <rect x={0} y={yTop(m)} width={GUTTER} height={ROW_H} className="fill-line/60" />}
              {inScale && (
                <text
                  x={GUTTER - 8}
                  y={yMid(m) + 4}
                  textAnchor="end"
                  fontSize={11}
                  fontWeight={pc === displayKey.tonic ? 600 : 400}
                  className={pc === displayKey.tonic ? "fill-text" : "fill-text-faint"}
                >
                  {midiName(m, displayKey, notation)}
                </text>
              )}
            </g>
          );
        })}
        <text x={GUTTER - 8} y={Y0 + ROLL_H + 18} textAnchor="end" fontSize={11} className="fill-text-faint">
          sílabas
        </text>
      </svg>

      <div ref={scrollRef} className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden overscroll-x-contain">
        <svg width={W} height={H} role="img" aria-label="Melodía del memo: notas, curva de altura y sílabas" className="block">
          {/* Fondo clicable = buscar */}
          <rect x={0} y={0} width={W} height={H} className="fill-transparent" onClick={seekAt} />

          {/* Filas de la rejilla: teclas negras sombreadas, escala tenue */}
          {Array.from({ length: rows }, (_, r) => {
            const m = hi - r;
            const pc = mod12(m);
            return BLACK.has(pc) ? (
              <rect key={m} x={0} y={yTop(m)} width={W} height={ROW_H} className="pointer-events-none fill-line/35" />
            ) : null;
          })}
          {ticks.map((t) => (
            <g key={t} className="pointer-events-none">
              <line x1={X(t)} x2={X(t)} y1={AXIS_H - 4} y2={Y0 + ROLL_H} className="stroke-line" />
              <text x={X(t) + 3} y={12} fontSize={11} className="fill-text-faint">
                {t < 60 ? `${t} s` : fmtTime(t)}
              </text>
            </g>
          ))}

          {/* Frases: banda de la enfocada + separadores con su rótulo */}
          {phrases.map((ph) => (
            <g key={ph.idx}>
              {ph.idx === focusPhrase && (
                <rect
                  x={X(ph.start)}
                  y={AXIS_H}
                  width={Math.max(2, X(ph.end) - X(ph.start))}
                  height={H - AXIS_H}
                  className="pointer-events-none fill-accent/6"
                />
              )}
              <line
                x1={X(ph.start)}
                x2={X(ph.start)}
                y1={AXIS_H}
                y2={H}
                strokeDasharray="3 3"
                className="pointer-events-none stroke-text-faint/50"
              />
              <text
                x={X(ph.start) + 4}
                y={AXIS_H + 11}
                fontSize={11}
                onClick={() => onPhraseClick(ph.idx)}
                className={`cursor-pointer ${ph.idx === focusPhrase ? "fill-accent" : "fill-text-faint hover:fill-text"}`}
              >
                F{ph.idx + 1}
              </text>
            </g>
          ))}

          {/* Onda del pasaje */}
          {peaks.map((v, i) => {
            const h = Math.max(1, v * (WAVE_H - 8));
            return (
              <rect
                key={i}
                x={i * peakW}
                y={AXIS_H + WAVE_H / 2 - h / 2}
                width={Math.max(0.8, peakW * 0.7)}
                height={h}
                className="pointer-events-none fill-line-2"
              />
            );
          })}

          {/* Curva de altura real (f0) */}
          {f0Path && (
            <path d={f0Path} fill="none" strokeWidth={1.2} className="pointer-events-none stroke-text-faint" />
          )}

          {/* Notas */}
          {notes.map((n, i) => {
            const x = X(n.start);
            const w = Math.max(2, X(n.end) - x - 1);
            const out = outMask?.[i] ?? false;
            const on = i === activeNote;
            const sel = i === selectedNote;
            const fill = on ? "fill-accent" : out ? "fill-amber/70" : "fill-blue/55";
            const stroke = sel ? "stroke-accent" : out ? "stroke-amber" : "stroke-blue";
            return (
              <g key={i} onClick={() => onNoteClick(i)} className="cursor-pointer">
                <rect
                  x={x}
                  y={yTop(n.midi) + 1}
                  width={w}
                  height={ROW_H - 2}
                  rx={3}
                  strokeWidth={sel ? 2 : 1}
                  className={`${fill} ${stroke}`}
                >
                  <title>
                    {midiName(n.midi, displayKey, notation)} · {(n.end - n.start).toFixed(2)} s
                    {n.cents ? ` · ${n.cents > 0 ? "+" : ""}${Math.round(n.cents)} c` : ""}
                    {out ? " · fuera de la tonalidad" : ""}
                  </title>
                </rect>
                {w >= 26 && (
                  <text
                    x={x + 4}
                    y={yMid(n.midi) + 4}
                    fontSize={11}
                    className={`pointer-events-none ${on ? "fill-white" : "fill-text"}`}
                  >
                    {midiName(n.midi, displayKey, notation).replace(/-?\d+$/, "")}
                  </text>
                )}
              </g>
            );
          })}

          {/* Melismas: corchete sobre las notas de UNA sílaba + la vocal que se estira */}
          {brackets.map((b) => (
            <g key={b.key} className="pointer-events-none">
              <path
                d={`M${b.x1} ${b.top + 5} V${b.top} H${b.x2} V${b.top + 5}`}
                fill="none"
                strokeWidth={1.5}
                className="stroke-chart-4"
              />
              <text x={(b.x1 + b.x2) / 2} y={b.top - 3} fontSize={11} textAnchor="middle" className="fill-chart-4">
                {b.vowel} ×{b.n}
              </text>
            </g>
          ))}

          {/* Carril de sílabas: tónica en negrita, relleno en gris, melisma con su línea */}
          <line x1={0} x2={W} y1={Y0 + ROLL_H} y2={Y0 + ROLL_H} className="stroke-line" />
          {syllables.map((s, i) => {
            const L = sylLayout[i];
            const y = Y0 + ROLL_H + 16 + L.row * 16;
            const now = i === currentSyl;
            const cls = now
              ? "fill-accent"
              : s.filler
                ? "fill-text-faint"
                : s.stressed
                  ? "fill-text"
                  : "fill-text-dim";
            return (
              <g key={i} onClick={() => onSeek(s.start)} className="cursor-pointer">
                {s.melisma && (
                  <line
                    x1={L.x + L.w - 4}
                    x2={Math.max(L.x + L.w, X(s.end))}
                    y1={y - 4}
                    y2={y - 4}
                    strokeWidth={1.5}
                    className="stroke-chart-4"
                  />
                )}
                <text
                  x={L.x + 2}
                  y={y}
                  fontSize={12}
                  fontWeight={s.stressed && !s.filler ? 600 : 400}
                  fontStyle={s.filler ? "italic" : undefined}
                  className={cls}
                >
                  {s.text}
                  <title>
                    {s.text}
                    {s.stressed ? " · tónica" : ""}
                    {s.filler ? " · relleno" : ""}
                    {s.melisma ? ` · melisma de ${s.noteIdx.length} notas` : ""}
                  </title>
                </text>
              </g>
            );
          })}

          {/* Playhead */}
          <line
            ref={headRef}
            x1={X(clock.now())}
            x2={X(clock.now())}
            y1={AXIS_H - 4}
            y2={H}
            strokeWidth={1.5}
            className="pointer-events-none stroke-accent"
          />
        </svg>
      </div>
    </div>
  );
}
