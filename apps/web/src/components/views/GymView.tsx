"use client";

// GIMNASIO DE ARTICULACIÓN (/gimnasio): ~9 minutos al día, dos repeticiones en
// español y dos en inglés. Escenario → hablas (Espacio) → tu respuesta dicha
// mejor + nota por hábito → "otra vez" hasta que suene a ti en tu mejor día.
//
// Todo dato visible es real: la nota la pone el modelo sobre TU transcript, las
// frases marcadas las vio el detector y la racha sale de lo guardado en disco.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  GYM_HABITS,
  GYM_KIND_LABEL,
  GYM_SCENARIOS,
  habitAverages,
  planProgress,
  weakestHabit,
  type GymRep,
  type GymScenario,
} from "@hermes/shared";
import { ViewHeader } from "@/components/ui/ViewHeader";
import { RailRow, RailSection } from "@/components/ui/Rail";
import { ScrollArea } from "@/components/ui/ScrollArea";
import { LiveWaveform } from "@/components/estudio/audio/Waveform";
import { GymFeedback, scoreTone } from "@/components/gym/GymFeedback";
import { GymReference } from "@/components/gym/GymReference";
import { useMediaRecorder } from "@/hooks/useMediaRecorder";
import { useGym } from "@/hooks/useGym";

type Phase = "idle" | "recording" | "analyzing" | "feedback";

const LANG_LABEL = { es: "Español", en: "Inglés" } as const;
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const habitLabel = (key: string) => GYM_HABITS.find((h) => h.key === key)?.label ?? key;

// Preferencia de esta persona: ver la referencia antes de responder (default
// sí) o intentarlo a ciegas. Solo comodidad local: si el storage falla, se ve.
const REF_KEY = "hermes-gym-reference";
function readShowReference(): boolean {
  try {
    return localStorage.getItem(REF_KEY) !== "hidden";
  } catch {
    return true;
  }
}

