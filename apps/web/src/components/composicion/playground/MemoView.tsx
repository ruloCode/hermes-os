"use client";

/**
 * Playground · MEMO (un pasaje cantado como pieza): tres pestañas, una cosa a
 * la vez — Melodía (oír, transponer, ver las notas) · Molde (lo que la melodía
 * le pide a una letra) · Versiones (letras medidas contra el molde). Y el
 * puente al tablero: "Aplicar a canción".
 *
 * Teclado (fuera de campos de texto, ⌘1..9 quedan para la navegación global):
 * Espacio ▶/⏸ · ←→ nota · ⇧←→ frase · + / − semitono · T llevar a la canción ·
 * 0 original · L repetir frase · N notación · 1/2/3 pestañas · G generar ·
 * B fijar fila · R regenerar · ⌘⏎ aplicar · ⌘Z deshacer lo aplicado · Esc volver.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ComposeSession, Key, Passage } from "@hermes/shared";
import { playNote } from "@/lib/chord-audio";
import { TabBar } from "@/components/ui/TabBar";
import { PanelState } from "@/components/ui/PanelState";
import { useComposicion } from "../ComposicionContext";
import { usePlaygroundApi, useViewActive } from "./api";
import { usePlayground, type MemoTab } from "./PlaygroundContext";
import { useMemoData } from "./useMemoData";
import { useMemoPlayer } from "./useMemoPlayer";
import type { SessionData } from "./useSessionData";
import { MelodyTab } from "./MelodyTab";
import { MoldTab } from "./MoldTab";
import { VersionsTab } from "./VersionsTab";
import { ApplySheet, type AppliedChange } from "./ApplySheet";
import { ToTemaButton } from "../temas/ToTemaButton";
import { KIND_LABEL } from "./PassageList";
import { resolveSpeaker, visibleSpeakers } from "./VoiceStrip";
import { semisToKey, shiftNotes } from "./measure";
import { btn, btnGhost, plainKey, spaceOnButton, typingTarget } from "./ui";
import { fmtTime } from "./format";

const TABS: { id: MemoTab; label: string }[] = [
  { id: "melodia", label: "Melodía" },
  { id: "molde", label: "Molde" },
  { id: "versiones", label: "Versiones" },
];

export function MemoView({
  session,
  passage,
  onBack,
  data,
}: {
  session: ComposeSession;
  passage: Passage;
  onBack: () => void;
  data: SessionData;
}) {
  const api = usePlaygroundApi();
  const active = useViewActive();
  const comp = useComposicion();
  const { memoTab: tab, setMemoTab: setTab } = usePlayground();
  const memo = useMemoData(session.id, passage);
  const { analysis, board } = memo;
  const song = session.songId ? (comp.songs.find((s) => s.id === session.songId) ?? null) : null;

  // Si una sección ya trae este memo, arranca con los semitonos con que se aplicó.
  const linked = song?.sections.find((x) => x.memo?.sessionId === session.id && x.memo.passageId === passage.id);
  const [semis, setSemisState] = useState(linked?.memo?.semitones ?? 0);
  const [memoKeyPick, setMemoKey] = useState<Key | null>(null);
  const [targetPick, setTarget] = useState<Key | null>(null);
  const memoKey: Key = memoKeyPick ?? analysis?.key.best.key ?? { tonic: 0, mode: "major" };
  const targetKey: Key | null = targetPick ?? song?.key ?? null;

  const player = useMemoPlayer({ api, sessionId: session.id, passageId: passage.id, analysis, semis, active });
  const [focusPhrase, setFocusPhrase] = useState<number | null>(null);
  const [selectedNote, setSelectedNote] = useState<number | null>(null);
  const [loop, setLoopState] = useState(false);
  const [zoom, setZoom] = useState(90);
  const [focusRow, setFocusRow] = useState<number | null>(null);
  const [count, setCount] = useState(3);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState<AppliedChange | null>(null);
  const mode = board.melismaMode;

  const setSemis = useCallback((n: number) => setSemisState(Math.max(-12, Math.min(12, n))), []);
  // La guía cantada de una sesión suena sola (no hay pista), en los semitonos del memo.
  const guideTarget = useMemo(
    () => ({ sessionId: session.id, passageId: passage.id, passageStart: passage.start, semitones: semis }),
    [session.id, passage.id, passage.start, semis],
  );
  const shifted = useMemo(() => (analysis ? shiftNotes(analysis.notes, semis) : []), [analysis, semis]);

  const phraseOf = useCallback(
    (idx: number | null) => (idx == null ? null : (analysis?.phrases.find((p) => p.idx === idx) ?? null)),
    [analysis],
  );

  const setLoop = useCallback(
    (on: boolean) => {
      setLoopState(on);
      if (!analysis) return;
      const ph = phraseOf(focusPhrase) ?? analysis.phrases[0] ?? null;
      if (on && ph) {
        if (focusPhrase == null) setFocusPhrase(ph.idx);
        void player.play({ from: ph.start, to: ph.end, loop: true });
      } else player.stop();
    },
    [analysis, focusPhrase, phraseOf, player],
  );

  const clickNote = useCallback(
    (i: number) => {
      const n = shifted[i];
      if (!n) return;
      player.stop();
      setSelectedNote(i);
      player.setTime(n.start);
      playNote(n.midi, Math.min(1.2, Math.max(0.15, n.end - n.start)));
    },
    [player, shifted],
  );

  const focusPhraseAt = useCallback(
    (idx: number | null) => {
      setFocusPhrase(idx);
      const ph = phraseOf(idx);
      if (ph && !player.playing) player.setTime(ph.start);
      if (ph && loop) void player.play({ from: ph.start, to: ph.end, loop: true });
    },
    [loop, phraseOf, player],
  );

  const setMode = useCallback((m: typeof mode) => memo.patchBoard({ melismaMode: m }, 0), [memo]);

  const request = useCallback(
    (only?: number[]) => ({
      count,
      brief: board.brief,
      persona: board.persona,
      rhyme: board.rhyme,
      melismaMode: mode,
      songId: song?.id,
      locked: board.locked,
      onlyPhrases: only,
    }),
    [board, count, mode, song?.id],
  );

  const toggleLock = useCallback(
    (idx: number) => {
      const on = board.locked.includes(idx);
      memo.patchBoard(
        { locked: on ? board.locked.filter((x) => x !== idx) : [...board.locked, idx].sort((a, b) => a - b) },
        0,
      );
    },
    [board.locked, memo],
  );

  const mineCount = board.mine.filter((m) => !m.stale && m.text.trim()).length;

  // Deshacer lo aplicado: el aviso vive 15 s.
  useEffect(() => {
    if (!applied) return;
    const t = setTimeout(() => setApplied(null), 15_000);
    return () => clearTimeout(t);
  }, [applied]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      // Con ⌘: van ANTES de la guarda de escritura (un acorde con ⌘ no es escribir).
      if ((e.metaKey || e.ctrlKey) && !e.altKey) {
        if (e.key === "Enter" && mineCount > 0 && !applying) {
          e.preventDefault();
          setApplying(true);
        } else if (e.key.toLowerCase() === "z" && applied && !typingTarget(e)) {
          e.preventDefault();
          applied.undo();
          setApplied(null);
        }
        return;
      }
      if (e.key === "Escape" && plainKey(e)) {
        e.preventDefault();
        player.stop();
        onBack();
        return;
      }
      if (!plainKey(e) || spaceOnButton(e) || !analysis) return;
      const k = e.key;
      const notes = shifted;
      if (k === " ") {
        e.preventDefault();
        if (player.playing) player.stop();
        else if (loop && phraseOf(focusPhrase)) setLoop(true);
        else void player.play();
      } else if (k === "1" || k === "2" || k === "3") {
        e.preventDefault();
        setTab(TABS[Number(k) - 1].id);
      } else if ((k === "ArrowRight" || k === "ArrowLeft") && e.shiftKey) {
        e.preventDefault();
        const n = analysis.phrases.length;
        if (!n) return;
        const cur = focusPhrase ?? (k === "ArrowRight" ? -1 : n);
        const pos = analysis.phrases.findIndex((p) => p.idx === cur);
        const next = analysis.phrases[Math.max(0, Math.min(n - 1, (pos < 0 ? (k === "ArrowRight" ? -1 : n) : pos) + (k === "ArrowRight" ? 1 : -1)))];
        focusPhraseAt(next.idx);
      } else if ((k === "ArrowRight" || k === "ArrowLeft") && tab === "melodia") {
        e.preventDefault();
        if (!notes.length) return;
        let i = selectedNote;
        if (i == null) {
          const now = player.clock.now();
          i = notes.findIndex((n) => n.start >= now - 0.01);
          if (i < 0) i = notes.length - 1;
          if (k === "ArrowLeft") i = Math.max(0, i - 1);
        } else i = Math.max(0, Math.min(notes.length - 1, i + (k === "ArrowRight" ? 1 : -1)));
        clickNote(i);
      } else if (k === "+" || k === "=") {
        e.preventDefault();
        setSemis(semis + 1);
      } else if (k === "-" || k === "_") {
        e.preventDefault();
        setSemis(semis - 1);
      } else if (k === "0") {
        e.preventDefault();
        setSemis(0);
      } else if (k.toLowerCase() === "t" && targetKey) {
        e.preventDefault();
        setSemis(semisToKey(memoKey, targetKey));
      } else if (k.toLowerCase() === "l") {
        e.preventDefault();
        setLoop(!loop);
      } else if (k.toLowerCase() === "n") {
        e.preventDefault();
        comp.setNotation(comp.notation === "en" ? "latin" : "en");
      } else if (k.toLowerCase() === "g" && !memo.generating) {
        e.preventDefault();
        setTab("versiones");
        void memo.generate(request());
      } else if (k.toLowerCase() === "r" && tab === "versiones" && !memo.generating && board.versions.length) {
        e.preventDefault();
        void memo.generate(request());
      } else if (k.toLowerCase() === "b" && tab === "versiones" && focusRow != null) {
        e.preventDefault();
        toggleLock(focusRow);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    active,
    analysis,
    applied,
    applying,
    board.versions.length,
    clickNote,
    comp,
    focusPhrase,
    focusPhraseAt,
    focusRow,
    loop,
    memo,
    memoKey,
    mineCount,
    onBack,
    phraseOf,
    player,
    request,
    selectedNote,
    semis,
    setLoop,
    setSemis,
    setTab,
    shifted,
    tab,
    targetKey,
    toggleLock,
  ]);

  const voice = visibleSpeakers(session).find((v) => v.id === resolveSpeaker(session, passage.speaker));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line px-1 pb-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <button
            type="button"
            className={btn}
            onClick={() => {
              player.stop();
              onBack();
            }}
            title={`Volver a ${session.title} (Esc)`}
          >
            ← Sesión
          </button>
          <span className="shrink-0 font-mono text-sm text-accent">{passage.label}</span>
          <h2 className="min-w-0 truncate text-lg font-medium text-text" title={passage.text}>
            «{passage.text || "…"}»
          </h2>
          <span className="shrink-0 text-xs text-text-faint">
            {[
              `${fmtTime(passage.start)}–${fmtTime(passage.end)}`,
              `${Math.round(passage.end - passage.start)} s`,
              voice?.name,
              KIND_LABEL[passage.kind].toLowerCase(),
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {song && <span className="max-w-[24ch] truncate text-xs text-text-faint">♫ {song.title}</span>}
          <ToTemaButton
            memo={{ sessionId: session.id, passageId: passage.id }}
            title={passage.text ? `«${passage.text.slice(0, 40)}»` : undefined}
            onLeave={() => player.stop()}
          />
          <button type="button" className={btn} disabled={mineCount === 0} onClick={() => setApplying(true)} title="⌘⏎">
            Aplicar a canción…
          </button>
        </div>
      </header>

      <TabBar
        tabs={TABS.map((t, i) => ({ id: t.id, label: `${t.label}`, badge: i + 1 }))}
        active={tab}
        onChange={(id) => setTab(id as MemoTab)}
      />

      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain pr-1">
        <audio {...player.audioProps} />
        {!analysis ? (
          <AnalysisPending
            passage={passage}
            loading={memo.loadingAnalysis}
            error={memo.analysisError}
            onAnalyze={async () => {
              await api.analyze(session.id, passage.id).catch((e: Error) => data.setError(e.message));
              void data.reload();
            }}
          />
        ) : tab === "melodia" ? (
          <MelodyTab
            analysis={analysis}
            player={player}
            semis={semis}
            setSemis={setSemis}
            memoKey={memoKey}
            setMemoKey={setMemoKey}
            targetKey={targetKey}
            setTargetKey={setTarget}
            songTitle={targetPick ? null : (song?.title ?? null)}
            notation={comp.notation}
            setNotation={comp.setNotation}
            focusPhrase={focusPhrase}
            setFocusPhrase={focusPhraseAt}
            selectedNote={selectedNote}
            onNoteClick={clickNote}
            loop={loop}
            setLoop={setLoop}
            zoom={zoom}
            setZoom={setZoom}
          />
        ) : tab === "molde" ? (
          <MoldTab
            analysis={analysis}
            player={player}
            mode={mode}
            onMode={setMode}
            onOverride={(i, o) => void memo.patchMold(i, o)}
            focusPhrase={focusPhrase}
            setFocusPhrase={focusPhraseAt}
          />
        ) : (
          <VersionsTab
            analysis={analysis}
            board={board}
            patchBoard={memo.patchBoard}
            generate={(req) => void memo.generate(req)}
            generating={memo.generating}
            genError={memo.genError}
            stopGenerating={memo.stopGenerating}
            mode={mode}
            onMode={setMode}
            player={player}
            songId={song?.id}
            focusRow={focusRow}
            setFocusRow={setFocusRow}
            count={count}
            setCount={setCount}
            onApply={() => setApplying(true)}
            guideTarget={guideTarget}
            keysActive={active}
            boardLoaded={memo.boardLoaded}
            boardError={memo.boardError}
            onRetryBoard={memo.reloadBoard}
          />
        )}
        {memo.saveError && <p className="mt-2 text-xs text-red">No se guardó el tablero de letras: {memo.saveError}</p>}
      </div>

      {applied && (
        <div className="flex shrink-0 items-center gap-3 rounded-md border border-line bg-panel px-3 py-2 text-xs">
          <span className="text-green">✓</span>
          <span className="min-w-0 flex-1 truncate text-text">
            {comp.songs.find((s) => s.id === applied.songId)?.title}: {applied.note}
          </span>
          <button
            type="button"
            className={btnGhost}
            onClick={() => {
              applied.undo();
              setApplied(null);
            }}
          >
            Deshacer <kbd className="text-2xs opacity-70">⌘Z</kbd>
          </button>
          <button
            type="button"
            className={btnGhost}
            onClick={() => {
              comp.setSection("canciones");
              comp.setSelectedId(applied.songId);
            }}
          >
            Ver la canción ↗
          </button>
        </div>
      )}

      {applying && analysis && (
        <ApplySheet
          session={session}
          passage={passage}
          board={board}
          semis={semis}
          onClose={() => setApplying(false)}
          onApplied={(c) => {
            setApplying(false);
            setApplied(c);
          }}
        />
      )}
    </div>
  );
}

function AnalysisPending({
  passage,
  loading,
  error,
  onAnalyze,
}: {
  passage: Passage;
  loading: boolean;
  error: string | null;
  onAnalyze: () => void;
}) {
  if (loading) return <PanelState kind="loading" />;
  if (passage.status === "analizando")
    return (
      <div className="flex flex-col gap-3 py-4">
        <p className="text-sm text-text">Analizando la melodía de {passage.label}…</p>
        <p className="text-xs text-text-dim">
          Aísla la voz, mide la altura cuadro a cuadro, la parte en notas y las ancla a las sílabas. Puedes volver a la
          sesión y seguir trabajando: esto se actualiza solo.
        </p>
        <div className="flex flex-col gap-2">
          <div className="skeleton h-8 w-full" />
          <div className="skeleton h-40 w-full" />
          <div className="skeleton h-6 w-2/3" />
        </div>
      </div>
    );
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      <p className="text-sm text-text">
        {passage.status === "error" ? "No salió una melodía clara" : "Este pasaje todavía no tiene análisis"}
      </p>
      <p className="max-w-[52ch] text-xs text-text-dim">
        {passage.error ?? error ?? "El análisis saca las notas, las sílabas y la tonalidad del pasaje."}
      </p>
      <button type="button" className={btn} onClick={onAnalyze}>
        {passage.status === "error" ? "↻ Reintentar análisis" : "Analizar melodía"}
      </button>
    </div>
  );
}
