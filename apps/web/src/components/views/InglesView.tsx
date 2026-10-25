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
//
// v5: las dos acciones de la página (Practicar ahora · Clase en vivo) suben a
// la cabecera — antes eran dos botones con borde rojo y verde perdidos al
// final de la tira de métricas. Las tres columnas (sesiones · reporte · riel)
// se separan con hairlines y ninguna lleva caja: se elige, se lee, se actúa.
//
// Plan de estudios (2026-10-20, docs/plan-ingles.md): la vista abre en PLAN,
// una ruta estilo Duolingo de 8 unidades que salió de analizar todas las
// clases registradas; "Sesiones" es lo de antes (historial + reportes). Una
// lección abierta toma el lienzo entero; la de voz abre a la tutora en modo
// lección y, mientras dura la llamada, el riel muestra qué se está entrenando.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ViewHeader } from "@/components/ui/ViewHeader";
import { ScrollArea } from "@/components/ui/ScrollArea";
import { PanelState } from "@/components/ui/PanelState";
import { RailSection } from "@/components/ui/Rail";
import { Button } from "@/components/ui/Button";
import { useWorkspace } from "@/state/WorkspaceContext";
import { useEnglish } from "@/hooks/useEnglish";
import { useVoiceConnect } from "@/hooks/useVoiceConnect";
import { useVoice } from "@/components/VoiceBusyContext";
import { useVidaContext } from "@/state/VidaProvider";
import { EnglishStats } from "@/components/ingles/EnglishStats";
import { LivePractice, type SessionWord } from "@/components/ingles/LivePractice";
import { LiveWordBank } from "@/components/ingles/LiveWordBank";
import { SessionList } from "@/components/ingles/SessionList";
import { SessionDetail } from "@/components/ingles/SessionDetail";
import { EnglishRecs } from "@/components/ingles/EnglishRecs";
import { VocabPanel } from "@/components/ingles/VocabPanel";
import { EnglishTasksPanel } from "@/components/ingles/EnglishTasksPanel";
import { LiveMeetingView } from "@/components/live/LiveMeetingView";
import { useClassPip } from "@/components/live/ClassPip";
import { useLiveMeeting } from "@/state/LiveMeetingProvider";
import { usePracticeCompanion } from "@/hooks/usePracticeCompanion";
import { PracticeSessionRail } from "@/components/ingles/PracticeSessionRail";
import { Segmented } from "@/components/ui/Segmented";
import { useConversationControls } from "@elevenlabs/react";
import { planLesson, planUnit } from "@hermes/shared";
import { useEnglishPlan } from "@/hooks/useEnglishPlan";
import { takeLessonOpening } from "@/lib/english-lesson";
import { PlanTab } from "@/components/ingles/plan/PlanTab";
import { LessonPlayer } from "@/components/ingles/plan/LessonPlayer";

type InglesTab = "plan" | "sesiones";
const TAB_KEY = "hermes-ingles-tab";

function readTab(): InglesTab {
  try {
    return localStorage.getItem(TAB_KEY) === "sesiones" ? "sesiones" : "plan";
  } catch {
    return "plan";
  }
}

const PRACTICE_HABIT = "práctica de inglés";

