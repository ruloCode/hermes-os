"use client";

/**
 * Memo · VERSIONES de letra medidas contra el molde. Referencias Mobbin: Suno
 * "Write Lyrics" (opciones completas lado a lado con la consigna), X/Grok
 * "Enhance your post" (chip de calce y ↻ por variante), WRITER (el PORQUÉ
 * debajo de cada sugerencia). Para "bloquear una línea y regenerar el resto"
 * no hay patrón: es una rejilla alineada por frase del molde — filas = frases,
 * columnas = Molde · Tu versión · versiones — con candado por fila.
 *
 * Dos vistas del mismo tablero:
 *  - REJILLA: todas las versiones lado a lado (elegir por frase).
 *  - PARES: fonemas → letra frase por frase, alineados por posición del molde
 *    (patrón ElevenLabs Dubbing), con el eco fonético a la vista, "1 de N" por
 *    frase y comparar contra otra versión (PhonemePairs).
 *
 * Y la GUÍA CANTADA (useGuide): ▶ guía por línea y "▶ todo con guía" — una
 * voz sintética que canta la línea en la melodía (sobre la pista en un tema),
 * rotulada siempre como guía, con su costo real.
 *
 * El factor humano no se delega: "Tu versión" solo se llena con clics sobre
 * una versión o escribiendo, y nada entra a la canción sin "Aplicar". Cada
 * celda se mide EN VIVO contra el molde (el calce guardado envejece si cambias
 * el modo de melismas o corriges el molde).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  LyricBoard,
  LyricLine,
  LyricRequest,
  LyricVersion,
  MelismaMode,
  MineLine,
  PassageAnalysis,
  Phrase,
} from "@hermes/shared";
import { wordSyllables } from "@hermes/shared";
import { useQuantizedTime, type MemoPlayer, type TimeClock } from "./useMemoPlayer";
import { usePlaygroundApi, type LyricBoardPatch } from "./api";
import { FitChips, ecoHint, fits, misaccentWords } from "./FitChips";
import { GuideBar, GuideKaraoke, GuideLineButton, sungFor } from "./GuideControls";
import { MelismaToggle } from "./MoldTab";
import { EcoLegend, LockIcon, PhonemePairs, letterOf } from "./PhonemePairs";
import { fitOf, moldOf } from "./measure";
import { useGuide, type GuideLine, type GuideTarget } from "./useGuide";
import { btn, btnGhost, btnPrimary, chip, field, plainKey } from "./ui";

const PERSONAS = ["yo → tú", "yo → ella / él", "nosotros", "narrador", "yo, sin destinatario"];
const RHYMES = ["libre", "AABB", "ABAB", "ABBA", "la del molde"];
/** Hasta 8 versiones por pedido; más de 5 van en dos tandas (tarda más). */
const COUNTS = [1, 2, 3, 4, 5, 6, 7, 8];
const SLOW_FROM = 6;

const FIXED_W = 36 + 168 + 280;
const VERSION_MIN_W = 220;

type View = "rejilla" | "pares";
const VIEW_KEY = "hermes-letra-vista";
const ECO_KEY = "hermes-letra-eco";

const lsGet = (k: string): string | null => {
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
    /* sin almacenamiento: vive hasta recargar */
  }
};

