"use client";

/**
 * Etapa LETRA: las versiones de letra de Sesiones (VersionsTab: rejilla por
 * frase del molde, "Tu versión", candados, calce en vivo) sobre la TOMA ★ de
 * la sección — una toma es una sesión con un solo pasaje, así que se reusa
 * todo. El pedido de letra lleva el `temaId`: la intención, la pista y la
 * sección entran al contexto.
 *
 * Sin toma lista, estado vacío honesto que lleva a Grabar.
 */
import { useEffect, useMemo, useState } from "react";
import type { ComposeSession, LyricRequest, Passage, TemaCandidate } from "@hermes/shared";
import { PanelState } from "@/components/ui/PanelState";
import { usePlaygroundApi } from "../playground/api";
import { useMemoData } from "../playground/useMemoData";
import { useMemoPlayer } from "../playground/useMemoPlayer";
import { VersionsTab } from "../playground/VersionsTab";
import type { GuideTarget } from "../playground/useGuide";
import { btn, btnPrimary, chip, plainKey } from "../playground/ui";
import { useTemaCtx } from "./TemaContext";

const STATUS_LABEL: Record<TemaCandidate["status"], string> = {
  procesando: "procesando",
  pendiente: "sin analizar",
  analizando: "analizando",
  listo: "lista",
  error: "sin melodía clara",
};

