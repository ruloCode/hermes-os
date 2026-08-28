"use client";

// Detalle completo del evento seleccionado en la página AGENDA: fecha larga,
// rango horario + duración, ubicación y notas (DESCRIPTION del ICS). Solo
// lectura — el feed de Google es un espejo, no se edita desde aquí.

import type { CalendarEvent } from "@hermes/shared";
import { Badge } from "@/components/ui/Badge";
import { PanelState } from "@/components/ui/PanelState";
import {
  durationLabel,
  eventState,
  fullDateLabel,
  relativeLabel,
  stateTone,
  timeRangeLabel,
} from "@/lib/agenda";

const STATE_LABEL = {
  "en-curso": "En curso",
  proximo: "Próximo",
  pasado: "Terminado",
} as const;

/** Fila de metadato: etiqueta uppercase a la izquierda, valor a la derecha. */
function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 border-t border-line py-2.5">
      <span className="w-20 shrink-0 text-2xs tracking-label text-text-dim uppercase">{label}</span>
      <span className="min-w-0 flex-1 text-sm text-text">{children}</span>
    </div>
  );
}

export function AgendaDetail({ event, nowMs }: { event: CalendarEvent | null; nowMs: number }) {
  if (!event) {
    return (
      <PanelState
        kind="empty"
        title="Ningún evento seleccionado"
        hint="Elige un evento de la agenda para ver su detalle completo."
      />
    );
  }

  const state = eventState(event, nowMs);
  const tone = stateTone(state);
  const duration = durationLabel(event);

  return (
    <div className="flex min-h-0 flex-col gap-4">
      {/* Título + estado */}
      <div className="flex items-start justify-between gap-3">
        <h2 className="min-w-0 font-display text-xl leading-tight text-text">{event.title}</h2>
        <span className="shrink-0 pt-1">
          <Badge tone={tone} variant="solid">
            {state === "en-curso" ? "● " : ""}
            {STATE_LABEL[state]}
          </Badge>
        </span>
      </div>

      {/* Metadatos */}
      <div className="flex flex-col">
        <MetaRow label="Fecha">{fullDateLabel(event)}</MetaRow>
        <MetaRow label="Horario">
          <span className="tabular-nums">{timeRangeLabel(event)}</span>
          {duration && <span className="ml-2 text-text-dim">· {duration}</span>}
        </MetaRow>
        <MetaRow label="Cuándo">
          <span className={state === "en-curso" ? "text-green" : "text-text"}>
            {relativeLabel(event, nowMs)}
          </span>
        </MetaRow>
        {event.location && (
          <MetaRow label="Lugar">
            <span className="inline-flex items-start gap-1.5">
              <span aria-hidden className="pt-0.5 text-text-dim">
                ◍
              </span>
              {event.location}
            </span>
          </MetaRow>
        )}
      </div>

      {/* Notas (DESCRIPTION del evento) */}
      {event.description ? (
        <div className="flex min-h-0 flex-1 flex-col gap-2 border-t border-line pt-3">
          <span className="text-2xs tracking-label text-text-dim uppercase">Notas</span>
          <p className="text-sm leading-relaxed whitespace-pre-wrap text-text/90">
            {event.description}
          </p>
        </div>
      ) : (
        <p className="border-t border-line pt-3 text-2xs text-text-faint">Sin notas.</p>
      )}
    </div>
  );
}
