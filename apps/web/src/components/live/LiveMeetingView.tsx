"use client";

import { useEffect, useRef, useState } from "react";
import { useHermesData } from "@/hooks/useHermesData";
import { StatusPill } from "@/components/ui/StatusPill";
import { PanelState } from "@/components/ui/PanelState";
import { ViewHeader } from "@/components/ui/ViewHeader";
import { Button } from "@/components/ui/Button";
import { fmtLiveClock, useLiveMeeting } from "@/state/LiveMeetingProvider";
import { LiveCoachStrip } from "./LiveCoachStrip";
import { LiveTranscript } from "./LiveTranscript";
import { LiveSuggestionsRail } from "./LiveSuggestionsRail";
import { LiveSourceMeters, MicPicker, MicWarningBanner } from "./MicControls";
import { useClassPip } from "./ClassPip";

/**
 * Vista EN VIVO de la junta — takeover completo del tab Reuniones mientras
 * hay sesión: header (estado + timer + VU + STT + Terminar con confirmación
 * inline), transcript protagonista y riel del copiloto.
 *
 * `asView`: es la vista entera (Reuniones) → la cabecera de la sesión ES el
 * ViewHeader. Sin él (dentro de /ingles, que ya tiene su cabecera) va una
 * barra compacta propia.
 */
