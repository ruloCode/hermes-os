"use client";

// Recomendaciones accionables del último reporte del coach: drills para la
// próxima sesión y patrones de error que se repiten. Cada drill se puede
// convertir en tarea del proyecto Inglés en Linear (Hermes la crea con
// contexto + Copy prompt). Los drills además alimentan {{practice_context}}:
// el tutor abre la próxima clase calentando con ellos.
//
// v5: los subtítulos dejan de ir en cyan/ámbar con mayúsculas (eran etiquetas,
// no estados) y cada drill deja de ser una caja: filas con una hairline, el
// texto en el color de lectura y la acción como botón fantasma.

import { useMemo, useState } from "react";
import type { EnglishSession } from "@hermes/shared";
import { Button } from "@/components/ui/Button";
import { PanelState } from "@/components/ui/PanelState";
import { createLinearTask } from "@/lib/hermes";
import { extractBullets, extractSection, fmtDate, fmtDay, latestReported } from "./report-utils";

export function EnglishRecs({ sessions }: { sessions: EnglishSession[] }) {
  const [sent, setSent] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  const source = useMemo(() => latestReported(sessions), [sessions]);
  const { drills, patterns } = useMemo(() => {
    if (!source?.report_md) return { drills: [], patterns: [] };
    const md = source.report_md;
    return {
      drills: extractBullets(extractSection(md, "Drills") ?? ""),
      patterns: extractBullets(extractSection(md, "Errores recurrentes") ?? ""),
    };
  }, [source]);

  if (!source) {
    return (
      <PanelState
        kind="empty"
        compact
        title="Aún sin recomendaciones"
        hint="Al terminar una sesión, el coach genera drills y patrones aquí."
      />
    );
  }

  const toTask = async (drill: string) => {
    setBusy(drill);
    const ok = await createLinearTask(
      `Drill de práctica de inglés (del reporte del ${fmtDate(source.started_at)}): ${drill}. Crea una tarea corta y concreta para practicarlo en la próxima sesión con el tutor.`,
      "ingles",
    );
    setBusy(null);
    if (ok) setSent((s) => new Set(s).add(drill));
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col">
        <h3 className="px-2 pb-1 text-xs font-medium text-text-dim">Drills para la próxima sesión</h3>
        {drills.length === 0 && (
          <p className="px-2 text-xs text-text-faint">El último reporte no trae drills.</p>
        )}
        <ul className="flex flex-col">
          {drills.map((d) => (
            <li
              key={d}
              className="flex flex-col gap-1.5 border-t border-line px-2 py-2.5 first:border-t-0"
            >
              <p className="text-sm leading-relaxed text-text">{d}</p>
              {sent.has(d) ? (
                <span
                  className="flex items-center gap-1.5 text-xs text-text-faint"
                  title="Tarea creada en Linear"
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                    className="text-green"
                  >
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                  Tarea creada en Linear
                </span>
              ) : (
                <Button
                  variant="ghost"
                  onClick={() => void toTask(d)}
                  disabled={busy === d}
                  title="Crear tarea en Linear (proyecto Inglés)"
                  className="-ml-2.5 self-start"
                  icon={
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      aria-hidden
                    >
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                  }
                >
                  {busy === d ? "Creando…" : "Convertir en tarea"}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </div>

      {patterns.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="px-2 text-xs font-medium text-text-dim">Se repiten</h3>
          <ul className="flex list-disc flex-col gap-1.5 pr-2 pl-6 text-sm leading-relaxed text-text-dim marker:text-text-faint">
            {patterns.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      <p className="px-2 text-xs text-text-faint">
        Del reporte del {fmtDay(source.started_at)}: el tutor abre la próxima sesión con estos
        drills.
      </p>
    </div>
  );
}
