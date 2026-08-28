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
import { isVocabDue, VocabTerm } from "./VocabPanel";

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

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-y-auto overscroll-contain pr-1">
      <h3 className="text-2xs tracking-label text-violet uppercase">
        Esta sesión · {words.length}
      </h3>
      {words.length === 0 ? (
        <p className="rounded-sm border border-line border-dashed px-2.5 py-3 text-2xs leading-relaxed text-text-faint">
          👆 Toca cualquier palabra del tutor en la transcripción y aparece aquí al
          instante. El tutor la explica en la charla y le pone su significado.
        </p>
      ) : (
        words.map((w) => {
          const entry = byTerm.get(w.term);
          const defined = Boolean(entry?.meaning_es);
          return (
            <div key={w.term} className="hud-in rounded-sm border border-violet/30 px-2 py-1.5">
              <div className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-xs text-text">{w.term}</span>
                <span
                  className={`shrink-0 text-2xs ${defined ? "text-green" : "animate-pulse text-amber"}`}
                >
                  {defined ? "✓ definida" : "por definir"}
                </span>
              </div>
              <p className="mt-0.5 truncate text-2xs leading-snug text-text-dim" title={defined ? entry?.meaning_es : w.sentence}>
                {defined ? entry?.meaning_es : `“${w.sentence}”`}
              </p>
            </div>
          );
        })
      )}

      {due.length > 0 && (
        <>
          <h3 className="mt-1 text-2xs tracking-label text-amber uppercase">
            Repasa hoy · {due.length}
          </h3>
          <p className="text-2xs leading-snug text-text-faint">
            Pídele al tutor un quiz (“let’s review my vocabulary”) y marca el repaso aquí.
          </p>
          {due.map((v) => (
            <VocabTerm key={v.id} v={v} due busy={busyId === v.id} onReview={(id) => void review(id)} />
          ))}
        </>
      )}
    </div>
  );
}
