"use client";

import { useEffect, useRef } from "react";
import { useConversationMode } from "@elevenlabs/react";
import type { AgentActivityEvent } from "@hermes/shared";
import { ViewHeader } from "@/components/ui/ViewHeader";
import { Button } from "@/components/ui/Button";
import { Markdown } from "./Markdown";
import { VoiceWaveform } from "./VoiceWaveform";
import { useVoice } from "./VoiceBusyContext";
import { useVoiceConnect } from "@/hooks/useVoiceConnect";

/**
 * Modo VOZ EN VIVO. Tres zonas:
 *  - Cabecera (ViewHeader): estado de la llamada + waveform real + control.
 *  - Centro: PREVIEW en markdown de lo último que Hermes produjo (un reporte,
 *    un resumen, lo que sea) — llega solo cuando una tarea de voz termina.
 *  - Riel derecho a sangre: actividad EN VIVO (lo que el agente está haciendo)
 *    + transcripción de la llamada.
 *
 * v5: sin tres cajas con el mismo peso. Lo que se LEE (preview, actividad,
 * conversación) va sin marco; un riel con hairline separa el contexto del
 * documento, igual que el riel de contexto de Inicio.
 */

// Punto por tipo de evento: el color es ESTADO (cyan arranca, verde termina,
// rojo falla); el resto en gris. Mismo código que la vista Actividad.
const ACT_DOT: Record<string, string> = {
  task_start: "bg-cyan",
  tool_call: "bg-text-dim",
  tool_result: "bg-line-2",
  text: "bg-line-2",
  task_done: "bg-green",
  error: "bg-red",
  session_start: "bg-text-dim",
};

/** "TÚ"/"HERMES" llegan en mayúsculas del bridge: en la UI, frase normal. */
const whoLabel = (who: string) =>
  who === "TÚ" ? "Tú" : who.charAt(0) + who.slice(1).toLowerCase();