export function VersionsTab({
  analysis,
  board,
  patchBoard,
  generate,
  generating,
  genError,
  stopGenerating,
  mode,
  onMode,
  player,
  songId,
  focusRow,
  setFocusRow,
  count,
  setCount,
  onApply,
  guideTarget = null,
  keysActive = true,
  boardLoaded = true,
  boardError = null,
  onRetryBoard,
}: {
  analysis: PassageAnalysis;
  board: LyricBoard;
  patchBoard: (p: LyricBoardPatch, delay?: number) => void;
  generate: (req: LyricRequest) => void;
  generating: { startedAt: number; count: number } | null;
  genError: string | null;
  stopGenerating: () => void;
  mode: MelismaMode;
  onMode: (m: MelismaMode) => void;
  player: MemoPlayer;
  songId?: string;
  focusRow: number | null;
  setFocusRow: (i: number | null) => void;
  count: number;
  setCount: (n: number) => void;
  onApply: () => void;
  /** Dónde canta la guía (y sobre qué pista, en un tema). null = sin guía. */
  guideTarget?: GuideTarget | null;
  /** Los atajos (E) solo con la vista a la vista. */
  keysActive?: boolean;
  /** El tablero del agente ya llegó: antes, nada se edita (se pisaría "Tu versión" guardada). */
  boardLoaded?: boolean;
  boardError?: string | null;
  onRetryBoard?: () => void;
}) {
  const api = usePlaygroundApi();
  const phrases = analysis.phrases;
  const molds = useMemo(() => phrases.map((p) => moldOf(p, mode)), [phrases, mode]);
  // Lo de un análisis ANTERIOR (`stale`: un re-análisis movió las frases) no es de las frases de
  // hoy: ni la rejilla ni "Tu versión" lo tratan como tal — va aparte, en «De un análisis anterior».
  const versions = useMemo(() => board.versions.filter((v) => !v.stale).reverse(), [board.versions]);
  const staleVersions = useMemo(() => board.versions.filter((v) => v.stale).reverse(), [board.versions]);
  const currentMine = useMemo(() => board.mine.filter((m) => !m.stale), [board.mine]);
  const staleMine = useMemo(() => board.mine.filter((m) => m.stale && m.text.trim()), [board.mine]);
  const liveBoard = useMemo(() => ({ ...board, mine: currentMine }), [board, currentMine]);
  const mineOf = (i: number) => currentMine.find((m) => m.phrase === i);
  const [page, setPage] = useState(0);
  const [cell, setCell] = useState<{ row: number; line: LyricLine; version: LyricVersion; letter: string } | null>(null);
  const [playingRow, setPlayingRow] = useState<{ row: number; text: string } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [wrapW, setWrapW] = useState(1000);

  // ¿Hay tarareo con vocales en el molde? Sin eso no hay eco que medir (ni que resaltar).
  const echoAvailable = useMemo(() => molds.some((m) => m.slots?.some((s) => s.filler && s.vowel)), [molds]);
  const [view, setViewState] = useState<View>("rejilla");
  const [eco, setEcoState] = useState(false);
  const [compareId, setCompareId] = useState<string | null>(null);
  useEffect(() => {
    const v = lsGet(VIEW_KEY);
    // Primera vez: con tarareo, los pares son la vista que dice más; sin él, la rejilla.
    setViewState(v === "rejilla" || v === "pares" ? v : echoAvailable ? "pares" : "rejilla");
    setEcoState(lsGet(ECO_KEY) === "1");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const setView = (v: View) => {
    setViewState(v);
    lsSet(VIEW_KEY, v);
  };
  const setEco = (on: boolean) => {
    setEcoState(on);
    lsSet(ECO_KEY, on ? "1" : "0");
  };

  const guide = useGuide({
    api,
    target: guideTarget,
    mode,
    revision: analysis.analyzedAt,
    onStart: player.stop,
    active: keysActive,
  });

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setWrapW(el.clientWidth));
    ro.observe(el);
    setWrapW(el.clientWidth);
    return () => ro.disconnect();
  }, [view]);

  const perPage = Math.max(1, Math.floor((wrapW - FIXED_W) / VERSION_MIN_W));
  const pages = Math.max(1, Math.ceil(versions.length / perPage));
  useEffect(() => {
    if (page > pages - 1) setPage(pages - 1);
  }, [page, pages]);
  // Versiones nuevas entran al principio: volver a la primera página para verlas.
  const lastCount = useRef(versions.length);
  useEffect(() => {
    if (versions.length > lastCount.current) setPage(0);
    lastCount.current = versions.length;
  }, [versions.length]);
  const shown = versions.slice(page * perPage, page * perPage + perPage);

  // Cuando deja de sonar, se apaga el karaoke de la línea.
  useEffect(() => {
    if (!player.playing) setPlayingRow(null);
  }, [player.playing]);

  // E = resaltar eco (en la rejilla, lleva a los pares: ahí es donde se ve).
  useEffect(() => {
    if (!keysActive) return;
    const onKey = (e: KeyboardEvent) => {
      if (!plainKey(e) || e.shiftKey || e.key.toLowerCase() !== "e" || !echoAvailable) return;
      e.preventDefault();
      if (view !== "pares") {
        setView("pares");
        setEco(true);
      } else setEco(!eco);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const setMine = (row: number, text: string, from?: string, delay?: number) => {
    // Las líneas `stale` se conservan tal cual (su número de frase es de otro análisis).
    const rest = board.mine.filter((m) => m.stale || m.phrase !== row);
    const next = text.trim() || from ? [...rest, { phrase: row, text, from }] : rest;
    patchBoard({ mine: next.sort((a, b) => a.phrase - b.phrase) }, delay);
  };

  const toggleLock = (row: number) => {
    const on = board.locked.includes(row);
    patchBoard({ locked: on ? board.locked.filter((x) => x !== row) : [...board.locked, row].sort((a, b) => a - b) }, 0);
  };

  const request = (only?: number[]): LyricRequest => ({
    count,
    brief: board.brief,
    persona: board.persona,
    rhyme: board.rhyme,
    melismaMode: mode,
    songId,
    locked: board.locked,
    onlyPhrases: only,
  });

  // Frases (por idx) sin candado cuya línea en "Tu versión" falta o no calza.
  // Una sola pasada con el índice ORIGINAL: filtrar primero los bloqueados y
  // después indexar `molds[row]` comparaba cada frase contra el molde de otra.
  const notFitting = phrases.flatMap((ph, row) => {
    if (board.locked.includes(ph.idx)) return [];
    const m = mineOf(ph.idx);
    return !m?.text.trim() || !fits(fitOf(m.text, molds[row], mode)) ? [ph.idx] : [];
  });

  const playLine = (idx: number, text: string) => {
    const ph = phrases.find((p) => p.idx === idx);
    if (!ph) return;
    guide.stop();
    setPlayingRow({ row: idx, text });
    void player.play({ from: ph.start, to: ph.end, force: "sinte" });
  };

  const elapsed = useElapsed(generating?.startedAt ?? null);
  const mineCount = currentMine.filter((m) => m.text.trim()).length;
  // Tu versión, en el orden de la canción: lo que canta "▶ todo con guía".
  const mineLines: GuideLine[] = useMemo(
    () =>
      phrases.flatMap((ph) => {
        const m = currentMine.find((x) => x.phrase === ph.idx);
        return m?.text.trim() ? [{ phrase: ph.idx, text: m.text }] : [];
      }),
    [currentMine, phrases],
  );
  const playingGuide = guide.playing;
  const cellSung = useMemo(
    () => (cell ? sungFor(playingGuide, cell.row, cell.line.text) : null),
    [cell, playingGuide],
  );

  return (
    <div className="flex flex-col gap-3">
      {/* Consigna */}
      <div className="flex flex-col gap-2 rounded-md border border-line bg-panel p-3">
        {!boardLoaded && (
          <p className={`text-xs ${boardError ? "text-red" : "text-text-faint"}`} role="status">
            {boardError ? (
              <>
                No se pudo leer tu tablero de letras ({boardError}): no se edita hasta leerlo, para no pisar lo
                guardado.{" "}
                {onRetryBoard && (
                  <button type="button" className="cursor-pointer underline" onClick={onRetryBoard}>
                    Reintentar
                  </button>
                )}
              </>
            ) : (
              "Cargando tu tablero de letras… se edita en cuanto llegue."
            )}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={board.brief ?? ""}
            onChange={(e) => patchBoard({ brief: e.target.value }, 900)}
            placeholder="Consigna: de qué va, a quién, qué evitar («desamor sin clichés de corazón»)"
            className={`${field} min-w-[240px] flex-1 disabled:opacity-45`}
            aria-label="Consigna"
            disabled={!boardLoaded}
          />
          <select
            value={board.persona ?? ""}
            onChange={(e) => patchBoard({ persona: e.target.value || undefined }, 0)}
            className={`${field} disabled:opacity-45`}
            aria-label="Persona"
            disabled={!boardLoaded}
          >
            <option value="">Persona: la que dé</option>
            {PERSONAS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <select
            value={board.rhyme ?? ""}
            onChange={(e) => patchBoard({ rhyme: e.target.value || undefined }, 0)}
            className={`${field} disabled:opacity-45`}
            aria-label="Rima"
            disabled={!boardLoaded}
          >
            <option value="">Rima: libre</option>
            {RHYMES.slice(1).map((r) => (
              <option key={r} value={r}>
                Rima: {r}
              </option>
            ))}
          </select>
          <span
            className="flex items-center gap-0.5 rounded-sm border border-line p-0.5"
            role="radiogroup"
            aria-label="Cuántas versiones"
          >
            {COUNTS.map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={n === count}
                onClick={() => setCount(n)}
                title={n >= SLOW_FROM ? `${n} versiones: van en dos tandas con ángulos distintos, tarda más` : undefined}
                className={`h-6 w-6 cursor-pointer rounded-xs text-xs ${
                  n === count ? "bg-accent/15 text-accent" : n >= SLOW_FROM ? "text-text-faint hover:text-text" : "text-text-dim hover:text-text"
                }`}
              >
                {n}
              </button>
            ))}
          </span>
          {generating ? (
            <span className="flex items-center gap-2">
              <span className="text-xs text-accent">
                Generando {generating.count} {generating.count === 1 ? "versión" : "versiones"}… {elapsed} s
              </span>
              <button type="button" className={btn} onClick={stopGenerating}>
                ■ Detener
              </button>
            </span>
          ) : (
            <button type="button" className={btnPrimary} onClick={() => generate(request())} title="Generar (G)">
              ✦ Generar {count} <kbd className="text-2xs opacity-70">G</kbd>
            </button>
          )}
        </div>
        {count >= SLOW_FROM && !generating && (
          <p className="text-2xs text-text-faint">
            {count} versiones van en dos tandas con ángulos distintos: tarda más que 5 (hasta el doble).
          </p>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <MelismaToggle mode={mode} onChange={onMode} />
          {versions.length > 0 && !generating && (
            <span className="flex items-center gap-1">
              <button
                type="button"
                className={btnGhost}
                onClick={() => generate(request())}
                disabled={board.locked.length === phrases.length}
                title="Nuevas versiones; las filas con candado viajan como contexto y no se tocan (R)"
              >
                ↻ Regenerar lo no bloqueado
              </button>
              {notFitting.length > 0 && notFitting.length < phrases.length && (
                <button type="button" className={btnGhost} onClick={() => generate(request(notFitting))}>
                  ↻ Solo las {notFitting.length} que no calzan
                </button>
              )}
            </span>
          )}
          <span className="ml-auto flex items-center gap-2">
            {mineCount > 0 && (
              <span className="text-xs text-text-faint">
                Tu versión: {mineCount} de {phrases.length} frases
              </span>
            )}
            <button type="button" className={btn} onClick={onApply} disabled={mineCount === 0} title="⌘⏎">
              Aplicar a canción…
            </button>
          </span>
        </div>
        {genError && <p className="text-xs text-amber">{genError}</p>}
        {(staleMine.length > 0 || staleVersions.length > 0) && (
          <StaleLyrics
            mine={staleMine}
            versions={staleVersions}
            phrases={phrases}
            disabled={!boardLoaded}
            currentOf={(i) => mineOf(i)?.text ?? ""}
            onCopy={(row, text, from) => {
              setMine(row, text, from, 0);
              setFocusRow(row);
            }}
            onDiscard={(m) => patchBoard({ mine: board.mine.filter((x) => x !== m) }, 0)}
          />
        )}
        {generating && (
          <p className="text-xs text-text-faint">
            Hermes escribe contra el molde y mide cada línea; tarda de 30 a 90 s
            {generating.count >= SLOW_FROM ? " por tanda (van dos, en paralelo)" : ""}. Puedes seguir escribiendo tu
            versión.
          </p>
        )}
      </div>

      {/* Vista (rejilla | pares), eco y comparar; debajo, la guía cantada */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="flex items-center gap-0.5 rounded-sm border border-line p-0.5" role="radiogroup" aria-label="Vista">
            {(["rejilla", "pares"] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={view === v}
                className={chip(view === v)}
                onClick={() => setView(v)}
                title={
                  v === "rejilla"
                    ? "Todas las versiones lado a lado, frase por frase"
                    : "Tarareo → letra por frase, sílaba por sílaba (qué vocal se conserva)"
                }
              >
                {v === "rejilla" ? "Rejilla" : "Fonemas → letra"}
              </button>
            ))}
          </span>
          <button
            type="button"
            className={chip(eco && view === "pares" && echoAvailable)}
            aria-pressed={eco && view === "pares" && echoAvailable}
            disabled={!echoAvailable}
            onClick={() => {
              if (view !== "pares") {
                setView("pares");
                setEco(true);
              } else setEco(!eco);
            }}
            title={
              echoAvailable
                ? "Pinta cada sílaba por cuánto se parece su vocal a la del tarareo (E)"
                : "Este molde no trae tarareo con vocales (se cantaron palabras): no hay eco que medir"
            }
          >
            Resaltar eco <kbd className="text-2xs opacity-70">E</kbd>
          </button>
          {view === "pares" && eco && echoAvailable && <EcoLegend />}
          {view === "pares" && (
            <label className="flex items-center gap-1.5 text-xs text-text-faint">
              Comparar con
              <select
                value={compareId ?? ""}
                onChange={(e) => setCompareId(e.target.value || null)}
                className={`${field} max-w-[22ch] cursor-pointer bg-panel`}
                aria-label="Comparar con otra versión"
              >
                <option value="">nada</option>
                {mineCount > 0 && <option value="mine">Tu versión</option>}
                {versions.map((v, j) => (
                  <option key={v.id} value={v.id}>
                    {letterOf(j)} · {v.angle}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {guide.available && <GuideBar guide={guide} allLines={mineLines} />}
      </div>

      {view === "pares" ? (
        <PhonemePairs
          phrases={phrases}
          molds={molds}
          mode={mode}
          board={liveBoard}
          versions={versions}
          onUse={(pi, text, from) => {
            setMine(pi, text, from, 0);
            setFocusRow(pi);
          }}
          onToggleLock={toggleLock}
          eco={eco && echoAvailable}
          echoAvailable={echoAvailable}
          compareId={compareId}
          guide={guide.available ? guide : null}
          focusRow={focusRow}
          setFocusRow={setFocusRow}
          generating={!!generating}
        />
      ) : (
        <>
          {/* La rejilla: filas = frases del molde, columnas = Molde · Tu versión · versiones */}
          <div ref={wrapRef} className="min-w-0 overflow-x-auto rounded-md border border-line bg-panel">
            <div
              className="grid min-w-[700px] text-xs"
              style={{
                gridTemplateColumns: `36px 168px minmax(240px, 1.25fr) ${
                  shown.length ? `repeat(${shown.length}, minmax(${VERSION_MIN_W - 20}px, 1fr))` : ""
                }`,
              }}
            >
              {/* Cabecera */}
              <div className="border-b border-line px-2 py-2" />
              <div className="border-b border-line px-2 py-2 text-text-faint">Molde</div>
              <div className="border-b border-l border-line px-2 py-2 font-medium text-text">
                Tu versión <span className="font-normal text-text-faint">· medida aprox.</span>
              </div>
              {shown.map((v, j) => (
                <div key={v.id} className="flex min-w-0 items-start gap-1 border-b border-l border-line px-2 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-text" title={v.angle}>
                      {letterOf(page * perPage + j)} · {v.angle}
                    </span>
                    <span className="block text-2xs text-text-faint">
                      {v.melismaMode === "respetar" ? "melismas respetados" : "melismas silabizados"}
                    </span>
                  </span>
                  {j === shown.length - 1 && pages > 1 && (
                    <span className="flex shrink-0 items-center gap-0.5 text-text-faint">
                      <button type="button" className={btnGhost} disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="Versiones anteriores">
                        ‹
                      </button>
                      <span className="tabular-nums">
                        {page * perPage + 1}–{Math.min(versions.length, page * perPage + perPage)} de {versions.length}
                      </span>
                      <button type="button" className={btnGhost} disabled={page >= pages - 1} onClick={() => setPage(page + 1)} aria-label="Más versiones">
                        ›
                      </button>
                    </span>
                  )}
                </div>
              ))}

              {phrases.map((ph, row) => {
                // Todo lo del tablero (Tu versión, candados, foco) va por el idx de la frase.
                const pi = ph.idx;
                const mold = molds[row];
                const mine = mineOf(pi);
                const locked = board.locked.includes(pi);
                const mineFit = mine ? fitOf(mine.text, mold, mode) : null;
                const rowOn = focusRow === pi;
                const sung = sungFor(playingGuide, pi, mine?.text);
                return (
                  <Row key={ph.idx}>
                    <div className={`flex flex-col items-center gap-1 border-t border-line/60 px-1 py-2 ${rowOn ? "bg-accent/6" : ""}`}>
                      <span className={`font-mono ${rowOn ? "text-accent" : "text-text-dim"}`}>F{ph.idx + 1}</span>
                      <button
                        type="button"
                        onClick={() => toggleLock(pi)}
                        aria-pressed={locked}
                        title={locked ? "Fija: no se regenera (B)" : "Fijar esta fila (B)"}
                        className={`cursor-pointer rounded-xs p-0.5 ${locked ? "text-accent" : "text-text-faint hover:text-text"}`}
                      >
                        <LockIcon on={locked} />
                      </button>
                    </div>
                    <MoldCell phrase={ph} mold={mold} on={rowOn} onFocus={() => setFocusRow(pi)} />
                    <div
                      className={`flex min-w-0 flex-col gap-1 border-t border-l border-line/60 px-2 py-2 ${rowOn ? "bg-accent/6" : ""}`}
                      onFocusCapture={() => setFocusRow(pi)}
                    >
                      <div className="flex items-center gap-0.5">
                        <input
                          value={mine?.text ?? ""}
                          onChange={(e) => setMine(pi, e.target.value, undefined, 700)}
                          placeholder={!boardLoaded ? "cargando…" : locked ? "fija, sin texto" : "escribe o elige una →"}
                          className={`${field} min-w-0 flex-1 text-sm disabled:opacity-45 ${locked ? "border-accent/40" : ""}`}
                          aria-label={`Tu versión, frase ${ph.idx + 1}`}
                          disabled={!boardLoaded}
                        />
                        <button
                          type="button"
                          className={`${btnGhost} whitespace-nowrap`}
                          disabled={!mine?.text.trim()}
                          onClick={() => mine && playLine(pi, mine.text)}
                          title="Oír la melodía con esta línea (notas sintetizadas, sin voz)"
                          aria-label={`Oír la melodía de la frase ${ph.idx + 1}`}
                        >
                          ▶ melodía
                        </button>
                        <GuideLineButton guide={guide.available ? guide : null} phrase={pi} text={mine?.text} />
                      </div>
                      {sung ? (
                        <GuideKaraoke syllables={sung} clock={guide.clock} />
                      ) : playingRow?.row === pi && player.playing ? (
                        <LineKaraoke text={playingRow.text} phrase={ph} clock={player.clock} />
                      ) : (
                        mine?.text.trim() && <FitChips fit={mineFit} text={mine.text} />
                      )}
                      {mineFit?.hint && !fits(mineFit) && <span className="text-2xs text-text-faint">↳ {mineFit.hint}</span>}
                      {mine?.from && (
                        <span className="text-2xs text-text-faint">
                          de {versions.find((v) => v.id === mine.from)?.angle ?? "una versión"}
                          {mine.text !== versions.find((v) => v.id === mine.from)?.lines.find((l) => l.phrase === pi)?.text &&
                            " · editada"}
                        </span>
                      )}
                    </div>
                    {shown.map((v, j) => {
                      const line = v.lines.find((l) => l.phrase === pi);
                      if (!line)
                        return (
                          <div key={v.id} className="border-t border-l border-line/60 px-2 py-2 text-text-faint">
                            {generating ? "…" : ""}
                          </div>
                        );
                      const f = fitOf(line.text, mold, mode) ?? line.fit;
                      const chosen = mine?.from === v.id && mine.text === line.text;
                      const letter = letterOf(page * perPage + j);
                      return (
                        <button
                          key={v.id}
                          type="button"
                          onClick={() => {
                            setMine(pi, line.text, v.id, 0);
                            setFocusRow(pi);
                          }}
                          onMouseEnter={() => setCell({ row: pi, line, version: v, letter })}
                          onFocus={() => {
                            setCell({ row: pi, line, version: v, letter });
                            setFocusRow(pi);
                          }}
                          className={`flex min-w-0 cursor-pointer flex-col gap-1 border-t border-l border-line/60 px-2 py-2 text-left transition-colors ${
                            chosen ? "bg-accent/10 ring-1 ring-accent ring-inset" : rowOn ? "bg-accent/4 hover:bg-panel-2" : "hover:bg-panel-2"
                          }`}
                          title="Usar esta línea en tu versión"
                        >
                          <span className="text-sm leading-snug text-text">{line.text}</span>
                          <FitChips fit={f} compact text={line.text} />
                        </button>
                      );
                    })}
                  </Row>
                );
              })}
            </div>
            {versions.length === 0 && !generating && (
              <p className="border-t border-line px-3 py-4 text-center text-xs text-text-dim">
                Todavía no hay versiones. El molde de {phrases.length} {phrases.length === 1 ? "frase" : "frases"} sale de
                la melodía: escribe la tuya en la columna de la izquierda o pide a Hermes {count}{" "}
                {count === 1 ? "versión" : "versiones"} con «Generar».
              </p>
            )}
          </div>

          {/* El porqué de la celda en foco (patrón WRITER: la razón debajo) */}
          <CellDetail
            cell={cell}
            molds={molds}
            phrases={phrases}
            mode={mode}
            guide={guide.available ? guide : null}
            sung={cellSung}
            onMelody={(row, text) => playLine(row, text)}
          />
        </>
      )}
    </div>
  );
}

/**
 * Lo escrito sobre un análisis ANTERIOR del pasaje (un re-análisis movió las
 * frases): no se reasigna solo a las frases de hoy. Se lee aquí con su frase
 * de entonces, y con un clic humano se copia a la frase que corresponda de
 * ahora (o se descarta, las de "Tu versión"; las versiones de Hermes solo se
 * leen y se copian).
 */
function StaleLyrics({
  mine,
  versions,
  phrases,
  disabled,
  currentOf,
  onCopy,
  onDiscard,
}: {
  mine: MineLine[];
  versions: LyricVersion[];
  phrases: Phrase[];
  disabled: boolean;
  currentOf: (row: number) => string;
  onCopy: (row: number, text: string, from?: string) => void;
  onDiscard: (m: MineLine) => void;
}) {
  const lines = versions.reduce((a, v) => a + v.lines.filter((l) => l.text.trim()).length, 0);
  return (
    <section className="flex flex-col gap-2 border-t border-line pt-2" aria-label="De un análisis anterior">
      <p className="text-xs text-text-dim">
        <span className="font-medium text-text">De un análisis anterior.</span> El pasaje se volvió a analizar y sus
        frases cambiaron: esto se escribió sobre las de antes y no se engancha solo a las de ahora. Cópialo a la frase
        que corresponda o descártalo.
      </p>
      {mine.length > 0 && (
        <ul className="flex flex-col gap-1">
          {mine.map((m, i) => (
            <li key={`${m.phrase}-${i}`} className="flex flex-wrap items-center gap-2 text-xs">
              <span className="w-20 shrink-0 font-mono text-text-faint">tu F{m.phrase + 1} de antes</span>
              <span className="min-w-0 flex-1 text-sm text-text">{m.text}</span>
              <CopyToPhrase
                phrases={phrases}
                initial={m.phrase}
                disabled={disabled}
                currentOf={currentOf}
                onCopy={(row) => onCopy(row, m.text)}
              />
              <button type="button" className={btnGhost} disabled={disabled} onClick={() => onDiscard(m)}>
                Descartar
              </button>
            </li>
          ))}
        </ul>
      )}
      {versions.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-text-dim">
            {versions.length} {versions.length === 1 ? "versión" : "versiones"} de Hermes de antes · {lines}{" "}
            {lines === 1 ? "línea" : "líneas"}
          </summary>
          <div className="mt-1.5 flex flex-col gap-2">
            {versions.map((v) => (
              <div key={v.id} className="flex flex-col gap-1">
                <span className="text-text-faint">{v.angle}</span>
                {v.lines
                  .filter((l) => l.text.trim())
                  .map((l) => (
                    <div key={`${v.id}-${l.phrase}`} className="flex flex-wrap items-center gap-2">
                      <span className="w-20 shrink-0 font-mono text-text-faint">F{l.phrase + 1} de antes</span>
                      <span className="min-w-0 flex-1 text-sm text-text">{l.text}</span>
                      <CopyToPhrase
                        phrases={phrases}
                        initial={l.phrase}
                        disabled={disabled}
                        currentOf={currentOf}
                        onCopy={(row) => onCopy(row, l.text)}
                      />
                    </div>
                  ))}
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

/** "Copiar a F2": la frase de HOY la elige el humano (arranca en la del mismo número, si existe). */
function CopyToPhrase({
  phrases,
  initial,
  disabled,
  currentOf,
  onCopy,
}: {
  phrases: Phrase[];
  initial: number;
  disabled: boolean;
  currentOf: (row: number) => string;
  onCopy: (row: number) => void;
}) {
  const [row, setRow] = useState(() => (phrases.some((p) => p.idx === initial) ? initial : (phrases[0]?.idx ?? 0)));
  if (!phrases.length) return null;
  const replaces = !!currentOf(row).trim();
  return (
    <span className="flex items-center gap-1">
      <select
        value={row}
        onChange={(e) => setRow(Number(e.target.value))}
        className={`${field} cursor-pointer bg-panel`}
        aria-label="Frase de ahora a la que copiar"
        disabled={disabled}
      >
        {phrases.map((p) => (
          <option key={p.idx} value={p.idx}>
            F{p.idx + 1}
          </option>
        ))}
      </select>
      <button
        type="button"
        className={btnGhost}
        disabled={disabled}
        onClick={() => onCopy(row)}
        title={replaces ? `Reemplaza lo que tienes en F${row + 1}` : undefined}
      >
        {replaces ? "Reemplazar" : "Copiar"}
      </button>
    </span>
  );
}

/** Pie de la rejilla: por qué Hermes propuso la celda en foco, su eco y sus malacentos. */
function CellDetail({
  cell,
  molds,
  phrases,
  mode,
  guide,
  sung,
  onMelody,
}: {
  cell: { row: number; line: LyricLine; version: LyricVersion; letter: string } | null;
  molds: ReturnType<typeof moldOf>[];
  phrases: Phrase[];
  mode: MelismaMode;
  guide: ReturnType<typeof useGuide> | null;
  sung: ReturnType<typeof sungFor>;
  onMelody: (row: number, text: string) => void;
}) {
  if (!cell)
    return (
      <p className="min-h-9 text-xs text-text-faint">
        Pasa por una celda para ver por qué Hermes la propuso. Clic = pasa a tu versión (nada entra a la canción sin
        «Aplicar»).
      </p>
    );
  const k = phrases.findIndex((p) => p.idx === cell.row);
  const f = (k >= 0 ? fitOf(cell.line.text, molds[k], mode) : null) ?? cell.line.fit;
  const eh = ecoHint(f);
  const bad = misaccentWords(f, cell.line.text);
  return (
    <div className="flex min-h-9 flex-col gap-0.5 text-xs">
      <p className="text-text-dim">
        <span className="text-text-faint">
          F{cell.row + 1} · {cell.letter} · {cell.version.angle} ·{" "}
        </span>
        {cell.line.why ? (
          <>
            <span className="text-text-faint">Por qué: </span>
            {cell.line.why}
          </>
        ) : (
          <span className="text-text-faint">sin explicación registrada</span>
        )}
        {f.hint && !fits(f) && <span className="text-amber"> · {f.hint}</span>}
        <button type="button" className={`${btnGhost} ml-2`} onClick={() => onMelody(cell.row, cell.line.text)}>
          ▶ melodía
        </button>
        <GuideLineButton guide={guide} phrase={cell.row} text={cell.line.text} label="guía cantada" />
      </p>
      {sung && guide ? (
        <GuideKaraoke syllables={sung} clock={guide.clock} />
      ) : (
        (eh || bad.length > 0) && (
          <p className="text-2xs text-text-faint">
            {eh && <span>↳ {eh}</span>}
            {bad.length > 0 && (
              <span className="text-amber">
                {eh ? " · " : "↳ "}
                {bad.map((w) => `«${w}»`).join(", ")} {bad.length === 1 ? "carga" : "cargan"} el acento en un tiempo débil
              </span>
            )}
          </p>
        )
      )}
    </div>
  );
}

/** Fragmento: las celdas de una fila van directo a la rejilla (display: contents). */
function Row({ children }: { children: React.ReactNode }) {
  return <div className="contents">{children}</div>;
}

function MoldCell({
  phrase,
  mold,
  on,
  onFocus,
}: {
  phrase: Phrase;
  mold: ReturnType<typeof moldOf>;
  on: boolean;
  onFocus: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onFocus}
      className={`flex min-w-0 cursor-pointer flex-col gap-0.5 border-t border-line/60 px-2 py-2 text-left ${on ? "bg-accent/6" : ""}`}
    >
      <span className="text-text">
        {mold.syllables} sílabas · {mold.ending === "esdrujula" ? "esdrújula" : mold.ending}
        {mold.rhyme && <span className="text-text-dim"> · {mold.rhyme}</span>}
      </span>
      {mold.melismas.length > 0 && (
        <span className="text-2xs text-chart-4">
          {mold.melismas.map((m) => `melisma en ${m.pos} (${m.notes})`).join(" · ")}
        </span>
      )}
      {mold.stresses.length > 0 && <span className="text-2xs text-text-faint">acentos {mold.stresses.join("·")}</span>}
      <span className="truncate text-2xs text-text-faint italic" title={phrase.text}>
        «{phrase.text}»
      </span>
    </button>
  );
}

/**
 * Karaoke de UNA línea escrita sobre la melodía: cada palabra se enciende
 * cuando empieza su primera sílaba en el molde (cuenta de sílabas por regla:
 * aproximada, igual que la medida).
 */
function LineKaraoke({ text, phrase, clock }: { text: string; phrase: Phrase; clock: TimeClock }) {
  const { words, starts } = useMemo(() => {
    const words = text.split(/\s+/).filter(Boolean);
    const starts: number[] = [];
    let k = 0;
    const syl = phrase.syllables;
    const span = phrase.end - phrase.start;
    const total = words.reduce((a, w) => a + Math.max(1, safeCount(w)), 0);
    for (const w of words) {
      starts.push(syl[k]?.start ?? phrase.start + (k / Math.max(1, total)) * span);
      k += Math.max(1, safeCount(w));
    }
    return { words, starts };
  }, [text, phrase]);
  // Se re-pinta al cruzar el inicio de una palabra, no a 30 fps.
  const time = useQuantizedTime(clock, starts);
  return (
    <span className="text-sm leading-snug">
      {words.map((w, i) => (
        <span key={i} className={time >= starts[i] ? "text-accent" : "text-text-dim"}>
          {w}{" "}
        </span>
      ))}
    </span>
  );
}

function safeCount(w: string): number {
  try {
    return wordSyllables(w);
  } catch {
    return 1;
  }
}

function useElapsed(since: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since == null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [since]);
  return since == null ? 0 : Math.max(0, Math.round((now - since) / 1000));
}
