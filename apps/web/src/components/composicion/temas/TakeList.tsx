"use client";

/**
 * Las TOMAS de la sección (patrón Workable: "Toma 1 / 2 / 3" en fila, con los
 * huecos que faltan punteados). Se graba sin juzgar y se elige después: ★ es
 * la favorita (la que lee Análisis y usa el montaje). Las tomas no se borran
 * en esta fase — lo grabado es material.
 *
 * Cada toma se oye SOBRE SU PISTA (la que sonaba al grabarla), con la onda
 * encendiéndose a medida que suena. Mientras el agente la procesa se ve la
 * onda local de lo recién grabado; si no se pudo subir, queda en memoria con
 * "guardada solo en este navegador · Reintentar".
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { TakeGrid, TemaCandidate } from "@hermes/shared";
import { usePlaygroundApi } from "../playground/api";
import { fmtDuration } from "../playground/format";
import { btn, btnGhost } from "../playground/ui";
import { useTemaCtx } from "./TemaContext";
import {
  loadTakeAudio,
  localPeaks,
  playTake,
  uploadPending,
  usePendingTakes,
  type PendingTake,
  type TakePlayback,
} from "./take-audio";

const STATUS: Record<TemaCandidate["status"], { label: string; cls: string; pulse?: boolean }> = {
  procesando: { label: "procesando", cls: "text-text-dim", pulse: true },
  pendiente: { label: "en cola", cls: "text-text-dim" },
  analizando: { label: "analizando", cls: "text-text-dim", pulse: true },
  listo: { label: "lista", cls: "text-green" },
  error: { label: "falló el análisis", cls: "text-red" },
};

/** Tomas de la sección, en el orden en que se grabaron. */
export function sectionTakes(candidates: TemaCandidate[], sectionId: string): TemaCandidate[] {
  return candidates
    .filter((c) => c.kind === "toma" && c.sectionId === sectionId)
    .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
}

/** Onda de barras finas; la capa de progreso se estira por ref (sin re-render por cuadro). */
function Peaks({
  peaks,
  progressRef,
  dim,
}: {
  peaks: number[] | null;
  progressRef?: (el: HTMLDivElement | null) => void;
  dim?: boolean;
}) {
  const bars = (cls: string) => (
    <svg viewBox={`0 0 ${Math.max(1, peaks?.length ?? 1)} 20`} preserveAspectRatio="none" className="h-full w-full" aria-hidden>
      {(peaks ?? []).map((v, i) => {
        const h = Math.max(0.6, Math.min(1, v) * 18);
        return <rect key={i} x={i + 0.15} y={10 - h / 2} width={0.7} height={h} className={cls} />;
      })}
    </svg>
  );
  if (!peaks?.length)
    return <div className="h-full w-full border-y border-dashed border-line" aria-label="onda todavía no disponible" />;
  return (
    <div className="relative h-full w-full">
      {bars(dim ? "fill-line-2" : "fill-text-faint/70")}
      <div ref={progressRef} className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: 0 }}>
        <div className="h-full" style={{ width: "var(--full-w)" }}>
          {bars("fill-accent")}
        </div>
      </div>
    </div>
  );
}

