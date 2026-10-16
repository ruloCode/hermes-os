"use client";

// Vocabulario del tutor con repaso espaciado real (backend: 3 días → vuelve a
// la cola, 3 repasos → aprendido). Primero la cola "por repasar" con acción
// de repaso; luego el resto. Patrón "Ready for review" de Memrise.
// Los términos tocados en la práctica en vivo llegan SIN significado
// (meaning_es vacío) → estado "por definir" hasta que el tutor los complete.
//
// v5: filas del riel (aire + hover), no cajas con borde ámbar. "Toca repasar"
// es un estado, así que lo dice UN punto ámbar junto al título del grupo; el
// botón es secundario y neutro.

import { useMemo, useState, type ReactNode } from "react";
import type { VocabEntry } from "@hermes/shared";
import { Button } from "@/components/ui/Button";
import { PanelState } from "@/components/ui/PanelState";
import { reviewVocabEntry } from "@/lib/hermes";

/** Mismo umbral del agente (REVIEW_AFTER_DAYS): sin repaso hace 3+ días. */
const REVIEW_AFTER_MS = 3 * 86_400_000;

export function isVocabDue(v: VocabEntry): boolean {
  if (v.learned) return false;
  if (!v.last_reviewed_at) return true;
  return Date.now() - new Date(v.last_reviewed_at).getTime() > REVIEW_AFTER_MS;
}

/** Subtítulo de grupo dentro de una sección del riel (punto = estado, opcional). */
export function GroupLabel({
  children,
  dot,
}: {
  children: ReactNode;
  dot?: "amber" | "cyan";
}) {
  return (
    <h3 className="flex items-center gap-1.5 px-2 pb-0.5 text-xs font-medium text-text-dim">
      {dot && (
        <span
          aria-hidden
          className={`h-1.5 w-1.5 rounded-full ${dot === "amber" ? "bg-amber" : "bg-cyan"}`}
        />
      )}
      {children}
    </h3>
  );
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
    <div className={`rounded-sm transition-colors ${open ? "bg-hover" : "hover:bg-hover"}`}>
      <div className="flex min-h-8 items-center gap-2 pr-1">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 self-stretch px-2 text-left text-sm text-text"
          title={open ? "Ocultar significado" : "Ver significado"}
        >
          <span className="truncate">{v.term}</span>
          {v.learned && (
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-label="Aprendida"
              className="shrink-0 text-green"
            >
              <path d="M20 6 9 17l-5-5" />
            </svg>
          )}
        </button>
        {!v.learned && (
          <span className="shrink-0 text-xs text-text-faint tabular-nums" title="Repasos">
            {v.times_reviewed}/3
          </span>
        )}
        {due && (
          <Button
            onClick={() => onReview(v.id)}
            disabled={busy}
            title="Marcar como repasado"
            className="h-6! px-2!"
          >
            {busy ? "…" : "Repasar"}
          </Button>
        )}
      </div>
      {open && (
        <div className="px-2 pb-2 text-xs leading-relaxed text-text-dim">
          {v.meaning_es || (
            <span className="text-text-faint italic">
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
    <div className="flex flex-col gap-3">
      {due.length > 0 && (
        <div className="flex flex-col gap-px">
          <GroupLabel dot="amber">
            Por repasar <span className="font-normal text-text-faint tabular-nums">{due.length}</span>
          </GroupLabel>
          {due.map((v) => (
            <VocabTerm
              key={v.id}
              v={v}
              due
              busy={busyId === v.id}
              onReview={(id) => void review(id)}
            />
          ))}
        </div>
      )}
      {rest.length > 0 && (
        <div className="flex flex-col gap-px">
          <GroupLabel>
            {due.length ? "El resto" : "Todas"}{" "}
            <span className="font-normal text-text-faint tabular-nums">{rest.length}</span>
          </GroupLabel>
          {rest.map((v) => (
            <VocabTerm key={v.id} v={v} due={false} busy={false} onReview={() => undefined} />
          ))}
        </div>
      )}
    </div>
  );
}
