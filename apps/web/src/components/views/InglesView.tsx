"use client";

// Vista INGLÉS (antes un panel apretado en /vida): progreso REAL de la
// práctica con el tutor de voz. Hero de stats (racha·sesiones·tiempo·fluidez·
// vocabulario) + historial de sesiones con el reporte del coach en detalle,
// recomendaciones accionables (drills → tareas de Linear), vocabulario con
// repaso espaciado y las tareas del proyecto Inglés (espejo vault↔Linear).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { useEnglish } from "@/hooks/useEnglish";
import { useVoiceConnect } from "@/hooks/useVoiceConnect";
import { useVidaContext } from "@/state/VidaProvider";
import { EnglishStats } from "@/components/ingles/EnglishStats";
import { LivePractice, type SessionWord } from "@/components/ingles/LivePractice";
import { LiveWordBank } from "@/components/ingles/LiveWordBank";
import { SessionList } from "@/components/ingles/SessionList";
import { SessionDetail } from "@/components/ingles/SessionDetail";
import { EnglishRecs } from "@/components/ingles/EnglishRecs";
import { VocabPanel } from "@/components/ingles/VocabPanel";
import { EnglishTasksPanel } from "@/components/ingles/EnglishTasksPanel";

const PRACTICE_HABIT = "práctica de inglés";

export function InglesView() {
  const { sessions, vocab, refresh } = useEnglish();
  const voice = useVoiceConnect();
  const vida = useVidaContext();
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Práctica EN VIVO: con el tutor conectado, el centro se vuelve la
  // transcripción en tiempo real (reforzar reading mientras hablas).
  const tutorLive = voice.mode === "tutor" && (voice.connected || voice.connecting);

  // Banco de la sesión: palabras tocadas en el transcript de ESTA práctica.
  // Arrancar una práctica nueva lo vacía; el vocab enriquecido llega por poll.
  const [sessionWords, setSessionWords] = useState<SessionWord[]>([]);
  const prevLiveRef = useRef(tutorLive);
  useEffect(() => {
    if (tutorLive && !prevLiveRef.current) setSessionWords([]);
    prevLiveRef.current = tutorLive;
  }, [tutorLive]);
  const addSessionWord = useCallback((w: SessionWord) => {
    setSessionWords((prev) => (prev.some((x) => x.term === w.term) ? prev : [w, ...prev]));
  }, []);

  // Con la práctica en vivo, el vocab se refresca rápido: así el tap pasa de
  // "por definir" a su significado en cuanto el tutor llama save_vocab.
  useEffect(() => {
    if (!tutorLive) return;
    const t = setInterval(() => void refresh(), 10_000);
    return () => clearInterval(t);
  }, [tutorLive, refresh]);

  // La racha vive en el hábito "Práctica de inglés" (check-in automático al
  // guardar cada sesión) — no se duplica el sistema de rachas.
  const streak = useMemo(() => {
    const habit = vida.habits.find((h) => h.name.trim().toLowerCase() === PRACTICE_HABIT);
    return habit ? habit.streak : null;
  }, [vida.habits]);

  // Selección por defecto: la sesión más reciente (cuando llegan datos).
  useEffect(() => {
    if (selectedId == null && sessions.length > 0) setSelectedId(sessions[0].id);
  }, [sessions, selectedId]);

  const selected = sessions.find((s) => s.id === selectedId) ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <Panel title="Inglés · práctica con el tutor" variant="hero" tone="green" delay={40} className="shrink-0">
        <EnglishStats
          sessions={sessions}
          vocab={vocab}
          streak={streak}
          tutorConfigured={voice.tutorConfigured}
          live={tutorLive}
          onPractice={() => void voice.switchToTutor()}
          onStop={() => void voice.disconnect()}
        />
      </Panel>

      {/* lg: la única fila mide exactamente el alto disponible (minmax(0,1fr));
          sin esto la fila es `auto`, crece con el reporte y su scroll interno
          nunca se activa (el contenido se corta). */}
      <div className="grid min-h-0 flex-1 grid-cols-12 gap-3 max-lg:auto-rows-min max-lg:overflow-y-auto lg:grid-rows-[minmax(0,1fr)]">
        {tutorLive ? (
          /* Takeover de práctica: la transcripción en vivo ocupa el centro */
          <div className="col-span-12 flex min-h-[420px] flex-col md:col-span-8 lg:min-h-0">
            {/* min-h-0: sin él, el min-height:auto de flexbox estira el panel
                a su contenido y el scroll interno nunca se activa. */}
            <Panel title="Práctica en vivo" variant="hero" tone="green" className="min-h-0 flex-1">
              <LivePractice
                connecting={voice.connecting}
                vocab={vocab}
                onWordSaved={addSessionWord}
              />
            </Panel>
          </div>
        ) : (
          <>
            {/* Historial: qué sesión estoy mirando */}
            <div className="col-span-12 flex min-h-[260px] flex-col md:col-span-4 lg:col-span-3 lg:min-h-0">
              <Panel title={`Sesiones · ${sessions.length}`} delay={80} className="min-h-0 flex-1">
                <SessionList sessions={sessions} selectedId={selectedId} onSelect={setSelectedId} />
              </Panel>
            </div>

            {/* El reporte del coach es el protagonista del centro */}
            <div className="col-span-12 flex min-h-[360px] flex-col md:col-span-8 lg:col-span-5 lg:min-h-0">
              <Panel title="Reporte del coach" delay={110} className="min-h-0 flex-1">
                <SessionDetail session={selected} />
              </Panel>
            </div>
          </>
        )}

        {/* Riel derecho: en vivo = banco de palabras de la sesión (foco);
            en reposo = qué hacer con lo aprendido */}
        {tutorLive ? (
          <div className="col-span-12 flex min-h-[260px] flex-col md:col-span-4 lg:col-span-4 lg:min-h-0">
            <Panel title="Banco de palabras" tone="violet" className="min-h-0 flex-1">
              <LiveWordBank
                words={sessionWords}
                vocab={vocab}
                onChanged={() => void refresh()}
              />
            </Panel>
          </div>
        ) : (
          <div className="col-span-12 flex min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain lg:col-span-4">
            <Panel title="Recomendaciones" tone="cyan" delay={140} className="min-h-[200px] shrink-0">
              <EnglishRecs sessions={sessions} />
            </Panel>
            <Panel title="Vocabulario" delay={170} className="min-h-[180px] shrink-0 lg:max-h-[300px]">
              <VocabPanel vocab={vocab} onChanged={() => void refresh()} />
            </Panel>
            <Panel title="Tareas · proyecto Inglés" delay={200} className="min-h-[220px] flex-1">
              <EnglishTasksPanel />
            </Panel>
          </div>
        )}
      </div>
    </div>
  );
}
