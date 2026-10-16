"use client";

// Presencia de Hermes: el orbe, el estado y la conversación viva, al pie de la
// barra lateral (patrón del panel de voz de Discord/Slack huddles).
//
// Historia corta: v2 puso el orbe de 220px en el home; v4 lo bajó a una
// PresenceBar flotante al centro del pie de TODAS las rutas. Esa barra resolvió
// "la voz es una capa, no una vista", pero se pagaba en cada pantalla: 80px de
// relleno (`pb-20`) para que el último elemento no quedara debajo del orbe, y
// una esfera granate flotando sobre listas y tablas. Aquí la capa sigue
// presente en todas las rutas, pero en el cromo — el lienzo es 100% contenido.
//
// OJO con el layering (no cambió): el canvas del orbe es `fixed inset-0 z-1` y
// la app va en z-2, así que el orbe se dibuja DETRÁS. Por eso el ancla es un
// botón transparente y la barra lateral no pinta fondo. El orbe se dibuja a
// `alto del ancla × 0.3` (VoiceOrb3D): con 44px sale una esfera de ~26px.

import { useEffect, useRef, useState } from "react";
import { useVoiceConnect } from "@/hooks/useVoiceConnect";
import { useOrbState, type OrbState } from "@/components/voice/orbState";
import { useVoice } from "@/components/VoiceBusyContext";
import { VoiceThread } from "@/components/views/VoiceThread";

/** Etiqueta hablada de cada estado. */
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

export function VoiceDock({
  anchorRef,
  collapsed,
  sidebarWidth,
}: {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  collapsed: boolean;
  sidebarWidth: number;
}) {
  const { state } = useOrbState();
  const { connect, disconnect, connected, connecting, configured } = useVoiceConnect();
  const { transcript, action, mode } = useVoice();
  const [open, setOpen] = useState(false);
  // Con la tutora de inglés en la llamada, la que habla es ella, no Hermes.
  const label =
    state === "speaking" && mode === "tutor" ? "La tutora está hablando" : ORB_LABEL[state];

  const enVoz = connected || connecting || transcript.length > 0;
  const live = connected || connecting;
  const last = transcript[transcript.length - 1];

  // Al colgar, la conversación deja de ser "lo que está pasando": se pliega.
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
    if (live) void disconnect();
    else void connect();
  };

  const who = action
    ? null
    : last?.who === "TÚ"
      ? "Tú"
      : last?.who === "TUTOR"
        ? "Tutora"
        : "Hermes";

  return (
    <>
      {/* Hilo desplegado: la conversación completa, junto a la barra. */}
      {open && enVoz && (
        <div
          className="fixed bottom-3 z-40 flex max-h-[62vh] w-[min(440px,calc(100vw-96px))] flex-col rounded-md border border-line bg-panel px-4 pt-3 pb-2 shadow-[var(--shadow-pop)]"
          style={{ left: sidebarWidth + 8 }}
          role="dialog"
          aria-label="Conversación de voz"
        >
          <div className="mb-2 flex shrink-0 items-center justify-between">
            <span className="flex items-center gap-2 text-xs font-medium text-text">
              <span className={`h-1.5 w-1.5 rounded-full ${DOT[state]}`} />
              {label}
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="cursor-pointer rounded-xs px-1.5 py-0.5 text-2xs text-text-faint transition-colors hover:bg-hover hover:text-text"
            >
              Plegar · Esc
            </button>
          </div>
          <VoiceThread />
        </div>
      )}

      <div className={`flex items-center ${collapsed ? "justify-center" : "gap-1.5"}`}>
        {/* Ancla del orbe: transparente a propósito (ver nota de layering). */}
        <button
          type="button"
          ref={anchorRef}
          onClick={toggleVoz}
          disabled={!configured}
          title={live ? "Colgar" : label}
          aria-label={live ? "Colgar la llamada con Hermes" : label}
          className="h-11 w-11 shrink-0 rounded-full transition-transform enabled:cursor-pointer enabled:hover:scale-105 enabled:active:scale-95 disabled:opacity-40"
        />
        {!collapsed && (
          <button
            type="button"
            onClick={() => (enVoz ? setOpen((v) => !v) : configured && toggleVoz())}
            disabled={!configured && !enVoz}
            aria-expanded={enVoz ? open : undefined}
            className="flex min-w-0 flex-1 cursor-pointer flex-col items-start rounded-sm px-1.5 py-1 text-left transition-colors hover:bg-hover disabled:cursor-default disabled:hover:bg-transparent"
          >
            <span className="flex w-full items-center gap-1.5 text-sm font-medium text-text">
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[state]} ${state === "connecting" ? "pulse-dot" : ""}`}
              />
              <span className="truncate">{live ? label : enVoz ? "Conversación" : label}</span>
            </span>
            <span className="w-full truncate text-2xs text-text-faint">
              {enVoz && (action || last)
                ? `${who ? `${who}: ` : ""}${action ?? last?.text ?? ""}`
                : configured
                  ? "Clic en el orbe para llamar"
                  : "Falta el agente de ElevenLabs"}
            </span>
          </button>
        )}
      </div>
    </>
  );
}
