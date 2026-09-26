"use client";

/**
 * Franja de VOCES sobre el tiempo de la sesión (patrón Grain, pestaña
 * Timeline: una fila por hablante con su ocupación y "41 % · 8 min"). El
 * canto va SÓLIDO en el color de la voz y el habla TENUE: de un vistazo se ve
 * dónde se cantó. Arriba, la onda de la sesión y los pasajes detectados; clic
 * en cualquier fila = ir a ese momento.
 *
 * Colores: paleta categórica (chart-*), nunca ámbar/rojo (son de estado) y el
 * acento queda para el playhead y el pasaje elegido.
 */
import { useMemo } from "react";
import type { ComposeSession } from "@hermes/shared";
import type { ComposeTranscriptLine } from "./api";
import { VOICE_BG, VOICE_FILL } from "./ui";
import { fmtDuration, fmtTime } from "./format";

const W = 1000;

/** Sigue la cadena de uniones: la diarización parte a una persona en dos. */
export function resolveSpeaker(session: ComposeSession, id: string | undefined): string | undefined {
  let cur = id;
  for (let i = 0; i < 6 && cur; i++) {
    const sp = session.speakers.find((s) => s.id === cur);
    if (!sp?.mergedInto) return cur;
    cur = sp.mergedInto;
  }
  return cur;
}

/** Voces visibles (no unidas a otra) con su índice de color estable. */
export function visibleSpeakers(session: ComposeSession) {
  return session.speakers
    .filter((s) => !s.mergedInto)
    .map((s, i) => ({ ...s, color: i % VOICE_BG.length }));
}

