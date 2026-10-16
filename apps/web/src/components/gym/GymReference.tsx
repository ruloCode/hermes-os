"use client";

import { referenceOf, type GymScenario } from "@hermes/shared";
import { speak } from "./GymFeedback";

/**
 * La respuesta de referencia de un escenario: los pasos (la forma) y cómo
 * suena dicha bien. Se ve ANTES de responder para tener un modelo; los
 * [corchetes] son los datos que solo tú tienes.
 */
export function GymReference({
  scenario,
  open,
  onToggle,
}: {
  scenario: GymScenario;
  open: boolean;
  onToggle: () => void;
}) {
  const ref = referenceOf(scenario);
  if (!ref) return null;
  if (!open)
    return (
      <button
        type="button"
        onClick={onToggle}
        className="self-start cursor-pointer text-xs text-text-dim hover:text-text"
      >
        Ver la respuesta de referencia
      </button>
    );
  return (
    <section className="flex flex-col gap-3 rounded-md border border-line px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="text-2xs text-text-faint">Referencia</span>
        <button
          type="button"
          onClick={() => speak(ref.example, scenario.lang)}
          className="ml-auto cursor-pointer rounded-sm border border-line px-2 py-0.5 text-xs text-text-dim hover:border-line-2 hover:text-text"
          title="Escucharla en voz alta"
        >
          ▶ Escuchar
        </button>
        <button
          type="button"
          onClick={onToggle}
          className="cursor-pointer text-xs text-text-faint hover:text-text"
          title="Intentarlo sin ver la referencia"
        >
          Ocultar
        </button>
      </div>
      <ol className="flex flex-wrap gap-x-4 gap-y-1">
        {ref.steps.map((step, i) => (
          <li key={step} className="text-xs text-text-dim">
            <span className="text-accent tabular-nums">{i + 1}</span> {step}
          </li>
        ))}
      </ol>
      <p className="text-md leading-relaxed text-text">
        {ref.example.split(/(\[[^\]]+\])/g).map((part, i) =>
          part.startsWith("[") ? (
            <span key={i} className="text-accent" title="Aquí va tu dato real">
              {part}
            </span>
          ) : (
            part
          ),
        )}
      </p>
      <p className="text-xs text-text-faint">
        Dila con tus palabras y tus datos: lo que se entrena es la forma, no el texto.
      </p>
    </section>
  );
}
