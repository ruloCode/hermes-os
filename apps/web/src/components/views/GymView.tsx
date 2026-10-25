"use client";

// GIMNASIO DE ARTICULACIÓN (/gimnasio): ~9 minutos al día, dos repeticiones en
// español y dos en inglés. Escenario → hablas (Espacio) → tu respuesta dicha
// mejor + nota por hábito → "otra vez" hasta que suene a ti en tu mejor día.
//
// Todo dato visible es real: la nota la pone el modelo sobre TU transcript, las
// frases marcadas las vio el detector y la racha sale de lo guardado en disco.
//
// v5: las rondas suben a la cabecera (pestañas de la vista), las cuatro de la
// ronda son tarjetas seleccionables con un punto de estado (no texto de
// colores), la grabadora es UN botón redondo de 64 px y el riel junta "tus
// notas por hábito" y "los cinco hábitos", que eran la misma lista dos veces.

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
import { useWorkspace } from "@/state/WorkspaceContext";
import { ScrollArea } from "@/components/ui/ScrollArea";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Segmented";
import { LiveWaveform } from "@/components/estudio/audio/Waveform";
import { GymFeedback, scoreDot } from "@/components/gym/GymFeedback";
import { GymReference } from "@/components/gym/GymReference";
import { fmtDay } from "@/components/ingles/report-utils";
import { useMediaRecorder } from "@/hooks/useMediaRecorder";
import { useGym } from "@/hooks/useGym";

type Phase = "idle" | "recording" | "analyzing" | "feedback";

const LANG_LABEL = { es: "Español", en: "Inglés" } as const;
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const habitLabel = (key: string) => GYM_HABITS.find((h) => h.key === key)?.label ?? key;
// Las fechas del gimnasio son días locales "AAAA-MM-DD": a mediodía para que el
// huso horario no las corra al día anterior al formatearlas.
const fmtGymDay = (date: string) => fmtDay(`${date}T12:00:00`);

/** Tecla de atajo dentro de un texto o un botón. */
function Kbd({ children, onAccent = false }: { children: string; onAccent?: boolean }) {
  return (
    <kbd
      className={`inline-flex h-5 min-w-5 items-center justify-center rounded-xs border px-1 font-sans text-2xs leading-none ${
        onAccent ? "border-on-accent/30 text-on-accent/80" : "border-line-2 bg-panel-2 text-text-dim"
      }`}
    >
      {children}
    </kbd>
  );
}

