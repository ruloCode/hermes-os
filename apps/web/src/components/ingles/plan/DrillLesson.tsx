"use client";

// Lección hablada (gimnasio y prueba): la pregunta en inglés en grande, las
// estructuras que tienes que usar, y la misma grabadora del gimnasio de
// articulación (Espacio graba y envía). La devolución pone primero lo que
// decide si pasas — la nota del PATRÓN de la unidad — y después cómo decirlo
// mejor, para escucharlo y repetirlo.
//
// Teclado: Espacio graba/envía · R otra vez · N siguiente · Esc descarta.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  LESSON_XP,
  PASS_SCORE,
  REPEAT_XP,
  type PlanAttempt,
  type PlanLesson,
  type PlanUnit,
} from "@hermes/shared";
import { Button } from "@/components/ui/Button";
import { Kbd } from "@/components/ui/Kbd";
import { LiveWaveform } from "@/components/estudio/audio/Waveform";
import { SpeakerIcon, speak } from "@/components/gym/GymFeedback";
import { useMediaRecorder } from "@/hooks/useMediaRecorder";
import type { PlanSubmit } from "@/hooks/useEnglishPlan";
import { RuleSheet } from "./QuizLesson";
import type { EnglishPlanPayload } from "@hermes/shared";

type Phase = "idle" | "recording" | "analyzing" | "feedback";

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

