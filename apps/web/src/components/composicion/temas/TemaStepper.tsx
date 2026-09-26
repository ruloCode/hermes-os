"use client";

/**
 * Las 6 etapas de un tema en una línea (patrones Mobbin: el stepper de
 * Customer.io y el "qué falta" de Workable). Lo que falta sale de los gates,
 * calculados sobre el material REAL (intención escrita, loop, tomas, análisis,
 * letras); avanzar siempre se puede — la decisión es humana, igual que en el
 * Estudio. Mirar otra etapa no la "avanza": solo "Siguiente" mueve la etapa
 * del tema.
 */
import { TEMA_STAGES, TEMA_STAGE_LABEL, type TemaGate, type TemaStage } from "@hermes/shared";
import { btn, btnPrimary } from "../playground/ui";

export function TemaStepper({
  stage,
  temaStage,
  gates,
  onView,
  onAdvance,
}: {
  /** Etapa que se ve. */
  stage: TemaStage;
  /** Etapa del tema (hasta dónde llegó). */
  temaStage: TemaStage;
  gates: TemaGate[];
  onView: (s: TemaStage) => void;
  /** "Siguiente": ver la etapa siguiente y, si el tema no había llegado, moverlo ahí. */
  onAdvance: (s: TemaStage) => void;
}) {
  const i = TEMA_STAGES.indexOf(stage);
  const reached = TEMA_STAGES.indexOf(temaStage);
  const next = TEMA_STAGES[i + 1] as TemaStage | undefined;
  const gate = gates.find((g) => g.stage === stage);

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-6 gap-y-2">
      <ol className="flex min-w-0 items-center gap-1 overflow-x-auto" aria-label="Etapas del tema">
        {TEMA_STAGES.map((s, j) => {
          const on = s === stage;
          const done = gates.find((g) => g.stage === s)?.done ?? false;
          return (
            <li key={s} className="flex shrink-0 items-center gap-1">
              {j > 0 && <span aria-hidden className={`h-px w-4 ${j <= reached ? "bg-line-2" : "bg-line"}`} />}
              <button
                type="button"
                onClick={() => onView(s)}
                aria-current={on ? "step" : undefined}
                title={`${TEMA_STAGE_LABEL[s]} · ⌥${j + 1}`}
                className={`flex cursor-pointer items-center gap-1.5 rounded-sm px-1.5 py-1 text-xs transition-colors ${
                  on ? "bg-accent/12 text-accent" : j <= reached ? "text-text hover:bg-panel-2" : "text-text-faint hover:bg-panel-2 hover:text-text-dim"
                }`}
              >
                <span
                  aria-hidden
                  className={`grid h-[18px] w-[18px] place-items-center rounded-full border text-2xs tabular-nums ${
                    on ? "border-accent" : done ? "border-green/60 text-green" : "border-line-2"
                  }`}
                >
                  {done && !on ? "✓" : j + 1}
                </span>
                {TEMA_STAGE_LABEL[s]}
              </button>
            </li>
          );
        })}
      </ol>
      <div className="flex min-w-0 items-center gap-3">
        <span className="min-w-0 truncate text-xs text-text-faint" title={gate?.missing.join(" · ")}>
          {!gate
            ? null
            : gate.done
              ? <span className="text-green">✓ {TEMA_STAGE_LABEL[stage]} lista</span>
              : gate.missing.length
                ? <>falta: {gate.missing.join(" · ")}</>
                : null}
        </span>
        {next && (
          <button
            type="button"
            className={gate?.done ? btnPrimary : btn}
            onClick={() => onAdvance(next)}
            title={gate && !gate.done ? "Se puede avanzar aunque falte algo: tú decides" : undefined}
          >
            Siguiente: {TEMA_STAGE_LABEL[next]} ▸
          </button>
        )}
      </div>
    </div>
  );
}