// Iconos de trazo 1.7 (como los de la barra lateral), en lugar de glifos.
const ICON = {
  width: 14,
  height: 14,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

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
  // Riel ocultable (⌥⌘B / botón de la cabecera): sin él, el centro toma todo el ancho.
  const { railOpen } = useWorkspace();
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

  const selectRound = (i: number) => {
    setRoundIdx(i);
    setCurrentId(null);
    setPhase("idle");
    setResult(null);
  };
  const busyPhase = phase === "recording" || phase === "analyzing";
  const hasPending = progress.some((p) => !p.best && p.scenario.id !== current?.id);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <ViewHeader
        title="Gimnasio"
        railToggle
        meta={
          today
            ? `${doneToday} ${doneToday === 1 ? "hecha" : "hechas"} hoy${today.streak ? ` · racha de ${today.streak} ${today.streak === 1 ? "día" : "días"}` : ""}`
            : undefined
        }
        // Rondas de hoy: la 1 es el plan fijo; las demás, temas nuevos.
        tabs={
          roundCount > 1 ? (
            <Segmented
              size="sm"
              ariaLabel="Rondas de hoy"
              value={String(Math.min(roundIdx, roundCount - 1))}
              onChange={(v) => selectRound(Number(v))}
              options={rounds.map((r, i) => {
                const done = planProgress(r, today?.reps ?? []).filter((p) => p.best).length;
                return {
                  value: String(i),
                  label: (
                    <>
                      Ronda {i + 1}
                      <span className="text-text-faint tabular-nums">
                        {done}/{r.length}
                      </span>
                    </>
                  ),
                };
              })}
            />
          ) : undefined
        }
        actions={
          today ? (
            <Button
              size="md"
              onClick={() => void askRound()}
              disabled={roundBusy || busyPhase}
              title="Cuatro temas nuevos de tecnología, IA e ingeniería de agentes"
              icon={
                <svg {...ICON}>
                  <path d="M12 5v14M5 12h14" />
                </svg>
              }
            >
              {roundBusy ? "Preparando temas…" : "Otra ronda"}
            </Button>
          ) : undefined
        }
      />

      <div className="grid min-h-0 flex-1 grid-cols-12 gap-3 max-lg:auto-rows-min max-lg:overflow-y-auto lg:grid-rows-[minmax(0,1fr)]">
        <ScrollArea
          fade="y"
          className={`col-span-12 min-h-0 ${railOpen ? "lg:col-span-8" : "lg:col-span-12"}`}
        >
          <div className="mx-auto flex max-w-3xl flex-col gap-7 px-1 pt-1 pb-8">
            {loadError && !today && (
              <p className="flex items-center gap-2 text-sm text-text-dim">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-red" />
                No pude cargar el gimnasio: {loadError}
              </p>
            )}

            {/* Las cuatro de la ronda */}
            {progress.length > 0 && (
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                {progress.map(({ scenario, best, attempts }) => {
                  const on = scenario.id === current?.id && !showRoundDone;
                  const extra = [
                    scenario.source === "generated" ? "Tema nuevo" : null,
                    attempts > 1 ? `${attempts} intentos` : null,
                  ].filter(Boolean);
                  return (
                    <button
                      key={scenario.id}
                      type="button"
                      onClick={() => choose(scenario.id)}
                      aria-pressed={on}
                      className={`flex min-w-0 cursor-pointer flex-col gap-2 rounded-sm border px-3 py-2.5 text-left transition-colors ${
                        on
                          ? "border-line-2 bg-selected"
                          : "border-line hover:border-line-2 hover:bg-hover"
                      }`}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <Badge size="sm">{LANG_LABEL[scenario.lang]}</Badge>
                        {best ? (
                          <span
                            className="flex items-center gap-1.5 text-xs text-text-dim tabular-nums"
                            title={`Mejor nota: ${best.score}/100`}
                          >
                            <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${scoreDot(best.score)}`} />
                            {best.score}
                          </span>
                        ) : (
                          <span className="flex items-center gap-1.5 text-xs text-text-faint">
                            <span aria-hidden className="h-1.5 w-1.5 rounded-full border border-text-faint" />
                            Pendiente
                          </span>
                        )}
                      </span>
                      <span className="line-clamp-2 text-sm leading-snug font-medium text-text">
                        {GYM_KIND_LABEL[scenario.kind]}
                      </span>
                      {extra.length > 0 && (
                        <span className="-mt-1 truncate text-xs text-text-faint">{extra.join(" · ")}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Ronda completa: la siguiente, sin límite */}
            {showRoundDone && (
              <div className="flex flex-col items-center gap-3 py-10 text-center">
                <span className="grid h-10 w-10 place-items-center rounded-full border border-line bg-panel text-green">
                  <svg {...ICON} width={18} height={18} strokeWidth={2}>
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                </span>
                <div className="flex flex-col gap-1">
                  <p className="text-md font-semibold text-text">Ronda {roundIdx + 1} completa</p>
                  <p className="text-sm text-text-dim">
                    Sigue con cuatro temas nuevos, o toca una tarjeta para repetir ese ejercicio.
                  </p>
                </div>
                <Button
                  variant="primary"
                  size="md"
                  onClick={() => void askRound()}
                  disabled={roundBusy}
                  className="mt-1"
                >
                  {roundBusy
                    ? (today?.poolReady ?? 0) >= 4
                      ? "Armando la ronda…"
                      : "Escribiendo temas nuevos… (~30 s)"
                    : "Otra ronda de IA y agentes"}
                  {!roundBusy && <Kbd onAccent>Espacio</Kbd>}
                </Button>
              </div>
            )}

            {current && !showRoundDone && (
              <section className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                  <Badge size="sm">{LANG_LABEL[current.lang]}</Badge>
                  <span className="text-text-dim">{GYM_KIND_LABEL[current.kind]}</span>
                  {current.source === "generated" && (
                    <span className="text-text-faint">· Tema nuevo</span>
                  )}
                  <span className="text-text-faint">· Foco: {habitLabel(current.focus)}</span>
                  <Button
                    variant="ghost"
                    onClick={shuffle}
                    disabled={busyPhase}
                    className="-mr-2.5 ml-auto"
                    title="Otro escenario del mismo idioma (fuera del plan de hoy)"
                    icon={
                      <svg {...ICON} width={13} height={13}>
                        <path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
                      </svg>
                    }
                  >
                    Otro escenario
                  </Button>
                </div>
                <p className="text-sm leading-relaxed text-text-dim">{current.situation}</p>
                <p className="text-2xl leading-snug font-medium text-pretty text-text">
                  {current.prompt}
                </p>
                {phase !== "feedback" && (
                  <GymReference scenario={current} open={showRef} onToggle={toggleRef} />
                )}
              </section>
            )}

            {/* Grabadora */}
            {current && phase !== "feedback" && !showRoundDone && (
              <section className="flex flex-col items-center gap-4 pt-1">
                <div className="h-12 w-full max-w-xl">
                  <LiveWaveform meterRef={rec.meterRef} active={rec.recording} />
                </div>
                {/* El global de :focus-visible redondea a 4px (va fuera de @layer):
                    `rounded-full!` mantiene el círculo con el anillo de foco. */}
                <button
                  type="button"
                  onClick={() => void toggleRecord()}
                  disabled={phase === "analyzing" || !rec.supported}
                  aria-label={rec.recording ? "Terminar y evaluar" : "Grabar respuesta"}
                  data-gym-record
                  className={`relative grid h-16 w-16 cursor-pointer place-items-center rounded-full border shadow-[var(--shadow-card)] transition-colors focus-visible:rounded-full! disabled:cursor-default disabled:opacity-50 ${
                    rec.recording
                      ? "border-red/40 bg-red/10"
                      : "border-line-2 bg-panel hover:border-accent/50 hover:bg-hover"
                  }`}
                >
                  {rec.recording && (
                    <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-red/15" />
                  )}
                  {rec.recording ? (
                    <span className="relative h-5 w-5 rounded-[5px] bg-red" />
                  ) : phase === "analyzing" ? (
                    <span className="h-5 w-5 animate-spin rounded-full border-2 border-line-2 border-t-accent" />
                  ) : (
                    <span className="h-6 w-6 rounded-full bg-accent-solid" />
                  )}
                </button>
                <p className="flex flex-wrap items-center justify-center gap-1.5 text-sm text-text-dim tabular-nums">
                  {phase === "analyzing" ? (
                    "Escuchando lo que dijiste… (~15 s)"
                  ) : rec.recording ? (
                    <>
                      <span className="text-text">{fmt(rec.elapsed)}</span>
                      <span className="text-text-faint">/ ~{fmt(current.targetSec)}</span>
                      <span className="text-text-faint">·</span>
                      <Kbd>Espacio</Kbd> para terminar
                      <span className="text-text-faint">·</span>
                      <Kbd>Esc</Kbd> descarta
                    </>
                  ) : (
                    <>
                      <Kbd>Espacio</Kbd> para hablar
                      <span className="text-text-faint">· ~{current.targetSec} s</span>
                    </>
                  )}
                </p>
                {rec.recording && rec.elapsed > current.targetSec + 15 && (
                  <p className="flex items-center gap-2 text-sm text-text-dim">
                    <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-amber" />
                    Ya pasaste el tiempo: cierra con tu punto.
                  </p>
                )}
                {(error || rec.error) && (
                  <p className="flex items-center gap-2 text-sm text-text">
                    <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-red" />
                    {error ?? rec.error}
                  </p>
                )}

                {!rec.recording && phase === "idle" && (
                  <div className="w-full max-w-xl">
                    {typing ? (
                      <div className="flex flex-col gap-2">
                        <textarea
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          rows={3}
                          placeholder={current.lang === "en" ? "Type what you'd say…" : "Escribe lo que dirías…"}
                          className="w-full resize-none rounded-sm border border-line bg-panel px-3 py-2 text-sm leading-relaxed text-text outline-none transition-colors placeholder:text-text-faint focus:border-line-2"
                        />
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" onClick={() => setTyping(false)}>
                            Cancelar
                          </Button>
                          <Button
                            variant="primary"
                            disabled={draft.trim().split(/\s+/).length < 6}
                            onClick={() => {
                              const text = draft.trim();
                              setDraft("");
                              setTyping(false);
                              void send({ text, durationSec: 0 });
                            }}
                          >
                            Evaluar
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex justify-center">
                        <Button variant="ghost" onClick={() => setTyping(true)}>
                          O escríbelo (sin micrófono)
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </section>
            )}

            {phase === "feedback" && result && (
              <section className="flex flex-col gap-6 border-t border-line pt-6">
                <GymFeedback rep={result} previous={previousOf(result)} />
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="primary"
                    size="md"
                    onClick={retry}
                    icon={
                      <svg {...ICON}>
                        <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
                        <path d="M3 3v5h5" />
                      </svg>
                    }
                  >
                    Otra vez <Kbd onAccent>R</Kbd>
                  </Button>
                  <Button size="md" onClick={next}>
                    {hasPending
                      ? "Siguiente"
                      : roundIdx < roundCount - 1
                        ? "Siguiente ronda"
                        : "Otra ronda"}{" "}
                    <Kbd>N</Kbd>
                  </Button>
                </div>
              </section>
            )}
          </div>
        </ScrollArea>

        <aside
          aria-label="Progreso"
          className={`col-span-12 flex min-h-0 flex-col border-line lg:col-span-4 lg:border-l lg:pl-4${railOpen ? "" : " lg:hidden"}`}
        >
          {/* -mt-3 pt-3: el fade superior del ScrollArea cae sobre el aire, no
              sobre la primera etiqueta. */}
          <ScrollArea rail fade="y" className="-mt-3 min-h-0 flex-1 pt-3 pr-1">
            <div className="flex min-h-full flex-col gap-7 pb-3">
              <RailSection label="Racha">
                <div className="flex flex-col gap-1 px-2">
                  <p className="text-2xl leading-none font-semibold text-text tabular-nums">
                    {today?.streak ?? 0}{" "}
                    <span className="text-sm font-normal text-text-faint">
                      {today?.streak === 1 ? "día" : "días"}
                    </span>
                  </p>
                  <p className="text-xs leading-relaxed text-text-faint">
                    Un día cuenta con al menos una en español y una en inglés.
                  </p>
                </div>
              </RailSection>

              {/* Una sola lista: el hábito, qué significa y tu nota media por
                  idioma. Antes eran dos secciones con los mismos cinco nombres. */}
              <RailSection
                label="Hábitos · 14 días"
                right={
                  <span className="grid grid-cols-[2.25rem_2.25rem] gap-1 pr-2 text-right text-2xs text-text-faint">
                    <span>ES</span>
                    <span>EN</span>
                  </span>
                }
              >
                <div className="flex flex-col gap-px">
                  {GYM_HABITS.map((h) => {
                    const weak = h.key === weakest;
                    return (
                      <div
                        key={h.key}
                        className="grid grid-cols-[minmax(0,1fr)_2.25rem_2.25rem] items-baseline gap-1 rounded-sm px-2 py-1.5"
                      >
                        <span className="min-w-0">
                          <span className="flex items-center gap-1.5 text-sm text-text">
                            {h.label}
                            {weak && (
                              <span
                                aria-label="Tu hábito más flojo"
                                className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber"
                              />
                            )}
                          </span>
                          <span className="mt-px block text-xs leading-snug text-text-faint">
                            {h.hint}
                          </span>
                        </span>
                        <span className="text-right text-sm text-text-dim tabular-nums">
                          {avgEs[h.key] ?? "—"}
                        </span>
                        <span className="text-right text-sm text-text-dim tabular-nums">
                          {avgEn[h.key] ?? "—"}
                        </span>
                      </div>
                    );
                  })}
                  {recent.length === 0 ? (
                    <p className="px-2 pt-1 text-xs text-text-faint">
                      Aún no hay repeticiones: la primera nota sale de tu primera respuesta.
                    </p>
                  ) : (
                    weakest && (
                      <p className="flex items-center gap-1.5 px-2 pt-1.5 text-xs text-text-dim">
                        <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber" />
                        Hoy trabaja <span className="font-medium text-text">{habitLabel(weakest)}</span>
                      </p>
                    )
                  )}
                </div>
              </RailSection>

              {days.length > 0 && (
                <RailSection label="Últimos días">
                  <div className="flex flex-col gap-px">
                    {days.map((d) => (
                      <RailRow
                        key={d.date}
                        title={fmtGymDay(d.date)}
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
