"use client";

/**
 * Un TEMA abierto: la cáscara que comparten las 6 etapas. Cabecera (título
 * editable, tonalidad · bpm · compás, pastilla Privado), el stepper con lo que
 * falta, la etapa a la vista y el TRANSPORTE fijo abajo: la misma pista sonando
 * en loop mientras se escribe la intención, se arman los acordes, se graba o
 * se lee la rejilla. Provee `TemaCtx` a las etapas (no saben de fetch ni de
 * debounce).
 *
 * Gramática de la casa, contexto → lista → pieza: a partir de 1400 px hay una
 * columna de contexto (secciones e intención); más angosto, el selector de
 * sección del transporte hace ese papel.
 *
 * Teclado (fuera de campos; nada con ⌘ — ⌘1..9 son los destinos globales):
 * ⌥1..⌥6 etapas · Espacio ▶/■ · T tap · N tema nuevo · Esc volver a la lista.
 * Salir de /composicion (o del tema) detiene la pista.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { TEMA_STAGES, TEMA_STAGE_LABEL, type TemaStage } from "@hermes/shared";
import { getTrackEngine } from "@/lib/track-engine";
import { keyLabel } from "@/lib/music-theory";
import { PanelState } from "@/components/ui/PanelState";
import { useComposicion } from "../ComposicionContext";
import { useViewActive } from "../playground/api";
import { usePlayground } from "../playground/PlaygroundContext";
import { btn, btnGhost, modalOpen, plainKey, typingTarget } from "../playground/ui";
import { TemaCtx, useTemaCtx, type TemaCtxValue } from "./TemaContext";
import { fmtBpm, showChord } from "./track-edit";
import { useTema, type SaveState } from "./useTema";
import { transportStore, useTransport } from "./transport-settings";
import { useTemas } from "./TemasProvider";
import { TemaStepper } from "./TemaStepper";
import { TemaTransport } from "./TemaTransport";
import { IntentStage } from "./IntentStage";
import { TrackStage } from "./TrackStage";
import { RecordStage } from "./RecordStage";
import { AnalysisStage } from "./AnalysisStage";
import { LyricsStage } from "./LyricsStage";
import { MontageStage } from "./MontageStage";
import { PrivacyPill } from "./PrivacyPill";
import { useTemaSeams } from "./seams";

export function TemaView({ id }: { id: string }) {
  const active = useViewActive();
  const temas = useTemas();
  const data = useTema(id, { active });
  const { detail, loadError, notFound } = data;

  if (!detail) {
    const gone = notFound;
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="flex shrink-0 items-center gap-3 border-b border-line px-1 pb-3">
          <button type="button" className={btn} onClick={() => temas.openTema(null)}>
            ← Temas
          </button>
        </div>
        {loadError ? (
          <PanelState
            kind={gone ? "empty" : "offline"}
            title={gone ? "Este tema ya no existe" : "El agente no responde"}
            hint={gone ? "Vuelve a la lista de temas." : loadError}
            retry={gone ? undefined : () => void data.reload()}
          />
        ) : (
          <div className="flex flex-col gap-3 p-1">
            <div className="skeleton h-7 w-1/3" />
            <div className="skeleton h-6 w-2/3" />
            <div className="skeleton h-40 w-full" />
          </div>
        )}
      </div>
    );
  }
  return <TemaShell data={data} />;
}

function TemaShell({ data }: { data: ReturnType<typeof useTema> }) {
  const active = useViewActive();
  const temas = useTemas();
  const detail = data.detail!;
  const tema = detail.tema;
  const engine = useMemo(() => getTrackEngine(), []);
  const [stage, setStage] = useState<TemaStage>(tema.stage);
  const [sectionId, setSectionIdRaw] = useState<string>(tema.track.sections[0]?.id ?? "");
  const section = tema.track.sections.find((s) => s.id === sectionId) ?? tema.track.sections[0];
  // Grabando, la sección queda fija (el candado del transporte): una toma leería la sección
  // nueva al cerrarse y quedaría guardada con otro loop y otros compases.
  const setSectionId = useCallback((id: string) => {
    if (transportStore.get().tempoLock) return;
    setSectionIdRaw(id);
  }, []);

  // Salir del tema, de Temas o de /composicion calla la pista.
  useEffect(() => () => engine.stop(), [engine]);
  useEffect(() => {
    if (!active && engine.playing()) engine.stop();
  }, [active, engine]);

  const advance = useCallback(
    (s: TemaStage) => {
      setStage(s);
      if (TEMA_STAGES.indexOf(s) > TEMA_STAGES.indexOf(tema.stage)) data.patch({ stage: s });
    },
    [data, tema.stage],
  );

  // ⌥1..⌥6 (por `code`: en Mac ⌥1 escribe "¡"), N, Esc.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (typingTarget(e) || modalOpen()) return;
      if (e.altKey && !e.metaKey && !e.ctrlKey) {
        const m = e.code.match(/^Digit([1-6])$/);
        if (m) {
          e.preventDefault();
          setStage(TEMA_STAGES[Number(m[1]) - 1]);
        }
        return;
      }
      if (!plainKey(e)) return;
      if (e.key === "Escape") {
        e.preventDefault();
        temas.openTema(null);
      } else if (e.key.toLowerCase() === "n" && !e.shiftKey && !temas.creating) {
        e.preventDefault();
        void temas.create();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, temas]);

  const ctx: TemaCtxValue | null = useMemo(
    () =>
      section
        ? {
            tema,
            // Los gates EN VIVO (recalculados sobre lo que se acaba de tocar), no los del último GET.
            detail: { ...detail, gates: data.gates },
            section,
            setSectionId,
            patch: data.patch,
            reload: data.reload,
            stage,
            setStage,
            engine,
            uploadTake: data.uploadTake,
            patchTake: data.patchTake,
            active,
          }
        : null,
    [tema, detail, data.gates, section, setSectionId, data.patch, data.reload, stage, engine, data.uploadTake, data.patchTake, active],
  );

  if (!ctx)
    return <PanelState kind="error" title="El tema no tiene secciones" hint="Vuelve a la lista y crea otro." />;

  return (
    <TemaCtx.Provider value={ctx}>
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <TemaHeader saveState={data.saveState} saveError={data.saveError} onRetrySave={() => void data.flush()} />
        <TemaStepper stage={stage} temaStage={tema.stage} gates={data.gates} onView={setStage} onAdvance={advance} />
        {/* grid-rows-[minmax(0,1fr)]: sin él la fila mide su contenido y el scroll de la etapa no engancha */}
        <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)] gap-x-6 min-[1400px]:grid-cols-[240px_minmax(0,1fr)]">
          <aside aria-label="Contexto del tema" className="hidden min-h-0 overflow-y-auto border-r border-line pr-5 min-[1400px]:block">
            <ContextColumn />
          </aside>
          <div
            role="region"
            aria-label={TEMA_STAGE_LABEL[stage]}
            className="min-h-0 min-w-0 overflow-x-hidden overflow-y-auto overscroll-contain pr-1 pb-2"
          >
            <StageBody stage={stage} />
          </div>
        </div>
        <TemaTransport />
      </div>
    </TemaCtx.Provider>
  );
}

