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
        className="hud-panel relative flex max-h-[85vh] w-full max-w-lg flex-col overflow-y-auto overscroll-contain p-5"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar"
          className="absolute top-3 right-3 grid h-6 w-6 place-items-center rounded-sm border border-line text-text-dim transition-colors hover:border-line-2 hover:text-text"
        >
          ✕
        </button>
        <AgendaDetail event={event} nowMs={nowMs} />
      </div>
    </div>
  );
}
