"use client";

import { useMemo } from "react";
import type { LiveHelpIntent, LiveSuggestionKind } from "@hermes/shared";
import { PanelState } from "@/components/ui/PanelState";
import { SuggestionBody } from "./SuggestionBody";
import { AutoHelpToggle } from "@/components/ingles/AutoHelpToggle";
import { fmtLiveClock, useLiveMeeting } from "@/state/LiveMeetingProvider";

// Acento por tipo de sugerencia: franja izquierda + label. Clases literales
// (no interpoladas) para que Tailwind las emita.
const KIND_STYLE: Record<LiveSuggestionKind, { label: string; border: string; text: string }> = {
  decir: { label: "DILO", border: "border-l-cyan", text: "text-cyan" },
  preguntar: { label: "PREGUNTA", border: "border-l-accent", text: "text-accent" },
  dato: { label: "DATO", border: "border-l-blue", text: "text-blue" },
  rumbo: { label: "RUMBO", border: "border-l-amber", text: "text-amber" },
  // Clase de inglés
  corregir: { label: "Corrección", border: "border-l-amber", text: "text-amber" },
  andamio: { label: "Para responder", border: "border-l-green", text: "text-green" },
  explicar: { label: "Qué dijo", border: "border-l-blue", text: "text-blue" },
  // Reunión de equipo
  aportar: { label: "Aporta", border: "border-l-green", text: "text-green" },
  entender: { label: "Concepto", border: "border-l-blue", text: "text-blue" },
  // Cualquier junta con «soy yo»: lo que acabas de decir, con el punto primero
  pulir: { label: "Dilo más claro", border: "border-l-accent", text: "text-accent" },
};

/** Etiqueta de la tarjeta que streamea (capa rápida) según lo que se pidió. */
const STREAM_LABEL: Partial<Record<LiveSuggestionKind, string>> = {
  decir: "⚡ Dilo ahora",
  andamio: "⚡ Para responder",
  explicar: "⚡ Qué dijo",
  aportar: "⚡ Aporta",
  preguntar: "⚡ Pregunta",
  entender: "⚡ De qué hablan",
};

/** Botones de la reunión de equipo: qué decir, qué preguntar, qué está pasando. */
export const TEAM_HELP: { intent: LiveHelpIntent; label: string; title: string }[] = [
  { intent: "full", label: "Aportar", title: "Una intervención con criterio para este momento" },
  { intent: "question", label: "Pregunta", title: "La pregunta que destraba o aclara" },
  { intent: "explain", label: "¿De qué hablan?", title: "El tema y los términos clave, en simple" },
];

/**
 * El aporte llega como «ángulo ⏎ frase»: mientras streamea, la primera línea
 * es la etiqueta y lo demás la frase (para no mostrar "Riesgo" como texto).
 */
export function splitStreamingAngle(kind: LiveSuggestionKind, text: string): { angle?: string; body: string } {
  if (kind !== "aportar" && kind !== "preguntar") return { body: text };
  const nl = text.indexOf("\n");
  if (nl === -1) return text.length <= 16 ? { angle: text.trim(), body: "" } : { body: text };
  return { angle: text.slice(0, nl).trim(), body: text.slice(nl + 1).trimStart() };
}

