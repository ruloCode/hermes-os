"use client";

import { useCallback, useEffect, useState } from "react";
import type { Meeting, MeetingActionable } from "@hermes/shared";
import { getMeeting, triageActionable, type RunRef } from "@/lib/hermes";
import { Markdown } from "./Markdown";

/**
 * Detalle de una reunión: resumen + los 2 accionables para TRIAR (Ejecutar /
 * Pendiente / Ignorar) + transcripción colapsable. Cada decisión crea una tarea
 * en el tracker; "Ejecutar" además lanza el run y lo abre en el terminal.
 */
export function MeetingDetail({
  project,
  id,
  onBack,
  onExecute,
}: {
  project: string;
  id: string;
  onBack: () => void;
  onExecute: (r: RunRef) => void;
}) {
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [loading, setLoading] = useState(true);
  const [showTranscript, setShowTranscript] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);

  const load = useCallback(async () => {
    const m = await getMeeting(project, id);
    setMeeting(m);
    setLoading(false);
  }, [project, id]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getMeeting(project, id).then((m) => {
      if (!alive) return;
      setMeeting(m);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [project, id]);

  const triage = async (a: MeetingActionable, decision: "ejecutar" | "pendiente" | "ignorar") => {
    setBusy(a.idx);
    const { run } = await triageActionable(project, id, a.idx, decision);
    await load();
    setBusy(null);
    if (decision === "ejecutar" && run) onExecute(run);
  };

  return (
    <div className="flex h-full flex-col">
      <button
        type="button"
        onClick={onBack}
        className="mb-2 flex w-fit items-center gap-1.5 text-[10px] tracking-[0.2em] uppercase transition-colors hover:opacity-100"
        style={{ color: "var(--text-dim)" }}
      >
        ← Historial
      </button>

      {loading && (
        <p className="pt-6 text-center text-[10px] tracking-[0.25em] pulse-dot" style={{ color: "var(--text-dim)" }}>
          CARGANDO REUNIÓN…
        </p>
      )}

      {!loading && !meeting && (
        <p className="pt-6 text-center text-[10.5px]" style={{ color: "var(--text-dim)" }}>
          No se pudo cargar la reunión.
        </p>
      )}

      {meeting && (
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          <div>
            <h3 className="text-[14px] font-semibold" style={{ color: "var(--text)" }}>
              {meeting.title}
            </h3>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[9px] tracking-[0.14em] uppercase" style={{ color: "var(--text-dim)" }}>
              <span>◷ {meeting.fecha.slice(0, 10)}</span>
              <span>▸ {sourceLabel(meeting.source)}</span>
              {meeting.stt_provider && <span>✎ {meeting.stt_provider}</span>}
              {meeting.duracion_min ? <span>⧗ {meeting.duracion_min} min</span> : null}
            </div>
          </div>

          <Section title="Resumen">
            {meeting.summary ? (
              <Markdown source={meeting.summary} project={project} />
            ) : (
              <p className="text-[12px]" style={{ color: "var(--text-dim)" }}>
                —
              </p>
            )}
          </Section>

          <Section title={`Accionables · ${meeting.actionables.length}`}>
            <div className="space-y-2">
              {meeting.actionables.map((a) => (
                <div
                  key={a.id}
                  className="rounded-sm border p-2.5"
                  style={{ borderColor: "var(--line)", background: "rgba(122,132,255,0.04)" }}
                >
                  <p className="text-[12px] font-medium" style={{ color: "var(--violet-hot)" }}>
                    {a.title}
                  </p>
                  {a.one_liner && (
                    <p className="mt-1 text-[11px] leading-snug" style={{ color: "var(--text-dim)" }}>
                      {a.one_liner}
                    </p>
                  )}

                  {a.taskId == null ? (
                    // Sin triar: 3 decisiones.
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <TriageBtn
                        label={busy === a.idx ? "…" : "▶ Ejecutar"}
                        color="var(--green)"
                        disabled={busy !== null}
                        onClick={() => void triage(a, "ejecutar")}
                      />
                      <TriageBtn
                        label="◷ Pendiente"
                        color="var(--amber)"
                        disabled={busy !== null}
                        onClick={() => void triage(a, "pendiente")}
                      />
                      <TriageBtn
                        label="✕ Ignorar"
                        color="var(--text-dim)"
                        disabled={busy !== null}
                        onClick={() => void triage(a, "ignorar")}
                      />
                    </div>
                  ) : (
                    // Ya triado: muestra el estado de la tarea.
                    <div className="mt-2 flex items-center gap-2">
                      <StatusChip status={a.status ?? "pending"} />
                      <span className="text-[9px] tracking-[0.12em] uppercase" style={{ color: "var(--text-dim)" }}>
                        → gestiónala en el Orquestador
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Section>

          <Section title="Transcripción">
            <button
              type="button"
              onClick={() => setShowTranscript((v) => !v)}
              className="mb-1 text-[10px] tracking-[0.2em] uppercase transition-colors"
              style={{ color: "var(--cyan)" }}
            >
              {showTranscript ? "Ocultar ▴" : "Mostrar ▾"}
            </button>
            {showTranscript && (
              <p className="max-h-[38vh] overflow-y-auto whitespace-pre-wrap text-[11px] leading-relaxed" style={{ color: "var(--text-dim)" }}>
                {meeting.transcript || "—"}
              </p>
            )}
          </Section>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[9px] tracking-[0.25em] uppercase" style={{ color: "var(--violet)" }}>
        ▸ {title}
      </div>
      {children}
    </div>
  );
}

function TriageBtn({
  label,
  color,
  disabled,
  onClick,
}: {
  label: string;
  color: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-sm border px-2 py-1 text-[9.5px] tracking-[0.15em] uppercase transition-opacity hover:opacity-100 disabled:opacity-40"
      style={{ borderColor: color, color, background: "rgba(122,132,255,0.04)", opacity: 0.9 }}
    >
      {label}
    </button>
  );
}

function StatusChip({ status }: { status: NonNullable<MeetingActionable["status"]> }) {
  const map: Record<string, { label: string; color: string }> = {
    pending: { label: "pendiente", color: "var(--amber)" },
    running: { label: "ejecutando", color: "var(--cyan)" },
    done: { label: "hecha", color: "var(--green)" },
    dismissed: { label: "ignorada", color: "var(--text-dim)" },
  };
  const s = map[status] ?? map.pending;
  return (
    <span className="text-[9px] tracking-[0.18em] uppercase" style={{ color: s.color }}>
      ● {s.label}
    </span>
  );
}

function sourceLabel(s: Meeting["source"]): string {
  return s === "audio" ? "grabada" : s === "upload" ? "audio subido" : "transcripción";
}
