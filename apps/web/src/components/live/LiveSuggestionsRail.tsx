"use client";

import { useMemo } from "react";
import type { LiveSuggestionKind } from "@hermes/shared";
import { PanelState } from "@/components/ui/PanelState";
import { fmtLiveClock, useLiveMeeting } from "@/state/LiveMeetingProvider";

// Acento por tipo de sugerencia: franja izquierda + label. Clases literales
// (no interpoladas) para que Tailwind las emita.
const KIND_STYLE: Record<LiveSuggestionKind, { label: string; border: string; text: string }> = {
  decir: { label: "DILO", border: "border-l-cyan", text: "text-cyan" },
  preguntar: { label: "PREGUNTA", border: "border-l-violet", text: "text-violet" },
  dato: { label: "DATO", border: "border-l-blue", text: "text-blue" },
  rumbo: { label: "RUMBO", border: "border-l-amber", text: "text-amber" },
};

/**
 * Riel del copiloto: tarjetas de sugerencias (la más reciente arriba) +
 * "Soplar ahora". En ≥lg es columna a la derecha; bajo lg cae a strip
 * horizontal con snap debajo del transcript.
 */
export function LiveSuggestionsRail() {
  const live = useLiveMeeting();

  const items = useMemo(
    () => live.suggestions.filter((s) => !live.dismissed.has(s.id)).reverse(),
    [live.suggestions, live.dismissed],
  );
  const streaming = live.streamingSuggestion;

  return (
    <aside
      aria-label="Sugerencias del copiloto"
      // Ojo Tailwind v4 del repo: `wide:` se emite ANTES que `lg:` → el lg
      // se acota con lg:max-wide: para que ambos anchos convivan.
      className="flex shrink-0 flex-col lg:max-wide:w-[300px] wide:w-[340px] max-lg:h-[156px] max-lg:w-full"
    >
      <div className="mb-1.5 flex shrink-0 items-center justify-between gap-2">
        <span className="text-2xs tracking-title text-violet uppercase">▸ Copiloto</span>
        <button
          type="button"
          onClick={live.suggestNow}
          disabled={(live.fastCopilot ? !!streaming : live.suggesting) || !live.wsConnected}
          title={
            live.fastCopilot
              ? "Pide una respuesta inmediata para este momento (capa rápida)"
              : "Fuerza una tanda de sugerencias con lo hablado hasta ahora"
          }
          className="rounded-sm border border-violet/50 bg-violet/5 px-2 py-1 text-2xs tracking-label text-violet uppercase opacity-90 transition-opacity hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
          ◈ Soplar ahora
        </button>
      </div>

      {live.suggesting && (
        <p className="mb-1.5 shrink-0 text-2xs tracking-label text-violet pulse-dot">
          ◈ Analizando la conversación…
        </p>
      )}

      {/* Capa rápida: la respuesta a la pregunta detectada streamea aquí. */}
      {streaming && (
        <div className="mb-2 shrink-0 rounded-sm border border-cyan/60 border-l-2 border-l-cyan bg-cyan/5 p-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-2xs tracking-label text-cyan uppercase pulse-dot">
              ⚡ DILO AHORA
            </span>
            <span className="text-2xs text-text-faint tabular-nums">
              {fmtLiveClock(streaming.atMs)}
            </span>
          </div>
          {streaming.text ? (
            <p className="mt-1 text-sm leading-snug text-text">
              {streaming.text}
              <span className="text-cyan">▌</span>
            </p>
          ) : (
            <p className="mt-1 text-xs leading-snug text-text-dim italic">pensando la respuesta…</p>
          )}
          <p className="mt-1 text-2xs leading-snug text-text-dim">{streaming.trigger}</p>
        </div>
      )}

      {items.length === 0 ? (
        <PanelState
          kind="empty"
          compact
          title="Sin sugerencias todavía"
          hint="Hermes sopla cuando hay suficiente conversación."
        />
      ) : (
        <div className="flex min-h-0 flex-1 gap-2 lg:flex-col lg:overflow-y-auto lg:overscroll-contain lg:pr-1 max-lg:snap-x max-lg:overflow-x-auto max-lg:pb-1">
          {items.map((s) => {
            const k = KIND_STYLE[s.kind] ?? KIND_STYLE.decir;
            return (
              <div
                key={s.id}
                className={`shrink-0 rounded-sm border border-line border-l-2 ${k.border} bg-violet/5 p-2.5 max-lg:min-w-[260px] max-lg:snap-start`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className={`text-2xs tracking-label uppercase ${k.text}`}>
                    {s.source === "fast" ? "⚡ " : ""}
                    {k.label}
                    {s.manual ? " · manual" : ""}
                  </span>
                  <span className="text-2xs text-text-faint tabular-nums">
                    {fmtLiveClock(s.atMs)}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-snug text-text">{s.text}</p>
                {s.why && <p className="mt-1 text-2xs leading-snug text-text-dim">{s.why}</p>}
                <button
                  type="button"
                  onClick={() => live.dismissSuggestion(s.id)}
                  className="mt-1.5 text-2xs text-text-dim transition-colors hover:text-text"
                >
                  ✕ descartar
                </button>
              </div>
            );
          })}
        </div>
      )}
    </aside>
  );
}