export function InglesView({ active = true }: { active?: boolean }) {
  // Riel ocultable (⌥⌘B / botón de la cabecera): sin él, el centro toma todo el ancho.
  const { railOpen } = useWorkspace();
  const { sessions, vocab, refresh } = useEnglish();
  const planData = useEnglishPlan();
  const [tab, setTabState] = useState<InglesTab>("plan");
  useEffect(() => setTabState(readTab()), []);
  const setTab = (t: InglesTab) => {
    setTabState(t);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      /* sin storage: la pestaña dura la sesión */
    }
  };
  const [openLesson, setOpenLesson] = useState<string | null>(null);
  const closeLesson = useCallback(() => setOpenLesson(null), []);
  const { sendUserMessage } = useConversationControls();
  const voice = useVoiceConnect();
  const vida = useVidaContext();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const live = useLiveMeeting();
  const pip = useClassPip();

  // Clase EN VIVO (Google Meet): toma TODO el ancho — trae su propio riel.
  const classLive = live.isClass && live.phase !== "idle";
  const [classError, setClassError] = useState<string | null>(null);
  const startClass = () => {
    setClassError(null);
    if (voice.connected || voice.connecting) {
      setClassError("Cuelga con la tutora antes de iniciar la clase (comparten micrófono).");
      return;
    }
    if (live.active) {
      setClassError("Hay una junta en vivo en curso: termínala antes de iniciar la clase.");
      return;
    }
    void live.startClass();
  };

  // La clase terminó y quedó guardada: su reporte se abre aquí mismo.
  const classResult = live.result?.englishSessionId;
  useEffect(() => {
    if (!classResult) return;
    setSelectedId(classResult);
    void refresh();
    live.consumeResult();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classResult]);

  // Práctica EN VIVO: con el tutor conectado, el centro se vuelve la
  // transcripción en tiempo real (reforzar reading mientras hablas).
  const tutorLive = voice.mode === "tutor" && (voice.connected || voice.connecting);
  // Compañera de la práctica: correcciones y ayuda en pantalla mientras hablas
  // con la tutora (las mismas tarjetas que la clase en vivo).
  // Abre con la llamada CONECTANDO: su arranque corre en paralelo con el de la
  // voz y llega lista a la primera pregunta de la tutora.
  const companion = usePracticeCompanion(tutorLive);
  const { transcript } = useVoice();
  // Dónde arrancó ESTA práctica en el transcript (el riel cuenta solo esto).
  const [practiceFrom, setPracticeFrom] = useState(0);

  // Banco de la sesión: palabras tocadas en el transcript de ESTA práctica.
  // Arrancar una práctica nueva lo vacía; el vocab enriquecido llega por poll.
  const [sessionWords, setSessionWords] = useState<SessionWord[]>([]);
  const prevLiveRef = useRef(tutorLive);
  useEffect(() => {
    if (tutorLive && !prevLiveRef.current) {
      setSessionWords([]);
      setPracticeFrom(transcript.length);
    }
    // Colgó: la tutora guarda la sesión y el reporte se arma — se abre aquí
    // la más reciente apenas llega (selectedId null = "la última").
    if (!tutorLive && prevLiveRef.current) {
      setTimeout(() => {
        void refresh().then(() => setSelectedId(null));
      }, 2500);
    }
    prevLiveRef.current = tutorLive;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tutorLive]);
  // Lección del plan con la tutora: su saludo es fijo, así que el primer turno
  // lo mandamos por ti apenas conecta (si la práctica no es una lección, no
  // hay nada pendiente y esto no hace nada).
  useEffect(() => {
    if (!(voice.mode === "tutor" && voice.connected)) return;
    const opening = takeLessonOpening();
    if (!opening) return;
    const t = setTimeout(() => {
      try {
        sendUserMessage(opening);
      } catch {
        /* sin canal: la tutora igual tiene el contexto de la lección */
      }
    }, 1200);
    return () => clearTimeout(t);
  }, [voice.mode, voice.connected, sendUserMessage]);

  // Al colgar, la práctica se guarda y la lección se cierra en el agente: el
  // plan se refresca un par de veces mientras eso llega.
  useEffect(() => {
    if (tutorLive || !planData.plan?.pendingTutor) return;
    const a = setTimeout(() => void planData.refresh(), 3_000);
    const b = setTimeout(() => void planData.refresh(), 9_000);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tutorLive]);

  const callTutorLesson = useCallback(
    (lessonId: string) => {
      setClassError(null);
      if (live.active) return;
      void voice.switchToTutor({ lessonId });
    },
    [live.active, voice],
  );
  const tutorBlocked = !voice.tutorConfigured
    ? "Falta NEXT_PUBLIC_ELEVENLABS_TUTOR_AGENT_ID (pnpm setup:elevenlabs)."
    : live.active
      ? "Hay una junta o una clase en vivo: termínala antes de llamar a la tutora."
      : voice.error || null;
  const pendingLesson = planData.plan?.pendingTutor ? planLesson(planData.plan.pendingTutor.lessonId) : null;
  const pendingUnit = pendingLesson ? planUnit(pendingLesson.unit) : null;

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
      <ViewHeader
        title="Inglés"
        onBack={openLesson && !tutorLive && !classLive ? closeLesson : undefined}
        backLabel="Plan"
        // El riel que se esconde es el de Sesiones (el Plan trae el suyo y en vivo manda la sesión).
        railToggle={!tutorLive && !classLive && tab === "sesiones"}
        tabs={
          tutorLive || classLive || openLesson ? undefined : (
            <Segmented
              value={tab}
              onChange={setTab}
              ariaLabel="Secciones de inglés"
              options={[
                { value: "plan", label: "Plan" },
                { value: "sesiones", label: "Sesiones", count: sessions.length || undefined },
              ]}
            />
          )
        }
        meta={
          classLive
            ? "En clase"
            : tutorLive
              ? pendingUnit
                ? `Lección · ${pendingUnit.title}`
                : "Practicando"
              : tab === "plan" && planData.plan
                ? `${planData.plan.xp.total} XP · ${planData.plan.units.filter((u) => u.mastered).length} de ${planData.plan.units.length} unidades`
                : sessions.length > 0
                ? `${sessions.length} ${sessions.length === 1 ? "sesión" : "sesiones"}`
                : undefined
        }
        actions={
          // En vivo (práctica, clase o una junta) el control vive en su vista.
          tutorLive || classLive || live.active ? undefined : (
            <>
              <Button
                size="md"
                onClick={startClass}
                title="Abre la compañera para tu clase de Google Meet: comparte la pestaña de Meet y te corrige, te ayuda a responder y arma el reporte"
                icon={<span className="block h-2 w-2 rounded-full bg-red" />}
              >
                Clase en vivo
              </Button>
              <Button
                variant="primary"
                size="md"
                onClick={() => void voice.switchToTutor()}
                disabled={!voice.tutorConfigured}
                title={
                  voice.tutorConfigured
                    ? "Conecta la voz con el tutor de inglés"
                    : "Falta NEXT_PUBLIC_ELEVENLABS_TUTOR_AGENT_ID (pnpm setup:elevenlabs)"
                }
              >
                Practicar ahora
              </Button>
            </>
          )
        }
      />

      {/* En vivo (práctica o clase) la conversación manda: las stats esperan. */}
      <div className={`shrink-0 pb-3 ${tutorLive || classLive || tab === "plan" ? "hidden" : ""}`}>
        <EnglishStats sessions={sessions} vocab={vocab} streak={streak} />
        {classError && (
          <p className="mt-3 flex items-center gap-2 text-sm text-text-dim">
            <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-red" />
            {classError}
          </p>
        )}
      </div>

      {/* Clase en vivo: la ventanita flota encima de Meet (un clic: Chrome
          exige un gesto para abrirla, y el del inicio ya se usó en la pestaña). */}
      {classLive && live.phase === "live" && pip.supported && !pip.open && (
        <div className="flex shrink-0 flex-wrap items-center gap-3 rounded-md border border-line bg-panel px-3.5 py-2.5">
          <p className="min-w-0 flex-1 text-sm text-text-dim">
            Abre la ventanita y vuelve a Meet: la ayuda queda flotando encima de la llamada.
          </p>
          <Button
            variant="primary"
            onClick={() => void pip.openPip()}
            icon={
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <rect x="12" y="12" width="7" height="6" rx="1" />
              </svg>
            }
          >
            Abrir ventanita
          </Button>
        </div>
      )}

      {/* Plan: ruta + riel, o la lección abierta a todo el lienzo. */}
      {!tutorLive && !classLive && tab === "plan" ? (
        openLesson && planData.plan ? (
          <LessonPlayer
            lessonId={openLesson}
            plan={planData.plan}
            active={active}
            submitQuiz={planData.submitQuiz}
            submitDrill={planData.submitDrill}
            onExit={closeLesson}
            onOpen={setOpenLesson}
            tutor={{
              canCall: voice.tutorConfigured && !live.active,
              blocked: tutorBlocked,
              call: callTutorLesson,
              cancel: () => void planData.cancelTutor(),
            }}
          />
        ) : (
          <PlanTab plan={planData.plan} error={planData.error} onStart={setOpenLesson} />
        )
      ) : (
      /* lg: la única fila mide exactamente el alto disponible (minmax(0,1fr));
          sin esto la fila es `auto`, crece con el reporte y su scroll interno
          nunca se activa (el contenido se corta). */
      <div className="grid min-h-0 flex-1 grid-cols-12 gap-3 max-lg:auto-rows-min max-lg:overflow-y-auto lg:grid-rows-[minmax(0,1fr)] lg:gap-0">
        {classLive ? (
          /* Takeover de clase: transcript + compañera + coach, todo el ancho */
          <div className="col-span-12 flex min-h-[480px] flex-col lg:min-h-0">
            <LiveMeetingView />
          </div>
        ) : tutorLive ? (
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
                companion={companion}
                onEnd={() => void voice.disconnect()}
              />
            </div>
          </div>
        ) : (
          <>
            {/* Historial: qué sesión estoy mirando. La lista se elige, no se
                lee: sin caja, y una hairline la separa del reporte. */}
            <section
              aria-label="Sesiones"
              className="col-span-12 flex min-h-[260px] flex-col gap-2 md:col-span-4 lg:col-span-3 lg:min-h-0 lg:border-r lg:border-line lg:pr-3"
            >
              <h2 className="shrink-0 px-2.5 text-xs font-medium text-text-faint">Sesiones</h2>
              <div className="min-h-0 flex-1">
                <SessionList sessions={sessions} selectedId={selectedId} onSelect={setSelectedId} />
              </div>
            </section>

            {/* El reporte del coach es el protagonista del centro. La PIEZA: se
                lee largo, así que va sin marco. */}
            <div
              className={`col-span-12 flex min-h-[360px] flex-col md:col-span-8 lg:min-h-0 lg:pl-8 ${railOpen ? "lg:col-span-5" : "lg:col-span-9"}`}
            >
              {sessions.length === 0 ? (
                <PanelState
                  kind="empty"
                  title="Aquí aparece el reporte de cada sesión"
                  hint="Practica con la tutora (Practicar ahora) o abre la compañera en tu clase de Meet (Clase en vivo): al colgar, el coach analiza lo que dijiste."
                />
              ) : (
                <SessionDetail
                  session={selected}
                  onReviewWithTutor={live.active ? undefined : () => void voice.switchToTutor()}
                />
              )}
            </div>
          </>
        )}

        {/* Riel derecho: en vivo = banco de palabras de la sesión (foco);
            en reposo = qué hacer con lo aprendido */}
        {classLive ? null : tutorLive ? (
          <div className="col-span-12 flex min-h-[260px] flex-col gap-6 md:col-span-4 lg:col-span-4 lg:ml-6 lg:min-h-0 lg:border-l lg:border-line lg:pl-4">
            {pendingUnit && (
              <RailSection label="Lección del plan">
                <p className="text-sm font-medium text-text">{pendingUnit.title}</p>
                <ul className="flex flex-col gap-1.5 pt-1">
                  {pendingUnit.rule.slice(0, 3).map((r) => (
                    <li key={r} className="text-sm leading-relaxed text-text-dim">
                      {r}
                    </li>
                  ))}
                </ul>
              </RailSection>
            )}
            <RailSection label="Esta práctica">
              <PracticeSessionRail companion={companion} fromLine={practiceFrom} />
            </RailSection>
            <RailSection label="Banco de palabras" grow>
              <LiveWordBank words={sessionWords} vocab={vocab} onChanged={() => void refresh()} />
            </RailSection>
          </div>
        ) : (
          <aside
            aria-label="Contexto"
            className={`col-span-12 flex min-h-0 flex-col border-line lg:col-span-4 lg:ml-6 lg:border-l lg:pl-4${railOpen ? "" : " lg:hidden"}`}
          >
            {/* -mt-3 pt-3: el fade superior del ScrollArea cae sobre el aire y
                no sobre la primera etiqueta, que queda alineada con "Sesiones". */}
            <ScrollArea rail fade="y" className="-mt-3 min-h-0 flex-1 pt-3 pr-1">
              <div className="flex min-h-full flex-col gap-7 pb-3">
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
      )}
    </div>
  );
}
