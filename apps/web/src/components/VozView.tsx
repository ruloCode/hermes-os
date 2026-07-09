"use client";

import { useEffect, useRef } from "react";
import { useConversation } from "@elevenlabs/react";
import type { AgentActivityEvent } from "@hermes/shared";
import { Markdown } from "./Markdown";
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

const ACT_ICON: Record<string, { icon: string; color: string }> = {
  task_start: { icon: "▶", color: "var(--cyan)" },
  tool_call: { icon: "⚙", color: "var(--violet)" },
  tool_result: { icon: "↩", color: "var(--text-dim)" },
  text: { icon: "…", color: "var(--text-dim)" },
  task_done: { icon: "✓", color: "var(--green)" },
  error: { icon: "✗", color: "var(--red)" },
  session_start: { icon: "◆", color: "var(--blue)" },
};

export function VozView({ events }: { events: AgentActivityEvent[] }) {
  const { transcript, action, artifact } = useVoice();
  const { connect, disconnect, error, configured, connected, connecting } = useVoiceConnect();
  const conv = useConversation();
  const { isSpeaking, getInputByteFrequencyData, getOutputByteFrequencyData } = conv;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const speakingRef = useRef(isSpeaking);
  speakingRef.current = isSpeaking;
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const activityEndRef = useRef<HTMLDivElement>(null);

  // Waveform real (salida cuando habla Hermes, entrada cuando escucha).
  useEffect(() => {
    if (!connected) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    let raf = 0;
    const draw = () => {
      const data = speakingRef.current ? getOutputByteFrequencyData() : getInputByteFrequencyData();
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      if (data && data.length) {
        const bars = 64;
        const step = Math.floor(data.length / bars) || 1;
        const bw = w / bars;
        ctx.fillStyle = speakingRef.current ? "#c4b5fd" : "#6ee7a0";
        for (let i = 0; i < bars; i++) {
          const v = data[i * step] / 255;
          const bh = Math.max(2, v * h);
          ctx.fillRect(i * bw, (h - bh) / 2, bw - 2, bh);
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [connected, getInputByteFrequencyData, getOutputByteFrequencyData]);

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
  const statusColor = !configured
    ? "var(--text-dim)"
    : connected
      ? action
        ? "var(--cyan)"
        : isSpeaking
          ? "var(--violet-hot)"
          : "var(--green)"
      : connecting
        ? "var(--amber)"
        : "var(--text-dim)";

  const recentActivity = events.slice(-40);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* ── Cabecera de voz ─────────────────────────────────────── */}
      <div className="flex items-center gap-4 rounded-sm border px-4 py-3" style={{ borderColor: "var(--line)", background: "rgba(122,132,255,0.04)" }}>
        <span
          className={`voice-orb ${connected ? "voice-orb-live" : ""}`}
          style={{ ["--orb" as string]: statusColor, width: "26px", height: "26px" }}
        />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-bold tracking-[0.25em] uppercase" style={{ color: statusColor }}>
            {statusText}
          </div>
          <div className="mt-0.5 truncate text-[11px]" style={{ color: "var(--text-dim)" }}>
            {transcript.length
              ? `${transcript[transcript.length - 1].who}: ${transcript[transcript.length - 1].text}`
              : connected
                ? "Hermes te escucha — pídele lo que sea."
                : "Inicia la llamada y háblale a Hermes en tiempo real."}
          </div>
        </div>
        {/* Waveform o barras idle */}
        <div className="hidden h-10 w-40 shrink-0 items-center justify-center sm:flex">
          {connected ? (
            <canvas ref={canvasRef} width={160} height={40} className="h-10 w-40" />
          ) : (
            <div className="wave-idle flex h-10 items-center gap-[3px]">
              {Array.from({ length: 20 }).map((_, i) => (
                <span key={i} className="wave-bar" style={{ height: `${8 + Math.abs(Math.sin(i * 0.6)) * 18}px` }} />
              ))}
            </div>
          )}
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
          <button className="cmd-btn w-auto justify-center px-4" disabled={connecting} onClick={() => void connect()}>
            {connecting ? "Conectando…" : "Iniciar voz"}
          </button>
        )}
      </div>

      {error && (
        <div className="text-[10.5px]" style={{ color: "var(--red)" }}>
          ⚠ {error}
        </div>
      )}

      {/* ── Cuerpo: preview central + riel de actividad/transcripción ── */}
      <div className="grid min-h-0 flex-1 grid-cols-3 gap-3">
        {/* PREVIEW markdown (centro, protagonista) */}
        <div className="col-span-2 flex min-h-0 flex-col rounded-sm border" style={{ borderColor: "var(--line)" }}>
          <div className="flex items-center justify-between border-b px-3 py-2" style={{ borderColor: "var(--line)" }}>
            <span className="text-[9px] tracking-[0.25em] uppercase" style={{ color: "var(--text-dim)" }}>
              {artifact ? "Preview" : "Preview"}
            </span>
            {artifact && (
              <span
                className="text-[9px] tracking-[0.2em] uppercase"
                style={{
                  color:
                    artifact.status === "running"
                      ? "var(--amber)"
                      : artifact.status === "error"
                        ? "var(--red)"
                        : "var(--green)",
                }}
              >
                {artifact.status === "running" ? "generando…" : artifact.status === "error" ? "error" : "listo"}
              </span>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {!artifact ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center" style={{ color: "var(--text-dim)" }}>
                <span className="text-2xl opacity-40">◐</span>
                <p className="max-w-xs text-[11px] leading-relaxed">
                  Pídele a Hermes por voz un reporte, un resumen o cualquier documento y aquí lo verás renderizado en tiempo real.
                </p>
              </div>
            ) : (
              <>
                <div className="mb-2 text-[11px] font-bold" style={{ color: "var(--violet-hot)" }}>
                  {artifact.title}
                </div>
                {artifact.status === "running" ? (
                  <div className="flex items-center gap-2 text-[11px]" style={{ color: "var(--amber)" }}>
                    <span className="cursor-blink">Hermes está trabajando en ello</span>
                  </div>
                ) : (
                  <Markdown source={artifact.md} />
                )}
              </>
            )}
          </div>
        </div>

        {/* Riel derecho: actividad en vivo + transcripción */}
        <div className="col-span-1 flex min-h-0 flex-col gap-3">
          {/* Actividad en vivo */}
          <div className="flex min-h-0 flex-1 flex-col rounded-sm border" style={{ borderColor: "var(--line)" }}>
            <div className="border-b px-3 py-2 text-[9px] tracking-[0.25em] uppercase" style={{ borderColor: "var(--line)", color: "var(--text-dim)" }}>
              Actividad en vivo
            </div>
            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-2 text-[10px] leading-snug">
              {recentActivity.length === 0 ? (
                <p className="pt-4 text-center text-[9px] tracking-[0.2em]" style={{ color: "var(--text-dim)" }}>
                  SIN ACTIVIDAD
                </p>
              ) : (
                recentActivity.map((ev, i) => {
                  const st = ACT_ICON[ev.kind] ?? ACT_ICON.text;
                  return (
                    <div key={i} className="flex gap-1.5">
                      <span style={{ color: st.color }}>{st.icon}</span>
                      <span className="min-w-0 flex-1 truncate">
                        {ev.toolName && (
                          <b className="mr-1" style={{ color: st.color }}>
                            {ev.toolName}
                          </b>
                        )}
                        <span style={{ color: "var(--text-dim)" }}>{ev.detail ?? ev.kind}</span>
                      </span>
                    </div>
                  );
                })
              )}
              <div ref={activityEndRef} />
            </div>
          </div>

          {/* Transcripción de la llamada */}
          <div className="flex min-h-0 flex-1 flex-col rounded-sm border" style={{ borderColor: "var(--line)" }}>
            <div className="border-b px-3 py-2 text-[9px] tracking-[0.25em] uppercase" style={{ borderColor: "var(--line)", color: "var(--text-dim)" }}>
              Conversación
            </div>
            <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 py-2 text-[10.5px] leading-snug">
              {transcript.length === 0 ? (
                <p className="pt-4 text-center text-[9px] tracking-[0.2em]" style={{ color: "var(--text-dim)" }}>
                  {connected ? "TE ESCUCHO…" : "SIN CONVERSACIÓN"}
                </p>
              ) : (
                transcript.map((l, i) => (
                  <div key={i} className="flex gap-1.5">
                    <b className="shrink-0" style={{ color: l.who === "TÚ" ? "var(--cyan)" : "var(--violet)" }}>
                      {l.who}
                    </b>
                    <span style={{ color: "var(--text)" }}>{l.text}</span>
                  </div>
                ))
              )}
              <div ref={transcriptEndRef} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
