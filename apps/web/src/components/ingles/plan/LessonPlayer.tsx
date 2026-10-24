"use client";

// La lección abierta, a todo el lienzo: una columna de lectura (como la
// lección de Duolingo, que ocupa la pantalla), con la unidad y el tipo arriba.
// Esc vuelve a la ruta (salvo mientras graba: ahí Esc descarta la toma).

import { useEffect } from "react";
import { planLesson, planUnit, PLAN_UNITS, type EnglishPlanPayload } from "@hermes/shared";
import { ScrollArea } from "@/components/ui/ScrollArea";
import type { PlanSubmit } from "@/hooks/useEnglishPlan";
import { KIND_LABEL, KindIcon } from "./icons";
import { QuizLesson } from "./QuizLesson";
import { DrillLesson } from "./DrillLesson";
import { TutorLesson } from "./TutorLesson";

export function LessonPlayer({
  lessonId,
  plan,
  active,
  submitQuiz,
  submitDrill,
  onExit,
  onOpen,
  tutor,
}: {
  lessonId: string;
  plan: EnglishPlanPayload;
  active: boolean;
  submitQuiz: (lessonId: string, correct: number, total: number) => Promise<PlanSubmit>;
  submitDrill: (input: { lessonId: string; durationSec: number; blob?: Blob; text?: string }) => Promise<PlanSubmit>;
  onExit: () => void;
  onOpen: (id: string) => void;
  tutor: { canCall: boolean; blocked: string | null; call: (lessonId: string) => void; cancel: () => void };
}) {
  const lesson = planLesson(lessonId);
  const unit = lesson ? planUnit(lesson.unit) : undefined;
  const view = plan.units.flatMap((u) => u.lessons).find((l) => l.lesson.id === lessonId);
  const alreadyDone = view?.status === "done";
  const unitIndex = unit ? PLAN_UNITS.findIndex((u) => u.key === unit.key) : -1;

  // Siguiente = la que toca en la ruta (puede ser de otra unidad).
  const next = () => {
    const id = plan.current;
    if (id && id !== lessonId) onOpen(id);
    else onExit();
  };

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (e.key === "Escape") onExit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, onExit]);

  if (!lesson || !unit) return null;
  return (
    <ScrollArea fade="y" className="min-h-0 flex-1">
      <article className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-1 pt-2 pb-12">
        <header className="flex items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-hover text-text-dim">
            <KindIcon kind={lesson.kind} size={18} />
          </span>
          <div className="min-w-0">
            <p className="text-xs text-text-faint">
              Unidad {unitIndex + 1} · {KIND_LABEL[lesson.kind]}
            </p>
            <h2 className="truncate text-md font-medium text-text">{unit.title}</h2>
          </div>
        </header>
        {lesson.kind === "regla" ? (
          <QuizLesson
            key={lessonId}
            lessonId={lessonId}
            unit={unit}
            plan={plan}
            alreadyDone={alreadyDone}
            active={active}
            onSubmit={submitQuiz}
            onExit={onExit}
            onNext={next}
          />
        ) : lesson.kind === "tutora" ? (
          <TutorLesson
            lesson={lesson}
            unit={unit}
            plan={plan}
            canCall={tutor.canCall}
            callBlocked={tutor.blocked}
            onCall={() => tutor.call(lessonId)}
            onCancel={tutor.cancel}
            onNext={next}
            onExit={onExit}
          />
        ) : (
          <DrillLesson
            key={lessonId}
            lesson={lesson}
            unit={unit}
            plan={plan}
            alreadyDone={alreadyDone}
            active={active}
            onSubmit={submitDrill}
            onExit={onExit}
            onNext={next}
          />
        )}
      </article>
    </ScrollArea>
  );
}