export function LiveMeetingView({ asView = false }: { asView?: boolean } = {}) {
  const live = useLiveMeeting();
  const pip = useClassPip();
  const what = live.isClass ? "la clase" : "la junta";
  const { projects } = useHermesData();
  const projectName =
    projects.find((p) => p.slug === live.project)?.name ?? live.project ?? "—";

  // Confirmación inline de cierre (3 s y vuelve): también la dispara el
  // comando "terminar junta" vía stopConfirmNonce (nunca corta en seco).
  const [confirm, setConfirm] = useState(false);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openConfirm = () => {
    setConfirm(true);
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    confirmTimer.current = setTimeout(() => setConfirm(false), 3000);
  };
  const closeConfirm = () => {
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    confirmTimer.current = null;
    setConfirm(false);
  };

  useEffect(() => {
    if (live.stopConfirmNonce > 0 && (live.phase === "live" || live.phase === "reconnecting")) {
      openConfirm();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live.stopConfirmNonce]);

  useEffect(() => {
    return () => {
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
    };
  }, []);

  // Fases previas/posteriores: con asView llevan la cabecera de Reuniones
  // para que la vista no pierda su título mientras conecta o procesa.
  const frame = (body: React.ReactNode) =>
    asView ? (
      <div className="flex h-full min-h-0 flex-col">
        <ViewHeader title="Reuniones" meta={projectName} />
        <div className="min-h-0 flex-1">{body}</div>
      </div>
    ) : (
      body
    );

  if (live.phase === "requesting_mic" || live.phase === "connecting") {
    return frame(
      <div className="grid h-full place-items-center px-4">
        <div className="flex flex-col items-center gap-2 text-center">
          <span aria-hidden className="pulse-dot h-2 w-2 rounded-full bg-cyan" />
          <p className="text-sm font-medium text-text">
            {live.phase === "requesting_mic" ? "Pidiendo el micrófono…" : `Conectando ${what}…`}
          </p>
          <p className="text-xs text-text-faint">
            {live.phase === "requesting_mic"
              ? "Acepta el permiso del navegador para empezar a transcribir."
              : "El transcript aparece con la primera intervención."}
          </p>
        </div>
      </div>,
    );
  }

  if (live.phase === "processing") {
    return frame(
      <div className="grid h-full place-items-center px-4">
        <div className="flex max-w-[44ch] flex-col items-center gap-2 text-center">
          <span aria-hidden className="pulse-dot h-2 w-2 rounded-full bg-cyan" />
          <p className="text-sm font-medium text-text">
            {live.isClass ? "Guardando la clase…" : "Procesando la junta…"}
          </p>
          <p className="text-xs leading-snug text-text-faint">
            {live.isClass
              ? "Tus correcciones van al reporte: errores recurrentes y drills para practicar con la tutora."
              : "Transcript final → resumen + accionables. El detalle se abre solo al terminar."}
          </p>
        </div>
      </div>,
    );
  }

  if (live.phase === "error") {
    return frame(
      <div className="grid h-full place-items-center px-4">
        <PanelState
          kind="error"
          title={live.isClass ? "La clase falló" : "La junta falló"}
          hint={live.error ?? undefined}
          retry={live.reset}
        />
      </div>,
    );
  }

  // live · reconnecting · stopping → la vista completa.
  const sttPill =
    live.sttState === "connected"
      ? ({ status: "ok", label: "STT" } as const)
      : live.sttState === "reconnecting"
        ? ({ status: "warn", label: "STT" } as const)
        : ({ status: "error", label: "STT caído" } as const);

  const title = live.title || (live.isClass ? "Clase de inglés" : "Junta en vivo");

  // Estado + proyecto + reloj: la línea "dónde estoy y cuánto llevo".
  const liveMeta = (
    <span className="inline-flex items-center gap-2">
      <StatusPill status="active" pulse label="En vivo" size="sm" />
      <span className="text-text-faint">·</span>
      <span className="max-w-[180px] truncate">{projectName}</span>
      <LiveTimer startedAt={live.startedAt} />
    </span>
  );

  const liveControls = (
    <>
      <span className="hidden md:block">
        <LiveSourceMeters />
      </span>
      {/* El micrófono siempre a mano (no solo cuando hay aviso): cambiarlo no corta el STT. Sin mic propio (espectador) no hay qué cambiar. */}
      {live.mic && (
        <span className="hidden md:block">
          <MicPicker compact />
        </span>
      )}
      {/* Fuente de audio: solo en remoto (presencial siempre es MIC). */}
      {live.mode === "remoto" && (
        <StatusPill
          size="sm"
          status={live.systemAudio ? "ok" : "warn"}
          label={
            live.systemAudio
              ? live.callSource === "app"
                ? "Mic + app"
                : "Mic + pestaña"
              : "Solo mic"
          }
        />
      )}
      <StatusPill size="sm" status={sttPill.status} label={sttPill.label} />
      {live.phase === "reconnecting" && (
        <StatusPill size="sm" status="warn" pulse label="Reconectando" />
      )}
      {/* Ventanita flotante encima de Meet/Teams: necesita SU clic (Document PiP). */}
      {pip.supported && !pip.open && live.phase === "live" && (
        <Button
          variant="ghost"
          onClick={() => void pip.openPip()}
          title="Abre una ventanita que queda encima de la llamada con lo urgente"
          icon={
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
              <rect x="12" y="11" width="6" height="5" rx="1" />
            </svg>
          }
        >
          Ventanita
        </Button>
      )}
      {confirm ? (
        <span className="flex items-center gap-1.5">
          <span className="text-xs text-text-dim">
            {live.isClass ? "¿Terminar la clase?" : "¿Terminar y procesar?"}
          </span>
          <Button
            variant="danger"
            onClick={() => {
              closeConfirm();
              void live.stop();
            }}
          >
            Sí, terminar
          </Button>
          <Button variant="ghost" onClick={closeConfirm}>
            No
          </Button>
        </span>
      ) : (
        <Button
          variant="danger"
          onClick={openConfirm}
          disabled={live.phase === "stopping"}
          icon={
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <rect x="4" y="4" width="16" height="16" rx="2.5" />
            </svg>
          }
        >
          {live.phase === "stopping" ? "Cerrando…" : "Terminar"}
        </Button>
      )}
    </>
  );

  return (
    <div className={`flex h-full min-h-0 flex-col ${asView ? "" : "gap-3"}`}>
      {/* ── Header de la sesión ──────────────────────────────────── */}
      {asView ? (
        <ViewHeader title={title} meta={liveMeta} actions={liveControls} />
      ) : (
        <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-line pb-2.5">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <p className="truncate text-sm font-medium text-text">{title}</p>
            <span className="shrink-0 text-xs text-text-faint">{liveMeta}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">{liveControls}</div>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {/* ── Clase: ¿cuál voz eres tú? (sin esto no hay correcciones) ── */}
        {(live.isClass || live.isTeam) && !live.selfSpeaker && live.speakerOrder.length > 0 && (
          <ClassSelfPicker />
        )}

        {/* ── Transcript + copiloto ────────────────────────────────── */}
        <div className="flex min-h-0 flex-1 gap-3 max-lg:flex-col">
          <LiveTranscript />
          <LiveSuggestionsRail />
        </div>

        {/* ── Coach en vivo (se omite sin datos) ───────────────────── */}
        <LiveCoachStrip />

        {/* ── Banners (estado real, nunca decorativos) ─────────────── */}
        <MicWarningBanner />
        {live.mode === "remoto" && live.systemAudio === false && live.phase === "live" && (
          <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 rounded-sm border border-amber/30 bg-amber/5 px-3 py-2 text-xs leading-snug text-text">
            <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber" />
            <span className="min-w-0 flex-1">
              Sin audio {live.callSource === "app" ? "de la app" : "de la pestaña"} — solo se
              transcribe tu micrófono.
              {live.systemAudioError && (
                <span className="text-text-dim"> ({live.systemAudioError})</span>
              )}
            </span>
            <Button onClick={() => void live.retrySystemAudio()}>
              {live.callSource === "app" ? "Reintentar" : "Compartir pestaña"}
            </Button>
          </div>
        )}
        {live.phase === "reconnecting" && (
          <p className="flex shrink-0 items-start gap-2 text-xs leading-snug text-text-dim">
            <span aria-hidden className="pulse-dot mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full bg-amber" />
            Conexión perdida con el agente — reintentando… (el audio de este hueco no se
            transcribe)
          </p>
        )}
        {live.error && (
          <p className="flex shrink-0 items-start gap-2 text-xs leading-snug text-text">
            <span aria-hidden className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full bg-red" />
            {live.error}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * En clase la corrección necesita saber cuál voz es la tuya: un botón por
 * hablante detectado (con lo último que dijo, para reconocerte).
 */
function ClassSelfPicker() {
  const live = useLiveMeeting();
  const lastLine = (label: string) => {
    for (let i = live.segments.length - 1; i >= 0; i--) {
      const seg = live.segments[i];
      if (seg.speaker === label && seg.text.trim()) return seg.text.trim();
    }
    return "";
  };
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-sm border border-amber/30 bg-amber/5 px-3 py-2">
      <span className="flex items-center gap-2 text-xs font-medium text-text">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-amber" />
        ¿Cuál eres tú?
      </span>
      {live.speakerOrder.slice(0, 3).map((label, i) => {
        const line = lastLine(label);
        return (
          <button
            key={label}
            type="button"
            onClick={() => live.markSelf(label)}
            title={line}
            className="h-7 max-w-[280px] cursor-pointer truncate rounded-xs border border-line bg-panel px-2.5 text-xs text-text transition-colors hover:border-line-2 hover:bg-hover"
          >
            Voz {i + 1}
            {line ? <span className="text-text-faint"> · «{line.slice(0, 40)}»</span> : null}
          </button>
        );
      })}
      <span className="text-xs text-text-faint">
        {live.isClass
          ? "Sin esto no te puedo corregir."
          : "Así no te sugiero nada sobre lo que dices tú y sé en qué ventanas hablaste."}
      </span>
    </div>
  );
}

/** Timer local 1 s desde startedAt (sin drift: siempre deriva del epoch). */
function LiveTimer({ startedAt }: { startedAt: number | null }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  if (!startedAt) return null;
  return (
    <span className="shrink-0 font-mono text-xs text-text-dim tabular-nums">
      {fmtLiveClock(Date.now() - startedAt)}
    </span>
  );
}
