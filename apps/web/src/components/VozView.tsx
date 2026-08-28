"use client";

import { useEffect, useRef } from "react";
import { useConversationMode } from "@elevenlabs/react";
import type { AgentActivityEvent } from "@hermes/shared";
import { Panel } from "@/components/ui/Panel";
import { toneHotVar, type Tone } from "@/components/ui/tones";
import { Markdown } from "./Markdown";
import { VoiceWaveform } from "./VoiceWaveform";
import { useVoice } from "./VoiceBusyContext";
import { useVoiceConnect } from "@/hooks/useVoiceConnect";

/**
 * Modo VOZ EN VIVO (protagonista, centro de la pantalla). Tres zonas:
 *  - Cabecera: waveform real del audio + estado + control de llamada.
 *  - Centro: PREVIEW en markdown de lo último que Hermes produjo (un reporte,
 *    un resumen, lo que sea) — llega solo cuando una tarea de voz termina.
 *  - Riel derecho: actividad EN VIVO (lo que el agente está haciendo) +
 *    transcripción de la llamada.
 */

const ACT_ICON: Record<string, { icon: string; cls: string }> = {
  task_start: { icon: "▶", cls: "text-cyan" },
  tool_call: { icon: "⚙", cls: "text-violet" },
  tool_result: { icon: "↩", cls: "text-text-dim" },
  text: { icon: "…", cls: "text-text-dim" },
  task_done: { icon: "✓", cls: "text-green" },
  error: { icon: "✗", cls: "text-red" },
  session_start: { icon: "◆", cls: "text-blue" },
};

// Tono de estado → clase de texto (violeta usa la variante hot, como el orbe).
const STATUS_CLS: Record<Tone, string> = {
  violet: "text-violet-hot",
  cyan: "text-cyan",
  blue: "text-blue",
  green: "text-green",
  amber: "text-amber",
  red: "text-red",
  neutral: "text-text-dim",
};

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
    ? "VOZ NO CONFIGURADA"
    : connected
      ? action
        ? `EJECUTANDO · ${action}`
        : isSpeaking
          ? "HERMES HABLANDO"
          : "ESCUCHANDO"
      : connecting
        ? "CONECTANDO"
        : "EN PAUSA";
  const statusTone: Tone = !configured
    ? "neutral"
    : connected
      ? action
        ? "cyan"
        : isSpeaking
          ? "violet"
          : "green"
      : connecting
        ? "amber"
        : "neutral";

  const recentActivity = events.slice(-40);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* ── Cabecera de voz ─────────────────────────────────────── */}
      <Panel variant="hero" padding="none">
        <div className="flex items-center gap-4 px-4 py-3">
          {/* Orbe de estado: --orb es la var que consume .voice-orb */}
          <span
            className={`voice-orb ${connected ? "voice-orb-live" : ""}`}
            style={{ ["--orb" as string]: toneHotVar(statusTone), width: 26, height: 26 }}
          />
          <div className="min-w-0 flex-1">
            <div
              className={`font-display text-xs font-bold tracking-title uppercase ${STATUS_CLS[statusTone]}`}
            >
              {statusText}
            </div>
            <div className="mt-0.5 truncate text-xs text-text-dim">
              {transcript.length
                ? `${transcript[transcript.length - 1].who}: ${transcript[transcript.length - 1].text}`
                : connected
                  ? "Hermes te escucha — pídele lo que sea."
                  : "Inicia la llamada y háblale a Hermes en tiempo real."}
            </div>
          </div>
          {/* Waveform real (línea plana y tenue en reposo) */}
          <div className="hidden w-40 shrink-0 sm:block">
            <VoiceWaveform height={40} />
          </div>
          {/* Control */}
          {!configured ? (
            <button className="cmd-btn w-auto justify-center px-4" disabled>
              N/A
            </button>
          ) : connected ? (
            <button className="cmd-btn w-auto justify-center px-4" onClick={() => disconnect()}>
              Terminar
            </button>
          ) : (
            <button
              className="cmd-btn w-auto justify-center px-4"
              disabled={connecting}
              onClick={() => void connect()}
            >
              {connecting ? "Conectando…" : "Hablar con Hermes"}
            </button>
          )}
        </div>
      </Panel>

      {error && <div className="text-xs text-red">⚠ {error}</div>}

      {/* ── Cuerpo: preview central + riel de actividad/transcripción ── */}
      <div className="grid min-h-0 flex-1 grid-cols-3 gap-3">
        {/* PREVIEW markdown (centro, protagonista) */}
        <Panel
          title="Preview"
          className="col-span-2"
          scroll
          right={
            artifact ? (
              <span
                className={`text-2xs tracking-label uppercase ${
                  artifact.status === "running"
                    ? "text-amber"
                    : artifact.status === "error"
                      ? "text-red"
                      : "text-green"
                }`}
              >
                {artifact.status === "running"
                  ? "generando…"
                  : artifact.status === "error"
                    ? "error"
                    : "listo"}
              </span>
            ) : undefined
          }
        >
          {!artifact ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-text-dim">
              <span className="text-2xl opacity-40">◐</span>
              <p className="max-w-xs text-xs leading-relaxed">
                Pídele a Hermes por voz un reporte, un resumen o cualquier documento y aquí lo
                verás renderizado en tiempo real.
              </p>
            </div>
          ) : (
            <>
              <div className="mb-2 text-xs font-bold text-violet-hot">{artifact.title}</div>
              {artifact.status === "running" ? (
                <div className="flex items-center gap-2 text-xs text-amber">
                  <span className="cursor-blink">Hermes está trabajando en ello</span>
                </div>
              ) : (
                <Markdown source={artifact.md} />
              )}
            </>
          )}
        </Panel>

        {/* Riel derecho: actividad en vivo + transcripción */}
        <div className="col-span-1 flex min-h-0 flex-col gap-3">
          {/* Actividad en vivo */}
          <Panel title="Actividad en vivo" className="min-h-0 flex-1" scroll>
            <div className="space-y-1 text-2xs leading-snug">
              {recentActivity.length === 0 ? (
                <p className="pt-4 text-center text-2xs tracking-label text-text-dim uppercase">
                  Sin actividad
                </p>
              ) : (
                recentActivity.map((ev, i) => {
                  const st = ACT_ICON[ev.kind] ?? ACT_ICON.text;
                  return (
                    <div key={i} className="flex gap-1.5">
                      <span className={st.cls}>{st.icon}</span>
                      <span className="min-w-0 flex-1 truncate">
                        {ev.toolName && <b className={`mr-1 ${st.cls}`}>{ev.toolName}</b>}
                        <span className="text-text-dim">{ev.detail ?? ev.kind}</span>
                      </span>
                    </div>
                  );
                })
              )}
              <div ref={activityEndRef} />
            </div>
          </Panel>

          {/* Transcripción de la llamada */}
          <Panel title="Conversación" className="min-h-0 flex-1" scroll>
            <div className="space-y-1.5 text-xs leading-snug">
              {transcript.length === 0 ? (
                <p className="pt-4 text-center text-2xs tracking-label text-text-dim uppercase">
                  {connected ? "Te escucho…" : "Sin conversación"}
                </p>
              ) : (
                transcript.map((l, i) => (
                  <div key={i} className="flex gap-1.5">
                    <b className={`shrink-0 ${l.who === "TÚ" ? "text-cyan" : "text-violet"}`}>
                      {l.who}
                    </b>
                    <span className="text-text">{l.text}</span>
                  </div>
                ))
              )}
              <div ref={transcriptEndRef} />
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
