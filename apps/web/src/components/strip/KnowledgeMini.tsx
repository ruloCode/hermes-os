"use client";

// Mini CONOCIMIENTO: total real de la capa de conocimiento unificada con
// desglose literal por fuente. Se oculta cuando no hay Supabase (available
// false → todos los conteos en 0, mostrar ceros sería ruido).

import type { KnowledgeStats } from "@hermes/shared";

export function KnowledgeMini({
  knowledge,
  delay = 0,
}: {
  knowledge: KnowledgeStats;
  delay?: number;
}) {
  if (!knowledge.available) return null;

  const chats = knowledge.conversationText + knowledge.conversationVoice;

  return (
    <div
      className="hud-panel hud-in flex min-h-[92px] flex-col gap-1.5 p-3"
      style={{ animationDelay: `${delay}ms` }}
    >
      <header className="flex items-center gap-1.5">
        <span aria-hidden className="h-1 w-1 shrink-0 rounded-full bg-violet" />
        <h3 className="text-2xs tracking-label uppercase text-text-dim">Conocimiento</h3>
      </header>
      <div className="flex min-h-0 flex-1 flex-col justify-center gap-0.5">
        <p className="glow-text-violet font-display text-2xl leading-none tabular-nums text-violet">
          {knowledge.total.toLocaleString("es-CO")}
        </p>
        {/* text-dim y no faint: el desglose es información, no decoración. */}
        <p className="truncate text-2xs tabular-nums text-text-dim">
          {knowledge.memories} memorias · {knowledge.vaultDocs} vault · {chats} chats
        </p>
      </div>
    </div>
  );
}