export function GymView({ active }: { active: boolean }) {
  const { today, error: loadError, submit, newRound } = useGym(active);
  const rec = useMediaRecorder({ meter: true });
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<GymRep | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState("");
  const [showRef, setShowRef] = useState(true);
  useEffect(() => setShowRef(readShowReference()), []);
  const toggleRef = () =>
    setShowRef((v) => {
      try {
        localStorage.setItem(REF_KEY, v ? "hidden" : "shown");
      } catch {
        /* sin storage: la preferencia dura la sesión */
      }
      return !v;
    });

  const rounds = useMemo(() => today?.rounds ?? (today ? [today.plan] : []), [today]);
  // Ronda que se está mirando: la última, salvo que elijas otra. Llega una
  // nueva → saltas a ella.
  const [roundIdx, setRoundIdx] = useState(0);
  const roundCount = rounds.length;
  useEffect(() => {
    if (roundCount) setRoundIdx(roundCount - 1);
  }, [roundCount]);
  const round = rounds[Math.min(roundIdx, Math.max(0, roundCount - 1))] ?? [];
  const progress = useMemo(() => (today ? planProgress(round, today.reps) : []), [today, round]);
  // Escenario vigente: el elegido (de cualquier ronda o del catálogo), o el
  // primero sin hacer de la ronda que miras.
  const current: GymScenario | null = useMemo(() => {
    if (currentId)
      return (
        rounds.flat().find((s) => s.id === currentId) ??
        GYM_SCENARIOS.find((s) => s.id === currentId) ??
        null
      );
    return (progress.find((p) => !p.best) ?? progress[0])?.scenario ?? null;
  }, [currentId, progress, rounds]);
  const doneCount = progress.filter((p) => p.best).length;
  const roundDone = progress.length > 0 && doneCount === progress.length;
  // Ronda completa y sin un ejercicio elegido a mano: lo que toca es la
  // siguiente ronda, no volver a mostrar el primer ejercicio.
  const showRoundDone = roundDone && !currentId && phase === "idle";
  const doneToday = new Set(today?.reps.map((r) => r.scenarioId) ?? []).size;

  const [roundBusy, setRoundBusy] = useState(false);
  const askRound = useCallback(async () => {
    if (roundBusy) return;
    setRoundBusy(true);
    setError(null);
    const r = await newRound();
    setRoundBusy(false);
    if (!r.ok) setError(r.error ?? "No pude armar otra ronda.");
    else {
      setCurrentId(null);
      setPhase("idle");
      setResult(null);
    }
  }, [newRound, roundBusy]);

  // Intento anterior del escenario vigente (para comparar en la devolución).
  const previousOf = useCallback(
    (rep: GymRep) =>
      today?.reps
        .filter((r) => r.scenarioId === rep.scenarioId && r.attempt === rep.attempt - 1)
        .at(-1) ?? null,
    [today],
  );

  const choose = (id: string) => {
    if (phase === "recording" || phase === "analyzing") return;
    setCurrentId(id);
    setPhase("idle");
    setResult(null);
    setError(null);
  };

  const send = useCallback(
    async (input: { blob?: Blob; text?: string; durationSec: number }) => {
      if (!current) return;
      setPhase("analyzing");
      setError(null);
      const r = await submit({ scenarioId: current.id, ...input });
      if (r.ok) {
        setResult(r.rep);
        setPhase("feedback");
      } else {
        setError(r.error);
        setPhase("idle");
      }
    },
    [current, submit],
  );

  const toggleRecord = useCallback(async () => {
    if (phase === "analyzing" || !current) return;
    // Con la ronda completa en pantalla, Espacio pide la siguiente (no graba
    // un ejercicio que no se ve).
    if (showRoundDone && !rec.recording) return void askRound();
    if (rec.recording) {
      const { blob, durationSec, peak } = await rec.stop();
      if (!blob || peak < 0.02) {
        setError("No se escuchó nada: revisa el micrófono e inténtalo otra vez.");
        setPhase("idle");
        return;
      }
      await send({ blob, durationSec });
      return;
    }
    setError(null);
    setResult(null);
    if (await rec.start()) setPhase("recording");
  }, [phase, current, rec, send, showRoundDone, askRound]);

  // "Otra vez" fija el ejercicio: con la ronda completa, sin esto volvería el
  // aviso de "ronda completa" en vez del ejercicio que quieres repetir.
  const retry = useCallback(() => {
    if (current) setCurrentId(current.id);
    setPhase("idle");
    setResult(null);
    setError(null);
  }, [current]);

  const next = useCallback(() => {
    const pending = progress.find((p) => !p.best && p.scenario.id !== current?.id);
    if (pending) return choose(pending.scenario.id);
    // Ronda completa: a la siguiente que ya exista, o pide una nueva.
    if (roundIdx < roundCount - 1) {
      setRoundIdx(roundIdx + 1);
      setCurrentId(null);
      setPhase("idle");
      setResult(null);
      return;
    }
    void askRound();
  }, [progress, current, roundIdx, roundCount, askRound]);

  /** Fuera del plan: otro escenario del mismo idioma (práctica libre). */
  const shuffle = () => {
    if (!current) return;
    const planIds = new Set(progress.map((p) => p.scenario.id));
    const pool = GYM_SCENARIOS.filter((s) => s.lang === current.lang && !planIds.has(s.id) && s.id !== current.id);
    if (pool.length) choose(pool[Math.floor(Math.random() * pool.length)].id);
  };

  // Teclado: Espacio graba/envía · R otra vez · N siguiente · Esc descarta.
  const keyRef = useRef({ toggleRecord, next, retry, phase });
  keyRef.current = { toggleRecord, next, retry, phase };
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // Un botón con foco (Escuchar, una tarjeta…) se queda con el Espacio del
      // navegador y lo vuelve a pulsar. En el gimnasio Espacio es grabar,
      // salvo sobre el propio botón de grabar, que ya graba con su clic.
      if (t?.tagName === "BUTTON") {
        if (e.code !== "Space" || t.dataset.gymRecord != null) return;
        t.blur();
      }
      const k = keyRef.current;
      if (e.code === "Space") {
        e.preventDefault();
        void k.toggleRecord();
      } else if (e.key === "r" && k.phase === "feedback") retry();
      else if (e.key === "n" && k.phase === "feedback") k.next();
      else if (e.key === "Escape" && k.phase === "recording") {
        rec.cancel();
        setPhase("idle");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, rec]);

  // Salir de la vista con el micrófono abierto = descartar (no grabar a escondidas).
  useEffect(() => {
    if (!active && rec.recording) {
      rec.cancel();
      setPhase("idle");
    }
  }, [active, rec]);

  const recent = today?.recent ?? [];
  const weakest = weakestHabit(recent);
  const avgEs = habitAverages(recent, "es");
  const avgEn = habitAverages(recent, "en");
  const days = useMemo(() => {
    const by = new Map<string, GymRep[]>();
    for (const r of recent) by.set(r.date, [...(by.get(r.date) ?? []), r]);
    return [...by.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, 7)
      .map(([date, reps]) => ({
        date,
        reps: reps.length,
        avg: Math.round(reps.reduce((a, r) => a + r.score, 0) / reps.length),
        both: reps.some((r) => r.lang === "es") && reps.some((r) => r.lang === "en"),
      }));
  }, [recent]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <ViewHeader
        title="Gimnasio"
        meta={
          today
            ? `${doneToday} ${doneToday === 1 ? "hecha" : "hechas"} hoy${today.streak ? ` · racha de ${today.streak} ${today.streak === 1 ? "día" : "días"}` : ""}`
            : undefined
        }
        actions={
          today ? (
            <button
              type="button"
              onClick={() => void askRound()}
              disabled={roundBusy || phase === "recording" || phase === "analyzing"}
              className="cursor-pointer rounded-sm border border-line px-2.5 py-1 text-xs text-text hover:border-line-2 disabled:cursor-default disabled:opacity-50"
              title="Cuatro temas nuevos de tecnología, IA e ingeniería de agentes"
            >
              {roundBusy ? "Preparando temas…" : "＋ Otra ronda"}
            </button>
          ) : undefined
        }
      />

      <div className="grid min-h-0 flex-1 grid-cols-12 gap-3 max-lg:auto-rows-min max-lg:overflow-y-auto lg:grid-rows-[minmax(0,1fr)]">
        <ScrollArea fade="y" className="col-span-12 min-h-0 lg:col-span-8">
          <div className="mx-auto flex max-w-3xl flex-col gap-6 px-1 py-2">
            {loadError && !today && (
              <p className="text-sm text-red">No pude cargar el gimnasio: {loadError}</p>
            )}

            {/* Rondas de hoy: la 1 es el plan fijo; las demás, temas nuevos */}
            {roundCount > 1 && (
              <div className="flex flex-wrap items-center gap-1.5">
                {rounds.map((r, i) => {
                  const done = planProgress(r, today?.reps ?? []).filter((p) => p.best).length;
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => {
                        setRoundIdx(i);
                        setCurrentId(null);
                        setPhase("idle");
                        setResult(null);
                      }}
                      className={`cursor-pointer rounded-sm px-2 py-0.5 text-xs tabular-nums transition-colors ${
                        i === roundIdx ? "bg-panel-2 text-text" : "text-text-faint hover:text-text"
                      }`}
                    >
                      Ronda {i + 1} · {done}/{r.length}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Las cuatro de la ronda */}
            {progress.length > 0 && (
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                {progress.map(({ scenario, best, attempts }) => {
                  const on = scenario.id === current?.id && !showRoundDone;
                  return (
                    <button
                      key={scenario.id}
                      type="button"
                      onClick={() => choose(scenario.id)}
                      className={`flex cursor-pointer flex-col gap-1 rounded-md border px-3 py-2 text-left transition-colors ${
                        on ? "border-accent bg-accent/5" : "border-line hover:border-line-2"
                      }`}
                    >
                      <span className="flex items-center justify-between gap-2 text-2xs text-text-faint">
                        {LANG_LABEL[scenario.lang]}
                        {best ? (
                          <span className={`tabular-nums ${scoreTone(best.score)}`}>{best.score}/100</span>
                        ) : (
                          <span>pendiente</span>
                        )}
                      </span>
                      <span className="truncate text-xs text-text">{GYM_KIND_LABEL[scenario.kind]}</span>
                      {scenario.source === "generated" && (
                        <span className="truncate text-2xs text-accent">✦ tema nuevo</span>
                      )}
                      {attempts > 1 && <span className="text-2xs text-text-faint">{attempts} intentos</span>}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Ronda completa: la siguiente, sin límite */}
            {showRoundDone && (
              <div className="flex flex-col items-center gap-2 py-2 text-center">
                <p className="text-md text-green">Ronda {roundIdx + 1} completa.</p>
                <button
                  type="button"
                  onClick={() => void askRound()}
                  disabled={roundBusy}
                  className="cursor-pointer rounded-sm border border-accent bg-accent/10 px-4 py-2 text-sm text-accent disabled:cursor-default disabled:opacity-60"
                >
                  {roundBusy
                    ? (today?.poolReady ?? 0) >= 4
                      ? "Armando la ronda…"
                      : "Escribiendo temas nuevos… (~30 s)"
                    : "Otra ronda: 4 temas nuevos de IA y agentes →"}
                </button>
                <p className="text-xs text-text-faint">o toca una tarjeta para repetir ese ejercicio</p>
              </div>
            )}
            {current && !showRoundDone && (
              <section className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2 text-xs text-text-dim">
                  <span className="rounded-sm border border-line px-1.5 py-0.5 text-text">
                    {LANG_LABEL[current.lang]}
                  </span>
                  <span>{GYM_KIND_LABEL[current.kind]}</span>
                  {current.source === "generated" && <span className="text-accent">✦ tema nuevo</span>}
                  <span className="text-text-faint">· foco: {habitLabel(current.focus)}</span>
                  <button
                    type="button"
                    onClick={shuffle}
                    disabled={phase === "recording" || phase === "analyzing"}
                    className="ml-auto cursor-pointer text-xs text-text-faint hover:text-text disabled:opacity-40"
                    title="Otro escenario del mismo idioma (fuera del plan de hoy)"
                  >
                    ⤨ Otro escenario
                  </button>
                </div>
                <p className="text-sm leading-relaxed text-text-dim">{current.situation}</p>
                <p className="text-2xl leading-snug text-text">{current.prompt}</p>
                {phase !== "feedback" && (
                  <GymReference scenario={current} open={showRef} onToggle={toggleRef} />
                )}
              </section>
            )}

            {/* Grabadora */}
            {current && phase !== "feedback" && !showRoundDone && (
              <section className="flex flex-col items-center gap-4 py-2">
                <div className="h-14 w-full max-w-xl">
                  <LiveWaveform meterRef={rec.meterRef} active={rec.recording} />
                </div>
                <button
                  type="button"
                  onClick={() => void toggleRecord()}
                  disabled={phase === "analyzing" || !rec.supported}
                  aria-label={rec.recording ? "Terminar y evaluar" : "Grabar respuesta"}
                  data-gym-record
                  className={`flex h-20 w-20 cursor-pointer items-center justify-center rounded-full border-2 transition-colors disabled:cursor-default disabled:opacity-50 ${
                    rec.recording ? "border-red bg-red/10" : "border-accent bg-accent/10 hover:bg-accent/20"
                  }`}
                >
                  {rec.recording ? (
                    <span className="h-6 w-6 rounded-xs bg-red" />
                  ) : (
                    <span className="h-7 w-7 rounded-full bg-accent" />
                  )}
                </button>
                <p className="text-sm text-text-dim tabular-nums">
                  {phase === "analyzing"
                    ? "Escuchando lo que dijiste… (~15 s)"
                    : rec.recording
                      ? `${fmt(rec.elapsed)} / ~${fmt(current.targetSec)} · Espacio para terminar`
                      : `Espacio para hablar · ~${current.targetSec} s`}
                </p>
                {rec.recording && rec.elapsed > current.targetSec + 15 && (
                  <p className="text-xs text-amber">Ya pasaste el tiempo: cierra con tu punto.</p>
                )}
                {(error || rec.error) && <p className="text-sm text-red">{error ?? rec.error}</p>}

                {!rec.recording && phase === "idle" && (
                  <div className="w-full max-w-xl">
                    {typing ? (
                      <div className="flex flex-col gap-2">
                        <textarea
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          rows={3}
                          placeholder={current.lang === "en" ? "Type what you'd say…" : "Escribe lo que dirías…"}
                          className="w-full resize-none rounded-md border border-line bg-panel px-3 py-2 text-sm text-text outline-none focus:border-line-2"
                        />
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setTyping(false)}
                            className="cursor-pointer px-2 py-1 text-xs text-text-faint hover:text-text"
                          >
                            Cancelar
                          </button>
                          <button
                            type="button"
                            disabled={draft.trim().split(/\s+/).length < 6}
                            onClick={() => {
                              const text = draft.trim();
                              setDraft("");
                              setTyping(false);
                              void send({ text, durationSec: 0 });
                            }}
                            className="cursor-pointer rounded-sm border border-accent bg-accent/10 px-3 py-1 text-xs text-accent disabled:cursor-default disabled:opacity-40"
                          >
                            Evaluar
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setTyping(true)}
                        className="mx-auto block cursor-pointer text-xs text-text-faint hover:text-text"
                      >
                        o escríbelo (sin micrófono)
                      </button>
                    )}
                  </div>
                )}
              </section>
            )}

            {phase === "feedback" && result && (
              <section className="flex flex-col gap-5 border-t border-line pt-5">
                <GymFeedback rep={result} previous={previousOf(result)} />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={retry}
                    className="cursor-pointer rounded-sm border border-accent bg-accent/10 px-3 py-1.5 text-sm text-accent"
                  >
                    ↺ Otra vez <span className="text-text-faint">R</span>
                  </button>
                  <button
                    type="button"
                    onClick={next}
                    className="cursor-pointer rounded-sm border border-line px-3 py-1.5 text-sm text-text hover:border-line-2"
                  >
                    {progress.some((p) => !p.best && p.scenario.id !== current?.id)
                      ? "Siguiente →"
                      : roundIdx < roundCount - 1
                        ? "Siguiente ronda →"
                        : "Otra ronda →"}{" "}
                    <span className="text-text-faint">N</span>
                  </button>
                </div>
              </section>
            )}

          </div>
        </ScrollArea>

        <aside
          aria-label="Progreso"
          className="col-span-12 flex min-h-0 flex-col border-line lg:col-span-4 lg:border-l lg:pl-6"
        >
          <ScrollArea rail fade="y" className="min-h-0 flex-1 pr-1">
            <div className="flex min-h-full flex-col gap-7">
              <RailSection label="Racha">
                <p className="text-2xl font-semibold text-text tabular-nums">
                  {today?.streak ?? 0} <span className="text-sm font-normal text-text-dim">días</span>
                </p>
                <p className="mt-1 text-xs text-text-faint">
                  Un día cuenta con al menos una en español y una en inglés.
                </p>
              </RailSection>

              <RailSection label="Tus hábitos · 14 días">
                {recent.length === 0 ? (
                  <p className="text-xs text-text-faint">Aún no hay repeticiones: la primera nota sale de tu primera respuesta.</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    <div className="grid grid-cols-[minmax(0,1fr)_2.5rem_2.5rem] gap-2 text-2xs text-text-faint">
                      <span />
                      <span className="text-right">ES</span>
                      <span className="text-right">EN</span>
                    </div>
                    {GYM_HABITS.map((h) => (
                      <div
                        key={h.key}
                        className="grid grid-cols-[minmax(0,1fr)_2.5rem_2.5rem] gap-2 text-xs"
                        title={h.hint}
                      >
                        <span className={h.key === weakest ? "text-amber" : "text-text"}>{h.label}</span>
                        <span className="text-right text-text-dim tabular-nums">{avgEs[h.key] ?? "—"}</span>
                        <span className="text-right text-text-dim tabular-nums">{avgEn[h.key] ?? "—"}</span>
                      </div>
                    ))}
                    {weakest && (
                      <p className="mt-1 text-xs text-text-dim">
                        Hoy trabaja <span className="text-amber">{habitLabel(weakest)}</span>.
                      </p>
                    )}
                  </div>
                )}
              </RailSection>

              <RailSection label="Los cinco hábitos">
                <div>
                  {GYM_HABITS.map((h) => (
                    <RailRow key={h.key} title={h.label} sub={h.hint} />
                  ))}
                </div>
              </RailSection>

              {days.length > 0 && (
                <RailSection label="Últimos días">
                  <div>
                    {days.map((d) => (
                      <RailRow
                        key={d.date}
                        title={d.date}
                        sub={`${d.reps} ${d.reps === 1 ? "repetición" : "repeticiones"}${d.both ? "" : " · falta un idioma"}`}
                        value={`${d.avg}/100`}
                        tone={d.both ? "green" : "amber"}
                      />
                    ))}
                  </div>
                </RailSection>
              )}
            </div>
          </ScrollArea>
        </aside>
      </div>
    </div>
  );
}
