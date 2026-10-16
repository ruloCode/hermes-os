"use client";

// Overlay de detalle del evento para las vistas de cuadrícula (Mes/Semana/Día):
// al hacer clic en un evento se abre esta tarjeta centrada con el mismo detalle
// que usa la vista Agenda. Cierra con Esc, con la X o tocando el fondo.

import { useEffect } from "react";
import type { CalendarEvent } from "@hermes/shared";
import { AgendaDetail } from "./AgendaDetail";

export function EventModal({
  event,
  nowMs,
  onClose,
}: {
  event: CalendarEvent | null;
  nowMs: number;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!event) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    // capture: gana al listener global de useHotkeys (que también mira Esc).
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [event, onClose]);

  if (!event) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-bg/70 p-4 backdrop-blur-sm hud-in"
      style={{ animationDuration: "120ms" }}
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Detalle del evento"
        onClick={(e) => e.stopPropagation()}
        className="hud-panel elev-2 relative flex max-h-[85vh] w-full max-w-lg flex-col overflow-y-auto overscroll-contain p-5 pr-12"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar"
          className="absolute top-3 right-3 grid h-7 w-7 cursor-pointer place-items-center rounded-xs text-text-faint transition-colors hover:bg-hover hover:text-text"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden
          >
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
        <AgendaDetail event={event} nowMs={nowMs} />
      </div>
    </div>
  );
}
