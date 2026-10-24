"use client";

// Lección de VOZ con la tutora: no tiene un "enviar". Se abre la llamada en
// modo lección (la tutora recibe la unidad, la regla y tus errores reales de
// ese patrón, y arranca sola), y la lección se cierra cuando la tutora guarda
// la práctica al colgar — si duró 3 minutos o más. Mientras tanto la pantalla
// de /ingles es la práctica en vivo de siempre.

import { TUTOR_MIN_SEC, type EnglishPlanPayload, type PlanLesson, type PlanUnit } from "@hermes/shared";
import { Button } from "@/components/ui/Button";

export function TutorLesson({
  lesson,
  unit,
  plan,
  canCall,
  callBlocked,
  onCall,
  onCancel,
  onNext,
  onExit,
}: {
  lesson: PlanLesson;
  unit: PlanUnit;
  plan: EnglishPlanPayload;
  canCall: boolean;
  /** Motivo por el que no se puede llamar (otra llamada, junta en vivo, sin agente). */
  callBlocked: string | null;
  onCall: () => void;
  onCancel: () => void;
  onNext: () => void;
  onExit: () => void;
}) {
  const open = plan.pendingTutor?.lessonId === lesson.id;
  const last = plan.recent.find((a) => a.lessonId === lesson.id && a.tutor);
  const since = open
    ? new Date(plan.pendingTutor!.since).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <div className="flex flex-col gap-7">
      <section>
        <p className="text-sm text-text-dim">Conversación de voz · unos 5 minutos</p>
        <p className="mt-3 text-2xl leading-snug font-medium text-text">
          La tutora te hace hablar de lo que necesita «{unit.title.toLowerCase()}» y te corrige solo eso.
        </p>
        <p className="mt-3 text-md leading-relaxed text-text-dim">
          Lleva tus errores reales de este patrón y las frases modelo. Arranca ella; tú hablas el 70 % del
          tiempo. Cuando termines, dile «let&apos;s finish»: te da la devolución y guarda la práctica.
        </p>
      </section>

      <section>
        <h3 className="text-xs font-medium text-text-faint">Lo que vas a entrenar</h3>
        <ul className="mt-2 flex flex-col gap-2">
          {unit.rule.slice(0, 3).map((r) => (
            <li key={r} className="flex gap-2.5 text-sm leading-relaxed text-text">
              <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-text-faint" />
              {r}
            </li>
          ))}
        </ul>
      </section>

      {last?.tutor && (
        <section className="rounded-md border border-line bg-panel p-4 text-sm">
          <p className="flex items-center gap-2 text-text">
            <span aria-hidden className="h-2 w-2 rounded-full bg-green" />
            Hecha el {new Date(last.createdAt).toLocaleDateString("es-CO", { day: "numeric", month: "short" })}
          </p>
          <p className="mt-1 text-text-dim">
            {Math.round(last.tutor.durationSec / 60)} min · {last.tutor.patternErrors}{" "}
            {last.tutor.patternErrors === 1 ? "error" : "errores"} de este patrón de {last.tutor.totalErrors} que
            anotó la tutora. El reporte completo está en Sesiones.
          </p>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-5">
        {open ? (
          <>
            <p className="mr-2 text-sm text-text-dim">
              Lección abierta desde las {since}: cuenta al guardarse una práctica de {TUTOR_MIN_SEC / 60} minutos o
              más.
            </p>
            <Button variant="primary" size="md" onClick={onCall} disabled={!canCall}>
              Llamar otra vez
            </Button>
            <Button variant="ghost" size="md" onClick={onCancel}>
              Cancelar la lección
            </Button>
          </>
        ) : (
          <>
            <Button variant={last ? "secondary" : "primary"} size="md" onClick={onCall} disabled={!canCall}>
              {last ? "Repetir con la tutora" : "Llamar a la tutora"}
            </Button>
            {last && (
              <Button variant="primary" size="md" onClick={onNext}>
                Siguiente lección
              </Button>
            )}
            <Button variant="ghost" size="md" onClick={onExit}>
              Volver al plan
            </Button>
          </>
        )}
      </div>
      {callBlocked && <p className="text-sm text-text-dim">{callBlocked}</p>}
    </div>
  );
}
