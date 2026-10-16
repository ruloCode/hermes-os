"use client";

// Detalle de una sesión: reporte completo del coach (markdown con Análisis /
// Errores recurrentes / Drills), aciertos, errores anotados por el tutor y el
// transcript (se trae bajo demanda — la lista no lo carga).
//
// v5: se LEE como un artículo, no como una tarjeta. Columna de ~68 caracteres
// (la medida cómoda para leer párrafos largos), títulos en el color del texto
// y el cuerpo un paso más tenue para que los títulos ordenen la lectura. Sin
// marco: el reporte es el contenido, no algo dentro de una caja.

import { useEffect, useState } from "react";
import type { EnglishSession } from "@hermes/shared";
import { Markdown } from "@/components/Markdown";
import { Button } from "@/components/ui/Button";
import { PanelState } from "@/components/ui/PanelState";
import { getEnglishSessionDetail } from "@/lib/hermes";
import { fmtDayLong, fmtDuration, fmtTime } from "./report-utils";

const SOURCE_LABEL: Record<string, string> = {
  class: "Clase en vivo",
  mobile: "Práctica desde el móvil",
  web: "Práctica con la tutora",
  meeting: "Junta en inglés",
};

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={`transition-transform ${open ? "rotate-90" : ""}`}
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

export function SessionDetail({
  session,
  onReviewWithTutor,
}: {
  session: EnglishSession | null;
  /** Clase real: practicar sus errores con la tutora de voz (abre la llamada). */
  onReviewWithTutor?: () => void;
}) {
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

  const day = fmtDayLong(session.started_at);
  const title = day.charAt(0).toUpperCase() + day.slice(1);
  const meta = [
    fmtTime(session.started_at),
    session.duration_sec ? fmtDuration(session.duration_sec) : null,
    session.fluency != null ? `Fluidez ${session.fluency}/5` : null,
    SOURCE_LABEL[session.source] ?? session.source,
  ].filter(Boolean);

  return (
    <div className="h-full min-h-0 overflow-y-auto overscroll-contain pr-2">
      <article className="mx-auto flex max-w-[68ch] flex-col gap-5 pb-8">
        {/* Encabezado factual de la sesión */}
        <header className="flex flex-col gap-1.5">
          <h2 className="text-lg font-semibold text-text">{title}</h2>
          <p className="text-xs text-text-faint tabular-nums">{meta.join(" · ")}</p>
          {session.topics.length > 0 && (
            <p className="text-xs text-text-dim">{session.topics.join(" · ")}</p>
          )}
        </header>

        {/* Clase real → la tutora abre con sus errores ({{practice_context}}). */}
        {session.source === "class" && onReviewWithTutor && (
          <div className="flex flex-wrap items-center gap-3 rounded-sm border border-line bg-panel px-3.5 py-2.5">
            <p className="min-w-0 flex-1 text-sm leading-snug text-text-dim">
              Repasa esta clase con la tutora: te pregunta cómo te fue y practica tus errores
              principales.
            </p>
            <Button onClick={onReviewWithTutor}>Repasar ahora</Button>
          </div>
        )}

        {/* Reporte del coach (o su estado). El cuerpo va en `text-dim` y los
            títulos en `text`: `.md` vive fuera de @layer y le gana a una
            utilidad normal, por eso el color del cuerpo va con `!`. */}
        {session.report_md ? (
          <div className="[&_.md]:text-text-dim! [&_.md]:leading-[1.7] [&_strong]:font-semibold [&_strong]:text-text">
            <Markdown source={session.report_md} />
          </div>
        ) : session.report_status === "pending" || session.report_status === "running" ? (
          <PanelState kind="loading" compact title="El coach está analizando la sesión…" />
        ) : session.report_status === "error" ? (
          <p className="text-sm text-text-dim">
            <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-red align-middle" />
            El reporte falló — los errores anotados por el tutor siguen abajo.
          </p>
        ) : (
          <p className="text-sm text-text-dim">
            Sesión corta: sin reporte del coach. Lo anotado por el tutor va abajo.
          </p>
        )}

        {/* Aciertos y errores crudos del tutor (complementan al reporte) */}
        {session.wins.length > 0 && (
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-text">Aciertos</h3>
            <ul className="flex flex-col gap-1.5 text-sm leading-relaxed text-text-dim">
              {session.wins.map((w) => (
                <li key={w} className="flex gap-2">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                    className="mt-[3px] shrink-0 text-green"
                  >
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                  <span className="min-w-0">{w}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {!session.report_md && session.errors.length > 0 && (
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-text">
              {session.source === "class" ? "Correcciones de la clase" : "Errores anotados"}
            </h3>
            <ul className="flex flex-col gap-2 text-sm leading-relaxed text-text-dim">
              {session.errors.map((e) => (
                <li key={e.quote}>
                  <span className="line-through decoration-text-faint">{e.quote}</span>
                  <span className="px-1.5 text-text-faint">→</span>
                  <span className="text-text">{e.correction}</span>
                  {e.note_es && <span className="block text-xs text-text-faint">{e.note_es}</span>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Transcript bajo demanda */}
        {transcript && (
          <section className="flex flex-col gap-2 border-t border-line pt-4">
            <button
              type="button"
              onClick={() => setShowTranscript((v) => !v)}
              aria-expanded={showTranscript}
              className="-ml-1.5 flex h-7 cursor-pointer items-center gap-1.5 self-start rounded-xs px-1.5 text-xs text-text-dim transition-colors hover:bg-hover hover:text-text"
            >
              <Chevron open={showTranscript} />
              {showTranscript ? "Ocultar transcript" : "Ver transcript"}
            </button>
            {showTranscript && (
              <pre className="max-h-96 overflow-y-auto rounded-sm border border-line bg-panel-2 p-3 font-sans text-xs leading-relaxed whitespace-pre-wrap text-text-dim">
                {transcript}
              </pre>
            )}
          </section>
        )}
      </article>
    </div>
  );
}
