"use client";

import { useMemo } from "react";
import type { LiveHelpIntent, LiveSuggestionKind } from "@hermes/shared";
import { PanelState } from "@/components/ui/PanelState";
import { SuggestionBody } from "./SuggestionBody";
import { AutoHelpToggle } from "@/components/ingles/AutoHelpToggle";
import { fmtLiveClock, useLiveMeeting } from "@/state/LiveMeetingProvider";

// Tipo de sugerencia = CATEGORÍA, no estado: etiqueta en gris (v4 le daba a
// cada tipo un color de borde izquierdo y de texto — seis colores por riel).
const KIND_STYLE: Record<LiveSuggestionKind, { label: string }> = {
  decir: { label: "Dilo" },
  preguntar: { label: "Pregunta" },
  dato: { label: "Dato" },
  rumbo: { label: "Rumbo" },
  // Clase de inglés
  corregir: { label: "Corrección" },
  andamio: { label: "Para responder" },
  explicar: { label: "Qué dijo" },
  // Reunión de equipo
  aportar: { label: "Aporta" },
  entender: { label: "Concepto" },
  // Cualquier junta con «soy yo»: lo que acabas de decir, con el punto primero
  pulir: { label: "Dilo más claro" },
};

/** Etiqueta de la tarjeta que streamea (capa rápida) según lo que se pidió. */
const STREAM_LABEL: Partial<Record<LiveSuggestionKind, string>> = {
  decir: "Dilo ahora",
  andamio: "Para responder",
  explicar: "Qué dijo",
  aportar: "Aporta",
  preguntar: "Pregunta",
  entender: "De qué hablan",
};

// Botón de ayuda a mano: secundario neutro (el acento es solo foco/primario).
const HELP_BTN =
  "inline-flex h-7 cursor-pointer items-center justify-center truncate rounded-sm border border-line bg-panel px-2.5 text-xs font-medium text-text transition-colors hover:border-line-2 hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50";

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
      <div className="mb-2 flex min-h-7 shrink-0 items-center justify-between gap-2">
        <span className="text-xs font-medium text-text-dim">
          {live.isClass ? "Compañera de clase" : live.isTeam ? "Copiloto de equipo" : "Copiloto"}
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
                className={HELP_BTN}
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
          className={HELP_BTN}
        >
          Soplar ahora
        </button>
        )}
      </div>

      {/* Equipo: los tres pedidos a mano en su propia fila (junto al título no caben). */}
      {live.isTeam && (
        <div className="mb-2 grid shrink-0 grid-cols-3 gap-1">
          {TEAM_HELP.map((h) => (
            <button
              key={h.intent}
              type="button"
              onClick={() => live.suggestNow(h.intent)}
              disabled={!live.wsConnected || !live.fastCopilot}
              title={h.title}
              className={`${HELP_BTN} px-1.5`}
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
        <p className="mb-2 flex shrink-0 items-center gap-2 text-xs text-text-dim">
          <span aria-hidden className="pulse-dot h-1.5 w-1.5 rounded-full bg-cyan" />
          Analizando la conversación…
        </p>
      )}

      {/* Capa rápida: la respuesta a la pregunta detectada streamea aquí. */}
      {streaming &&
        (() => {
          const { angle, body } = splitStreamingAngle(streaming.kind, streaming.text);
          return (
            // En curso: la única tarjeta con color (cyan = "en curso").
            <div className="mb-2 shrink-0 rounded-md border border-cyan/40 bg-cyan/5 px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-text">
                  <span aria-hidden className="pulse-dot h-1.5 w-1.5 shrink-0 rounded-full bg-cyan" />
                  <span className="truncate">
                    {STREAM_LABEL[streaming.kind] ?? "Dilo ahora"}
                    {angle ? ` · ${angle}` : ""}
                  </span>
                </span>
                <span className="font-mono text-2xs text-text-faint tabular-nums">
                  {fmtLiveClock(streaming.atMs)}
                </span>
              </div>
              {body ? (
                <p className="mt-1 text-sm leading-snug whitespace-pre-line text-text">
                  {body}
                  <span className="text-text-faint">▍</span>
                </p>
              ) : (
                <p className="mt-1 text-xs leading-snug text-text-dim italic">
                  {live.isTeam ? "pensando qué aportar…" : "pensando la respuesta…"}
                </p>
              )}
              <p className="mt-1 text-xs leading-snug text-text-faint">{streaming.trigger}</p>
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
                className="group shrink-0 rounded-md border border-line bg-panel px-3 py-2.5 max-lg:min-w-[260px] max-lg:snap-start"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-medium text-text-dim">
                    {k.label}
                    {s.angle && s.angle.toLowerCase() !== k.label.toLowerCase() ? ` · ${s.angle}` : ""}
                    {s.manual ? " · a mano" : ""}
                    {s.source === "fast" ? " · al instante" : ""}
                  </span>
                  <span className="font-mono text-2xs text-text-faint tabular-nums">
                    {fmtLiveClock(s.atMs)}
                  </span>
                </div>
                <SuggestionBody s={s} />
                <button
                  type="button"
                  onClick={() => live.dismissSuggestion(s.id)}
                  className="-ml-1 mt-1.5 h-6 cursor-pointer rounded-xs px-1 text-xs text-text-faint transition-colors hover:bg-hover hover:text-text"
                >
                  Descartar
                </button>
              </div>
            );
          })}
        </div>
      )}
    </aside>
  );
}
