"use client";

// Presencia de Hermes: el orbe, el estado y la conversación viva, anclados al
// pie de TODAS las rutas.
//
// Por qué se movió aquí desde el home (rediseño v4):
//  - La voz es el 88% de las conversaciones, y `VoiceThread` se renderizaba en
//    UN solo sitio: el tab consola del Orquestador. Si hablabas mientras
//    editabas un guion en Estudio o revisabas Finanzas, la conversación estaba
//    ocurriendo en una pantalla que no estabas viendo. La voz no es una vista:
//    es una capa, y las capas viven en el shell.
//  - En el home el orbe ocupaba 220px + 132px de margen calculado a mano para
//    que los anillos no pisaran el saludo: casi la mitad del alto útil para lo
//    que, en esencia, es un botón de llamada. Aquí el ancla mide 64px y el
//    orbe ~38px: el sobrante es el aire que necesita el glow, no relleno.
//    (El orbe se dibuja a `alto del ancla x 0.3`, ver VoiceOrb3D: con un ancla
//    de 40px salía una esfera de 24px y el bloom se la comía entera.)
//
// OJO con el layering: el canvas del orbe es `fixed inset-0 z-1` y el árbol de
// la app va en z-2, así que el orbe se dibuja DETRÁS del contenido. Por eso el
// ancla es un botón transparente y la píldora de estado va AL LADO, nunca
// encima — si la píldora cubriera el ancla, el orbe desaparecería.

import { useEffect, useRef, useState } from "react";
import { useVoiceConnect } from "@/hooks/useVoiceConnect";
import { useOrbState, type OrbState } from "@/components/voice/orbState";
import { useVoice } from "@/components/VoiceBusyContext";
import { VoiceThread } from "@/components/views/VoiceThread";

/** Etiqueta hablada de cada estado. Única fuente: la topbar y el home la leen. */
export const ORB_LABEL: Record<OrbState, string> = {
  na: "Voz no configurada",
  off: "Hablar con Hermes",
  connecting: "Conectando…",
  listening: "Escuchando",
  speaking: "Hermes está hablando",
  exec: "Ejecutando",
};

/** Color del punto de estado. Semántica, no decoración. */
const DOT: Record<OrbState, string> = {
  na: "bg-text-faint",
  off: "bg-text-faint",
  connecting: "bg-amber",
  listening: "bg-green",
  speaking: "bg-accent",
  exec: "bg-cyan",
};

export function PresenceBar({
  anchorRef,
}: {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const { state } = useOrbState();
  const { connect, disconnect, connected, connecting, configured } = useVoiceConnect();
  const { transcript, action } = useVoice();
  const [open, setOpen] = useState(false);

  const enVoz = connected || connecting || transcript.length > 0;
  const last = transcript[transcript.length - 1];

  // Al colgar, la conversación deja de ser "lo que está pasando": se pliega
  // sola para no dejar un panel grande tapando la vista que sí estás usando.
  const wasEnVoz = useRef(enVoz);
  useEffect(() => {
    if (wasEnVoz.current && !enVoz) setOpen(false);
    wasEnVoz.current = enVoz;
  }, [enVoz]);

  // Esc pliega el hilo antes que cualquier otra cosa del workspace.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      e.stopPropagation();
      setOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  const toggleVoz = () => {
    if (connected || connecting) void disconnect();
    else void connect();
  };

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-3 flex flex-col items-center pb-2">
      {/* Hilo desplegado: la conversación completa, encima de la barra. */}
      {open && enVoz && (
        <div className="pointer-events-auto mb-3 flex max-h-[46vh] w-[min(680px,calc(100vw-32px))] flex-col rounded-md border border-line bg-panel px-4 pt-3 pb-2 shadow-[var(--shadow-pop)]">
          <div className="mb-2 flex shrink-0 items-center justify-between">
            <span className="text-2xs text-text-dim">Conversación</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="cursor-pointer rounded-xs px-1.5 py-0.5 text-2xs text-text-dim transition-colors hover:text-text"
            >
              Plegar · Esc
            </button>
          </div>
          <VoiceThread />
        </div>
      )}

      <div className="pointer-events-auto flex items-center gap-2">
        {/* Ancla del orbe: transparente a propósito (ver nota de layering). */}
        <button
          type="button"
          ref={anchorRef}
          onClick={toggleVoz}
          disabled={!configured}
          title={ORB_LABEL[state]}
          aria-label={ORB_LABEL[state]}
          className="h-16 w-16 shrink-0 rounded-full transition-transform enabled:cursor-pointer enabled:hover:scale-105 enabled:active:scale-95 disabled:opacity-40"
        />

        <button
          type="button"
          onClick={() => enVoz && setOpen((v) => !v)}
          disabled={!enVoz}
          aria-expanded={enVoz ? open : undefined}
          className={`flex max-w-[min(520px,calc(100vw-120px))] items-center gap-2 rounded-full border border-line bg-panel py-1.5 pr-3 pl-3 text-xs text-text-dim shadow-[var(--shadow-card)] transition-colors ${
            enVoz ? "cursor-pointer hover:border-line-2 hover:text-text" : ""
          }`}
        >
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[state]} ${state === "connecting" ? "pulse-dot" : ""}`}
          />
          {/* Con llamada viva manda la última línea; en reposo, el estado. */}
          {enVoz && (action || last) ? (
            <>
              <span className="shrink-0 text-text-faint">
                {action ? "·" : last?.who === "TÚ" ? "Tú" : "Hermes"}
              </span>
              <span className="truncate">{action ?? last?.text}</span>
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`shrink-0 text-text-faint transition-transform ${open ? "rotate-180" : ""}`}
                aria-hidden
              >
                <path d="m6 15 6-6 6 6" />
              </svg>
            </>
          ) : (
            <span className="truncate">{ORB_LABEL[state]}</span>
          )}
        </button>
      </div>
    </div>
  );
}
