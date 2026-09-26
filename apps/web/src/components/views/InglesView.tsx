"use client";

// Vista INGLÉS (antes un panel apretado en /vida): progreso REAL de la
// práctica con el tutor de voz. Stats (racha·sesiones·tiempo·fluidez·
// vocabulario) + historial de sesiones con el reporte del coach en detalle,
// recomendaciones accionables (drills → tareas de Linear), vocabulario con
// repaso espaciado y las tareas del proyecto Inglés (espejo vault↔Linear).
//
// Rediseño v4 — misma gramática que Finanzas y Hábitos: el hero pasa a
// ViewHeader y el riel derecho deja de ser una pila de <Panel> con título para
// usar RailSection, igual que en las otras nueve rutas. La estructura de fondo
// ya era la correcta (lista de sesiones → reporte = lista → pieza), así que
// aquí el cambio es de piel, no de huesos.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ViewHeader } from "@/components/ui/ViewHeader";
import { ScrollArea } from "@/components/ui/ScrollArea";
import { RailSection } from "@/components/ui/Rail";
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
      <ViewHeader title="Inglés" meta={tutorLive ? "Practicando" : undefined} />

      <div className="shrink-0">
        <EnglishStats
          sessions={sessions}
          vocab={vocab}
          streak={streak}
          tutorConfigured={voice.tutorConfigured}
          live={tutorLive}
          onPractice={() => void voice.switchToTutor()}
          onStop={() => void voice.disconnect()}
        />
      </div>

      {/* lg: la única fila mide exactamente el alto disponible (minmax(0,1fr));
          sin esto la fila es `auto`, crece con el reporte y su scroll interno
          nunca se activa (el contenido se corta). */}
      <div className="grid min-h-0 flex-1 grid-cols-12 gap-3 max-lg:auto-rows-min max-lg:overflow-y-auto lg:grid-rows-[minmax(0,1fr)]">
        {tutorLive ? (
          /* Takeover de práctica: la transcripción en vivo ocupa el centro */
          <div className="col-span-12 flex min-h-[420px] flex-col md:col-span-8 lg:min-h-0">
            {/* min-h-0: sin él, el min-height:auto de flexbox lo estira a su
                contenido y el scroll interno nunca se activa. Sin caja: lo que
                el tutor dice ES el contenido, no algo dentro de una tarjeta. */}
            <div className="flex min-h-0 flex-1 flex-col">
              <LivePractice
                connecting={voice.connecting}
                vocab={vocab}
                onWordSaved={addSessionWord}
              />
            </div>
          </div>
        ) : (
          <>
            {/* Historial: qué sesión estoy mirando */}
            <div className="col-span-12 flex min-h-[260px] flex-col md:col-span-4 lg:col-span-3 lg:min-h-0">
              <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-line bg-panel">
                <h3 className="shrink-0 border-b border-line px-3 py-2.5 text-xs font-medium text-text-dim">
                  Sesiones · {sessions.length}
                </h3>
                <div className="min-h-0 flex-1 p-2">
                  <SessionList
                    sessions={sessions}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                  />
                </div>
              </section>
            </div>

            {/* El reporte del coach es el protagonista del centro */}
            <div className="col-span-12 flex min-h-[360px] flex-col md:col-span-8 lg:col-span-5 lg:min-h-0">
              {/* La PIEZA: se lee largo, así que va sin marco. */}
              <div className="flex min-h-0 flex-1 flex-col">
                <span className="mb-2.5 shrink-0 text-2xs text-text-faint">Reporte del coach</span>
                <div className="min-h-0 flex-1">
                  <SessionDetail session={selected} />
                </div>
              </div>
            </div>
          </>
        )}

        {/* Riel derecho: en vivo = banco de palabras de la sesión (foco);
            en reposo = qué hacer con lo aprendido */}
        {tutorLive ? (
          <div className="col-span-12 flex min-h-[260px] flex-col md:col-span-4 lg:col-span-4 lg:min-h-0">
            <RailSection label="Banco de palabras" grow>
              <LiveWordBank words={sessionWords} vocab={vocab} onChanged={() => void refresh()} />
            </RailSection>
          </div>
        ) : (
          <aside
            aria-label="Contexto"
            className="col-span-12 flex min-h-0 flex-col border-line lg:col-span-4 lg:border-l lg:pl-6"
          >
            <ScrollArea rail fade="y" className="min-h-0 flex-1 pr-1">
              <div className="flex min-h-full flex-col gap-7">
                <RailSection label="Recomendaciones">
                  <EnglishRecs sessions={sessions} />
                </RailSection>
                <RailSection label="Vocabulario">
                  <VocabPanel vocab={vocab} onChanged={() => void refresh()} />
                </RailSection>
                <RailSection label="Tareas · proyecto Inglés" grow>
                  <EnglishTasksPanel />
                </RailSection>
              </div>
            </ScrollArea>
          </aside>
        )}
      </div>
    </div>
  );
}
