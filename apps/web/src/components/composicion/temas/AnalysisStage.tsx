"use client";

/**
 * Tema · ANÁLISIS — la toma ★ (o la que elijas) leída en la rejilla. Como se
 * grabó sobre la pista, el análisis no adivina el tempo: sabe dónde cae cada
 * compás. Lo que muestra es MEDIDA: nota por compás.tiempo, qué es respecto
 * del acorde, cuánto dura en tiempos, melismas, vocal del fonema y dinámica
 * 0–100 → pp..ff (relativa a esta toma). Dos vistas del mismo dato: Rejilla
 * (para ver) y Tabla (para leer), más la lectura en números por frase.
 *
 * Atajos (con las guardas de la casa: nada con el foco en un campo, Espacio
 * cede ante un botón): ←/→ nota · [ ] frase · V Rejilla/Tabla · Z zoom ·
 * Espacio escucha desde la nota elegida. Tab NO es un atajo: es cómo se navega
 * con teclado (WCAG 2.1.1) — robarlo desde el body dejaba a quien no usa mouse
 * sin forma de entrar a la etapa.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComposeSession, PassageAnalysis, TemaCandidate } from "@hermes/shared";
import { secPerStep } from "@hermes/shared";
import { playNote } from "@/lib/chord-audio";
import { keyLabel } from "@/lib/music-theory";
import { usePlaygroundApi } from "../playground/api";
import { btn, btnPrimary, chip, plainKey, spaceOnButton } from "../playground/ui";
import { useTemaCtx } from "./TemaContext";
import { sectionTakes } from "./TakeList";
import { GridRoll, ZOOMS, type GridZoom } from "./GridRoll";
import { GridTable } from "./GridTable";
import { GridReadout } from "./GridReadout";
import {
  DYNAMICS,
  DYN_BG,
  ROLE_ORDER,
  ROLE_STYLE,
  gridRows,
  gridSyllables,
  noteCard,
  noteExtras,
  phraseOfNotes,
  syllableOfNotes,
} from "./grid-view";
import { TAKE_PASSAGE, loadTakeAudio, playTake, type TakePlayback } from "./take-audio";

type View = "rejilla" | "tabla";

const LS_VIEW = "hermes-temas-analisis-vista";
const LS_ZOOM = "hermes-temas-analisis-zoom";
const LS_TRACK = "hermes-temas-analisis-con-pista";

const STEP_TEXT: Partial<Record<TemaCandidate["status"], string>> = {
  procesando: "La toma se está procesando en el agente: altura, sílabas y su lectura en la rejilla.",
  pendiente: "La toma espera turno en el agente.",
  analizando: "El agente está leyendo la toma en la rejilla.",
};

const lsGet = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const lsSet = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* preferencia de esta visita */
  }
};