export function VoiceStrip({
  session,
  transcript,
  peaks,
  duration,
  time,
  selected,
  onSeek,
  onSelectPassage,
}: {
  session: ComposeSession;
  transcript: ComposeTranscriptLine[] | null;
  peaks: number[] | null;
  duration: number;
  time: number;
  selected: string | null;
  onSeek: (t: number) => void;
  onSelectPassage: (pid: string) => void;
}) {
  const voices = useMemo(() => visibleSpeakers(session), [session]);
  const x = (t: number) => (Math.max(0, Math.min(duration, t)) / duration) * W;

  // Tramos por voz visible (las unidas suman a su destino).
  const segs = useMemo(() => {
    const m = new Map<string, { a: number; b: number; sung: boolean }[]>();
    for (const l of transcript ?? []) {
      const who = resolveSpeaker(session, l.speaker);
      if (!who) continue;
      if (!m.has(who)) m.set(who, []);
      m.get(who)!.push({ a: l.start, b: Math.max(l.end, l.start + 0.2), sung: l.sung });
    }
    return m;
  }, [transcript, session]);

  // Segundos por voz visible sumando sus unidas (los números los da el agente).
  const totals = useMemo(() => {
    const t = new Map<string, { seconds: number; singing: number }>();
    for (const sp of session.speakers) {
      const who = resolveSpeaker(session, sp.id)!;
      const cur = t.get(who) ?? { seconds: 0, singing: 0 };
      t.set(who, { seconds: cur.seconds + sp.seconds, singing: cur.singing + sp.singingSeconds });
    }
    return t;
  }, [session]);

  const ticks = useMemo(() => {
    const step = duration > 1800 ? 300 : duration > 600 ? 120 : duration > 120 ? 30 : 10;
    const out: number[] = [];
    for (let t = 0; t <= duration; t += step) out.push(t);
    return out;
  }, [duration]);

  const seekFrom = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    onSeek(((e.clientX - r.left) / r.width) * duration);
  };

  const playhead = (
    <line
      x1={x(time)}
      x2={x(time)}
      y1={0}
      y2={100}
      className="stroke-accent"
      strokeWidth={1.5}
      vectorEffect="non-scaling-stroke"
    />
  );

  const visiblePassages = session.passages.filter((p) => p.group !== "descartado");

  return (
    <div className="grid shrink-0 grid-cols-[96px_minmax(0,1fr)_96px] items-center gap-x-3 gap-y-1">
      {/* Regla de tiempo */}
      <span />
      <div className="relative h-4">
        {ticks.map((t) => (
          <span
            key={t}
            className="absolute top-0 -translate-x-1/2 font-mono text-2xs text-text-faint tabular-nums"
            style={{ left: `${(t / duration) * 100}%` }}
          >
            {fmtTime(t)}
          </span>
        ))}
      </div>
      <span className="text-right font-mono text-2xs text-text-faint tabular-nums">{fmtTime(duration)}</span>

      {/* Onda + pasajes detectados */}
      <span className="text-2xs text-text-faint">Pasajes</span>
      <svg
        viewBox={`0 0 ${W} 100`}
        preserveAspectRatio="none"
        className="block h-9 w-full cursor-pointer"
        onClick={seekFrom}
        role="img"
        aria-label="Onda de la sesión con los pasajes detectados"
      >
        {peaks &&
          peaks.map((v, i) => {
            const bw = W / peaks.length;
            const h = Math.max(2, v * 60);
            return (
              <rect key={i} x={i * bw} y={50 - h / 2} width={Math.max(0.6, bw * 0.7)} height={h} className="fill-line-2" />
            );
          })}
        {visiblePassages.map((p) => {
          const on = p.id === selected;
          return (
            <rect
              key={p.id}
              x={x(p.start)}
              y={on ? 4 : 12}
              width={Math.max(3, x(p.end) - x(p.start))}
              height={on ? 92 : 76}
              rx={2}
              onClick={(e) => {
                e.stopPropagation();
                onSelectPassage(p.id);
              }}
              className={`cursor-pointer ${
                on
                  ? "fill-accent/30 stroke-accent"
                  : p.group === "dudoso"
                    ? "fill-transparent stroke-text-faint"
                    : "fill-text-dim/25 stroke-text-dim/60"
              }`}
              strokeDasharray={p.group === "dudoso" ? "4 3" : undefined}
              vectorEffect="non-scaling-stroke"
            >
              <title>
                {p.label} · {fmtTime(p.start)}–{fmtTime(p.end)}
              </title>
            </rect>
          );
        })}
        {playhead}
      </svg>
      <span className="text-right text-2xs text-text-faint tabular-nums">{visiblePassages.length}</span>

      {voices.length === 0 && (
        <>
          <span />
          <p className="text-xs text-text-faint">Las voces aparecen cuando termina la transcripción.</p>
          <span />
        </>
      )}
      {voices.map((v) => {
        const tot = totals.get(v.id);
        const rows = segs.get(v.id) ?? [];
        return (
          <VoiceRow
            key={v.id}
            name={v.name}
            color={v.color}
            share={tot && duration ? tot.seconds / duration : null}
            seconds={tot?.seconds ?? null}
            singing={tot?.singing ?? null}
          >
            <svg
              viewBox={`0 0 ${W} 100`}
              preserveAspectRatio="none"
              className="block h-3.5 w-full cursor-pointer"
              onClick={seekFrom}
              aria-hidden
            >
              <rect x={0} y={45} width={W} height={10} className="fill-line" />
              {rows.map((r, i) => (
                <rect
                  key={i}
                  x={x(r.a)}
                  y={r.sung ? 0 : 25}
                  width={Math.max(0.8, x(r.b) - x(r.a))}
                  height={r.sung ? 100 : 50}
                  className={VOICE_FILL[v.color]}
                  opacity={r.sung ? 1 : 0.35}
                />
              ))}
              {playhead}
            </svg>
          </VoiceRow>
        );
      })}
    </div>
  );
}

function VoiceRow({
  name,
  color,
  share,
  seconds,
  singing,
  children,
}: {
  name: string;
  color: number;
  share: number | null;
  seconds: number | null;
  singing: number | null;
  children: React.ReactNode;
}) {
  return (
    <>
      <span className="flex min-w-0 items-center gap-1.5 text-xs text-text-dim">
        <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${VOICE_BG[color]}`} />
        <span className="truncate" title={name}>
          {name}
        </span>
      </span>
      {children}
      <span
        className="truncate text-right text-2xs text-text-faint tabular-nums"
        title={singing ? `${fmtDuration(singing)} cantando` : undefined}
      >
        {share != null && seconds != null ? `${Math.round(share * 100)} % · ${fmtDuration(seconds)}` : ""}
        {singing ? ` · ♪ ${fmtDuration(singing)}` : ""}
      </span>
    </>
  );
}
