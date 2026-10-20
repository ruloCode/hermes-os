"use client";

import { useMemo } from "react";
import { looksLikeSilence, type LiveHelpIntent, type LiveSuggestion, type LiveSuggestionKind } from "@hermes/shared";
import { SuggestionBody } from "./SuggestionBody";
import { AutoHelpToggle } from "@/components/ingles/AutoHelpToggle";
import { ClassHelpFeed } from "./ClassHelpFeed";
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
          // Con capa rápida los pedidos van en cola: se puede pedir otro mientras uno se escribe.
          disabled={(live.fastCopilot ? false : live.suggesting) || !live.wsConnected}
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

      {/* Historial: lo que se genera se queda (nada se pisa ni desaparece). */}
      {live.isClass ? <ClassHelpFeed /> : <MeetingHelpFeed />}
    </aside>
  );
}

/** Lo que se dice en voz alta: se lee de un vistazo, más grande. */
const SAY_KINDS = new Set<LiveSuggestionKind>(["decir", "aportar", "preguntar"]);

interface FeedItem {
  id: string;
  kind: LiveSuggestionKind;
  text: string;
  why: string;
  atMs: number;
  manual: boolean;
  angle?: string;
  source?: LiveSuggestion["source"];
  streaming: boolean;
}

/**
 * Historial del copiloto de reuniones (junta y equipo), en el riel y en la
 * ventanita. Antes la tarjeta en curso era UNA y la ventana siguiente la
 * cortaba (se veía arrancar y desaparecer), y la ventanita solo mostraba el
 * último aporte. Ahora cada sugerencia que empieza a escribirse entra a la
 * lista en su lugar — ordenada por el momento de la conversación al que
 * responde — y ahí se queda. Lo que aún no trae texto (o solo el "—" del
 * silencio) es una línea de estado, no una tarjeta.
 */
export function MeetingHelpFeed({ compact = false }: { compact?: boolean }) {
  const live = useLiveMeeting();
  const { items, thinking } = useMemo(() => {
    const done: FeedItem[] = live.suggestions
      .filter((s) => !live.dismissed.has(s.id))
      .map((s) => ({
        id: s.id,
        kind: s.kind,
        text: s.text,
        why: s.why,
        atMs: s.atMs,
        manual: !!s.manual,
        angle: s.angle,
        source: s.source,
        streaming: false,
      }));
    const doneIds = new Set(done.map((d) => d.id));
    const writing = live.streamingSuggestions.filter((s) => !doneIds.has(s.id));
    const visible: FeedItem[] = writing
      .filter((s) => !looksLikeSilence(s.text))
      .map((s) => {
        const { angle, body } = splitStreamingAngle(s.kind, s.text);
        return {
          id: s.id,
          kind: s.kind,
          text: body,
          why: s.trigger,
          atMs: s.atMs,
          manual: false,
          angle,
          source: "fast" as const,
          streaming: true,
        };
      });
    const waiting = writing.filter((s) => looksLikeSilence(s.text));
    return {
      items: [...done, ...visible].sort((a, b) => b.atMs - a.atMs),
      thinking: waiting[waiting.length - 1] ?? null,
    };
  }, [live.suggestions, live.dismissed, live.streamingSuggestions]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {thinking && (
        <p className="flex shrink-0 items-center gap-1.5 text-xs leading-snug text-text-dim">
          <span aria-hidden className="pulse-dot h-1.5 w-1.5 shrink-0 rounded-full bg-cyan" />
          <span className="truncate">
            {live.isTeam ? "Pensando qué aportar" : "Pensando la respuesta"} · {thinking.trigger}
          </span>
        </p>
      )}
      {live.suggesting && (
        <p className="flex shrink-0 items-center gap-1.5 text-xs leading-snug text-text-dim">
          <span aria-hidden className="pulse-dot h-1.5 w-1.5 shrink-0 rounded-full bg-cyan" />
          Analizando la conversación…
        </p>
      )}
      {items.length === 0 ? (
        !thinking &&
        !live.suggesting && (
          <p className="text-xs leading-snug text-text-faint">
            {live.isTeam
              ? live.selfSpeaker
                ? "Te aviso cuando se abra una ventana para aportar y te explico lo que no conozcas. Todo se queda en esta lista."
                : "Marca cuál voz es la tuya: así no te sugiero nada sobre lo que dices tú."
              : "Te soplo la respuesta cuando te pregunten. Todo se queda en esta lista."}
          </p>
        )
      ) : (
        <ol
          aria-label="Historial de sugerencias"
          className="flex min-h-0 flex-1 gap-2 lg:flex-col lg:overflow-y-auto lg:overscroll-contain lg:pr-0.5 max-lg:snap-x max-lg:overflow-x-auto max-lg:pb-1"
        >
          {items.map((it, i) => (
            <li key={it.id} className="shrink-0 max-lg:w-[260px] max-lg:snap-start">
              <MeetingCard item={it} latest={i === 0} compact={compact} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function MeetingCard({ item, latest, compact }: { item: FeedItem; latest: boolean; compact: boolean }) {
  const live = useLiveMeeting();
  const label = item.streaming
    ? (STREAM_LABEL[item.kind] ?? "Dilo ahora")
    : (KIND_STYLE[item.kind] ?? KIND_STYLE.decir).label;
  const showAngle = item.angle && item.angle.toLowerCase() !== label.toLowerCase();
  const border = item.streaming
    ? "border-cyan/40 bg-cyan/5"
    : latest
      ? "border-line-2 bg-panel"
      : "border-line bg-panel";
  const say = SAY_KINDS.has(item.kind);
  return (
    <div className={`group rounded-md border px-2.5 py-2 ${border}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-text-dim">
          {item.streaming && (
            <span aria-hidden className="pulse-dot h-1.5 w-1.5 shrink-0 rounded-full bg-cyan" />
          )}
          <span className="truncate">
            {label}
            {showAngle ? ` · ${item.angle}` : ""}
            {item.manual ? " · a mano" : ""}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {!item.streaming && !compact && (
            <button
              type="button"
              onClick={() => live.dismissSuggestion(item.id)}
              className="h-5 cursor-pointer rounded-xs px-1 text-2xs text-text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:bg-hover hover:text-text focus-visible:opacity-100"
            >
              Quitar
            </button>
          )}
          <span className="font-mono text-2xs text-text-faint tabular-nums">{fmtLiveClock(item.atMs)}</span>
        </span>
      </div>
      {item.streaming || say ? (
        <>
          <p
            className={`mt-1 leading-snug whitespace-pre-line text-text ${say ? (compact ? "text-base" : "text-md") : "text-sm"}`}
          >
            {item.text}
            {item.streaming && <span className="text-text-faint">▍</span>}
          </p>
          {item.why && <p className="mt-1 line-clamp-2 text-xs leading-snug text-text-faint">{item.why}</p>}
        </>
      ) : (
        <SuggestionBody
          s={{ id: item.id, kind: item.kind, text: item.text, why: item.why, atMs: item.atMs }}
        />
      )}
    </div>
  );
}