export function AnalysisStage() {
  const ctx = useTemaCtx();
  const api = usePlaygroundApi();
  const { tema, section } = ctx;
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  const takes = useMemo(() => sectionTakes(ctx.detail.candidates, section.id), [ctx.detail.candidates, section.id]);
  const [chosen, setChosen] = useState<string | null>(null);
  const target: TemaCandidate | null =
    takes.find((t) => t.memo.sessionId === chosen) ?? takes.find((t) => t.favorite) ?? null;
  const sid = target?.memo.sessionId ?? null;
  const pid = target?.memo.passageId ?? TAKE_PASSAGE;
  const status = target?.status ?? null;

  const [view, setView] = useState<View>("rejilla");
  const [zoom, setZoom] = useState<GridZoom>("tiempo");
  const [withTrack, setWithTrack] = useState(true);
  useEffect(() => {
    const v = lsGet(LS_VIEW);
    if (v === "rejilla" || v === "tabla") setView(v);
    const z = lsGet(LS_ZOOM);
    if (z === "compas" || z === "tiempo" || z === "16") setZoom(z);
    if (lsGet(LS_TRACK) === "0") setWithTrack(false);
  }, []);
  useEffect(() => lsSet(LS_VIEW, view), [view]);
  useEffect(() => lsSet(LS_ZOOM, zoom), [zoom]);

  // ───────────── Datos: la sesión (rejilla + latencia) y el análisis de P01 ─────────────

  const [data, setData] = useState<{ sid: string; session: ComposeSession; analysis: PassageAnalysis | null } | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!sid) {
      setData(null);
      return;
    }
    let alive = true;
    setLoadErr(null);
    Promise.all([api.getSession(sid), status === "listo" ? api.analysis(sid, pid) : Promise.resolve(null)])
      .then(([session, analysis]) => {
        if (alive) setData({ sid, session, analysis });
      })
      .catch((e: Error) => {
        if (alive) setLoadErr(e.message || "no se pudo leer la toma");
      });
    return () => {
      alive = false;
    };
  }, [sid, pid, status, tick, api]);

  const fresh = data && data.sid === sid ? data : null;
  const analysis = fresh?.analysis ?? null;
  const grid = analysis?.grid ?? null;
  const takeGrid = fresh?.session.take?.grid ?? null;
  const rows = useMemo(() => (grid && analysis ? gridRows(grid, analysis) : null), [grid, analysis]);
  const syls = useMemo(() => (grid && analysis ? gridSyllables(grid, analysis) : []), [grid, analysis]);
  const sylOf = useMemo(() => (analysis ? syllableOfNotes(analysis) : new Map()), [analysis]);
  const phraseOf = useMemo(() => (analysis ? phraseOfNotes(analysis) : new Map<number, number>()), [analysis]);
  const melismas = useMemo(
    () => (analysis ? analysis.phrases.reduce((a, p) => a + p.syllables.filter((s) => s.melisma).length, 0) : 0),
    [analysis],
  );

  // ───────────── Selección y escucha ─────────────

  const [selK, setSelK] = useState<number | null>(null);
  const [focusPhrase, setFocusPhrase] = useState<number | null>(null);
  useEffect(() => {
    setSelK(null);
    setFocusPhrase(null);
  }, [sid]);
  const selRow = rows && selK != null ? rows.find((r) => r.k === selK) ?? null : null;

  const [playing, setPlaying] = useState(false);
  const [listenErr, setListenErr] = useState<string | null>(null);
  const playRef = useRef<TakePlayback | null>(null);
  /** Corrida de la escucha: ■, otra toma o salir durante la descarga la invalidan (ya no suena). */
  const runRef = useRef(0);
  const stopListen = useCallback(() => {
    runRef.current++;
    const h = playRef.current;
    playRef.current = null;
    h?.stop();
    setPlaying(false);
  }, []);
  useEffect(() => stopListen, [stopListen, sid]);
  // Vista oculta (otra ruta): lo que se estaba bajando tampoco suena al llegar.
  useEffect(() => {
    if (!ctx.active) stopListen();
  }, [ctx.active, stopListen]);

  const select = useCallback(
    (k: number, sound = true) => {
      setSelK(k);
      const r = rows?.find((x) => x.k === k);
      if (!r) return;
      const ph = phraseOf.get(r.g.i);
      if (ph != null) setFocusPhrase(ph);
      if (sound && !playRef.current) playNote(r.midi, Math.min(1.2, Math.max(0.15, r.end - r.start)));
    },
    [rows, phraseOf],
  );

  const listen = useCallback(async () => {
    // Suena o se está bajando: el segundo Espacio/▶ para (también durante la descarga).
    if (playRef.current || playing) return stopListen();
    const ac = ctxRef.current.engine.context();
    if (!ac || !sid || !rows) return;
    const run = ++runRef.current;
    setListenErr(null);
    const from = selRow ? Math.max(0, selRow.start - 0.04) : 0;
    setPlaying(true);
    try {
      const { session, buffer } = await loadTakeAudio(api, ac, sid);
      // ■, otra toma o cambiar de etapa mientras bajaba: no suena.
      if (runRef.current !== run) return;
      const c = ctxRef.current;
      const h = playTake(c.engine, {
        base: c.tema.track,
        sectionId: c.section.id,
        grid: session.take.grid,
        buffer,
        fromSec: from,
        withTrack,
        onEnd: () => {
          if (playRef.current === h) {
            playRef.current = null;
            setPlaying(false);
          }
        },
      });
      playRef.current = h;
      if (!h) setPlaying(false);
    } catch (e) {
      if (runRef.current !== run) return;
      setPlaying(false);
      setListenErr((e as Error).message);
    }
  }, [api, sid, rows, selRow, withTrack, stopListen, playing]);

  const playStep = useCallback(() => {
    const p = playRef.current?.position();
    if (p == null || !grid) return null;
    return (p - grid.downbeatSec) / secPerStep(grid.bpm, grid.meter);
  }, [grid]);

  const gotoPhrase = useCallback(
    (idx: number) => {
      setFocusPhrase(idx);
      const first = rows?.find((r) => phraseOf.get(r.g.i) === idx);
      if (first) select(first.k, false);
    },
    [rows, phraseOf, select],
  );

  // ───────────── Correr la rejilla (latencia de la toma) ─────────────

  const [shifting, setShifting] = useState(false);
  const [shiftErr, setShiftErr] = useState<string | null>(null);
  const shift = async (ms: number) => {
    const take = fresh?.session.take;
    if (!sid || !take) return;
    setShifting(true);
    setShiftErr(null);
    try {
      await ctx.patchTake(sid, { latencyMs: Math.round(take.latency.ms + ms) });
      await ctx.reload();
      setTick((t) => t + 1);
    } catch (e) {
      setShiftErr((e as Error).message);
    } finally {
      setShifting(false);
    }
  };

  // ───────────── Atajos ─────────────

  const keysRef = useRef({ listen, select, gotoPhrase, rows, selK, focusPhrase, grid });
  keysRef.current = { listen, select, gotoPhrase, rows, selK, focusPhrase, grid };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const c = ctxRef.current;
      if (!c.active || c.stage !== "analisis") return;
      const k = keysRef.current;
      if (!plainKey(e)) return;
      if ((e.key === "v" || e.key === "V") && !e.shiftKey) {
        if (!k.rows) return;
        e.preventDefault();
        setView((v) => (v === "rejilla" ? "tabla" : "rejilla"));
        return;
      }
      if (e.key === " ") {
        if (spaceOnButton(e) || !k.rows) return;
        e.preventDefault();
        // El Espacio del transporte tocaría la pista encima de la escucha.
        e.stopPropagation();
        void k.listen();
        return;
      }
      if (!k.rows?.length) return;
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        const pos = k.selK == null ? -1 : k.rows.findIndex((r) => r.k === k.selK);
        const next = e.key === "ArrowRight" ? Math.min(k.rows.length - 1, pos + 1) : Math.max(0, pos < 0 ? 0 : pos - 1);
        k.select(k.rows[next].k);
      } else if (e.key === "]" || e.key === "[") {
        e.preventDefault();
        const ids = (k.grid?.phrases ?? []).map((p) => p.idx);
        if (!ids.length) return;
        const cur = k.focusPhrase == null ? -1 : ids.indexOf(k.focusPhrase);
        const n = e.key === "]" ? Math.min(ids.length - 1, cur + 1) : Math.max(0, cur < 0 ? 0 : cur - 1);
        k.gotoPhrase(ids[n]);
      } else if (e.key === "z" || e.key === "Z") {
        e.preventDefault();
        setZoom((z) => ZOOMS[(ZOOMS.findIndex((x) => x.id === z) + 1) % ZOOMS.length].id);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // ───────────── Render ─────────────

  const ready = takes.filter((t) => t.status === "listo");
  const meter = grid?.meter ?? takeGrid?.meter ?? tema.track.meter;
  const bpm = grid?.bpm ?? takeGrid?.bpm ?? tema.track.bpm;
  const keySig = grid?.key ?? takeGrid?.key ?? tema.track.key;
  const loop = takeGrid?.loop ?? section.loop;
  const bars = takeGrid?.bars ?? section.bars;
  const roleCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) m.set(r.g.role, (m.get(r.g.role) ?? 0) + 1);
    return m;
  }, [rows]);
  const doubtful = rows?.filter((r) => r.doubtful).length ?? 0;

  const takeChips = (list: TemaCandidate[], label?: string) => (
    <div className="flex flex-wrap items-center gap-1" role="radiogroup" aria-label={label ?? "Toma"}>
      {list.map((t) => (
        <button
          key={t.memo.sessionId}
          type="button"
          role="radio"
          aria-checked={t.memo.sessionId === sid}
          className={chip(t.memo.sessionId === sid)}
          onClick={() => setChosen(t.memo.sessionId)}
          title={t.status === "listo" ? undefined : `todavía ${t.status}`}
        >
          {t.favorite && <span aria-label="favorita">★</span>}
          {t.label}
          {t.status !== "listo" && <span className="text-text-faint">· {t.status}</span>}
        </button>
      ))}
    </div>
  );

  // Vacío: sin tomas en la sección.
  if (!takes.length)
    return (
      <EmptyState
        title={`Todavía no hay tomas de «${section.label}»`}
        hint="Graba el tarareo encima de la pista y márcale ★ a la que quieras leer aquí."
        action={
          <button type="button" className={btnPrimary} onClick={() => ctx.setStage("grabar")}>
            Ir a Grabar
          </button>
        }
      />
    );

  // Vacío: hay tomas pero ninguna ★ ni elegida.
  if (!target)
    return (
      <EmptyState
        title="Marca una toma ★ en Grabar"
        hint={ready.length ? "O elige aquí cuál leer en la rejilla:" : "Las tomas todavía se están procesando."}
        action={
          <div className="flex flex-col items-center gap-3">
            {ready.length > 0 && takeChips(ready, "Elegir toma")}
            <button type="button" className={btn} onClick={() => ctx.setStage("grabar")}>
              Ir a Grabar
            </button>
          </div>
        }
      />
    );

  const processing = status !== "listo" && status !== "error";
  const noNotes = !!grid && (!rows || rows.length === 0);
  const noGrid = status === "listo" && fresh && !processing && (!analysis || !grid);
  const failed = status === "error";

  return (
    <div tabIndex={-1} className="@container flex min-w-0 flex-col gap-4 outline-none">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className="text-md font-medium text-text">La toma en la rejilla</h2>
          <p className="text-xs text-text-dim">
            «{section.label}» · {keyLabel(keySig)} · {Math.round(bpm)} bpm · {meter}
            {takeGrid ? ` · ${takeGrid.bars} compases grabados` : ""}
          </p>
        </div>
        {takeChips(takes)}
      </header>

      {/* Barra: vista · zoom · escuchar */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="flex items-center gap-0.5 rounded-sm border border-line p-0.5" role="radiogroup" aria-label="Vista">
          {(["rejilla", "tabla"] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={view === v}
              className={chip(view === v)}
              onClick={() => setView(v)}
              title="V alterna Rejilla/Tabla"
            >
              {v === "rejilla" ? "Rejilla" : "Tabla"}
            </button>
          ))}
        </span>
        {view === "rejilla" && (
          <span className="flex items-center gap-1 text-xs text-text-faint" role="radiogroup" aria-label="Zoom">
            zoom
            {ZOOMS.map((z) => (
              <button
                key={z.id}
                type="button"
                role="radio"
                aria-checked={zoom === z.id}
                className={chip(zoom === z.id)}
                onClick={() => setZoom(z.id)}
                title="Z cambia el zoom"
              >
                {z.label}
              </button>
            ))}
          </span>
        )}
        <span className="ml-auto flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void listen()}
            disabled={!rows?.length}
            className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-full bg-accent text-sm text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label={playing ? "Parar (Espacio)" : "Escuchar desde la nota elegida (Espacio)"}
            title={playing ? "Parar (Espacio)" : "Escuchar desde la nota elegida (Espacio)"}
          >
            {playing ? "■" : "▶"}
          </button>
          <button
            type="button"
            className={chip(withTrack)}
            aria-pressed={withTrack}
            onClick={() => {
              setWithTrack(!withTrack);
              lsSet(LS_TRACK, withTrack ? "0" : "1");
            }}
            title="Con la pista entra con 1 compás de cuenta; sin ella suena solo tu voz, ya"
          >
            {withTrack ? "con la pista" : "solo la voz"}
          </button>
        </span>
      </div>

      {listenErr && <p className="text-xs text-red">{listenErr}</p>}

      {/* Estados honestos */}
      {loadErr ? (
        <ErrorLine
          text={`No se pudo leer la toma: ${loadErr}`}
          retry={() => setTick((t) => t + 1)}
        />
      ) : failed ? (
        <ErrorLine text="El agente no pudo analizar esta toma." others={takes.filter((t) => t.memo.sessionId !== sid && t.status === "listo")} onPick={setChosen} />
      ) : noGrid ? (
        <ErrorLine text="Esta toma no tiene lectura en la rejilla (¿se grabó fuera de la pista?)." others={ready.filter((t) => t.memo.sessionId !== sid)} onPick={setChosen} />
      ) : noNotes ? (
        <ErrorLine
          text="No hay notas claras en esta toma."
          hint="Pasa cuando el tarareo quedó muy bajito o con mucho ruido. Prueba otra toma, o graba más cerca del micrófono."
          others={ready.filter((t) => t.memo.sessionId !== sid)}
          onPick={setChosen}
        />
      ) : null}

      {!loadErr && !failed && !noGrid && !noNotes && (
        <div className={`grid min-w-0 items-start gap-4 ${grid && rows ? "@5xl:grid-cols-[minmax(0,1fr)_300px]" : ""}`}>
          <div className="flex min-w-0 flex-col gap-3">
            {/* Ficha de la nota elegida (o el paso real mientras carga). */}
            <div className="min-h-[40px] text-xs" aria-live="polite">
              {!rows ? (
                <p className="flex items-center gap-2 text-text-dim">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-text-dim" aria-hidden />
                  {(status && STEP_TEXT[status]) ?? "Leyendo la toma…"} La rejilla y los acordes ya son los de la pista.
                </p>
              ) : selRow ? (
                <>
                  <p className="text-sm text-text">
                    {noteCard(selRow, grid!, keySig, selRow.g.vowel ?? sylOf.get(selRow.g.i)?.vowel ?? null).join(" · ")}
                  </p>
                  <p className="text-text-faint">{noteExtras(selRow, keySig).join(" · ")}</p>
                </>
              ) : (
                <p className="text-text-faint">
                  Clic en una nota: suena y aquí sale su ficha. ←/→ recorren las notas, [ ] las frases, Espacio escucha
                  desde la elegida.
                </p>
              )}
            </div>

            {view === "rejilla" || !rows ? (
              <GridRoll
                meter={meter}
                bpm={bpm}
                keySig={keySig}
                loop={loop}
                bars={bars}
                rows={rows}
                syllables={syls}
                phrases={grid?.phrases ?? []}
                zoom={zoom}
                selected={selK}
                onSelect={(k) => select(k)}
                onPhrase={gotoPhrase}
                playStep={playStep}
                playing={playing}
              />
            ) : (
              <GridTable rows={rows} meter={meter} keySig={keySig} syllableOf={sylOf} selected={selK} onSelect={(k) => select(k)} />
            )}

            {/* Leyenda: roles con su conteo real + la rampa de dinámica. */}
            {rows && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-text-dim">
                {ROLE_ORDER.filter((r) => roleCount.get(r)).map((r) => (
                  <span key={r} className="inline-flex items-center gap-1.5">
                    <span aria-hidden className={`inline-block h-2.5 w-3.5 rounded-[3px] border ${ROLE_STYLE[r].swatch}`} />
                    {ROLE_STYLE[r].short} <span className="text-text-faint">{roleCount.get(r)}</span>
                  </span>
                ))}
                {doubtful > 0 && (
                  <span className="inline-flex items-center gap-1.5">
                    <span aria-hidden className="inline-block h-2.5 w-3.5 rounded-[3px] border border-dashed border-text-dim" />
                    dudosa ? <span className="text-text-faint">{doubtful}</span>
                  </span>
                )}
                <span className="inline-flex items-center gap-1" title="Relativa a esta toma: su nota más suave es pp y la más fuerte ff">
                  <span className="italic">pp</span>
                  {DYNAMICS.map((d) => (
                    <span key={d} aria-hidden className={`inline-block h-2.5 w-3 rounded-[2px] ${DYN_BG[d]}`} />
                  ))}
                  <span className="italic">ff</span>
                  <span className="text-text-faint">· relativa a esta toma</span>
                </span>
              </div>
            )}
            {analysis && (
              <p className="text-xs text-text-faint">
                Medido sobre {analysis.source === "voz" ? "tu voz sola" : "la mezcla"} · alturas y sílabas aproximadas: las
                dudosas se muestran, no se esconden. Una vocal vacía es una vocal que no se pudo leer.
              </p>
            )}
          </div>

          {grid && rows && (
            <aside className="min-w-0 @5xl:border-l @5xl:border-line @5xl:pl-4">
              <GridReadout
                grid={grid}
                rows={rows}
                keySig={keySig}
                melismas={melismas}
                focusPhrase={focusPhrase}
                onPhrase={gotoPhrase}
                onShift={fresh?.session.take ? (ms) => void shift(ms) : undefined}
                shifting={shifting}
              />
              {shiftErr && <p className="mt-2 text-xs text-red">No se pudo correr la rejilla: {shiftErr}</p>}
            </aside>
          )}
        </div>
      )}

      {processing && rows === null && fresh && (
        <p className="text-xs text-text-faint">Se actualiza solo cuando el agente termina.</p>
      )}
    </div>
  );
}

function EmptyState({ title, hint, action }: { title: string; hint: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-16 text-center">
      <p className="text-sm text-text">{title}</p>
      <p className="max-w-[46ch] text-xs text-text-dim">{hint}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

function ErrorLine({
  text,
  hint,
  retry,
  others,
  onPick,
}: {
  text: string;
  hint?: string;
  retry?: () => void;
  others?: TemaCandidate[];
  onPick?: (sid: string) => void;
}) {
  return (
    <div role="alert" className="flex flex-col gap-2 rounded-sm border border-line px-3 py-3">
      <p className="text-sm text-text">{text}</p>
      {hint && <p className="text-xs text-text-dim">{hint}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {retry && (
          <button type="button" className={btn} onClick={retry}>
            Reintentar
          </button>
        )}
        {others && others.length > 0 && onPick && (
          <>
            <span className="text-xs text-text-faint">Probar otra toma:</span>
            {others.map((t) => (
              <button key={t.memo.sessionId} type="button" className={btn} onClick={() => onPick(t.memo.sessionId)}>
                {t.favorite ? "★ " : ""}
                {t.label}
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
