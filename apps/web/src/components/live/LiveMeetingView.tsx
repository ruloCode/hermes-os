"use client";

import { useEffect, useRef, useState } from "react";
import { useHermesData } from "@/hooks/useHermesData";
import { StatusPill } from "@/components/ui/StatusPill";
import { PanelState } from "@/components/ui/PanelState";
import { fmtLiveClock, useLiveMeeting } from "@/state/LiveMeetingProvider";
import { LiveCoachStrip } from "./LiveCoachStrip";
import { LiveTranscript } from "./LiveTranscript";
import { LiveSuggestionsRail } from "./LiveSuggestionsRail";
import { LiveVuMeter } from "./LiveVuMeter";
import { useClassPip } from "./ClassPip";

/**
 * Vista EN VIVO de la junta — takeover completo del tab Reuniones mientras
 * hay sesión: header (estado + timer + VU + STT + Terminar con confirmación
 * inline), transcript protagonista y riel del copiloto.
 */
export function LiveMeetingView() {
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

  if (live.phase === "requesting_mic" || live.phase === "connecting") {
    return (
      <div className="px-2">
        <p className="mb-2 text-2xs tracking-label text-cyan uppercase pulse-dot">
          {live.phase === "requesting_mic" ? "● Pidiendo el micrófono…" : `● Conectando ${what}…`}
        </p>
        <PanelState kind="loading" title={`Conectando ${what}`} />
      </div>
    );
  }

  if (live.phase === "processing") {
    return (
      <div className="grid h-full place-items-center px-4">
        <div className="space-y-2 text-center">
          <p className="text-xs tracking-label text-accent uppercase pulse-dot">
            ◈ {live.isClass ? "Guardando la clase…" : "Procesando la junta…"}
          </p>
          <p className="text-2xs leading-snug text-text-dim">
            {live.isClass
              ? "Tus correcciones van al reporte: errores recurrentes y drills para practicar con la tutora."
              : "Transcript final → resumen + accionables. El detalle se abre solo al terminar."}
          </p>
        </div>
      </div>
    );
  }

  if (live.phase === "error") {
    return (
      <div className="grid h-full place-items-center px-4">
        <PanelState
          kind="error"
          title={live.isClass ? "La clase falló" : "La junta falló"}
          hint={live.error ?? undefined}
          retry={live.reset}
        />
      </div>
    );
  }

  // live · reconnecting · stopping → la vista completa.
  const sttPill =
    live.sttState === "connected"
      ? ({ status: "ok", label: "STT" } as const)
      : live.sttState === "reconnecting"
        ? ({ status: "warn", label: "STT" } as const)
        : ({ status: "error", label: "STT ↓" } as const);

  return (
    <div className="flex h-full flex-col gap-3">
      {/* ── Header de la sesión ──────────────────────────────────── */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-line pb-2">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <StatusPill status="active" pulse label="EN VIVO" />
          <div className="min-w-0">
            <p className="truncate text-xs text-text">
              {live.title || (live.isClass ? "Clase de inglés" : "Junta en vivo")}
            </p>
            <p className="text-2xs tracking-label text-text-dim uppercase">{projectName}</p>
          </div>
          <LiveTimer startedAt={live.startedAt} />
        </div>

        <div className="flex items-center gap-3">
          <span className="hidden md:block">
            <LiveVuMeter levelRef={live.micLevelRef} />
          </span>
          {/* Fuente de audio: solo en remoto (presencial siempre es MIC). */}
          {live.mode === "remoto" && (
            <StatusPill
              size="sm"
              status={live.systemAudio ? "ok" : "warn"}
              label={
                live.systemAudio ? (live.callSource === "app" ? "MIC+APP" : "MIC+PESTAÑA") : "SOLO MIC"
              }
            />
          )}
          {/* Ventanita flotante encima de Meet/Teams: necesita SU clic (Document PiP). */}
          {pip.supported && !pip.open && live.phase === "live" && (
            <button
              type="button"
              onClick={() => void pip.openPip()}
              title="Abre una ventanita que queda encima de la llamada con lo urgente"
              className="rounded-sm border border-accent/50 px-2 py-1 text-2xs text-accent transition-colors hover:border-accent"
            >
              ⧉ Ventanita
            </button>
          )}
          <StatusPill size="sm" status={sttPill.status} label={sttPill.label} />
          {live.phase === "reconnecting" && (
            <StatusPill size="sm" status="warn" pulse label="RECONECTANDO" />
          )}
        </div>

        {confirm ? (
          <span className="flex items-center gap-2">
            <span className="text-2xs tracking-label text-text-dim uppercase">
              {live.isClass ? "¿Terminar la clase?" : "¿Terminar y procesar?"}
            </span>
            <button
              type="button"
              onClick={() => {
                closeConfirm();
                void live.stop();
              }}
              className="rounded-sm border border-red bg-red/10 px-2 py-1 text-2xs tracking-label text-red uppercase"
            >
              ✓ Sí
            </button>
            <button
              type="button"
              onClick={closeConfirm}
              className="rounded-sm border border-line px-2 py-1 text-2xs tracking-label text-text-dim uppercase transition-colors hover:border-line-2"
            >
              ✕ No
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={openConfirm}
            disabled={live.phase === "stopping"}
            className="rounded-sm border border-red/50 bg-red/5 px-2.5 py-1.5 text-2xs tracking-label text-red uppercase transition-colors hover:border-red disabled:opacity-40"
          >
            {live.phase === "stopping" ? "◈ Cerrando…" : "■ Terminar"}
          </button>
        )}
      </div>

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
      {live.mode === "remoto" && live.systemAudio === false && live.phase === "live" && (
        <p className="flex shrink-0 flex-wrap items-center gap-2 text-2xs leading-snug text-amber">
          ⚠ Sin audio {live.callSource === "app" ? "de la app" : "de la pestaña"} — solo se
          transcribe tu micrófono.
          {live.systemAudioError && <span className="text-text-dim">({live.systemAudioError})</span>}
          <button
            type="button"
            onClick={() => void live.retrySystemAudio()}
            className="rounded-sm border border-amber/60 px-2 py-0.5 tracking-label text-amber uppercase transition-colors hover:border-amber"
          >
            {live.callSource === "app" ? "Reintentar" : "Compartir pestaña"}
          </button>
        </p>
      )}
      {live.phase === "reconnecting" && (
        <p className="shrink-0 text-2xs leading-snug text-amber">
          ⚠ Conexión perdida con el agente — reintentando… (el audio de este hueco no se
          transcribe)
        </p>
      )}
      {live.error && (
        <p className="shrink-0 text-2xs leading-snug text-red">⚠ {live.error}</p>
      )}
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
    <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-sm border border-amber/50 bg-amber/5 px-2.5 py-1.5">
      <span className="text-2xs text-amber">¿Cuál eres tú?</span>
      {live.speakerOrder.slice(0, 3).map((label, i) => {
        const line = lastLine(label);
        return (
          <button
            key={label}
            type="button"
            onClick={() => live.markSelf(label)}
            title={line}
            className="max-w-[260px] truncate rounded-sm border border-line px-2 py-0.5 text-2xs text-text transition-colors hover:border-line-2"
          >
            Voz {i + 1}
            {line ? <span className="text-text-dim"> · «{line.slice(0, 40)}»</span> : null}
          </button>
        );
      })}
      <span className="text-2xs text-text-dim">
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
    <span className="shrink-0 text-xs text-cyan tabular-nums">
      {fmtLiveClock(Date.now() - startedAt)}
    </span>
  );
}
