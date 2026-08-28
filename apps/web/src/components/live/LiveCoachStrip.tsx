"use client";

// Coach en vivo: fila compacta con ratio de habla, WPM y muletillas — todo
// computado del transcript real en el server (coach_metrics cada 5 s).
// Sin selfSpeaker marcado solo muestra el ratio por hablante (sin juicios
// sobre "ti"); se omite entera sin datos (regla: nada decorativo).

import { useMemo } from "react";
import { liveSpeakerName, useLiveMeeting } from "@/state/LiveMeetingProvider";

export function LiveCoachStrip() {
  const live = useLiveMeeting();
  const m = live.coachMetrics;

  const speakers = useMemo(() => {
    if (!m) return [];
    return Object.entries(m.bySpeaker)
      .map(([label, stats]) => ({ label, ...stats }))
      .sort((a, b) => b.talkMs - a.talkMs);
  }, [m]);

  if (!m || speakers.length === 0) return null;
  const totalMs = speakers.reduce((a, s) => a + s.talkMs, 0);
  if (totalMs <= 0) return null;
  const self = m.selfSpeaker ? speakers.find((s) => s.label === m.selfSpeaker) : undefined;

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-line pt-1.5">
      <span className="text-2xs tracking-label text-text-dim uppercase">Coach</span>
      {/* Ratio de habla: barra proporcional por hablante */}
      <span className="flex items-center gap-1.5">
        {speakers.slice(0, 4).map((s) => {
          const pct = Math.round((s.talkMs / totalMs) * 100);
          const isSelf = s.label === m.selfSpeaker;
          return (
            <span
              key={s.label}
              title={`${liveSpeakerName(s.label, live.speakerNames, live.speakerOrder)}: ${pct}% del tiempo hablado`}
              className={`text-2xs tabular-nums ${isSelf ? "text-cyan" : "text-text-dim"}`}
            >
              {liveSpeakerName(s.label, live.speakerNames, live.speakerOrder)}
              {isSelf ? " (yo)" : ""} {pct}%
            </span>
          );
        })}
      </span>
      {/* Métricas propias: solo con "soy yo" marcado (sin juicios a ciegas) */}
      {self && (
        <>
          <span className="text-2xs text-text-dim tabular-nums" title="Tus palabras por minuto">
            {self.wpm} wpm
          </span>
          <span
            className={`text-2xs tabular-nums ${self.fillers >= 10 ? "text-amber" : "text-text-dim"}`}
            title="Muletillas tuyas contadas en el transcript (este, o sea, um, like…)"
          >
            {self.fillers} muletillas
          </span>
        </>
      )}
    </div>
  );
}