function Feedback({ attempt, lesson, alreadyDone }: { attempt: PlanAttempt; lesson: PlanLesson; alreadyDone: boolean }) {
  const d = attempt.drill!;
  const used = new Set(d.targetsUsed);
  const pass = PASS_SCORE[lesson.kind];
  const xp = attempt.passed ? (alreadyDone ? REPEAT_XP : LESSON_XP[lesson.kind]) : 0;
  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="flex items-center gap-2.5 self-center">
          <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${attempt.passed ? "bg-green" : "bg-amber"}`} />
          <span className="text-4xl font-medium text-text">{attempt.score}</span>
        </span>
        <span className="text-md text-text-dim">
          {attempt.passed ? `Aprobada${xp ? ` · +${xp} XP` : ""}` : `Se aprueba con ${pass}`}
          {" · "}
          {mmss(d.durationSec)} · {d.words} palabras
        </span>
      </div>

      <section>
        <h3 className="text-xs font-medium text-text-faint">Estructuras</h3>
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {lesson.drill!.targets.map((t) => (
            <li
              key={t}
              className={`rounded-sm border px-2 py-0.5 text-sm ${
                used.has(t) ? "border-green/40 bg-green/10 text-text" : "border-line text-text-faint"
              }`}
            >
              {used.has(t) ? "✓ " : ""}
              {t}
            </li>
          ))}
        </ul>
      </section>

      {d.errors.length > 0 && (
        <section>
          <h3 className="text-xs font-medium text-text-faint">Lo que se te escapó</h3>
          <ul className="mt-2 flex flex-col gap-3">
            {d.errors.map((e, i) => (
              <li key={i} className="text-sm leading-relaxed">
                <span className="text-text-dim line-through decoration-red/60">{e.quote}</span>
                <span className="text-text-faint"> → </span>
                <span className="text-text">{e.correction}</span>
                {e.note_es && <span className="block text-text-faint">{e.note_es}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-md border border-line bg-panel p-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-xs font-medium text-text-faint">Dilo así</h3>
          <Button variant="ghost" size="xs" icon={<SpeakerIcon />} onClick={() => speak(d.better, "en")}>
            Escuchar
          </Button>
        </div>
        <p className="mt-1.5 text-md leading-relaxed text-text">{d.better}</p>
        {d.tip && <p className="mt-3 text-sm text-text-dim">Para el siguiente intento: {d.tip}</p>}
      </section>

      <details className="text-sm">
        <summary className="cursor-pointer text-text-faint hover:text-text-dim">Lo que te escuché</summary>
        <p className="mt-2 leading-relaxed text-text-dim">{d.transcript}</p>
      </details>
    </div>
  );
}

export function DrillLesson({
  lesson,
  unit,
  plan,
  alreadyDone,
  active,
  onSubmit,
  onExit,
  onNext,
}: {
  lesson: PlanLesson;
  unit: PlanUnit;
  plan: EnglishPlanPayload;
  alreadyDone: boolean;
  active: boolean;
  onSubmit: (input: { lessonId: string; durationSec: number; blob?: Blob; text?: string }) => Promise<PlanSubmit>;
  onExit: () => void;
  onNext: () => void;
}) {
  const drill = lesson.drill!;
  const rec = useMediaRecorder({ meter: true });
  const [phase, setPhase] = useState<Phase>("idle");
  const [attempt, setAttempt] = useState<PlanAttempt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState("");
  const [showRule, setShowRule] = useState(false);

  const send = useCallback(
    async (input: { blob?: Blob; text?: string; durationSec: number }) => {
      setPhase("analyzing");
      setError(null);
      const r = await onSubmit({ lessonId: lesson.id, ...input });
      if (r.ok) {
        setAttempt(r.attempt);
        setPhase("feedback");
      } else {
        setError(r.error);
        setPhase("idle");
      }
    },
    [lesson.id, onSubmit],
  );

  const toggleRecord = useCallback(async () => {
    if (phase === "analyzing" || phase === "feedback" || typing) return;
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
    if (await rec.start()) setPhase("recording");
  }, [phase, typing, rec, send]);

  const retry = useCallback(() => {
    setPhase("idle");
    setAttempt(null);
    setError(null);
  }, []);

  const keyRef = useRef({ toggleRecord, retry, onNext, phase, attempt });
  keyRef.current = { toggleRecord, retry, onNext, phase, attempt };
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // Un botón con foco se quedaría con el Espacio del navegador y lo pulsaría
      // otra vez: aquí Espacio es grabar (salvo sobre el propio botón de grabar).
      if (t?.tagName === "BUTTON") {
        if (e.code !== "Space" || t.dataset.planRecord != null) return;
        t.blur();
      }
      const k = keyRef.current;
      if (e.code === "Space" && k.phase !== "feedback") {
        e.preventDefault();
        void k.toggleRecord();
      } else if (e.key === "r" && k.phase === "feedback") k.retry();
      else if (e.key === "n" && k.phase === "feedback" && k.attempt?.passed) k.onNext();
      else if (e.key === "Escape" && k.phase === "recording") {
        e.stopPropagation();
        rec.cancel();
        setPhase("idle");
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [active, rec]);

  // Salir con el micrófono abierto = descartar (no grabar a escondidas).
  useEffect(() => {
    if (!active && rec.recording) {
      rec.cancel();
      setPhase("idle");
    }
  }, [active, rec]);

  const isTest = lesson.kind === "prueba";

  return (
    <div className="flex flex-col gap-7">
      <section>
        <p className="text-sm text-text-dim">{drill.situation}</p>
        <div className="mt-3 flex items-start gap-3">
          <p className="min-w-0 flex-1 text-2xl leading-snug font-medium text-text">{drill.prompt}</p>
          <Button
            variant="ghost"
            size="sm"
            icon={<SpeakerIcon />}
            onClick={() => speak(drill.prompt, "en")}
            aria-label="Escuchar la pregunta"
          />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-text-faint">Usa</span>
          {drill.targets.map((t) => (
            <span key={t} className="rounded-sm bg-hover px-2 py-0.5 text-sm text-text">
              {t}
            </span>
          ))}
          <span className="ml-1 text-xs text-text-faint">· ~{drill.targetSec} s</span>
        </div>
        {phase !== "feedback" && (
          <button
            type="button"
            onClick={() => setShowRule((v) => !v)}
            className="mt-3 cursor-pointer text-sm text-text-faint hover:text-text-dim"
          >
            {showRule ? "Ocultar la regla" : "Ver la regla"}
          </button>
        )}
        {showRule && phase !== "feedback" && (
          <div className="mt-4 border-l border-line pl-4">
            <RuleSheet unit={unit} plan={plan} />
          </div>
        )}
      </section>

      {phase === "feedback" && attempt ? (
        <>
          <Feedback attempt={attempt} lesson={lesson} alreadyDone={alreadyDone} />
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-5">
            {attempt.passed ? (
              <Button variant="primary" size="md" onClick={onNext}>
                Siguiente lección <Kbd className="ml-2 border-transparent bg-transparent text-on-accent/80">N</Kbd>
              </Button>
            ) : null}
            <Button variant={attempt.passed ? "secondary" : "primary"} size="md" onClick={retry}>
              Otra vez <Kbd className="ml-2">R</Kbd>
            </Button>
            <Button variant="ghost" size="md" onClick={onExit}>
              Volver al plan
            </Button>
          </div>
        </>
      ) : typing ? (
        <section className="flex flex-col gap-3">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={5}
            placeholder="Escribe tu respuesta en inglés…"
            className="w-full resize-none rounded-md border border-line bg-panel px-3 py-2.5 text-md text-text placeholder:text-text-faint"
          />
          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              size="md"
              disabled={phase === "analyzing" || draft.trim().split(/\s+/).length < 8}
              onClick={() => void send({ text: draft.trim(), durationSec: 0 })}
            >
              {phase === "analyzing" ? "Evaluando…" : "Evaluar"}
            </Button>
            <Button variant="ghost" size="md" onClick={() => setTyping(false)}>
              Mejor hablar
            </Button>
          </div>
        </section>
      ) : (
        <section className="flex flex-col items-center gap-4 pt-2">
          <div className="h-12 w-full max-w-xl">
            <LiveWaveform meterRef={rec.meterRef} active={rec.recording} />
          </div>
          <button
            type="button"
            onClick={() => void toggleRecord()}
            disabled={phase === "analyzing" || !rec.supported}
            aria-label={rec.recording ? "Terminar y evaluar" : "Grabar respuesta"}
            data-plan-record
            className={`relative grid h-16 w-16 cursor-pointer place-items-center rounded-full border transition-colors focus-visible:rounded-full! disabled:cursor-default disabled:opacity-50 ${
              rec.recording ? "border-red/40 bg-red/10" : "border-line-2 bg-panel hover:border-accent/50 hover:bg-hover"
            }`}
          >
            {rec.recording && <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-red/15" />}
            <span
              aria-hidden
              className={rec.recording ? "h-5 w-5 rounded-xs bg-red" : "h-5 w-5 rounded-full bg-red"}
            />
          </button>
          <p className="text-sm text-text-dim" aria-live="polite">
            {phase === "analyzing"
              ? "Escuchando lo que dijiste y evaluando…"
              : rec.recording
                ? `${mmss(rec.elapsed)} / ~${mmss(drill.targetSec)} · Espacio para terminar`
                : isTest
                  ? "Prueba de la unidad: apruebas con 80. Espacio para grabar."
                  : "Espacio para grabar"}
          </p>
          {phase === "idle" && (
            <button
              type="button"
              onClick={() => setTyping(true)}
              className="cursor-pointer text-sm text-text-faint hover:text-text-dim"
            >
              No puedo hablar ahora: escribir
            </button>
          )}
        </section>
      )}

      {(error || rec.error) && <p className="text-sm text-red">{error ?? rec.error}</p>}
    </div>
  );
}
