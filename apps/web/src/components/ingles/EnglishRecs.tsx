"use client";

// Recomendaciones accionables del último reporte del coach: drills para la
// próxima sesión y patrones de error que se repiten. Cada drill se puede
// convertir en tarea del proyecto Inglés en Linear (Hermes la crea con
// contexto + Copy prompt). Los drills además alimentan {{practice_context}}:
// el tutor abre la próxima clase calentando con ellos.

import { useMemo, useState } from "react";
import type { EnglishSession } from "@hermes/shared";
import { PanelState } from "@/components/ui/PanelState";
import { createLinearTask } from "@/lib/hermes";
import { extractBullets, extractSection, fmtDate, latestReported } from "./report-utils";

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
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-y-auto overscroll-contain pr-1">
      <div>
        <h3 className="text-2xs tracking-label text-cyan uppercase">
          Drills · próxima sesión
        </h3>
        {drills.length === 0 && (
          <p className="mt-1 text-2xs text-text-dim">El último reporte no trae drills.</p>
        )}
        <ul className="mt-1 space-y-1.5">
          {drills.map((d) => (
            <li key={d} className="flex items-start gap-2 rounded-sm border border-line px-2 py-1.5">
              <span className="min-w-0 flex-1 text-xs leading-snug text-text">{d}</span>
              {sent.has(d) ? (
                <span className="shrink-0 text-2xs text-green" title="Tarea creada en Linear">
                  ✓ tarea
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => void toTask(d)}
                  disabled={busy === d}
                  title="Crear tarea en Linear (proyecto Inglés)"
                  className="shrink-0 rounded-sm border border-line px-1.5 py-0.5 text-2xs tracking-label text-text-dim uppercase transition-colors hover:border-violet hover:text-violet disabled:opacity-40"
                >
                  {busy === d ? "…" : "→ tarea"}
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>

      {patterns.length > 0 && (
        <div>
          <h3 className="text-2xs tracking-label text-amber uppercase">Se repiten</h3>
          <ul className="mt-1 space-y-1 text-xs leading-snug text-text-dim">
            {patterns.map((p) => (
              <li key={p}>• {p}</li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-auto shrink-0 border-t border-line pt-1.5 text-2xs text-text-faint">
        Del reporte del {fmtDate(source.started_at)} — el tutor abre la próxima sesión con estos
        drills.
      </p>
    </div>
  );
}
