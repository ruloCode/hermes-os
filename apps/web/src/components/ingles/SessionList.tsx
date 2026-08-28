"use client";

// Historial de sesiones con el tutor: fila seleccionable (fecha · duración ·
// fluidez · temas) + estado del reporte. La seleccionada abre su detalle en
// el panel central de la vista.

import type { EnglishSession } from "@hermes/shared";
import { PanelState } from "@/components/ui/PanelState";
import { fmtDate, fmtDuration } from "./report-utils";

const STATUS: Record<EnglishSession["report_status"], { label: string; cls: string }> = {
  pending: { label: "en cola", cls: "text-text-dim" },
  running: { label: "generando…", cls: "text-cyan" },
  done: { label: "reporte", cls: "text-green" },
  skipped: { label: "corta", cls: "text-text-faint" },
  error: { label: "falló", cls: "text-red" },
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
  if (sessions.length === 0) {
    return (
      <PanelState
        kind="empty"
        compact
        title="Sin sesiones todavía"
        hint='Di "Hermes, quiero practicar inglés" o usa ⌘K → Practicar inglés.'
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-1 overflow-y-auto overscroll-contain pr-1">
      {sessions.map((s) => {
        const active = s.id === selectedId;
        const st = STATUS[s.report_status];
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onSelect(s.id)}
            aria-current={active ? "true" : undefined}
            className={`rounded-sm border px-2 py-1.5 text-left transition-colors ${
              active ? "border-violet bg-violet/10" : "border-line hover:bg-panel-2"
            }`}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-display text-xs text-text tabular-nums">
                {fmtDate(s.started_at)}
              </span>
              <span className={`shrink-0 text-2xs tracking-label uppercase ${st.cls}`}>
                {st.label}
              </span>
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-2xs text-text-dim">
              <span className="tabular-nums">
                {s.duration_sec ? fmtDuration(s.duration_sec) : "—"}
              </span>
              {s.fluency != null && (
                <span className="text-green tabular-nums">fluidez {s.fluency}/5</span>
              )}
              {s.errors.length > 0 && (
                <span className="tabular-nums">{s.errors.length} err</span>
              )}
            </div>
            {s.topics.length > 0 && (
              <p className="mt-0.5 truncate text-2xs text-text-faint">
                {s.topics.slice(0, 3).join(" · ")}
              </p>
            )}
          </button>
        );
      })}
    </div>
  );
}