function StageBody({ stage }: { stage: TemaStage }) {
  const seams = useTemaSeams();
  switch (stage) {
    case "intencion":
      return <IntentStage />;
    case "pista":
      return <TrackStage />;
    case "grabar":
      return seams.startRecorder ? <RecordStage startRecorder={seams.startRecorder} /> : <RecordStage />;
    case "analisis":
      return <AnalysisStage />;
    case "letra":
      return <LyricsStage />;
    case "montaje":
      return <MontageStage />;
  }
}

const SAVE_TEXT: Record<SaveState, string> = {
  idle: "en este equipo",
  saving: "guardando…",
  saved: "guardado",
  error: "no se guardó · reintentar",
};

function TemaHeader({
  saveState,
  saveError,
  onRetrySave,
}: {
  saveState: SaveState;
  saveError: string | null;
  onRetrySave: () => void;
}) {
  const { tema, patch, setStage } = useTemaCtx();
  const temas = useTemas();
  const { notation } = useComposicion();
  const [confirm, setConfirm] = useState(false);
  const t = tema.track;

  return (
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line px-1 pb-3">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <button type="button" className={btn} onClick={() => temas.openTema(null)} title="Volver a la lista (Esc)">
          ← Temas
        </button>
        <TitleField title={tema.title} onCommit={(title) => patch({ title })} />
        <button
          type="button"
          onClick={() => setStage("pista")}
          title="Cambiar en Pista"
          className="flex shrink-0 cursor-pointer items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs text-text-dim hover:bg-panel-2 hover:text-text"
        >
          <span>
            {keyLabel(t.key, notation)}
            {t.keySource === "medida" ? " (medida)" : ""}
          </span>
          <span className="text-text-faint">·</span>
          <span className="tabular-nums">
            {fmtBpm(t.bpm)} bpm{t.bpmSource === "estimado" ? " aprox." : ""}
          </span>
          <span className="text-text-faint">·</span>
          <span>{t.meter}</span>
        </button>
      </div>
      <div className="flex items-center gap-3">
        {saveState === "error" ? (
          <button type="button" onClick={onRetrySave} className="text-xs text-red hover:underline" title={saveError ?? ""}>
            {SAVE_TEXT.error}
          </button>
        ) : (
          <span className="text-xs text-text-faint">{SAVE_TEXT[saveState]}</span>
        )}
        <PrivacyPill />
        {confirm ? (
          <span className="flex items-center gap-1 text-xs text-text-dim">
            ¿Borrar el tema? Las tomas quedan en disco.
            <button
              type="button"
              className={btn}
              onClick={() => {
                void temas.remove(tema.id);
              }}
            >
              Borrar
            </button>
            <button type="button" className={btnGhost} onClick={() => setConfirm(false)}>
              No
            </button>
          </span>
        ) : (
          <button type="button" className={btnGhost} onClick={() => setConfirm(true)}>
            Borrar
          </button>
        )}
      </div>
    </header>
  );
}

