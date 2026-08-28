"use client";

import { useCallback, useEffect, useState } from "react";
import type { Meeting, MeetingActionable, Task } from "@hermes/shared";
import {
  downloadMeeting,
  getMeeting,
  hermesPost,
  triageActionable,
  type RunRef,
} from "@/lib/hermes";
import { PanelState } from "@/components/ui/PanelState";
import { Markdown } from "./Markdown";

/**
 * Detalle de una reunión: resumen + accionables para TRIAR Linear-first
 * (Ejecutar / Crear en Linear / Ignorar) + transcripción colapsable. Ejecutar
 * y Crear publican el issue en Linear con el exec_prompt como Copy prompt;
 * Ejecutar además lanza el run y lo abre en la CONSOLA principal.
 *
 * Se puede bajar la transcripción sola (.txt) o la junta completa (.md del
 * vault: resumen, accionables, sugerencias en vivo, coach y transcripción).
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
  onExecute: (r: RunRef, task?: Task | null) => void;
}) {
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [loading, setLoading] = useState(true);
  const [showTranscript, setShowTranscript] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [downloading, setDownloading] = useState<"txt" | "md" | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

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
    const { run, task } = await triageActionable(project, id, a.idx, decision);
    await load();
    setBusy(null);
    if (decision === "ejecutar" && run) onExecute(run, task);
  };

  const download = async (format: "txt" | "md") => {
    setDownloading(format);
    setDownloadError(null);
    try {
      await downloadMeeting(project, id, format);
    } catch {
      setDownloadError("No se pudo descargar el archivo");
    } finally {
      setDownloading(null);
    }
  };

  // Fuente de demanda REAL → idea de contenido: el dolor que salió en la junta
  // nace en el Estudio CON hipótesis (el porqué viene de la conversación, no
  // de un título suelto). No cambia el triage del accionable — es aditivo.
  const [ideaDone, setIdeaDone] = useState<Set<number>>(new Set());
  const [ideaBusy, setIdeaBusy] = useState<number | null>(null);
  const toContentIdea = async (a: MeetingActionable) => {
    if (!meeting) return;
    setIdeaBusy(a.idx);
    const when = new Date(meeting.fecha).toLocaleDateString("es-CO", {
      timeZone: "America/Bogota",
      day: "numeric",
      month: "short",
    });
    const piece = await hermesPost("/content/pieces", {
      title: a.title,
      pillar: "p3",
      notes: `Nació de la junta "${meeting.title}" (${project}, ${when}). Hipótesis: ${a.one_liner?.trim() || "dolor real de cliente — escribir el porqué antes de comprometerla"}.`,
    }).catch(() => null);
    if (piece) setIdeaDone((s) => new Set(s).add(a.idx));
    setIdeaBusy(null);
  };

  // Control total de la junta: manda TODOS los accionables sin triar a Linear
  // (como pendientes). Secuencial: cada uno crea su issue con Copy prompt.
  const bulkToLinear = async () => {
    if (!meeting) return;
    setBulkBusy(true);
    for (const a of meeting.actionables) {
      if (a.taskId == null) await triageActionable(project, id, a.idx, "pendiente");
    }
    await load();
    setBulkBusy(false);
  };

  return (
    <div className="flex h-full flex-col">
      <button
        type="button"
        onClick={onBack}
        className="mb-2 flex w-fit items-center gap-1.5 text-2xs tracking-label text-text-dim uppercase transition-colors hover:text-text"
      >
        ← Historial
      </button>

      {loading && <PanelState kind="loading" title="Cargando reunión" />}

      {!loading && !meeting && <PanelState kind="error" title="No se pudo cargar la reunión" />}

      {meeting && (
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-md font-semibold text-text">
                {meeting.title}
              </h3>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-2xs tracking-label text-text-dim uppercase">
                <span>◷ {meeting.fecha.slice(0, 10)}</span>
                <span>▸ {sourceLabel(meeting.source)}</span>
                {meeting.stt_provider && <span>✎ {meeting.stt_provider}</span>}
                {meeting.duracion_min ? <span>⧗ {meeting.duracion_min} min</span> : null}
              </div>
            </div>
            <div className="flex flex-col items-end gap-1">
              <DownloadBtn
                label={downloading === "md" ? "Bajando…" : "↓ Junta completa (.md)"}
                title="Baja el acta completa: resumen, accionables, sugerencias en vivo, coach y transcripción"
                disabled={downloading !== null}
                onClick={() => void download("md")}
              />
              {downloadError && (
                <span className="text-2xs text-amber">{downloadError}</span>
              )}
            </div>
          </div>

          <Section title="Resumen">
            {meeting.summary ? (
              <Markdown source={meeting.summary} project={project} />
            ) : (
              <p className="text-sm text-text-dim">
                —
              </p>
            )}
          </Section>

          <Section
            title={`Accionables · ${meeting.actionables.length}`}
            right={
              meeting.actionables.some((a) => a.taskId == null) ? (
                <button
                  type="button"
                  onClick={() => void bulkToLinear()}
                  disabled={bulkBusy || busy !== null}
                  title="Crear TODOS los accionables sin triar como issues de Linear (pendientes)"
                  className="rounded-sm border border-violet px-2 py-0.5 text-2xs tracking-label text-violet uppercase opacity-90 transition-opacity hover:opacity-100 disabled:opacity-40"
                >
                  {bulkBusy ? "Creando…" : "◫ Todos a Linear"}
                </button>
              ) : undefined
            }
          >
            <div className="space-y-2">
              {meeting.actionables.map((a) => (
                <div
                  key={a.id}
                  className="rounded-sm border border-line bg-violet/5 p-2.5"
                >
                  <p className="text-sm font-medium text-violet-hot">
                    {a.title}
                  </p>
                  {a.one_liner && (
                    <p className="mt-1 text-xs leading-snug text-text-dim">
                      {a.one_liner}
                    </p>
                  )}

                  {a.taskId == null ? (
                    // Sin triar: 3 decisiones Linear-first.
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <TriageBtn
                        label={busy === a.idx ? "…" : "▶ Ejecutar"}
                        tone="border-green text-green"
                        disabled={busy !== null || bulkBusy}
                        title="Crea el issue en Linear y lo ejecuta con Claude Code (abre la consola)"
                        onClick={() => void triage(a, "ejecutar")}
                      />
                      <TriageBtn
                        label={busy === a.idx ? "…" : "◫ Crear en Linear"}
                        tone="border-violet text-violet"
                        disabled={busy !== null || bulkBusy}
                        title="Crea el issue en Linear (pendiente) con el Copy prompt listo"
                        onClick={() => void triage(a, "pendiente")}
                      />
                      <TriageBtn
                        label="✕ Ignorar"
                        tone="border-text-dim text-text-dim"
                        disabled={busy !== null || bulkBusy}
                        title="No crear nada (queda auditado localmente)"
                        onClick={() => void triage(a, "ignorar")}
                      />
                      {ideaDone.has(a.idx) ? (
                        <span className="rounded-sm border border-line px-2 py-1 text-2xs text-cyan">
                          ◇ en el Estudio
                        </span>
                      ) : (
                        <TriageBtn
                          label={ideaBusy === a.idx ? "…" : "◇ Idea de contenido"}
                          tone="border-cyan text-cyan"
                          disabled={ideaBusy !== null}
                          title="Crea la idea en el tab ESTUDIO con la hipótesis salida de esta junta (no toca el triage)"
                          onClick={() => void toContentIdea(a)}
                        />
                      )}
                    </div>
                  ) : (
                    // Ya triado: estado + el issue de Linear (si lo hay).
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <StatusChip status={a.status ?? "pending"} />
                      {a.linear_identifier && a.linear_url ? (
                        <a
                          href={a.linear_url}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-sm border border-line px-1.5 py-0.5 font-mono text-2xs text-cyan transition-colors hover:border-line-2"
                          title="Abrir el issue en Linear"
                        >
                          {a.linear_identifier} ↗
                        </a>
                      ) : (
                        <span className="text-2xs tracking-label text-text-dim uppercase">
                          → gestiónala en TAREAS
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Section>

          {/* Coach: solo juntas EN VIVO con métricas reales (sin datos, sin sección). */}
          {meeting.coach && (
            <Section title="Coach">
              <div className="space-y-2">
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-2xs text-text-dim tabular-nums">
                  {Object.entries(meeting.coach.metrics.bySpeaker)
                    .sort(([, a], [, b]) => b.talkMs - a.talkMs)
                    .map(([label, s]) => {
                      const total = Object.values(meeting.coach!.metrics.bySpeaker).reduce(
                        (a, x) => a + x.talkMs,
                        0,
                      );
                      const pct = total > 0 ? Math.round((s.talkMs / total) * 100) : 0;
                      const isSelf = label === meeting.coach!.metrics.selfSpeaker;
                      return (
                        <span key={label} className={isSelf ? "text-cyan" : undefined}>
                          {label}
                          {isSelf ? " (yo)" : ""}: {pct}% · {s.wpm} wpm · {s.fillers} muletillas
                        </span>
                      );
                    })}
                </div>
                {meeting.coach.performance && (
                  <div className="rounded-sm border border-line bg-cyan/5 p-2.5">
                    <p className="text-sm font-medium text-cyan">
                      Desempeño: {meeting.coach.performance.score}/10
                    </p>
                    <ul className="mt-1 space-y-0.5 text-xs leading-snug text-text-dim">
                      {meeting.coach.performance.highlights.map((h) => (
                        <li key={h} className="text-text">✓ {h}</li>
                      ))}
                      {meeting.coach.performance.improvements.map((i) => (
                        <li key={i}>△ {i}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </Section>
          )}

          <Section
            title="Transcripción"
            right={
              <DownloadBtn
                label={downloading === "txt" ? "Bajando…" : "↓ Descargar .txt"}
                title="Baja la transcripción completa como archivo de texto"
                disabled={downloading !== null || !meeting.transcript}
                onClick={() => void download("txt")}
              />
            }
          >
            <button
              type="button"
              onClick={() => setShowTranscript((v) => !v)}
              className="mb-1 text-2xs tracking-label text-cyan uppercase transition-colors"
            >
              {showTranscript ? "Ocultar ▴" : "Mostrar ▾"}
            </button>
            {showTranscript && (
              <p className="max-h-[38vh] overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-text-dim">
                {meeting.transcript || "—"}
              </p>
            )}
          </Section>
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  right,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-2xs tracking-title text-violet uppercase">▸ {title}</span>
        {right}
      </div>
      {children}
    </div>
  );
}

function TriageBtn({
  label,
  tone,
  disabled,
  title,
  onClick,
}: {
  label: string;
  /** Clases de tono (borde + texto) del design system. */
  tone: string;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded-sm border bg-violet/5 px-2 py-1 text-2xs tracking-label uppercase opacity-90 transition-opacity hover:opacity-100 disabled:opacity-40 ${tone}`}
    >
      {label}
    </button>
  );
}

function DownloadBtn({
  label,
  title,
  disabled,
  onClick,
}: {
  label: string;
  title: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="rounded-sm border border-line px-2 py-0.5 text-2xs tracking-label text-cyan uppercase transition-colors hover:border-line-2 disabled:opacity-40"
    >
      {label}
    </button>
  );
}

function StatusChip({ status }: { status: NonNullable<MeetingActionable["status"]> }) {
  const map: Record<string, { label: string; tone: string }> = {
    pending: { label: "pendiente", tone: "text-amber" },
    running: { label: "ejecutando", tone: "text-cyan" },
    done: { label: "hecha", tone: "text-green" },
    dismissed: { label: "ignorada", tone: "text-text-dim" },
  };
  const s = map[status] ?? map.pending;
  return (
    <span className={`text-2xs tracking-label uppercase ${s.tone}`}>
      ● {s.label}
    </span>
  );
}

function sourceLabel(s: Meeting["source"]): string {
  return s === "audio"
    ? "grabada"
    : s === "upload"
      ? "audio subido"
      : s === "live"
        ? "junta en vivo"
        : "transcripción";
}
