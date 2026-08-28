"use client";

// Vocabulario del tutor con repaso espaciado real (backend: 3 días → vuelve a
// la cola, 3 repasos → aprendido). Primero la cola "por repasar" con acción
// de repaso; luego el resto. Patrón "Ready for review" de Memrise.
// Los términos tocados en la práctica en vivo llegan SIN significado
// (meaning_es vacío) → estado "por definir" hasta que el tutor los complete.

import { useMemo, useState } from "react";
import type { VocabEntry } from "@hermes/shared";
import { PanelState } from "@/components/ui/PanelState";
import { reviewVocabEntry } from "@/lib/hermes";

/** Mismo umbral del agente (REVIEW_AFTER_DAYS): sin repaso hace 3+ días. */
const REVIEW_AFTER_MS = 3 * 86_400_000;

export function isVocabDue(v: VocabEntry): boolean {
  if (v.learned) return false;
  if (!v.last_reviewed_at) return true;
  return Date.now() - new Date(v.last_reviewed_at).getTime() > REVIEW_AFTER_MS;
}

export function VocabTerm({
  v,
  due,
  busy,
  onReview,
}: {
  v: VocabEntry;
  due: boolean;
  busy: boolean;
  onReview: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`rounded-sm border px-2 py-1.5 ${due ? "border-amber/40" : "border-line"}`}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="min-w-0 flex-1 truncate text-left text-xs text-text"
          title={open ? "Ocultar significado" : "Ver significado"}
        >
          {v.term}
          {v.learned && <span className="ml-1.5 text-2xs text-green">✓</span>}
        </button>
        {!v.learned && (
          <span className="shrink-0 text-2xs text-text-faint tabular-nums" title="Repasos">
            {v.times_reviewed}/3
          </span>
        )}
        {due && (
          <button
            type="button"
            onClick={() => onReview(v.id)}
            disabled={busy}
            title="Marcar como repasado"
            className="shrink-0 rounded-sm border border-amber/50 px-1.5 py-0.5 text-2xs tracking-label text-amber uppercase transition-colors hover:border-amber disabled:opacity-40"
          >
            {busy ? "…" : "repasar"}
          </button>
        )}
      </div>
      {open && (
        <div className="mt-1 border-t border-line pt-1 text-2xs leading-snug text-text-dim">
          {v.meaning_es || (
            <span className="text-amber italic">
              Por definir — el tutor la explicará en tu próxima práctica.
            </span>
          )}
          {v.example && <p className="mt-0.5 text-text-faint italic">“{v.example}”</p>}
        </div>
      )}
    </div>
  );
}

export function VocabPanel({
  vocab,
  onChanged,
}: {
  vocab: VocabEntry[];
  onChanged: () => void;
}) {
  const [busyId, setBusyId] = useState<number | null>(null);
  const { due, rest } = useMemo(() => {
    const due = vocab.filter(isVocabDue);
    const dueIds = new Set(due.map((v) => v.id));
    return { due, rest: vocab.filter((v) => !dueIds.has(v.id)) };
  }, [vocab]);

  if (vocab.length === 0) {
    return (
      <PanelState
        kind="empty"
        compact
        title="Sin vocabulario aún"
        hint="El tutor guarda términos nuevos durante la práctica (save_vocab)."
      />
    );
  }

  const review = async (id: number) => {
    setBusyId(id);
    await reviewVocabEntry(id);
    setBusyId(null);
    onChanged();
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-1.5 overflow-y-auto overscroll-contain pr-1">
      {due.length > 0 && (
        <>
          <h3 className="text-2xs tracking-label text-amber uppercase">
            Por repasar · {due.length}
          </h3>
          {due.map((v) => (
            <VocabTerm key={v.id} v={v} due busy={busyId === v.id} onReview={(id) => void review(id)} />
          ))}
        </>
      )}
      {rest.length > 0 && (
        <>
          <h3 className={`text-2xs tracking-label text-text-dim uppercase ${due.length ? "mt-1" : ""}`}>
            Todos · {vocab.length}
          </h3>
          {rest.map((v) => (
            <VocabTerm key={v.id} v={v} due={false} busy={false} onReview={() => undefined} />
          ))}
        </>
      )}
    </div>
  );
}