/** Botones de ayuda de la clase: tú hablas, Hermes te da de dónde agarrarte. */
const CLASS_HELP: { intent: LiveHelpIntent; label: string; title: string }[] = [
  {
    intent: "scaffold",
    label: "Ayúdame",
    title: "Palabras clave + cómo arrancar la frase (la terminas tú)",
  },
  { intent: "explain", label: "¿Qué dijo?", title: "Lo último de la profe, en español simple" },
  { intent: "full", label: "Dame la frase", title: "La respuesta completa para decirla tal cual" },
];

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
        <span className="text-2xs tracking-title text-accent uppercase">
          {live.isClass ? "Compañera de clase" : live.isTeam ? "Copiloto de equipo" : "▸ Copiloto"}
        </span>
        {live.isTeam ? null : live.isClass ? (
          <span className="flex gap-1">
            {CLASS_HELP.map((h) => (
              <button
                key={h.intent}
                type="button"
                onClick={() => live.suggestNow(h.intent)}
                disabled={!live.wsConnected || !live.fastCopilot}
                title={h.title}
                className="rounded-sm border border-accent/50 bg-accent/5 px-2 py-1 text-2xs text-accent opacity-90 transition-opacity hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {h.label}
              </button>
            ))}
          </span>
        ) : (
        <button
          type="button"
          onClick={() => live.suggestNow()}
          disabled={(live.fastCopilot ? !!streaming : live.suggesting) || !live.wsConnected}
          title={
            live.fastCopilot
              ? "Pide una respuesta inmediata para este momento (capa rápida)"
              : "Fuerza una tanda de sugerencias con lo hablado hasta ahora"
          }
          className="rounded-sm border border-accent/50 bg-accent/5 px-2 py-1 text-2xs tracking-label text-accent uppercase opacity-90 transition-opacity hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
          ◈ Soplar ahora
        </button>
        )}
      </div>

      {/* Equipo: los tres pedidos a mano en su propia fila (junto al título no caben). */}
      {live.isTeam && (
        <div className="mb-1.5 grid shrink-0 grid-cols-3 gap-1">
          {TEAM_HELP.map((h) => (
            <button
              key={h.intent}
              type="button"
              onClick={() => live.suggestNow(h.intent)}
              disabled={!live.wsConnected || !live.fastCopilot}
              title={h.title}
              className="truncate rounded-sm border border-accent/50 bg-accent/5 px-1.5 py-1 text-2xs text-accent opacity-90 transition-opacity hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {h.label}
            </button>
          ))}
        </div>
      )}

      {live.isClass && (
        <div className="mb-1.5 shrink-0">
          <AutoHelpToggle />
        </div>
      )}

      {live.suggesting && (
        <p className="mb-1.5 shrink-0 text-2xs tracking-label text-accent pulse-dot">
          ◈ Analizando la conversación…
        </p>
      )}

      {/* Capa rápida: la respuesta a la pregunta detectada streamea aquí. */}
      {streaming &&
        (() => {
          const { angle, body } = splitStreamingAngle(streaming.kind, streaming.text);
          return (
            <div className="mb-2 shrink-0 rounded-sm border border-cyan/60 border-l-2 border-l-cyan bg-cyan/5 p-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-2xs tracking-label text-cyan uppercase pulse-dot">
                  {STREAM_LABEL[streaming.kind] ?? "⚡ DILO AHORA"}
                  {angle ? ` · ${angle}` : ""}
                </span>
                <span className="text-2xs text-text-faint tabular-nums">
                  {fmtLiveClock(streaming.atMs)}
                </span>
              </div>
              {body ? (
                <p className="mt-1 text-sm leading-snug whitespace-pre-line text-text">
                  {body}
                  <span className="text-cyan">▌</span>
                </p>
              ) : (
                <p className="mt-1 text-xs leading-snug text-text-dim italic">
                  {live.isTeam ? "pensando qué aportar…" : "pensando la respuesta…"}
                </p>
              )}
              <p className="mt-1 text-2xs leading-snug text-text-dim">{streaming.trigger}</p>
            </div>
          );
        })()}

      {items.length === 0 ? (
        <PanelState
          kind="empty"
          compact
          title={live.isClass ? "Todavía nada" : "Sin sugerencias todavía"}
          hint={
            live.isClass
              ? live.selfSpeaker
                ? "Te ayudo cuando la profe pregunte y corrijo cuando termines de hablar."
                : "Marca cuál voz es la tuya para recibir correcciones."
              : live.isTeam
                ? live.selfSpeaker
                  ? "Te aviso cuando se abra una ventana para aportar y te explico lo que no conozcas."
                  : "Marca cuál voz es la tuya: así no te sugiero nada sobre lo que dices tú."
                : "Hermes sopla cuando hay suficiente conversación."
          }
        />
      ) : (
        <div className="flex min-h-0 flex-1 gap-2 lg:flex-col lg:overflow-y-auto lg:overscroll-contain lg:pr-1 max-lg:snap-x max-lg:overflow-x-auto max-lg:pb-1">
          {items.map((s) => {
            const k = KIND_STYLE[s.kind] ?? KIND_STYLE.decir;
            return (
              <div
                key={s.id}
                className={`shrink-0 rounded-sm border border-line border-l-2 ${k.border} bg-accent/5 p-2.5 max-lg:min-w-[260px] max-lg:snap-start`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className={`text-2xs tracking-label uppercase ${k.text}`}>
                    {s.source === "fast" ? "⚡ " : ""}
                    {k.label}
                    {s.angle && s.angle.toLowerCase() !== k.label.toLowerCase() ? ` · ${s.angle}` : ""}
                    {s.manual ? " · manual" : ""}
                  </span>
                  <span className="text-2xs text-text-faint tabular-nums">
                    {fmtLiveClock(s.atMs)}
                  </span>
                </div>
                <SuggestionBody s={s} />
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