export function VozView({ events }: { events: AgentActivityEvent[] }) {
  const { transcript, action, artifact } = useVoice();
  const { connect, disconnect, error, configured, connected, connecting } = useVoiceConnect();
  const { isSpeaking } = useConversationMode();

  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const activityEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ block: "end" });
  }, [transcript.length]);
  useEffect(() => {
    activityEndRef.current?.scrollIntoView({ block: "end" });
  }, [events.length]);

  const statusText = !configured
    ? "Voz no configurada"
    : connected
      ? action
        ? `Ejecutando · ${action}`
        : isSpeaking
          ? "Hermes hablando"
          : "Escuchando"
      : connecting
        ? "Conectando…"
        : "En pausa";
  // El color va en el punto: cyan trabajando, acento (el del orbe) hablando,
  // verde escuchando, ámbar conectando, gris en pausa.
  const statusDot = !configured
    ? "bg-text-faint"
    : connected
      ? action
        ? "bg-cyan pulse-dot"
        : isSpeaking
          ? "bg-accent pulse-dot"
          : "bg-green"
      : connecting
        ? "bg-amber pulse-dot"
        : "bg-text-faint";

  const recentActivity = events.slice(-40);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ViewHeader
        title="Voz en vivo"
        meta={
          <span className="inline-flex items-center gap-1.5 text-text-dim">
            <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${statusDot}`} />
            <span className="max-w-[320px] truncate">{statusText}</span>
          </span>
        }
        actions={
          <>
            {/* Waveform real, solo con llamada: en reposo era una línea
                punteada que no decía nada. */}
            {connected && (
              <div className="hidden w-36 shrink-0 sm:block">
                <VoiceWaveform height={28} />
              </div>
            )}
            {!configured ? (
              <Button size="md" disabled>
                No disponible
              </Button>
            ) : connected ? (
              <Button size="md" variant="danger" onClick={() => disconnect()}>
                Terminar llamada
              </Button>
            ) : (
              <Button
                size="md"
                variant="primary"
                disabled={connecting}
                onClick={() => void connect()}
                icon={
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path
                      d="M4 13a8 8 0 0 1 16 0M4 13v4a2 2 0 0 0 2 2h1v-6H6a2 2 0 0 0-2 2Zm16 0v4a2 2 0 0 1-2 2h-1v-6h1a2 2 0 0 1 2 2Z"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                }
              >
                {connecting ? "Conectando…" : "Hablar con Hermes"}
              </Button>
            )}
          </>
        }
      />

      {error && (
        <p className="-mt-2 mb-3 flex items-start gap-2 text-xs leading-snug text-text">
          <span aria-hidden className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full bg-red" />
          {error}
        </p>
      )}

      {/* ── Cuerpo: preview central + riel de actividad/conversación ── */}
      <div className="flex min-h-0 flex-1">
        {/* PREVIEW markdown (centro, protagonista) */}
        <section className="min-h-0 min-w-0 flex-1 overflow-y-auto pr-6" aria-label="Preview">
          {!artifact ? (
            <div className="flex h-full flex-col items-center justify-center gap-1.5 text-center">
              <span
                aria-hidden
                className="mb-2 grid h-10 w-10 place-items-center rounded-full border border-line bg-panel-2 text-text-faint"
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
                  <path d="M14 3v5h5M9 13h6M9 17h4" />
                </svg>
              </span>
              <p className="text-sm font-medium text-text">Sin documento todavía</p>
              <p className="max-w-[40ch] text-xs leading-relaxed text-text-faint">
                Pídele a Hermes por voz un reporte, un resumen o cualquier documento y aquí lo
                verás renderizado en tiempo real.
              </p>
            </div>
          ) : (
            <article className="mx-auto w-full max-w-[760px] pb-6">
              <div className="mb-4 flex items-center gap-3">
                <h2 className="min-w-0 flex-1 truncate text-lg font-semibold text-text">
                  {artifact.title}
                </h2>
                <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-text-dim">
                  <span
                    aria-hidden
                    className={`h-1.5 w-1.5 rounded-full ${
                      artifact.status === "running"
                        ? "bg-cyan pulse-dot"
                        : artifact.status === "error"
                          ? "bg-red"
                          : "bg-green"
                    }`}
                  />
                  {artifact.status === "running"
                    ? "Generando…"
                    : artifact.status === "error"
                      ? "Error"
                      : "Listo"}
                </span>
              </div>
              {artifact.status === "running" ? (
                <div className="space-y-2.5">
                  <div className="skeleton h-3 w-3/4" />
                  <div className="skeleton h-3 w-2/3" />
                  <div className="skeleton h-3 w-1/2" />
                  <p className="pt-2 text-xs text-text-faint">Hermes está trabajando en ello…</p>
                </div>
              ) : (
                <Markdown source={artifact.md} />
              )}
            </article>
          )}
        </section>

        {/* Riel derecho a sangre: actividad en vivo + conversación */}
        <aside
          aria-label="Actividad y conversación"
          className="-mt-5 -mr-6 -mb-5 hidden w-[340px] shrink-0 flex-col border-l border-line lg:flex"
        >
          {/* Actividad en vivo */}
          <section className="flex min-h-0 flex-1 flex-col">
            <h3 className="shrink-0 px-5 pt-4 pb-2 text-xs font-medium text-text-dim">
              Actividad en vivo
            </h3>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
              {recentActivity.length === 0 ? (
                <p className="px-2 pt-2 text-xs text-text-faint">Sin actividad todavía.</p>
              ) : (
                recentActivity.map((ev, i) => (
                  <div
                    key={i}
                    title={ev.toolName ? `${ev.toolName} ${ev.detail ?? ""}` : (ev.detail ?? ev.kind)}
                    className="flex h-7 min-w-0 items-center gap-2.5 rounded-sm px-2 text-xs"
                  >
                    <span
                      aria-hidden
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${ACT_DOT[ev.kind] ?? ACT_DOT.text}`}
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {ev.toolName && (
                        <span className="mr-1.5 font-medium text-text">{ev.toolName}</span>
                      )}
                      <span className="text-text-dim">{ev.detail ?? ev.kind}</span>
                    </span>
                  </div>
                ))
              )}
              <div ref={activityEndRef} />
            </div>
          </section>

          {/* Transcripción de la llamada */}
          <section className="flex min-h-0 flex-1 flex-col border-t border-line">
            <h3 className="shrink-0 px-5 pt-4 pb-2 text-xs font-medium text-text-dim">
              Conversación
            </h3>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 pb-4">
              {transcript.length === 0 ? (
                <p className="pt-2 text-xs text-text-faint">
                  {connected ? "Te escucho…" : "Sin conversación. Inicia la llamada para hablar."}
                </p>
              ) : (
                transcript.map((l, i) => (
                  <div key={i}>
                    <p className="text-2xs font-medium text-text-faint">{whoLabel(l.who)}</p>
                    <p
                      className={`mt-0.5 text-sm leading-snug ${
                        l.who === "TÚ" ? "text-text-dim" : "text-text"
                      }`}
                    >
                      {l.text}
                    </p>
                  </div>
                ))
              )}
              <div ref={transcriptEndRef} />
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
