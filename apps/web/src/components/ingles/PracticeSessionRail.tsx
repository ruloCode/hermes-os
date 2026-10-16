"use client";

// Riel de la práctica en vivo: cómo vas en ESTA conversación (todo contado del
// transcript real y de las correcciones que llegaron) y la lista de
// correcciones para repasarlas sin perder el hilo de la charla.

import { useMemo } from "react";
import { parseCorrection } from "@hermes/shared";
import { useVoice } from "@/components/VoiceBusyContext";
import type { PracticeCompanion } from "@/hooks/usePracticeCompanion";

// v5: los tres números en el color del texto (como la tira de la vista); el
// único color es el punto de "bien dichas", que sí es un estado.
function Mini({ label, value, dot }: { label: string; value: string | number; dot?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-xs text-text-faint">{label}</dt>
      <dd className="flex items-center gap-1.5 text-lg leading-none font-semibold text-text tabular-nums">
        {dot && <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${dot}`} />}
        {value}
      </dd>
    </div>
  );
}

export function PracticeSessionRail({
  companion,
  fromLine,
}: {
  companion: PracticeCompanion;
  /** Índice del transcript donde arrancó esta práctica. */
  fromLine: number;
}) {
  const { transcript } = useVoice();
  const mine = useMemo(
    () => transcript.slice(fromLine).filter((l) => l.who === "TÚ"),
    [transcript, fromLine],
  );
  const words = mine.reduce((n, l) => n + (l.text.trim() ? l.text.trim().split(/\s+/).length : 0), 0);
  const corrections = useMemo(
    () =>
      companion.cards
        .filter((c) => c.kind === "corregir")
        .map((c) => ({ id: c.id, e: parseCorrection(c.why ? `${c.text} | ${c.why}` : c.text) }))
        .filter((c) => c.e)
        .reverse(),
    [companion.cards],
  );
  const ok = [...companion.feedback.values()].filter((f) => f.kind === "ok").length;

  return (
    <div className="flex flex-col gap-5">
      <dl className="grid grid-cols-3 gap-3 px-2">
        <Mini label="Tus turnos" value={mine.length} />
        <Mini label="Palabras" value={words} />
        <Mini
          label="Bien dichas"
          value={mine.length ? `${ok}/${ok + corrections.length}` : "—"}
          dot={
            ok + corrections.length === 0
              ? undefined
              : corrections.length > ok
                ? "bg-amber"
                : "bg-green"
          }
        />
      </dl>

      <div className="flex flex-col gap-2 px-2">
        <span className="text-xs font-medium text-text-dim">
          Correcciones
          {corrections.length > 0 && (
            <span className="ml-1.5 font-normal text-text-faint tabular-nums">
              {corrections.length}
            </span>
          )}
        </span>
        {corrections.length === 0 ? (
          <p className="text-sm leading-relaxed text-text-faint">
            Aquí se juntan las correcciones de esta práctica para que las repases al final.
          </p>
        ) : (
          <ul className="flex max-h-[38vh] flex-col overflow-y-auto overscroll-contain pr-1">
            {corrections.map(({ id, e }) => (
              <li key={id} className="border-t border-line py-2 first:border-t-0">
                <p className="text-sm leading-snug text-text-dim">
                  <span className="line-through decoration-text-faint">{e!.quote}</span>
                  <span className="px-1.5 text-text-faint">→</span>
                  <span className="text-text">{e!.correction}</span>
                </p>
                {e!.note_es && (
                  <p className="mt-0.5 text-xs leading-snug text-text-faint">{e!.note_es}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
