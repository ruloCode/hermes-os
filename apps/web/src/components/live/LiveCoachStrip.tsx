"use client";

// Coach en vivo: fila compacta con ratio de habla, WPM, muletillas y
// arranques débiles (articulación) — todo
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
              {isSelf && !live.isClass ? " (yo)" : ""} {pct}%
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
          {(self.weak ?? 0) > 0 && (
            <span
              className={`text-2xs tabular-nums ${(self.weak ?? 0) >= 5 ? "text-amber" : "text-text-dim"}`}
              title="Frases que le restan fuerza a lo que dices: pedir permiso, disculparte, un «pero» que borra lo anterior, «obviamente», «creo que tal vez»"
            >
              {self.weak} arranques débiles
            </span>
          )}
        </>
      )}
      {/* Clase de inglés: la meta es hablar tú (≥40 %), sin caer al español */}
      {m.class && (
        <>
          <span
            className={`text-2xs tabular-nums ${m.class.selfShare < 0.4 ? "text-amber" : "text-green"}`}
            title="Fracción del tiempo hablado que fue tuya — la meta en clase es 40 % o más"
          >
            hablas {Math.round(m.class.selfShare * 100)} %
          </span>
          {m.class.spanishTurns > 0 && (
            <span className="text-2xs text-text-dim tabular-nums" title="Turnos tuyos en español">
              {m.class.spanishTurns} en español
            </span>
          )}
          <span
            className="text-2xs text-text-dim tabular-nums"
            title="Correcciones en vivo por cada 100 palabras tuyas"
          >
            {m.class.corrections} correcciones · {m.class.correctionsPer100}/100 palabras
          </span>
        </>
      )}
    </div>
  );
}
