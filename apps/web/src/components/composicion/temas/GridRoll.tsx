"use client";

/**
 * La toma leída en la REJILLA, en SVG: el mismo tarareo del piano roll del
 * memo, pero contado como lo cuenta un músico — compás, tiempo y semicorchea
 * — porque se grabó sobre la pista y el análisis SABE el tempo.
 *
 * De arriba abajo, un solo eje de tiempo (patrón Plane para la cabecera de
 * dos niveles compás/tiempo, compases alternos sombreados y zoom
 * compás | tiempo | 1/16):
 *   compás · tiempo · carril de acordes · notas por altura (color por rol,
 *   ligadura con la vocal del melisma, marca de desvío del ataque) · franja de
 *   dinámica tipo heatmap (Plain/Gorgias) · sílabas · vocales con puntos entre
 *   sílabas (CapWords).
 * Las notas DUDOSAS (altura entre dos semitonos) van punteadas con "?": se
 * ven, no se esconden — el humano decide.
 *
 * SVG y no canvas: los colores salen de clases con tokens, así la rejilla
 * sigue el tema claro/oscuro sin re-montarse. El cabezal de escucha se mueve
 * por ref (un estado por cuadro re-renderizaría toda la rejilla).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChordBar, GridPhraseStats, Key, Meter } from "@hermes/shared";
import { secPerStep, stepsPerBar, stepsPerBeat } from "@hermes/shared";
import { mod12, scaleNotes } from "@/lib/music-theory";
import { midiName } from "../playground/format";
import {
  DYN_FILL,
  DYN_INK,
  ROLE_STYLE,
  beatsText,
  chordSpans,
  figureName,
  overChord,
  posText,
  type GridRow,
  type GridSyllable,
} from "./grid-view";

export type GridZoom = "compas" | "tiempo" | "16";
export const ZOOMS: { id: GridZoom; label: string }[] = [
  { id: "compas", label: "compás" },
  { id: "tiempo", label: "tiempo" },
  { id: "16", label: "1/16" },
];

const GUTTER = 68;
const BAR_H = 18;
const BEAT_H = 16;
const CHORD_H = 28;
const ROW_H = 14;
const DYN_H = 18;
const SYL_H = 46;
const VOW_H = 34;
const BLACK = new Set([1, 3, 6, 8, 10]);

export function GridRoll({
  meter,
  bpm,
  keySig,
  loop,
  bars,
  rows,
  syllables,
  phrases,
  zoom,
  selected,
  onSelect,
  onPhrase,
  playStep,
  playing,
}: {
  meter: Meter;
  bpm: number;
  keySig: Key;
  loop: ChordBar[];
  /** Compases grabados en la toma (la rejilla se dibuja al menos hasta aquí). */
  bars: number;
  /** null = cargando: la rejilla y los acordes ya se ven, las notas en esqueleto. */
  rows: GridRow[] | null;
  syllables: GridSyllable[];
  phrases: GridPhraseStats[];
  zoom: GridZoom;
  selected: number | null;
  onSelect: (k: number) => void;
  onPhrase?: (idx: number) => void;
  /** Paso de la rejilla que suena (para el cabezal), o null. */
  playStep?: () => number | null;
  playing: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<SVGLineElement>(null);
  const [boxW, setBoxW] = useState(800);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setBoxW(el.clientWidth));
    ro.observe(el);
    setBoxW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const spb = stepsPerBar(meter);
  const spbeat = stepsPerBeat(meter);
  const sps = secPerStep(bpm, meter);
  const list = rows ?? [];

  // Extensión: desde el compás de la anacrusa (si la hay) hasta el último compás grabado o sonado.
  const { fromStep, toStep } = useMemo(() => {
    let lo = 0;
    let hi = Math.max(1, bars) * spb;
    for (const r of list) {
      lo = Math.min(lo, r.g.absStep);
      hi = Math.max(hi, r.g.absStep + r.g.len16);
    }
    for (const s of syllables) lo = Math.min(lo, s.step);
    // La anacrusa se muestra desde el TIEMPO en que entra, no el compás entero (sería espacio vacío).
    return { fromStep: lo < 0 ? Math.floor(lo / spbeat) * spbeat : 0, toStep: Math.ceil(hi / spb) * spb };
  }, [list, syllables, bars, spb, spbeat]);

  const total = Math.max(1, toStep - fromStep);
  const fit = Math.max(1, boxW - 2) / total;
  const stepW = zoom === "compas" ? Math.max(2.5, fit) : zoom === "tiempo" ? Math.max(fit, 11) : Math.max(fit, 24);
  const W = Math.ceil(total * stepW);
  const X = (step: number) => (step - fromStep) * stepW;

  // Registro vertical: el de las notas + aire arriba para las ligaduras de melisma.
  const { lo, hi } = useMemo(() => {
    if (!list.length) return { lo: 57, hi: 71 };
    const a = Math.min(...list.map((r) => r.midi));
    const b = Math.max(...list.map((r) => r.midi));
    const pad = Math.max(0, 11 - (b - a)) / 2;
    return { lo: Math.floor(a - 1 - pad), hi: Math.ceil(b + 2 + pad) };
  }, [list]);
  const nRows = hi - lo + 1;

  const Y_BEAT = BAR_H;
  const Y_CHORD = BAR_H + BEAT_H;
  const Y_NOTES = Y_CHORD + CHORD_H;
  const NOTES_H = nRows * ROW_H;
  const Y_DYN = Y_NOTES + NOTES_H + 4;
  const Y_SYL = Y_DYN + DYN_H + 2;
  const Y_VOW = Y_SYL + SYL_H;
  const H = Y_VOW + VOW_H;
  const yTop = (m: number) => Y_NOTES + (hi - m) * ROW_H;
  const yMid = (m: number) => yTop(m) + ROW_H / 2;

  const scale = useMemo(() => new Set(scaleNotes(keySig)), [keySig]);
  const spans = useMemo(
    () => chordSpans(loop, Math.max(1, Math.ceil(toStep / spb)), meter, Math.floor(fromStep / spb) + 1),
    [loop, toStep, fromStep, spb, meter],
  );
  const sel = selected != null ? list.find((r) => r.k === selected) ?? null : null;
  const selSpan = sel ? spans.find((s) => sel.g.absStep >= s.from && sel.g.absStep < s.to) ?? null : null;

  // Ligaduras de melisma: varias notas sobre UNA sílaba, con la vocal que se estira.
  const byNote = useMemo(() => new Map(list.map((r) => [r.g.i, r])), [list]);
  const slurs = useMemo(
    () =>
      syllables
        .filter((s) => s.s.melisma && s.s.noteIdx.length > 1)
        .map((s) => {
          const rs = s.s.noteIdx.map((i) => byNote.get(i)).filter((r): r is GridRow => !!r);
          if (rs.length < 2) return null;
          const first = rs.reduce((a, b) => (b.g.absStep < a.g.absStep ? b : a));
          const last = rs.reduce((a, b) => (b.g.absStep + b.g.len16 > a.g.absStep + a.g.len16 ? b : a));
          const top = Math.min(...rs.map((r) => yTop(r.midi))) - 3;
          return {
            key: `${s.step}-${s.s.text}`,
            x1: X(first.g.absStep) + 2,
            x2: X(last.g.absStep + last.g.len16) - 3,
            top,
            label: `${s.vowel ?? s.s.text} ×${rs.length}`,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null),
    // X depende de stepW/fromStep; yTop de hi.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [syllables, byNote, stepW, fromStep, hi],
  );

  // Sílabas y vocales en dos renglones cuando no caben (a zoom de compás se pisan).
  const sylLayout = useMemo(() => {
    const ends = [-Infinity, -Infinity, -Infinity];
    const vEnds = [-Infinity, -Infinity];
    return syllables.map((s) => {
      const x = X(s.step);
      const w = s.s.text.length * 6.6 + 8;
      // Primer renglón libre; si los tres están ocupados, el que se libera antes.
      let row = ends.findIndex((e) => x >= e);
      if (row < 0) row = ends.indexOf(Math.min(...ends));
      ends[row] = x + w;
      const vrow = x >= vEnds[0] ? 0 : x >= vEnds[1] ? 1 : 0;
      vEnds[vrow] = x + 12;
      return { x, w, row, vrow };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syllables, stepW, fromStep]);

  // Cabezal por ref mientras suena.
  useEffect(() => {
    const line = headRef.current;
    if (!line) return;
    if (!playing || !playStep) {
      line.setAttribute("visibility", "hidden");
      return;
    }
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const st = playStep();
      if (st == null) {
        line.setAttribute("visibility", "hidden");
        return;
      }
      const x = X(st);
      line.setAttribute("visibility", "visible");
      line.setAttribute("x1", String(x));
      line.setAttribute("x2", String(x));
      const el = scrollRef.current;
      if (el && (x < el.scrollLeft + 24 || x > el.scrollLeft + el.clientWidth - 60)) el.scrollLeft = Math.max(0, x - 60);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, playStep, stepW, fromStep]);

  // La nota elegida siempre a la vista (←/→ la recorren).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !sel) return;
    const a = X(sel.g.absStep);
    const b = X(sel.g.absStep + sel.g.len16);
    if (a < el.scrollLeft + 8 || b > el.scrollLeft + el.clientWidth - 8) el.scrollLeft = Math.max(0, a - el.clientWidth / 3);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, stepW]);

  const firstBar = Math.floor(fromStep / spb) + 1;
  const lastBar = toStep / spb;
  const barList = Array.from({ length: lastBar - firstBar + 1 }, (_, i) => firstBar + i);
  const beatW = spbeat * stepW;
  const showBeatNums = beatW >= 14;

  // Esqueleto: bloques en posiciones fijas (deterministas) mientras llegan las notas.
  const skeleton = useMemo(() => {
    if (rows) return [];
    const out: { x: number; y: number; w: number }[] = [];
    for (let st = 0; st < Math.max(1, bars) * spb; st += spbeat) {
      const r = (st / spbeat) * 5 + 3;
      out.push({ x: X(st) + 1, y: Y_NOTES + (r % Math.max(1, nRows - 2)) * ROW_H + ROW_H, w: Math.max(3, beatW * 0.75) });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, bars, spb, spbeat, stepW, nRows]);

  return (
    <div className="flex min-w-0 select-none rounded-md border border-line bg-panel">
      {/* Rótulos fijos: no scrollean con el tiempo. */}
      <svg width={GUTTER} height={H} className="shrink-0 border-r border-line" aria-hidden>
        <text x={GUTTER - 8} y={13} textAnchor="end" fontSize={11} className="fill-text-faint">
          compás
        </text>
        <text x={GUTTER - 8} y={Y_BEAT + 12} textAnchor="end" fontSize={11} className="fill-text-faint">
          tiempo
        </text>
        <text x={GUTTER - 8} y={Y_CHORD + 18} textAnchor="end" fontSize={11} className="fill-text-faint">
          acordes
        </text>
        {Array.from({ length: nRows }, (_, r) => {
          const m = hi - r;
          const pc = mod12(m);
          return (
            <g key={m}>
              {BLACK.has(pc) && <rect x={0} y={yTop(m)} width={GUTTER} height={ROW_H} className="fill-line/50" />}
              {scale.has(pc) && (
                <text
                  x={GUTTER - 8}
                  y={yMid(m) + 4}
                  textAnchor="end"
                  fontSize={11}
                  fontWeight={pc === keySig.tonic ? 600 : 400}
                  className={pc === keySig.tonic ? "fill-text" : "fill-text-faint"}
                >
                  {midiName(m, keySig, "en")}
                </text>
              )}
            </g>
          );
        })}
        <text x={GUTTER - 8} y={Y_DYN + 13} textAnchor="end" fontSize={11} className="fill-text-faint">
          dinámica
        </text>
        <text x={GUTTER - 8} y={Y_SYL + 15} textAnchor="end" fontSize={11} className="fill-text-faint">
          sílabas
        </text>
        <text x={GUTTER - 8} y={Y_VOW + 15} textAnchor="end" fontSize={11} className="fill-text-faint">
          vocales
        </text>
      </svg>

      <div ref={scrollRef} className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden overscroll-x-contain">
        <svg
          width={W}
          height={H}
          role="img"
          aria-label="La toma en la rejilla: compases, acordes, notas, dinámica, sílabas y vocales"
          className="block"
        >
          {/* Compases alternos sombreados; la anacrusa, rayada aparte. */}
          {barList.map((b, i) => (
            <rect
              key={`bg-${b}`}
              x={X((b - 1) * spb)}
              y={0}
              width={spb * stepW}
              height={H}
              className={b <= 0 ? "fill-line/35" : i % 2 === 1 ? "fill-panel-2/80" : "fill-transparent"}
            />
          ))}

          {/* Banda de la nota elegida: la une con su acorde, su dinámica y su sílaba. */}
          {sel && (
            <rect
              x={X(sel.g.absStep)}
              y={Y_BEAT}
              width={Math.max(2, sel.g.len16 * stepW)}
              height={H - Y_BEAT}
              className="pointer-events-none fill-accent/8"
            />
          )}

          {/* Filas de altura: teclas negras sombreadas. */}
          {Array.from({ length: nRows }, (_, r) => {
            const m = hi - r;
            return BLACK.has(mod12(m)) ? (
              <rect key={`row-${m}`} x={0} y={yTop(m)} width={W} height={ROW_H} className="pointer-events-none fill-line/25" />
            ) : null;
          })}

          {/* Rejilla vertical: compás, tiempo y (a 1/16) semicorchea. */}
          {barList.map((b) => {
            const x0 = X((b - 1) * spb);
            return (
              <g key={`grid-${b}`} className="pointer-events-none">
                <line x1={x0} x2={x0} y1={0} y2={Y_DYN + DYN_H} className="stroke-line-2" />
                {Array.from({ length: spb / spbeat }, (_, k) => {
                  const x = x0 + k * beatW;
                  return (
                    <g key={k}>
                      {k > 0 && <line x1={x} x2={x} y1={Y_BEAT} y2={Y_DYN + DYN_H} className="stroke-line" />}
                      {showBeatNums && (
                        <text x={x + 3} y={Y_BEAT + 12} fontSize={11} className={k === 0 ? "fill-text-dim" : "fill-text-faint"}>
                          {k + 1}
                        </text>
                      )}
                    </g>
                  );
                })}
                {zoom === "16" &&
                  Array.from({ length: spb }, (_, s) =>
                    s % spbeat ? (
                      <line
                        key={`s${s}`}
                        x1={x0 + s * stepW}
                        x2={x0 + s * stepW}
                        y1={Y_NOTES}
                        y2={Y_NOTES + NOTES_H}
                        strokeDasharray="2 3"
                        className="stroke-line-2/70"
                      />
                    ) : null,
                  )}
                <text
                  x={Math.max(x0, 0) + 4}
                  y={13}
                  fontSize={11}
                  fontWeight={500}
                  className={b <= 0 ? "fill-text-faint" : "fill-text-dim"}
                >
                  {b <= 0 ? (X(b * spb) >= 76 ? "anacrusa" : X(b * spb) >= 48 ? "anac." : "") : b}
                </text>
              </g>
            );
          })}
          <line x1={0} x2={W} y1={Y_BEAT} y2={Y_BEAT} className="stroke-line" />
          <line x1={0} x2={W} y1={Y_CHORD} y2={Y_CHORD} className="stroke-line" />

          {/* Carril de acordes: un bloque por acorde, tan ancho como suena. */}
          {spans.map((s, i) => {
            // En la anacrusa recortada solo se dibuja lo que cae a la vista (si no, los rótulos se pisan).
            if (s.to <= fromStep) return null;
            const on = selSpan === s;
            const x = X(Math.max(s.from, fromStep)) + 1.5;
            const w = Math.max(2, (s.to - Math.max(s.from, fromStep)) * stepW - 3);
            return (
              <g key={`ch-${i}`}>
                <rect
                  x={x}
                  y={Y_CHORD + 4}
                  width={w}
                  height={CHORD_H - 8}
                  rx={4}
                  strokeWidth={on ? 1.5 : 1}
                  strokeDasharray={s.pickup ? "3 3" : undefined}
                  className={on ? "fill-accent/10 stroke-accent" : s.pickup ? "fill-transparent stroke-line-2" : "fill-panel stroke-line-2"}
                >
                  {s.pickup && <title>Anacrusa: en la primera vuelta aquí solo sonaba la cuenta; en las siguientes, el final del loop.</title>}
                </rect>
                {w > 18 && (
                  <text
                    x={x + 6}
                    y={Y_CHORD + CHORD_H / 2 + 4}
                    fontSize={12}
                    fontWeight={500}
                    className={`pointer-events-none ${s.pickup ? "fill-text-faint" : "fill-text"}`}
                  >
                    {s.symbol}
                  </text>
                )}
              </g>
            );
          })}

          {/* Frases: separador punteado + rótulo (clic = ir a la frase). */}
          {phrases.map((p) => {
            const st = (p.startBar - 1) * spb - p.pickup16;
            const x = X(st);
            return (
              <g key={`f-${p.idx}`}>
                <line
                  x1={x}
                  x2={x}
                  y1={Y_NOTES}
                  y2={Y_VOW + VOW_H}
                  strokeDasharray="3 3"
                  className="pointer-events-none stroke-text-faint/50"
                />
                <text
                  x={x + 4}
                  y={Y_NOTES + 12}
                  fontSize={11}
                  onClick={() => onPhrase?.(p.idx)}
                  className="cursor-pointer fill-text-faint hover:fill-text"
                >
                  F{p.idx + 1}
                </text>
              </g>
            );
          })}

          {/* Esqueleto mientras se lee la toma. */}
          {skeleton.map((s, i) => (
            <rect key={`sk-${i}`} x={s.x} y={s.y} width={s.w} height={ROW_H - 3} rx={3} className="animate-pulse fill-line-2" />
          ))}

          {/* Notas */}
          {list.map((r) => {
            const g = r.g;
            const st = ROLE_STYLE[g.role];
            const x = X(g.absStep) + 0.5;
            const w = Math.max(2, g.len16 * stepW - 1.5);
            const isSel = r.k === selected;
            const name = midiName(r.midi, keySig, "en").replace(/-?\d+$/, "");
            return (
              <g key={`n-${r.k}`} onClick={() => onSelect(r.k)} className="cursor-pointer">
                <rect
                  x={x}
                  y={yTop(r.midi) + 1}
                  width={w}
                  height={ROW_H - 2}
                  rx={3}
                  strokeWidth={isSel ? 2 : 1}
                  strokeDasharray={r.doubtful ? "3 2" : undefined}
                  className={`${st.fill} ${isSel ? "stroke-accent" : st.stroke}`}
                >
                  <title>
                    {`${midiName(r.midi, keySig, "en")} · ${posText(g, meter)} · ${beatsText(g.len16, meter)} t (${figureName(g.len16)}) · ${overChord(g)} · ${st.label}${r.doubtful ? " · altura dudosa" : ""}`}
                  </title>
                </rect>
                {w >= 24 && (
                  <text x={x + 4} y={yMid(r.midi) + 4} fontSize={10.5} className="pointer-events-none fill-text">
                    {name}
                  </text>
                )}
                {r.doubtful && (
                  <text
                    x={w >= 24 ? x + w - 8 : x + w + 2}
                    y={yMid(r.midi) + 4}
                    fontSize={11}
                    fontWeight={600}
                    className="pointer-events-none fill-amber"
                  >
                    ?
                  </text>
                )}
                {/* Desvío del ataque: de la rejilla a donde entró de verdad. */}
                {zoom !== "compas" && Math.abs(g.offMs) >= 12 && (
                  <g className="pointer-events-none">
                    <line
                      x1={X(g.absStep)}
                      x2={X(g.absStep) + (g.offMs / 1000 / sps) * stepW}
                      y1={yTop(r.midi) + ROW_H + 1.5}
                      y2={yTop(r.midi) + ROW_H + 1.5}
                      strokeWidth={2}
                      className={Math.abs(g.offMs) >= 40 ? "stroke-amber" : "stroke-text-faint"}
                    />
                    <circle
                      cx={X(g.absStep) + (g.offMs / 1000 / sps) * stepW}
                      cy={yTop(r.midi) + ROW_H + 1.5}
                      r={1.8}
                      className={Math.abs(g.offMs) >= 40 ? "fill-amber" : "fill-text-faint"}
                    />
                  </g>
                )}
              </g>
            );
          })}

          {/* Ligaduras de melisma con la vocal que se estira. */}
          {slurs.map((s) => (
            <g key={s.key} className="pointer-events-none">
              <path
                d={`M${s.x1} ${s.top} Q${(s.x1 + s.x2) / 2} ${s.top - 11} ${s.x2} ${s.top}`}
                fill="none"
                strokeWidth={1.5}
                className="stroke-text-dim"
              />
              <text x={(s.x1 + s.x2) / 2} y={s.top - 8} fontSize={11} fontWeight={600} textAnchor="middle" className="fill-text">
                {s.label}
              </text>
            </g>
          ))}

          {/* Dinámica: heatmap por nota (relativa a esta toma). */}
          <rect x={0} y={Y_DYN} width={W} height={DYN_H} className="pointer-events-none fill-line/30" />
          {list.map((r) => {
            const x = X(r.g.absStep) + 0.5;
            const w = Math.max(1.5, r.g.len16 * stepW - 1);
            return (
              <g key={`d-${r.k}`} onClick={() => onSelect(r.k)} className="cursor-pointer">
                <rect x={x} y={Y_DYN + 1} width={w} height={DYN_H - 2} className={DYN_FILL[r.g.dynamic]}>
                  <title>{`dinámica ${Math.round(r.g.velocity)} → ${r.g.dynamic}`}</title>
                </rect>
                {w >= 18 && (
                  <text x={x + 3} y={Y_DYN + 13} fontSize={10.5} fontStyle="italic" className={`pointer-events-none ${DYN_INK[r.g.dynamic]}`}>
                    {r.g.dynamic}
                  </text>
                )}
              </g>
            );
          })}

          {/* Sílabas (lo que se tarareó) y vocales, con puntos entre sílabas de la misma frase. */}
          <line x1={0} x2={W} y1={Y_SYL} y2={Y_SYL} className="stroke-line" />
          {syllables.map((s, i) => {
            const L = sylLayout[i];
            const y = Y_SYL + 14 + L.row * 13;
            const prev = i > 0 ? syllables[i - 1] : null;
            const prevL = i > 0 ? sylLayout[i - 1] : null;
            const dot =
              prev && prevL && prev.phrase === s.phrase && L.row === 0 && prevL.row === 0 && L.x - (prevL.x + prevL.w) >= 6
                ? (prevL.x + prevL.w + L.x) / 2
                : null;
            const endX = X(s.endStep);
            return (
              <g key={`s-${i}`} className="pointer-events-none">
                {dot != null && (
                  <text x={dot} y={Y_SYL + 14} fontSize={12} textAnchor="middle" className="fill-text-faint">
                    ·
                  </text>
                )}
                <text
                  x={L.x + 2}
                  y={y}
                  fontSize={12}
                  fontStyle={s.s.filler ? "italic" : undefined}
                  fontWeight={s.s.stressed ? 600 : 400}
                  className={s.s.stressed ? "fill-text" : "fill-text-dim"}
                >
                  {s.s.text}
                </text>
                {s.s.melisma && endX > L.x + L.w && (
                  <line x1={L.x + L.w - 2} x2={endX - 2} y1={y + 2} y2={y + 2} strokeWidth={1.2} className="stroke-text-faint" />
                )}
              </g>
            );
          })}
          <line x1={0} x2={W} y1={Y_VOW} y2={Y_VOW} className="stroke-line/60" />
          {syllables.map((s, i) => {
            if (!s.vowel) return null;
            const L = sylLayout[i];
            return (
              <text
                key={`v-${i}`}
                x={L.x + 2}
                y={Y_VOW + 15 + L.vrow * 13}
                fontSize={12}
                fontWeight={600}
                className="pointer-events-none fill-text"
              >
                {s.vowel}
              </text>
            );
          })}

          {/* Cabezal de escucha */}
          <line ref={headRef} x1={0} x2={0} y1={0} y2={H} strokeWidth={1.5} visibility="hidden" className="pointer-events-none stroke-accent" />
        </svg>
      </div>
    </div>
  );
}
