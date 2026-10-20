"use client";

// Historial de la compañera de clase: TODO lo que se generó queda, lo más
// nuevo arriba. Antes la tarjeta en curso era una sola y la siguiente
// pregunta la pisaba (se veía arrancar y desaparecer), y la ventanita solo
// mostraba la última ayuda. Ahora cada ayuda que empieza a escribirse entra a
// la lista en su lugar y ahí se queda al terminar.
//
// Lo que aún no trae texto (o trae el "—" con el que el modelo dice "aquí no
// hace falta") no es tarjeta: es una línea de estado, para que nada aparezca
// y se borre.

import { useMemo } from "react";
import { looksLikeSilence, parseClassHelp, type LiveSuggestion } from "@hermes/shared";
import { fmtLiveClock, useLiveMeeting, type StreamingSuggestion } from "@/state/LiveMeetingProvider";

const LABEL: Record<string, string> = {
  decir: "Dilo así",
  andamio: "Para responder",
  explicar: "Qué dijo",
  corregir: "Corrección",
};

/** Triggers de los pedidos a mano que no dicen nada de la conversación. */
const GENERIC_TRIGGER = new Set(["¿Qué dijo?", "frase completa", "pedida a mano"]);

interface FeedItem {
  id: string;
  kind: string;
  text: string;
  /** La pregunta (o lo que dijiste, en una corrección). */
  context: string;
  atMs: number;
  manual: boolean;
  streaming: boolean;
  why?: string;
}

function fromSuggestion(s: LiveSuggestion): FeedItem {
  return {
    id: s.id,
    kind: s.kind,
    text: s.text,
    context: s.kind === "corregir" ? "" : s.why,
    atMs: s.atMs,
    manual: !!s.manual,
    streaming: false,
    why: s.kind === "corregir" ? s.why : undefined,
  };
}

function fromStreaming(s: StreamingSuggestion): FeedItem {
  return {
    id: s.id,
    kind: s.kind,
    text: s.text,
    context: s.trigger,
    atMs: s.atMs,
    manual: GENERIC_TRIGGER.has(s.trigger),
    streaming: true,
  };
}

export function ClassHelpFeed({ compact = false }: { compact?: boolean }) {
  const live = useLiveMeeting();

  const { items, thinking } = useMemo(() => {
    const done = live.suggestions
      .filter((s) => !live.dismissed.has(s.id))
      .filter((s) => s.kind in LABEL)
      .map(fromSuggestion);
    const doneIds = new Set(done.map((d) => d.id));
    const writing = live.streamingSuggestions.filter((s) => !doneIds.has(s.id));
    const visible = writing.filter((s) => !looksLikeSilence(s.text)).map(fromStreaming);
    // Lo que se está pensando sin texto aún: solo la línea de estado (la más reciente).
    const waiting = writing.filter((s) => looksLikeSilence(s.text));
    const all = [...done, ...visible].sort((a, b) => b.atMs - a.atMs);
    return { items: all, thinking: waiting[waiting.length - 1] ?? null };
  }, [live.suggestions, live.dismissed, live.streamingSuggestions]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {thinking && (
        <p className="flex shrink-0 items-center gap-1.5 text-xs leading-snug text-text-dim">
          <span aria-hidden className="pulse-dot h-1.5 w-1.5 shrink-0 rounded-full bg-cyan" />
          <span className="truncate">
            {thinking.kind === "explicar"
              ? "Viendo qué dijo la profe…"
              : GENERIC_TRIGGER.has(thinking.trigger)
                ? "Armando la frase…"
                : `Pensando qué responder a «${thinking.trigger}»`}
          </span>
        </p>
      )}

      {items.length === 0 ? (
        !thinking && (
          <p className="text-xs leading-snug text-text-faint">
            {live.selfSpeaker
              ? "Cuando la profe te pregunte, aquí sale qué decir; al terminar de hablar, la corrección. Todo se queda en esta lista."
              : "Cuando la profe te pregunte, aquí sale qué decir. Marca cuál voz es la tuya para recibir correcciones."}
          </p>
        )
      ) : (
        <ol
          aria-label="Historial de ayudas"
          className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain pr-0.5"
        >
          {items.map((it, i) => (
            <li key={it.id}>
              <HelpCard item={it} latest={i === 0} compact={compact} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function HelpCard({ item, latest, compact }: { item: FeedItem; latest: boolean; compact: boolean }) {
  const live = useLiveMeeting();
  const border = item.streaming ? "border-cyan/40 bg-cyan/5" : latest ? "border-line-2 bg-panel" : "border-line bg-panel";
  const showContext = item.context && !GENERIC_TRIGGER.has(item.context);
  return (
    <div className={`group rounded-md border px-2.5 py-2 ${border}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-text-dim">
          {item.streaming && (
            <span aria-hidden className="pulse-dot h-1.5 w-1.5 shrink-0 rounded-full bg-cyan" />
          )}
          {LABEL[item.kind] ?? "Ayuda"}
          {item.manual ? " · a mano" : ""}
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
      {showContext && (
        <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-text-faint">Profe: «{item.context}»</p>
      )}
      <HelpBody item={item} compact={compact} />
    </div>
  );
}

function HelpBody({ item, compact }: { item: FeedItem; compact: boolean }) {
  const cursor = item.streaming ? <span className="text-text-faint">▍</span> : null;
  const big = compact ? "text-base" : "text-md";

  if (item.kind === "corregir") {
    const [said, better] = item.text.split(" → ");
    return (
      <>
        {better ? (
          <>
            <p className="mt-1 text-xs leading-snug text-text-dim line-through">{said}</p>
            <p className="text-sm leading-snug text-text">{better}</p>
          </>
        ) : (
          <p className="mt-1 text-sm leading-snug text-text">{item.text}</p>
        )}
        {item.why && <p className="mt-0.5 text-xs leading-snug text-text-dim">{item.why}</p>}
      </>
    );
  }

  const parts = parseClassHelp(item.text);
  if (item.kind === "andamio") {
    return (
      <div className="mt-1 flex flex-col gap-1.5">
        {parts.keys.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {parts.keys.map((k) => (
              <span key={k} className="rounded-sm border border-line bg-panel-2 px-1.5 py-0.5 text-xs text-text">
                {k}
              </span>
            ))}
          </div>
        )}
        {parts.start && (
          <p className={`${big} leading-snug text-text`}>
            {parts.start}
            {cursor}
          </p>
        )}
        {!parts.start && parts.main && (
          <p className="text-sm leading-snug whitespace-pre-line text-text">
            {parts.main}
            {cursor}
          </p>
        )}
      </div>
    );
  }

  if (item.kind === "explicar") {
    return (
      <div className="mt-1">
        <p className="text-sm leading-snug whitespace-pre-line text-text">
          {parts.main}
          {cursor}
        </p>
        {parts.keys.length > 0 && (
          <p className="mt-1 text-xs leading-snug text-text-dim">{parts.keys.join(" · ")}</p>
        )}
      </div>
    );
  }

  // FRASE: lo que se dice, en grande; la expresión que sube el nivel, aparte.
  return (
    <div className="mt-1">
      <p className={`${big} leading-snug whitespace-pre-line text-text`}>
        {parts.main}
        {cursor}
      </p>
      {parts.levelUp && (
        <p className="mt-1.5 text-xs leading-snug text-text-dim">
          <span className="font-medium">Sube de nivel:</span>{" "}
          <span className="font-medium text-text">{parts.levelUp.expr}</span>
          {parts.levelUp.meaning ? ` — ${parts.levelUp.meaning}` : ""}
        </p>
      )}
    </div>
  );
}
