"use client";

// Lección de REGLA: primero la regla (por qué esta unidad, la regla en cinco
// líneas, frases modelo para escuchar), luego el quiz estilo Duolingo — una
// pregunta a la vez, barra de progreso arriba, dos opciones grandes y la
// explicación al instante. Las preguntas son TUS errores reales de este patrón
// (con la clase de donde salió cada uno); si no alcanzan, ejemplos del temario.
//
// Teclado: 1 / 2 eligen · Enter sigue.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LESSON_XP,
  PASS_SCORE,
  REPEAT_XP,
  rightFirst,
  type EnglishPlanPayload,
  type PlanUnit,
  type QuizItem,
} from "@hermes/shared";
import { Button } from "@/components/ui/Button";
import { Kbd } from "@/components/ui/Kbd";
import { SpeakerIcon, speak } from "@/components/gym/GymFeedback";
import type { PlanSubmit } from "@/hooks/useEnglishPlan";

type Phase = "rule" | "quiz" | "sending" | "done";

function ProgressBar({ value, total }: { value: number; total: number }) {
  return (
    <div className="flex gap-1" role="progressbar" aria-valuenow={value} aria-valuemax={total}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={`h-1.5 flex-1 rounded-full ${i < value ? "bg-accent" : "bg-hover"}`} />
      ))}
    </div>
  );
}