/**
 * Título editable en su sitio. Vacío no se manda (el agente lo rechazaría):
 * mientras se escribe vale lo que hay; al salir vacío, vuelve el anterior.
 */
function TitleField({ title, onCommit }: { title: string; onCommit: (t: string) => void }) {
  const [draft, setDraft] = useState(title);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setDraft(title);
  }, [title, focused]);
  return (
    <input
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        if (e.target.value.trim()) onCommit(e.target.value);
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        if (!draft.trim()) setDraft(title);
      }}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      aria-label="Título del tema"
      className="min-w-[8ch] flex-1 truncate rounded-sm border border-transparent bg-transparent px-1 py-0.5 text-lg font-medium text-text hover:border-line focus:border-accent focus:outline-none"
    />
  );
}

/** Columna de contexto (≥1400 px): secciones con su loop y tomas, y la intención. */
function ContextColumn() {
  const { tema, detail, section, setSectionId, setStage } = useTemaCtx();
  const { notation } = useComposicion();
  // Grabando: la sección queda fija (la misma regla que el selector del transporte).
  const { tempoLock } = useTransport();
  const playground = usePlayground();
  const comp = useComposicion();
  const intent = tema.intent;
  const takesBy = (sid: string) => detail.candidates.filter((c) => c.sectionId === sid);

  return (
    <div className="flex flex-col gap-6 pt-1">
      <section className="flex flex-col gap-1.5">
        <span className="text-xs text-text-faint">Secciones</span>
        <ul className="flex flex-col">
          {tema.track.sections.map((s) => {
            const on = s.id === section.id;
            // Tomas y pasajes se cuentan aparte: un pasaje de Sesiones no es una toma grabada sobre la pista.
            const all = takesBy(s.id);
            const takes = all.filter((c) => c.kind === "toma");
            const passages = all.length - takes.length;
            const fav = takes.some((c) => c.favorite);
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => setSectionId(s.id)}
                  disabled={!!tempoLock && !on}
                  title={tempoLock && !on ? tempoLock : undefined}
                  aria-current={on ? "true" : undefined}
                  className="flex w-full cursor-pointer items-start gap-2 rounded-sm py-1.5 pr-1 text-left hover:bg-panel-2/60 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent"
                >
                  <span aria-hidden className={`mt-0.5 h-8 w-0.5 shrink-0 rounded-full ${on ? "bg-accent" : "bg-line"}`} />
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-sm ${on ? "text-accent" : "text-text"}`}>{s.label}</span>
                    <span className="block truncate font-mono text-xs text-text-faint">
                      {s.loop.map((b) => b.chords.map((c) => showChord(c.symbol, tema.track.key, notation)).join("/")).join(" · ")}
                    </span>
                    <span className="block text-xs text-text-faint">
                      {s.bars} c.
                      {takes.length ? ` · ${takes.length} ${takes.length === 1 ? "toma" : "tomas"}${fav ? " ★" : ""}` : " · sin tomas"}
                      {passages ? ` · ${passages} ${passages === 1 ? "pasaje" : "pasajes"}` : ""}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="flex flex-col gap-1.5">
        <span className="flex items-center justify-between text-xs text-text-faint">
          Intención
          <button type="button" className={btnGhost} onClick={() => setStage("intencion")} title="⌥1">
            editar
          </button>
        </span>
        {intent.about || intent.convey ? (
          <div className="flex flex-col gap-1.5 text-xs">
            {intent.about && <p className="line-clamp-3 text-text">{intent.about}</p>}
            {intent.convey && <p className="line-clamp-2 text-text-dim">{intent.convey}</p>}
            {intent.pov && <p className="text-text-faint">{intent.pov}</p>}
            {!!intent.anchors?.length && (
              <div className="flex flex-wrap gap-1">
                {intent.anchors.map((a) => (
                  <span key={a} className="rounded-sm bg-panel-2 px-1.5 py-0.5 text-text-dim">
                    {a}
                  </span>
                ))}
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-text-faint">Sin escribir todavía. Es lo que manda sobre la letra.</p>
        )}
      </section>

      {tema.origin && (
        <section className="flex flex-col gap-1.5">
          <span className="text-xs text-text-faint">Origen</span>
          <p className="text-xs text-text-dim">Nació de un tarareo de Sesiones.</p>
          <button
            type="button"
            className={`${btnGhost} self-start`}
            onClick={() => {
              playground.openSession(tema.origin!.sessionId);
              playground.openPassage(tema.origin!.passageId);
              comp.setSection("sesiones");
            }}
          >
            Abrir el pasaje ↗
          </button>
        </section>
      )}
    </div>
  );
}
