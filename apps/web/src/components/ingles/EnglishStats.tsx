"use client";

// Hero de la vista Inglés (patrón Memrise/Speak de Mobbin): racha, sesiones,
// tiempo hablado, fluidez con tendencia y vocabulario — todo real — más el
// CTA que conecta la voz con el tutor.

import type { EnglishSession, VocabEntry } from "@hermes/shared";
import { BarMeter } from "@/components/ui/BarMeter";
import { Sparkline } from "@/components/ui/Sparkline";
import { StatBlock } from "@/components/ui/StatBlock";

export function EnglishStats({
  sessions,
  vocab,
  streak,
  tutorConfigured,
  live,
  onPractice,
  onStop,
  classBusy,
  onClass,
}: {
  sessions: EnglishSession[];
  vocab: VocabEntry[];
  /** Racha del hábito "Práctica de inglés" (null si aún no existe). */
  streak: number | null;
  tutorConfigured: boolean;
  /** Práctica en vivo activa: el CTA se vuelve "Terminar práctica". */
  live: boolean;
  onPractice: () => void;
  onStop: () => void;
  /** Hay clase (o junta) en vivo: el control vive en su vista, aquí no se ofrece nada. */
  classBusy: boolean;
  /** Arranca la compañera de clase (Google Meet). */
  onClass: () => void;
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
    <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
      {streak != null && streak > 0 && (
        <StatBlock label="Racha" value={streak} unit="días" size="lg" tone="amber" />
      )}
      <StatBlock label="Sesiones" value={sessions.length} size="lg" />
      {totalMin > 0 && (
        <StatBlock
          label="Tiempo hablado"
          value={totalMin < 60 ? totalMin : (totalMin / 60).toFixed(1)}
          unit={totalMin < 60 ? "min" : "h"}
          size="lg"
          tone="cyan"
        />
      )}
      {lastFluency != null && (
        <div className="flex flex-col gap-1.5">
          <StatBlock label="Fluidez" value={`${lastFluency}/5`} size="lg" tone="green" />
          {/* Caja acotada: el spark suelto crece al alto por defecto del svg */}
          {fluencyTrend.length >= 2 && (
            <div className="h-5 w-36">
              <Sparkline data={fluencyTrend} max={5} tone="green" fill />
            </div>
          )}
        </div>
      )}
      {vocab.length > 0 && (
        <div className="flex min-w-36 flex-col gap-1">
          <StatBlock label="Vocabulario" value={`${learned}/${vocab.length}`} unit="aprendidos" />
          <BarMeter
            value={learned}
            max={Math.max(vocab.length, 1)}
            segments={0}
            height={5}
            tone="accent"
            showValue={false}
          />
        </div>
      )}
      {classBusy ? null : live ? (
        <button
          type="button"
          onClick={onStop}
          title="Cuelga la llamada — la sesión se guarda y el coach genera el reporte"
          className="ml-auto self-center rounded-sm border border-red/50 bg-red/5 px-3 py-1.5 text-xs text-red transition-colors hover:border-red"
        >
          ◼ Terminar práctica
        </button>
      ) : (
        <span className="ml-auto flex items-center gap-2 self-center">
        <button
          type="button"
          onClick={onClass}
          title="Abre la compañera para tu clase de Google Meet: comparte la pestaña de Meet y te corrige, te ayuda a responder y arma el reporte"
          className="rounded-sm border border-accent/50 bg-accent/5 px-3 py-1.5 text-xs text-accent transition-colors hover:border-accent"
        >
          ● Clase en vivo
        </button>
        <button
          type="button"
          onClick={onPractice}
          disabled={!tutorConfigured}
          title={
            tutorConfigured
              ? "Conecta la voz con el tutor de inglés"
              : "Falta NEXT_PUBLIC_ELEVENLABS_TUTOR_AGENT_ID (pnpm setup:elevenlabs)"
          }
          className="rounded-sm border border-green/50 bg-green/5 px-3 py-1.5 text-xs text-green transition-colors hover:border-green disabled:cursor-not-allowed disabled:opacity-40"
        >
          ▶ Practicar ahora
        </button>
        </span>
      )}
    </div>
  );
}
