"use client";

// La RUTA del plan: ocho unidades, cinco lecciones cada una, en zigzag como en
// Duolingo. Matiz no tiene la ruta de Duolingo (su corpus es de sitios de
// marketing y la app exige login), así que el patrón sale de dos lados: el
// zigzag y la "lección actual = el nodo lleno" de la app que todos conocen, y
// del timeline vertical de inngest.com (#5 en Matiz) la cabecera de cada tramo
// pegada a su bloque, con el estado a la derecha.
//
// Color con significado (reglas v5): la lección actual es lo único en acento
// (es lo que se toca), lo hecho va en verde (estado), lo cerrado en gris. El
// detalle de una lección se abre DEBAJO de su nodo, no en un modal: la ruta
// sigue a la vista y se ve qué viene después.

import { useEffect, useRef } from "react";
import {
  PASS_SCORE,
  PLAN_UNITS,
  TUTOR_MIN_SEC,
  type EnglishPlanPayload,
  type LessonView,
  type PatternPoint,
  type PlanUnit,
  type UnitView,
} from "@hermes/shared";
import { Button } from "@/components/ui/Button";
import { CheckIcon, KIND_LABEL, KindIcon, LockIcon } from "./icons";

/** Desplazamiento horizontal de cada nodo (px): el zigzag, espejado por unidad. */
const OFFSETS = [0, 44, 64, 44, 0];

function lessonBlurb(l: LessonView, unit: PlanUnit): string {
  switch (l.lesson.kind) {
    case "regla":
      return `Lee la regla con ejemplos y elige la frase correcta entre tus propios errores. Apruebas con ${PASS_SCORE.regla} %.`;
    case "gimnasio":
      return `${l.lesson.drill!.situation} Respondes en voz alta y te evalúa el patrón. Apruebas con ${PASS_SCORE.gimnasio}.`;
    case "tutora":
      return `Conversación de voz con la tutora, unos 5 minutos, enfocada solo en «${unit.title.toLowerCase()}». Cuenta al colgar si duró ${TUTOR_MIN_SEC / 60} minutos o más.`;
    case "prueba":
      return `Una respuesta larga que exige el patrón de principio a fin. Apruebas con ${PASS_SCORE.prueba} y la unidad queda dominada.`;
  }
}

function NodeButton({
  view,
  selected,
  onClick,
}: {
  view: LessonView;
  selected: boolean;
  onClick: () => void;
}) {
  const { status, lesson } = view;
  const tone =
    status === "current"
      ? "bg-accent-solid text-on-accent ring-4 ring-accent/20"
      : status === "done"
        ? "bg-green/15 text-green border border-green/35"
        : status === "skipped"
          ? "bg-green/8 text-green/80 border border-dashed border-green/35"
          : status === "available"
            ? "bg-panel text-text-dim border border-line hover:border-line-2 hover:text-text"
            : "bg-hover text-text-faint";
  const icon =
    status === "done" || status === "skipped" ? (
      <CheckIcon />
    ) : status === "locked" ? (
      <LockIcon />
    ) : (
      <KindIcon kind={lesson.kind} />
    );
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      aria-label={`${KIND_LABEL[lesson.kind]}: ${statusLabel(view)}`}
      className={`relative flex h-16 w-16 cursor-pointer items-center justify-center rounded-full transition-[box-shadow,border-color,color] ${tone} ${
        selected && status !== "current" ? "outline-2 outline-offset-4 outline-accent" : ""
      }`}
    >
      {icon}
    </button>
  );
}

function statusLabel(v: LessonView): string {
  switch (v.status) {
    case "done":
      return v.best != null ? `hecha · ${v.best}` : "hecha";
    case "skipped":
      return "saltada con la prueba";
    case "current":
      return "toca ahora";
    case "available":
      return v.lesson.kind === "prueba" ? "saltar aquí" : "abierta";
    case "locked":
      return "cerrada";
  }
}

function LessonCard({
  view,
  unit,
  onStart,
}: {
  view: LessonView;
  unit: PlanUnit;
  onStart: () => void;
}) {
  const locked = view.status === "locked";
  const jump = view.status === "available" && view.lesson.kind === "prueba";
  return (
    <div className="w-full max-w-sm rounded-md border border-line bg-panel p-4">
      <p className="text-xs text-text-faint">
        {KIND_LABEL[view.lesson.kind]}
        {view.attempts > 0 && ` · ${view.attempts} ${view.attempts === 1 ? "intento" : "intentos"}`}
        {view.best != null && ` · mejor ${view.best}`}
      </p>
      <h3 className="mt-0.5 text-md font-medium text-text">
        {view.lesson.drill ? `«${view.lesson.drill.prompt}»` : view.lesson.title}
      </h3>
      <p className="mt-1.5 text-sm leading-relaxed text-text-dim">{lessonBlurb(view, unit)}</p>
      {jump && (
        <p className="mt-2 text-sm text-text-dim">
          ¿Ya lo dominas? Si pasas la prueba ahora, la unidad entera queda hecha.
        </p>
      )}
      <div className="mt-3 flex items-center gap-2">
        {locked ? (
          <p className="text-sm text-text-faint">Se abre al terminar la lección anterior.</p>
        ) : (
          <Button
            variant={view.status === "current" ? "primary" : "secondary"}
            size="md"
            onClick={onStart}
            autoFocus
          >
            {view.status === "done" || view.status === "skipped"
              ? "Repetir"
              : jump
                ? "Saltar con la prueba"
                : "Empezar"}
          </Button>
        )}
      </div>
    </div>
  );
}

