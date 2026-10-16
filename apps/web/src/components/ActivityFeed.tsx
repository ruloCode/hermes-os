"use client";

import { useEffect, useRef } from "react";
import type { AgentActivityEvent } from "@hermes/shared";
import { PanelState } from "@/components/ui/PanelState";
import { ViewHeader } from "@/components/ui/ViewHeader";

// Marca por tipo de evento: un punto. El color es ESTADO (cyan arranca/en
// curso, verde terminó, rojo falló); el resto va en gris. v4 pintaba cada tipo
// de un color distinto con glifos (▶ ⚙ ↩ ◆) y la lista se leía como arcoíris.
const KIND_STYLE: Record<string, { dot: string; label: string }> = {
  task_start: { dot: "bg-cyan", label: "Inicio de tarea" },
  tool_call: { dot: "bg-text-dim", label: "Herramienta" },
  tool_result: { dot: "bg-line-2", label: "Resultado" },
  text: { dot: "bg-line-2", label: "Texto" },
  task_done: { dot: "bg-green", label: "Tarea terminada" },
  error: { dot: "bg-red", label: "Error" },
  session_start: { dot: "bg-text-dim", label: "Sesión" },
};

export function ActivityFeed({ events }: { events: AgentActivityEvent[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [events.length]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ViewHeader
        title="Actividad"
        meta={
          events.length > 0
            ? `${events.length} ${events.length === 1 ? "evento" : "eventos"} en esta sesión`
            : undefined
        }
      />
      {/* min-w-0 en cada nivel: una línea de log (un comando de Bash, un JSON)
          no puede fijar el ancho de la vista. Se recorta con … y el title
          guarda el texto completo. */}
      <div ref={ref} className="-mx-2 min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-2">
        {events.length === 0 && (
          <PanelState
            kind="empty"
            title="Sin actividad"
            hint="El feed se llena cuando el agente trabaja: tareas, herramientas y resultados en vivo."
          />
        )}
        {events.map((ev, i) => {
          const st = KIND_STYLE[ev.kind] ?? KIND_STYLE.text;
          const detail = ev.detail ?? ev.kind;
          return (
            <div
              key={i}
              title={ev.toolName ? `${ev.toolName} ${detail}` : detail}
              className="flex h-8 min-w-0 items-center gap-3 rounded-sm px-2 text-sm transition-colors hover:bg-hover"
            >
              <span className="w-[62px] shrink-0 font-mono text-2xs text-text-faint tabular-nums">
                {ev.ts.slice(11, 19)}
              </span>
              <span
                aria-label={st.label}
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${st.dot}`}
              />
              <span className="min-w-0 flex-1 truncate">
                {ev.toolName && <span className="mr-1.5 font-medium text-text">{ev.toolName}</span>}
                <span className={ev.kind === "error" ? "text-text" : "text-text-dim"}>{detail}</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