export function RuleSheet({ unit, plan }: { unit: PlanUnit; plan: EnglishPlanPayload }) {
  const reach = plan.reach[unit.key];
  return (
    <div className="flex flex-col gap-6">
      <section>
        <h3 className="text-xs font-medium text-text-faint">Por qué esta unidad</h3>
        <p className="mt-1.5 text-md leading-relaxed text-text">{unit.why}</p>
        {unit.measured && reach > 0 && (
          <p className="mt-1.5 text-sm text-text-dim">
            Apareció en {reach} de tus {plan.sessionsCount} sesiones registradas.
          </p>
        )}
      </section>
      <section>
        <h3 className="text-xs font-medium text-text-faint">La regla</h3>
        <ul className="mt-2 flex flex-col gap-2">
          {unit.rule.map((r) => (
            <li key={r} className="flex gap-2.5 text-sm leading-relaxed text-text">
              <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-text-faint" />
              {r}
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3 className="text-xs font-medium text-text-faint">Dilo en voz alta</h3>
        <ul className="mt-2 flex flex-col gap-1">
          {unit.models.map((m) => (
            <li key={m}>
              <button
                type="button"
                onClick={() => speak(m, "en")}
                className="flex w-full cursor-pointer items-start gap-2.5 rounded-sm px-2 py-1.5 text-left text-sm text-text transition-colors hover:bg-hover"
              >
                <span className="mt-0.5 text-text-faint">
                  <SpeakerIcon />
                </span>
                {m}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Option({
  n,
  text,
  state,
  onPick,
  disabled,
}: {
  n: number;
  text: string;
  state: "idle" | "right" | "wrong" | "dim";
  onPick: () => void;
  disabled: boolean;
}) {
  const tone =
    state === "right"
      ? "border-green bg-green/10"
      : state === "wrong"
        ? "border-red bg-red/10"
        : state === "dim"
          ? "border-line opacity-60"
          : "border-line hover:border-line-2 hover:bg-hover";
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={disabled}
      className={`flex w-full cursor-pointer items-start gap-3 rounded-md border px-4 py-3.5 text-left transition-colors disabled:cursor-default ${tone}`}
    >
      <Kbd className="mt-0.5">{String(n)}</Kbd>
      <span className="text-md leading-snug text-text">{text}</span>
    </button>
  );
}

export function QuizLesson({
  lessonId,
  unit,
  plan,
  alreadyDone,
  active,
  onSubmit,
  onExit,
  onNext,
}: {
  lessonId: string;
  unit: PlanUnit;
  plan: EnglishPlanPayload;
  alreadyDone: boolean;
  active: boolean;
  onSubmit: (lessonId: string, correct: number, total: number) => Promise<PlanSubmit>;
  onExit: () => void;
  onNext: () => void;
}) {
  const items: QuizItem[] = useMemo(() => plan.quizzes[unit.key] ?? [], [plan.quizzes, unit.key]);
  // Las preguntas se congelan al empezar: un refresh del plan a mitad del quiz
  // no debe cambiarlas.
  const frozen = useRef<QuizItem[]>(items);
  const [phase, setPhase] = useState<Phase>("rule");
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState<"right" | "wrong" | null>(null);
  const [correct, setCorrect] = useState(0);
  const [result, setResult] = useState<{ score: number; passed: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const list = phase === "rule" ? items : frozen.current;
  const item = list[idx];
  const order = item ? (rightFirst(item) ? (["right", "wrong"] as const) : (["wrong", "right"] as const)) : [];

  const start = () => {
    frozen.current = items;
    setIdx(0);
    setCorrect(0);
    setPicked(null);
    setResult(null);
    setError(null);
    setPhase("quiz");
  };

  const pick = useCallback(
    (which: "right" | "wrong") => {
      if (phase !== "quiz" || picked) return;
      setPicked(which);
      if (which === "right") setCorrect((c) => c + 1);
      if (which === "right" && item) speak(item.right, "en");
    },
    [phase, picked, item],
  );

  const advance = useCallback(async () => {
    if (phase !== "quiz" || !picked) return;
    if (idx + 1 < frozen.current.length) {
      setIdx(idx + 1);
      setPicked(null);
      return;
    }
    setPhase("sending");
    const total = frozen.current.length;
    const r = await onSubmit(lessonId, correct, total);
    if (r.ok) {
      setResult({ score: r.attempt.score, passed: r.attempt.passed });
      setPhase("done");
    } else {
      setError(r.error);
      setPhase("quiz");
    }
  }, [phase, picked, idx, correct, lessonId, onSubmit]);

  const keys = useRef({ pick, advance, order, phase, start });
  keys.current = { pick, advance, order, phase, start };
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = keys.current;
      if (k.phase === "quiz" && (e.key === "1" || e.key === "2")) {
        e.preventDefault();
        k.pick(k.order[Number(e.key) - 1]);
      } else if (e.key === "Enter" && k.phase === "quiz") {
        e.preventDefault();
        void k.advance();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  if (phase === "rule")
    return (
      <div className="flex flex-col gap-8">
        <RuleSheet unit={unit} plan={plan} />
        <div className="flex items-center gap-3 border-t border-line pt-5">
          <Button variant="primary" size="md" onClick={start} disabled={!items.length}>
            Empezar el quiz · {items.length} preguntas
          </Button>
          <span className="text-sm text-text-faint">
            {items.filter((q) => q.source).length} salen de tus sesiones
          </span>
        </div>
      </div>
    );

  if (phase === "done" && result) {
    const xp = result.passed ? (alreadyDone ? REPEAT_XP : LESSON_XP.regla) : 0;
    return (
      <div className="flex flex-col items-start gap-5 py-6">
        <span className={`h-3 w-3 rounded-full ${result.passed ? "bg-green" : "bg-amber"}`} aria-hidden />
        <div>
          <p className="text-3xl font-medium text-text">
            {correct} de {frozen.current.length}
          </p>
          <p className="mt-1 text-md text-text-dim">
            {result.passed
              ? `Aprobada${xp ? ` · +${xp} XP` : ""}. Lo siguiente es decirlo en voz alta.`
              : `Te faltó poco: se aprueba con ${PASS_SCORE.regla} %. Repasa la regla y vuelve a intentarlo.`}
          </p>
        </div>
        <div className="flex gap-2">
          {result.passed ? (
            <Button variant="primary" size="md" onClick={onNext}>
              Siguiente lección
            </Button>
          ) : (
            <Button variant="primary" size="md" onClick={() => setPhase("rule")}>
              Ver la regla otra vez
            </Button>
          )}
          <Button size="md" onClick={start}>
            Repetir
          </Button>
          <Button variant="ghost" size="md" onClick={onExit}>
            Volver al plan
          </Button>
        </div>
      </div>
    );
  }

  if (!item) return null;
  return (
    <div className="flex flex-col gap-6">
      <ProgressBar value={idx + (picked ? 1 : 0)} total={frozen.current.length} />
      <div>
        <p className="text-sm text-text-dim">¿Cuál suena bien?</p>
        {item.source && <p className="mt-0.5 text-xs text-text-faint">Lo dijiste en: {item.source}</p>}
      </div>
      <div className="flex flex-col gap-2.5">
        {order.map((which, i) => (
          <Option
            key={which}
            n={i + 1}
            text={which === "right" ? item.right : item.wrong}
            disabled={!!picked || phase !== "quiz"}
            onPick={() => pick(which)}
            state={
              !picked ? "idle" : which === "right" ? "right" : picked === "wrong" ? "wrong" : "dim"
            }
          />
        ))}
      </div>
      {picked && (
        <div className="flex flex-wrap items-start justify-between gap-4 border-t border-line pt-4">
          <div className="min-w-0 flex-1">
            <p className={`text-sm font-medium ${picked === "right" ? "text-green" : "text-red"}`}>
              {picked === "right" ? "Bien dicho" : "Esa era la frase con el error"}
            </p>
            {item.why && <p className="mt-1 text-sm leading-relaxed text-text-dim">{item.why}</p>}
          </div>
          <Button variant="primary" size="md" onClick={() => void advance()} disabled={phase !== "quiz"}>
            {idx + 1 < frozen.current.length ? "Seguir" : phase === "sending" ? "Guardando…" : "Terminar"}
            <Kbd className="ml-2 border-transparent bg-transparent text-on-accent/80">↵</Kbd>
          </Button>
        </div>
      )}
      {error && <p className="text-sm text-red">{error}</p>}
    </div>
  );
}
