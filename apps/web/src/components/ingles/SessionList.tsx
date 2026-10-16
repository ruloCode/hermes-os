"use client";

// Historial de sesiones con el tutor: fila seleccionable (fecha · duración ·
// fluidez · temas). La seleccionada abre su reporte en la columna central.
//
// v5: la fila seleccionada es una capa (`bg-selected`), no una caja con borde
// de acento; las filas no llevan marco. El estado del reporte solo se dice
// cuando NO es el normal (en cola, generando, falló, sin reporte): un
// "reporte" verde en cada una de las trece filas no distinguía nada.

import type { EnglishSession } from "@hermes/shared";
import { Badge } from "@/components/ui/Badge";
import { fmtDay, fmtDuration, fmtTime } from "./report-utils";

// Clases estáticas (Tailwind purga las interpoladas). `done` no figura: es el
// estado normal y no necesita etiqueta.
const STATUS: Partial<Record<EnglishSession["report_status"], { label: string; dot: string }>> = {
  pending: { label: "En cola", dot: "bg-text-faint" },
  running: { label: "Generando", dot: "bg-cyan pulse-dot" },
  skipped: { label: "Sin reporte", dot: "" },
  error: { label: "Falló", dot: "bg-red" },
};

export function SessionList({
  sessions,
  selectedId,
  onSelect,
}: {
  sessions: EnglishSession[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  // Vacío discreto: la explicación (y qué hacer) la da la columna del reporte,
  // que es donde se mira; dos tarjetas de vacío lado a lado decían lo mismo.
  if (sessions.length === 0) {
    return <p className="px-2.5 text-sm text-text-faint">Aún no hay sesiones.</p>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-px overflow-y-auto overscroll-contain pr-1">
      {sessions.map((s) => {
        const active = s.id === selectedId;
        const st = STATUS[s.report_status];
        const time = fmtTime(s.started_at);
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onSelect(s.id)}
            aria-current={active ? "true" : undefined}
            className={`flex w-full cursor-pointer flex-col gap-0.5 rounded-sm px-2.5 py-2 text-left transition-colors ${
              active ? "bg-selected" : "hover:bg-hover"
            }`}
          >
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="truncate text-sm font-medium text-text">{fmtDay(s.started_at)}</span>
              {time && <span className="shrink-0 text-xs text-text-faint tabular-nums">{time}</span>}
              <span className="ml-auto shrink-0 text-xs text-text-dim tabular-nums">
                {s.duration_sec ? fmtDuration(s.duration_sec) : "—"}
              </span>
            </span>
            <span className="flex min-w-0 items-center gap-2 text-xs text-text-faint">
              {s.source === "class" && <Badge size="sm">Clase</Badge>}
              {s.fluency != null && <span className="shrink-0 tabular-nums">Fluidez {s.fluency}/5</span>}
              {s.errors.length > 0 && (
                <span className="shrink-0 tabular-nums">
                  {s.errors.length} {s.errors.length === 1 ? "error" : "errores"}
                </span>
              )}
              {st && (
                <span className="ml-auto flex shrink-0 items-center gap-1.5">
                  {st.dot && <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />}
                  {st.label}
                </span>
              )}
            </span>
            {s.topics.length > 0 && (
              <span className="block truncate text-xs text-text-faint">
                {s.topics.slice(0, 3).join(" · ")}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