/** Errores del patrón en tus últimas clases: barras grises, el número de la última. */
export function TrendBars({ points, className = "" }: { points: PatternPoint[]; className?: string }) {
  const max = Math.max(1, ...points.map((p) => p.count));
  return (
    <span className={`inline-flex items-end gap-0.5 ${className}`} aria-hidden>
      {points.map((p) => (
        <span
          key={p.sessionId}
          className="w-1.5 rounded-[1px] bg-text-faint/60"
          style={{ height: `${Math.max(2, (p.count / max) * 16)}px` }}
        />
      ))}
    </span>
  );
}

export function trendWord(points: PatternPoint[]): { label: string; tone: "good" | "bad" | "flat" } | null {
  if (points.length < 2) return null;
  const first = points[0].count;
  const last = points[points.length - 1].count;
  if (last < first) return { label: "baja", tone: "good" };
  if (last > first) return { label: "sube", tone: "bad" };
  return { label: "igual", tone: "flat" };
}

function UnitHeader({ index, unit, view, plan }: { index: number; unit: PlanUnit; view: UnitView; plan: EnglishPlanPayload }) {
  const points = plan.trend[unit.key];
  const last = points.at(-1);
  return (
    <header className="flex items-start justify-between gap-6 border-b border-line pb-3">
      <div className="min-w-0">
        <p className="text-xs text-text-faint">
          Unidad {index + 1}
          {view.mastered ? " · dominada" : ` · ${view.done} de 5`}
        </p>
        <h2 className="mt-0.5 text-lg font-medium text-text">{unit.title}</h2>
        <p className="mt-0.5 text-sm text-text-dim">{unit.subtitle}</p>
      </div>
      <div className="shrink-0 pt-1 text-right" title="Errores de este patrón que anotó el corrector en tus últimas clases (solo las clases con audio)">
        {unit.measured && last ? (
          <>
            <TrendBars points={points} />
            <p className="mt-1 text-xs text-text-faint">
              {last.count} en la última clase
            </p>
          </>
        ) : unit.measured ? (
          <p className="text-xs text-text-faint">Sin clases medidas</p>
        ) : (
          <p className="text-xs text-text-faint">Se mide en entrevistas</p>
        )}
      </div>
    </header>
  );
}

export function PlanPath({
  plan,
  selectedId,
  onSelect,
  onStart,
}: {
  plan: EnglishPlanPayload;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onStart: (id: string) => void;
}) {
  const currentRef = useRef<HTMLLIElement | null>(null);
  // Al abrir la ruta, la lección que toca queda a la vista (sin animación:
  // es el punto de partida, no un salto).
  const scrolled = useRef(false);
  useEffect(() => {
    if (scrolled.current || !currentRef.current) return;
    scrolled.current = true;
    currentRef.current.scrollIntoView({ block: "center" });
  }, [plan.current]);

  return (
    <div className="flex flex-col gap-12 pb-10">
      {plan.units.map((view, ui) => {
        const unit = PLAN_UNITS.find((u) => u.key === view.key)!;
        const flip = ui % 2 === 1 ? -1 : 1;
        return (
          <section key={view.key} aria-label={`Unidad ${ui + 1}: ${unit.title}`} className="flex flex-col gap-6">
            <UnitHeader index={ui} unit={unit} view={view} plan={plan} />
            <ol className="flex flex-col items-center gap-4">
              {view.lessons.map((l, li) => {
                const selected = selectedId === l.lesson.id;
                return (
                  <li
                    key={l.lesson.id}
                    ref={l.status === "current" ? currentRef : undefined}
                    className="flex w-full flex-col items-center gap-3"
                  >
                    <div
                      className="flex flex-col items-center gap-1.5"
                      style={{ transform: `translateX(${OFFSETS[li] * flip}px)` }}
                    >
                      <NodeButton view={l} selected={selected} onClick={() => onSelect(l.lesson.id)} />
                      <span
                        className={`text-xs ${l.status === "current" ? "font-medium text-text" : "text-text-faint"}`}
                      >
                        {KIND_LABEL[l.lesson.kind]}
                        {l.status === "done" && l.best != null && l.lesson.kind !== "tutora" ? ` · ${l.best}` : ""}
                      </span>
                    </div>
                    {selected && <LessonCard view={l} unit={unit} onStart={() => onStart(l.lesson.id)} />}
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}
    </div>
  );
}