export function LyricsStage() {
  const { detail, section, setStage } = useTemaCtx();
  const takes = useMemo(
    () => detail.candidates.filter((c) => c.sectionId === section.id),
    [detail.candidates, section.id],
  );
  const ready = takes.filter((c) => c.status === "listo");
  const [pick, setPick] = useState<string | null>(null);
  const chosen =
    ready.find((c) => c.memo.sessionId === pick) ?? ready.find((c) => c.favorite) ?? ready[ready.length - 1] ?? null;

  useEffect(() => setPick(null), [section.id]);

  if (!chosen) {
    const working = takes.filter((c) => c.status === "procesando" || c.status === "analizando" || c.status === "pendiente");
    return (
      <div className="flex flex-col items-center gap-2 py-12 text-center">
        <p className="text-sm text-text">
          {working.length
            ? `${working.length === 1 ? "La toma de" : `${working.length} tomas de`} ${section.label} se ${
                working.length === 1 ? "está" : "están"
              } analizando`
            : takes.length
              ? `Ninguna toma de ${section.label} dio una melodía clara`
              : `Todavía no hay tomas de ${section.label}`}
        </p>
        <p className="max-w-[54ch] text-xs text-text-dim">
          La letra se escribe sobre el molde de una toma: cuántas sílabas, dónde caen los acentos, qué vocal se
          tarareó en cada melisma. {working.length ? "Esto se actualiza solo." : "Graba los fonemas encima de la pista y vuelve."}
        </p>
        {!working.length && (
          <button type="button" className={`${btnPrimary} mt-2`} onClick={() => setStage("grabar")}>
            Ir a Grabar
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-1" role="radiogroup" aria-label="Toma sobre la que se escribe">
          <span className="mr-1 text-xs text-text-faint">Toma</span>
          {takes.map((c) => {
            const on = c.memo.sessionId === chosen.memo.sessionId;
            const usable = c.status === "listo";
            return (
              <button
                key={c.memo.sessionId}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={!usable}
                onClick={() => setPick(c.memo.sessionId)}
                title={usable ? undefined : STATUS_LABEL[c.status]}
                className={`${chip(on)} disabled:cursor-not-allowed disabled:opacity-50`}
              >
                {c.label}
                {c.favorite && <span aria-label="favorita">★</span>}
                {!usable && <span className="text-text-faint">· {STATUS_LABEL[c.status]}</span>}
              </button>
            );
          })}
        </div>
        <span className="text-xs text-text-faint">
          Al generar se envía a Claude la intención, la progresión y los fonemas. Tu voz no sale de este equipo.
        </span>
      </div>
      <TakeLyrics key={chosen.memo.sessionId} candidate={chosen} />
    </div>
  );
}

/** Carga la sesión de la toma (su pasaje P01) y monta las versiones sobre él. */
function TakeLyrics({ candidate }: { candidate: TemaCandidate }) {
  const api = usePlaygroundApi();
  const [session, setSession] = useState<ComposeSession | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setErr(null);
    api
      .getSession(candidate.memo.sessionId)
      .then((s) => !cancelled && setSession(s))
      .catch((e: Error) => !cancelled && setErr(e.message));
    return () => {
      cancelled = true;
    };
  }, [api, candidate.memo.sessionId, tick]);

  const passage = session?.passages.find((p) => p.id === candidate.memo.passageId) ?? session?.passages[0] ?? null;
  if (err)
    return (
      <PanelState kind="error" title="No se pudo abrir la toma" hint={err} retry={() => setTick((t) => t + 1)} />
    );
  if (!session || !passage) return <PanelState kind="loading" />;
  return <TakeVersions session={session} passage={passage} />;
}

function TakeVersions({ session, passage }: { session: ComposeSession; passage: Passage }) {
  const api = usePlaygroundApi();
  const { tema, setStage, active, engine } = useTemaCtx();
  const memo = useMemoData(session.id, passage);
  const { analysis, board } = memo;
  const player = useMemoPlayer({ api, sessionId: session.id, passageId: passage.id, analysis, semis: 0, active });
  const [focusRow, setFocusRow] = useState<number | null>(null);
  const [count, setCount] = useState(3);
  const mode = board.melismaMode;

  // La guía cantada cae SOBRE la pista con la que se grabó la toma (su tempo, compás y
  // loop, alineada por su downbeat). Sin rejilla (un pasaje traído de Sesiones), suena sola.
  const take = session.take;
  const guideTarget = useMemo<GuideTarget>(
    () => ({
      sessionId: session.id,
      passageId: passage.id,
      passageStart: passage.start,
      ...(take ? { onTrack: { base: tema.track, sectionId: take.sectionId, grid: take.grid, engine } } : {}),
    }),
    [session.id, passage.id, passage.start, take, tema.track, engine],
  );

  // G = generar (el botón lo anuncia). El pedido lleva el tema: intención, pista y sección.
  const { generate, generating } = memo;
  useEffect(() => {
    if (!active || !analysis) return;
    const onKey = (e: KeyboardEvent) => {
      if (!plainKey(e) || e.key.toLowerCase() !== "g" || e.shiftKey || generating) return;
      e.preventDefault();
      void generate({
        count,
        brief: board.brief,
        persona: board.persona,
        rhyme: board.rhyme,
        melismaMode: mode,
        songId: tema.songId,
        locked: board.locked,
        temaId: tema.id,
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, analysis, board, count, generate, generating, mode, tema.id, tema.songId]);

  if (!analysis) {
    if (memo.loadingAnalysis) return <PanelState kind="loading" />;
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-center">
        <p className="text-sm text-text">Esta toma todavía no tiene análisis</p>
        <p className="max-w-[52ch] text-xs text-text-dim">{memo.analysisError ?? "El molde sale del análisis de la toma."}</p>
        <button type="button" className={btn} onClick={() => setStage("analisis")}>
          Ver el análisis
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-0">
      <audio {...player.audioProps} />
      <VersionsTab
        analysis={analysis}
        board={board}
        patchBoard={memo.patchBoard}
        generate={(req: LyricRequest) => void memo.generate({ ...req, temaId: tema.id })}
        generating={memo.generating}
        genError={memo.genError}
        stopGenerating={memo.stopGenerating}
        mode={mode}
        onMode={(m) => memo.patchBoard({ melismaMode: m }, 0)}
        player={player}
        songId={tema.songId}
        focusRow={focusRow}
        setFocusRow={setFocusRow}
        count={count}
        setCount={setCount}
        onApply={() => setStage("montaje")}
        guideTarget={guideTarget}
        keysActive={active}
        boardLoaded={memo.boardLoaded}
        boardError={memo.boardError}
        onRetryBoard={memo.reloadBoard}
      />
      {memo.saveError && <p className="mt-2 text-xs text-red">No se guardó el tablero de letras: {memo.saveError}</p>}
    </div>
  );
}
