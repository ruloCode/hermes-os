"use client";

// Detalle de una sesión: reporte completo del coach (markdown con Análisis /
// Errores recurrentes / Drills), aciertos, errores anotados por el tutor y el
// transcript (se trae bajo demanda — la lista no lo carga).

import { useEffect, useState } from "react";
import type { EnglishSession } from "@hermes/shared";
import { Markdown } from "@/components/Markdown";
import { PanelState } from "@/components/ui/PanelState";
import { getEnglishSessionDetail } from "@/lib/hermes";
import { fmtDate, fmtDuration } from "./report-utils";

export function SessionDetail({ session }: { session: EnglishSession | null }) {
  const [transcript, setTranscript] = useState<string | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);

  // El transcript se busca al seleccionar (y se descarta al cambiar de sesión).
  useEffect(() => {
    setTranscript(null);
    setShowTranscript(false);
    if (!session) return;
    let alive = true;
    void getEnglishSessionDetail(session.id).then((d) => {
      if (alive && d) setTranscript(d.transcript);
    });
    return () => {
      alive = false;
    };
  }, [session?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!session) {
    return (
      <PanelState
        kind="empty"
        compact
        title="Elige una sesión"
        hint="El reporte del coach aparece aquí."
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-y-auto overscroll-contain pr-1">
      {/* Encabezado factual de la sesión */}
      <div className="flex shrink-0 flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line pb-2">
        <span className="font-display text-sm text-text tabular-nums">
          {fmtDate(session.started_at)}
        </span>
        <span className="text-2xs text-text-dim tabular-nums">
          {session.duration_sec ? fmtDuration(session.duration_sec) : "—"}
        </span>
        {session.fluency != null && (
          <span className="text-2xs text-green tabular-nums">fluidez {session.fluency}/5</span>
        )}
        {session.topics.length > 0 && (
          <span className="min-w-0 truncate text-2xs text-text-dim">
            {session.topics.join(" · ")}
          </span>
        )}
        <span className="ml-auto text-2xs tracking-label text-text-faint uppercase">
          {session.source}
        </span>
      </div>

      {/* Reporte del coach (o su estado) */}
      {session.report_md ? (
        <Markdown source={session.report_md} />
      ) : session.report_status === "pending" || session.report_status === "running" ? (
        <PanelState kind="loading" compact title="El coach está analizando la sesión…" />
      ) : session.report_status === "error" ? (
        <p className="text-2xs text-red">
          El reporte falló — los errores anotados por el tutor siguen abajo.
        </p>
      ) : (
        <p className="text-2xs text-text-dim">
          Sesión corta: sin reporte del coach. Lo anotado por el tutor va abajo.
        </p>
      )}

      {/* Aciertos y errores crudos del tutor (complementan al reporte) */}
      {session.wins.length > 0 && (
        <div className="shrink-0">
          <h3 className="text-2xs tracking-label text-green uppercase">Aciertos</h3>
          <ul className="mt-1 space-y-0.5 text-xs leading-snug text-text-dim">
            {session.wins.map((w) => (
              <li key={w}>✓ {w}</li>
            ))}
          </ul>
        </div>
      )}
      {!session.report_md && session.errors.length > 0 && (
        <div className="shrink-0">
          <h3 className="text-2xs tracking-label text-red uppercase">Errores anotados</h3>
          <ul className="mt-1 space-y-1 text-xs leading-snug text-text-dim">
            {session.errors.map((e) => (
              <li key={e.quote}>
                “{e.quote}” → <span className="text-text">“{e.correction}”</span>
                {e.note_es ? ` — ${e.note_es}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Transcript bajo demanda */}
      {transcript && (
        <div className="shrink-0 border-t border-line pt-2">
          <button
            type="button"
            onClick={() => setShowTranscript((v) => !v)}
            className="text-2xs tracking-label text-text-dim uppercase transition-colors hover:text-text"
          >
            {showTranscript ? "▾ ocultar transcript" : "▸ ver transcript"}
          </button>
          {showTranscript && (
            <pre className="mt-2 max-h-72 overflow-y-auto rounded-sm border border-line bg-panel-2 p-2 text-2xs leading-relaxed whitespace-pre-wrap text-text-dim">
              {transcript}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
