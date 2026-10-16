"use client";

// Tira de métricas de la vista Inglés (patrón Memrise/Speak de Mobbin): racha,
// sesiones, tiempo hablado, fluidez con tendencia y vocabulario — todo real.
//
// v5: una tira serena, no un tablero. Antes cada número llevaba su color
// (tiempo en cyan, fluidez en verde, racha en ámbar) y ninguno era un estado:
// eran cinco colores para cinco etiquetas. Ahora el número va en el color del
// texto, la etiqueta en gris y la tendencia en neutro; el color queda libre
// para lo que sí es estado. Los botones de acción se fueron a la cabecera de
// la vista (ViewHeader), que es donde viven las acciones de toda la página.

import type { ReactNode } from "react";
import type { EnglishSession, VocabEntry } from "@hermes/shared";
import { Sparkline } from "@/components/ui/Sparkline";

function Stat({
  label,
  value,
  unit,
  children,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  /** Visual pequeño al lado del número (tendencia, progreso). */
  children?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 border-l border-line px-6 first:border-l-0 first:pl-0">
      <dt className="text-xs text-text-faint">{label}</dt>
      <dd className="flex items-end gap-3">
        <span className="text-xl leading-none font-semibold text-text tabular-nums">
          {value}
          {unit && <span className="ml-1 text-sm font-normal text-text-faint">{unit}</span>}
        </span>
        {children}
      </dd>
    </div>
  );
}

export function EnglishStats({
  sessions,
  vocab,
  streak,
}: {
  sessions: EnglishSession[];
  vocab: VocabEntry[];
  /** Racha del hábito "Práctica de inglés" (null si aún no existe). */
  streak: number | null;
}) {
  const totalSec = sessions.reduce((a, s) => a + (s.duration_sec ?? 0), 0);
  const totalMin = Math.round(totalSec / 60);
  // Cronológico para la tendencia (la lista llega de reciente a vieja).
  const fluencyTrend = sessions
    .filter((s) => s.fluency != null)
    .map((s) => s.fluency as number)
    .reverse()
    .slice(-8);
  const lastFluency = fluencyTrend[fluencyTrend.length - 1];
  const learned = vocab.filter((v) => v.learned).length;

  return (
    <dl className="flex flex-wrap items-stretch gap-y-4">
      {streak != null && streak > 0 && (
        <Stat label="Racha" value={streak} unit={streak === 1 ? "día" : "días"} />
      )}
      <Stat label="Sesiones" value={sessions.length} />
      {totalMin > 0 && (
        <Stat
          label="Tiempo hablado"
          value={totalMin < 60 ? totalMin : (totalMin / 60).toFixed(1)}
          unit={totalMin < 60 ? "min" : "h"}
        />
      )}
      {lastFluency != null && (
        <Stat label="Fluidez" value={lastFluency} unit="/ 5">
          {/* Caja acotada: el spark suelto crece al alto por defecto del svg */}
          {fluencyTrend.length >= 2 && (
            <span className="mb-0.5 block h-4 w-20" title="Fluidez de las últimas sesiones">
              <Sparkline data={fluencyTrend} max={5} tone="neutral" height={16} width={80} />
            </span>
          )}
        </Stat>
      )}
      {vocab.length > 0 && (
        <Stat label="Vocabulario" value={`${learned}/${vocab.length}`} unit="aprendidas">
          <span
            className="mb-1 block h-1 w-20 overflow-hidden rounded-full bg-line-2"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={vocab.length}
            aria-valuenow={learned}
            aria-label="Vocabulario aprendido"
          >
            <span
              className="block h-full rounded-full bg-text-dim"
              style={{ width: `${(learned / Math.max(vocab.length, 1)) * 100}%` }}
            />
          </span>
        </Stat>
      )}
    </dl>
  );
}
