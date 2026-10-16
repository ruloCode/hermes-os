"use client";

import { referenceOf, type GymScenario } from "@hermes/shared";
import { Button } from "@/components/ui/Button";
import { speak, SpeakerIcon } from "./GymFeedback";

/**
 * La respuesta de referencia de un escenario: los pasos (la forma) y cómo
 * suena dicha bien. Se ve ANTES de responder para tener un modelo; los
 * [corchetes] son los datos que solo tú tienes.
 *
 * v5: los números de los pasos en gris (eran de acento, como si fueran
 * enlaces) y las acciones como botones fantasma de la barra de la tarjeta.
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
      <Button variant="ghost" onClick={onToggle} className="-ml-2.5 self-start">
        Ver la respuesta de referencia
      </Button>
    );
  return (
    <section className="flex flex-col gap-3 rounded-md border border-line bg-panel px-4 pt-2.5 pb-3.5">
      <div className="-mr-2 flex items-center gap-1">
        <h3 className="text-xs font-medium text-text-faint">Referencia</h3>
        <Button
          variant="ghost"
          onClick={() => speak(ref.example, scenario.lang)}
          title="Escucharla en voz alta"
          icon={<SpeakerIcon />}
          className="ml-auto"
        >
          Escuchar
        </Button>
        <Button variant="ghost" onClick={onToggle} title="Intentarlo sin ver la referencia">
          Ocultar
        </Button>
      </div>
      <ol className="flex flex-wrap gap-x-5 gap-y-1">
        {ref.steps.map((step, i) => (
          <li key={step} className="flex items-baseline gap-1.5 text-xs text-text-dim">
            <span className="text-text-faint tabular-nums">{i + 1}.</span>
            {step}
          </li>
        ))}
      </ol>
      <p className="text-md leading-relaxed text-text">
        {ref.example.split(/(\[[^\]]+\])/g).map((part, i) =>
          part.startsWith("[") ? (
            <span
              key={i}
              className="rounded-xs bg-hover px-1 text-text-dim"
              title="Aquí va tu dato real"
            >
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