export function TakeList({ onRecord, recording }: { onRecord: () => void; recording: boolean }) {
  const ctx = useTemaCtx();
  // Lo de AHORA tras un await (bajar y decodificar la toma tarda): la pista, la sección.
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const api = usePlaygroundApi();
  const takes = useMemo(() => sectionTakes(ctx.detail.candidates, ctx.section.id), [ctx.detail.candidates, ctx.section.id]);
  const pending = usePendingTakes(ctx.tema.id, ctx.section.id);
  const [peaks, setPeaks] = useState<Record<string, number[] | null>>({});
  const [favOverride, setFavOverride] = useState<Record<string, boolean>>({});
  const [playing, setPlaying] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const handleRef = useRef<TakePlayback | null>(null);
  /** Corrida de la escucha: ■, otra toma o salir durante la descarga la invalidan (ya no suena). */
  const runRef = useRef(0);
  const durRef = useRef(1);
  const progressEls = useRef(new Map<string, HTMLDivElement>());
  const boxRef = useRef<HTMLDivElement>(null);

  // Onda de cada toma: la local si se acaba de grabar; si no, la del agente. Se
  // vuelve a pedir cuando cambia el estado (al terminar de procesar ya existe).
  const peakKey = takes.map((t) => `${t.memo.sessionId}:${t.status}`).join("|");
  useEffect(() => {
    let alive = true;
    for (const t of takes) {
      const sid = t.memo.sessionId;
      const local = localPeaks.get(sid);
      if (local) {
        setPeaks((p) => (p[sid] ? p : { ...p, [sid]: local.peaks }));
        continue;
      }
      api
        .peaks(sid)
        .then((r) => alive && setPeaks((p) => ({ ...p, [sid]: r.peaks })))
        .catch(() => alive && setPeaks((p) => (sid in p ? p : { ...p, [sid]: null })));
    }
    return () => {
      alive = false;
    };
    // peakKey resume `takes` (id + estado): pedir de nuevo solo cuando algo cambió de verdad.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peakKey, api]);

  // La marca ★ optimista se suelta cuando el detalle ya la trae.
  useEffect(() => {
    setFavOverride((o) => {
      const next = { ...o };
      for (const t of takes) if (next[t.memo.sessionId] === t.favorite) delete next[t.memo.sessionId];
      return next;
    });
  }, [takes]);

  // Progreso: un solo rAF mientras algo suena; escribe el ancho por ref.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const el = progressEls.current.get(playing);
      const pos = handleRef.current?.position();
      if (!el) return;
      const w = el.parentElement?.clientWidth ?? 0;
      el.style.setProperty("--full-w", `${w}px`);
      el.style.width = pos == null ? "0px" : `${Math.min(1, pos / durRef.current) * w}px`;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const stop = () => {
    runRef.current++;
    const h = handleRef.current;
    handleRef.current = null;
    h?.stop();
    setPlaying(null);
  };
  const stopRef = useRef(stop);
  stopRef.current = stop;

  // Salir de la etapa calla lo que suena (y lo que se estaba bajando para sonar).
  useEffect(() => () => stopRef.current(), []);
  useEffect(() => {
    if (recording) stopRef.current();
  }, [recording]);
  // Vista oculta (otra ruta): lo que se estaba bajando tampoco suena al llegar.
  useEffect(() => {
    if (!ctx.active) stopRef.current();
  }, [ctx.active]);

  const play = async (key: string, load: () => Promise<{ buffer: AudioBuffer; grid: TakeGrid }>) => {
    if (playing === key) return stop();
    stop();
    const run = runRef.current;
    const ac = ctx.engine.context();
    if (!ac) return setRowError((e) => ({ ...e, [key]: "Este navegador no tiene audio web." }));
    setRowError((e) => ({ ...e, [key]: "" }));
    setPlaying(key);
    try {
      const { buffer, grid } = await load();
      // ■, otra toma o salir mientras bajaba: esta escucha ya no toca.
      if (runRef.current !== run) return;
      durRef.current = buffer.duration;
      const c = ctxRef.current;
      const h = playTake(c.engine, {
        base: c.tema.track,
        sectionId: c.section.id,
        grid,
        buffer,
        withTrack: true,
        onEnd: () => {
          if (handleRef.current === h) {
            handleRef.current = null;
            setPlaying((p) => (p === key ? null : p));
            const el = progressEls.current.get(key);
            if (el) el.style.width = "0px";
          }
        },
      });
      handleRef.current = h;
      if (!h) setPlaying(null);
    } catch (e) {
      if (runRef.current !== run) return;
      setPlaying(null);
      setRowError((x) => ({ ...x, [key]: (e as Error).message }));
    }
  };

  const toggleFav = async (t: TemaCandidate) => {
    const sid = t.memo.sessionId;
    const next = !(favOverride[sid] ?? t.favorite);
    // La ★ es UNA por sección: marcar esta se la quita a la que la tenía (el agente hace lo mismo).
    setFavOverride((o) => {
      const n = { ...o, [sid]: next };
      if (next) for (const x of takes) if (x.memo.sessionId !== sid && (o[x.memo.sessionId] ?? x.favorite)) n[x.memo.sessionId] = false;
      return n;
    });
    try {
      await ctx.patchTake(sid, { favorite: next });
      await ctx.reload();
    } catch (e) {
      setFavOverride((o) => {
        const n = { ...o };
        delete n[sid];
        return n;
      });
      setRowError((x) => ({ ...x, [sid]: `No se pudo marcar: ${(e as Error).message}` }));
    }
  };

  const retry = (p: PendingTake) => {
    void uploadPending(p, ctx.uploadTake).then((s) => {
      if (s) void ctx.reload();
    });
  };

  const used = takes.length + pending.length;
  const slots = Math.max(3, used + 1) - used;
  const nextN = used + 1;

  return (
    <section ref={boxRef} className="flex min-w-0 flex-col gap-2" aria-label={`Tomas de ${ctx.section.label}`}>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium text-text">
          Tomas de {ctx.section.label}
          {takes.length > 0 && <span className="ml-1.5 font-normal text-text-faint">{takes.length}</span>}
        </h3>
        {takes.some((t) => favOverride[t.memo.sessionId] ?? t.favorite) && (
          <span className="text-xs text-text-faint">★ = la que se analiza</span>
        )}
      </div>

      <ol className="flex flex-col gap-1.5">
        {takes.map((t) => {
          const sid = t.memo.sessionId;
          const fav = favOverride[sid] ?? t.favorite;
          const st = STATUS[t.status];
          const pk = peaks[sid];
          const dur = t.durationSec ?? localPeaks.get(sid)?.durationSec;
          const err = rowError[sid];
          return (
            <li
              key={sid}
              className={`flex flex-col gap-1.5 rounded-sm border px-2.5 py-2 ${fav ? "border-accent/60" : "border-line"} bg-panel`}
            >
              <div className="flex items-center gap-2">
                <span className="text-sm text-text">{t.label}</span>
                <span className={`flex items-center gap-1 text-xs ${st.cls}`}>
                  {st.pulse && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-text-dim" aria-hidden />}
                  {st.label}
                </span>
                <span className="ml-auto flex items-center gap-0.5">
                  <button
                    type="button"
                    className={`${btnGhost} text-sm ${fav ? "text-accent" : ""}`}
                    aria-pressed={fav}
                    aria-label={fav ? `Quitar ★ a ${t.label}` : `Marcar ${t.label} como favorita`}
                    title={fav ? "Quitar favorita" : "Favorita (S marca la última)"}
                    onClick={() => void toggleFav(t)}
                  >
                    {fav ? "★" : "☆"}
                  </button>
                  <button
                    type="button"
                    className={`${btnGhost} w-7 justify-center`}
                    aria-label={playing === sid ? `Parar ${t.label}` : `Escuchar ${t.label} sobre la pista`}
                    title="Escuchar sobre la pista (1 compás de entrada)"
                    disabled={recording}
                    onClick={() =>
                      void play(sid, async () => {
                        const ac = ctx.engine.context()!;
                        const { session, buffer } = await loadTakeAudio(api, ac, sid);
                        return { buffer, grid: session.take.grid };
                      })
                    }
                  >
                    {playing === sid ? "■" : "▶"}
                  </button>
                </span>
              </div>
              <div className="h-5">
                <Peaks
                  peaks={pk ?? null}
                  dim={t.status !== "listo"}
                  progressRef={(el) => {
                    if (el) progressEls.current.set(sid, el);
                    else progressEls.current.delete(sid);
                  }}
                />
              </div>
              <p className="flex flex-wrap gap-x-2 text-xs text-text-faint">
                {fmtDuration(dur) && <span>{fmtDuration(dur)}</span>}
                {t.syllables != null && <span>{t.syllables} sílabas</span>}
                {t.melismas != null && t.melismas > 0 && (
                  <span>
                    {t.melismas} {t.melismas === 1 ? "melisma" : "melismas"}
                  </span>
                )}
                {!t.onGrid && <span className="text-amber">sin rejilla</span>}
              </p>
              {err && <p className="text-xs text-red">{err}</p>}
            </li>
          );
        })}

        {pending.map((p) => (
          <li key={p.key} className="flex flex-col gap-1.5 rounded-sm border border-amber/60 bg-panel px-2.5 py-2">
            <div className="flex items-center gap-2">
              <span className="text-sm whitespace-nowrap text-text">Vuelta {p.cycle}</span>
              {p.state === "subiendo" ? (
                <span className="flex items-center gap-1 text-xs text-text-dim">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-text-dim" aria-hidden />
                  subiendo
                </span>
              ) : (
                <span className="text-xs whitespace-nowrap text-amber">sin subir</span>
              )}
              <span className="ml-auto flex items-center gap-0.5">
                {p.buffer && (
                  <button
                    type="button"
                    className={`${btnGhost} w-7 justify-center`}
                    aria-label={`Escuchar la vuelta ${p.cycle}`}
                    disabled={recording}
                    onClick={() => void play(p.key, async () => ({ buffer: p.buffer!, grid: p.meta.grid }))}
                  >
                    {playing === p.key ? "■" : "▶"}
                  </button>
                )}
                {p.state === "error" && (
                  <button type="button" className={btn} onClick={() => retry(p)}>
                    Reintentar
                  </button>
                )}
              </span>
            </div>
            <div className="h-5">
              <Peaks
                peaks={p.peaks}
                progressRef={(el) => {
                  if (el) progressEls.current.set(p.key, el);
                  else progressEls.current.delete(p.key);
                }}
              />
            </div>
            {p.state === "error" && (
              <p className="text-xs text-text-dim">
                Guardada solo en este navegador{p.error ? ` (${p.error})` : ""}. Reintentar la sube; recargar la página
                la pierde.
              </p>
            )}
          </li>
        ))}

        {Array.from({ length: slots }, (_, i) => (
          <li key={`hueco-${i}`}>
            {i === 0 ? (
              <button
                type="button"
                onClick={onRecord}
                disabled={recording}
                className="flex w-full cursor-pointer items-center justify-between rounded-sm border border-dashed border-line-2 px-2.5 py-2.5 text-left text-sm text-text-faint transition-colors hover:border-accent/60 hover:text-text disabled:cursor-default disabled:hover:border-line-2 disabled:hover:text-text-faint"
              >
                <span>Toma {nextN}</span>
                <span className="text-xs">
                  {recording ? "grabando…" : (
                    <>
                      <kbd className="font-mono">R</kbd> para grabar
                    </>
                  )}
                </span>
              </button>
            ) : (
              <div className="rounded-sm border border-dashed border-line px-2.5 py-2.5 text-sm text-text-faint/70">
                Toma {nextN + i}
              </div>
            )}
          </li>
        ))}
      </ol>

      <p className="text-xs text-text-faint">
        Graba todas las que quieras: elegirás tu favorita al revisar. Cada vuelta del loop es una toma;{" "}
        <kbd className="font-mono">S</kbd> marca ★ la última (una ★ por sección).
      </p>
    </section>
  );
}
