"use client";

// Banco de palabras de la práctica EN VIVO (riel derecho durante la llamada):
// 1. Las palabras que tocaste en el transcript, con su estado real —
//    "por definir" (amber, el tutor aún no la explicó) o la definición ya
//    completada por save_vocab (el poll rápido de InglesView la trae sola).
// 2. La cola "repasa hoy" para que el tutor te quicee en la misma sesión.
// Patrón word bank de Speak: lo tocado se acumula a la vista, sin salir del flujo.

import { useMemo, useState } from "react";
import type { VocabEntry } from "@hermes/shared";
import { reviewVocabEntry } from "@/lib/hermes";
import type { SessionWord } from "./LivePractice";
import { GroupLabel, isVocabDue, VocabTerm } from "./VocabPanel";

export function LiveWordBank({
  words,
  vocab,
  onChanged,
}: {
  /** Palabras tocadas en ESTA práctica (más reciente primero). */
  words: SessionWord[];
  vocab: VocabEntry[];
  onChanged: () => void;
}) {
  const [busyId, setBusyId] = useState<number | null>(null);
  const byTerm = useMemo(() => {
    const m = new Map<string, VocabEntry>();
    for (const v of vocab) m.set(v.term.trim().toLowerCase(), v);
    return m;
  }, [vocab]);
  const due = useMemo(() => vocab.filter(isVocabDue).slice(0, 8), [vocab]);

  const review = async (id: number) => {
    setBusyId(id);
    await reviewVocabEntry(id);
    setBusyId(null);
    onChanged();
  };

  // v5: filas sin caja; "por definir" / "definida" como punto de estado + texto
  // gris (antes ámbar parpadeante y verde, con un borde de acento por palabra).
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain">
      <div className="flex flex-col gap-px">
        <GroupLabel>
          Esta sesión{" "}
          <span className="font-normal text-text-faint tabular-nums">{words.length}</span>
        </GroupLabel>
        {words.length === 0 ? (
          <p className="mx-2 mt-1 rounded-sm border border-dashed border-line-2 px-3 py-3 text-xs leading-relaxed text-text-faint">
            Toca cualquier palabra de la tutora en la transcripción y aparece aquí al instante. La
            tutora la explica en la charla y le pone su significado.
          </p>
        ) : (
          words.map((w) => {
            const entry = byTerm.get(w.term);
            const defined = Boolean(entry?.meaning_es);
            return (
              <div key={w.term} className="hud-in rounded-sm px-2 py-1.5 transition-colors hover:bg-hover">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm text-text">{w.term}</span>
                  <span className="flex shrink-0 items-center gap-1.5 text-xs text-text-faint">
                    <span
                      aria-hidden
                      className={`h-1.5 w-1.5 rounded-full ${defined ? "bg-green" : "pulse-dot bg-amber"}`}
                    />
                    {defined ? "Definida" : "Por definir"}
                  </span>
                </div>
                <p
                  className="mt-0.5 truncate text-xs leading-snug text-text-dim"
                  title={defined ? entry?.meaning_es : w.sentence}
                >
                  {defined ? entry?.meaning_es : `“${w.sentence}”`}
                </p>
              </div>
            );
          })
        )}
      </div>

      {due.length > 0 && (
        <div className="flex flex-col gap-px">
          <GroupLabel dot="amber">
            Repasa hoy <span className="font-normal text-text-faint tabular-nums">{due.length}</span>
          </GroupLabel>
          <p className="px-2 pb-1 text-xs leading-snug text-text-faint">
            Pídele a la tutora un quiz (“let’s review my vocabulary”) y marca el repaso aquí.
          </p>
          {due.map((v) => (
            <VocabTerm key={v.id} v={v} due busy={busyId === v.id} onReview={(id) => void review(id)} />
          ))}
        </div>
      )}
    </div>
  );
}
